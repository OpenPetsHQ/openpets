import assert from "node:assert/strict";

import { createLocalIpcConfinementCoordinator, type LocalIpcConfinementCoordinatorDeps } from "../src/local-ipc-confinement.js";
import { LeaseManager, type PetLease } from "../src/lease-manager.js";
import type { ConfinementState } from "../src/confinement-manager.js";
import type { TerminalWindowInfo } from "../src/window-tracker.js";

function makeInfo(pid = 100): TerminalWindowInfo {
  return { window: null, terminalPid: pid, appName: "iTerm2", isMinimized: false, isOccluded: false };
}

function makeLease(leaseId: string, petId: string, targetKind: "default" | "explicit" = "explicit"): PetLease {
  return {
    leaseId,
    targetKind,
    actualPetId: petId,
    acquiredAt: 1,
    lastHeartbeatAt: 1,
    expiresAt: 10_000,
  };
}

function makeDeps(overrides: Partial<LocalIpcConfinementCoordinatorDeps> = {}): LocalIpcConfinementCoordinatorDeps {
  return {
    getRawLease: () => makeLease("lease-1", "agent-pet"),
    findTerminalWindow: async () => makeInfo(),
    subscribeWindowTracking: () => () => undefined,
    setTerminalIdentity: () => undefined,
    setConfinementState: () => undefined,
    repositionConfinedPet: () => undefined,
    clearConfinementState: () => undefined,
    getScreenPermissionStatus: () => "granted",
    promptScreenPermission: () => undefined,
    notifyScreenPermission: () => undefined,
    log: () => undefined,
    ...overrides,
  };
}

{
  let findCalls = 0;
  const defaultCoordinator = createLocalIpcConfinementCoordinator(makeDeps({
    getRawLease: () => makeLease("default-lease", "builtin", "default"),
    findTerminalWindow: async () => {
      findCalls++;
      return makeInfo();
    },
  }));
  await defaultCoordinator.trackLease("default-lease", 42);
  assert.equal(findCalls, 0);

  const missingCoordinator = createLocalIpcConfinementCoordinator(makeDeps({
    getRawLease: () => null,
    findTerminalWindow: async () => {
      findCalls++;
      return makeInfo();
    },
  }));
  await missingCoordinator.trackLease("missing-lease", 42);
  assert.equal(findCalls, 0);
}

{
  const events: string[] = [];
  let capturedState: ConfinementState | undefined;
  let capturedIdentity: TerminalWindowInfo | undefined;
  const coordinator = createLocalIpcConfinementCoordinator(makeDeps({
    findTerminalWindow: async () => {
      events.push("find");
      return makeInfo(101);
    },
    setTerminalIdentity: (_leaseId, info) => {
      events.push("identity");
      capturedIdentity = info;
    },
    setConfinementState: (_petId, state) => {
      events.push("state");
      capturedState = state;
    },
    repositionConfinedPet: () => { events.push("reposition"); },
    subscribeWindowTracking: () => {
      events.push("subscribe");
      return () => undefined;
    },
  }));

  await coordinator.trackLease("lease-1", 101);
  assert.deepEqual(events, ["find", "identity", "state", "reposition", "subscribe"]);
  assert.equal(capturedIdentity?.terminalPid, 101);
  assert.deepEqual(capturedState, {
    terminalBounds: null,
    terminalMinimized: false,
    terminalOccluded: false,
    terminalOwnerPid: 101,
    appName: "iTerm2",
  });
}

{
  const errors: string[] = [];
  const coordinator = createLocalIpcConfinementCoordinator(makeDeps({
    setConfinementState: () => {
      throw new Error("state unavailable");
    },
    log: (message, fields) => {
      errors.push(`${message}:${fields.error}`);
    },
  }));

  await coordinator.trackLease("lease-1", 101);
  assert.ok(errors.some((error) => error.startsWith("terminal identity resolution error:") && error.includes("state unavailable")));
}

