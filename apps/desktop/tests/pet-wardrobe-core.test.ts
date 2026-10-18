import assert from "node:assert/strict";

import {
  normalizePetWardrobePreferences,
  resolveWornOutfitId,
  validatePetWardrobe,
  type PetWardrobe,
} from "../src/pet-wardrobe-core.js";

const wardrobe: PetWardrobe = validatePetWardrobe({
  outfits: [
    { id: "pajamas", displayName: "Pajamas", spritesheetPath: "outfits/pajamas.webp" },
    { id: "weekend", displayName: "Weekend", spritesheetPath: "outfits/weekend.webp" },
    { id: "santa", displayName: "Santa", spritesheetPath: "outfits/santa.svg" },
  ],
  schedule: [
    { outfit: "santa", when: { dates: { from: "12-20", to: "01-02" } } },
    { outfit: "pajamas", when: { time: { from: "22:00", to: "07:00" } } },
    { outfit: "weekend", when: { days: ["sat", "sun"] } },
  ],
});

// Local-time dates: 2026-03-04 is a Wednesday, 2026-03-07 a Saturday.
const wednesdayNoon = new Date(2026, 2, 4, 12, 0);
const wednesdayLate = new Date(2026, 2, 4, 23, 30);
const thursdayEarly = new Date(2026, 2, 5, 6, 59);
const thursdaySeven = new Date(2026, 2, 5, 7, 0);
const saturdayNoon = new Date(2026, 2, 7, 12, 0);
const saturdayLate = new Date(2026, 2, 7, 23, 0);
const newYearsDay = new Date(2027, 0, 1, 12, 0);
const christmasNight = new Date(2026, 11, 25, 23, 0);

// Existing pets have no wardrobe and must keep rendering their only sheet.
assert.equal(resolveWornOutfitId(undefined, undefined, wednesdayLate), "default");
assert.equal(resolveWornOutfitId(undefined, { outfit: "pajamas" }, wednesdayLate), "default");

// Creator schedule: ordered, first match wins, ranges wrap midnight and the new year.
assert.equal(resolveWornOutfitId(wardrobe, undefined, wednesdayNoon), "default", "no rule matches a weekday noon");
assert.equal(resolveWornOutfitId(wardrobe, undefined, wednesdayLate), "pajamas");
assert.equal(resolveWornOutfitId(wardrobe, undefined, thursdayEarly), "pajamas", "a time range wraps past midnight");
assert.equal(resolveWornOutfitId(wardrobe, undefined, thursdaySeven), "default", "the end time is exclusive");
assert.equal(resolveWornOutfitId(wardrobe, undefined, saturdayNoon), "weekend");
assert.equal(resolveWornOutfitId(wardrobe, undefined, saturdayLate), "pajamas", "an earlier rule beats a later one");
assert.equal(resolveWornOutfitId(wardrobe, undefined, christmasNight), "santa", "a holiday listed first beats pajamas");
assert.equal(resolveWornOutfitId(wardrobe, undefined, newYearsDay), "santa", "a date range wraps the new year");

// User preferences: "always wear" beats every rule; a user schedule replaces the creator's.
assert.equal(resolveWornOutfitId(wardrobe, { outfit: "weekend" }, christmasNight), "weekend");
assert.equal(resolveWornOutfitId(wardrobe, { outfit: "default" }, christmasNight), "default");
assert.equal(resolveWornOutfitId(wardrobe, { schedule: [] }, christmasNight), "default", "an empty user schedule turns automatic changes off");
assert.equal(resolveWornOutfitId(wardrobe, { schedule: [{ outfit: "weekend", when: { days: ["wed"] } }] }, wednesdayLate), "weekend");
assert.equal(
  resolveWornOutfitId(wardrobe, { schedule: [{ outfit: "pajamas", when: { days: ["wed"] }, enabled: false }, { outfit: "santa", when: { days: ["wed"] } }] }, wednesdayNoon),
  "santa",
  "a disabled rule never matches",
);

// A pet update that drops an outfit must fall back instead of breaking the pet.
assert.equal(resolveWornOutfitId(wardrobe, { outfit: "removed" }, wednesdayLate), "pajamas");
assert.equal(resolveWornOutfitId(wardrobe, { schedule: [{ outfit: "removed", when: { days: ["wed"] } }] }, wednesdayNoon), "default");

// Persisted preferences: malformed rules and pet ids are dropped, order and empty schedules kept.
assert.deepEqual(normalizePetWardrobePreferences({
  mochi: {
    outfit: "pajamas",
    schedule: [
      { outfit: "pajamas", when: { time: { from: "25:00", to: "07:00" } } },
      { outfit: "weekend", when: { days: ["sat"] } },
      { outfit: "santa", when: {} },
      { outfit: "pajamas", when: { dates: { from: "02-30", to: "03-01" } } },
    ],
  },
  quiet: { schedule: [] },
  "../escape": { outfit: "pajamas" },
  empty: {},
}), {
  mochi: { outfit: "pajamas", schedule: [{ outfit: "weekend", when: { days: ["sat"] } }] },
  quiet: { schedule: [] },
});
assert.equal(normalizePetWardrobePreferences("not an object"), undefined);

// pet.json validation fails loudly for creators instead of shipping a half-working wardrobe.
const outfit = { id: "pajamas", displayName: "Pajamas", spritesheetPath: "outfits/pajamas.webp" };
for (const [label, value] of [
  ["empty outfit list", { outfits: [] }],
  ["path not derived from the id", { outfits: [{ ...outfit, spritesheetPath: "outfits/other.webp" }] }],
  ["path escaping the outfits folder", { outfits: [{ ...outfit, spritesheetPath: "../pajamas.webp" }] }],
  ["reserved default id", { outfits: [{ ...outfit, id: "default", spritesheetPath: "outfits/default.webp" }] }],
  ["reserved auto id (means follow the schedule)", { outfits: [{ ...outfit, id: "auto", spritesheetPath: "outfits/auto.webp" }] }],
  ["duplicate ids", { outfits: [outfit, outfit] }],
  ["schedule naming an unknown outfit", { outfits: [outfit], schedule: [{ outfit: "santa", when: { days: ["mon"] } }] }],
  ["rule without conditions", { outfits: [outfit], schedule: [{ outfit: "pajamas", when: {} }] }],
  ["zero-length time range", { outfits: [outfit], schedule: [{ outfit: "pajamas", when: { time: { from: "08:00", to: "08:00" } } }] }],
] as const) {
  assert.throws(() => validatePetWardrobe(value), Error, label);
}
assert.deepEqual(
  validatePetWardrobe({ outfits: [outfit], schedule: [{ outfit: "default", when: { days: ["sun", "mon"] } }] }).schedule,
  [{ outfit: "default", when: { days: ["sun", "mon"] } }],
  "rules may switch back to the default outfit",
);

console.error("Pet wardrobe core contract passed.");
