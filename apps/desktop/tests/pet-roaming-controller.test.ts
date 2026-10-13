/**
 * Unit tests for pet-roaming-controller.ts (Phase C).
 *
 * Verifies:
 * 1. registerRoamingPet registers the pet in the motion engine with NO gravity
 *    by default (petGravityEnabled defaults to false).
 * 2. unregisterRoamingPet removes the pet from the engine.
 * 3. applyRoamingToAllPets re-applies the current gravity config to all live pets.
 * 4. unregisterRoamingPet on unknown petId is a no-op.
 * 5. With gravity pref ON: a registered pet has physics.gravity === true.
 * 6. With gravity pref OFF: a registered pet has physics === null.
 * 7. applyRoamingToAllPets propagates a pref change to all live pets immediately.
 *
 * `petGravityEnabled` (default false) is the host-level single source-of-truth
 * for gravity, applied uniformly to all registered pets.
 *
 * NOTE: gravity pref is injected via _setGravityEnabledForTesting() rather than
 * calling setPetGravityEnabled() directly because app-state.ts imports Electron
 * at module level and cannot be loaded in the plain-node test runner.
 */
import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach } from "node:test";
import { defaultPetBounciness } from "../src/app-state-core.js";

import {
  _setScreenForTesting,
  _setIsPetWindowDraggingForTesting,
  _sharedTickerActiveForTesting,
  _resetMotionStatesForTesting,
  _getPhysicsForTesting,
} from "../src/pet-motion-engine.js";
import { _setScreenForTesting as setDisplayScreen } from "../src/display.js";
import {
  registerRoamingPet,
  unregisterRoamingPet,
  applyRoamingToAllPets,
  _resetLivePetsForTesting,
  _setGravityEnabledForTesting,
} from "../src/pet-roaming-controller.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockScreen = {
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
  getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
};

type MockWindow = {
  getPosition(): [number, number];
  isDestroyed(): boolean;
  isVisible(): boolean;
  setPosition(x: number, y: number, animate: boolean): void;
};

function makeWindow(): MockWindow {
  let pos: [number, number] = [100, 800];
  return {
    getPosition: () => [...pos] as [number, number],
    isDestroyed: () => false,
    isVisible: () => true,
    setPosition: (x: number, y: number) => { pos = [x, y]; },
  };
}

function makeAccessor(win: MockWindow) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return () => win as any;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

before(() => {
  _setScreenForTesting(mockScreen);
  setDisplayScreen(mockScreen);
  _setIsPetWindowDraggingForTesting(() => false);
});

after(() => {
  _setScreenForTesting(null);
  setDisplayScreen(null);
  _setIsPetWindowDraggingForTesting(null);
  _resetMotionStatesForTesting();
  _setGravityEnabledForTesting(null); // clear override — restore real pref
});

