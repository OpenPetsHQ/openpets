/**
 * Unit tests for pinned-pets.ts (pure decisions that drive the pinned pet windows).
 *
 * Covers:
 *   - normalizePinnedPetIds: shape filtering, trimming, dedup, cap, safe-id check.
 *   - normalizePinnedPetPositions: per-pet position validation.
 *   - prunePinnedPetPositions: positions of unpinned pets never survive a write.
 *   - planPinnedPets: which pinned windows must open / close, and that a pin for a pet
 *     that is no longer eligible never opens a window.
 */
import assert from "node:assert/strict";

import { maxPinnedPets, normalizePinnedPetIds, normalizePinnedPetPositions, planPinnedPets, prunePinnedPetPositions } from "../src/pinned-pets.js";

// ---------------------------------------------------------------------------
// normalizePinnedPetIds
// ---------------------------------------------------------------------------
assert.equal(normalizePinnedPetIds(undefined), undefined, "undefined -> undefined");
assert.equal(normalizePinnedPetIds(null), undefined, "null -> undefined");
assert.equal(normalizePinnedPetIds("fox"), undefined, "string -> undefined");
assert.equal(normalizePinnedPetIds(42), undefined, "number -> undefined");
assert.equal(normalizePinnedPetIds({}), undefined, "object -> undefined");

// Empty / blank / non-string entries leave nothing pinned.
assert.equal(normalizePinnedPetIds([]), undefined, "empty array -> undefined");
assert.equal(normalizePinnedPetIds(["", "   "]), undefined, "blank entries -> undefined");
assert.equal(normalizePinnedPetIds([null, undefined, 5]), undefined, "non-strings -> undefined");

// Valid IDs are kept in order, trimmed, and deduped.
assert.deepEqual(normalizePinnedPetIds(["fox"]), ["fox"], "single valid id");
assert.deepEqual(normalizePinnedPetIds(["fox", "azure"]), ["fox", "azure"], "order preserved");
assert.deepEqual(normalizePinnedPetIds(["  fox  "]), ["fox"], "trims whitespace");
assert.deepEqual(normalizePinnedPetIds(["fox", "azure", "fox"]), ["fox", "azure"], "dedup keeps first occurrence");

// Unsafe IDs never reach the window layer.
assert.equal(normalizePinnedPetIds(["../bad-pet"]), undefined, "unsafe id filtered");
assert.equal(normalizePinnedPetIds(["bad/pet"]), undefined, "slash in id filtered");
assert.deepEqual(normalizePinnedPetIds(["fox", "../bad", "azure"]), ["fox", "azure"], "mixed keeps valid only");

// The cap bounds how many OS windows a single preference can open.
{
  const many = Array.from({ length: 12 }, (_, i) => `pet-${String(i).padStart(3, "0")}`);
  const result = normalizePinnedPetIds(many);
  assert.ok(Array.isArray(result), "capped list is an array");
  assert.equal((result as string[]).length, maxPinnedPets, `caps at ${String(maxPinnedPets)}`);
  assert.deepEqual(result, many.slice(0, maxPinnedPets), "keeps the first entries in order");
}
{
  const exactly = Array.from({ length: maxPinnedPets }, (_, i) => `pet-${String(i).padStart(3, "0")}`);
  const result = normalizePinnedPetIds(exactly);
  assert.equal((result as string[]).length, maxPinnedPets, "exactly-at-cap input is preserved");
}

// ---------------------------------------------------------------------------
// normalizePinnedPetPositions
// ---------------------------------------------------------------------------
assert.equal(normalizePinnedPetPositions(undefined), undefined, "positions: undefined -> undefined");
assert.equal(normalizePinnedPetPositions(null), undefined, "positions: null -> undefined");
assert.equal(normalizePinnedPetPositions("fox"), undefined, "positions: string -> undefined");
assert.equal(normalizePinnedPetPositions([]), undefined, "positions: array -> undefined");
assert.equal(normalizePinnedPetPositions({}), undefined, "positions: empty object -> undefined");

