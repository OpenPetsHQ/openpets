import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateCodexPetMetadata } from "../dist/metadata.js";
import { resolveWornOutfitId } from "../dist/wardrobe.js";
import { enumeratePetActivityAnimations, resolvePetActivityAnimation, validatePetActivities } from "../dist/activities.js";
import { validateZipEntryName } from "../dist/node/paths.js";
import {
  validateCodexPetSpritesheet,
  validateCodexPetOutfitSpritesheet,
  validatePetActivitySpritesheet,
  validatePetAtlases,
} from "../dist/node/atlas-validation.js";

const activity = { id: "dance", displayName: "Dance", outfitId: "default", spritesheetPath: "activities/dance.webp", frameCount: 4, fps: 4 };
const bytes = Buffer.from("image");

function decoder(metadata, { failDecode = false, pixels } = {}) {
  return {
    open() {
      return {
        async metadata() { return metadata; },
        async decode() { if (failDecode) throw new Error("corrupt"); },
        async decodeWithAlpha() {
          if (failDecode) throw new Error("corrupt");
          return { data: pixels, channels: 4 };
        },
      };
    },
  };
}

test("metadata validates optional package data and wardrobe resolution keeps first-match semantics", () => {
  const wardrobe = {
    outfits: [{ id: "night", displayName: " Night ", spritesheetPath: "outfits/night.webp" }],
    schedule: [{ outfit: "night", when: { time: { from: "22:00", to: "07:00" } } }],
  };
  const metadata = validateCodexPetMetadata({ id: "pet", displayName: " Pet ", description: " OK ", spritesheetPath: "spritesheet.webp", wardrobe, activities: [activity] }, "pet");
  assert.equal(metadata.displayName, "Pet");
  assert.equal(resolveWornOutfitId(metadata.wardrobe, undefined, new Date(2025, 0, 1, 23)), "night");
  assert.equal(resolveWornOutfitId(metadata.wardrobe, { schedule: [] }, new Date(2025, 0, 1, 23)), "default");
  assert.throws(() => validateCodexPetMetadata({ ...metadata, activities: [activity, activity] }, "pet"));
});

test("legacy base skips decoding but V1 outfits and V2 bases require full image decoding", async () => {
  const invalid = decoder({ format: "webp", width: 1536, height: 1872 }, { failDecode: true });
  await validateCodexPetSpritesheet(bytes, { spritesheetPath: "spritesheet.webp" }, invalid);
  await assert.rejects(validateCodexPetOutfitSpritesheet(bytes, {}, "spritesheet.webp", invalid), /fully decodable/);
  const v2 = { spritesheetPath: "spritesheet.webp", spriteVersionNumber: 2 };
  const facts = { format: "webp", width: 1536, height: 2288, hasAlpha: true, pages: 1 };
  await validateCodexPetSpritesheet(bytes, v2, decoder(facts));
  for (const bad of [{ hasAlpha: false }, { pages: 2 }, { width: 1 }, { format: "png" }]) {
    await assert.rejects(validateCodexPetSpritesheet(bytes, v2, decoder({ ...facts, ...bad })));
  }
  await assert.rejects(validateCodexPetSpritesheet(bytes, v2, decoder(facts, { failDecode: true })));
});

test("activity rejects animated, empty and opaque frames after full decode", async () => {
  const width = 192 * activity.frameCount;
  const facts = { format: "webp", width, height: 208, hasAlpha: true };
  const pixels = new Uint8Array(width * 208 * 4);
  for (let frame = 0; frame < activity.frameCount; frame++) {
    for (let i = 0; i < 200; i++) {
      const x = frame * 192 + i % 192;
      const y = Math.floor(i / 192);
      pixels[(y * width + x) * 4 + 3] = 255;
    }
  }
  await validatePetActivitySpritesheet(bytes, activity, decoder(facts, { pixels }));
  await assert.rejects(validatePetActivitySpritesheet(bytes, activity, decoder({ ...facts, loop: 0 }, { pixels })));
  await assert.rejects(validatePetActivitySpritesheet(bytes, activity, decoder(facts, { failDecode: true })));
  const empty = pixels.slice();
  for (let y = 0; y < 208; y++) for (let x = 0; x < 192; x++) empty[(y * width + x) * 4 + 3] = 0;
  await assert.rejects(validatePetActivitySpritesheet(bytes, activity, decoder(facts, { pixels: empty })));
  const opaque = pixels.slice();
  for (let y = 0; y < 208; y++) for (let x = 0; x < 192; x++) opaque[(y * width + x) * 4 + 3] = 255;
  await assert.rejects(validatePetActivitySpritesheet(bytes, activity, decoder(facts, { pixels: opaque })));
});

