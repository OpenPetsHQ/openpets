import assert from "node:assert/strict";
import { register } from "node:module";
import { petActivityFixture } from "./pet-activity-fixtures.js";

// The shared metadata contract must remain usable without desktop/image I/O.
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "sharp" || specifier === "electron" || specifier.startsWith("node:fs")) {
      throw new Error("Pet activity metadata cannot depend on " + specifier);
    }
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

const { validatePetActivities, getPetActivityDurationMs } = await import("../src/pet-activities-core.js");
const activities = validatePetActivities([petActivityFixture]);
assert.equal(getPetActivityDurationMs(activities[0]!), 2_000);
console.log("Pet activity pure import passed.");
