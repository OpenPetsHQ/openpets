/** Executable confinement subscription and lease-authorization regression tests. */
import assert from "node:assert/strict";

import { resolveAndSubscribe, type ConfinementPollerDeps } from "../src/confinement-poller.js";
import { LeaseManager } from "../src/lease-manager.js";
import type { TerminalWindowInfo } from "../src/window-tracker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfo(pid = 100): TerminalWindowInfo {
  return { window: null, terminalPid: pid, appName: "iTerm2", isMinimized: false, isOccluded: false };
}

function makeDeps(overrides: Partial<ConfinementPollerDeps> = {}): ConfinementPollerDeps {
  return {
    findTerminal: async () => null,
    subscribe: (_id, _pid, _cb) => () => { /* noop */ },
    setIdentity: () => { /* noop */ },
    applyUpdate: () => { /* noop */ },
    isAlive: () => true,
    onDead: () => { /* noop */ },
    getScreenPermissionStatus: () => "granted",
    notifyScreenPermission: () => { /* noop */ },
    promptScreenPermission: () => { /* noop */ },
    ...overrides,
  };
}

// A failure while seeding the initial terminal state must cancel the
// reservation so a later attempt can install confinement.
{
  const setupError = new Error("initial state failed");
  let applyCalls = 0;
  let subscribeCalls = 0;
  const subscribed = new Map<string, () => void>();
  const deps = makeDeps({
    findTerminal: async () => makeInfo(101),
    applyUpdate: () => {
      applyCalls++;
      if (applyCalls === 1) throw setupError;
    },
    subscribe: () => {
      subscribeCalls++;
      return () => { /* noop */ };
    },
  });

  await assert.rejects(resolveAndSubscribe("lease-initial-failure", 101, deps, subscribed), setupError);
  assert.ok(!subscribed.has("lease-initial-failure"), "initial setup failure should clear reservation");

  const retry = await resolveAndSubscribe("lease-initial-failure", 101, deps, subscribed);
  assert.ok(retry !== null, "later attempt should complete after initial setup failure");
  assert.equal(subscribeCalls, 1, "later attempt should install one subscription");
  retry?.();
}

// A synchronous retry setup failure during subscription must tear down the
// acquired subscription and leave the lease available for a later attempt.
{
  const setupError = new Error("retry setup failed");
  let findCalls = 0;
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  const subscribed = new Map<string, () => void>();
  const deps = makeDeps({
    findTerminal: async () => findCalls++ === 0 ? null : makeInfo(102),
    subscribe: (_id, _pid, _onFound, onNull) => {
      subscribeCalls++;
      if (subscribeCalls === 1) onNull?.();
      return () => { unsubscribeCalls++; };
    },
    scheduleRetry: () => { throw setupError; },
  });

  await assert.rejects(resolveAndSubscribe("lease-subscription-failure", 102, deps, subscribed), setupError);
  assert.ok(!subscribed.has("lease-subscription-failure"), "subscription setup failure should clear reservation");
  assert.equal(unsubscribeCalls, 1, "subscription setup failure should tear down active subscription");

  const retry = await resolveAndSubscribe("lease-subscription-failure", 102, deps, subscribed);
  assert.ok(retry !== null, "later attempt should complete after subscription setup failure");
  assert.equal(subscribeCalls, 2, "later attempt should subscribe again");
  retry?.();
}

