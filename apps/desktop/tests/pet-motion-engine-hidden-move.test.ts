/**
 * Regression tests: hidden/dragging pet move resolution.
 *
 * Root cause guarded: tickPet()'s visibility/drag early-return used to skip
 * the moveTarget clock entirely, so motionMoveTo() promises never resolved
 * when the pet was hidden or being dragged.
 *
 * Fix: tickPet() now advances moveTarget.elapsed (and clears/bumps generation
 * when complete) even during hidden/dragging, but writes NO position and
 * applies NO gravity — preserving the single-writer model.
 *
 * Test cases:
 *   (1) Hidden pet: motionMoveTo resolves; setPosition never called.
 *   (2) Dragging pet: motionMoveTo resolves; setPosition never called.
 *   (3) Visible pet (no-regression): setPosition IS called; resolves normally.
 *   (4) Becomes-visible mid-move: no writes while hidden, writes resume after
 *       un-hide, move completes.
 *
 * Uses the same seams as pet-motion-engine-single-writer.test.ts.
 */

import assert from "node:assert/strict";
import {
  _setScreenForTesting,
  _setIsPetWindowDraggingForTesting,
  _resetMotionStatesForTesting,
  motionSetPhysics,
  motionMoveTo,
  motionStop,
} from "../src/pet-motion-engine.js";
import {
  _setScreenForTesting as setDisplayScreen,
  invalidateDisplayCache,
  setCrossDisplayRoamingEnabled,
} from "../src/display.js";

// ---------------------------------------------------------------------------
// Shared mock screen (identical to other motion-engine tests)
// ---------------------------------------------------------------------------

const mockScreen = {
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
  getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
};

setDisplayScreen(mockScreen as any);
invalidateDisplayCache();
_setScreenForTesting(mockScreen as any);
setCrossDisplayRoamingEnabled(false);

// ---------------------------------------------------------------------------
// (1) Hidden pet: motionMoveTo resolves; setPosition never called while hidden
// ---------------------------------------------------------------------------
{
  _resetMotionStatesForTesting();
  _setIsPetWindowDraggingForTesting(() => false);

  const petId = "hidden-move-1";
  const positions: Array<{ x: number; y: number }> = [];
  let currentPos = { x: 100, y: 100 };

  const mockWindow = {
    isDestroyed: () => false,
    isVisible: () => false, // always hidden
    getPosition: (): [number, number] => [currentPos.x, currentPos.y],
    setPosition: (x: number, y: number) => { positions.push({ x, y }); currentPos = { x, y }; },
    setBounds: (bounds: { x: number; y: number }) => { positions.push({ x: bounds.x, y: bounds.y }); currentPos = { x: bounds.x, y: bounds.y }; },
  } as any;
  const accessor = () => mockWindow;

  motionSetPhysics(petId, accessor, { gravity: true, bounce: 0 });

  const durationMs = 100;
  let resolved = false;
  const movePromise = motionMoveTo(petId, accessor, { x: 200, y: 100 }, { durationMs });
  void movePromise.then(() => { resolved = true; });

  assert.ok(!resolved, "(1) not resolved synchronously");

  // Wait durationMs + generous slack for the 16 ms ticker + 32 ms check poller
  await new Promise<void>((r) => setTimeout(r, durationMs + 250));

  assert.ok(resolved, "(1) hidden-pet: promise resolves once clock advances via fix");
  assert.equal(positions.length, 0, "(1) hidden-pet: setPosition never called while hidden");

  motionStop(petId);
}

// ---------------------------------------------------------------------------
// (2) Dragging pet: motionMoveTo resolves; setPosition never called while dragging
// ---------------------------------------------------------------------------
{
  _resetMotionStatesForTesting();
  _setIsPetWindowDraggingForTesting(() => true); // always dragging

  const petId = "hidden-move-2";
  const positions: Array<{ x: number; y: number }> = [];
  let currentPos = { x: 100, y: 100 };

  const mockWindow = {
    isDestroyed: () => false,
    isVisible: () => true, // visible but dragging
    getPosition: (): [number, number] => [currentPos.x, currentPos.y],
    setPosition: (x: number, y: number) => { positions.push({ x, y }); currentPos = { x, y }; },
    setBounds: (bounds: { x: number; y: number }) => { positions.push({ x: bounds.x, y: bounds.y }); currentPos = { x: bounds.x, y: bounds.y }; },
  } as any;
  const accessor = () => mockWindow;

  motionSetPhysics(petId, accessor, { gravity: true, bounce: 0 });

  const durationMs = 100;
  let resolved = false;
  const movePromise = motionMoveTo(petId, accessor, { x: 200, y: 100 }, { durationMs });
  void movePromise.then(() => { resolved = true; });

  assert.ok(!resolved, "(2) not resolved synchronously");

  await new Promise<void>((r) => setTimeout(r, durationMs + 250));

  assert.ok(resolved, "(2) dragging-pet: promise resolves once clock advances via fix");
  assert.equal(positions.length, 0, "(2) dragging-pet: setPosition never called while dragging");

  _setIsPetWindowDraggingForTesting(() => false);
  motionStop(petId);
}

