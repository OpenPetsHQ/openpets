import assert from "node:assert/strict";
import { test } from "node:test";
import { getDragUpdate } from "../src/webview/companion-core.js";

test("a drag returning to its press point cannot trigger a click", () => {
  const gesture = {
    start: { x: 20, y: 30 },
    origin: { x: 10, y: 10 },
    crossedThreshold: false,
  };
  const bounds = { width: 200, height: 180 };
  const sprite = { width: 96, height: 104 };
  const moved = getDragUpdate(gesture, { x: 60, y: 70 }, bounds, sprite);
  const returned = getDragUpdate(
    { ...gesture, crossedThreshold: moved.crossedThreshold },
    gesture.start,
    bounds,
    sprite,
  );
  assert.equal(returned.crossedThreshold, true);
  assert.deepEqual(returned.position, gesture.origin);
});

test("press jitter leaves position unchanged; a drag is contained in caption-adjusted bounds", () => {
  const gesture = {
    start: { x: 20, y: 30 },
    origin: { x: 10, y: 10 },
    crossedThreshold: false,
  };
  const bounds = { width: 200, height: 180 };
  const sprite = { width: 96, height: 104 };
  assert.deepEqual(getDragUpdate(gesture, { x: 21, y: 32 }, bounds, sprite), {
    crossedThreshold: false,
    position: gesture.origin,
  });
  assert.deepEqual(
    getDragUpdate(gesture, { x: 999, y: 999 }, bounds, sprite).position,
    {
      x: 104,
      y: 76,
    },
  );
});
