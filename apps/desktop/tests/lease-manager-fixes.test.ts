/**
 * Tests for Fix 1/M1 (idempotent per-clientPid+sessionNonce lease reuse),
 * Fix L1 (re-validate eligible target on reuse), and
 * Fix 4 (terminalOwnerPid liveness check in checkPidLiveness).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { LeaseManager, type PetLease } from "../src/lease-manager.js";

// ---------------------------------------------------------------------------
// T1: Fix 1/M1 — same clientPid + same nonce re-acquires same lease
// ---------------------------------------------------------------------------
{
  let now = 1_000;
  const firstOpened: string[] = [];
  let callCount = 0;
  const nonce = randomUUID();

  // Use a forward-ref to allow resolveTarget to call countExplicitLeases.
  let mgr!: LeaseManager;
  mgr = new LeaseManager({
    ttlMs: 10_000,
    now: () => now,
    resolveTarget: (_requestedPetId) => {
      // Simulates pool behavior: returns explicit/P only if no explicit lease
      // for P exists yet (the slot is free). Otherwise falls back to default.
      callCount++;
      if (mgr.countExplicitLeases("P") === 0) {
        return { targetKind: "explicit", actualPetId: "P" };
      }
      return { targetKind: "default", actualPetId: "builtin" };
    },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
    onFirstExplicitLease: (petId) => firstOpened.push(petId),
  });

  const s1 = mgr.acquire(undefined, 111, nonce);
  assert.equal(s1.targetKind, "explicit", "T1: first acquire should be explicit");
  assert.equal(s1.actualTargetPetId, "P", "T1: first acquire should target P");

  const resolveCallsAfterFirst = callCount;

  now += 100; // advance time slightly (still within TTL)
  const s2 = mgr.acquire(undefined, 111, nonce);
  assert.equal(s2.leaseId, s1.leaseId, "T1: second acquire should return SAME leaseId");
  assert.equal(s2.targetKind, "explicit", "T1: reused lease should still be explicit");
  assert.equal(s2.actualTargetPetId, "P", "T1: reused lease should still target P");

  // Fix M1: #resolveTarget must NOT have been called again for the second acquire
  assert.equal(callCount, resolveCallsAfterFirst, "T1: resolveTarget must NOT be called on reuse");

  // onFirstExplicitLease must have fired exactly once
  assert.equal(firstOpened.length, 1, "T1: onFirstExplicitLease fired more than once");
  assert.equal(firstOpened[0], "P", "T1: onFirstExplicitLease fired for wrong pet");

  console.log("T1 (Fix M1 — same clientPid+nonce reuse): PASS");
}

// ---------------------------------------------------------------------------
// T2: Fix 1 — different clientPids get distinct leases (nonces differ too)
// ---------------------------------------------------------------------------
{
  let now = 1_000;
  const firstOpened: string[] = [];
  let callCount = 0;
  const petIds = ["P", "Q"];

  let mgr!: LeaseManager;
  mgr = new LeaseManager({
    ttlMs: 10_000,
    now: () => now,
    resolveTarget: (_requestedPetId) => {
      // Round-robin pool simulation: each call gets a distinct pet
      const petId = petIds[callCount % petIds.length];
      callCount++;
      return { targetKind: "explicit", actualPetId: petId };
    },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
    onFirstExplicitLease: (petId) => firstOpened.push(petId),
  });

  const s1 = mgr.acquire(undefined, 111, randomUUID());
  const s2 = mgr.acquire(undefined, 222, randomUUID());

  assert.notEqual(s1.leaseId, s2.leaseId, "T2: different clientPids must get distinct leaseIds");
  assert.notEqual(s1.actualTargetPetId, s2.actualTargetPetId, "T2: different clientPids must get different pets");
  assert.equal(s1.targetKind, "explicit", "T2: pid 111 lease should be explicit");
  assert.equal(s2.targetKind, "explicit", "T2: pid 222 lease should be explicit");

  // resolveTarget was called once per distinct pid (no reuse across pids)
  assert.equal(callCount, 2, "T2: resolveTarget should be called once per distinct clientPid");

  console.log("T2 (Fix 1 — distinct clientPids not collapsed): PASS");
}

// ---------------------------------------------------------------------------
// T3: Skipped — wiring local-ipc routing guard requires heavy electron-stub
// seam plumbing across multiple handler layers; coverage of the routing logic
// is already provided by local-ipc-confinement.test.ts.
// ---------------------------------------------------------------------------
console.log("T3 (routing guard): SKIPPED — covered by local-ipc-confinement.test.ts");

// ---------------------------------------------------------------------------
// T-M1a: same PID + same nonce → reuse (explicit M1 test)
// ---------------------------------------------------------------------------
{
  let now = 1_000;
  let callCount = 0;
  const nonce = randomUUID();

  const mgr = new LeaseManager({
    ttlMs: 10_000,
    now: () => now,
    resolveTarget: () => { callCount++; return { targetKind: "explicit", actualPetId: "kitty" }; },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (p) => p,
  });

  const s1 = mgr.acquire("kitty", 555, nonce);
  assert.equal(callCount, 1, "T-M1a: resolveTarget should be called once on first acquire");
  now += 50;
  const s2 = mgr.acquire("kitty", 555, nonce);
  assert.equal(s2.leaseId, s1.leaseId, "T-M1a: same PID + same nonce must reuse leaseId");
  assert.equal(callCount, 1, "T-M1a: resolveTarget must NOT be called again on reuse");

  console.log("T-M1a (Fix M1 — same PID + same nonce reuses): PASS");
}

// ---------------------------------------------------------------------------
// T-M1b: same PID + DIFFERENT nonce → fresh acquire (no reuse)
// ---------------------------------------------------------------------------
{
  let now = 1_000;
  let callCount = 0;
  const nonce1 = randomUUID();
  const nonce2 = randomUUID();

  const mgr = new LeaseManager({
    ttlMs: 10_000,
    now: () => now,
    resolveTarget: () => { callCount++; return { targetKind: "explicit", actualPetId: "kitty" }; },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (p) => p,
  });

  const s1 = mgr.acquire("kitty", 555, nonce1);
  assert.equal(callCount, 1);
  now += 50;
  const s2 = mgr.acquire("kitty", 555, nonce2); // different nonce = different process (PID reuse)
  assert.notEqual(s2.leaseId, s1.leaseId, "T-M1b: different nonce must produce fresh leaseId");
  assert.equal(callCount, 2, "T-M1b: resolveTarget must be called again for different nonce");

  console.log("T-M1b (Fix M1 — different nonce → fresh acquire): PASS");
}

// ---------------------------------------------------------------------------
// T-M1c: undefined/missing nonce → never reuse
// ---------------------------------------------------------------------------
{
  let now = 1_000;
  let callCount = 0;

  const mgr = new LeaseManager({
    ttlMs: 10_000,
    now: () => now,
    resolveTarget: () => { callCount++; return { targetKind: "explicit", actualPetId: "kitty" }; },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (p) => p,
  });

  const s1 = mgr.acquire("kitty", 555, undefined); // no nonce
  assert.equal(callCount, 1);
  now += 50;
  const s2 = mgr.acquire("kitty", 555, undefined); // still no nonce
  assert.notEqual(s2.leaseId, s1.leaseId, "T-M1c: missing nonce must never reuse");
  assert.equal(callCount, 2, "T-M1c: resolveTarget must be called for each no-nonce acquire");

  console.log("T-M1c (Fix M1 — undefined nonce → never reuse): PASS");
}

// ---------------------------------------------------------------------------
// T-L1: explicit target no longer eligible → release + fresh acquire
// ---------------------------------------------------------------------------
{
  let now = 1_000;
  const lastClosed: string[] = [];
  const nonce = randomUUID();
  let eligiblePets = new Set(["kitty"]);
  let callCount = 0;

  const mgr = new LeaseManager({
    ttlMs: 10_000,
    now: () => now,
    resolveTarget: () => {
      callCount++;
      // After kitty is uninstalled, re-resolution falls back to default.
      if (eligiblePets.has("kitty")) return { targetKind: "explicit", actualPetId: "kitty" };
      return { targetKind: "default", actualPetId: "builtin", fallbackReason: "pet_not_installed" };
    },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (p) => p,
    isPetEligible: (petId) => eligiblePets.has(petId),
    onLastExplicitLease: (petId) => lastClosed.push(petId),
  });

  // Acquire with kitty eligible
  const s1 = mgr.acquire("kitty", 777, nonce);
  assert.equal(s1.targetKind, "explicit", "T-L1: initial acquire should be explicit kitty");
  assert.equal(callCount, 1);

  // Simulate kitty being uninstalled between original acquire and re-acquire
  eligiblePets = new Set();
  now += 100;

  // Re-acquire same PID+nonce — Fix L1 must detect kitty is ineligible, release and re-resolve
  const s2 = mgr.acquire("kitty", 777, nonce);
  assert.notEqual(s2.leaseId, s1.leaseId, "T-L1: ineligible target must produce fresh leaseId");
  assert.equal(callCount, 2, "T-L1: resolveTarget must be called again after ineligible reuse");
  assert.equal(s2.usingDefaultPet, true, "T-L1: re-resolved lease should fall back to default");
  assert.equal(lastClosed.join(","), "kitty", "T-L1: onLastExplicitLease should fire for released kitty lease");

  console.log("T-L1 (Fix L1 — ineligible reuse target → release + fresh acquire): PASS");
}

// ---------------------------------------------------------------------------
// T-W4: expired matching PID + nonce is released before fresh acquisition
// ---------------------------------------------------------------------------
{
  let now = 1_000;
  const nonce = randomUUID();
  const events: string[] = [];
  let resolveCount = 0;
  let lastExplicitCount = 0;
  const manager = new LeaseManager({
    ttlMs: 100,
    now: () => now,
    resolveTarget: (petId) => {
      events.push(`resolve:${++resolveCount}`);
      return petId ? { targetKind: "explicit", actualPetId: petId } : { targetKind: "default", actualPetId: "builtin" };
    },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
    onLeaseReleased: () => events.push("released"),
    onLastExplicitLease: () => {
      lastExplicitCount++;
      events.push("last-explicit");
    },
  });

  const oldLease = manager.acquire("expired", 321, nonce);
  now += 100;
  const freshLease = manager.acquire("expired", 321, nonce);

  assert.notEqual(freshLease.leaseId, oldLease.leaseId, "T-W4 expired reuse: acquire should create a fresh lease");
  assert.equal(events.join(","), "resolve:1,last-explicit,released,resolve:2", "T-W4 expired reuse: release lifecycle must finish before fresh resolution");
  assert.equal(lastExplicitCount, 1, "T-W4 expired reuse: last explicit lifecycle should fire once");
}

// ---------------------------------------------------------------------------
// T-W4: re-entrant acquisition cannot move a final explicit cleanup past the
// acquisition's first-explicit transition.
// ---------------------------------------------------------------------------
{
  const events: string[] = [];
  let releasedLeaseId: string | undefined;
  let reacquiredLeaseId: string | undefined;
  const manager = new LeaseManager({
    resolveTarget: (petId) => ({ targetKind: "explicit", actualPetId: petId ?? "reentrant" }),
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
    onFirstExplicitLease: () => events.push("first-explicit"),
    onLastExplicitLease: () => events.push("last-explicit"),
    onLeaseReleased: (lease) => {
      events.push("released");
      if (lease.leaseId === releasedLeaseId) {
        reacquiredLeaseId = manager.acquire("reentrant").leaseId;
      }
    },
  });

  const oldLease = manager.acquire("reentrant");
  releasedLeaseId = oldLease.leaseId;
  events.length = 0;

  assert.deepEqual(manager.release(oldLease.leaseId), { released: true }, "T-W4 re-entry: release should succeed");
  assert.equal(events.join(","), "last-explicit,released,first-explicit", "T-W4 re-entry: final cleanup must precede re-acquisition");
  assert.ok(reacquiredLeaseId, "T-W4 re-entry: callback should acquire a replacement lease");
  assert.equal(manager.getRawLease(oldLease.leaseId), null, "T-W4 re-entry: released lease must stay deleted");
  assert.equal(manager.countExplicitLeases("reentrant"), 1, "T-W4 re-entry: replacement lease state should be valid");
  const reacquiredLease = manager.getRawLease(reacquiredLeaseId);
  assert.equal(reacquiredLease?.actualPetId, "reentrant", "T-W4 re-entry: replacement should target the requested pet");
}

// ---------------------------------------------------------------------------
// T-W4: a throwing release callback cannot block last-explicit cleanup
// ---------------------------------------------------------------------------
{
  let lastExplicitCount = 0;
  const manager = new LeaseManager({
    resolveTarget: (petId) => petId ? { targetKind: "explicit", actualPetId: petId } : { targetKind: "default", actualPetId: "builtin" },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
    onLeaseReleased: () => { throw new Error("dispose failed"); },
    onLastExplicitLease: () => { lastExplicitCount++; },
  });
  const lease = manager.acquire("throwing-release");

  assert.deepEqual(manager.release(lease.leaseId), { released: true }, "T-W4 throwing callback: release should still succeed");
  assert.equal(lastExplicitCount, 1, "T-W4 throwing callback: last explicit cleanup should fire once");
}

// ---------------------------------------------------------------------------
// T-W4: a throwing last-explicit callback cannot skip lease disposal
// ---------------------------------------------------------------------------
{
  const onLastError = new Error("last explicit cleanup failed");
  let releasedCount = 0;
  const logMessages: string[] = [];
  const manager = new LeaseManager({
    resolveTarget: (petId) => petId ? { targetKind: "explicit", actualPetId: petId } : { targetKind: "default", actualPetId: "builtin" },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
    onLastExplicitLease: () => { throw onLastError; },
    onLeaseReleased: () => { releasedCount++; },
    onLog: (_level, message) => { logMessages.push(message); },
  });
  const lease = manager.acquire("throwing-last-explicit");

  assert.deepEqual(manager.release(lease.leaseId), { released: true }, "T-W4 throwing last-explicit: release should not propagate callback errors");
  assert.equal(releasedCount, 1, "T-W4 throwing last-explicit: release callback should fire once");
  assert.equal(manager.getRawLease(lease.leaseId), null, "T-W4 throwing last-explicit: lease should remain deleted");
  assert.ok(logMessages.includes("last explicit lease callback failed"), "T-W4 throwing last-explicit: callback failure should be logged");
}

// ---------------------------------------------------------------------------
// T-W4: an expired pool lease is released before a different nonce resolves
// a fresh pool assignment
// ---------------------------------------------------------------------------
{
  let now = 1_000;
  const nonce1 = randomUUID();
  const nonce2 = randomUUID();
  let manager!: LeaseManager;
  manager = new LeaseManager({
    ttlMs: 100,
    now: () => now,
    resolveTarget: () => manager.countExplicitLeases("pool-pet") === 0
      ? { targetKind: "explicit", actualPetId: "pool-pet" }
      : { targetKind: "default", actualPetId: "builtin" },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
  });

  const expired = manager.acquire(undefined, 321, nonce1);
  now += 100;
  const fresh = manager.acquire(undefined, 321, nonce2);

  assert.equal(fresh.targetKind, "explicit", "T-W4 different nonce expired pool: fresh acquire should reclaim the pool pet");
  assert.equal(fresh.actualTargetPetId, "pool-pet", "T-W4 different nonce expired pool: fresh acquire should resolve the reclaimed pool pet");
  assert.equal(manager.getRawLease(expired.leaseId), null, "T-W4 different nonce expired pool: expired lease should be removed");
}

// ---------------------------------------------------------------------------
// T-L1b: default lease — isPetEligible NOT called (by-design behavior preserved)
// ---------------------------------------------------------------------------
{
  let now = 1_000;
  const nonce = randomUUID();
  let eligibilityCallCount = 0;
  let resolveCallCount = 0;

  const mgr = new LeaseManager({
    ttlMs: 10_000,
    now: () => now,
    resolveTarget: () => { resolveCallCount++; return { targetKind: "default", actualPetId: "builtin" }; },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (p) => p,
    isPetEligible: (_petId) => { eligibilityCallCount++; return false; }, // always ineligible
  });

  const s1 = mgr.acquire(undefined, 888, nonce);
  assert.equal(s1.usingDefaultPet, true, "T-L1b: initial acquire should be default");
  now += 50;
  const s2 = mgr.acquire(undefined, 888, nonce);
  assert.equal(s2.leaseId, s1.leaseId, "T-L1b: default lease must still reuse");
  assert.equal(eligibilityCallCount, 0, "T-L1b: isPetEligible must NOT be called for default leases");
  assert.equal(resolveCallCount, 1, "T-L1b: resolveTarget called once (not on reuse)");

  console.log("T-L1b (Fix L1 — default leases skip eligibility check): PASS");
}

// ---------------------------------------------------------------------------
// T4: Fix 4 — dead terminalOwnerPid triggers lease release + onLastExplicitLease
// ---------------------------------------------------------------------------
{
  let now = 1_000;
  const lastClosed: string[] = [];

  const mgr = new LeaseManager({
    ttlMs: 60_000,
    now: () => now,
    resolveTarget: (id) => id ? { targetKind: "explicit", actualPetId: id } : { targetKind: "default", actualPetId: "builtin" },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
    onLastExplicitLease: (petId) => lastClosed.push(petId),
  });

  const snap = mgr.acquire("rex", process.pid);
  // Set a dead terminalOwnerPid (process 999_999_999 does not exist)
  mgr.setTerminalIdentity(snap.leaseId, { terminalOwnerPid: 999_999_999, terminalAppName: "Ghostty" });

  const released = mgr.checkPidLiveness();

  assert.equal(released.length, 1, "T4: dead terminalOwnerPid should cause lease release");
  assert.equal(released[0].actualTargetPetId, "rex", "T4: released lease should target rex");
  assert.equal(mgr.get(snap.leaseId), null, "T4: lease should no longer be active");
  assert.equal(lastClosed.join(","), "rex", "T4: onLastExplicitLease('rex') should have fired");

  console.log("T4 (Fix 4 — dead terminalOwnerPid releases lease): PASS");
}

// ---------------------------------------------------------------------------
// T5: Fix 4 — heartbeat does NOT defeat owner-death teardown
// ---------------------------------------------------------------------------
{
  let now = 1_000;
  const lastClosed: string[] = [];

  const mgr = new LeaseManager({
    ttlMs: 60_000,
    now: () => now,
    resolveTarget: (id) => id ? { targetKind: "explicit", actualPetId: id } : { targetKind: "default", actualPetId: "builtin" },
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
    onLastExplicitLease: (petId) => lastClosed.push(petId),
  });

  const snap = mgr.acquire("rex", process.pid);
  mgr.setTerminalIdentity(snap.leaseId, { terminalOwnerPid: 999_999_999, terminalAppName: "Ghostty" });

  // Heartbeat refreshes TTL but should NOT protect against dead terminalOwnerPid
  now += 1_000;
  mgr.heartbeat(snap.leaseId);

  const released = mgr.checkPidLiveness();

  assert.equal(released.length, 1, "T5: heartbeat must not protect against dead terminalOwnerPid");
  assert.equal(mgr.get(snap.leaseId), null, "T5: lease should be released even after heartbeat");
  assert.equal(lastClosed.join(","), "rex", "T5: onLastExplicitLease should still fire");

  console.log("T5 (Fix 4 — heartbeat does not defeat owner-death): PASS");
}

// ---------------------------------------------------------------------------
// T-W4: every successful release route invokes onLeaseReleased exactly once
// ---------------------------------------------------------------------------
function createReleaseManager(options: {
  now: () => number;
  resolveTarget: (requestedPetId: string | undefined) => { targetKind: "default" | "explicit"; actualPetId: string; fallbackReason?: "pet_not_installed" };
  onLeaseReleased: (lease: PetLease) => void;
  isPetEligible?: (petId: string) => boolean;
}): LeaseManager {
  return new LeaseManager({
    ttlMs: 100,
    now: options.now,
    resolveTarget: options.resolveTarget,
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
    onLeaseReleased: options.onLeaseReleased,
    isPetEligible: options.isPetEligible,
  });
}

{
  let now = 1_000;
  const released: PetLease[] = [];
  const manager = createReleaseManager({
    now: () => now,
    resolveTarget: (petId) => petId ? { targetKind: "explicit", actualPetId: petId } : { targetKind: "default", actualPetId: "builtin" },
    onLeaseReleased: (lease) => released.push(lease),
  });
  const lease = manager.acquire("direct");

  assert.deepEqual(manager.release(lease.leaseId), { released: true }, "T-W4 direct: release should succeed");
  assert.equal(released.length, 1, "T-W4 direct: callback should fire once");
  assert.equal(released[0].leaseId, lease.leaseId, "T-W4 direct: callback should receive released lease");
  assert.deepEqual(manager.release(lease.leaseId), { released: false }, "T-W4 unknown after direct: release should be rejected");
  assert.equal(released.length, 1, "T-W4 unknown after direct: callback should not fire");
}

{
  let now = 1_000;
  const released: PetLease[] = [];
  const manager = createReleaseManager({
    now: () => now,
    resolveTarget: (petId) => petId ? { targetKind: "explicit", actualPetId: petId } : { targetKind: "default", actualPetId: "builtin" },
    onLeaseReleased: (lease) => released.push(lease),
  });
  const lease = manager.acquire("heartbeat");
  now += 100;

  assert.throws(() => manager.heartbeat(lease.leaseId), "T-W4 heartbeat expiry: expired heartbeat should fail");
  assert.equal(released.length, 1, "T-W4 heartbeat expiry: callback should fire once");
  assert.equal(released[0].leaseId, lease.leaseId, "T-W4 heartbeat expiry: callback should receive released lease");
}

{
  let now = 1_000;
  const released: PetLease[] = [];
  const manager = createReleaseManager({
    now: () => now,
    resolveTarget: (petId) => petId ? { targetKind: "explicit", actualPetId: petId } : { targetKind: "default", actualPetId: "builtin" },
    onLeaseReleased: (lease) => released.push(lease),
  });
  const lease = manager.acquire("get-expiry");
  now += 100;

  assert.equal(manager.get(lease.leaseId), null, "T-W4 get expiry: expired lease should be absent");
  assert.equal(released.length, 1, "T-W4 get expiry: callback should fire once");
  assert.equal(released[0].leaseId, lease.leaseId, "T-W4 get expiry: callback should receive released lease");
}

{
  let now = 1_000;
  const released: PetLease[] = [];
  const manager = createReleaseManager({
    now: () => now,
    resolveTarget: (petId) => petId ? { targetKind: "explicit", actualPetId: petId } : { targetKind: "default", actualPetId: "builtin" },
    onLeaseReleased: (lease) => released.push(lease),
  });
  const lease = manager.acquire("cleanup-expiry");
  now += 100;

  assert.equal(manager.cleanupExpired().length, 1, "T-W4 cleanup expiry: one lease should expire");
  assert.equal(released.length, 1, "T-W4 cleanup expiry: callback should fire once");
  assert.equal(released[0].leaseId, lease.leaseId, "T-W4 cleanup expiry: callback should receive released lease");
}

{
  const released: PetLease[] = [];
  const manager = createReleaseManager({
    now: () => 1_000,
    resolveTarget: (petId) => petId ? { targetKind: "explicit", actualPetId: petId } : { targetKind: "default", actualPetId: "builtin" },
    onLeaseReleased: (lease) => released.push(lease),
  });
  const lease = manager.acquire("dead-pid", 999_999_999);

  assert.equal(manager.checkPidLiveness().length, 1, "T-W4 dead PID: dead lease should be released");
  assert.equal(released.length, 1, "T-W4 dead PID: callback should fire once");
  assert.equal(released[0].leaseId, lease.leaseId, "T-W4 dead PID: callback should receive released lease");
}

{
  const released: PetLease[] = [];
  const nonce = randomUUID();
  const manager = createReleaseManager({
    now: () => 1_000,
    resolveTarget: (petId) => petId ? { targetKind: "explicit", actualPetId: petId } : { targetKind: "default", actualPetId: "builtin" },
    onLeaseReleased: (lease) => released.push(lease),
  });
  const oldLease = manager.acquire("requested-old", 123, nonce);
  const newLease = manager.acquire("requested-new", 123, nonce);

  assert.notEqual(newLease.leaseId, oldLease.leaseId, "T-W4 requested replacement: acquire should replace the old lease");
  assert.equal(released.length, 1, "T-W4 requested replacement: callback should fire once");
  assert.equal(released[0].leaseId, oldLease.leaseId, "T-W4 requested replacement: callback should receive replaced lease");
}

{
  let eligible = true;
  const released: PetLease[] = [];
  const nonce = randomUUID();
  const manager = createReleaseManager({
    now: () => 1_000,
    resolveTarget: () => ({ targetKind: "explicit", actualPetId: "ineligible" }),
    onLeaseReleased: (lease) => released.push(lease),
    isPetEligible: () => eligible,
  });
  const oldLease = manager.acquire("ineligible", 456, nonce);
  eligible = false;
  const newLease = manager.acquire("ineligible", 456, nonce);

  assert.notEqual(newLease.leaseId, oldLease.leaseId, "T-W4 eligibility replacement: acquire should replace the old lease");
  assert.equal(released.length, 1, "T-W4 eligibility replacement: callback should fire once");
  assert.equal(released[0].leaseId, oldLease.leaseId, "T-W4 eligibility replacement: callback should receive replaced lease");
}

{
  const released: PetLease[] = [];
  const manager = createReleaseManager({
    now: () => 1_000,
    resolveTarget: () => ({ targetKind: "default", actualPetId: "builtin" }),
    onLeaseReleased: (lease) => released.push(lease),
  });

  assert.deepEqual(manager.release("never-acquired"), { released: false }, "T-W4 unknown: release should be rejected");
  assert.equal(released.length, 0, "T-W4 unknown: callback should not fire");
}

console.log("T-W4 (release callback ownership): PASS");

console.log("\nAll lease-manager-fixes tests passed.");
