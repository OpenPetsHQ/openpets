import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validatePetPackageMetadata } from "../dist/package.js";
import { getMotionOutfitBindings } from "../dist/motion.js";
import { resolveWornOutfitId, validatePetWardrobe } from "../dist/wardrobe.js";
import { motionMaxClipBytes, validatePetPackageAssets } from "../dist/node/package-validation.js";
import { validateZipEntryName } from "../dist/node/paths.js";

function fixture() {
  return {
    format: "motion", version: 1, id: "cat", displayName: " Cat ", description: "Pet",
    geometry: { width: 10, height: 12, pixelsPerUnit: 2, footAnchor: { x: 5, y: 12 } },
    clips: { idle: { file: "clips/idle.webp", frames: 2, playbackRate: 1.5 } },
    animations: { idle: { play: "loop", loop: "idle" }, wave: { play: "once", clip: "idle" } },
    bindings: { idle: [{ animation: "idle" }], movement: { left: "idle", right: "idle" }, events: { waving: [{ animation: "wave" }] } },
  };
}
function decoder(overrides = {}, failDecode = false) {
  return { open: () => ({
    metadata: async () => ({ format: "webp", width: 10, height: 24, pageHeight: 12, pages: 2, hasAlpha: true, delay: [40, 60], ...overrides }),
    decode: async () => { if (failDecode) throw new Error("decode failed"); },
  }) };
}

test("dispatch preserves Classic validation, including ignored extra fields", () => {
  const classic = { id: "cat", displayName: "Cat", description: "Pet", spritesheetPath: "spritesheet.webp" };
  assert.equal(validatePetPackageMetadata(classic, "cat").format, "classic");
  assert.throws(() => validatePetPackageMetadata(classic, "dog"));
  assert.equal(validatePetPackageMetadata({ ...classic, format: "future" }, "cat").format, "classic");
  assert.equal(validatePetPackageMetadata(fixture(), "cat").metadata.displayName, "Cat");
});

test("Motion rejects unsupported fields, unsafe paths, invalid references, playback and budgets", () => {
  const mutations = [
    (v) => { v.wardrobe = {}; },
    (v) => { v.version = 2; },
    (v) => { v.clips.idle.file = "clips/../idle.webp"; },
    (v) => { v.clips.idle.playbackRate = Infinity; },
    (v) => { v.animations.idle.loop = "missing"; },
    (v) => { v.bindings.idle[0].animation = "wave"; },
    (v) => { v.bindings.events.waving[0].animation = "idle"; },
    (v) => { v.geometry.width = 1280; v.geometry.height = 1280; v.clips.idle.frames = 100; },
    (v) => { v.bindings.idle[0].weight = 0; },
  ];
  for (const mutate of mutations) {
    const value = fixture();
    mutate(value);
    assert.throws(() => validatePetPackageMetadata(value, "cat"));
  }
});

test("Motion variants reject duplicate animations within a binding but allow reuse across bindings", () => {
  const value = fixture();
  value.bindings.contexts = { thinking: [{ animation: "idle" }], working: [{ animation: "idle" }] };
  assert.doesNotThrow(() => validatePetPackageMetadata(value, "cat"));
  value.bindings.contexts.thinking.push({ animation: "idle", weight: 2 });
  assert.throws(() => validatePetPackageMetadata(value, "cat"), /duplicate animation/);
});

function wardrobeFixture() {
  const value = fixture();
  value.clips.coat = { file: "clips/coat.webp", frames: 2 };
  value.animations.coat = { play: "loop", loop: "coat" };
  value.wardrobe = {
    outfits: [{ id: "coat", displayName: " Coat ", bindings: { idle: [{ animation: "coat" }], movement: { left: "coat", right: "coat" } } }],
    schedule: [{ outfit: "coat", when: { days: ["mon"] } }],
  };
  return value;
}

test("Motion outfit uses its own complete bindings without inheriting default artwork", () => {
  const pet = validatePetPackageMetadata(wardrobeFixture(), "cat");
  const base = getMotionOutfitBindings(pet.metadata, "default");
  const coat = getMotionOutfitBindings(pet.metadata, "coat");
  assert.equal(base.idle[0].animation, "idle");
  assert.equal(coat.idle[0].animation, "coat");
  assert.equal(coat.events, undefined);
  assert.equal(coat.contexts, undefined);
  assert.equal(pet.metadata.wardrobe.outfits[0].displayName, "Coat");
  assert.equal(resolveWornOutfitId(pet.metadata.wardrobe, { outfit: "coat" }, new Date()), "coat");
  assert.throws(() => getMotionOutfitBindings(pet.metadata, "unknown"));
});

