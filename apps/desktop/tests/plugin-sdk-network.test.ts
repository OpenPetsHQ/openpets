import assert from "node:assert/strict";
import { createServer } from "node:http";

import { Agent, fetch as undiciFetch, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import {
  assertPublicHost,
  isExplicitLocalIp,
  isPrivateIp,
  safeHttpFetch,
  safeHttpStream,
  setPluginSdkNetworkTestHooks,
} from "../src/plugin-sdk-network.js";

const limits = { responseBytes: 32, streamResponseBytes: 32 };

function response(value: string, init?: ResponseInit): Awaited<ReturnType<typeof undiciFetch>> {
  return new Response(value, init) as unknown as Awaited<ReturnType<typeof undiciFetch>>;
}

await test("a mixed DNS answer set is denied before dispatch", async () => {
  let dispatched = false;
  const restore = setPluginSdkNetworkTestHooks({
    lookup: async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
    fetch: (async () => { dispatched = true; return response("unexpected"); }) as typeof undiciFetch,
  });
  try {
    await assert.rejects(
      () => safeHttpFetch("https://rebind.example/", { method: "GET" }, new Set(["rebind.example"]), false, undefined, limits),
      (error: unknown) => error instanceof Error && error.message === "Plugin HTTP host resolves to a restricted address.",
    );
    assert.equal(dispatched, false);
  } finally {
    restore();
  }
});

await test("the guarded dispatcher keeps the original hostname and vetted records", async () => {
  let seenUrl = "";
  let seenDispatcher: unknown;
  let seenAddresses: readonly { address: string; family: 4 | 6 }[] = [];
  const restore = setPluginSdkNetworkTestHooks({
    lookup: async () => [{ address: "8.8.8.8", family: 4 }, { address: "2001:4860:4860::8888", family: 6 }],
    createAgent: (_url, addresses) => { seenAddresses = addresses; return new Agent(); },
    fetch: (async (input, init) => {
      seenUrl = String(input);
      seenDispatcher = init?.dispatcher;
      return response("ok");
    }) as typeof undiciFetch,
  });
  try {
    const result = await safeHttpFetch("https://public.example/path?q=1", { method: "GET" }, new Set(["public.example"]), false, undefined, limits);
    assert.equal(result.text, "ok");
    assert.equal(seenUrl, "https://public.example/path?q=1");
    assert.ok(seenDispatcher instanceof Agent);
    assert.deepEqual(seenAddresses, [
      { address: "8.8.8.8", family: 4 },
      { address: "2001:4860:4860::8888", family: 6 },
    ]);
  } finally {
    restore();
  }
});

await test("DNS and all guarded lookup failures use the restricted-address outcome", async () => {
  for (const lookup of [
    async () => [],
    async () => [{ address: "not-an-ip", family: 4 }],
    async () => { throw new Error("resolver failed"); },
  ]) {
    const restore = setPluginSdkNetworkTestHooks({ lookup });
    try {
      await assert.rejects(
        () => assertPublicHost("failure.example"),
        (error: unknown) => error instanceof Error && error.message === "Plugin HTTP host resolves to a restricted address.",
      );
    } finally {
      restore();
    }
  }
});

await test("a resolver that never settles is covered by the request deadline", async () => {
  let fireTimeout!: () => void;
  let fetchCalled = false;
  const timer = {} as NodeJS.Timeout;
  const restore = setPluginSdkNetworkTestHooks({
    lookup: async () => new Promise<never>(() => undefined),
    setTimeout: (callback) => { fireTimeout = callback; return timer; },
    clearTimeout: () => undefined,
    fetch: (async () => { fetchCalled = true; return response("unexpected"); }) as typeof undiciFetch,
  });
  try {
    const pending = safeHttpFetch("https://hang.example/", { method: "GET" }, new Set(["hang.example"]), false, undefined, limits);
    assert.equal(typeof fireTimeout, "function");
    fireTimeout();
    await assert.rejects(pending, /Plugin HTTP fetch timed out\./);
    assert.equal(fetchCalled, false);
  } finally {
    restore();
  }
});

await test("lifecycle cancellation settles stalled DNS immediately and logs once", async () => {
  const lifecycle = new AbortController();
  const warnings: Array<Record<string, unknown> | undefined> = [];
  const restore = setPluginSdkNetworkTestHooks({ lookup: async () => new Promise<never>(() => undefined) });
  try {
    const pending = safeHttpFetch("https://lifecycle-dns.example/", { method: "GET" }, new Set(["lifecycle-dns.example"]), false, {
      pluginId: "plug",
      logger: (level, _message, fields) => { if (level === "warn") warnings.push(fields); },
    }, limits, lifecycle.signal);
    lifecycle.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof Error && error.message === "Plugin is no longer active.");
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.phase, "cancel");
    assert.equal(warnings[0]?.reason, "Plugin is no longer active.");
  } finally {
    restore();
  }
});

