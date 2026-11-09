import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";

import { validatePetPackageMetadata } from "@open-pets/pet-format/package";
import { decodeMotionPreviewFrame, validateDesktopPetPackageAssets } from "../src/pet-atlas-validation.js";

test("desktop decoder verifies every Motion frame and retains encoded durations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openpets-motion-validation-"));
  try {
    await mkdir(join(directory, "clips"));
    const pixels = Buffer.alloc(16 * 32 * 4, 255);
    pixels[3] = 0;
    pixels[16 * 16 * 4 + 3] = 0;
    for (let offset = 16 * 16 * 4; offset < pixels.length; offset += 4) pixels[offset] = 0;
    const clip = await sharp(pixels, { raw: { width: 16, height: 32, channels: 4, pageHeight: 16 } })
      .webp({ loop: 0, delay: [100, 120] }).toBuffer();
    await writeFile(join(directory, "clips", "idle.webp"), clip);
    const petPackage = validatePetPackageMetadata({
      format: "motion", version: 1, id: "motion-test", displayName: "Motion", description: "Motion test",
      geometry: { width: 16, height: 16, pixelsPerUnit: 1, footAnchor: { x: 8, y: 16 } },
      clips: { idle: { file: "clips/idle.webp", frames: 2 } },
      animations: { idle: { play: "loop", loop: "idle" } },
      bindings: { idle: [{ animation: "idle" }], movement: { left: "idle", right: "idle" } },
    }, "motion-test");
    const validated = await validateDesktopPetPackageAssets(directory, petPackage);
    assert.equal(validated.package.format, "motion");
    if ("verifiedClips" in validated) {
      assert.deepEqual(validated.verifiedClips.idle?.frameDurationsMs, [100, 120]);
    } else {
      assert.fail("Motion package must include verified clip timing.");
    }
    if (petPackage.format !== "motion") assert.fail("Expected Motion metadata.");
    const preview = await decodeMotionPreviewFrame(clip, petPackage.metadata.geometry);
    const decoded = await sharp(preview).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, 16);
    assert.equal(decoded.info.height, 16);
    assert.equal(decoded.data[3], 0);
    assert.ok(decoded.data[4]! > 220, "the first white frame, not the second green frame, is selected");
    await writeFile(join(directory, "clips", "idle.webp"), clip.subarray(0, Math.floor(clip.length / 2)));
    await assert.rejects(() => validateDesktopPetPackageAssets(directory, petPackage));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