test("Motion wardrobe rejects incomplete outfits, invalid references, duplicate identities and schedules", () => {
  const mutations = [
    (v) => { delete v.wardrobe.outfits[0].bindings.idle; },
    (v) => { delete v.wardrobe.outfits[0].bindings.movement.right; },
    (v) => { v.wardrobe.outfits[0].bindings.movement.left = "wave"; },
    (v) => { v.wardrobe.outfits[0].bindings.contexts = { thinking: [{ animation: "missing" }] }; },
    (v) => { v.wardrobe.outfits[0].bindings.events = { waving: [{ animation: "coat" }] }; },
    (v) => { v.wardrobe.outfits[0].bindings.idle.push({ animation: "coat" }); },
    (v) => { v.wardrobe.outfits.push(structuredClone(v.wardrobe.outfits[0])); },
    (v) => { v.wardrobe.outfits[0].id = "default"; },
    (v) => { v.wardrobe.outfits[0].id = "auto"; },
    (v) => { v.wardrobe.schedule[0].outfit = "missing"; },
    (v) => { v.wardrobe.schedule[0].when.days = ["someday"]; },
    (v) => { v.wardrobe.schedule[0].extra = true; },
    (v) => { v.wardrobe.outfits[0].gaze = {}; },
    (v) => { v.activities = []; },
    (v) => { v.gaze = {}; },
    (v) => { v.wardrobe.outfits = Array.from({ length: 17 }, (_, i) => ({ ...structuredClone(v.wardrobe.outfits[0]), id: `coat${i}` })); },
  ];
  for (const mutate of mutations) {
    const value = wardrobeFixture();
    mutate(value);
    assert.throws(() => validatePetPackageMetadata(value, "cat"));
  }
});

test("Classic wardrobe identity and creator schedules retain existing behavior", () => {
  const wardrobe = validatePetWardrobe({ outfits: [{ id: "coat", displayName: " Coat ", spritesheetPath: "outfits/coat.webp" }], schedule: [{ outfit: "coat", when: { days: ["mon"] } }] });
  assert.equal(wardrobe.outfits[0].displayName, "Coat");
  assert.equal(resolveWornOutfitId(wardrobe, { outfit: "coat" }, new Date()), "coat");
  assert.throws(() => validatePetWardrobe({ outfits: wardrobe.outfits, schedule: [{ outfit: "missing", when: { days: ["mon"] } }] }));
});

test("Classic asset dispatch preserves existing V1 atlas behavior", async () => {
  const dir = await mkdtemp(join(tmpdir(), "classic-package-"));
  try {
    await writeFile(join(dir, "pet.json"), "{}");
    await writeFile(join(dir, "spritesheet.webp"), "atlas");
    const pet = validatePetPackageMetadata({ id: "cat", displayName: "Cat", description: "Pet", spritesheetPath: "spritesheet.webp" }, "cat");
    const result = await validatePetPackageAssets(dir, pet, decoder(), { exactPackage: true });
    assert.deepEqual(result.package, pet);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Motion validation decodes and copies native timing, rejecting corrupt or unsafe assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "motion-package-"));
  try {
    const source = join(root, "source");
    const copy = join(root, "copy");
    await mkdir(source); await mkdir(copy); await mkdir(join(source, "clips"));
    await writeFile(join(source, "pet.json"), JSON.stringify(fixture()));
    const clip = join(source, "clips/idle.webp");
    await writeFile(clip, "fixture");
    const pet = validatePetPackageMetadata(fixture(), "cat");
    const result = await validatePetPackageAssets(source, pet, decoder(), { exactPackage: true, copyTo: copy });
    assert.deepEqual(result.verifiedClips.idle, { frameDurationsMs: [40, 60], durationMs: 100 });
    assert.equal(await readFile(join(copy, "clips/idle.webp"), "utf8"), "fixture");
    for (const invalid of [{ delay: [40, 0] }, { delay: [40] }, { pages: 3 }, { pageHeight: 11 }, { hasAlpha: false }]) {
      await assert.rejects(validatePetPackageAssets(source, pet, decoder(invalid)));
    }
    await assert.rejects(validatePetPackageAssets(source, pet, decoder({}, true)));
    await writeFile(join(source, "clips/extra.webp"), "extra");
    await assert.rejects(validatePetPackageAssets(source, pet, decoder()));
    await rm(join(source, "clips/extra.webp"));
    await truncate(clip, motionMaxClipBytes + 1);
    await assert.rejects(validatePetPackageAssets(source, pet, decoder()));
    await rm(clip); await symlink(join(source, "pet.json"), clip);
    await assert.rejects(validatePetPackageAssets(source, pet, decoder()));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Motion ZIP allowlist is opt-in and enforces safe paths", () => {
  assert.throws(() => validateZipEntryName("clips/idle.webp"));
  assert.equal(validateZipEntryName("wrapper/clips/idle.webp", "motion").relativeOutputPath, "clips/idle.webp");
  for (const name of ["clips/../idle.webp", "clips/UPPER.webp", "outfits/idle.webp", "clips/nested/idle.webp"]) {
    assert.throws(() => validateZipEntryName(name, "motion"));
  }
});
