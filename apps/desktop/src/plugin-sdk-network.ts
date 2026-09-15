import { lookup as dnsLookup } from "node:dns/promises";
import * as net from "node:net";
import type { ConnectionOptions } from "node:tls";

import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit, type Response as UndiciResponse } from "undici";

import { classifyPluginError, logPluginDiagnostic } from "./plugin-diagnostics.js";

export type SimpleHttpResponse = { status: number; ok: boolean; headers: Record<string, string>; text: string; json?: unknown };
export type ValidatedNetOptions = { method: string; headers?: Record<string, string>; body?: string; timeoutMs?: number };
export type NetworkDiagnostics = { logger?: (level: "debug" | "info" | "warn" | "error", message: string, fields?: Record<string, unknown>) => void; pluginId?: string; route?: string };
export type NetworkReadLimits = { responseBytes: number; streamResponseBytes: number };

type ResolvedAddress = { address: string; family: 4 | 6 };
type LookupFunction = NonNullable<ConnectionOptions["lookup"]>;
type NetworkFetch = typeof undiciFetch;
type NetworkLookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<ReadonlyArray<{ address: string; family: number }>>;
type NetworkTimer = (callback: () => void, delayMs: number) => NodeJS.Timeout;
type NetworkAgentFactory = (url: URL, addresses: readonly ResolvedAddress[]) => Agent;

/** Test-only seams for the host-side network boundary. They are not part of the plugin SDK. */
export type PluginSdkNetworkTestHooks = {
  lookup?: NetworkLookup;
  fetch?: NetworkFetch;
  createAgent?: NetworkAgentFactory;
  setTimeout?: NetworkTimer;
  clearTimeout?: (timeout: NodeJS.Timeout) => void;
};

type NetworkTestHookLayer = { readonly hooks: PluginSdkNetworkTestHooks; active: boolean };
const networkTestHookLayers: NetworkTestHookLayer[] = [];

export function setPluginSdkNetworkTestHooks(hooks: PluginSdkNetworkTestHooks): () => void {
  const layer: NetworkTestHookLayer = { hooks, active: true };
  networkTestHookLayers.push(layer);
  return () => {
    if (!layer.active) return;
    layer.active = false;
    const index = networkTestHookLayers.indexOf(layer);
    if (index >= 0) networkTestHookLayers.splice(index, 1);
  };
}

function networkTestHook<K extends keyof PluginSdkNetworkTestHooks>(key: K): PluginSdkNetworkTestHooks[K] | undefined {
  for (let index = networkTestHookLayers.length - 1; index >= 0; index -= 1) {
    const layer = networkTestHookLayers[index];
    if (layer?.active && layer.hooks[key] !== undefined) return layer.hooks[key];
  }
  return undefined;
}

const forbiddenHeaderNames = new Set(["host", "cookie", "cookie2", "origin", "referer", "content-length", "connection", "transfer-encoding", "upgrade", "keep-alive", "te", "trailer", "expect", "via"]);

const UNCONDITIONALLY_BLOCKED_HOSTS = new Set([
  "169.254.169.254", "metadata.google.internal", "169.254.170.2", "fd00:ec2::254"
]);

const RESTRICTED_ADDRESS_ERROR = "Plugin HTTP host resolves to a restricted address.";

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function validateNetOptions(options: unknown, policy: { allowWrite: boolean; requestBodyBytes: number }): ValidatedNetOptions {
  const opts = isRecord(options) ? options : {};
  const method = String(opts.method ?? "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("Plugin HTTP method is not allowed.");
  if (method !== "GET" && !policy.allowWrite) throw new Error("Plugin permission is not approved: network:write");
  let body: string | undefined;
  if (opts.body !== undefined) {
    if (method === "GET") throw new Error("Plugin GET requests must not have a body.");
    body = String(opts.body);
    if (Buffer.byteLength(body) > policy.requestBodyBytes) throw new Error("Plugin HTTP request body is too large.");
  }
  return { method, headers: normalizeNetHeaders(opts.headers), body, timeoutMs: opts.timeoutMs === undefined ? undefined : Number(opts.timeoutMs) };
}

export function normalizeNetHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value).slice(0, 24)) {
    const lower = name.toLowerCase();
    if (!/^[a-z0-9-]{1,64}$/.test(lower) || forbiddenHeaderNames.has(lower) || lower.startsWith("proxy-") || lower.startsWith("sec-")) continue;
    if (typeof headerValue !== "string" || headerValue.length > 4096 || /[\r\n\0]/.test(headerValue)) continue;
    out[lower] = headerValue;
  }
  return out;
}

