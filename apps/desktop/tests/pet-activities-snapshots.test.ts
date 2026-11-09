import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
import * as moduleApi from "node:module";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

import type { PetActivity } from "@open-pets/pet-format/activities";
import { readPetActivitySpritesheet } from "../src/pet-atlas-validation.js";
import { createPetActivityPixels, petActivityFixture } from "./pet-activity-fixtures.js";

const root = await mkdtemp(join(tmpdir(), "openpets-activity-snapshots-"));
const state = {
  installed: [{ id: "cat" }, { id: "other" }, { id: "builtin" }],
  validations: 0,
  outfitId: "default",
  afterValidation: null as (() => Promise<void>) | null,
  async readAsset(directory: string, activity: PetActivity): Promise<Buffer> {
    this.validations += 1;
    const bytes = await readPetActivitySpritesheet(directory, activity);
    await this.afterValidation?.();
    return bytes;
  },
};
(globalThis as typeof globalThis & { __petActivitySnapshotsTest?: typeof state }).__petActivitySnapshotsTest = state;

const modules: Record<string, string> = {
  electron: "export const ipcMain = { on() {} };",
  "./app-state.js": `
    const state = globalThis.__petActivitySnapshotsTest;
    export const getAppStateSnapshot = () => ({ pets: { installed: state.installed } });
    export const getEnabledPetActivityIds = () => [];
    export const setEnabledPetActivityIds = () => {};
  `,
  "./built-in-pet.js": "export const builtInPet = { id: 'builtin' };",
  "./logger.js": "export const info = () => {}; export const warn = () => {};",
  "./pet-atlas-validation.js": `
    export const readPetActivitySpritesheet = (directory, activity) => globalThis.__petActivitySnapshotsTest.readAsset(directory, activity);
  `,
  "./pet-window-gaze.js": "export const setPetGazeActivityOverride = () => {};",
  "./pet-window-render.js": "export const resolveRenderableAtlas = async () => ({ outfitId: globalThis.__petActivitySnapshotsTest.outfitId });",
  "./pet-motion-activity-assets.js": "export function getMotionActivityOptions(){return []} export async function readMotionActivityPreview(){throw new Error('unused')}",
  "./pet-wardrobe-render-state.js": "export function getRenderedOutfits(){return []}",
};
const mocks = Object.fromEntries(Object.entries(modules).map(([name, source]) => [name, `data:text/javascript,${encodeURIComponent(source)}`]));
const petPaths = `data:text/javascript,${encodeURIComponent(`
  import { join } from "node:path";
  export function assertSafePetId(id) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || id === "builtin") throw new Error("Invalid pet id.");
  }
  export function getPetDir(id) {
    assertSafePetId(id);
    return join(${JSON.stringify(root)}, id);
  }
