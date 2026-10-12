import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { OpenPetsClient, OpenPetsReaction } from "@open-pets/client";

import plugin, { openPetsOpenCodePluginId } from "./plugin.js";
import { classifyOpenCodeBusEvent, classifyOpenCodeToolReaction, createOpenPetsOpenCodeRuntime, getDefaultOpenCodeThrottlePath, isReactionExcluded, shouldIgnoreOpenPetsTool } from "./opencode-plugin-runtime.js";

assert.equal(plugin.id, openPetsOpenCodePluginId);
const packagePlugin = await import("@open-pets/opencode");
assert.equal(packagePlugin.default.id, openPetsOpenCodePluginId);
assert.equal(typeof packagePlugin.default.setup, "function");

assert.equal(classifyOpenCodeToolReaction("edit", {}), "editing");
assert.equal(classifyOpenCodeToolReaction("apply_patch", {}), "editing");
assert.equal(classifyOpenCodeToolReaction("bash", { command: "pnpm test" }), "testing");
assert.equal(classifyOpenCodeToolReaction("shell", { command: "ls" }), undefined);
assert.equal(classifyOpenCodeToolReaction("read", {}), undefined);
assert.equal(shouldIgnoreOpenPetsTool("openpets_openpets_status"), true);
assert.equal(shouldIgnoreOpenPetsTool("openpets_openpets_say"), true);
assert.equal(shouldIgnoreOpenPetsTool("openpets_openpets_react"), true);
assert.equal(shouldIgnoreOpenPetsTool("openpets_status"), true);
assert.deepEqual(classifyOpenCodeBusEvent({ type: "permission.asked", data: { action: "edit", resources: [] } }), { reaction: "waiting", speechCategory: "permission" });
assert.equal(classifyOpenCodeBusEvent({ type: "permission.asked", data: { action: "openpets_openpets_say", resources: [] } }), undefined);
assert.equal(classifyOpenCodeBusEvent({ type: "permission.asked", data: { action: "edit", resources: ["openpets_openpets_react"] } }), undefined);
assert.deepEqual(classifyOpenCodeBusEvent({ type: "session.execution.failed", data: { error: { message: "private error" } } }), { reaction: "error", speechCategory: "error" });
assert.deepEqual(classifyOpenCodeBusEvent({ type: "session.idle", data: { sessionID: "session" } }), { reaction: "success" });
assert.ok(getDefaultOpenCodeThrottlePath().includes("opencode-hook-throttle.json"));

assert.throws(() => createOpenPetsOpenCodeRuntime({ pet: "bad/pet" }));