// A delayed retry setup failure must clean up without escaping the timer
// callback, while a later attempt remains available.
{
  const setupError = new Error("delayed retry setup failed");
  let findCalls = 0;
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  let delayedRetry!: () => void;
  const reportedErrors: unknown[] = [];
  const subscribed = new Map<string, () => void>();
  const deps = makeDeps({
    findTerminal: async () => findCalls++ === 0 ? null : makeInfo(103),
    subscribe: (_id, _pid, _onFound, onNull) => {
      subscribeCalls++;
      if (subscribeCalls === 1) onNull?.();
      if (subscribeCalls === 2) throw setupError;
      return () => { unsubscribeCalls++; };
    },
    scheduleRetry: (_delay, callback) => {
      delayedRetry = callback;
      return () => { /* noop */ };
    },
    reportError: (error) => { reportedErrors.push(error); },
  });

  const cleanup = await resolveAndSubscribe("lease-delayed-retry-failure", 103, deps, subscribed);
  assert.ok(cleanup !== null, "initial subscription should complete");
  assert.equal(subscribeCalls, 1, "initial subscription should be installed");

  assert.doesNotThrow(() => delayedRetry(), "delayed retry failure should not escape the timer callback");
  assert.equal(reportedErrors.length, 1, "delayed retry failure should be reported");
  assert.equal(reportedErrors[0], setupError, "reported retry failure should preserve the original error");
  assert.ok(!subscribed.has("lease-delayed-retry-failure"), "delayed retry failure should clear reservation");
  assert.equal(unsubscribeCalls, 1, "delayed retry failure should clean the old subscription");

  const retry = await resolveAndSubscribe("lease-delayed-retry-failure", 103, deps, subscribed);
  assert.ok(retry !== null, "later attempt should complete after delayed retry failure");
  assert.equal(subscribeCalls, 3, "later attempt should subscribe again");
  retry?.();
}

// A newly authorized lease must remain subscribed when its terminal is not
// discoverable yet; otherwise confinement never starts when it appears later.
{
  const subscribeCallIds: string[] = [];
  const subscribed = new Map<string, () => void>();

  const deps = makeDeps({
    findTerminal: async () => null,
    subscribe: (id, _pid, _cb) => {
      subscribeCallIds.push(id);
      return () => { /* noop */ };
    },
  });

  const result = await resolveAndSubscribe("lease-1", 42, deps, subscribed);

  assert.ok(result !== null, "should return an unsubscribe fn when first resolve is null");
  assert.equal(subscribeCallIds.length, 1, "subscribe should be called once");
  assert.equal(subscribeCallIds[0], "lease-1", "subscribe called with correct leaseId");
  assert.ok(subscribed.has("lease-1"), "subscribed map should contain the leaseId");
}

// Cleanup must remove the reservation even when the tracker unsubscribe throws.
{
  const subscribed = new Map<string, () => void>();
  let unsubscribeCalls = 0;
  const deps = makeDeps({
    findTerminal: async () => makeInfo(104),
    subscribe: () => () => {
      unsubscribeCalls++;
      throw new Error("tracker unsubscribe failed");
    },
  });

  const cleanup = await resolveAndSubscribe("lease-cleanup-unsubscribe-error", 104, deps, subscribed);
  assert.ok(cleanup !== null);
  assert.doesNotThrow(() => cleanup?.(), "cleanup should contain tracker unsubscribe failures");
  assert.equal(unsubscribeCalls, 1, "cleanup should attempt tracker unsubscribe once");
  assert.ok(!subscribed.has("lease-cleanup-unsubscribe-error"), "cleanup should remove the reservation after tracker failure");
}

// Cleanup must also remove the reservation when retry cancellation throws.
{
  const subscribed = new Map<string, () => void>();
  let delayedRetry!: () => void;
  let cancelCalls = 0;
  const deps = makeDeps({
    findTerminal: async () => null,
    subscribe: (_id, _pid, _onFound, onNull) => {
      onNull?.();
      return () => { /* noop */ };
    },
    scheduleRetry: (_delay, callback) => {
      delayedRetry = callback;
      return () => {
        cancelCalls++;
        throw new Error("retry cancellation failed");
      };
    },
  });

  const cleanup = await resolveAndSubscribe("lease-cleanup-retry-error", 105, deps, subscribed);
  assert.ok(cleanup !== null);
  assert.doesNotThrow(() => cleanup?.(), "cleanup should contain retry cancellation failures");
  assert.equal(cancelCalls, 1, "cleanup should attempt retry cancellation once");
  assert.ok(!subscribed.has("lease-cleanup-retry-error"), "cleanup should remove the reservation after retry cancellation failure");
  assert.doesNotThrow(() => delayedRetry(), "cancelled retry callback should not throw");
}

