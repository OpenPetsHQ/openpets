import assert from "node:assert/strict";
import { test } from "node:test";
import { builtInPetWardrobe, builtInPetOutfitFileName } from "../dist/builtin-hoodie-cat.js";
import { resolveWornOutfitId } from "../dist/wardrobe.js";

test("bundled Hoodie Cat keeps its outfit paths and schedule precedence", () => {
  assert.deepEqual(builtInPetWardrobe.outfits.map((outfit) => outfit.id), ["pajamas", "weekend", "halloween", "holidays", "summer"]);
  for (const outfit of builtInPetWardrobe.outfits) {
    assert.equal(builtInPetOutfitFileName(outfit.id), `default-pet-outfits/${outfit.id}.webp`);
  }
  assert.equal(builtInPetOutfitFileName("../pajamas"), undefined);
  assert.equal(resolveWornOutfitId(builtInPetWardrobe, undefined, new Date(2026, 9, 31, 23)), "halloween");
  assert.equal(resolveWornOutfitId(builtInPetWardrobe, undefined, new Date(2027, 0, 1, 12)), "holidays");
  assert.equal(resolveWornOutfitId(builtInPetWardrobe, undefined, new Date(2026, 2, 4, 23)), "pajamas");
});