function isExplicitLocalHost(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || isExplicitLocalIp(host);
}

function normalizeHostname(host: string): string {
  const normalized = host.toLowerCase();
  return normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized;
}

function isApprovedNetworkHost(host: string, effectivePort: string, defaultPort: string, allowedHosts: ReadonlySet<string>): boolean {
  if (allowedHosts.has(`${host}:${effectivePort}`)) return true;
  // Bare hostname approval covers only the scheme default port — never an explicit non-default port.
  return effectivePort === defaultPort && allowedHosts.has(host);
}

function timeoutFor(opts: ValidatedNetOptions, stream: boolean): number {
  const fallback = stream ? 120_000 : 10_000;
  const requested = Number(opts.timeoutMs ?? fallback);
  return Math.min(Math.max(Number.isFinite(requested) ? requested : fallback, 1_000), 120_000);
}

function startTimeout(controller: AbortController, timeoutMs: number): NodeJS.Timeout {
  const timer = networkTestHook("setTimeout") ?? setTimeout;
  return timer(() => controller.abort(), timeoutMs);
}

function clearTimeoutHandle(timeout: NodeJS.Timeout): void {
  (networkTestHook("clearTimeout") ?? clearTimeout)(timeout);
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = () => finish(() => reject(abortError()));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });
}

async function resolveAddresses(host: string, signal: AbortSignal, localOnly = false): Promise<ResolvedAddress[]> {
  const lookup = networkTestHook("lookup") ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));
  let raw: ReadonlyArray<{ address: string; family: number }>;
  try {
    raw = await raceWithAbort(Promise.resolve().then(() => lookup(host, { all: true, verbatim: true })), signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(RESTRICTED_ADDRESS_ERROR);
  }
  if (!Array.isArray(raw)) throw new Error(RESTRICTED_ADDRESS_ERROR);
  const addresses = raw.map((entry): ResolvedAddress | null => {
    if (!isRecord(entry) || typeof entry.address !== "string") return null;
    const family = net.isIP(entry.address);
    return family === 4 || family === 6 ? { address: entry.address, family } : null;
  });
  if (addresses.length === 0 || addresses.some((address) => address === null || (localOnly ? !isExplicitLocalIp(address.address) || isMetadataAddress(address.address) : isPrivateIp(address.address)))) {
    throw new Error(RESTRICTED_ADDRESS_ERROR);
  }
  return addresses as ResolvedAddress[];
}

const PLUGIN_INACTIVE_ERROR = "Plugin is no longer active.";
const LIFECYCLE_CLEANUP_DEADLINE_MS = 1_000;

type RequestCancellation = {
  controller: AbortController;
  lifecycleCancelled: () => boolean;
  dispose: () => void;
};

function composeRequestCancellation(lifecycleSignal?: AbortSignal): RequestCancellation {
  const controller = new AbortController();
  let lifecycleCancelled = false;
  const onLifecycleAbort = () => {
    lifecycleCancelled = true;
    if (!controller.signal.aborted) controller.abort();
  };
  if (lifecycleSignal) {
    if (lifecycleSignal.aborted) onLifecycleAbort();
    else lifecycleSignal.addEventListener("abort", onLifecycleAbort, { once: true });
  }
  return {
    controller,
    lifecycleCancelled: () => lifecycleCancelled,
    dispose: () => lifecycleSignal?.removeEventListener("abort", onLifecycleAbort),
  };
}

