import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertPetPackageFiles, type PetSpritesheetPath } from "install-pet/spritesheet";
import sharp from "sharp";

import { validateCodexPetOutfitSpritesheet, validateCodexPetSpritesheet, type CodexPetMetadata } from "./codex-pets-core.js";
import type { PetOutfit } from "./pet-wardrobe-core.js";
import {
  maxPetActivitySpritesheetBytes,
  maxPetActivityTotalBytes,
  maxPetActivityFrameCount,
  petActivityFrameHeight,
  petActivityFrameWidth,
  type PetActivity,
} from "./pet-activities-core.js";

const outfitsDirectoryName = "outfits";
const activitiesDirectoryName = "activities";
// Match Studio imaging/activities.py: MIN_CELL_PIXELS and ALPHA_VISIBLE.
const minPetActivityVisiblePixels = 200;
const petActivityVisibleAlphaThreshold = 16;

type PetAtlasSelection = Pick<CodexPetMetadata, "spritesheetPath" | "wardrobe" | "activities">;

/**
 * Check the atlas files pet.json selects. An exact package may contain nothing
 * else: the base atlas, pet.json, and — only with a wardrobe — an `outfits/`
 * directory holding exactly the declared outfit atlases, and an `activities/`
 * directory holding exactly the declared activity strips.
 */
