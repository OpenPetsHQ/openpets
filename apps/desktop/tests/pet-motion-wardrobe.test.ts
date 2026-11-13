import assert from "node:assert/strict";
import * as moduleApi from "node:module";
import { test } from "node:test";

test("Motion wardrobe resolves preferences, commits, and explicit retries without inventing a worn outfit", async () => {
  const stateModule = `data:text/javascript,${encodeURIComponent(`
    let preference;
    export function getAppStateSnapshot() { return { pets: { installed: [{ id: "motion" }] } }; }
    export function getPetWardrobePreference() { return preference; }
    export function setPetWardrobePreference(_id, value) { preference = value; }
  `)}`;
  const packageModule = `data:text/javascript,${encodeURIComponent(`
    export async function readInstalledPetPackage() { return {
      format: "motion", metadata: { geometry: { width: 80, height: 90 }, wardrobe: {
        outfits: [{ id: "coat", displayName: "Coat", bindings: {} }],
        schedule: [{ outfit: "coat", when: { dates: { from: "01-01", to: "12-31" } } }],
      } },
    }; }
  `)}`;
  const loggerModule = `data:text/javascript,${encodeURIComponent("export function info() {}")}`;
  const pathsModule = `data:text/javascript,${encodeURIComponent("export function assertSafePetId() {}")}`;
  const modules = new Map([["./app-state.js", stateModule], ["./installed-pet-layout.js", packageModule], ["./logger.js", loggerModule], ["./pet-paths.js", pathsModule]]);
  const hooks = typeof moduleApi.registerHooks === "function" ? moduleApi.registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = context.parentURL?.includes("pet-wardrobe.") ? modules.get(specifier) : undefined;
      return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
    },
  }) : undefined;
  if (!hooks) {
    moduleApi.register(`data:text/javascript,${encodeURIComponent(`
      const modules = new Map(${JSON.stringify([...modules])});
      export async function resolve(specifier, context, nextResolve) {
        const url = context.parentURL?.includes("pet-wardrobe.") ? modules.get(specifier) : undefined;
        return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
      }
    `)}`, import.meta.url);
  }
  try {
    const wardrobe = await import("../src/pet-wardrobe.js");
    const projection = await import("../src/pet-wardrobe-render-state.js");
    const requests: Array<[string, string, boolean]> = [];
    wardrobe.setPetWardrobeChangeHandler((id, reason, retry) => requests.push([id, reason, retry]));
    const initial = await wardrobe.getPetWardrobeSnapshot("motion");
    assert.equal(initial?.requested, "coat");
    assert.equal(initial?.wearing, null);
    assert.equal(initial?.previewFormat, "image");
    projection.noteOutfitRequest(1, "motion", "coat", "one", false, true);
    projection.commitRenderedOutfit(1, "motion", "one");
    assert.equal((await wardrobe.getPetWardrobeSnapshot("motion"))?.wearing, "coat");
    projection.noteOutfitRequest(2, "motion", "default", "two", false, false);
    projection.commitRenderedOutfit(2, "motion", "two");
    assert.equal((await wardrobe.getPetWardrobeSnapshot("motion"))?.wearing, null);
    await wardrobe.updatePetWardrobe("motion", { outfit: "default" });
    assert.equal((await wardrobe.getPetWardrobeSnapshot("motion"))?.requested, "default");
    await assert.rejects(() => wardrobe.retryPetOutfit("motion", "coat"));
    await wardrobe.retryPetOutfit("motion", "default");
    await wardrobe.updatePetWardrobe("motion", { outfit: "auto" });
    assert.deepEqual(requests, [["motion", "manual", false], ["motion", "manual", true], ["motion", "manual", false]]);
    assert.equal((await wardrobe.getPetWardrobeSnapshot("motion"))?.requested, "coat");
    const preferences = await import(stateModule);
    preferences.setPetWardrobePreference("motion", { outfit: "removed" });
    assert.equal((await wardrobe.getPetWardrobeSnapshot("motion"))?.requested, "coat");
    assert.equal(preferences.getPetWardrobePreference("motion").outfit, "removed");
    projection.forgetOutfitWindow(1);
    projection.forgetOutfitWindow(2);
    wardrobe.setPetWardrobeChangeHandler(null);
  } finally {
    hooks?.deregister();
  }
});