async function prepareSafeRequest(urlText: string, opts: ValidatedNetOptions, allowedHosts: ReadonlySet<string>, allowLocal: boolean, controller: AbortController): Promise<{ url: URL; init: UndiciRequestInit; addresses: ResolvedAddress[] }> {
  const url = new URL(urlText);
  if (url.username || url.password) throw new Error("Plugin HTTP fetch credentials are not allowed.");
  const host = normalizeHostname(url.hostname);

  if (UNCONDITIONALLY_BLOCKED_HOSTS.has(host) || isMetadataAddress(host)) {
    throw new Error("Plugin HTTP host is unconditionally blocked (metadata service).");
  }

  const localTarget = isExplicitLocalHost(host);
  if (localTarget) {
    if (!allowLocal) throw new Error("Plugin HTTP fetch requires HTTPS (or HTTP with network:local).");
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Plugin HTTP fetch requires HTTPS (or HTTP with network:local).");
  } else if (url.protocol !== "https:") {
    throw new Error("Plugin HTTP fetch requires HTTPS (or HTTP with network:local).");
  }

  const defaultPort = url.protocol === "https:" ? "443" : "80";
  const effectivePort = url.port || defaultPort;
  if (!isApprovedNetworkHost(host, effectivePort, defaultPort, allowedHosts)) {
    throw new Error("Plugin HTTP host is not approved.");
  }

  let addresses: ResolvedAddress[];
  if (host === "localhost" || host.endsWith(".localhost")) {
    // Keep the URL hostname for Host/TLS identity, but never ask the socket to resolve it.
    addresses = networkTestHook("lookup") ? await resolveAddresses(host, controller.signal, true) : [{ address: "127.0.0.1", family: 4 }];
  } else if (net.isIP(host) === 4) {
    if (isPrivateIp(host) && !localTarget) throw new Error(RESTRICTED_ADDRESS_ERROR);
    addresses = [{ address: host, family: 4 }];
  } else if (net.isIP(host) === 6) {
    if (isPrivateIp(host) && !localTarget) throw new Error(RESTRICTED_ADDRESS_ERROR);
    addresses = [{ address: host, family: 6 }];
  } else if (localTarget) {
    throw new Error(RESTRICTED_ADDRESS_ERROR);
  } else {
    addresses = await resolveAddresses(host, controller.signal);
  }

  const init: UndiciRequestInit = {
    method: opts.method,
    redirect: "manual",
    credentials: "omit",
    signal: controller.signal,
    headers: opts.headers ?? {},
    ...(opts.body === undefined ? {} : { body: opts.body }),
  };
  return { url, init, addresses };
}

function createGuardedAgent(url: URL, addresses: readonly ResolvedAddress[]): Agent {
  let nextAddress = 0;
  const lookup: LookupFunction = (hostname, options, callback) => {
    if (normalizeHostname(hostname) !== normalizeHostname(url.hostname) || addresses.length === 0) {
      const error = new Error(RESTRICTED_ADDRESS_ERROR) as NodeJS.ErrnoException;
      error.code = "EAI_AGAIN";
      callback(error, "", 0);
      return;
    }
    if (options.all) {
      callback(null, addresses.map((address) => ({ address: address.address, family: address.family })));
      return;
    }
    const address = addresses[nextAddress++ % addresses.length]!;
    callback(null, address.address, address.family);
  };
  return new Agent({ connect: { lookup }, connections: 1, pipelining: 1 });
}

async function awaitBoundedCleanup(cleanup: Promise<unknown>): Promise<void> {
  // Keep this rejection handler attached after the deadline as well. An agent
  // can reject long after teardown has moved on, and that must not become an
  // unhandled rejection.
  const settled = cleanup.then(() => undefined, () => undefined);
  let deadline: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    deadline = (networkTestHook("setTimeout") ?? setTimeout)(resolve, LIFECYCLE_CLEANUP_DEADLINE_MS);
  });
  await Promise.race([settled, timeout]);
  if (deadline) clearTimeoutHandle(deadline);
}

async function destroyAgentWithDeadline(agent: Agent): Promise<void> {
  let cleanup: Promise<unknown>;
  try {
    cleanup = Promise.resolve(agent.destroy());
  } catch {
    return;
  }
  await awaitBoundedCleanup(cleanup);
}