export async function assertPetSpritesheetFiles(directory: string, metadata: PetAtlasSelection, exactPackage = false): Promise<void> {
  const names = await readdir(directory);
  const hasOutfits = Boolean(metadata.wardrobe);
  const hasActivities = (metadata.activities?.length ?? 0) > 0;
  const files = exactPackage
    ? names.filter((name) => !(hasOutfits && name === outfitsDirectoryName)
      && !(hasActivities && name === activitiesDirectoryName))
    : names.filter((name) => name === "pet.json" || name === "spritesheet.webp" || name === "spritesheet.svg");
  assertPetPackageFiles(files, metadata.spritesheetPath);
  if (exactPackage) await assertPetActivityFiles(directory, metadata.activities ?? []);
  // Installed pets are checked leniently: a missing outfit only falls back to the base atlas.
  if (!metadata.wardrobe || !exactPackage) return;

  const outfitsDirectory = join(directory, outfitsDirectoryName);
  const stats = await lstat(outfitsDirectory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("Pet outfits must be a directory.");
  const expected = new Set(metadata.wardrobe.outfits.map((outfit) => outfitFileName(outfit)));
  const actual = await readdir(outfitsDirectory);
  if (actual.length !== expected.size || actual.some((name) => !expected.has(name))) {
    throw new Error("Pet outfits directory must contain exactly the outfit spritesheets listed in pet.json.");
  }
}

/**
 * Validate every atlas a pet selects — the base spritesheet, then each outfit —
 * one at a time, optionally copying each into a fresh private install
 * candidate. Only one atlas is held in memory at once, whatever the outfit
 * count.
 */
export async function validatePetAtlases(
  directory: string,
  metadata: CodexPetMetadata,
  maxBytes: number,
  { exactPackage = false, copyTo }: { readonly exactPackage?: boolean; readonly copyTo?: string } = {},
): Promise<void> {
  await assertPetSpritesheetFiles(directory, metadata, exactPackage);
  // Folder/Codex sources may contain authoring collateral, but their activity
  // directory is package data and must match the declarations exactly.
  if (!exactPackage) await assertPetActivityFiles(directory, metadata.activities ?? []);
  const base = await readBoundedRegularFile(join(directory, metadata.spritesheetPath), maxBytes, metadata.spritesheetPath);
  await validateCodexPetSpritesheet(base, metadata);
  if (copyTo) await writeFile(join(copyTo, metadata.spritesheetPath), base, { mode: 0o600, flag: "wx" });
  const outfits = metadata.wardrobe?.outfits ?? [];
  if (copyTo && outfits.length > 0) await mkdir(join(copyTo, outfitsDirectoryName), { mode: 0o700 });
  for (const outfit of outfits) {
    const bytes = await readBoundedRegularFile(join(directory, outfit.spritesheetPath), maxBytes, outfit.spritesheetPath);
    await validateCodexPetOutfitSpritesheet(bytes, metadata, getOutfitAtlasFormat(outfit));
    if (copyTo) await writeFile(join(copyTo, outfit.spritesheetPath), bytes, { mode: 0o600, flag: "wx" });
  }
  const activities = metadata.activities ?? [];
  if (copyTo && activities.length > 0) await mkdir(join(copyTo, activitiesDirectoryName), { mode: 0o700 });
  let activityTotalBytes = 0;
  for (const activity of activities) {
    const bytes = await readPetActivitySpritesheet(directory, activity);
    activityTotalBytes += bytes.byteLength;
    if (activityTotalBytes > maxPetActivityTotalBytes) throw new Error("Pet activity spritesheets exceed the total size limit.");
    if (copyTo) await writeFile(join(copyTo, activity.spritesheetPath), bytes, { mode: 0o600, flag: "wx" });
  }
}

async function assertPetActivityFiles(directory: string, activities: readonly PetActivity[]): Promise<void> {
  const names = await readdir(directory);
  if (!names.includes(activitiesDirectoryName) && activities.length === 0) return;
  const activityDirectory = join(directory, activitiesDirectoryName);
  const stats = await lstat(activityDirectory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("Pet activities must be a directory.");
  const expected = new Set(activities.map((activity) => `${activity.id}.webp`));
  const actual = await readdir(activityDirectory);
  if (activities.length === 0 || actual.length !== expected.size || actual.some((name) => !expected.has(name))) {
    throw new Error("Pet activities directory must contain exactly the activity spritesheets listed in pet.json.");
  }
}

/** Read only one declared activity; optional corruption never validates or breaks the base atlas. */
export async function readPetActivitySpritesheet(directory: string, activity: PetActivity): Promise<Buffer> {
  const activityDirectory = join(directory, activitiesDirectoryName);
  const stats = await lstat(activityDirectory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("Pet activities must be a directory.");
  const bytes = await readBoundedRegularFile(join(directory, activity.spritesheetPath), maxPetActivitySpritesheetBytes, activity.spritesheetPath);
  await validatePetActivitySpritesheet(bytes, activity);
  return bytes;
}

/** Fully decode bounded static WebP strips before they enter an install candidate or renderer. */
export async function validatePetActivitySpritesheet(bytes: Buffer, activity: PetActivity): Promise<void> {
  if (bytes.byteLength === 0 || bytes.byteLength > maxPetActivitySpritesheetBytes) {
    throw new Error("Pet activity spritesheet size is invalid.");
  }
  const image = sharp(bytes, {
    animated: true,
    failOn: "error",
    limitInputPixels: petActivityFrameWidth * maxPetActivityFrameCount * petActivityFrameHeight,
  });
  try {
    const metadata = await image.metadata();
    if (metadata.format !== "webp") throw new Error("Pet activity spritesheet must be WebP.");
    if ((metadata.pages ?? 1) !== 1 || metadata.loop !== undefined || metadata.delay !== undefined) {
      throw new Error("Pet activity spritesheet must be static, not animated WebP.");
    }
    const width = petActivityFrameWidth * activity.frameCount;
    if (metadata.width !== width || metadata.height !== petActivityFrameHeight) {
      throw new Error(`Pet activity spritesheet must be exactly ${width}x${petActivityFrameHeight}.`);
    }
    if (!metadata.hasAlpha) throw new Error("Pet activity spritesheet needs transparency in every frame.");
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let frame = 0; frame < activity.frameCount; frame += 1) {
      let visiblePixels = 0;
      let hasTransparentPixel = false;
      const frameLeft = frame * petActivityFrameWidth;
      for (let y = 0; y < petActivityFrameHeight; y += 1) {
        for (let x = 0; x < petActivityFrameWidth; x += 1) {
          const pixelOffset = (y * width + frameLeft + x) * info.channels;
          const alpha = data[pixelOffset + info.channels - 1]!;
          if (alpha > petActivityVisibleAlphaThreshold) visiblePixels += 1;
          if (alpha === 0) hasTransparentPixel = true;
        }
      }
      if (visiblePixels < minPetActivityVisiblePixels) {
        throw new Error(`Pet activity frame ${frame + 1} is empty or has too little visible artwork.`);
      }
      if (!hasTransparentPixel) {
        throw new Error(`Pet activity frame ${frame + 1} has no transparent background.`);
      }
    }
  } catch (error) {
    throw new Error(`Pet activity spritesheet is invalid: ${error instanceof Error ? error.message : "cannot decode image"}`);
  }
}

/** Outfit atlases follow the same per-format rules as the canonical base atlas names. */
export function getOutfitAtlasFormat(outfit: PetOutfit): PetSpritesheetPath {
  return outfit.spritesheetPath.endsWith(".svg") ? "spritesheet.svg" : "spritesheet.webp";
}

function outfitFileName(outfit: PetOutfit): string {
  return outfit.spritesheetPath.slice(outfitsDirectoryName.length + 1);
}

export async function readBoundedRegularFile(path: string, maxBytes: number, label: string): Promise<Buffer> {
  const resolved = resolve(path);
  const stats = await lstat(resolved);
  if (stats.isSymbolicLink()) throw new Error(`${label} cannot be a symlink.`);
  if (!stats.isFile()) throw new Error(`${label} must be a file.`);
  if (stats.size <= 0 || stats.size > maxBytes) throw new Error(`${label} size is invalid.`);
  const file = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const openedStats = await file.stat();
    if (!openedStats.isFile() || openedStats.size !== stats.size || openedStats.size <= 0 || openedStats.size > maxBytes) throw new Error(`${label} size is invalid.`);
    return await file.readFile();
  } finally {
    await file.close();
  }
}