// ---------------------------------------------------------------------------
// (3) Visible pet (no regression): setPosition IS called; promise resolves
// ---------------------------------------------------------------------------
{
  _resetMotionStatesForTesting();
  _setIsPetWindowDraggingForTesting(() => false);

  const petId = "hidden-move-3";
  const positions: Array<{ x: number; y: number }> = [];
  let currentPos = { x: 100, y: 100 };

  const mockWindow = {
    isDestroyed: () => false,
    isVisible: () => true,
    getPosition: (): [number, number] => [currentPos.x, currentPos.y],
    setPosition: (x: number, y: number) => { positions.push({ x, y }); currentPos = { x, y }; },
    setBounds: (bounds: { x: number; y: number }) => { positions.push({ x: bounds.x, y: bounds.y }); currentPos = { x: bounds.x, y: bounds.y }; },
  } as any;
  const accessor = () => mockWindow;

  motionSetPhysics(petId, accessor, { gravity: true, bounce: 0 });

  const durationMs = 100;
  let resolved = false;
  const movePromise = motionMoveTo(petId, accessor, { x: 200, y: 100 }, { durationMs });
  void movePromise.then(() => { resolved = true; });

  await new Promise<void>((r) => setTimeout(r, durationMs + 250));

  assert.ok(resolved, "(3) visible pet: promise resolves");
  assert.ok(positions.length > 0, "(3) visible pet: setPosition WAS called (gravity + move)");

  motionStop(petId);
}

// ---------------------------------------------------------------------------
// (4) Becomes-visible mid-move: clock advances while hidden; position writes
//     resume after un-hiding; move completes
// ---------------------------------------------------------------------------
{
  _resetMotionStatesForTesting();
  _setIsPetWindowDraggingForTesting(() => false);

  const petId = "hidden-move-4";
  const positions: Array<{ x: number; y: number }> = [];
  let currentPos = { x: 100, y: 100 };
  let isVisible = false;

  const mockWindow = {
    isDestroyed: () => false,
    isVisible: () => isVisible,
    getPosition: (): [number, number] => [currentPos.x, currentPos.y],
    setPosition: (x: number, y: number) => { positions.push({ x, y }); currentPos = { x, y }; },
    setBounds: (bounds: { x: number; y: number }) => { positions.push({ x: bounds.x, y: bounds.y }); currentPos = { x: bounds.x, y: bounds.y }; },
  } as any;
  const accessor = () => mockWindow;

  motionSetPhysics(petId, accessor, { gravity: true, bounce: 0 });

  const durationMs = 200;
  let resolved = false;
  const movePromise = motionMoveTo(petId, accessor, { x: 300, y: 100 }, { durationMs });
  void movePromise.then(() => { resolved = true; });

  // Phase 1: wait while hidden — clock advances via fix but no position writes
  await new Promise<void>((r) => setTimeout(r, 60));
  assert.equal(positions.length, 0, "(4) no setPosition calls while hidden");
  assert.ok(!resolved, "(4) not resolved yet during hidden phase");

  // Flip to visible
  isVisible = true;

  // Phase 2: wait for remaining ticks + slack
  await new Promise<void>((r) => setTimeout(r, durationMs + 300));

  assert.ok(resolved, "(4) move resolves after becoming visible");
  assert.ok(positions.length > 0, "(4) setPosition called after becoming visible");

  motionStop(petId);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
_resetMotionStatesForTesting();
setDisplayScreen(null);
_setScreenForTesting(null);
_setIsPetWindowDraggingForTesting(null);

console.log("pet-motion-engine-hidden-move tests passed.");
