/**
 * Unit tests for the shared ticker introduced in Phase B of the motion engine refactor.
 *
 * Verifies:
 * 1. registerPet creates entry and shared ticker starts when motion begins.
 * 2. unregisterPet removes entry from motionStates.
 * 3. Shared ticker stops automatically when no pets have active motion.
 * 4. Multiple pets share one ticker; ticker stops only after all are unregistered.
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";

import {
  _setScreenForTesting,
  _setIsPetWindowDraggingForTesting,
  _sharedTickerActiveForTesting,
  _resetMotionStatesForTesting,
  registerPet,
  unregisterPet,
  motionSetPhysics,
  motionStop,
} from "../src/pet-motion-engine.js";
import { _setScreenForTesting as setDisplayScreen, invalidateDisplayCache, setCrossDisplayRoamingEnabled } from "../src/display.js";

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const mockScreen = {
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
  getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
};

function makeAccessor() {
  return () => ({
    getPosition: (): [number, number] => [100, 100],
    isDestroyed: () => false,
    isVisible: () => true,
    setPosition: (_x: number, _y: number) => {},
    setBounds: (_bounds: { x: number; y: number }) => {},
  } as any);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("shared ticker", () => {
  before(() => {
    setDisplayScreen(mockScreen as any);
    invalidateDisplayCache();
    setCrossDisplayRoamingEnabled(false);
    _setScreenForTesting(mockScreen as any);
    _setIsPetWindowDraggingForTesting(() => false);
    _resetMotionStatesForTesting();
  });

  after(() => {
    _resetMotionStatesForTesting();
    setDisplayScreen(null);
    _setScreenForTesting(null);
    _setIsPetWindowDraggingForTesting(null);
  });

  it("registerPet creates entry; shared ticker starts when motion begins", () => {
    _resetMotionStatesForTesting();
    const accessor = makeAccessor();
    registerPet("pet-register-test", accessor);
    // Ticker should not be running yet — no motion requested
    assert.equal(_sharedTickerActiveForTesting(), false, "no ticker before motion is set");
    // Now start physics — ticker should start
    motionSetPhysics("pet-register-test", accessor, { gravity: true, bounce: 0.4 });
    assert.equal(_sharedTickerActiveForTesting(), true, "shared ticker active after motionSetPhysics");
    // Cleanup
    unregisterPet("pet-register-test");
  });

  it("unregisterPet removes the entry", () => {
    _resetMotionStatesForTesting();
    const accessor = makeAccessor();
    registerPet("pet-unreg-test", accessor);
    motionSetPhysics("pet-unreg-test", accessor, { gravity: true, bounce: 0.4 });
    unregisterPet("pet-unreg-test");
    // After unregister, ticker should stop (no more active pets)
    assert.equal(_sharedTickerActiveForTesting(), false, "ticker stops after unregisterPet");
    // Calling unregisterPet again should not throw
    assert.doesNotThrow(() => unregisterPet("pet-unreg-test"), "safe to call unregisterPet twice");
  });

  it("shared ticker stops when all pets stop motion", async () => {
    _resetMotionStatesForTesting();
    const accessor = makeAccessor();
    registerPet("pet-stop-test", accessor);
    motionSetPhysics("pet-stop-test", accessor, { gravity: true, bounce: 0.4 });
    assert.equal(_sharedTickerActiveForTesting(), true, "ticker running after physics start");
    // Stop the motion — tickAll will detect no active pets on next tick and stop
    motionStop("pet-stop-test");
    // Wait for ticker to fire and self-stop
    await new Promise<void>((resolve) => setTimeout(resolve, loopIntervalMs * 3));
    assert.equal(_sharedTickerActiveForTesting(), false, "ticker stops after all pets have no motion");
    unregisterPet("pet-stop-test");
  });

  it("multiple pets share one ticker; ticker stops after all are removed", () => {
    _resetMotionStatesForTesting();
    const accessor1 = makeAccessor();
    const accessor2 = makeAccessor();
    registerPet("pet-multi-1", accessor1);
    registerPet("pet-multi-2", accessor2);
    motionSetPhysics("pet-multi-1", accessor1, { gravity: true, bounce: 0.4 });
    motionSetPhysics("pet-multi-2", accessor2, { gravity: true, bounce: 0.4 });
    assert.equal(_sharedTickerActiveForTesting(), true, "ticker active with 2 pets");
    // Remove first pet — ticker still active (second pet still running)
    unregisterPet("pet-multi-1");
    assert.equal(_sharedTickerActiveForTesting(), true, "ticker still active after removing first pet");
    // Remove second pet — ticker should stop
    unregisterPet("pet-multi-2");
    assert.equal(_sharedTickerActiveForTesting(), false, "ticker stops after all pets removed");
  });
});

// Expose loop interval for the stop test
const loopIntervalMs = 16;