async function disposeAgent(agent: Agent | undefined, completed: boolean, signal: AbortSignal, lifecycleCancelled: () => boolean): Promise<void> {
  if (!agent) return;
  let cleanup: Promise<unknown>;
  const cancelledBeforeCleanup = lifecycleCancelled();
  try {
    cleanup = Promise.resolve(cancelledBeforeCleanup || !completed ? agent.destroy() : agent.close());
  } catch {
    // The request's original error is more useful than a cleanup error.
    return;
  }
  if (cancelledBeforeCleanup) {
    // Lifecycle cancellation has already aborted the request signal. Do not use
    // that signal to race cleanup: plugin teardown must drain the agent, but
    // must also remain bounded if the agent never settles.
    await awaitBoundedCleanup(cleanup);
    return;
  }
  try {
    await raceWithAbort(cleanup, signal);
  }
  catch {
    // The request's original error is more useful than a cleanup error.
    if (completed) {
      if (lifecycleCancelled()) await destroyAgentWithDeadline(agent);
      else {
        try { void Promise.resolve(agent.destroy()).catch(() => undefined); } catch { /* cleanup is best effort */ }
      }
    } else if (lifecycleCancelled()) {
      // The initial destroy is already in flight; wait for it without the
      // request signal, but retain the bounded teardown guarantee.
      await awaitBoundedCleanup(cleanup);
    }
  }
}

type NetworkDiagnosticsFields = { diagnostics?: NetworkDiagnostics; route: string; method: string; host: string; started: number; dispatchStarted: boolean };

function logNetworkFailure(fields: NetworkDiagnosticsFields, error: unknown, lifecycleCancelled: boolean): Error {
  const mapped = lifecycleCancelled
    ? new Error(PLUGIN_INACTIVE_ERROR)
    : isRestrictedLookupError(error)
    ? new Error(RESTRICTED_ADDRESS_ERROR)
    : error instanceof Error && error.name === "AbortError"
      ? new Error(`Plugin HTTP ${fields.route === "net.stream" ? "stream" : "fetch"} timed out.`)
      : error;
  logPluginDiagnostic(fields.diagnostics?.logger, "warn", "plugin network request", { pluginId: fields.diagnostics?.pluginId, route: fields.diagnostics?.route ?? fields.route, method: fields.method, host: fields.host, phase: lifecycleCancelled ? "cancel" : fields.dispatchStarted ? "fail" : "denied", reason: mapped instanceof Error ? mapped.message : String(mapped), errorCode: classifyPluginError(mapped), durationMs: Date.now() - fields.started });
  return mapped instanceof Error ? mapped : new Error(String(mapped));
}

function isRestrictedLookupError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current.message === RESTRICTED_ADDRESS_ERROR || (current as NodeJS.ErrnoException).code === "EAI_AGAIN") return true;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return false;
}

function requestFetch(): NetworkFetch {
  const fetch = networkTestHook("fetch");
  if (fetch) return fetch;
  return undiciFetch;
}

export async function safeHttpFetch(urlText: string, options: ValidatedNetOptions | unknown, allowedHosts: ReadonlySet<string>, allowLocal = false, diagnostics: NetworkDiagnostics | undefined, limits: NetworkReadLimits, lifecycleSignal?: AbortSignal): Promise<SimpleHttpResponse> {
  const opts: ValidatedNetOptions = isValidatedNetOptions(options) ? options : { method: "GET", headers: undefined, timeoutMs: undefined };
  const started = Date.now();
  const cancellation = composeRequestCancellation(lifecycleSignal);
  const controller = cancellation.controller;
  const timeout = startTimeout(controller, timeoutFor(opts, false));
  let host = "";
  try { host = new URL(urlText).hostname.toLowerCase(); } catch { host = "invalid"; }
  const logFields = { diagnostics, route: "net.fetch", method: opts.method, host, started, dispatchStarted: false };
  let agent: Agent | undefined;
  let completed = false;
  try {
    logPluginDiagnostic(diagnostics?.logger, "debug", "plugin network request", { pluginId: diagnostics?.pluginId, route: diagnostics?.route ?? "net.fetch", method: opts.method, host, phase: "begin" });
    const prepared = await prepareSafeRequest(urlText, opts, allowedHosts, allowLocal, controller);
    throwIfAborted(controller.signal);
    agent = (networkTestHook("createAgent") ?? createGuardedAgent)(prepared.url, prepared.addresses);
    logFields.dispatchStarted = true;
    const response = await raceWithAbort(requestFetch()(prepared.url, { ...prepared.init, dispatcher: agent }), controller.signal);
    throwIfAborted(controller.signal);
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      await cancelResponse(response);
      throw new Error("Plugin HTTP redirects are not allowed.");
    }
    const text = await readCapped(response, limits.responseBytes, controller.signal);
    const headers: Record<string, string> = {};
    for (const key of ["content-type", "etag", "last-modified", "retry-after", "x-ratelimit-remaining"]) { const value = response.headers.get(key); if (value) headers[key] = value; }
    let json: unknown;
    if ((headers["content-type"] ?? "").includes("application/json")) { try { json = JSON.parse(text); } catch { json = undefined; } }
    throwIfAborted(controller.signal);
    logPluginDiagnostic(diagnostics?.logger, "debug", "plugin network request", { pluginId: diagnostics?.pluginId, route: diagnostics?.route ?? "net.fetch", method: opts.method, host: prepared.url.hostname, phase: "success", status: response.status, sizeBytes: Buffer.byteLength(text), durationMs: Date.now() - started });
    completed = true;
    return { status: response.status, ok: response.ok, headers, text, ...(json === undefined ? {} : { json }) };
  } catch (error) {
    throw logNetworkFailure(logFields, error, cancellation.lifecycleCancelled());
  } finally {
    await disposeAgent(agent, completed, controller.signal, cancellation.lifecycleCancelled);
    cancellation.dispose();
    clearTimeoutHandle(timeout);
  }
}

