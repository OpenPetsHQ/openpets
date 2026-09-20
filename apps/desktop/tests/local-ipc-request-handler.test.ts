import assert from "node:assert/strict";

import { createLocalIpcRequestHandler, type LocalIpcMediaOptions, type LocalIpcRequestHandlerDeps, type LocalIpcStateSnapshot } from "../src/local-ipc-request-handler.js";
import type { LeaseSnapshot } from "../src/lease-manager.js";

const state: LocalIpcStateSnapshot = {
  preferences: { defaultPetId: "builtin", openDefaultPetOnLaunch: true, speechBubblesEnabled: true },
  pets: { installed: [{ id: "builtin", displayName: "Hoodie Cat", builtIn: true }] },
};

const lease: LeaseSnapshot = {
  leaseId: "lease-1",
  targetKind: "explicit",
  actualTargetPetId: "agent-pet",
  actualTargetPetName: "Agent Pet",
  usingDefaultPet: false,
  expiresAt: 123,
  leaseActive: true,
};

function makeDeps(overrides: Partial<LocalIpcRequestHandlerDeps> = {}): LocalIpcRequestHandlerDeps {
  return {
    getAppVersion: () => "3.5.0",
    getAppStateSnapshot: () => state,
    builtInPet: state.pets.installed[0]!,
    getDefaultPetPaused: () => false,
    isDefaultPetVisible: () => true,
    installPet: async () => state,
    installPetFromFolderWithResult: async () => ({ state, petId: "builtin" }),
    installPetFromZipFileWithResult: async () => ({ state, petId: "builtin" }),
    stat: async () => ({ size: 1, isDirectory: () => false, isFile: () => true }),
    acquireLease: () => lease,
    getLease: () => null,
    heartbeatLease: () => ({ leaseId: "lease-1", expiresAt: 456 }),
    releaseLease: () => ({ released: false }),
    onLeaseAcquired: () => undefined,
    applyAgentPetReaction: () => ({ shown: true }),
    applyAgentPetSay: () => ({ shown: true }),
    applyAgentPetShowMedia: () => ({ shown: true }),
    applyExternalPetReaction: () => ({ shown: true }),
    applyExternalPetSay: () => ({ shown: true }),
    applyExternalPetShowMedia: () => ({ shown: true }),
    broadcastLanPetActivity: () => undefined,
    recordOpenPetsActivity: () => undefined,
    debug: () => undefined,
    logError: () => undefined,
    ...overrides,
  };
}

function request(method: string, params?: unknown, id = "request-1"): string {
  return JSON.stringify({ id, version: 1, token: "token", method, ...(params === undefined ? {} : { params }) });
}

async function handle(raw: string, deps: Partial<LocalIpcRequestHandlerDeps> = {}) {
  return createLocalIpcRequestHandler(makeDeps(deps))(raw, "token");
}

{
  const response = await handle(JSON.stringify({ id: "request-1", version: 1, token: "wrong", method: "not-a-method" }));
  assert.deepEqual(response, { id: null, ok: false, error: { code: "invalid_token", message: "Invalid IPC token." } });
}

{
  const response = await handle(request("pet.say"));
  assert.equal(response.id, "request-1");
  assert.deepEqual(response.error, { code: "invalid_params", message: "Message must be a string." });
}

{
  const response = await handle(request("status"), { getAppStateSnapshot: () => { throw new Error("state unavailable"); } });
  assert.deepEqual(response, { id: "request-1", ok: false, error: { code: "internal_error", message: "state unavailable" } });
}

{
  const brokenDefaultState: LocalIpcStateSnapshot = {
    ...state,
    preferences: { ...state.preferences, defaultPetId: "broken-pet" },
    pets: { installed: [...state.pets.installed, { id: "broken-pet", displayName: "Broken Pet", builtIn: false, broken: true }] },
  };
  const status = await handle(request("status"), { getAppStateSnapshot: () => brokenDefaultState });
  assert.deepEqual(status.result, {
    ok: true,
    appRunning: true,
    protocolVersion: 1,
    appVersion: "3.5.0",
    defaultPet: { id: "broken-pet", displayName: "Broken Pet", builtIn: false, broken: true },
    paused: false,
    defaultPetVisible: true,
    openDefaultPetOnLaunch: true,
    speechBubblesEnabled: true,
  });

  let activity: unknown;
  const command = await handle(request("pet.say", { message: "uses fallback" }), {
    getAppStateSnapshot: () => brokenDefaultState,
    recordOpenPetsActivity: (record) => { activity = record; },
  });
  assert.equal(command.ok, true);
  assert.deepEqual(activity, { kind: "say", reaction: undefined, petId: "builtin", surface: "default" });
}

