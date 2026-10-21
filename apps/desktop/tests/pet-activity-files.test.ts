import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

import { validateCodexPetMetadata } from "../src/codex-pets-core.js";
import { readPetActivitySpritesheet, validatePetActivitySpritesheet, validatePetAtlases } from "../src/pet-file-safety.js";
import { maxPetActivitySpritesheetBytes, validatePetActivities } from "../src/pet-activities-core.js";
import { codexV1Fixture } from "./codex-pet-fixtures.js";
import { createPetActivityEmptyFramePixels, createPetActivityPixels, petActivityFixture } from "./pet-activity-fixtures.js";

const activity = validatePetActivities([petActivityFixture])[0]!;
const root = await mkdtemp(join(tmpdir(), "openpets-activity-files-"));
const source = join(root, "source");
const destination = join(root, "candidate");
const raw = createPetActivityPixels();
const strip = await sharp(raw, { raw: { width: 1536, height: 208, channels: 4 } }).webp().toBuffer();

try {
  await validatePetActivitySpritesheet(strip, activity);
  for (const frameCount of [4, 32]) {
    const boundaryActivity = { ...activity, frameCount };
    const boundaryStrip = await sharp(createPetActivityPixels(frameCount), {
      raw: { width: 192 * frameCount, height: 208, channels: 4 },
    }).webp().toBuffer();
    await validatePetActivitySpritesheet(boundaryStrip, boundaryActivity);
  }
  // Match Studio's exact thresholds, including faint pixels at alpha 16/17.
  for (const [visiblePixels, alpha, accepted] of [[200, 17, true], [199, 17, false], [200, 16, false]] as const) {
    const boundaryStrip = await sharp(createPetActivityPixels(8, visiblePixels, alpha), {
      raw: { width: 1536, height: 208, channels: 4 },
    }).webp({ lossless: true }).toBuffer();
    if (accepted) {
      await validatePetActivitySpritesheet(boundaryStrip, activity);
    } else {
      await assert.rejects(() => validatePetActivitySpritesheet(boundaryStrip, activity));
    }
  }
  const opaque = await sharp(strip).removeAlpha().webp().toBuffer();
  await assert.rejects(() => validatePetActivitySpritesheet(opaque, activity), "opaque strips are rejected");
  const singleTransparentPixelPerFrame = Buffer.alloc(raw.length, 255);
  for (let frame = 0; frame < 8; frame += 1) {
    singleTransparentPixelPerFrame[frame * 192 * 4 + 3] = 0;
  }
  const minimallyTransparentStrip = await sharp(singleTransparentPixelPerFrame, {
    raw: { width: 1536, height: 208, channels: 4 },
  }).webp({ lossless: true }).toBuffer();
  await validatePetActivitySpritesheet(minimallyTransparentStrip, activity);
  const emptyFramePixels = createPetActivityEmptyFramePixels();
  const opaqueFramePixels = Buffer.from(raw);
  const nonzeroBackgroundPixels = Buffer.from(raw);
  for (let y = 0; y < 208; y += 1) {
    // Only the final frame is invalid: validating only the first frame is insufficient.
    const lastFrameOffset = (y * 1536 + 7 * 192) * 4;
    for (let x = 0; x < 192; x += 1) {
      opaqueFramePixels[lastFrameOffset + x * 4 + 3] = 255;
      const alphaOffset = lastFrameOffset + x * 4 + 3;
      nonzeroBackgroundPixels[alphaOffset] = Math.max(nonzeroBackgroundPixels[alphaOffset]!, 1);
    }
  }
  for (const invalidFramePixels of [emptyFramePixels, opaqueFramePixels, nonzeroBackgroundPixels]) {
    const invalidStrip = await sharp(invalidFramePixels, {
      raw: { width: 1536, height: 208, channels: 4 },
    }).webp({ lossless: true }).toBuffer();
    await assert.rejects(() => validatePetActivitySpritesheet(invalidStrip, activity), "every frame needs visible artwork and a transparent pixel");
  }
  // A legal RIFF padding chunk makes the on-disk byte limits testable without
  // large or nondeterministic artwork fixtures.
  const paddedStrip = Buffer.alloc(maxPetActivitySpritesheetBytes);
  strip.copy(paddedStrip);
  paddedStrip.write("JUNK", strip.length, "ascii");
  paddedStrip.writeUInt32LE(paddedStrip.length - strip.length - 8, strip.length + 4);
  paddedStrip.writeUInt32LE(paddedStrip.length - 8, 4);
  await validatePetActivitySpritesheet(paddedStrip, activity);
  const wrongWidth = await sharp(strip).resize(768, 208).webp().toBuffer();
  const wrongHeight = await sharp(strip).resize(1536, 416).webp().toBuffer();
  const png = await sharp(strip).png().toBuffer();
  const animated = await sharp(Buffer.concat([raw, Buffer.alloc(raw.length, 30)]), {
    raw: { width: 1536, height: 416, channels: 4, pageHeight: 208 },
  }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  for (const invalid of [Buffer.from("not an image"), strip.subarray(0, strip.length - 10), wrongWidth, wrongHeight, png, animated, Buffer.alloc(maxPetActivitySpritesheetBytes + 1)]) {
    await assert.rejects(() => validatePetActivitySpritesheet(invalid, activity));
  }

  await mkdir(join(source, "activities"), { recursive: true });
  await mkdir(destination);
  const metadata = validateCodexPetMetadata({ ...codexV1Fixture, activities: [activity] }, "aiko");
  await writeFile(join(source, "pet.json"), JSON.stringify(metadata));
  await writeFile(join(source, "spritesheet.webp"), "existing V1 base semantics");
  await writeFile(join(source, activity.spritesheetPath), strip);
  await validatePetAtlases(source, metadata, 100 * 1024 * 1024, { exactPackage: true, copyTo: destination });
  assert.deepEqual(await readFile(join(destination, activity.spritesheetPath)), strip, "candidate includes the activity bytes");

  await writeFile(join(source, "activities", "extra.webp"), strip);
  await assert.rejects(() => validatePetAtlases(source, metadata, 100 * 1024 * 1024), "folder imports reject undeclared activity files");
  await rm(join(source, "activities", "extra.webp"));
  await rm(join(source, activity.spritesheetPath));
  await assert.rejects(() => validatePetAtlases(source, metadata, 100 * 1024 * 1024), "missing declarations reject before copying");
  await symlink(join(destination, activity.spritesheetPath), join(source, activity.spritesheetPath));
  await assert.rejects(() => readPetActivitySpritesheet(source, activity), "activity files cannot be symlinks");
  await rm(join(source, "activities"), { recursive: true });
  await symlink(join(destination, "activities"), join(source, "activities"));
  await assert.rejects(() => readPetActivitySpritesheet(source, activity), "activity directory cannot redirect outside the package");
  await rm(join(source, "activities"));
  await mkdir(join(source, "activities"));
  await assert.rejects(() => validatePetAtlases(source, validateCodexPetMetadata(codexV1Fixture, "aiko"), 100 * 1024 * 1024), "undeclared activity folders reject");

  const activities = Array.from({ length: 9 }, (_, index) => ({
    ...activity,
    id: `dance_${index}`,
    spritesheetPath: `activities/dance_${index}.webp`,
  }));
  for (const entry of activities.slice(0, 8)) {
    await writeFile(join(source, entry.spritesheetPath), paddedStrip);
  }
  const atLimit = validateCodexPetMetadata({ ...codexV1Fixture, activities: activities.slice(0, 8) }, "aiko");
  await validatePetAtlases(source, atLimit, 100 * 1024 * 1024);
  await writeFile(join(source, activities[8]!.spritesheetPath), strip);
  const overLimit = validateCodexPetMetadata({ ...codexV1Fixture, activities }, "aiko");
  await assert.rejects(() => validatePetAtlases(source, overLimit, 100 * 1024 * 1024), "activity files cannot exceed 16 MiB cumulatively");
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("Pet activity file validation passed.");