export async function safeHttpStream(urlText: string, opts: ValidatedNetOptions, allowedHosts: ReadonlySet<string>, onChunk: (chunk: string) => unknown, allowLocal = false, diagnostics: NetworkDiagnostics | undefined, limits: NetworkReadLimits, lifecycleSignal?: AbortSignal): Promise<{ status: number; ok: boolean }> {
  const started = Date.now();
  const cancellation = composeRequestCancellation(lifecycleSignal);
  const controller = cancellation.controller;
  const timeout = startTimeout(controller, timeoutFor(opts, true));
  let host = "";
  try { host = new URL(urlText).hostname.toLowerCase(); } catch { host = "invalid"; }
  const logFields = { diagnostics, route: "net.stream", method: opts.method, host, started, dispatchStarted: false };
  let agent: Agent | undefined;
  let completed = false;
  try {
    logPluginDiagnostic(diagnostics?.logger, "debug", "plugin network request", { pluginId: diagnostics?.pluginId, route: diagnostics?.route ?? "net.stream", method: opts.method, host, phase: "begin" });
    const prepared = await prepareSafeRequest(urlText, { ...opts, timeoutMs: opts.timeoutMs ?? 120_000 }, allowedHosts, allowLocal, controller);
    throwIfAborted(controller.signal);
    agent = (networkTestHook("createAgent") ?? createGuardedAgent)(prepared.url, prepared.addresses);
    logFields.dispatchStarted = true;
    const response = await raceWithAbort(requestFetch()(prepared.url, { ...prepared.init, dispatcher: agent }), controller.signal);
    throwIfAborted(controller.signal);
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      await cancelResponse(response);
      throw new Error("Plugin HTTP redirects are not allowed.");
    }
    await streamResponse(response, limits.streamResponseBytes, onChunk, controller.signal);
    throwIfAborted(controller.signal);
    logPluginDiagnostic(diagnostics?.logger, "debug", "plugin network request", { pluginId: diagnostics?.pluginId, route: diagnostics?.route ?? "net.stream", method: opts.method, host: prepared.url.hostname, phase: "success", status: response.status, durationMs: Date.now() - started });
    completed = true;
    return { status: response.status, ok: response.ok };
  } catch (error) {
    throw logNetworkFailure(logFields, error, cancellation.lifecycleCancelled());
  } finally {
    await disposeAgent(agent, completed, controller.signal, cancellation.lifecycleCancelled);
    cancellation.dispose();
    clearTimeoutHandle(timeout);
  }
}

function isValidatedNetOptions(value: unknown): value is ValidatedNetOptions { return isRecord(value) && typeof value.method === "string"; }

async function cancelResponse(response: UndiciResponse): Promise<void> {
  try { void Promise.resolve(response.body?.cancel()).catch(() => undefined); } catch { /* cleanup is best effort */ }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try { void Promise.resolve(reader.cancel()).catch(() => undefined); } catch { /* cleanup is best effort */ }
}

