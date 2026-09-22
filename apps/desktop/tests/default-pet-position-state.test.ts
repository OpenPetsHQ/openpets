import assert from "node:assert/strict";

import {
  isDisplayKey,
  normalizeDefaultPetPositionState,
  normalizePosition,
  recordDefaultPetPositionState,
  resetDefaultPetPositionState,
  type DefaultPetPositionState,
} from "../src/default-pet-position-state.js";

const displayKey = (index: number): string => `-${index},${index},${1000 + index}x${800 + index}`;

const initial = recordDefaultPetPositionState({}, { x: 10, y: 20 }, displayKey(0));
const recorded = recordDefaultPetPositionState(initial, { x: 30, y: 40 }, displayKey(1));
assert.deepEqual(recorded, {
  position: { x: 30, y: 40 },
  perMonitorPositions: {
    [displayKey(0)]: { x: 10, y: 20 },
    [displayKey(1)]: { x: 30, y: 40 },
  },
}, "a valid record updates flat and monitor positions together");

let lru: DefaultPetPositionState = {};
for (let index = 0; index < 9; index += 1) {
  lru = recordDefaultPetPositionState(lru, { x: index, y: index }, displayKey(index));
}
assert.equal(Object.keys(lru.perMonitorPositions ?? {}).length, 8, "the monitor map is capped at eight entries");
assert.equal(lru.perMonitorPositions?.[displayKey(0)], undefined, "the oldest monitor entry is evicted");
assert.deepEqual(Object.keys(lru.perMonitorPositions ?? {}), Array.from({ length: 8 }, (_, index) => displayKey(index + 1)), "new entries retain insertion order");

const refreshed = recordDefaultPetPositionState(lru, { x: 100, y: 100 }, displayKey(2));
assert.equal(Object.keys(refreshed.perMonitorPositions ?? {}).at(-1), displayKey(2), "an existing display update becomes newest");

const invalidKey = recordDefaultPetPositionState(recorded, { x: 50, y: 60 }, "not-a-display-key");
assert.deepEqual(invalidKey.position, { x: 50, y: 60 }, "an invalid display key still updates the flat fallback");
assert.deepEqual(invalidKey.perMonitorPositions, recorded.perMonitorPositions, "an invalid display key retains the valid monitor map");
assert.equal(isDisplayKey("0,0,1920x1080"), true);
assert.equal(isDisplayKey("0,0,1920X1080"), false);

assert.deepEqual(normalizePosition({ x: 10.6, y: -2.4 }), { x: 11, y: -2 }, "coordinates are rounded before persistence");
assert.equal(normalizePosition({ x: Number.NaN, y: 1 }), undefined, "NaN coordinates are rejected");
assert.equal(normalizePosition({ x: Number.POSITIVE_INFINITY, y: 1 }), undefined, "infinite coordinates are rejected");
assert.deepEqual(
  recordDefaultPetPositionState(recorded, { x: Number.NaN, y: 1 }, displayKey(2)),
  recorded,
  "a non-finite record does not replace a valid position state",
);
assert.deepEqual(normalizeDefaultPetPositionState({ position: { x: 1.5, y: 2.5 }, perMonitorPositions: { [displayKey(0)]: { x: 3.4, y: 4.6 } } }), {
  position: { x: 2, y: 3 },
  perMonitorPositions: { [displayKey(0)]: { x: 3, y: 5 } },
}, "persisted positions are normalized");

assert.deepEqual(resetDefaultPetPositionState({ x: 90.4, y: 80.6 }), { position: { x: 90, y: 81 } }, "reset replaces flat position and clears monitor entries");

console.log("Default pet position state validation passed.");
