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
  _setIsPetWindowThrownForTesting,
  _resetMotionStatesForTesting,
  motionCancelMove,
  motionSetPhysics,
  motionMoveTo,
  motionCancelMoveForDrag,
  motionSetAutomaticMovement,
  motionClearAutomaticMovementForOwner,
  motionStop,
  unregisterPet,
} from "../src/pet-motion-engine.js";
import { resolveDragThrowVelocity } from "../src/pet-throw-core.js";
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
// (5) Starting a drag cancels only that window's current move-to target
// ---------------------------------------------------------------------------
{
  _resetMotionStatesForTesting();
  const dragging = new Set<object>();
  _setIsPetWindowDraggingForTesting((window) => dragging.has(window));

  const makeWindow = (initialX: number) => {
    let currentPos = { x: initialX, y: 100 };
    const writes: Array<{ x: number; y: number }> = [];
    const window = {
      isDestroyed: () => false,
      isVisible: () => true,
      getPosition: (): [number, number] => [currentPos.x, currentPos.y],
      setBounds: (bounds: { x: number; y: number }) => {
        writes.push({ x: bounds.x, y: bounds.y });
        currentPos = { x: bounds.x, y: bounds.y };
      },
      setCurrentPosition: (position: { x: number; y: number }) => { currentPos = position; },
      getCurrentPosition: () => currentPos,
      writes,
    };
    return window;
  };

  const draggedWindow = makeWindow(100);
  const otherWindow = makeWindow(200);
  const draggedAccessor = () => draggedWindow as any;
  const otherAccessor = () => otherWindow as any;
  const draggedMove = motionMoveTo("drag-cancel-first", draggedAccessor, { x: 500, y: 100 }, { durationMs: 300 });
  const otherMove = motionMoveTo("drag-cancel-second", otherAccessor, { x: 600, y: 100 }, { durationMs: 300 });

  await new Promise<void>((resolve) => setTimeout(resolve, 80));
  assert.ok(draggedWindow.writes.length > 0, "(5) first pet was moving before drag");
  assert.ok(otherWindow.writes.length > 0, "(5) second pet was moving independently");

  dragging.add(draggedWindow);
  draggedWindow.setCurrentPosition({ x: 720, y: 260 });
  const interruptedMove = motionCancelMoveForDrag(draggedWindow as any);
  assert.equal(interruptedMove, true, "(5) drag start reports that it interrupted active movement");
  const draggedWritesAtRelease = draggedWindow.writes.length;
  dragging.delete(draggedWindow);

  await Promise.all([draggedMove, otherMove]);
  await new Promise<void>((resolve) => setTimeout(resolve, 50));

  assert.equal(draggedWindow.writes.length, draggedWritesAtRelease, "(5) cancelled pet receives no stale movement writes after drag release");
  assert.deepEqual(draggedWindow.getCurrentPosition(), { x: 720, y: 260 }, "(5) dragged pet remains at its released position");
  assert.deepEqual(otherWindow.getCurrentPosition(), { x: 600, y: 100 }, "(5) other pet completes its own move");
  assert.equal(motionCancelMoveForDrag(draggedWindow as any), false, "(5) an idle pet is not reported as moving");

  motionStop("drag-cancel-first");
  motionStop("drag-cancel-second");
}

// ---------------------------------------------------------------------------
// (6) Walkabout yields to throw physics after a drag release
// ---------------------------------------------------------------------------
{
  _resetMotionStatesForTesting();
  const dragging = new Set<object>();
  const thrown = new Set<object>();
  _setIsPetWindowDraggingForTesting((window) => dragging.has(window));
  _setIsPetWindowThrownForTesting((window) => thrown.has(window));

  let currentPos = { x: 100, y: 100 };
  const writes: Array<{ x: number; y: number }> = [];
  const draggedWindow = {
    isDestroyed: () => false,
    isVisible: () => true,
    getPosition: (): [number, number] => [currentPos.x, currentPos.y],
    setBounds: (bounds: { x: number; y: number }) => {
      writes.push({ x: bounds.x, y: bounds.y });
      currentPos = { x: bounds.x, y: bounds.y };
    },
    setCurrentPosition: (position: { x: number; y: number }) => { currentPos = position; },
    getCurrentPosition: () => currentPos,
    writes,
  };
  const accessor = () => draggedWindow as any;

  const originalMove = motionMoveTo("throw-owns-window", accessor, { x: 500, y: 100 }, { durationMs: 300 });
  await new Promise<void>((resolve) => setTimeout(resolve, 80));
  assert.ok(writes.length > 0, "(6) Walkabout moved the pet before the drag");

  dragging.add(draggedWindow);
  draggedWindow.setCurrentPosition({ x: 720, y: 260 });
  motionCancelMoveForDrag(draggedWindow as any);
  dragging.delete(draggedWindow);
  await originalMove;

  thrown.add(draggedWindow);
  const writesAtThrowStart = writes.length;
  const moveDuringThrow = motionMoveTo("throw-owns-window", accessor, { x: 100, y: 100 }, { durationMs: 300 });
  await new Promise<void>((resolve) => setTimeout(resolve, 100));

  assert.equal(writes.length, writesAtThrowStart, "(6) Walkabout makes no position writes while throw physics owns the window");
  assert.deepEqual(currentPos, { x: 720, y: 260 }, "(6) the pet stays at its released position while being thrown");

  await moveDuringThrow;
  thrown.delete(draggedWindow);
  motionStop("throw-owns-window");
}