beforeEach(() => {
  _resetMotionStatesForTesting();
  _resetLivePetsForTesting();
  _setGravityEnabledForTesting(false); // default OFF for all tests
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pet-roaming-controller", () => {
  it("registerRoamingPet creates entry; shared ticker starts when motion begins", () => {
    const win = makeWindow();
    const accessor = makeAccessor(win);

    assert.equal(_sharedTickerActiveForTesting(), false, "ticker should be inactive before registration");

    registerRoamingPet("test-pet", accessor);

    // petGravityEnabled defaults to false → no physics → no shared ticker.
    assert.equal(_sharedTickerActiveForTesting(), false, "ticker must NOT start: no gravity by default");
    // Physics state must be null (gravity: false → state.physics = null).
    assert.equal(_getPhysicsForTesting("test-pet"), null, "physics must be null after registerRoamingPet (default gravity off)");
  });

  it("unregisterRoamingPet removes the entry", () => {
    const win = makeWindow();
    const accessor = makeAccessor(win);

    registerRoamingPet("test-pet-2", accessor);
    // No gravity → ticker was never started.
    assert.equal(_sharedTickerActiveForTesting(), false, "ticker inactive after register (no gravity)");
    assert.equal(_getPhysicsForTesting("test-pet-2"), null, "no physics on registered pet");

    unregisterRoamingPet("test-pet-2");

    // Pet removed from motion engine; physics entry is gone.
    assert.equal(_getPhysicsForTesting("test-pet-2"), null, "physics gone after unregister");
    assert.equal(_sharedTickerActiveForTesting(), false, "ticker remains inactive after unregister");
  });

  it("applyRoamingToAllPets re-applies no-gravity config to all live pets", () => {
    const win1 = makeWindow();
    const win2 = makeWindow();
    const accessor1 = makeAccessor(win1);
    const accessor2 = makeAccessor(win2);

    registerRoamingPet("pet-a", accessor1);
    registerRoamingPet("pet-b", accessor2);

    // Both pets registered with no gravity.
    assert.equal(_sharedTickerActiveForTesting(), false, "ticker inactive — no gravity for any pet");
    assert.equal(_getPhysicsForTesting("pet-a"), null, "pet-a: no gravity after register");
    assert.equal(_getPhysicsForTesting("pet-b"), null, "pet-b: no gravity after register");

    // Re-apply roaming — should not throw; no-gravity state preserved.
    applyRoamingToAllPets();

    assert.equal(_sharedTickerActiveForTesting(), false, "ticker stays inactive after applyRoamingToAllPets");
    assert.equal(_getPhysicsForTesting("pet-a"), null, "pet-a: still no gravity after reapply");
    assert.equal(_getPhysicsForTesting("pet-b"), null, "pet-b: still no gravity after reapply");

    unregisterRoamingPet("pet-a");
    unregisterRoamingPet("pet-b");
    assert.equal(_sharedTickerActiveForTesting(), false, "ticker still inactive after all pets removed");
  });

  it("unregisterRoamingPet on unknown petId is a no-op", () => {
    assert.doesNotThrow(() => unregisterRoamingPet("nonexistent-pet"));
  });

  // ---------------------------------------------------------------------------
  // petGravityEnabled ON — pet gets physics with gravity:true
  // ---------------------------------------------------------------------------
  it("petGravityEnabled ON: registerRoamingPet applies gravity physics", () => {
    _setGravityEnabledForTesting(true);

    const win = makeWindow();
    const accessor = makeAccessor(win);

    registerRoamingPet("gravity-on-pet", accessor);

    const physics = _getPhysicsForTesting("gravity-on-pet");
    assert.ok(physics !== null, "physics must be active when gravity is on");
    assert.equal(physics.gravity, true, "physics.gravity must be true");
    assert.equal(physics.bounce, defaultPetBounciness, "physics.bounce must follow the bounciness default");
    // Ticker starts because physics is active.
    assert.equal(_sharedTickerActiveForTesting(), true, "shared ticker starts with gravity enabled");

    unregisterRoamingPet("gravity-on-pet");
    _setGravityEnabledForTesting(false);
  });

  // ---------------------------------------------------------------------------
  // petGravityEnabled OFF — pet has no gravity (physics null)
  // ---------------------------------------------------------------------------
  it("petGravityEnabled OFF: registerRoamingPet does not apply gravity", () => {
    _setGravityEnabledForTesting(false);

    const win = makeWindow();
    const accessor = makeAccessor(win);

    registerRoamingPet("gravity-off-pet", accessor);

    assert.equal(_getPhysicsForTesting("gravity-off-pet"), null, "physics must be null when gravity is off");
    assert.equal(_sharedTickerActiveForTesting(), false, "ticker must not start without gravity");

    unregisterRoamingPet("gravity-off-pet");
  });

  // ---------------------------------------------------------------------------
  // applyRoamingToAllPets picks up pref change immediately (live toggle)
  // ---------------------------------------------------------------------------
  it("applyRoamingToAllPets propagates gravity pref change to live pets", () => {
    _setGravityEnabledForTesting(false);

    const win = makeWindow();
    const accessor = makeAccessor(win);
    registerRoamingPet("live-toggle-pet", accessor);

    assert.equal(_getPhysicsForTesting("live-toggle-pet"), null, "start: no gravity");

    // Enable gravity and reapply to all live pets.
    _setGravityEnabledForTesting(true);
    applyRoamingToAllPets();

    const physics = _getPhysicsForTesting("live-toggle-pet");
    assert.ok(physics !== null, "after enable: physics must be active");
    assert.equal(physics.gravity, true, "after enable: gravity is true");

    // Disable gravity and reapply.
    _setGravityEnabledForTesting(false);
    applyRoamingToAllPets();

    assert.equal(_getPhysicsForTesting("live-toggle-pet"), null, "after disable: physics back to null");

    unregisterRoamingPet("live-toggle-pet");
  });
});
