import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createTcpServer } from "node:net";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OpenPetsClient, OpenPetsLeaseResult } from "@open-pets/client";

import { getMcpLeaseRequestedPetId, parseMcpArgs } from "./args.js";
import {
  createMcpHttpBearerToken,
  isAuthorizedMcpHttpRequest,
  resolveMcpHttpBearerToken,
  startSharedMcpHttpServer,
} from "./http-server.js";
import { recoverLease, type LeaseContext } from "./tools.js";

const token = createMcpHttpBearerToken();
const sharedPetId = getMcpLeaseRequestedPetId(parseMcpArgs(["--transport", "http"]));
assert.equal(sharedPetId, "builtin", "HTTP mode explicitly selects the desktop default even when pet pooling is enabled");
assert.equal(getMcpLeaseRequestedPetId(parseMcpArgs([])), undefined, "stdio keeps its existing lease selection");
assert.equal(token.length, 43);
assert.equal(resolveMcpHttpBearerToken(token), token);
assert.throws(() => resolveMcpHttpBearerToken("short"), /32 to 128/);
assert.equal(isAuthorizedMcpHttpRequest(`Bearer ${token}`, token), true);
assert.equal(isAuthorizedMcpHttpRequest(`Bearer ${"B".repeat(43)}`, token), false);
assert.equal(isAuthorizedMcpHttpRequest([`Bearer ${token}`], token), false);

const sharedLease: OpenPetsLeaseResult = {
  leaseId: "shared-default-pet-lease",
  targetKind: "default",
  actualTargetPetId: "builtin",
  actualTargetPetName: "OpenPets",
  usingDefaultPet: true,
  expiresAt: Date.now() + 15_000,
  leaseActive: true,
};
const statusLeaseIds: Array<string | undefined> = [];
const acquiredPetIds: Array<string | undefined> = [];
let delayNextStatus = false;
let statusStartedCallback = (): void => {};
let statusGate: Promise<void> = Promise.resolve();
let unblockStatus: (() => void) | undefined;
const fakeClient = {
  transport: "local" as const,
  hello: async () => ({ ok: true }),
  status: async (options?: { readonly leaseId?: string }) => {
    statusLeaseIds.push(options?.leaseId);
    if (delayNextStatus) {
      delayNextStatus = false;
      statusStartedCallback();
      await statusGate;
    }
    return { ok: true, appRunning: true };
  },
  listPets: async () => ({ ok: true as const, pets: [], defaultPetId: "builtin" }),
  installPet: async () => { throw new Error("unused"); },
  installLocalPet: async () => { throw new Error("unused"); },
  acquireLease: async (options?: { readonly requestedPetId?: string }) => {
    acquiredPetIds.push(options?.requestedPetId);
    return sharedLease;
  },
  heartbeatLease: async (leaseId: string) => ({ leaseId, expiresAt: Date.now() + 15_000 }),
  releaseLease: async () => ({ released: true }),
  react: async (_reaction: string, options?: { readonly leaseId?: string }) => {
    statusLeaseIds.push(options?.leaseId);
    return { ok: true };
  },
  say: async (_message: string, options?: { readonly leaseId?: string }) => {
    statusLeaseIds.push(options?.leaseId);
    return { ok: true };
  },
  showMedia: async () => ({ ok: true, shown: true }),
} satisfies Partial<OpenPetsClient>;

const lease: LeaseContext = { lease: sharedLease };
const context = {
  client: fakeClient as OpenPetsClient,
  lease,
  leaseReady: Promise.resolve(),
};

const recoveredLease: LeaseContext = {};
await recoverLease(fakeClient as OpenPetsClient, recoveredLease, sharedPetId);
assert.deepEqual(acquiredPetIds, ["builtin"], "lease recovery preserves HTTP's explicit default-pet target");
recoveredLease.lease = undefined;
const server = await startSharedMcpHttpServer({ context, port: 0, token });
const endpoint = new URL(server.endpoint);

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(server.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
}

function postWithHost(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: endpoint.port,
      path: endpoint.pathname,
      method: "POST",
      headers: {
        host,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    request.once("error", reject);
    request.end(JSON.stringify(initialize));
  });
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "openpets-http-check", version: "1.0.0" },
  },
};