test("exact packages reject extra outfit files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openpets-validation-"));
  try {
    await writeFile(join(dir, "pet.json"), "{}");
    await writeFile(join(dir, "spritesheet.webp"), bytes);
    await mkdir(join(dir, "outfits"));
    await writeFile(join(dir, "outfits", "night.webp"), bytes);
    await writeFile(join(dir, "outfits", "extra.webp"), bytes);
    const metadata = { id: "pet", displayName: "Pet", description: "Pet", spritesheetPath: "spritesheet.webp", wardrobe: { outfits: [{ id: "night", displayName: "Night", spritesheetPath: "outfits/night.webp" }], schedule: [] } };
    await assert.rejects(validatePetAtlases(dir, metadata, 1024, decoder({}), { exactPackage: true }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("activity representations round-trip and resolve only the exact outfit", () => {
  const night = { outfitId: "night", spritesheetPath: "activities/dance.night.webp", frameCount: 8, fps: 4 };
  const wardrobe = { outfits: [{ id: "night", displayName: "Night", spritesheetPath: "outfits/night.webp" }] };
  const input = { id: "pet", displayName: "Pet", description: "Pet", spritesheetPath: "spritesheet.webp", wardrobe, activities: [{ ...activity, outfitVariants: [night] }] };
  const metadata = validateCodexPetMetadata(input, "pet");
  assert.deepEqual(metadata.activities[0].outfitVariants, [night]);
  assert.deepEqual(validateCodexPetMetadata(JSON.parse(JSON.stringify(metadata)), "pet"), metadata);
  assert.equal(enumeratePetActivityAnimations(metadata.activities[0]).length, 2);
  assert.deepEqual(resolvePetActivityAnimation(metadata.activities[0], "night"), night);
  assert.equal(resolvePetActivityAnimation(metadata.activities[0], "missing"), null);
  assert.equal(validatePetActivities([activity])[0].outfitId, "default");
  const exclusive = { ...activity, outfitId: "night" };
  assert.equal(validateCodexPetMetadata({ ...input, activities: [exclusive] }, "pet").activities[0].outfitId, "night");
  assert.throws(() => validatePetActivities([exclusive]));
  assert.throws(() => validateCodexPetMetadata({ ...input, wardrobe: undefined }, "pet"));
  for (const variant of [
    { ...night, outfitId: "unknown", spritesheetPath: "activities/dance.unknown.webp" },
    { ...night, outfitId: "default", spritesheetPath: "activities/dance.default.webp" },
    { ...night, spritesheetPath: activity.spritesheetPath },
    { ...night, frameCount: 3 },
  ]) assert.throws(() => validatePetActivities([{ ...activity, outfitVariants: [variant] }], ["night"]));
  assert.throws(() => validatePetActivities([{ ...activity, outfitVariants: [night, night] }], ["night"]));
  assert.throws(() => validatePetActivities([{ ...activity, outfitVariants: Array(17).fill(night) }], ["night"]));
  assert.equal(validateZipEntryName("wrapper/activities/dance.night.webp").relativeOutputPath, "activities/dance.night.webp");
  assert.throws(() => validateZipEntryName("activities/dance.night.extra.webp"));
});

test("installation validates and copies every declared activity representation", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-variants-"));
  const source = join(root, "source");
  const target = join(root, "target");
  const variant = { outfitId: "night", spritesheetPath: "activities/dance.night.webp", frameCount: 4, fps: 4 };
  const metadata = { id: "pet", displayName: "Pet", description: "Pet", spritesheetPath: "spritesheet.webp", activities: [{ ...activity, outfitVariants: [variant] }] };
  const width = 192 * 4;
  const pixels = new Uint8Array(width * 208 * 4);
  for (let frame = 0; frame < 4; frame++) for (let i = 0; i < 200; i++) pixels[((Math.floor(i / 192) * width) + frame * 192 + i % 192) * 4 + 3] = 255;
  const imageDecoder = decoder({ format: "webp", width, height: 208, hasAlpha: true }, { pixels });
  try {
    await mkdir(source); await mkdir(target); await mkdir(join(source, "activities"));
    await writeFile(join(source, "pet.json"), "{}");
    await writeFile(join(source, "spritesheet.webp"), bytes);
    await writeFile(join(source, activity.spritesheetPath), bytes);
    await writeFile(join(source, variant.spritesheetPath), bytes);
    await validatePetAtlases(source, metadata, 1024, imageDecoder, { exactPackage: true, copyTo: target });
    assert.deepEqual(await readFile(join(target, variant.spritesheetPath)), bytes);
    await assert.rejects(validatePetAtlases(source, { ...metadata, activities: [{ ...activity, outfitVariants: [{ ...variant, frameCount: 5 }] }] }, 1024, imageDecoder));
    await rm(join(source, variant.spritesheetPath));
    await assert.rejects(validatePetAtlases(source, metadata, 1024, imageDecoder));
    await writeFile(join(source, variant.spritesheetPath), bytes);
    await writeFile(join(source, "activities", "extra.webp"), bytes);
    await assert.rejects(validatePetAtlases(source, metadata, 1024, imageDecoder));
    await rm(join(source, "activities", "extra.webp"));
    await writeFile(join(source, variant.spritesheetPath), Buffer.alloc(2 * 1024 * 1024 + 1));
    await assert.rejects(validatePetAtlases(source, metadata, 1024, imageDecoder));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("all representations share the activity byte budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-activity-budget-"));
  const variants = Array.from({ length: 8 }, (_, i) => ({ outfitId: `o${i}`, spritesheetPath: `activities/dance.o${i}.webp`, frameCount: 4, fps: 4 }));
  const metadata = { id: "pet", displayName: "Pet", description: "Pet", spritesheetPath: "spritesheet.webp", activities: [{ ...activity, outfitVariants: variants }] };
  const width = 192 * 4;
  const pixels = new Uint8Array(width * 208 * 4);
  for (let frame = 0; frame < 4; frame++) for (let i = 0; i < 200; i++) pixels[((Math.floor(i / 192) * width) + frame * 192 + i % 192) * 4 + 3] = 255;
  try {
    await mkdir(join(root, "activities"));
    await writeFile(join(root, "pet.json"), "{}");
    await writeFile(join(root, "spritesheet.webp"), bytes);
    for (const animation of [activity, ...variants]) await writeFile(join(root, animation.spritesheetPath), Buffer.alloc(2 * 1024 * 1024));
    await assert.rejects(validatePetAtlases(root, metadata, 1024, decoder({ format: "webp", width, height: 208, hasAlpha: true }, { pixels })), /total size limit/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
