import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { maxCodexSpritesheetBytes } from "../metadata.js";
import { maxPetActivityDurationMs, minPetActivityDurationMs } from "../activities.js";
import { motionMaxDecodedPixels } from "../package.js";
import { calculateMotionActivityDurationMs, enumerateMotionActivityAnimations, type VerifiedMotionClip } from "../motion.js";
import type { PetPackage, ValidatedPetPackage } from "../package-types.js";
import { validatePetAtlases, type ImageDecoder } from "./atlas-validation.js";
import { readBoundedRegularFile } from "./files.js";

// Safety ceilings, not a distribution or runtime performance budget.
export const motionMaxClipBytes = 1024 * 1024 * 1024;
export const motionMaxTotalBytes = motionMaxClipBytes;

export async function validatePetPackageAssets(
  directory: string,
  petPackage: PetPackage,
  decoder: ImageDecoder,
  options: { readonly exactPackage?: boolean; readonly copyTo?: string } = {},
): Promise<ValidatedPetPackage> {
  if (petPackage.format === "classic") {
    await validatePetAtlases(directory, petPackage.metadata, maxCodexSpritesheetBytes, decoder, options);
    return { package: petPackage };
  }

  const { metadata } = petPackage;
  const names = await readdir(directory);
  if (options.exactPackage && (names.length !== 2 || !names.includes("pet.json") || !names.includes("clips"))) {
    throw new Error("Motion package must contain exactly pet.json and clips/.");
  }
  const clipsDirectory = join(directory, "clips");
  const stats = await lstat(clipsDirectory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("Motion clips must be a directory.");
  const expected = new Set(Object.values(metadata.clips).map((clip) => clip.file.slice("clips/".length)));
  const actual = await readdir(clipsDirectory);
  if (actual.length !== expected.size || actual.some((name) => !expected.has(name))) {
    throw new Error("Motion clips directory must contain exactly the declared clips.");
  }
  if (options.copyTo) await mkdir(join(options.copyTo, "clips"), { mode: 0o700 });
  let totalBytes = 0;
  const verifiedClips: Record<string, VerifiedMotionClip> = Object.create(null);
  for (const [name, clip] of Object.entries(metadata.clips)) {
    const bytes = await readBoundedRegularFile(join(clipsDirectory, clip.file.slice("clips/".length)), motionMaxClipBytes, `Motion clip ${name}`);
    totalBytes += bytes.byteLength;
    if (totalBytes > motionMaxTotalBytes) throw new Error("Motion clips exceed the aggregate size limit.");
    const image = decoder.open(bytes, motionMaxDecodedPixels);
    const facts = await image.metadata();
    if (facts.format !== "webp" || !facts.hasAlpha || facts.pages !== clip.frames
      || facts.width !== metadata.geometry.width || facts.pageHeight !== metadata.geometry.height
      || facts.height !== metadata.geometry.height * clip.frames) {
      throw new Error(`Motion clip ${name} has invalid format, alpha, dimensions, or frame count.`);
    }
    if (!facts.delay || facts.delay.length !== clip.frames
      || facts.delay.some((delay) => !Number.isFinite(delay) || delay <= 0 || delay > 60_000)) {
      throw new Error(`Motion clip ${name} has invalid frame durations.`);
    }
    const frameDurationsMs = [...facts.delay];
    const durationMs = frameDurationsMs.reduce((total, delay) => total + delay, 0);
    if (durationMs > 300_000) throw new Error(`Motion clip ${name} exceeds the duration limit.`);
    await image.decode();
    verifiedClips[name] = { frameDurationsMs, durationMs };
    if (options.copyTo) await writeFile(join(options.copyTo, clip.file), bytes, { mode: 0o600, flag: "wx" });
  }
  for (const activity of metadata.activities ?? []) {
    for (const representation of enumerateMotionActivityAnimations(activity)) {
      const animation = metadata.animations[representation.animation];
      if (!animation || animation.play !== "once") throw new Error(`Motion activity ${activity.id} needs a finite animation.`);
      const durationMs = calculateMotionActivityDurationMs(animation, metadata.clips, verifiedClips);
      if (durationMs < minPetActivityDurationMs || durationMs > maxPetActivityDurationMs) {
        throw new Error(`Motion activity ${activity.id} duration must be from 1000 to 12000 milliseconds.`);
      }
    }
  }
  return { package: petPackage, verifiedClips };
}
