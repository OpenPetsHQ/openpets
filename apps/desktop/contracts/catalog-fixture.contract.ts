import { readFile } from "node:fs/promises";

import { validateCatalogV2 } from "@open-pets/pet-format/catalog-validation";

const fixture = JSON.parse(await readFile("catalog.v2.fixture.json", "utf8")) as unknown;
validateCatalogV2(fixture);

const generatedAt = new Date().toISOString();

const invalidCases: readonly unknown[] = [
  { version: 2, generatedAt, pets: [{ id: "Bad ID", displayName: "Bad", description: "", preview: "https://openpets.dev/pets/x/spritesheet.webp", zip: "https://zip.openpets.dev/pets/x/x.zip" }] },
  { version: 2, generatedAt, pets: [{ id: "dup", displayName: "Dup", description: "", preview: "https://openpets.dev/pets/x/spritesheet.webp", zip: "https://zip.openpets.dev/pets/x/x.zip" }, { id: "dup", displayName: "Dup 2", description: "", preview: "https://openpets.dev/pets/y/spritesheet.webp", zip: "https://zip.openpets.dev/pets/y/y.zip" }] },
  { version: 2, generatedAt, pets: [{ id: "http", displayName: "Http", description: "", preview: "http://openpets.dev/pets/x/spritesheet.webp", zip: "https://zip.openpets.dev/pets/x/x.zip" }] },
  { version: 2, generatedAt, pets: [{ id: "host", displayName: "Host", description: "", preview: "https://evil.example/pets/x/spritesheet.webp", zip: "https://zip.openpets.dev/pets/x/x.zip" }] },
  { version: 2, generatedAt, pets: [{ id: "builtin", displayName: "Builtin", description: "", preview: "https://openpets.dev/pets/x/spritesheet.webp", zip: "https://zip.openpets.dev/pets/x/x.zip" }] },
];

for (const invalidCase of invalidCases) {
  assertRejectsCatalog(invalidCase);
}

console.log("Catalog fixture validation passed.");

function assertRejectsCatalog(value: unknown): void {
  try {
    validateCatalogV2(value);
  } catch {
    return;
  }

  throw new Error("Invalid catalog fixture case was accepted.");
}
