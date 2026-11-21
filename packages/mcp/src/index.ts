#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { OpenPetsClient, OpenPetsLeaseResult } from "@open-pets/client";

import { createHelpText, getMcpLeaseRequestedPetId, parseMcpArgs } from "./args.js";
import { createMcpHttpBearerToken, resolveMcpHttpBearerToken, startSharedMcpHttpServer } from "./http-server.js";
import { createOpenPetsMcpServer } from "./server.js";
import { createToolContext, recoverLease, type LeaseContext } from "./tools.js";

/** Minimal transport interface required by wireTransportLifecycle (subset of StdioServerTransport). */
export interface McpTransportHook {
  onclose?: (() => void) | undefined;
}

/** Minimal server interface required by wireTransportLifecycle. */
export interface McpServerHook {
  close(): Promise<void>;
}

export interface TransportLifecycleOptions {
  readonly transport: McpTransportHook;
  readonly server: McpServerHook;
  readonly client: OpenPetsClient;
  readonly lease: LeaseContext;
  readonly leaseReady: Promise<void>;
  readonly requestedPetId?: string;
  /** Test/runtime timing overrides; production defaults remain five seconds. */
  readonly heartbeatIntervalMs?: number;
  readonly retryDelayMs?: number;
  /** Stop accepting requests and drain active HTTP work before releasing a shared lease. */
  readonly beforeClose?: () => Promise<void>;
  /**
   * Called after teardown when the transport closes. Defaults to `() => process.exit(0)`.
   * Override in tests to prevent the process from actually exiting.
   */
  readonly exit?: () => void;
}

/**
 * Wires heartbeat, retry, and graceful-close logic onto a transport.
 * Exported so tests can invoke the lifecycle without spawning a real process.
 *
 * Returns the `close` function so callers (e.g. SIGINT handlers) can reuse it.
 */
export function wireTransportLifecycle(opts: TransportLifecycleOptions): { close: () => Promise<void> } {
  const { transport, server, client, lease, leaseReady, requestedPetId } = opts;
  const exit = opts.exit ?? (() => process.exit(0));
  let exited = false;
  const exitOnce = (): void => { if (exited) return; exited = true; exit(); };

  let heartbeatTimer: NodeJS.Timeout | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 5_000;
  const initialRetryDelayMs = opts.retryDelayMs ?? 5_000;
  let retryDelayMs = initialRetryDelayMs;
  const MAX_RETRY_DELAY_MS = 60_000;
  let closePromise: Promise<void> | null = null;
  const retainedLeaseIds = new Set<string>();

  const retainLeaseId = (leaseId: string | undefined): void => {
    if (leaseId) retainedLeaseIds.add(leaseId);
  };

  const releaseRetainedLeases = async (): Promise<void> => {
    retainLeaseId(lease.lease?.leaseId);
    retainLeaseId(lease.staleLeaseId);
    retainLeaseId(lease.staleLease?.leaseId);
    for (const leaseId of retainedLeaseIds) {
      try { await client.releaseLease(leaseId); } catch { /* best effort */ }
    }
  };

  function scheduleRetry(): void {
    if (retryTimer || lease.closing) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (lease.closing || lease.lease) return;
      void recoverLease(client, lease, requestedPetId).then(
        () => {
          if (lease.closing) return;
          retryDelayMs = initialRetryDelayMs;
        },
        (error: unknown) => {
          if (lease.closing) return;
          lease.degradedReason = sanitizeMcpRuntimeError(error);
          retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
          scheduleRetry();
        },
      );
    }, retryDelayMs);
    retryTimer.unref?.();
  }

  leaseReady.then(() => {
    if (lease.closing || !lease.lease) return;
    heartbeatTimer = setInterval(() => {
      if (lease.closing || !lease.lease) return;
      void client.heartbeatLease(lease.lease.leaseId).catch((error: unknown) => {
        // A heartbeat may have started before close() published its closing state.
        // Once closing is set, preserve the lease for teardown instead of letting
        // this late rejection erase the ID that must be released.
        if (lease.closing || !lease.lease) return;
        // Save full stale lease for heartbeat-first recovery in scheduleRetry / ensureLease
        lease.staleLease = lease.lease;
        lease.staleLeaseId = lease.lease?.leaseId;
        lease.degradedReason = sanitizeMcpRuntimeError(error);
        lease.lease = undefined;
        retryDelayMs = initialRetryDelayMs;
        scheduleRetry();
      });
    }, heartbeatIntervalMs);
    heartbeatTimer.unref?.();
  }).catch(() => {});

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    // Publish teardown state before any await so tools and timers cannot start recovery afterward.
    lease.closing = true;
    retainLeaseId(lease.lease?.leaseId);
    retainLeaseId(lease.staleLeaseId);
    retainLeaseId(lease.staleLease?.leaseId);
    closePromise = (async () => {
      try { await opts.beforeClose?.(); } catch { /* continue releasing the shared lease */ }
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      try { await leaseReady; } catch { /* startup already records its degraded state */ }
      if (lease.recoveryPromise) {
        try { await lease.recoveryPromise; } catch { /* recovery failure is already reflected in degradedReason */ }
      }
      await releaseRetainedLeases();
      lease.lease = undefined;
      lease.staleLeaseId = undefined;
      lease.staleLease = undefined;
      lease.recoveryPromise = undefined;
      lease.degradedReason = undefined;
      try { await server.close(); } catch { /* ignore shutdown errors */ }
    })();
    return closePromise;
  };

  // Fix 3: exit after teardown so the process doesn't linger as an orphan
  transport.onclose = () => { void close().finally(() => exitOnce()); };

  return { close };
}

