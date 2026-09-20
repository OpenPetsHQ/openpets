import assert from "node:assert/strict";
import { register } from "node:module";
import { join } from "node:path";

const desktopRoot = process.env.OPENPETS_DESKTOP_ROOT ?? join(process.cwd(), "apps/desktop");
const electronMock = `data:text/javascript,${encodeURIComponent(`
  export const app = { getAppPath: () => ${JSON.stringify(desktopRoot)} };
  export default { app };
`)}`;

register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: ${JSON.stringify(electronMock)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = async () => {
    throw new Error("catalog unavailable");
  };

  const fixtureFallback = await import("../src/catalog.js");
  const fixtureState = await fixtureFallback.getCatalogUiState();
  assert.equal(fixtureState.source, "fixture");
  assert.ok(fixtureState.pets.length > 0);
  assert.equal(fixtureState.total, fixtureState.pets.length);
  assert.equal(fixtureState.pets.every((pet) => pet.original === undefined && pet.featured === undefined), true);
  assert.equal((await fixtureFallback.getCatalogPet("snoopy")).id, "snoopy");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Catalog fixture fallback visibility and lookup behavior passed.");