async function readCapped(response: UndiciResponse, cap: number, signal: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await raceWithAbort(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        cancelReader(reader);
        throw new Error("Plugin HTTP response is too large.");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (error) {
    cancelReader(reader);
    throw error;
  }
}

async function streamResponse(response: UndiciResponse, cap: number, onChunk: (chunk: string) => unknown, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const reader = response.body?.getReader();
  if (!reader) return;
  try {
    const decoder = new TextDecoder();
    let total = 0;
    for (;;) {
      const { done, value } = await raceWithAbort(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        cancelReader(reader);
        throw new Error("Plugin HTTP stream is too large.");
      }
      const chunk = decoder.decode(value, { stream: true });
      if (chunk.length > 0) await raceWithAbort(Promise.resolve().then(() => onChunk(chunk)), signal);
    }
    const tail = decoder.decode();
    if (tail.length > 0) await raceWithAbort(Promise.resolve().then(() => onChunk(tail)), signal);
  } catch (error) {
    cancelReader(reader);
    throw error;
  }
}

export async function assertPublicHost(host: string): Promise<void> {
  const normalizedHost = normalizeHostname(host);
  if (["localhost", "metadata.google.internal"].includes(normalizedHost) || normalizedHost.endsWith(".localhost")) throw new Error("Plugin HTTP host is not public.");
  if (net.isIP(normalizedHost) === 4) {
    if (isPrivateIp(normalizedHost)) throw new Error(RESTRICTED_ADDRESS_ERROR);
    return;
  }
  const controller = new AbortController();
  await resolveAddresses(normalizedHost, controller.signal);
}

function parseIpv6(address: string): Uint8Array | null {
  if (net.isIP(address) !== 6) return null;
  const value = address.toLowerCase();
  const [leftText, rightText, ...extra] = value.split("::");
  if (extra.length > 0) return null;
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  const expand = (parts: string[]): number[] => {
    const values: number[] = [];
    for (const [index, part] of parts.entries()) {
      if (net.isIP(part) === 4) {
        if (index !== parts.length - 1) return [];
        const octets = part.split(".").map(Number);
        if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return [];
        values.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return [];
      values.push(Number.parseInt(part, 16));
    }
    return values;
  };
  const leftValues = expand(left);
  const rightValues = expand(right);
  if ((leftValues.length === 0 && left.length > 0) || (rightValues.length === 0 && right.length > 0)) return null;
  const compressed = value.includes("::");
  if (leftValues.length + rightValues.length > 8 || (!compressed && leftValues.length + rightValues.length !== 8) || (compressed && leftValues.length + rightValues.length === 8)) return null;
  const groups = compressed ? [...leftValues, ...Array(8 - leftValues.length - rightValues.length).fill(0), ...rightValues] : [...leftValues, ...rightValues];
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => { bytes[index * 2] = group >> 8; bytes[index * 2 + 1] = group & 0xff; });
  return bytes;
}

function hasIpv6Prefix(bytes: Uint8Array, prefix: readonly number[], prefixBits: number): boolean {
  const wholeBytes = Math.floor(prefixBits / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  const remainingBits = prefixBits % 8;
  return remainingBits === 0 || (bytes[wholeBytes]! >> (8 - remainingBits)) === (prefix[wholeBytes]! >> (8 - remainingBits));
}

const IPV6_SPECIAL_USE_PREFIXES: ReadonlyArray<{ prefix: readonly number[]; bits: number }> = [
  { prefix: [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], bits: 64 }, // Discard-only prefix: 100::/64.
  { prefix: [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01], bits: 64 }, // Dummy prefix: 100:0:0:1::/64.
  { prefix: [0x20, 0x01, 0x00, 0x00], bits: 32 }, // Teredo: 2001::/32.
  { prefix: [0x20, 0x01, 0x00, 0x02, 0x00, 0x00], bits: 48 }, // Benchmarking: 2001:2::/48.
  { prefix: [0x20, 0x01, 0x00, 0x30], bits: 28 }, // Drone Remote ID Protocol Entity Tags (DETs) Prefix: 2001:30::/28.
  { prefix: [0x20, 0x01, 0x0d, 0xb8], bits: 32 }, // Documentation: 2001:db8::/32.
  { prefix: [0x20, 0x02], bits: 16 }, // 6to4: 2002::/16.
  { prefix: [0x3f, 0xff, 0x00], bits: 20 }, // Documentation: 3fff::/20.
  { prefix: [0x5f, 0x00], bits: 16 }, // SRv6 SID: 5f00::/16.
  { prefix: [0x20, 0x01, 0x00, 0x10], bits: 28 }, // ORCHID: 2001:10::/28.
  { prefix: [0x20, 0x01, 0x00, 0x20], bits: 28 }, // ORCHIDv2: 2001:20::/28.
];

const IPV6_PUBLIC_DESTINATION_EXCEPTIONS: ReadonlyArray<{ prefix: readonly number[]; bits: number }> = [
  { prefix: [0x20, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01], bits: 128 }, // IANA: 2001:1::1.
  { prefix: [0x20, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02], bits: 128 }, // IANA: 2001:1::2.
  { prefix: [0x20, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03], bits: 128 }, // IANA: 2001:1::3.
  { prefix: [0x20, 0x01, 0x00, 0x03], bits: 32 }, // IANA: 2001:3::/32.
  { prefix: [0x20, 0x01, 0x00, 0x04, 0x01, 0x12], bits: 48 }, // IANA: 2001:4:112::/48.
  { prefix: [0x20, 0x01, 0x00, 0x20], bits: 28 }, // IANA: 2001:20::/28.
  { prefix: [0x20, 0x01, 0x00, 0x30], bits: 28 }, // Drone Remote ID Protocol Entity Tags (DETs) Prefix: 2001:30::/28.
];

const IPV6_RESTRICTED_PARENT_PREFIX = { prefix: [0x20, 0x01, 0x00, 0x00], bits: 23 } as const; // IANA special-purpose parent: 2001::/23.

function isBlockedIpv4(address: string): boolean {
  if (net.isIP(address) !== 4) return false;
  const parts = address.split(".").map(Number);
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 168 || (second === 0 && ((parts[2] === 0 && parts[3] !== 9 && parts[3] !== 10) || parts[2] === 2)) || (second === 88 && parts[2] === 99))) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && parts[2] === 100))) ||
    (first === 203 && second === 0 && parts[2] === 113) ||
    first >= 224;
}