// An established tracker callback failure keeps the reservation and retries
// the subscription without allowing the callback to throw or duplicating it.
{
  const subscribed = new Map<string, () => void>();
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  let identityCalls = 0;
  let retryCallback!: () => void;
  let capturedFound!: (info: TerminalWindowInfo) => void;
  const callbackError = new Error("transient identity failure");
  const reportedErrors: unknown[] = [];
  const deps = makeDeps({
    findTerminal: async () => makeInfo(106),
    subscribe: (_id, _pid, onFound) => {
      subscribeCalls++;
      capturedFound = onFound;
      return () => { unsubscribeCalls++; };
    },
    setIdentity: () => {
      identityCalls++;
      if (identityCalls === 2) throw callbackError;
    },
    scheduleRetry: (_delay, callback) => {
      retryCallback = callback;
      return () => { /* noop */ };
    },
    reportError: (error) => { reportedErrors.push(error); },
  });

  const cleanup = await resolveAndSubscribe("lease-established-callback-error", 106, deps, subscribed);
  assert.ok(cleanup !== null);
  assert.doesNotThrow(() => capturedFound(makeInfo(107)), "established callback failure should not escape");
  assert.equal(reportedErrors.length, 1, "established callback failure should be reported");
  assert.equal(reportedErrors[0], callbackError, "reported callback failure should preserve the original error");
  assert.ok(subscribed.has("lease-established-callback-error"), "callback failure should preserve the reservation for retry");
  assert.equal(unsubscribeCalls, 1, "callback failure should tear down the current subscription");

  assert.doesNotThrow(() => retryCallback(), "retry timer callback should not throw");
  assert.equal(subscribeCalls, 2, "callback failure should install exactly one replacement subscription");
  cleanup?.();
}

// Cancellation wins over a queued retry after an established callback failure.
{
  const subscribed = new Map<string, () => void>();
  let subscribeCalls = 0;
  let retryCallback!: () => void;
  let capturedFound!: (info: TerminalWindowInfo) => void;
  const deps = makeDeps({
    findTerminal: async () => makeInfo(108),
    subscribe: (_id, _pid, onFound) => {
      subscribeCalls++;
      capturedFound = onFound;
      return () => { /* noop */ };
    },
    setIdentity: () => {
      if (subscribeCalls === 1) throw new Error("transient identity failure");
    },
    scheduleRetry: (_delay, callback) => {
      retryCallback = callback;
      return () => { /* noop */ };
    },
  });

  const cleanup = await resolveAndSubscribe("lease-cancelled-retry", 108, deps, subscribed);
  assert.ok(cleanup !== null);
  assert.doesNotThrow(() => capturedFound(makeInfo(109)));
  cleanup?.();
  assert.doesNotThrow(() => retryCallback(), "cancelled retry callback should not throw");
  assert.equal(subscribeCalls, 1, "cancelled retry should not create a replacement subscription");
  assert.ok(!subscribed.has("lease-cancelled-retry"), "cancellation should remove the reservation");
}

// A pending lookup reserves the lease synchronously, so concurrent callers
// cannot install a second subscription; the resulting active cleanup remains
// reachable through the same map entry.
{
  let resolveFindTerminal!: (info: TerminalWindowInfo | null) => void;
  let capturedCb!: (info: TerminalWindowInfo) => void;
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  const subscribed = new Map<string, () => void>();
  let identityUpdates = 0;
  let appliedUpdates = 0;
  const deps = makeDeps({
    findTerminal: () => new Promise<TerminalWindowInfo | null>((resolve) => {
      resolveFindTerminal = resolve;
    }),
    subscribe: (_id, _pid, cb) => {
      subscribeCalls++;
      capturedCb = cb;
      return () => { unsubscribeCalls++; };
    },
    setIdentity: () => { identityUpdates++; },
    applyUpdate: () => { appliedUpdates++; },
  });

  const first = resolveAndSubscribe("lease-pending-duplicate", 88, deps, subscribed);
  assert.ok(subscribed.has("lease-pending-duplicate"), "pending lookup should reserve subscribed entry");
  assert.equal(await resolveAndSubscribe("lease-pending-duplicate", 88, deps, subscribed), null, "concurrent invocation should return null");

  resolveFindTerminal(makeInfo(88));
  assert.ok((await first) !== null, "first invocation should resolve to cleanup");
  assert.equal(subscribeCalls, 1, "concurrent invocation must not subscribe twice");

  subscribed.get("lease-pending-duplicate")?.();
  assert.equal(unsubscribeCalls, 1, "active cleanup should remain cancellable through subscribed map");
  assert.ok(!subscribed.has("lease-pending-duplicate"), "active cleanup should remove its map entry");
  capturedCb(makeInfo(89));
  assert.equal(identityUpdates, 1, "cancelled subscription must not update identity");
  assert.equal(appliedUpdates, 1, "cancelled subscription must not apply updates");
}