{
  let resolveFind!: (info: TerminalWindowInfo | null) => void;
  let identityCalls = 0;
  let stateCalls = 0;
  let subscribeCalls = 0;
  const coordinator = createLocalIpcConfinementCoordinator(makeDeps({
    findTerminalWindow: () => new Promise<TerminalWindowInfo | null>((resolve) => {
      resolveFind = resolve;
    }),
    setTerminalIdentity: () => { identityCalls++; },
    setConfinementState: () => { stateCalls++; },
    subscribeWindowTracking: () => {
      subscribeCalls++;
      return () => undefined;
    },
  }));

  const tracking = coordinator.trackLease("lease-1", 102);
  coordinator.stopLease("lease-1");
  resolveFind(makeInfo(102));
  await tracking;
  assert.equal(identityCalls, 0);
  assert.equal(stateCalls, 0);
  assert.equal(subscribeCalls, 0);
}

{
  let onFound!: (info: TerminalWindowInfo) => void;
  let unsubscribeCalls = 0;
  let stateCalls = 0;
  const coordinator = createLocalIpcConfinementCoordinator(makeDeps({
    subscribeWindowTracking: (_id, _pid, found) => {
      onFound = found;
      return () => { unsubscribeCalls++; };
    },
    setConfinementState: () => { stateCalls++; },
  }));

  await coordinator.trackLease("lease-1", 103);
  coordinator.stopLease("lease-1");
  coordinator.stopLease("lease-1");
  onFound(makeInfo(104));
  assert.equal(unsubscribeCalls, 1);
  assert.equal(stateCalls, 1);
}

{
  const events: string[] = [];
  let onFound!: (info: TerminalWindowInfo) => void;
  const coordinator = createLocalIpcConfinementCoordinator(makeDeps({
    setTerminalIdentity: () => { events.push("identity"); },
    setConfinementState: () => { events.push("state"); },
    repositionConfinedPet: () => { events.push("reposition"); },
    subscribeWindowTracking: (_id, _pid, found) => {
      onFound = found;
      return () => undefined;
    },
  }));

  await coordinator.trackLease("lease-1", 104);
  events.length = 0;
  onFound(makeInfo(105));
  assert.deepEqual(events, ["identity", "state", "reposition"]);
}

{
  const events: string[] = [];
  const coordinator = createLocalIpcConfinementCoordinator(makeDeps({
    findTerminalWindow: async () => null,
    getScreenPermissionStatus: () => "denied",
    notifyScreenPermission: (_leaseId, onAction) => {
      events.push("notify");
      onAction();
    },
    promptScreenPermission: () => { events.push("prompt"); },
  }));

  await coordinator.trackLease("lease-1", 105);
  assert.deepEqual(events, ["notify", "prompt"]);
}

{
  let manager!: LeaseManager;
  let now = 1;
  const events: string[] = [];
  const unsubscribeCalls = new Map<string, number>();
  const coordinator = createLocalIpcConfinementCoordinator(makeDeps({
    getRawLease: (leaseId) => manager.getRawLease(leaseId),
    subscribeWindowTracking: (leaseId) => {
      unsubscribeCalls.set(leaseId, 0);
      return () => unsubscribeCalls.set(leaseId, (unsubscribeCalls.get(leaseId) ?? 0) + 1);
    },
    setConfinementState: () => undefined,
    clearConfinementState: (petId) => { events.push(`state-clear:${petId}`); },
  }));

  manager = new LeaseManager({
    now: () => now,
    resolveTarget: () => ({ targetKind: "explicit", actualPetId: "agent-pet" }),
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
    onLastExplicitLease: (petId) => {
      events.push(`agent-clear:${petId}`);
      try {
        throw new Error("agent cleanup is contained by LeaseManager");
      } finally {
        coordinator.clearPetConfinement(petId);
      }
    },
    onLeaseReleased: (releasedLease) => {
      events.push(`release:${releasedLease.leaseId}`);
      coordinator.stopLease(releasedLease.leaseId);
    },
  });

  const first = manager.acquire("agent-pet");
  const second = manager.acquire("agent-pet");
  await coordinator.trackLease(first.leaseId, 201);
  await coordinator.trackLease(second.leaseId, 202);

  manager.release(first.leaseId);
  assert.equal(unsubscribeCalls.get(first.leaseId), 1);
  assert.ok(!events.includes("state-clear:agent-pet"));

  now = 20_000;
  manager.cleanupExpired();
  assert.equal(unsubscribeCalls.get(second.leaseId), 1);
  assert.deepEqual(events.slice(-4), [`release:${first.leaseId}`, "agent-clear:agent-pet", "state-clear:agent-pet", `release:${second.leaseId}`]);
}

console.log("local IPC confinement coordinator tests passed.");