`)}`;
const hooks = typeof moduleApi.registerHooks === "function" ? moduleApi.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./pet-paths.js" && context.parentURL?.includes("/apps/desktop/")) return { url: petPaths, shortCircuit: true };
    if ((context.parentURL?.includes("/pet-activities.") || context.parentURL?.includes("/pet-activity-asset-cache.")) && mocks[specifier]) return { url: mocks[specifier], shortCircuit: true };
    return nextResolve(specifier, context);
  },
}) : undefined;
if (!hooks) moduleApi.register(`data:text/javascript,${encodeURIComponent(`
  const mocks = ${JSON.stringify(mocks)};
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "./pet-paths.js" && context.parentURL?.includes("/apps/desktop/.test-dist/src/")) {
      return { url: ${JSON.stringify(petPaths)}, shortCircuit: true };
    }
    if ((context.parentURL?.endsWith("/pet-activities.js") || context.parentURL?.endsWith("/pet-activity-asset-cache.js")) && mocks[specifier]) {
      return { url: mocks[specifier], shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

const runtime = await import("../src/pet-activities.js");
class Contents extends EventEmitter { isDestroyed() { return false; } send() {} }
class Window extends EventEmitter {
  readonly webContents = new Contents();
  constructor(readonly id: number) { super(); }
  isDestroyed() { return false; }
  isVisible() { return true; }
}
const carriers = new Map<string, Window>();
async function getSnapshot(id: string) {
  if (id !== "builtin") {
    let window = carriers.get(id);
    if (!window) {
      window = new Window(carriers.size + 1);
      carriers.set(id, window);
      runtime.registerPetActivityWindow(window as never);
      window.webContents.emit("did-finish-load");
    }
    const manifest = JSON.parse(await readFile(join(root, id, "pet.json"), "utf8"));
    runtime.updatePetActivityRender(window as never, { renderedPetId: id, renderedOutfitId: state.outfitId, activities: manifest.activities, cacheKey: "snapshot", petScale: 1, paused: false } as never);
  }
  return runtime.getPetActivities(id);
}
const strip = await sharp(createPetActivityPixels(), {
  raw: { width: 1536, height: 208, channels: 4 },
}).webp().toBuffer();
const assetPath = join(root, "cat", petActivityFixture.spritesheetPath);
const metadata = (id: string, activities: readonly PetActivity[] = [petActivityFixture]) => ({
  id,
  displayName: id,
  description: "Activity snapshot cache regression pet",
  spritesheetPath: "spritesheet.webp",
  activities,
  wardrobe: { outfits: [{ id: "pajamas", displayName: "Pajamas", spritesheetPath: "outfits/pajamas.webp" }], schedule: [] },
});
const writeMetadata = async (id: string, activities: readonly PetActivity[]): Promise<void> => {
  await writeFile(join(root, id, "pet.json"), JSON.stringify(metadata(id, activities)));
};
const writePackage = async (directory: string, id: string): Promise<void> => {
  await mkdir(join(directory, "activities"), { recursive: true });
  await writeFile(join(directory, "pet.json"), JSON.stringify(metadata(id)));
  await writeFile(join(directory, "spritesheet.webp"), "Existing V1 base atlas semantics");
  await writeFile(join(directory, petActivityFixture.spritesheetPath), strip);
};
const assertAvailable = async (petId = "cat"): Promise<void> => {
  const snapshot = await getSnapshot(petId);
  assert.ok(snapshot.activities[0]?.preview?.url, "valid optional activity remains available in snapshots");
};
const assertUnavailable = async (): Promise<void> => {
  const snapshot = await getSnapshot("cat");
  assert.equal(snapshot.activities[0]?.preview, null);
  assert.match(snapshot.activities[0]?.availabilityReason ?? "", /asset unavailable/i);
};
const pauseValidation = () => {
  let release!: () => void;
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const paused = new Promise<void>((resolve) => { release = resolve; });
  state.afterValidation = async () => {
    signalStarted();
    await paused;
  };
  return {
    started,
    release() {
      state.afterValidation = null;
      release();
    },
  };
};

try {
  await writePackage(join(root, "cat"), "cat");
  await writePackage(join(root, "other"), "other");

  const pajamaActivity: PetActivity = {
    ...petActivityFixture,
    outfitVariants: [{ outfitId: "pajamas", spritesheetPath: "activities/dance.pajamas.webp", frameCount: 8, fps: 8 }],
  };
  await writeMetadata("cat", [pajamaActivity]);
  await writeFile(join(root, "cat", "activities", "dance.pajamas.webp"), strip);
  state.outfitId = "pajamas";
  const pajama = await getSnapshot("cat");
  assert.equal(pajama.outfitDisplayName, "Pajamas");
  assert.equal(pajama.activities[0]?.preview?.format === "classic" ? pajama.activities[0].preview.fps : null, 8);
  assert.match(pajama.activities[0]?.preview?.url ?? "", /\/dance\/pajamas$/);
  await writeFile(join(root, "cat", "activities", "dance.pajamas.webp"), "corrupt");
  assert.equal((await getSnapshot("cat")).activities[0]?.preview, null);
  state.outfitId = "default";
  assert.ok((await getSnapshot("cat")).activities[0]?.preview?.url, "corrupt pajama art does not disable default art");
  await writeMetadata("cat", [petActivityFixture]);

  await assertAvailable();
  const initialValidations = state.validations;
  await assertAvailable();
  await assertAvailable();
  assert.equal(state.validations, initialValidations, "unchanged polling snapshots do not reread/decode strips");

  runtime.resetPetActivitiesForPet("cat", true);
  await Promise.all([assertAvailable(), assertAvailable(), assertAvailable()]);
  assert.equal(state.validations, initialValidations + 1, "simultaneous cold snapshots share one real validation");

  // The play/protocol boundary still reads and fully validates bytes, even when
  // the frequent snapshot path already knows this filesystem version is valid.
  const beforeManualRead = state.validations;
  assert.deepEqual(await runtime.readInstalledActivityAsset("cat", "dance", "default"), strip);
  assert.ok(state.validations > beforeManualRead);

  const previousStats = await stat(assetPath);
  await writeFile(assetPath, Buffer.alloc(strip.length));
  await utimes(assetPath, previousStats.atime, previousStats.mtime);
  await assertUnavailable();
  const corruptValidations = state.validations;
  await assertUnavailable();
  assert.equal(state.validations, corruptValidations, "an unchanged corrupt version does not repeatedly decode");
  await assert.rejects(() => runtime.readInstalledActivityAsset("cat", "dance", "default"), "manual reads never serve cached valid bytes after corruption");
  await assert.rejects(() => runtime.playPetActivity("cat", "dance"));
  assert.equal(await readFile(join(root, "cat", "spritesheet.webp"), "utf8"), "Existing V1 base atlas semantics", "optional corruption leaves the base pet untouched");

  await writeFile(assetPath, strip);
  await assertAvailable();
  assert.ok(state.validations > corruptValidations, "fixing a failed asset revalidates the new version");
  await unlink(assetPath);
  await assertUnavailable();
  await writeFile(assetPath, strip);
  await assertAvailable();

  const beforeReplacement = state.validations;
  await writePackage(join(root, "replacement"), "cat");
  await rename(join(root, "cat"), join(root, "previous"));
  await rename(join(root, "replacement"), join(root, "cat"));
  await assertAvailable();
  assert.ok(state.validations > beforeReplacement, "same-id atomic package replacement is a new asset version");

  const beforeContractChange = state.validations;
  await writeMetadata("cat", [{ ...petActivityFixture, frameCount: 4 }]);
  await assertUnavailable();
  await writeMetadata("cat", [petActivityFixture]);
  await assertAvailable();
  assert.ok(state.validations > beforeContractChange, "image validation follows the current manifest frame count");

  // Entries removed from a package or installed-pet list must not accumulate.
  const wave = { ...petActivityFixture, id: "wave", spritesheetPath: "activities/wave.webp" };
  await writeFile(join(root, "cat", wave.spritesheetPath), strip);
  await writeMetadata("cat", [petActivityFixture, wave]);
  await assertAvailable();
  await writeMetadata("cat", [wave]);
  await assertAvailable();
  const beforeRestoredActivity = state.validations;
  await writeMetadata("cat", [petActivityFixture, wave]);
  await assertAvailable();
  assert.ok(state.validations > beforeRestoredActivity, "removed entries are not retained alongside remaining package activities");
  await writeMetadata("cat", []);
  assert.deepEqual((await getSnapshot("cat")).activities, []);
  const beforeRestoredDeclaration = state.validations;
  await writeMetadata("cat", [petActivityFixture]);
  await assertAvailable();
  assert.ok(state.validations > beforeRestoredDeclaration, "removed declarations release their cached results");
  state.installed = [{ id: "other" }, { id: "builtin" }];
  await assertAvailable("other");
  state.installed.push({ id: "cat" });
  const beforeReinstalled = state.validations;
  await assertAvailable();
  assert.ok(state.validations > beforeReinstalled, "cache retention is bounded to current installed pets");
  assert.deepEqual((await getSnapshot("builtin")).activities, []);

  for (const invalidate of [
    () => runtime.resetPetActivitiesForPet("cat", true),
    () => runtime.removePetActivitiesForPet("cat"),
    () => runtime.stopPetActivities(),
  ]) {
    const beforeInvalidation = state.validations;
    invalidate();
    await assertAvailable();
    assert.ok(state.validations > beforeInvalidation, "replacement, removal, and shutdown discard validation results");
  }

  // A decode completing after reinstall invalidation must not resurrect its
  // detached cache entry and suppress validation of the next snapshot.
  const pausedValidation = pauseValidation();
  runtime.resetPetActivitiesForPet("cat", true);
  const pendingSnapshot = getSnapshot("cat");
  await pausedValidation.started;
  runtime.resetPetActivitiesForPet("cat", true);
  pausedValidation.release();
  await pendingSnapshot;
  const beforeNextSnapshot = state.validations;
  await assertAvailable();
  assert.ok(state.validations > beforeNextSnapshot, "late validation cannot repopulate an invalidated cache");

  const changingValidation = pauseValidation();
  runtime.resetPetActivitiesForPet("cat", true);
  const changingSnapshot = getSnapshot("cat");
  await changingValidation.started;
  await writeFile(assetPath, Buffer.alloc(strip.length));
  changingValidation.release();
  assert.equal((await changingSnapshot).activities[0]?.preview, null, "a decode cannot validate bytes replaced while it was in flight");
  await writeFile(assetPath, strip);
  await assertAvailable();
} finally {
  runtime.stopPetActivities();
  for (const window of carriers.values()) window.emit("closed");
  hooks?.deregister();
  delete (globalThis as typeof globalThis & { __petActivitySnapshotsTest?: typeof state }).__petActivitySnapshotsTest;
  await rm(root, { recursive: true, force: true });
}
console.log("Native activity snapshot validation caching, filesystem freshness, and lifecycle cleanup passed.");