// External unsubscribe while the initial lookup is pending cancels all later
// work, including the initial state seed and subscription installation.
{
  let resolveFindTerminal!: (info: TerminalWindowInfo | null) => void;
  let aliveChecks = 0;
  let identityUpdates = 0;
  let appliedUpdates = 0;
  let subscribeCalls = 0;
  const subscribed = new Map<string, () => void>();
  const deps = makeDeps({
    findTerminal: () => new Promise<TerminalWindowInfo | null>((resolve) => {
      resolveFindTerminal = resolve;
    }),
    subscribe: () => {
      subscribeCalls++;
      return () => { /* noop */ };
    },
    setIdentity: () => { identityUpdates++; },
    applyUpdate: () => { appliedUpdates++; },
    isAlive: () => { aliveChecks++; return true; },
  });

  const pending = resolveAndSubscribe("lease-pending-cancel", 89, deps, subscribed);
  subscribed.get("lease-pending-cancel")?.();
  resolveFindTerminal(makeInfo(89));

  assert.equal(await pending, null, "cancelled pending lookup should resolve without a cleanup");
  assert.equal(aliveChecks, 0, "cancelled pending lookup should do no later work");
  assert.equal(identityUpdates, 0, "cancelled pending lookup must not set identity");
  assert.equal(appliedUpdates, 0, "cancelled pending lookup must not apply state");
  assert.equal(subscribeCalls, 0, "cancelled pending lookup must not subscribe");
  assert.ok(!subscribed.has("lease-pending-cancel"), "external unsubscribe should remove reservation");
}

// Lease release uses the same external cleanup surface while lookup is
// pending, so release must prevent every later confinement action.
{
  let resolveFindTerminal!: (info: TerminalWindowInfo | null) => void;
  let identityUpdates = 0;
  let appliedUpdates = 0;
  let subscribeCalls = 0;
  const subscribed = new Map<string, () => void>();
  const manager = new LeaseManager({
    resolveTarget: () => ({ targetKind: "explicit", actualPetId: "pet-pending-release" }),
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
    onLeaseReleased: (lease) => subscribed.get(lease.leaseId)?.(),
  });
  const lease = manager.acquire("pet-pending-release");
  const deps = makeDeps({
    findTerminal: () => new Promise<TerminalWindowInfo | null>((resolve) => {
      resolveFindTerminal = resolve;
    }),
    subscribe: () => {
      subscribeCalls++;
      return () => { /* noop */ };
    },
    setIdentity: () => { identityUpdates++; },
    applyUpdate: () => { appliedUpdates++; },
  });

  const pending = resolveAndSubscribe(lease.leaseId, 90, deps, subscribed);
  assert.equal(manager.release(lease.leaseId).released, true, "pending lease release should succeed");
  resolveFindTerminal(makeInfo(90));

  assert.equal(await pending, null, "released pending lookup should resolve without a cleanup");
  assert.equal(identityUpdates, 0, "released pending lookup must not set identity");
  assert.equal(appliedUpdates, 0, "released pending lookup must not apply state");
  assert.equal(subscribeCalls, 0, "released pending lookup must not subscribe");
  assert.ok(!subscribed.has(lease.leaseId), "release callback should cancel the pending reservation");
}

