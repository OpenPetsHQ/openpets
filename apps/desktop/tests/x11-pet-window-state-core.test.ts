import assert from "node:assert/strict";
import test from "node:test";

import { canCompletePetWindowStateApplication, isAtomProperty, mergePetWindowStateAtoms, missingAtoms, optionalPetWindowStateAtoms, petWindowStateAtoms, requiredPetWindowStateAtoms } from "../src/x11-pet-window-state-core.js";
import { createPetWindowShowCoordinator } from "../src/pet-window-show-coordinator.js";
import { createPetWindowX11MapTransition } from "../src/pet-window-x11-map-core.js";

test("pet shell state atoms merge without removing existing window-manager state", () => {
  assert.deepEqual(mergePetWindowStateAtoms([4, 8], [8, 12, 16]), [4, 8, 12, 16]);
});

test("only ATOM/32 properties are interpreted as EWMH state lists", () => {
  assert.equal(isAtomProperty(4, 32, 4), true);
  assert.equal(isAtomProperty(4, 8, 4), false);
  assert.equal(isAtomProperty(3, 32, 4), false);
});

test("post-show verification requires universal atoms and treats KDE switcher hint as optional", () => {
  assert.deepEqual(petWindowStateAtoms, ["_NET_WM_STATE_SKIP_TASKBAR", "_NET_WM_STATE_SKIP_PAGER"]);
  assert.deepEqual(optionalPetWindowStateAtoms, ["_KDE_NET_WM_STATE_SKIP_SWITCHER"]);
  assert.deepEqual(missingAtoms([2, 3], [2, 3]), []);
  assert.deepEqual(missingAtoms([2], [2, 3]), [3]);
});

test("requires the KDE switcher hint only when advertised by the window manager", () => {
  assert.deepEqual(requiredPetWindowStateAtoms([10, 11], [10, 11], [12]), [10, 11]);
  assert.deepEqual(requiredPetWindowStateAtoms([10, 11, 12], [10, 11], [12]), [10, 11, 12]);
});

test("does not complete on standard property notification before all state sends cross the barrier", () => {
  const requiredAtoms = [10, 11, 12];

  // The standard PropertyNotify may arrive while the KDE ClientMessage send
  // callback is still pending; even a later property snapshot must not clean
  // up the X connection until the request-processing barrier has passed.
  assert.equal(canCompletePetWindowStateApplication([10, 11], requiredAtoms, false), false);
  assert.equal(canCompletePetWindowStateApplication([10, 11, 12], requiredAtoms, false), false);
  assert.equal(canCompletePetWindowStateApplication([10, 11, 12], requiredAtoms, true), true);
});

test("hiding before readiness prevents the window from becoming visible", async () => {
  const coordinator = createPetWindowShowCoordinator();
  let finishReadiness: (() => void) | undefined;
  const readiness = new Promise<void>((resolve) => { finishReadiness = resolve; });
  let visible = false;

  coordinator.schedule(readiness, () => { visible = true; });
  coordinator.cancel();
  finishReadiness?.();
  await readiness;
  await Promise.resolve();

  assert.equal(visible, false);
});

test("X11 map transition accepts only the target MapNotify once and cancellation retires it", () => {
  const transition = createPetWindowX11MapTransition(42);

  assert.equal(transition.acceptMapNotify({ name: "MapNotify", wid: 41 }), false);
  assert.equal(transition.acceptMapNotify({ name: "ConfigureNotify", wid: 42 }), false);
  assert.equal(transition.acceptMapNotify({ name: "MapNotify", wid: 42 }), true);
  assert.equal(transition.acceptMapNotify({ name: "MapNotify", wid: 42 }), false);

  const cancelled = createPetWindowX11MapTransition(43);
  cancelled.cancel();
  assert.equal(cancelled.isCancelled(), true);
  assert.equal(cancelled.acceptMapNotify({ name: "MapNotify", wid: 43 }), false);
});
