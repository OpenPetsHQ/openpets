import { strict as assert } from "node:assert";
import { test } from "node:test";
import { convertLegacyCatalogReceipt, parseReceipt } from "../src/host/asset-reference.js";

test("receipt validates identity, provenance and legacy catalog conversion", () => {
  const legacy = { version: 1, id: "hoodie-cat", sha256: "a".repeat(64), generation: "12345678-1234-4123-8123-123456789abc", url: "https://zip.openpets.dev/pets/a.zip" };
  const catalog = convertLegacyCatalogReceipt(legacy);
  assert.equal(catalog.source.kind, "catalog");
  assert.equal(parseReceipt({ ...catalog, id: "builtin", source: { kind: "local" } }).packageId, "hoodie-cat");
  assert.throws(() => parseReceipt({ ...catalog, id: "builtin" }));
  assert.throws(() => parseReceipt({ ...catalog, source: { kind: "local", url: legacy.url } }));
  assert.throws(() => convertLegacyCatalogReceipt({ ...legacy, url: "https://example.com/pets/a.zip" }));
  assert.throws(() => parseReceipt({ ...catalog, packageId: "other" }));
});
