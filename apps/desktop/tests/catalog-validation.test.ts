import assert from "node:assert/strict";

import { toCatalogPetV2Compat, validateCatalogV2, validateCatalogV3Page, validateCatalogV3SearchPage } from "../src/catalog-validation.js";

const generatedAt = "2026-01-01T00:00:00.000Z";
const preview = "https://openpets.dev/pets/malou/thumb.webp";
const zip = "https://zip.openpets.dev/pets/malou/malou.zip";

const legacyV2 = validateCatalogV2({
  version: 2,
  generatedAt,
  pets: [{ id: "legacy", displayName: "Legacy", description: "Legacy pet", preview, zip }],
});
assert.equal(legacyV2.pets[0].spriteVersionNumber, undefined);

const v2 = validateCatalogV2({
  version: 2,
  generatedAt,
  pets: [{ id: "malou", displayName: "Malou", description: "V2 pet", preview, zip, spriteVersionNumber: 2 }],
});
assert.equal(v2.pets[0].spriteVersionNumber, 2);

for (const invalidVersion of [1, 3, 2.1, "2", null, true]) {
  assert.throws(() => validateCatalogV2({
    version: 2,
    generatedAt,
    pets: [{ id: "malou", displayName: "Malou", description: "V2 pet", preview, zip, spriteVersionNumber: invalidVersion }],
  }), `invalid v2 sprite version ${String(invalidVersion)} must be rejected`);
}

const page = validateCatalogV3Page({
  version: 3,
  page: 0,
  pageSize: 1,
  pets: [{
    id: "malou",
    displayName: "Malou",
    description: "V2 pet",
    thumbnail: preview,
    spritesheet: "https://openpets.dev/pets/malou/spritesheet.webp",
    zip,
    category: "western",
    original: true,
    spriteVersionNumber: 2,
  }],
}, 0);
assert.equal(page.pets[0].spriteVersionNumber, 2);
assert.equal(toCatalogPetV2Compat(page.pets[0]).spriteVersionNumber, 2);

const searchPage = validateCatalogV3SearchPage({
  version: 3,
  page: 0,
  pageSize: 1,
  pets: [{ id: "malou", displayName: "Malou", searchText: "malou v2", category: "western", catalogPage: 0, spriteVersionNumber: 2 }],
}, 0, 1);
assert.equal(searchPage.pets[0].spriteVersionNumber, 2);

for (const invalidVersion of [1, "2", null]) {
  assert.throws(() => validateCatalogV3Page({
    version: 3,
    page: 0,
    pageSize: 1,
    pets: [{
      id: "malou",
      displayName: "Malou",
      description: "V2 pet",
      thumbnail: preview,
      spritesheet: "https://openpets.dev/pets/malou/spritesheet.webp",
      zip,
      category: "western",
      spriteVersionNumber: invalidVersion,
    }],
  }, 0));
  assert.throws(() => validateCatalogV3SearchPage({
    version: 3,
    page: 0,
    pageSize: 1,
    pets: [{ id: "malou", displayName: "Malou", searchText: "malou", category: "western", catalogPage: 0, spriteVersionNumber: invalidVersion }],
  }, 0, 1));
}

console.log("Catalog sprite-version data path behavior passed.");
