import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { builtInPetCatalogIds, builtInPetOutfitFileName, builtInPetWardrobe } from "../src/built-in-pet.js";
import { validateCodexPetOutfitSpritesheet } from "../src/codex-pets-core.js";
import { resolveWornOutfitId } from "../src/pet-wardrobe-core.js";

// The test runner works from the desktop package root, where assets/ lives.
const assetsDirectory = join(process.cwd(), "assets");

// Every built-in outfit ships a V2 WebP atlas the desktop accepts.
assert.deepEqual(builtInPetWardrobe.outfits.map((outfit) => outfit.id), ["pajamas", "weekend", "halloween", "holidays", "summer"]);
for (const outfit of builtInPetWardrobe.outfits) {
  const fileName = builtInPetOutfitFileName(outfit.id);
  assert.equal(fileName, `default-pet-outfits/${outfit.id}.webp`);
  await validateCodexPetOutfitSpritesheet(await readFile(join(assetsDirectory, fileName)), { spriteVersionNumber: 2 }, "spritesheet.webp");
}
assert.equal(builtInPetOutfitFileName("default"), undefined);
assert.equal(builtInPetOutfitFileName("../default-pet-spritesheet"), undefined);

// The creator schedule matches the catalog's Hoodie Cat (local time).
assert.equal(resolveWornOutfitId(builtInPetWardrobe, undefined, new Date(2026, 2, 4, 12, 0)), "default", "a weekday noon");
assert.equal(resolveWornOutfitId(builtInPetWardrobe, undefined, new Date(2026, 2, 4, 23, 0)), "pajamas");
assert.equal(resolveWornOutfitId(builtInPetWardrobe, undefined, new Date(2026, 2, 7, 12, 0)), "weekend");
assert.equal(resolveWornOutfitId(builtInPetWardrobe, undefined, new Date(2026, 9, 31, 23, 0)), "halloween", "seasons outrank pajamas");
assert.equal(resolveWornOutfitId(builtInPetWardrobe, undefined, new Date(2027, 0, 1, 12, 0)), "holidays", "wraps the new year");
assert.equal(resolveWornOutfitId(builtInPetWardrobe, undefined, new Date(2026, 6, 15, 12, 0)), "summer");
assert.equal(resolveWornOutfitId(builtInPetWardrobe, { outfit: "summer" }, new Date(2026, 2, 4, 23, 0)), "summer", "an always-wear choice wins");

// Control Center hides the catalog's copy of the built-in pet (catalog id, not the website slug).
assert.deepEqual([...builtInPetCatalogIds], ["hoodie-cat"]);

console.log("built-in pet wardrobe tests passed");