{
  const events: string[] = [];
  const response = await handle(request("lease.acquire", { requestedPetId: "agent-pet", clientPid: 42, sessionNonce: "nonce" }), {
    acquireLease: () => {
      events.push("acquire");
      return lease;
    },
    onLeaseAcquired: (_requestedPetId, acquiredLease, clientPid) => {
      events.push(`hook:${acquiredLease.leaseId}:${clientPid}`);
    },
  });
  assert.deepEqual(events, ["acquire", "hook:lease-1:42"]);
  assert.deepEqual(response.result, lease);
}

{
  const heartbeat = await handle(request("lease.heartbeat", { leaseId: "expired" }), { heartbeatLease: () => { throw new Error("unknown_lease"); } });
  assert.deepEqual(heartbeat.error, { code: "unknown_lease", message: "Unknown or expired lease." });

  const release = await handle(request("lease.release", { leaseId: "missing" }));
  assert.deepEqual(release.result, { released: false });
}

{
  const events: string[] = [];
  let defaultActivity: unknown;
  const defaultReaction = await handle(request("pet.react", { reaction: "success" }), {
    applyExternalPetReaction: () => {
      events.push("apply");
      return { shown: true };
    },
    broadcastLanPetActivity: () => {
      events.push("broadcast");
    },
    recordOpenPetsActivity: (record) => {
      defaultActivity = record;
      events.push("activity");
      throw new Error("activity unavailable");
    },
  });
  assert.deepEqual(events, ["apply", "broadcast", "activity"]);
  assert.deepEqual(defaultActivity, { kind: "react", reaction: "success", petId: "builtin", surface: "default" });
  assert.deepEqual(defaultReaction.result, { ok: true, reaction: "success", shown: true, reason: undefined });

  const broadcastFailure = await handle(request("pet.react", { reaction: "success" }), {
    applyExternalPetReaction: () => {
      events.push("apply-failure");
      return { shown: true };
    },
    broadcastLanPetActivity: () => { throw new Error("LAN unavailable"); },
    recordOpenPetsActivity: () => { events.push("unexpected-activity"); },
  });
  assert.deepEqual(broadcastFailure.error, { code: "internal_error", message: "LAN unavailable" });
  assert.ok(!events.includes("unexpected-activity"));

  const explicitEvents: string[] = [];
  let explicitActivity: unknown;
  const explicitReaction = await handle(request("pet.react", { reaction: "success", leaseId: "lease-1" }), {
    getLease: () => lease,
    applyAgentPetReaction: () => {
      explicitEvents.push("apply");
      return { shown: true };
    },
    broadcastLanPetActivity: () => { explicitEvents.push("broadcast"); },
    recordOpenPetsActivity: (record) => { explicitEvents.push("activity"); explicitActivity = record; },
  });
  assert.deepEqual(explicitEvents, ["apply", "activity"]);
  assert.deepEqual(explicitActivity, { kind: "react", reaction: "success", petId: "agent-pet", surface: "agent" });
  assert.deepEqual(explicitReaction.result, { ok: true, reaction: "success", shown: true, reason: undefined, leaseId: "lease-1" });
}

{
  let activity: unknown;
  let broadcasts = 0;
  const response = await handle(request("pet.say", { message: "hello", reaction: "waving" }), {
    applyExternalPetSay: (_message, _reaction) => ({ shown: true }),
    recordOpenPetsActivity: (record) => { activity = record; },
    broadcastLanPetActivity: () => { broadcasts++; },
  });
  assert.deepEqual(response.result, { ok: true, shown: true, reason: undefined, reaction: "waving" });
  assert.deepEqual(activity, { kind: "say", reaction: "waving", petId: "builtin", surface: "default" });
  assert.equal(broadcasts, 0);
}

