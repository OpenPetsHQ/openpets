import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { builtInPetWardrobe, builtInPetOutfitFileName } from "@open-pets/pet-format/builtin-hoodie-cat";

test("bundled outfit atlases match the canonical desktop assets", async () => {
  for (const outfit of builtInPetWardrobe.outfits) {
    const name = builtInPetOutfitFileName(outfit.id);
    assert.ok(name);
    const source = await readFile(resolve("../desktop/assets", name));
    const bundled = await readFile(resolve("dist/media", name));
    assert.deepEqual(bundled, source);
  }
});