async function main(): Promise<void> {
  const options = parseMcpArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(createHelpText());
    return;
  }

  if (options.version) {
    process.stdout.write(`${readPackageVersion()}\n`);
    return;
  }

  const lease: LeaseContext = {};
  const context = createToolContext(options.petId);
  if (context.client.transport === "remote" && options.petId !== undefined) {
    throw new Error("Remote mode does not support --pet; remote control uses the default pet.");
  }
  const httpToken = options.transport === "http"
    ? resolveMcpHttpBearerToken(process.env.OPENPETS_MCP_HTTP_TOKEN) ?? createMcpHttpBearerToken()
    : undefined;
  const requestedPetId = getMcpLeaseRequestedPetId(options);
  const leaseReady = acquireStartupLease(context.client, lease, requestedPetId);

  if (options.transport === "http") {
    if (!httpToken) throw new Error("HTTP bearer token could not be initialized.");
    const token = httpToken;
    let httpServer: Awaited<ReturnType<typeof startSharedMcpHttpServer>> | undefined;
    let httpServerStart: Promise<Awaited<ReturnType<typeof startSharedMcpHttpServer>>> | undefined;
    const closeHttpServer = async (): Promise<void> => {
      if (httpServer) {
        await httpServer.close();
        return;
      }
      if (!httpServerStart) return;
      try {
        const started = await httpServerStart;
        httpServer = started;
        await started.close();
      } catch {
        // Startup failure is handled by main after lease teardown.
      }
    };
    const { close } = wireTransportLifecycle({
      transport: {},
      server: { close: closeHttpServer },
      client: context.client,
      lease,
      leaseReady,
      requestedPetId,
      beforeClose: closeHttpServer,
    });
    let shutdownStarted = false;
    const requestShutdown = (): void => {
      if (shutdownStarted) return;
      shutdownStarted = true;
      void close().then(() => process.exit(0), () => process.exit(1));
    };
    process.on("SIGINT", requestShutdown);
    process.on("SIGTERM", requestShutdown);
    if (process.env.OPENPETS_MCP_WRAPPER_SHUTDOWN === "stdin-eof" && !process.stdin.isTTY) {
      process.stdin.once("end", requestShutdown);
      process.stdin.resume();
    }

    await leaseReady;
    if (lease.closing) {
      await close();
      return;
    }
    try {
      httpServerStart = startSharedMcpHttpServer({
        context: { ...context, lease, leaseReady, leaseRequestedPetId: requestedPetId },
        port: options.port,
        token,
      });
      httpServer = await httpServerStart;
    } catch (error) {
      await close();
      throw error;
    }
    if (lease.closing) {
      await closeHttpServer();
      await close();
      return;
    }
    process.stderr.write(`OpenPets MCP HTTP listening at ${httpServer.endpoint}\n`);
    if (process.env.OPENPETS_MCP_HTTP_TOKEN) {
      process.stderr.write("Authorization: Bearer token is configured via OPENPETS_MCP_HTTP_TOKEN.\n");
    } else {
      process.stderr.write(`Authorization: Bearer ${token}\n`);
      process.stderr.write("This bearer token is temporary. Set OPENPETS_MCP_HTTP_TOKEN to reuse it after restart.\n");
    }
    return;
  }

  const server = createOpenPetsMcpServer({ ...context, lease, leaseReady });
  const transport = new StdioServerTransport();

  const { close } = wireTransportLifecycle({ transport, server, client: context.client, lease, leaseReady, requestedPetId });

  process.on("SIGINT", () => { void close().finally(() => process.exit(0)); });
  process.on("SIGTERM", () => { void close().finally(() => process.exit(0)); });

  await server.connect(transport);
}

async function acquireStartupLease(client: ReturnType<typeof createToolContext>["client"], lease: LeaseContext, requestedPetId: string | undefined): Promise<void> {
  if (client.transport === "remote") return;
  try {
    lease.lease = await client.acquireLease({ requestedPetId });
    lease.staleLeaseId = undefined;
    lease.staleLease = undefined;
    lease.degradedReason = undefined;
  } catch (error) {
    lease.lease = undefined;
    lease.staleLeaseId = undefined;
    lease.staleLease = undefined;
    lease.degradedReason = sanitizeMcpRuntimeError(error);
  }
}

function sanitizeMcpRuntimeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "OpenPets lease operation failed.";
  if (/\/|\\|\.sock|pipe|token|ipc\.json|ENOENT|ECONNREFUSED|EACCES/i.test(message)) {
    return "OpenPets desktop app or local IPC is unavailable.";
  }
  return message.slice(0, 160);
}

main().catch((error: unknown) => {
  process.stderr.write(`OpenPets MCP server failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const packageJson = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// Re-export LeaseContext for test consumers that build lifecycle fixtures
export type { LeaseContext, OpenPetsLeaseResult };