await test("lifecycle cancellation waits for agent destruction before settling", async () => {
  let fetchStarted!: () => void;
  let destroyStarted!: () => void;
  let releaseDestroy!: () => void;
  const fetchStartedPromise = new Promise<void>((resolve) => { fetchStarted = resolve; });
  const destroyStartedPromise = new Promise<void>((resolve) => { destroyStarted = resolve; });
  const destroyPromise = new Promise<void>((resolve) => { releaseDestroy = resolve; });
  const agent = new Agent();
  Object.defineProperty(agent, "destroy", { configurable: true, value: () => { destroyStarted(); return destroyPromise; } });
  const restore = setPluginSdkNetworkTestHooks({
    createAgent: () => agent,
    fetch: async () => {
      fetchStarted();
      return new Promise<never>(() => undefined);
    },
  });
  const lifecycle = new AbortController();
  try {
    const pending = safeHttpFetch("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), false, undefined, limits, lifecycle.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await fetchStartedPromise;
    lifecycle.abort();
    await destroyStartedPromise;
    let settled = false;
    void pending.finally(() => { settled = true; }).catch(() => undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    releaseDestroy();
    await assert.rejects(pending, /Plugin is no longer active\./);
    assert.equal(settled, true);
  } finally {
    restore();
    void agent.destroy();
  }
});

await test("lifecycle agent cleanup is bounded and late rejection stays handled", async () => {
  let destroyStarted!: () => void;
  let rejectDestroy!: (error: Error) => void;
  const destroyStartedPromise = new Promise<void>((resolve) => { destroyStarted = resolve; });
  const destroyPromise = new Promise<void>((_resolve, reject) => { rejectDestroy = reject; });
  const agent = new Agent();
  Object.defineProperty(agent, "destroy", { configurable: true, value: () => { destroyStarted(); return destroyPromise; } });
  const timers: Array<{ callback: () => void; delayMs: number; timer: NodeJS.Timeout }> = [];
  const restore = setPluginSdkNetworkTestHooks({
    createAgent: () => agent,
    fetch: async () => new Promise<never>(() => undefined),
    setTimeout: (callback, delayMs) => {
      const timer = {} as NodeJS.Timeout;
      timers.push({ callback, delayMs, timer });
      return timer;
    },
    clearTimeout: () => undefined,
  });
  const lifecycle = new AbortController();
  let unhandled = false;
  const onUnhandled = () => { unhandled = true; };
  process.on("unhandledRejection", onUnhandled);
  try {
    const pending = safeHttpFetch("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), false, undefined, limits, lifecycle.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    lifecycle.abort();
    await destroyStartedPromise;
    assert.deepEqual(timers.map(({ delayMs }) => delayMs), [10_000, 1_000]);
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    const cleanupTimer = timers.find(({ delayMs }) => delayMs === 1_000);
    assert.ok(cleanupTimer);
    cleanupTimer.callback();
    await assert.rejects(pending, /Plugin is no longer active\./);
    rejectDestroy(new Error("late destroy rejection"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(unhandled, false);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    restore();
  }
});

await test("network diagnostics distinguish denied preparation from dispatch failures", async () => {
  const phases: string[] = [];
  const diagnostics = { logger: (_level: "debug" | "info" | "warn" | "error", _message: string, fields?: Record<string, unknown>) => { if (fields?.phase) phases.push(String(fields.phase)); } };
  let restore = setPluginSdkNetworkTestHooks({});
  try {
    await assert.rejects(() => safeHttpFetch("https://1.1.1.1/", { method: "GET" }, new Set(), false, diagnostics, limits), /host is not approved/);
    assert.deepEqual(phases, ["begin", "denied"]);
  } finally {
    restore();
  }

  phases.length = 0;
  restore = setPluginSdkNetworkTestHooks({ fetch: async () => { throw new Error("dispatch failed"); } });
  try {
    await assert.rejects(() => safeHttpFetch("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), false, diagnostics, limits), /dispatch failed/);
    assert.deepEqual(phases, ["begin", "fail"]);
  } finally {
    restore();
  }
});

await test("a throwing begin logger cannot leak the request timer", async () => {
  const timer = {} as NodeJS.Timeout;
  let cleared = false;
  const restore = setPluginSdkNetworkTestHooks({ setTimeout: () => timer, clearTimeout: (value) => { assert.equal(value, timer); cleared = true; } });
  try {
    await assert.rejects(
      () => safeHttpFetch("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), false, { logger: () => { throw new Error("logger failed"); } }, limits),
      /logger failed/,
    );
    assert.equal(cleared, true);
  } finally {
    restore();
  }
});

await test("nested network test hooks restore independently in non-LIFO order", async () => {
  const baseline = setPluginSdkNetworkTestHooks({ fetch: async () => { throw new Error("baseline fetch"); } });
  const outer = setPluginSdkNetworkTestHooks({ fetch: async () => response("stale outer fetch") });
  const inner = setPluginSdkNetworkTestHooks({ fetch: async () => response("active inner fetch") });
  try {
    outer();
    const active = await safeHttpFetch("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), false, undefined, limits);
    assert.equal(active.text, "active inner fetch");

    inner();
    await assert.rejects(
      () => safeHttpFetch("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), false, undefined, limits),
      /baseline fetch/,
    );
  } finally {
    inner();
    outer();
    baseline();
  }
});

await test("request deadline remains active while agent cleanup is stalled", async () => {
  let fireTimeout!: () => void;
  let cleanupStarted!: () => void;
  const cleanupStartedPromise = new Promise<void>((resolve) => { cleanupStarted = resolve; });
  const timer = {} as NodeJS.Timeout;
  let cleared = false;
  const stalledAgent = new Agent();
  Object.defineProperty(stalledAgent, "close", {
    configurable: true,
    value: async () => {
      cleanupStarted();
      await new Promise<void>(() => undefined);
    },
  });
  const restore = setPluginSdkNetworkTestHooks({
    setTimeout: (callback) => { fireTimeout = callback; return timer; },
    clearTimeout: (value) => { assert.equal(value, timer); cleared = true; },
    createAgent: () => stalledAgent,
    fetch: async () => response("ok"),
  });
  try {
    const pending = safeHttpFetch("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), false, undefined, limits);
    await cleanupStartedPromise;
    assert.equal(cleared, false);
    fireTimeout();
    assert.deepEqual(await pending, { status: 200, ok: true, headers: { "content-type": "text/plain;charset=UTF-8" }, text: "ok" });
    assert.equal(cleared, true);
  } finally {
    restore();
    void stalledAgent.destroy();
  }
});

await test("IPv4, IPv6, and mapped IPv4 restricted ranges are classified exactly", () => {
  for (const address of [
    "0.0.0.0", "0.255.255.255", "10.1.2.3", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.0.0.0", "192.0.0.255", "192.0.2.0", "192.0.2.255", "192.88.99.0", "192.88.99.255", "192.168.1.1", "198.18.0.0", "198.19.255.255", "198.51.100.0", "198.51.100.255", "203.0.113.0", "203.0.113.255", "224.0.0.0", "239.255.255.255", "240.0.0.0", "255.255.255.255", "100.64.0.1",
    "::", "::1", "fc00::1", "fd12::1", "fe80::1", "febf::1", "fec0::1", "feff::1", "ff02::1",
    "100::", "100::ffff:ffff:ffff:ffff", "100:0:0:1::", "100:0:0:1:ffff:ffff:ffff:ffff", "2001::", "2001:0:ffff:ffff:ffff:ffff:ffff:ffff", "2001:1::", "2001:2::", "2001:2:0:ffff:ffff:ffff:ffff:ffff", "2001:4::", "2001:10::", "2001:1f:ffff:ffff:ffff:ffff:ffff:ffff", "2001:40::", "2001:db8::", "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff", "2002::", "2002:a9fe:a9fe::", "2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "3fff::", "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff", "5f00::", "5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "64:ff9b::", "64:ff9b::ffff:ffff", "64:ff9b::a9fe:a9fe", "64:ff9b:1::", "64:ff9b:1::ffff:ffff", "::ffff:10.0.0.1", "0:0:0:0:0:ffff:192.168.1.1", "::ffff:ac10:0001", "::ffff:192.0.2.1",
  ]) assert.equal(isPrivateIp(address), true, `${address} is restricted`);

  for (const address of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.0.1.0", "192.31.195.255", "192.31.196.0", "192.31.196.255", "192.31.197.0", "192.52.192.255", "192.52.193.0", "192.52.193.255", "192.52.194.0", "192.88.98.255", "192.88.100.0", "192.175.47.255", "192.175.48.0", "192.175.48.255", "192.175.49.0", "198.20.0.0", "100.128.0.1", "100:0:0:2::", "100:1::", "2001:2fff:ffff:ffff:ffff:ffff:ffff:ffff", "2001:4000::", "2001:db9::", "3fff:1000::", "2001:4860:4860::8888", "2001:4860:4860::a9fe:a9fe", "2003:a9fe:a9fe::", "64:ff9a:ffff:ffff:ffff:ffff:ffff:ffff", "64:ff9b::808:808", "64:ff9b:0:1::1", "64:ff9b:0:ffff:ffff:ffff:ffff:ffff", "64:ff9b:2::1", "2606:4700::1111"]) {
    assert.equal(isPrivateIp(address), false, `${address} is not restricted`);
  }
  for (const [address, restricted] of [
    ["192.0.0.0", true], ["192.0.0.8", true], ["192.0.0.9", false], ["192.0.0.10", false], ["192.0.0.11", true], ["192.0.0.170", true], ["192.0.0.171", true], ["192.0.0.254", true], ["192.0.0.255", true],
  ] as const) assert.equal(isPrivateIp(address), restricted, `${address} classification`);
  for (const [address, restricted] of [
    ["::ffff:192.0.0.8", true], ["::ffff:192.0.0.9", false], ["::ffff:192.0.0.10", false], ["::ffff:192.0.0.11", true], ["::ffff:192.0.0.170", true], ["::ffff:192.0.0.171", true],
    ["64:ff9b::c000:0008", true], ["64:ff9b::c000:0009", false], ["64:ff9b::c000:000a", false], ["64:ff9b::c000:000b", true], ["64:ff9b::c000:00aa", true], ["64:ff9b::c000:00ab", true],
  ] as const) assert.equal(isPrivateIp(address), restricted, `${address} classification`);
  for (const [address, restricted] of [
    ["2001:1::", true], ["2001:1::1", false], ["2001:1::2", false], ["2001:1::3", false], ["2001:1::4", true],
    ["2001:2:ffff:ffff:ffff:ffff:ffff:ffff", true], ["2001:3::", false], ["2001:3:ffff:ffff:ffff:ffff:ffff:ffff", false], ["2001:4::", true],
    ["2001:4:111:ffff:ffff:ffff:ffff:ffff", true], ["2001:4:112::", false], ["2001:4:112:ffff:ffff:ffff:ffff:ffff", false], ["2001:4:113::", true],
    ["2001:1f:ffff:ffff:ffff:ffff:ffff:ffff", true], ["2001:20::", false], ["2001:2f:ffff:ffff:ffff:ffff:ffff:ffff", false], ["2001:30::", false],
    ["2001:3f:ffff:ffff:ffff:ffff:ffff:ffff", false], ["2001:40::", true],
    ["2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff", true], ["2001:200::", false],
  ] as const) assert.equal(isPrivateIp(address), restricted, `${address} classification`);
  assert.equal(isPrivateIp("not-an-ip"), false);
});

await test("network:local uses only explicit local endpoint ranges", async () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:192.168.1.1"]) {
    assert.equal(isExplicitLocalIp(address), true, `${address} is explicitly local`);
  }
  for (const address of ["192.0.0.8", "192.0.2.1", "0.0.0.0", "224.0.0.1", "::ffff:192.0.0.8", "64:ff9b::c000:0008", "2001:db8::1"]) {
    assert.equal(isExplicitLocalIp(address), false, `${address} is not explicitly local`);
  }

  let dispatched = false;
  const restore = setPluginSdkNetworkTestHooks({ fetch: async () => { dispatched = true; return response("unexpected"); } });
  try {
    await assert.rejects(
      () => safeHttpFetch("https://192.0.0.8/", { method: "GET" }, new Set(["192.0.0.8"]), true, undefined, limits),
      /restricted address/,
    );
    assert.equal(dispatched, false);
  } finally {
    restore();
  }
});

await test("bracketed IPv6 URLs are normalized but remain denied by the manifest host policy", async () => {
  for (const url of ["http://[::1]:18765/", "https://[2001:4860:4860::8888]/", "https://[2001:4860:4860::8888"]) {
    await assert.rejects(
      () => safeHttpFetch(url, { method: "GET" }, new Set(["[::1]:18765", "[2001:4860:4860::8888]"]), true, undefined, limits),
    );
  }
});

await test("the real guarded Undici agent maps an approved local hostname to an offline fixture", async () => {
  let port = 0;
  const server = createServer((request, response) => {
    assert.equal(request.headers.host, `fixture.localhost:${port}`);
    response.end("fixture response");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  port = address.port;
  const previousDispatcher = getGlobalDispatcher();
  let globalDispatcherUsed = false;
  let lookupCalled = false;
  const sentinel = new Agent({ connect: { lookup: (_hostname, _options, callback) => { globalDispatcherUsed = true; callback(new Error("global dispatcher used"), "", 0); } } });
  setGlobalDispatcher(sentinel);
  const restore = setPluginSdkNetworkTestHooks({ lookup: async (hostname) => { lookupCalled = true; assert.equal(hostname, "fixture.localhost"); return [{ address: "127.0.0.1", family: 4 }]; } });
  try {
    const result = await safeHttpFetch(`http://fixture.localhost:${port}/`, { method: "GET" }, new Set([`fixture.localhost:${port}`]), true, undefined, limits);
    assert.equal(result.text, "fixture response");
    assert.equal(lookupCalled, true);
    assert.equal(globalDispatcherUsed, false);
  } finally {
    restore();
    setGlobalDispatcher(previousDispatcher);
    await sentinel.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

await test("response and stream caps cancel unread bodies, while exact caps succeed", async () => {
  let responseCancelled = false;
  const responseBody = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4])); },
    cancel() { responseCancelled = true; },
  });
  let restore = setPluginSdkNetworkTestHooks({ fetch: (async () => ({ status: 200, ok: true, headers: new Headers(), body: responseBody })) as unknown as typeof undiciFetch });
  try {
    await assert.rejects(() => safeHttpFetch("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), false, undefined, { responseBytes: 3, streamResponseBytes: 32 }), /Plugin HTTP response is too large\./);
    assert.equal(responseCancelled, true);
  } finally {
    restore();
  }

  let streamCancelled = false;
  const exactBody = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([97, 98, 99])); controller.close(); }, cancel() { streamCancelled = true; } });
  const chunks: string[] = [];
  restore = setPluginSdkNetworkTestHooks({ fetch: (async () => ({ status: 200, ok: true, headers: new Headers(), body: exactBody })) as unknown as typeof undiciFetch });
  try {
    const result = await safeHttpStream("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), (chunk) => chunks.push(chunk), false, undefined, { responseBytes: 32, streamResponseBytes: 3 });
    assert.deepEqual(result, { status: 200, ok: true });
    assert.deepEqual(chunks, ["abc"]);
    assert.equal(streamCancelled, false);
  } finally {
    restore();
  }
});

await test("redirect denial cancels the unread response body", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } });
  const restore = setPluginSdkNetworkTestHooks({ fetch: (async () => ({ status: 302, ok: false, headers: new Headers({ location: "https://other.example/" }), body })) as unknown as typeof undiciFetch });
  try {
    await assert.rejects(() => safeHttpFetch("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), false, undefined, limits), /redirects are not allowed\./);
    assert.equal(cancelled, true);
  } finally {
    restore();
  }
});

await test("callback failure cancels the unread stream", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } });
  const restore = setPluginSdkNetworkTestHooks({ fetch: (async () => ({ status: 200, ok: true, headers: new Headers(), body })) as unknown as typeof undiciFetch });
  try {
    await assert.rejects(() => safeHttpStream("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), () => { throw new Error("callback failed"); }, false, undefined, limits), /callback failed/);
    assert.equal(cancelled, true);
  } finally {
    restore();
  }
});

await test("lifecycle cancellation settles a stalled stream read immediately", async () => {
  let readStarted!: () => void;
  const readStartedPromise = new Promise<void>((resolve) => { readStarted = resolve; });
  let rejectRead!: (error: Error) => void;
  const readPending = new Promise<never>((_resolve, reject) => { rejectRead = reject; });
  let readerCanceled = false;
  let agentDestroyed = false;
  let unhandled = false;
  const reader = {
    read: () => { readStarted(); return readPending; },
    cancel: () => { readerCanceled = true; },
  };
  const agent = new Agent();
  Object.defineProperty(agent, "destroy", { configurable: true, value: () => { agentDestroyed = true; } });
  const restore = setPluginSdkNetworkTestHooks({
    createAgent: () => agent,
    fetch: async () => ({
      status: 200,
      ok: true,
      headers: new Headers(),
      body: { getReader: () => reader },
    }) as never,
  });
  const lifecycle = new AbortController();
  const onUnhandled = () => { unhandled = true; };
  process.on("unhandledRejection", onUnhandled);
  try {
    const pending = safeHttpStream("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), () => undefined, false, undefined, limits, lifecycle.signal);
    await readStartedPromise;
    lifecycle.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof Error && error.message === "Plugin is no longer active.");
    assert.equal(readerCanceled, true);
    assert.equal(agentDestroyed, true);
    rejectRead(new Error("late reader rejection"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(unhandled, false);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    restore();
  }
});

await test("a stalled stream callback races the deadline and observes late rejection", async () => {
  let fireTimeout!: () => void;
  let callbackStarted!: () => void;
  let rejectCallback!: (error: Error) => void;
  let canceled = false;
  let destroyed = false;
  let unhandled = false;
  const timer = {} as NodeJS.Timeout;
  const agent = new Agent();
  Object.defineProperty(agent, "destroy", {
    configurable: true,
    value: () => {
      destroyed = true;
      return Promise.reject(new Error("destroy failed"));
    },
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([97])); },
    cancel() { canceled = true; },
  });
  const restore = setPluginSdkNetworkTestHooks({
    setTimeout: (callback) => { fireTimeout = callback; return timer; },
    clearTimeout: () => undefined,
    createAgent: () => agent,
    fetch: async () => ({ status: 200, ok: true, headers: new Headers(), body }) as never,
  });
  const onUnhandled = () => { unhandled = true; };
  process.on("unhandledRejection", onUnhandled);
  try {
    const pendingCallback = new Promise<void>((_resolve, reject) => { rejectCallback = reject; });
    const pending = safeHttpStream("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), () => { callbackStarted(); return pendingCallback; }, false, undefined, limits);
    await new Promise<void>((resolve) => { callbackStarted = resolve; });
    fireTimeout();
    await assert.rejects(pending, /Plugin HTTP stream timed out\./);
    rejectCallback(new Error("late callback rejection"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(canceled, true);
    assert.equal(destroyed, true);
    assert.equal(unhandled, false);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    restore();
  }
});

await test("lifecycle cancellation cancels a fetch body and stream callback without late errors", async () => {
  let bodyCanceled = false;
  let agentDestroyed = false;
  let fetchStarted!: () => void;
  let fetchBodyRead!: () => void;
  const fetchStartedPromise = new Promise<void>((resolve) => { fetchStarted = resolve; });
  const fetchBodyReadPromise = new Promise<void>((resolve) => { fetchBodyRead = resolve; });
  const fetchBodyReadPending = new Promise<never>(() => undefined);
  let callbackStarted!: () => void;
  const callbackReady = new Promise<void>((resolve) => { callbackStarted = resolve; });
  let rejectCallback!: (error: Error) => void;
  const callbackPending = new Promise<void>((_resolve, reject) => { rejectCallback = reject; });
  const body = {
    getReader: () => ({
      read: () => { fetchBodyRead(); return fetchBodyReadPending; },
      cancel: () => { bodyCanceled = true; },
    }),
  };
  const streamBody = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([97])); },
    cancel() { bodyCanceled = true; },
  });
  const agent = new Agent();
  Object.defineProperty(agent, "destroy", { configurable: true, value: () => { agentDestroyed = true; } });
  let call = 0;
  const restore = setPluginSdkNetworkTestHooks({
    createAgent: () => agent,
    fetch: async () => {
      call += 1;
      fetchStarted();
      if (call === 1) return { status: 200, ok: true, headers: new Headers(), body } as never;
      return { status: 200, ok: true, headers: new Headers(), body: streamBody } as never;
    },
  });
  const lifecycle = new AbortController();
  let unhandled = false;
  const onUnhandled = () => { unhandled = true; };
  process.on("unhandledRejection", onUnhandled);
  try {
    const fetchPending = safeHttpFetch("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), false, undefined, limits, lifecycle.signal);
    await fetchStartedPromise;
    await fetchBodyReadPromise;
    await assert.rejects(async () => {
      lifecycle.abort();
      await fetchPending;
    }, /Plugin is no longer active\./);
    assert.equal(bodyCanceled, true);
    assert.equal(agentDestroyed, true);

    const streamLifecycle = new AbortController();
    const streamPending = safeHttpStream("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), () => {
      callbackStarted();
      return callbackPending;
    }, false, undefined, limits, streamLifecycle.signal);
    await callbackReady;
    streamLifecycle.abort();
    await assert.rejects(streamPending, /Plugin is no longer active\./);
    rejectCallback(new Error("late callback rejection"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(bodyCanceled, true);
    assert.equal(agentDestroyed, true);
    assert.equal(unhandled, false);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    restore();
  }
});

await test("rejecting agent cleanup preserves the request outcome without an unhandled rejection", async () => {
  let unhandled = false;
  const agent = new Agent();
  Object.defineProperty(agent, "close", { configurable: true, value: () => Promise.reject(new Error("close failed")) });
  Object.defineProperty(agent, "destroy", { configurable: true, value: () => Promise.reject(new Error("destroy failed")) });
  const restore = setPluginSdkNetworkTestHooks({ createAgent: () => agent, fetch: async () => response("ok") });
  const onUnhandled = () => { unhandled = true; };
  process.on("unhandledRejection", onUnhandled);
  try {
    assert.deepEqual(await safeHttpFetch("https://1.1.1.1/", { method: "GET" }, new Set(["1.1.1.1"]), false, undefined, limits), { status: 200, ok: true, headers: { "content-type": "text/plain;charset=UTF-8" }, text: "ok" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(unhandled, false);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    restore();
  }
});

async function test(name: string, callback: () => void | Promise<void>): Promise<void> {
  try {
    await callback();
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

console.error("Plugin SDK network tests passed.");