export function isExplicitLocalIp(address: string): boolean {
  if (net.isIP(address) === 4) return isExplicitLocalIpv4(address);
  const bytes = parseIpv6(address);
  if (!bytes) return false;
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const uniqueLocal = (bytes[0]! & 0xfe) === 0xfc;
  const linkLocal = bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80;
  const mappedIpv4 = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (!mappedIpv4) return loopback || uniqueLocal || linkLocal;
  return isExplicitLocalIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
}

function isExplicitLocalIpv4(address: string): boolean {
  if (net.isIP(address) !== 4) return false;
  const parts = address.split(".").map(Number);
  const [first, second] = parts;
  return first === 10 || first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127);
}

function isMetadataAddress(address: string): boolean {
  if (UNCONDITIONALLY_BLOCKED_HOSTS.has(address)) return true;
  const bytes = parseIpv6(address);
  if (!bytes) return false;
  const mappedIpv4 = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (!mappedIpv4) return false;
  return UNCONDITIONALLY_BLOCKED_HOSTS.has(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
}

export function isPrivateIp(address: string): boolean {
  if (net.isIP(address) === 4) return isBlockedIpv4(address);
  const bytes = parseIpv6(address);
  if (!bytes) return false;
  const unspecified = bytes.every((byte) => byte === 0);
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const uniqueLocal = (bytes[0]! & 0xfe) === 0xfc;
  const linkLocal = bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80;
  const deprecatedSiteLocal = bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0;
  const multicast = bytes[0] === 0xff;
  const mappedIpv4 = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const nat64WellKnown = bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((byte) => byte === 0);
  const nat64NetworkSpecific = bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes[4] === 0x00 && bytes[5] === 0x01;
  const publicDestinationException = IPV6_PUBLIC_DESTINATION_EXCEPTIONS.some(({ prefix, bits }) => hasIpv6Prefix(bytes, prefix, bits));
  if (publicDestinationException) return false;
  const specialUse = IPV6_SPECIAL_USE_PREFIXES.some(({ prefix, bits }) => hasIpv6Prefix(bytes, prefix, bits));
  if (!mappedIpv4) return unspecified || loopback || uniqueLocal || linkLocal || deprecatedSiteLocal || multicast || nat64NetworkSpecific || specialUse || hasIpv6Prefix(bytes, IPV6_RESTRICTED_PARENT_PREFIX.prefix, IPV6_RESTRICTED_PARENT_PREFIX.bits) || (nat64WellKnown && isBlockedIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`));
  const mapped = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
  return isBlockedIpv4(mapped);
}