try {
  const unauthenticated = await post(initialize);
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get("access-control-allow-origin"), null);

  const invalidOrigin = await post(initialize, {
    authorization: `Bearer ${token}`,
    origin: "https://attacker.example",
  });
  assert.equal(invalidOrigin.status, 403);
  assert.equal(invalidOrigin.headers.get("access-control-allow-origin"), null);

  assert.equal(await postWithHost("attacker.example"), 403);

  const wrongContentType = await fetch(server.endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" },
    body: JSON.stringify(initialize),
  });
  assert.equal(wrongContentType.status, 415);

  const unauthorizedMalformedBody = await fetch(server.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(unauthorizedMalformedBody.status, 401, "authorization is checked before parsing the body");
  const malformedBody = await fetch(server.endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{",
  });
  assert.equal(malformedBody.status, 400);
  assert.deepEqual(await malformedBody.json(), { error: "Invalid request." });

  const makeClient = async (name: string): Promise<Client> => {
    const client = new Client({ name, version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(server.endpoint), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    return client;
  };

  const clients = await Promise.all(Array.from({ length: 6 }, (_, index) => makeClient(`client-${index + 1}`)));
  try {
    const toolLists = await Promise.all(clients.map((client) => client.listTools()));
    for (const result of toolLists) {
      assert.deepEqual(result.tools.map((tool) => tool.name), ["openpets_status", "openpets_react", "openpets_say"]);
    }

    const results = await Promise.all(clients.map((client) => client.callTool({ name: "openpets_status", arguments: {} })));
    assert.ok(results.every((result) => result.isError === undefined));
    assert.equal(statusLeaseIds.length, 6);
    assert.ok(statusLeaseIds.every((leaseId) => leaseId === sharedLease.leaseId));

    const sameOriginResponse = await post(initialize, {
      authorization: `Bearer ${token}`,
      origin: endpoint.origin,
    });
    assert.equal(sameOriginResponse.status, 200);
    assert.equal(sameOriginResponse.headers.get("access-control-allow-origin"), null);

    let signalStatusStarted!: () => void;
    const statusStarted = new Promise<void>((resolve) => { signalStatusStarted = resolve; });
    statusStartedCallback = signalStatusStarted;
    statusGate = new Promise<void>((resolve) => { unblockStatus = resolve; });
    delayNextStatus = true;
    const pendingStatus = clients[0]!.callTool({ name: "openpets_status", arguments: {} });
    await statusStarted;
    let closeFinished = false;
    const closing = server.close().then(() => { closeFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(closeFinished, false, "shutdown waits for an active request to finish");
    unblockStatus?.();
    await Promise.all([pendingStatus, closing]);
    unblockStatus = undefined;
    assert.equal(closeFinished, true);
  } finally {
    unblockStatus?.();
    await Promise.all(clients.map((client) => client.close()));
  }
} finally {
  await server.close();
}

const recoveryLease: LeaseContext = {};
const recoveryContext = {
  client: fakeClient as OpenPetsClient,
  lease: recoveryLease,
  leaseReady: Promise.resolve(),
  leaseRequestedPetId: sharedPetId,
};
const recoveryServer = await startSharedMcpHttpServer({ context: recoveryContext, port: 0, token });
const recoveryClient = new Client({ name: "lease-recovery-check", version: "1.0.0" });
const recoveryTransport = new StreamableHTTPClientTransport(new URL(recoveryServer.endpoint), {
  requestInit: { headers: { authorization: `Bearer ${token}` } },
});
try {
  acquiredPetIds.length = 0;
  await recoveryClient.connect(recoveryTransport);
  const recoveryResult = await recoveryClient.callTool({ name: "openpets_react", arguments: { reaction: "waving" } });
  assert.equal(recoveryResult.isError, undefined);
  assert.deepEqual(acquiredPetIds, ["builtin"], "HTTP tool-triggered recovery explicitly reacquires the default pet");
} finally {
  await recoveryClient.close();
  await recoveryServer.close();
}

const shutdownServer = await startSharedMcpHttpServer({ context, port: 0, token, shutdownGraceMs: 100 });
const shutdownEndpoint = new URL(shutdownServer.endpoint);
const incompleteRequest = httpRequest({
  hostname: "127.0.0.1",
  port: shutdownEndpoint.port,
  path: shutdownEndpoint.pathname,
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "content-length": "100",
  },
});
incompleteRequest.on("error", () => {});
const requestConnected = new Promise<void>((resolve, reject) => {
  incompleteRequest.once("socket", (socket) => {
    if (!socket.connecting) {
      resolve();
      return;
    }
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
});
incompleteRequest.write("{");
await requestConnected;
await new Promise((resolve) => setTimeout(resolve, 30));
const shutdownStartedAt = Date.now();
let incompleteShutdownFinished = false;
const incompleteClosing = shutdownServer.close().then(() => { incompleteShutdownFinished = true; });
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(incompleteShutdownFinished, false, "shutdown keeps the established partial request during its grace period");
await incompleteClosing;
const shutdownElapsedMs = Date.now() - shutdownStartedAt;
assert.ok(shutdownElapsedMs >= 90, "shutdown waits through the configured grace period before force-closing the request");
assert.ok(shutdownElapsedMs < 1_500, "shutdown force-closes an incomplete request within a bounded time");
incompleteRequest.destroy();

const mcpEntrypoint = fileURLToPath(new URL("./index.js", import.meta.url));
const standaloneHttpChild = await spawnMcpHttpChild(await getAvailableLoopbackPort(), false);
try {
  await waitForListeningMessage(standaloneHttpChild);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(standaloneHttpChild.exitCode, null, "standalone HTTP mode stays alive when stdin is closed");
} finally {
  if (standaloneHttpChild.exitCode === null && standaloneHttpChild.signalCode === null) standaloneHttpChild.kill();
  await waitForChildExit(standaloneHttpChild, 5_000);
}

const wrappedHttpChild = await spawnMcpHttpChild(await getAvailableLoopbackPort(), true);
try {
  await waitForListeningMessage(wrappedHttpChild);
  wrappedHttpChild.stdin?.end();
  const exit = await waitForChildExit(wrappedHttpChild, 5_000);
  assert.equal(exit.code, 0, "the CLI wrapper's private stdin EOF channel completes graceful HTTP shutdown");
} finally {
  if (wrappedHttpChild.exitCode === null && wrappedHttpChild.signalCode === null) wrappedHttpChild.kill();
  await waitForChildExit(wrappedHttpChild, 5_000);
}

console.log("OpenPets shared MCP HTTP transport passed.");

async function getAvailableLoopbackPort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a loopback port for the MCP lifecycle check.");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function spawnMcpHttpChild(port: number, wrapped: boolean): Promise<ChildProcess> {
  const environment: NodeJS.ProcessEnv = { ...process.env, OPENPETS_MCP_HTTP_TOKEN: token };
  environment.OPENPETS_DISCOVERY_FILE = join(process.cwd(), ".missing-openpets-discovery.json");
  delete environment.OPENPETS_MCP_WRAPPER_SHUTDOWN;
  delete environment.OPENPETS_REMOTE_ENDPOINT;
  delete environment.OPENPETS_REMOTE_TOKEN;
  delete environment.OPENPETS_REMOTE_CLIENT_ID;
  if (wrapped) environment.OPENPETS_MCP_WRAPPER_SHUTDOWN = "stdin-eof";
  const child = spawn(process.execPath, [mcpEntrypoint, "--transport", "http", "--port", String(port)], {
    stdio: wrapped ? ["pipe", "ignore", "pipe"] : ["ignore", "ignore", "pipe"],
    env: environment,
  });
  if (!child.stderr) throw new Error("MCP lifecycle child did not expose stderr.");
  return child;
}

async function waitForListeningMessage(child: ChildProcess): Promise<void> {
  const stderr = child.stderr;
  if (!stderr) throw new Error("MCP lifecycle child did not expose stderr.");
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => finish(new Error("MCP lifecycle child did not start HTTP mode.")), 10_000);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (output.includes("OpenPets MCP HTTP listening at http://127.0.0.1:")) finish();
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(new Error(`MCP lifecycle child exited before listening (code=${code}, signal=${signal}).`));
    };
    const onError = (error: Error): void => finish(error);
    const finish = (error?: Error): void => {
      clearTimeout(timeout);
      stderr.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    stderr.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error("MCP lifecycle child did not exit before the timeout."));
    }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      clearTimeout(timeout);
      resolve({ code, signal });
    };
    child.once("exit", onExit);
  });
}
