import assert from "node:assert/strict";

import { normalizeRemoteCatalogSpriteVersionOne, toCatalogPetV2Compat, validateCatalogV2, validateCatalogV3Page, validateCatalogV3SearchPage } from "../src/catalog-validation.js";

const generatedAt = "2026-01-01T00:00:00.000Z";
const preview = "https://openpets.dev/pets/malou/thumb.webp";
const zip = "https://zip.openpets.dev/pets/malou/malou.zip";

const legacyV2 = validateCatalogV2({
  version: 2,
  generatedAt,
  pets: [{ id: "legacy", displayName: "Legacy", description: "Legacy pet", preview, zip }],
});
assert.equal(legacyV2.pets[0].spriteVersionNumber, undefined);
assert.equal(Object.hasOwn(legacyV2.pets[0], "spriteVersionNumber"), false);

const v2 = validateCatalogV2({
  version: 2,
  generatedAt,
  pets: [{ id: "malou", displayName: "Malou", description: "V2 pet", preview, zip, spriteVersionNumber: 2 }],
});
assert.equal(v2.pets[0].spriteVersionNumber, 2);
assert.equal(Object.hasOwn(v2.pets[0], "spriteVersionNumber"), true);

for (const invalidVersion of [1, 3, 2.1, "2", null, true]) {
  assert.throws(() => validateCatalogV2({
    version: 2,
    generatedAt,
    pets: [{ id: "malou", displayName: "Malou", description: "V2 pet", preview, zip, spriteVersionNumber: invalidVersion }],
  }), `invalid v2 sprite version ${String(invalidVersion)} must be rejected`);
}

const remoteV2 = validateCatalogV2(normalizeRemoteCatalogSpriteVersionOne({
  version: 2,
  generatedAt,
  pets: [{ id: "legacy-v1", displayName: "Legacy V1", description: "V1 pet", preview, zip, spriteVersionNumber: 1 }],
}));
assert.equal(remoteV2.pets[0].spriteVersionNumber, undefined);
assert.equal(Object.hasOwn(remoteV2.pets[0], "spriteVersionNumber"), false);

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
assert.equal(Object.hasOwn(page.pets[0], "spriteVersionNumber"), true);
const compatibleV2PagePet = toCatalogPetV2Compat(page.pets[0]);
assert.equal(compatibleV2PagePet.spriteVersionNumber, 2);
assert.equal(Object.hasOwn(compatibleV2PagePet, "spriteVersionNumber"), true);

const remoteV1Page = validateCatalogV3Page(normalizeRemoteCatalogSpriteVersionOne({
  version: 3,
  page: 0,
  pageSize: 1,
  pets: [{
    id: "legacy-v1",
    displayName: "Legacy V1",
    description: "V1 pet",
    thumbnail: preview,
    spritesheet: "https://openpets.dev/pets/malou/spritesheet.webp",
    zip,
    category: "western",
    spriteVersionNumber: 1,
  }],
}), 0);
assert.equal(remoteV1Page.pets[0].spriteVersionNumber, undefined);
assert.equal(Object.hasOwn(remoteV1Page.pets[0], "spriteVersionNumber"), false);
const compatibleRemoteV1PagePet = toCatalogPetV2Compat(remoteV1Page.pets[0]);
assert.equal(Object.hasOwn(compatibleRemoteV1PagePet, "spriteVersionNumber"), false);

const searchPage = validateCatalogV3SearchPage({
  version: 3,
  page: 0,
  pageSize: 1,
  pets: [{ id: "malou", displayName: "Malou", searchText: "malou v2", category: "western", catalogPage: 0, spriteVersionNumber: 2 }],
}, 0, 1);
assert.equal(searchPage.pets[0].spriteVersionNumber, 2);
assert.equal(Object.hasOwn(searchPage.pets[0], "spriteVersionNumber"), true);

const remoteV1SearchPage = validateCatalogV3SearchPage(normalizeRemoteCatalogSpriteVersionOne({
  version: 3,
  page: 0,
  pageSize: 1,
  pets: [{ id: "legacy-v1", displayName: "Legacy V1", searchText: "legacy v1", category: "western", catalogPage: 0, spriteVersionNumber: 1 }],
}), 0, 1);
assert.equal(remoteV1SearchPage.pets[0].spriteVersionNumber, undefined);
assert.equal(Object.hasOwn(remoteV1SearchPage.pets[0], "spriteVersionNumber"), false);

for (const invalidVersion of [3, 0, 2.1, "2", null, true]) {
  assert.throws(() => validateCatalogV2(normalizeRemoteCatalogSpriteVersionOne({
    version: 2,
    generatedAt,
    pets: [{ id: "invalid", displayName: "Invalid", description: "Invalid marker", preview, zip, spriteVersionNumber: invalidVersion }],
  })), `remote V2 marker ${String(invalidVersion)} must be rejected`);
  assert.throws(() => validateCatalogV3Page(normalizeRemoteCatalogSpriteVersionOne({
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
  }), 0), `remote V3 page marker ${String(invalidVersion)} must be rejected`);
  assert.throws(() => validateCatalogV3SearchPage(normalizeRemoteCatalogSpriteVersionOne({
    version: 3,
    page: 0,
    pageSize: 1,
    pets: [{ id: "malou", displayName: "Malou", searchText: "malou", category: "western", catalogPage: 0, spriteVersionNumber: invalidVersion }],
  }), 0, 1), `remote V3 search marker ${String(invalidVersion)} must be rejected`);
}

console.log("Catalog sprite-version data path behavior passed.");