// A lease that dies while the initial terminal lookup is pending must not seed
// confinement state or install a subscription after the lookup resolves.
{
  let resolveFindTerminal!: (info: TerminalWindowInfo | null) => void;
  let alive = true;
  let identityUpdates = 0;
  let appliedUpdates = 0;
  let nullResolves = 0;
  let subscribeCalls = 0;
  const subscribed = new Map<string, () => void>();

  const deps = makeDeps({
    findTerminal: () => new Promise<TerminalWindowInfo | null>((resolve) => {
      resolveFindTerminal = resolve;
    }),
    subscribe: () => {
      subscribeCalls++;
      return () => { /* noop */ };
    },
    setIdentity: () => { identityUpdates++; },
    applyUpdate: () => { appliedUpdates++; },
    isAlive: () => alive,
    getScreenPermissionStatus: () => {
      nullResolves++;
      return "granted";
    },
  });

  const pending = resolveAndSubscribe("lease-delayed-death", 77, deps, subscribed);
  alive = false;
  resolveFindTerminal(makeInfo(77));

  assert.equal(await pending, null, "delayed dead lease should not install confinement");
  assert.equal(identityUpdates, 0, "delayed dead lease should not set terminal identity");
  assert.equal(appliedUpdates, 0, "delayed dead lease should not apply confinement state");
  assert.equal(nullResolves, 0, "delayed dead lease should not handle a null resolve");
  assert.equal(subscribeCalls, 0, "delayed dead lease should not subscribe");
  assert.ok(!subscribed.has("lease-delayed-death"), "delayed dead lease should not enter subscribed map");
}

// A lease owns one confinement subscription, preventing duplicate updates.
{
  const subscribeCallCount = { n: 0 };
  const subscribed = new Map<string, () => void>();

  const deps = makeDeps({
    findTerminal: async () => null,
    subscribe: (_id, _pid, _cb) => {
      subscribeCallCount.n++;
      return () => { /* noop */ };
    },
  });

  const r1 = await resolveAndSubscribe("lease-2", 99, deps, subscribed);
  assert.ok(r1 !== null, "first call should return unsubscribe fn");

  const r2 = await resolveAndSubscribe("lease-2", 99, deps, subscribed);
  assert.equal(r2, null, "second call for same leaseId should return null (guard)");
  assert.equal(subscribeCallCount.n, 1, "subscribe should be called only once for same leaseId");
}

// A callback from a no-longer-authorized lease must tear down its subscription
// rather than continuing to confine a pet after the lease expires.
{
  const deadCalled = { n: 0 };
  const unsubCalled = { n: 0 };
  const subscribed = new Map<string, () => void>();
  let alive = true;

  let capturedCb: ((info: TerminalWindowInfo) => void) | undefined;

  const deps = makeDeps({
    findTerminal: async () => null,
    subscribe: (_id, _pid, cb) => {
      capturedCb = cb;
      return () => { unsubCalled.n++; };
    },
    isAlive: () => alive,
    onDead: () => { deadCalled.n++; },
  });

  await resolveAndSubscribe("lease-3", 55, deps, subscribed);

  assert.ok(capturedCb !== undefined, "subscribe callback should have been captured");
  alive = false;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  capturedCb(makeInfo(55));

  assert.equal(deadCalled.n, 1, "onDead should be called when isAlive returns false");
  assert.equal(unsubCalled.n, 1, "unsubscribe fn should be called when isAlive returns false");
  assert.ok(!subscribed.has("lease-3"), "leaseId should be removed from subscribed map");
}

// LeaseManager's release callback is the immediate local-IPC disposal seam.
{
  let disposed = false;
  const subscriptions = new Map<string, () => void>();
  const manager = new LeaseManager({
    resolveTarget: () => ({ targetKind: "explicit", actualPetId: "pet-1" }),
    getDefaultPetId: () => "builtin",
    getPetDisplayName: (petId) => petId,
    onLeaseReleased: (lease) => {
      subscriptions.get(lease.leaseId)?.();
      subscriptions.delete(lease.leaseId);
    },
  });
  const lease = manager.acquire("pet-1");
  subscriptions.set(lease.leaseId, () => { disposed = true; });

  assert.equal(manager.release(lease.leaseId).released, true, "release callback seam should release the lease");
  assert.equal(disposed, true, "release callback should dispose confinement synchronously");
  assert.equal(subscriptions.has(lease.leaseId), false, "release callback should remove the subscription immediately");
}

console.log("local IPC confinement subscription tests passed.");