{
  const reaction = await handle(request("pet.react", { reaction: "not-a-reaction", leaseId: "missing" }), {
    getLease: () => { throw new Error("lease lookup should not run"); },
  });
  assert.deepEqual(reaction.error, { code: "invalid_params", message: "Invalid pet reaction." });

  const message = await handle(request("pet.say", { message: "", reaction: "not-a-reaction", leaseId: "missing" }), {
    getLease: () => { throw new Error("lease lookup should not run"); },
  });
  assert.deepEqual(message.error, { code: "invalid_params", message: "Message cannot be empty." });

  const sayReaction = await handle(request("pet.say", { message: "hello", reaction: "not-a-reaction", leaseId: "missing" }), {
    getLease: () => { throw new Error("lease lookup should not run"); },
  });
  assert.deepEqual(sayReaction.error, { code: "invalid_params", message: "Invalid pet reaction." });

  let statCalled = false;
  const media = await handle(request("pet.showMedia", { path: "/tmp/pet.png", durationMs: 100, leaseId: "missing" }), {
    stat: async () => {
      statCalled = true;
      return { size: 1, isDirectory: () => false, isFile: () => true };
    },
  });
  assert.deepEqual(media.error, { code: "invalid_params", message: "Media duration must be a number between 1000 and 30000 milliseconds." });
  assert.equal(statCalled, false);

  let installStatCalled = false;
  const installPath = await handle(request("pets.install-local", { path: "relative/pet.zip", kind: "invalid" }), {
    stat: async () => {
      installStatCalled = true;
      return { size: 1, isDirectory: () => false, isFile: () => true };
    },
  });
  assert.deepEqual(installPath.error, { code: "invalid_params", message: "Path must be absolute." });
  assert.equal(installStatCalled, false);

  installStatCalled = false;
  const installKind = await handle(request("pets.install-local", { path: "/tmp/pet.zip", kind: "invalid" }), {
    stat: async () => {
      installStatCalled = true;
      return { size: 1, isDirectory: () => false, isFile: () => true };
    },
  });
  assert.deepEqual(installKind.error, { code: "invalid_params", message: "Local install kind must be zip or folder." });
  assert.equal(installStatCalled, false);
}

{
  const invalidPath = await handle(request("pet.showMedia", { path: "/tmp/pet.txt", leaseId: "missing" }), {
    getLease: () => { throw new Error("lease lookup should not run"); },
  });
  assert.deepEqual(invalidPath.error, { code: "invalid_params", message: "Media path extension must be one of: .png, .jpg, .jpeg, .webp, .gif." });

  const events: string[] = [];
  const response = await handle(request("pet.showMedia", { path: "/tmp/pet.png", leaseId: "missing" }), {
    stat: async () => {
      events.push("stat");
      return { size: 1, isDirectory: () => false, isFile: () => true };
    },
    getLease: () => {
      events.push("lease");
      return null;
    },
  });
  assert.deepEqual(events, ["stat", "lease"]);
  assert.deepEqual(response.error, { code: "unknown_lease", message: "Unknown or expired lease." });
}

{
  const expectedOptions = {
    mediaPath: "/tmp/pet.png",
    message: "hello",
    reaction: "success",
    durationMs: 1235,
    clickUrl: "https://example.com/media",
  } as const;
  let defaultOptions: unknown;
  let explicitOptions: unknown;
  let broadcasts = 0;
  const dependencies = {
    stat: async () => ({ size: 1, isDirectory: () => false, isFile: () => true }),
    applyExternalPetShowMedia: (options: LocalIpcMediaOptions) => {
      defaultOptions = options;
      return { shown: true };
    },
    applyAgentPetShowMedia: (_petId: string, options: LocalIpcMediaOptions) => {
      explicitOptions = options;
      return { shown: true };
    },
    broadcastLanPetActivity: () => { broadcasts++; },
  } satisfies Partial<LocalIpcRequestHandlerDeps>;

  const defaultResponse = await handle(request("pet.showMedia", {
    path: " /tmp/pet.png ",
    message: " hello ",
    reaction: "success",
    durationMs: 1234.6,
    clickUrl: " https://example.com/media ",
  }), dependencies);
  assert.deepEqual(defaultOptions, expectedOptions);
  assert.deepEqual(defaultResponse.result, { ok: true, shown: true, reason: undefined, reaction: "success" });

  const explicitResponse = await handle(request("pet.showMedia", {
    path: "/tmp/pet.png",
    message: "hello",
    reaction: "success",
    durationMs: 1234.6,
    clickUrl: "https://example.com/media",
    leaseId: "lease-1",
  }), { ...dependencies, getLease: () => lease });
  assert.deepEqual(explicitOptions, expectedOptions);
  assert.deepEqual(explicitResponse.result, { ok: true, shown: true, reason: undefined, reaction: "success", leaseId: "lease-1" });
  assert.equal(broadcasts, 0);
}

{
  let installed = false;
  const response = await handle(request("pets.install-local", { path: "/tmp/pet.zip", kind: "zip" }), {
    stat: async () => { throw new Error("stat failed"); },
    installPetFromZipFileWithResult: async () => {
      installed = true;
      return { state, petId: "builtin" };
    },
  });
  assert.deepEqual(response.error, { code: "internal_error", message: "stat failed" });
  assert.equal(installed, false);
}

console.log("local IPC request handler tests passed.");
