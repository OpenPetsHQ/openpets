import assert from "node:assert/strict";
import { join } from "node:path";

import { getOpenPetsUserDataPath, parseArgs, validateCatalog, validateCatalogV3Index, validateCatalogV3Page, validateCatalogV3SearchPage, validatePetId, validateZipEntryName } from "./index.js";

assert.deepEqual(parseArgs(["review-owl"]), { petId: "review-owl", help: false });
assert.equal(parseArgs(["--help"]).help, true);
assert.equal(validatePetId("review-owl"), "review-owl");
assert.throws(() => validatePetId("../bad"));
assert.throws(() => validatePetId("builtin"));

assert.equal(getOpenPetsUserDataPath("darwin", {}), join(process.env.HOME || "", "Library", "Application Support", "OpenPets"));
assert.equal(getOpenPetsUserDataPath("linux", { XDG_CONFIG_HOME: "/tmp/config" }), join("/tmp/config", "OpenPets"));
assert.equal(getOpenPetsUserDataPath("win32", { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }), join("C:\\Users\\me\\AppData\\Roaming", "OpenPets"));
assert.equal(getOpenPetsUserDataPath("linux", { OPENPETS_USER_DATA: "/tmp/openpets-test" }), "/tmp/openpets-test");

assert.deepEqual(validateCatalog({
  version: 2,
  generatedAt: new Date().toISOString(),
  pets: [{
    id: "review-owl",
    displayName: "Review Owl",
    description: "A reviewer pet.",
    preview: "https://openpets.dev/pets/review-owl/preview.webp",
    zip: "https://zip.openpets.dev/pets/review-owl.zip",
  }],
}), [{
  id: "review-owl",
  displayName: "Review Owl",
  description: "A reviewer pet.",
  preview: "https://openpets.dev/pets/review-owl/preview.webp",
  zip: "https://zip.openpets.dev/pets/review-owl.zip",
}]);
assert.throws(() => validateCatalog({ version: 2, pets: [{ id: "bad/pet" }] }));

assert.deepEqual(validateCatalogV3Index({
  version: 3,
  total: 2,
  search: "https://openpets.dev/pets/catalog.v3/search.json",
  pages: ["https://openpets.dev/pets/catalog.v3/page-000.json"],
}), {
  pages: ["https://openpets.dev/pets/catalog.v3/page-000.json"],
  search: "https://openpets.dev/pets/catalog.v3/search.json",
});
assert.equal(validateCatalogV3Index({ version: 3, pages: ["https://openpets.dev/pets/catalog.v3/search-page-000.json"] }).search, undefined);
assert.throws(() => validateCatalogV3Index({ version: 2, pages: ["https://openpets.dev/pets/catalog.v3/page-000.json"] }));
assert.throws(() => validateCatalogV3Index({ version: 3, pages: [] }));
assert.throws(() => validateCatalogV3Index({ version: 3, pages: ["https://evil.example.com/pets/page-000.json"] }));
assert.throws(() => validateCatalogV3Index({ version: 3, pages: ["https://openpets.dev/other/page-000.json"] }));

assert.deepEqual(validateCatalogV3SearchPage({
  version: 3,
  pets: [{ id: "review-owl", displayName: "Review Owl", searchText: "review owl", category: "western", catalogPage: 1 }],
}, 2), [{ id: "review-owl", catalogPage: 1 }]);
assert.throws(() => validateCatalogV3SearchPage({ version: 3, pets: [{ id: "review-owl", catalogPage: 2 }] }, 2));
assert.throws(() => validateCatalogV3SearchPage({ version: 3, pets: [{ id: "review-owl", catalogPage: -1 }] }, 2));
assert.throws(() => validateCatalogV3SearchPage({ version: 2, pets: [] }, 2));

assert.deepEqual(validateCatalogV3Page({
  version: 3,
  page: 0,
  pets: [{
    id: "review-owl",
    displayName: "Review Owl",
    description: "A reviewer pet.",
    thumbnail: "https://openpets.dev/pets/review-owl/thumb.webp",
    spritesheet: "https://openpets.dev/pets/review-owl/spritesheet.webp",
    zip: "https://zip.openpets.dev/pets/review-owl/review-owl.zip",
    category: "western",
  }],
}), [{
  id: "review-owl",
  displayName: "Review Owl",
  description: "A reviewer pet.",
  preview: "https://openpets.dev/pets/review-owl/thumb.webp",
  zip: "https://zip.openpets.dev/pets/review-owl/review-owl.zip",
}]);
assert.throws(() => validateCatalogV3Page({ version: 3, pets: [{ id: "review-owl", displayName: "Review Owl", description: "x", thumbnail: "https://evil.example.com/pets/t.webp", zip: "https://zip.openpets.dev/pets/review-owl/review-owl.zip" }] }));

assert.equal(validateZipEntryName("pet.json").relativeOutputPath, "pet.json");
assert.equal(validateZipEntryName("absol/pet.json").relativeOutputPath, "pet.json");
assert.equal(validateZipEntryName("absol/spritesheet.webp").topLevelDirectory, "absol");
assert.equal(validateZipEntryName("absol/spritesheet.svg").relativeOutputPath, "spritesheet.svg");
assert.equal(validateZipEntryName("absol/").isDirectory, true);
assert.throws(() => validateZipEntryName("a/b/pet.json"));
assert.throws(() => validateZipEntryName("absol/README.md"));
assert.throws(() => validateZipEntryName("../pet.json"));
assert.throws(() => validateZipEntryName("/pet.json"));

console.log("install-pet validation passed.");
