import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

import type { PetActivity } from "../src/pet-activities-core.js";
import { readPetActivitySpritesheet } from "../src/pet-file-safety.js";
import { createPetActivityPixels, petActivityFixture } from "./pet-activity-fixtures.js";

const root = await mkdtemp(join(tmpdir(), "openpets-activity-snapshots-"));
const state = {
  installed: [{ id: "cat" }, { id: "other" }, { id: "builtin" }],
  validations: 0,
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
  "./pet-file-safety.js": `
    export const readPetActivitySpritesheet = (directory, activity) => globalThis.__petActivitySnapshotsTest.readAsset(directory, activity);
  `,
  "./pet-window-gaze.js": "export const setPetGazeActivityOverride = () => {};",
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
register(`data:text/javascript,${encodeURIComponent(`
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
  const snapshot = await runtime.getPetActivities(petId);
  assert.ok(snapshot.activities[0]?.previewUrl, "valid optional activity remains available in snapshots");
};
const assertUnavailable = async (): Promise<void> => {
  const snapshot = await runtime.getPetActivities("cat");
  assert.equal(snapshot.activities[0]?.previewUrl, null);
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
  assert.deepEqual(await runtime.readInstalledActivityAsset("cat", "dance"), strip);
  assert.ok(state.validations > beforeManualRead);

  const previousStats = await stat(assetPath);
  await writeFile(assetPath, Buffer.alloc(strip.length));
  await utimes(assetPath, previousStats.atime, previousStats.mtime);
  await assertUnavailable();
  const corruptValidations = state.validations;
  await assertUnavailable();
  assert.equal(state.validations, corruptValidations, "an unchanged corrupt version does not repeatedly decode");
  await assert.rejects(() => runtime.readInstalledActivityAsset("cat", "dance"), "manual reads never serve cached valid bytes after corruption");
  const beforeFailedPlay = state.validations;
  await assert.rejects(() => runtime.playPetActivity("cat", "dance"));
  assert.ok(state.validations > beforeFailedPlay, "manual play still performs full real asset validation");
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
  assert.deepEqual((await runtime.getPetActivities("cat")).activities, []);
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
  assert.deepEqual((await runtime.getPetActivities("builtin")).activities, []);

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
  const pendingSnapshot = runtime.getPetActivities("cat");
  await pausedValidation.started;
  runtime.resetPetActivitiesForPet("cat", true);
  pausedValidation.release();
  await pendingSnapshot;
  const beforeNextSnapshot = state.validations;
  await assertAvailable();
  assert.ok(state.validations > beforeNextSnapshot, "late validation cannot repopulate an invalidated cache");

  const changingValidation = pauseValidation();
  runtime.resetPetActivitiesForPet("cat", true);
  const changingSnapshot = runtime.getPetActivities("cat");
  await changingValidation.started;
  await writeFile(assetPath, Buffer.alloc(strip.length));
  changingValidation.release();
  assert.equal((await changingSnapshot).activities[0]?.previewUrl, null, "a decode cannot validate bytes replaced while it was in flight");
  await writeFile(assetPath, strip);
  await assertAvailable();
} finally {
  runtime.stopPetActivities();
  delete (globalThis as typeof globalThis & { __petActivitySnapshotsTest?: typeof state }).__petActivitySnapshotsTest;
  await rm(root, { recursive: true, force: true });
}
console.log("Native activity snapshot validation caching, filesystem freshness, and lifecycle cleanup passed.");
