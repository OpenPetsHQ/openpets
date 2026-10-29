import { strict as assert } from "node:assert";
import { test } from "node:test";
import { studioUrl } from "../src/host/studio-links.js";

test("Studio links use fixed destinations and explicit pet provenance", () => {
  assert.equal(studioUrl("pet"), "https://openpets.dev/studio/new");
  assert.equal(
    studioUrl("outfit", { id: "builtin", source: "builtin" }),
    "https://openpets.dev/studio/import?pet=hoodie-cat&view=wardrobe",
  );
  assert.equal(
    studioUrl("outfit", {
      id: "builtin",
      source: "builtin",
      wardrobeSource: "local",
    }),
    "https://openpets.dev/studio/import?view=wardrobe",
  );
  assert.equal(
    studioUrl("outfit", {
      id: "builtin",
      source: "builtin",
      wardrobeSource: "bundled",
      hasLocalWardrobeOverride: true,
    }),
    "https://openpets.dev/studio/import?view=wardrobe",
  );
  assert.equal(
    studioUrl("outfit", {
      id: "builtin",
      source: "builtin",
      wardrobeSource: "bundled",
    }),
    "https://openpets.dev/studio/import?pet=hoodie-cat&view=wardrobe",
  );
  assert.equal(
    studioUrl("outfit", { id: "cat-1", source: "catalog" }),
    "https://openpets.dev/studio/import?pet=cat-1&view=wardrobe",
  );
  assert.equal(
    studioUrl("outfit", { id: "cat-1", source: "local" }),
    "https://openpets.dev/studio/import?view=wardrobe",
  );
  assert.throws(() => studioUrl("outfit"));
  assert.throws(() => studioUrl("pet", { id: "cat", source: "catalog" }));
  assert.throws(() => studioUrl("outfit", { id: "../cat", source: "catalog" }));
  assert.throws(() =>
    studioUrl("outfit", { id: "builtin", source: "catalog" }),
  );
  assert.throws(() => studioUrl("outfit", { id: "cat", source: "builtin" }));
});