assert.deepEqual(normalizePinnedPetPositions({ fox: { x: 10, y: 20 } }), { fox: { x: 10, y: 20 } }, "positions: valid entry kept");
assert.deepEqual(
  normalizePinnedPetPositions({ fox: { x: 10.4, y: 20.6 } }),
  { fox: { x: 10, y: 21 } },
  "positions: coordinates are rounded like the default pet position",
);
assert.deepEqual(
  normalizePinnedPetPositions({ fox: { x: 1, y: 2 }, azure: { x: 3, y: 4 } }),
  { fox: { x: 1, y: 2 }, azure: { x: 3, y: 4 } },
  "positions: multiple pets kept",
);
assert.deepEqual(
  normalizePinnedPetPositions({ fox: { x: 1, y: 2 }, azure: "nope" }),
  { fox: { x: 1, y: 2 } },
  "positions: invalid entry dropped",
);
assert.equal(normalizePinnedPetPositions({ "../bad": { x: 1, y: 2 } }), undefined, "positions: unsafe pet id dropped");
assert.equal(normalizePinnedPetPositions({ fox: { x: Number.NaN, y: 2 } }), undefined, "positions: non-finite dropped");

// ---------------------------------------------------------------------------
// planPinnedPets
// ---------------------------------------------------------------------------
const eligible = ["fox", "azure", "luna"];

assert.deepEqual(
  planPinnedPets({ pinnedPets: undefined, openPinnedPets: [], eligiblePetIds: eligible }),
  { spawn: [], close: [] },
  "nothing pinned, nothing open -> no work",
);
assert.deepEqual(
  planPinnedPets({ pinnedPets: ["fox", "azure"], openPinnedPets: [], eligiblePetIds: eligible }),
  { spawn: ["fox", "azure"], close: [] },
  "two pins, no windows -> both open in pin order",
);
assert.deepEqual(
  planPinnedPets({ pinnedPets: ["fox"], openPinnedPets: ["fox"], eligiblePetIds: eligible }),
  { spawn: [], close: [] },
  "already in sync -> idempotent",
);
assert.deepEqual(
  planPinnedPets({ pinnedPets: ["fox"], openPinnedPets: ["fox", "azure"], eligiblePetIds: eligible }),
  { spawn: [], close: ["azure"] },
  "unpinned pet -> its window closes",
);
assert.deepEqual(
  planPinnedPets({ pinnedPets: undefined, openPinnedPets: ["fox", "azure"], eligiblePetIds: eligible }),
  { spawn: [], close: ["fox", "azure"] },
  "clearing the preference closes every pinned window",
);
assert.deepEqual(
  planPinnedPets({ pinnedPets: ["fox", "gone"], openPinnedPets: [], eligiblePetIds: eligible }),
  { spawn: ["fox"], close: [] },
  "a pin for an uninstalled / ineligible pet never opens a window",
);
assert.deepEqual(
  planPinnedPets({ pinnedPets: ["gone"], openPinnedPets: ["gone"], eligiblePetIds: eligible }),
  { spawn: [], close: ["gone"] },
  "a pinned pet that became ineligible loses its window",
);
assert.deepEqual(
  planPinnedPets({ pinnedPets: ["luna"], openPinnedPets: ["fox"], eligiblePetIds: eligible }),
  { spawn: ["luna"], close: ["fox"] },
  "replacing a pin swaps the window",
);

// ---------------------------------------------------------------------------
// prunePinnedPetPositions
// ---------------------------------------------------------------------------
const positions = { fox: { x: 10, y: 20 }, luna: { x: 30, y: 40 } };
assert.deepEqual(
  prunePinnedPetPositions(positions, ["fox"]),
  { fox: { x: 10, y: 20 } },
  "positions of unpinned pets are dropped",
);
assert.equal(prunePinnedPetPositions(positions, []), undefined, "no pins -> no positions");
assert.equal(prunePinnedPetPositions(undefined, ["fox"]), undefined, "no positions -> undefined");
assert.equal(prunePinnedPetPositions(positions, undefined), undefined, "no pinned list -> undefined");
assert.deepEqual(
  prunePinnedPetPositions(positions, ["fox", "luna", "gone"]),
  positions,
  "positions of pets that are still pinned survive",
);
assert.deepEqual(
  prunePinnedPetPositions(positions, ["gone"]),
  undefined,
  "dropping the last pinned pet clears every position",
);

console.log("pinned-pets (plan + normalisation) validation passed.");