// ---------------------------------------------------------------------------
// (7) Persistent automatic movement ownership suppresses fling during idle gaps
// ---------------------------------------------------------------------------
{
  _resetMotionStatesForTesting();
  const makeWindow = () => ({
    isDestroyed: () => false,
    getPosition: (): [number, number] => [100, 100],
  });
  const walkaboutWindow = makeWindow();
  const idleWindow = makeWindow();
  const walkaboutAccessor = () => walkaboutWindow as any;
  const idleAccessor = () => idleWindow as any;

  motionSetAutomaticMovement("walkabout-pet", walkaboutAccessor, "openpets.walkabout", true);
  const interruptedWalkaboutMove = motionCancelMoveForDrag(walkaboutWindow as any);
  assert.equal(interruptedWalkaboutMove, true, "(7) movement ownership remains active between movement steps");
  assert.equal(resolveDragThrowVelocity({ x: 1_500, y: 0 }, interruptedWalkaboutMove), null, "(7) a drag in an idle gap lands without starting throw physics");
  assert.equal(motionCancelMoveForDrag(idleWindow as any), false, "(7) movement ownership does not leak to another pet");

  motionSetAutomaticMovement("walkabout-pet", walkaboutAccessor, "openpets.walkabout", false);
  assert.equal(motionCancelMoveForDrag(walkaboutWindow as any), false, "(7) disabling Walkabout restores normal drag behavior");

  motionSetAutomaticMovement("walkabout-pet", walkaboutAccessor, "openpets.walkabout", true);
  motionSetAutomaticMovement("walkabout-pet", walkaboutAccessor, "another.plugin", true);
  motionClearAutomaticMovementForOwner("openpets.walkabout");
  assert.equal(motionCancelMoveForDrag(walkaboutWindow as any), true, "(7) teardown only clears the stopping plugin's ownership");
  motionClearAutomaticMovementForOwner("another.plugin");
  assert.equal(motionCancelMoveForDrag(walkaboutWindow as any), false, "(7) final owner cleanup restores normal drag behavior");

  motionSetAutomaticMovement("unpinned-pet", idleAccessor, "openpets.walkabout", true);
  assert.equal(motionCancelMoveForDrag(idleWindow as any), true, "(7) a paused pin remains protected from fling physics");
  unregisterPet("unpinned-pet");
  assert.equal(motionCancelMoveForDrag(idleWindow as any), false, "(7) unpinning removes its movement ownership state");
}

// ---------------------------------------------------------------------------
// (8) Canceling a move stops interpolation but leaves gravity running
// ---------------------------------------------------------------------------
{
  _resetMotionStatesForTesting();
  _setIsPetWindowDraggingForTesting(() => false);

  const petId = "cancel-move-preserves-physics";
  let currentPos = { x: 100, y: 100 };
  const mockWindow = {
    isDestroyed: () => false,
    isVisible: () => true,
    getPosition: (): [number, number] => [currentPos.x, currentPos.y],
    setPosition: (x: number, y: number) => { currentPos = { x, y }; },
    setBounds: (bounds: { x: number; y: number }) => { currentPos = { x: bounds.x, y: bounds.y }; },
  } as any;
  const accessor = () => mockWindow;

  motionSetPhysics(petId, accessor, { gravity: true, bounce: 0 });
  const movePromise = motionMoveTo(petId, accessor, { x: 400, y: 100 }, { durationMs: 1_000 });
  await new Promise<void>((resolve) => setTimeout(resolve, 80));
  motionCancelMove(petId);
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  await movePromise;

  const xAfterCancel = currentPos.x;
  await new Promise<void>((resolve) => setTimeout(resolve, 80));
  assert.equal(currentPos.x, xAfterCancel, "(8) cancelMove stops the horizontal target interpolation");
  assert.ok(currentPos.y > 100, "(8) cancelMove leaves gravity active");

  motionStop(petId);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
_resetMotionStatesForTesting();
setDisplayScreen(null);
_setScreenForTesting(null);
_setIsPetWindowDraggingForTesting(null);
_setIsPetWindowThrownForTesting(null);

console.log("pet-motion-engine-hidden-move tests passed.");