const dir = mkdtempSync(join(tmpdir(), "openpets-opencode-plugin-"));
try {
  const calls: Array<{ readonly kind: string; readonly value: string; readonly leaseId?: string; readonly requestedPetId?: string }> = [];
  let releaseBlockedReact: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => { releaseBlockedReact = resolve; });
  const client: OpenPetsClient = {
    hello: async () => ({}),
    status: async () => ({ ok: true, appRunning: true }),
    listPets: async () => ({ ok: true, pets: [], defaultPetId: "builtin" }),
    installPet: async () => { throw new Error("unused"); },
    installLocalPet: async () => { throw new Error("unused"); },
    acquireLease: async (options?: { readonly requestedPetId?: string }) => {
      calls.push({ kind: "lease", value: "acquire", requestedPetId: options?.requestedPetId });
      return { leaseId: "lease-fixer", requestedPetId: options?.requestedPetId, targetKind: "explicit", actualTargetPetId: options?.requestedPetId ?? "builtin", actualTargetPetName: "Fixer", usingDefaultPet: false, expiresAt: Date.now() + 15_000, leaseActive: true };
    },
    heartbeatLease: async () => ({ leaseId: "lease-fixer", expiresAt: Date.now() + 15_000 }),
    releaseLease: async (leaseId: string) => {
      calls.push({ kind: "lease", value: `release:${leaseId}` });
      return { released: true };
    },
    react: async (reaction: OpenPetsReaction, options?: { readonly leaseId?: string }) => {
      calls.push({ kind: "react", value: reaction, leaseId: options?.leaseId });
      await blocked;
    },
    say: async (message: string, options?: { readonly leaseId?: string }) => {
      calls.push({ kind: "say", value: message, leaseId: options?.leaseId });
    },
    showMedia: async () => ({ ok: true, shown: true }),
  };

  const scheduled: Array<() => Promise<void>> = [];
  const hooks = createOpenPetsOpenCodeRuntime({ pet: "fixer", clientFactory: () => client, schedule: (work) => { scheduled.push(work); }, throttlePath: join(dir, "opencode-hook-throttle.json"), now: () => 100_000, random: () => 0 });
  hooks.prompt();
  assert.equal(scheduled.length, 1);
  const thinkingWork = scheduled.shift();
  const thinkingPromise = thinkingWork?.();
  await flushScheduledWork();
  assert.deepEqual(calls[0], { kind: "lease", value: "acquire", requestedPetId: "fixer" });
  assert.deepEqual(calls[1], { kind: "react", value: "thinking", leaseId: "lease-fixer" });
  releaseBlockedReact?.();
  await thinkingPromise;
  releaseBlockedReact = undefined;

  hooks.toolBefore("bash", { command: "pnpm test -- --secret" });
  assert.equal(scheduled.length, 1);
  const work = scheduled.shift();
  const promise = work?.();
  await flushScheduledWork();
  assert.deepEqual(calls.at(-1), { kind: "react", value: "testing", leaseId: "lease-fixer" });
  await promise;

  hooks.toolBefore("shell", { command: "ls" });
  assert.equal(scheduled.length, 0);
  hooks.toolBefore("bash", { command: "pnpm test" });
  assert.equal(scheduled.length, 1);
  const beforeDuplicateTesting = calls.length;
  await scheduled.shift()?.();
  assert.equal(calls.length, beforeDuplicateTesting, "duplicate testing reaction should be throttled without lease/client work");

  const beforeIgnored = scheduled.length;
  hooks.toolBefore("openpets_openpets_say", {});
  assert.equal(scheduled.length, beforeIgnored);

  hooks.event({ type: "permission.asked", data: { action: "edit", resources: [], message: "never speak this" } });
  assert.equal(scheduled.length, 1);
  await scheduled.shift()?.();
  assert.deepEqual(calls.at(-1), { kind: "say", value: "Approval needed", leaseId: "lease-fixer" });

  hooks.event({ type: "session.idle", data: { sessionID: "session" } });
  assert.equal(scheduled.length, 1);
  await scheduled.shift()?.();
  assert.deepEqual(calls.at(-1), { kind: "react", value: "success", leaseId: "lease-fixer" });

  hooks.toolAfter({ status: "error", error: { message: "private tool output" } });
  await scheduled.shift()?.();
  const toolErrorSpeech = calls.at(-1);
  assert.equal(toolErrorSpeech?.kind, "say");
  assert.notEqual(toolErrorSpeech?.value, "private tool output", "tool errors use curated speech rather than raw error text");

  const beforeOwnToolError = scheduled.length;
  hooks.toolAfter({ tool: "openpets_openpets_say", status: "error", error: { message: "pet ipc failed" } });
  hooks.toolAfter({ tool: "mcp_openpets_react", status: "error", error: { message: "pet ipc failed" } });
  assert.equal(scheduled.length, beforeOwnToolError, "OpenPets tool failures must not schedule another reaction");

  const errors: string[] = [];
  const failingHooks = createOpenPetsOpenCodeRuntime({ clientFactory: () => { throw new Error("api_key=secret /tmp/path"); }, schedule: (work) => { void work(); }, debug: true, debugLog: (message) => errors.push(message), throttlePath: join(dir, "fail-throttle.json"), now: () => 200_000 });
  assert.doesNotThrow(() => failingHooks.event({ type: "session.execution.failed" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(errors.join("\n"), /<redacted>|<path>/);

  const throwingSchedule = createOpenPetsOpenCodeRuntime({ schedule: () => { throw new Error("schedule failed"); }, debug: true, debugLog: (message) => errors.push(message) });
  assert.doesNotThrow(() => throwingSchedule.event({ type: "session.execution.failed" }));
  await hooks.cleanup();
  assert.ok(calls.some((call) => call.value === "release:lease-fixer"), "unloading releases the active pet lease");

  let clientCreations = 0;
  const queued: Array<() => Promise<void>> = [];
  const unloading = createOpenPetsOpenCodeRuntime({
    clientFactory: () => {
      clientCreations += 1;
      return client;
    },
    schedule: (work) => { queued.push(work); },
    throttlePath: join(dir, "unload-throttle.json"),
    now: () => 300_000,
  });
  unloading.prompt();
  await unloading.cleanup();
  await queued[0]?.();
  assert.equal(clientCreations, 0, "queued reaction work cannot create a client after unload");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// --- excludeReactions tests ---

// isReactionExcluded: basic Set check
assert.equal(isReactionExcluded("success", new Set(["success", "thinking"])), true);
assert.equal(isReactionExcluded("error", new Set(["success", "thinking"])), false);
assert.equal(isReactionExcluded("success", new Set()), false);

// Excluded reaction (success) is NOT sent to client when session.idle fires
{
  const dir2 = mkdtempSync(join(tmpdir(), "openpets-opencode-exclude-"));
  try {
    const excludeCalls: string[] = [];
    const excludeClient: OpenPetsClient = {
      hello: async () => ({}),
      status: async () => ({ ok: true, appRunning: true }),
      listPets: async () => ({ ok: true, pets: [], defaultPetId: "builtin" }),
      installPet: async () => { throw new Error("unused"); },
      installLocalPet: async () => { throw new Error("unused"); },
      acquireLease: async () => ({ leaseId: "lease-ex", targetKind: "explicit", actualTargetPetId: "fixer", actualTargetPetName: "Fixer", usingDefaultPet: false, expiresAt: Date.now() + 15_000, leaseActive: true }),
      heartbeatLease: async () => ({ leaseId: "lease-ex", expiresAt: Date.now() + 15_000 }),
      releaseLease: async () => ({ released: true }),
      react: async (reaction: OpenPetsReaction) => { excludeCalls.push(reaction); },
      say: async (message: string) => { excludeCalls.push(`say:${message}`); },
      showMedia: async () => ({ ok: true, shown: true }),
    };
    const scheduled2: Array<() => Promise<void>> = [];
    const hooks2 = createOpenPetsOpenCodeRuntime({
      pet: "fixer",
      excludeReactions: ["success", "thinking"],
      clientFactory: () => excludeClient,
      schedule: (work) => { scheduled2.push(work); },
      throttlePath: join(dir2, "throttle.json"),
      now: () => 300_000,
    });

    // session.idle → success → should be excluded, nothing scheduled
    hooks2.event({ type: "session.idle", data: { sessionID: "session" } });
    assert.equal(scheduled2.length, 0, "excluded success reaction must not schedule any work");

    // The V2 prompt hook → thinking → should be excluded
    hooks2.prompt();
    assert.equal(scheduled2.length, 0, "excluded thinking reaction must not schedule any work");

    // session.execution.failed → error → NOT excluded, should schedule (with speech)
    hooks2.event({ type: "session.execution.failed" });
    assert.equal(scheduled2.length, 1, "non-excluded error reaction should schedule");
    await scheduled2.shift()?.();
    assert.ok(excludeCalls.at(-1)?.startsWith("say:"), "non-excluded error reaction should reach client via say");

    // tool.execute.before with edit → editing → NOT excluded, should schedule
    hooks2.toolBefore("edit", {});
    assert.equal(scheduled2.length, 1, "non-excluded editing reaction should schedule");
    await scheduled2.shift()?.();
    assert.equal(excludeCalls.at(-1), "editing", "non-excluded editing reaction should reach client");

    assert.equal(excludeCalls.includes("success"), false, "success must never have been sent");
    assert.equal(excludeCalls.includes("thinking"), false, "thinking must never have been sent");
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
}

// Empty excludeReactions array has no effect (current behavior preserved)
{
  const dir3 = mkdtempSync(join(tmpdir(), "openpets-opencode-empty-exclude-"));
  try {
    const emptyExcludeCalls: string[] = [];
    const emptyExcludeClient: OpenPetsClient = {
      hello: async () => ({}),
      status: async () => ({ ok: true, appRunning: true }),
      listPets: async () => ({ ok: true, pets: [], defaultPetId: "builtin" }),
      installPet: async () => { throw new Error("unused"); },
      installLocalPet: async () => { throw new Error("unused"); },
      acquireLease: async () => ({ leaseId: "lease-empty", targetKind: "explicit", actualTargetPetId: "fixer", actualTargetPetName: "Fixer", usingDefaultPet: false, expiresAt: Date.now() + 15_000, leaseActive: true }),
      heartbeatLease: async () => ({ leaseId: "lease-empty", expiresAt: Date.now() + 15_000 }),
      releaseLease: async () => ({ released: true }),
      react: async (reaction: OpenPetsReaction) => { emptyExcludeCalls.push(reaction); },
      say: async () => {},
      showMedia: async () => ({ ok: true, shown: true }),
    };
    const scheduled3: Array<() => Promise<void>> = [];
    const hooks3 = createOpenPetsOpenCodeRuntime({
      pet: "fixer",
      excludeReactions: [],
      clientFactory: () => emptyExcludeClient,
      schedule: (work) => { scheduled3.push(work); },
      throttlePath: join(dir3, "throttle.json"),
      now: () => 400_000,
    });
    hooks3.event({ type: "session.idle", data: { sessionID: "session" } });
    assert.equal(scheduled3.length, 1, "empty excludeReactions should not block success");
    await scheduled3.shift()?.();
    assert.equal(emptyExcludeCalls.at(-1), "success");
  } finally {
    rmSync(dir3, { recursive: true, force: true });
  }
}

// Invalid reaction strings are ignored without discarding recognized exclusions.
{
  const scheduled4: Array<() => Promise<void>> = [];
  const hooks4 = createOpenPetsOpenCodeRuntime({
    excludeReactions: ["success", "not-a-real-reaction" as OpenPetsReaction, 42 as unknown as OpenPetsReaction],
    schedule: (work) => { scheduled4.push(work); },
    throttlePath: join(dir, "invalid-throttle.json"),
    now: () => 500_000,
  });
  hooks4.event({ type: "session.idle", data: { sessionID: "session" } });
  assert.equal(scheduled4.length, 0, "recognized exclusions remain active when invalid values are present");
}

// Classification is unaffected by filter (filter is in run(), not classify*)
assert.deepEqual(classifyOpenCodeBusEvent({ type: "session.idle", data: { sessionID: "session" } }), { reaction: "success" });
assert.deepEqual(classifyOpenCodeToolReaction("edit", {}), "editing");

// Concurrent dispatches share one in-flight acquisition. A second acquire must not
// overwrite the first, and cleanup must release the only lease that was taken.
{
  const concurrentDir = mkdtempSync(join(tmpdir(), "openpets-opencode-concurrent-"));
  try {
    let acquireCalls = 0;
    let releaseAcquire: ((leaseId: string) => void) | undefined;
    const released: string[] = [];
    const reactions: string[] = [];
    const concurrentClient: OpenPetsClient = {
      hello: async () => ({}),
      status: async () => ({ ok: true, appRunning: true }),
      listPets: async () => ({ ok: true, pets: [], defaultPetId: "builtin" }),
      installPet: async () => { throw new Error("unused"); },
      installLocalPet: async () => { throw new Error("unused"); },
      acquireLease: () => new Promise((resolve) => {
        acquireCalls += 1;
        releaseAcquire = (leaseId) => resolve({
          leaseId,
          expiresAt: Date.now() + 60_000,
          targetKind: "explicit",
          actualTargetPetId: "fixer",
          actualTargetPetName: "Fixer",
          usingDefaultPet: false,
          leaseActive: true,
        });
      }),
      heartbeatLease: async (leaseId: string) => ({ leaseId, expiresAt: Date.now() + 60_000 }),
      releaseLease: async (leaseId: string) => {
        released.push(leaseId);
        return { released: true };
      },
      react: async (reaction: OpenPetsReaction) => {
        reactions.push(reaction);
      },
      say: async () => { throw new Error("unused"); },
      showMedia: async () => ({ ok: true, shown: true }),
    };
    const concurrent = createOpenPetsOpenCodeRuntime({
      pet: "fixer",
      clientFactory: () => concurrentClient,
      schedule: (work) => { void work(); },
      throttlePath: join(concurrentDir, "throttle.json"),
      now: () => 600_000,
    });
    concurrent.prompt();
    concurrent.toolBefore("edit", {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(acquireCalls, 1, "overlapping prompt and tool reactions must not each acquire a lease");
    releaseAcquire?.("shared-lease");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(acquireCalls, 1, "the waiting dispatch must reuse the lease instead of acquiring another");
    assert.deepEqual(reactions, ["thinking", "editing"]);
    await concurrent.cleanup();
    assert.deepEqual(released, ["shared-lease"], "cleanup releases the single shared lease");
    concurrent.prompt();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(acquireCalls, 1, "work queued after unload must not acquire again");
  } finally {
    rmSync(concurrentDir, { recursive: true, force: true });
  }
}

// Cleanup waits for an acquisition that is already in flight, then releases it
// even when the reaction itself is abandoned. A later callback stays a no-op.
{
  const inflightDir = mkdtempSync(join(tmpdir(), "openpets-opencode-inflight-"));
  try {
    let acquireCalls = 0;
    let reactCalls = 0;
    let releaseAcquire: ((lease: { readonly leaseId: string; readonly expiresAt: number }) => void) | undefined;
    const acquired = new Promise<void>((resolve) => {
      releaseAcquire = (lease) => {
        resolve();
        return lease;
      };
    });
    const released: string[] = [];
    const inflightClient: OpenPetsClient = {
      hello: async () => ({}),
      status: async () => ({ ok: true, appRunning: true }),
      listPets: async () => ({ ok: true, pets: [], defaultPetId: "builtin" }),
      installPet: async () => { throw new Error("unused"); },
      installLocalPet: async () => { throw new Error("unused"); },
      acquireLease: () => {
        acquireCalls += 1;
        return acquired.then(() => ({ leaseId: "inflight-lease", expiresAt: Date.now() + 60_000, requestedPetId: "fixer", targetKind: "explicit" as const, actualTargetPetId: "fixer", actualTargetPetName: "Fixer", usingDefaultPet: false, leaseActive: true }));
      },
      heartbeatLease: async (leaseId: string) => ({ leaseId, expiresAt: Date.now() + 60_000 }),
      releaseLease: async (leaseId: string) => {
        released.push(leaseId);
        return { released: true };
      },
      react: async () => {
        reactCalls += 1;
      },
      say: async () => { throw new Error("unused"); },
      showMedia: async () => ({ ok: true, shown: true }),
    };
    const started = new Promise<void>((resolve) => {
      const original = inflightClient.acquireLease;
      inflightClient.acquireLease = (...args) => {
        resolve();
        return original(...args);
      };
    });
    const inflight = createOpenPetsOpenCodeRuntime({
      pet: "fixer",
      clientFactory: () => inflightClient,
      schedule: (work) => { void work(); },
      throttlePath: join(inflightDir, "throttle.json"),
      now: () => 700_000,
    });
    inflight.prompt();
    await started;
    const unloading = inflight.cleanup();
    assert.equal(released.length, 0, "cleanup must not release before the in-flight acquisition finishes");
    releaseAcquire?.({ leaseId: "inflight-lease", expiresAt: Date.now() + 60_000 });
    await unloading;
    assert.equal(reactCalls, 0, "a reaction abandoned by unload must not reach IPC");
    assert.deepEqual(released, ["inflight-lease"], "cleanup releases the lease acquired while unloading");
    inflight.prompt();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(acquireCalls, 1, "unload must not be followed by another acquisition");
  } finally {
    rmSync(inflightDir, { recursive: true, force: true });
  }
}

await assert.rejects(
  async () => { await plugin.setup(pluginContext({ pet: "Bad Pet" })); },
  /Invalid OpenPets pet id/,
  "an invalid pet option fails setup instead of being dropped",
);
await assert.rejects(
  async () => { await plugin.setup(pluginContext({ pet: 12 })); },
  /Invalid OpenPets pet id/,
  "a non-string pet option fails setup instead of being dropped",
);

{
  let subscribed = false;
  await assert.rejects(
    async () => {
      await plugin.setup(pluginContext({
        pet: "not a pet",
        subscribe: () => {
          subscribed = true;
          return emptyEvents();
        },
      }));
    },
    /Invalid OpenPets pet id/,
  );
  assert.equal(subscribed, false, "invalid pet options fail before an event subscription is created");
}

{
  let promptHooks = 0;
  await assert.rejects(
    async () => {
      await plugin.setup(pluginContext({
        subscribe: () => {
          throw new Error("subscribe failed");
        },
        sessionHook: async () => {
          promptHooks += 1;
          return { dispose: async () => {} };
        },
      }));
    },
    /subscribe failed/,
  );
  assert.equal(promptHooks, 0, "a failed event subscription does not continue hook registration");
}

{
  let aborted = false;
  await assert.rejects(
    async () => {
      await plugin.setup(pluginContext({
        subscribe: ({ signal } = {}) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
          });
          return abortableEvents(signal);
        },
        sessionHook: async () => {
          throw new Error("prompt hook failed");
        },
      }));
    },
    /prompt hook failed/,
  );
  assert.equal(aborted, true, "a failed hook registration aborts the event subscription");
}

{
  const stderr: string[] = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const unload = await plugin.setup(pluginContext({
      toolHook: async () => ({
        dispose: async () => {
          throw new Error("api_key=secret dispose failed");
        },
      }),
    }));
    if (typeof unload !== "function") throw new Error("OpenCode plugin setup did not return cleanup.");
    await unload();
    await unload();
    const logged = stderr.join("\n");
    assert.match(logged, /hook dispose failed/);
    assert.match(logged, /api_key=<redacted>/);
    assert.equal(logged.split("hook dispose failed").length - 1, 2, "a second unload does not dispose hooks again");
  } finally {
    process.stderr.write = originalWrite;
  }
}

function pluginContext(overrides: {
  readonly pet?: unknown;
  readonly subscribe?: (options?: { readonly signal?: AbortSignal }) => AsyncIterable<unknown>;
  readonly sessionHook?: () => Promise<{ dispose: () => Promise<void> }>;
  readonly toolHook?: () => Promise<{ dispose: () => Promise<void> }>;
}): Parameters<typeof plugin.setup>[0] {
  return {
    options: overrides.pet === undefined ? {} : { pet: overrides.pet },
    event: {
      subscribe: overrides.subscribe ?? (() => emptyEvents()),
    },
    session: {
      hook: overrides.sessionHook ?? (async () => ({ dispose: async () => {} })),
    },
    tool: {
      hook: overrides.toolHook ?? (async () => ({ dispose: async () => {} })),
    },
  } as unknown as Parameters<typeof plugin.setup>[0];
}

async function flushScheduledWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function emptyEvents(): AsyncIterable<unknown> {
  return (async function* () {})();
}

function abortableEvents(signal: AbortSignal | undefined): AsyncIterable<unknown> {
  return (async function* () {
    await new Promise<void>((resolve) => {
      if (!signal || signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
  })();
}

console.error("OpenCode plugin validation passed.");
