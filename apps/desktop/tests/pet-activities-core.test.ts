import assert from "node:assert/strict";

import { getPetActivityDurationMs, validatePetActivities } from "../src/pet-activities-core.js";
import { validateCodexPetMetadata } from "../src/codex-pets-core.js";
import { codexV1Fixture } from "./codex-pet-fixtures.js";
import { petActivityFixture } from "./pet-activity-fixtures.js";

const activity = { ...petActivityFixture, displayName: " Dance " };

assert.deepEqual(validatePetActivities(undefined), []);
assert.deepEqual(validatePetActivities([]), []);
const validated = validatePetActivities([activity]);
assert.equal(validated[0]?.displayName, "Dance", "names are trimmed at the metadata boundary");
assert.equal(getPetActivityDurationMs(validated[0]!), 2_000);
assert.deepEqual(validateCodexPetMetadata({ ...codexV1Fixture, activities: [activity] }, "aiko").activities, validated);
assert.equal(validateCodexPetMetadata(codexV1Fixture, "aiko").activities, undefined, "existing packages keep their shape");

for (const fields of [
  { id: "a".repeat(32), spritesheetPath: `activities/${"a".repeat(32)}.webp` },
  { displayName: ` ${"a".repeat(40)} ` },
  { frameCount: 4, fps: 4 },
  { frameCount: 12, fps: 1 },
  { frameCount: 32, fps: 12 },
]) {
  assert.equal(validatePetActivities([{ ...activity, ...fields }]).length, 1);
}
const maxEntries = Array.from({ length: 16 }, (_, index) => ({
  ...activity,
  id: `dance_${index}`,
  spritesheetPath: `activities/dance_${index}.webp`,
}));
assert.equal(validatePetActivities(maxEntries).length, 16);

// Malformed optional data must reject the package, not be silently dropped.
for (const value of [null, {}, "dance", [null], new Array(1), [...maxEntries, activity], [activity, activity]]) {
  assert.throws(() => validatePetActivities(value));
}
for (const fields of [
  { id: "Dance" },
  { id: "-dance" },
  { id: "" },
  { id: "a".repeat(33) },
  { displayName: "   " },
  { displayName: "a".repeat(41) },
  { outfitId: "pajamas" },
  { outfitId: undefined },
  { spritesheetPath: "activities/other.webp" },
  { spritesheetPath: "activities/../dance.webp" },
  { spritesheetPath: "activities\\dance.webp" },
  { spritesheetPath: "/activities/dance.webp" },
  { spritesheetPath: "activities/dance.svg" },
  { frameCount: 3 },
  { frameCount: 33 },
  { frameCount: 4.5 },
  { frameCount: NaN },
  { fps: 0 },
  { fps: 13 },
  { fps: 1.5 },
  { fps: Infinity },
  { frameCount: 4, fps: 5 },
  { frameCount: 13, fps: 1 },
]) {
  assert.throws(() => validatePetActivities([{ ...activity, ...fields }]));
}
assert.throws(() => validateCodexPetMetadata({ ...codexV1Fixture, activities: null }, "aiko"));
console.log("Pet activity metadata contract passed.");
