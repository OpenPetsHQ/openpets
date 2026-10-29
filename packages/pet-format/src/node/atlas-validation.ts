import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertPetPackageFiles, getPetSpritesheetSpec, validateSvgSpritesheet, type PetSpritesheetPath } from "install-pet/spritesheet";
import type { CodexPetMetadata } from "../metadata.js";
import type { PetOutfit } from "../wardrobe.js";
import {
  maxPetActivitySpritesheetBytes, maxPetActivityTotalBytes, maxPetActivityFrameCount,
  petActivityFrameHeight, petActivityFrameWidth, type PetActivity,
} from "../activities.js";
import { readBoundedRegularFile } from "./files.js";

/** Image facts must describe the original encoded image, including animation markers. */
export interface ImageMetadata {
  readonly format?: string;
  readonly width?: number;
  readonly height?: number;
  readonly hasAlpha?: boolean;
  readonly pages?: number;
  readonly loop?: number;
  readonly delay?: readonly number[];
}

/**
 * Adapter over a real decoder. `open` must use strict decoding, include animation
 * metadata, and enforce `limitInputPixels` before allocating decoded pixels.
 * `metadata` inspects the original image. `decode` must fully decode it, not
 * just parse headers. `decodeWithAlpha` fully decodes tightly packed, 8-bit
 * pixels in row-major order with alpha in the last channel; `channels` is the
 * number of bytes per pixel. All methods reject malformed/truncated inputs.
 */
export interface ImageDecoder {
  open(bytes: Uint8Array, limitInputPixels: number): {
    metadata(): Promise<ImageMetadata>;
    decode(): Promise<void>;
    decodeWithAlpha(): Promise<{ readonly data: Uint8Array; readonly channels: number }>;
  };
}

export function withAtlasFormat(metadata: Pick<CodexPetMetadata, "spriteVersionNumber">, format: PetSpritesheetPath): Pick<CodexPetMetadata, "spriteVersionNumber" | "spritesheetPath"> {
  return { ...(metadata.spriteVersionNumber === 2 ? { spriteVersionNumber: 2 as const } : {}), spritesheetPath: format };
}

export async function validateCodexPetSpritesheet(bytes: Uint8Array, metadata: Pick<CodexPetMetadata, "spriteVersionNumber" | "spritesheetPath">, decoder: ImageDecoder): Promise<void> {
  const spec = getPetSpritesheetSpec(metadata);
  if (metadata.spritesheetPath === "spritesheet.svg") {
    validateSvgSpritesheet(bytes, spec.width, spec.height);
    return;
  }
  if (spec.version === 1) return;
  await assertDecodableWebpAtlas(bytes, spec, "Codex V2 spritesheet", true, decoder);
}

export async function validateCodexPetOutfitSpritesheet(bytes: Uint8Array, metadata: Pick<CodexPetMetadata, "spriteVersionNumber">, format: PetSpritesheetPath, decoder: ImageDecoder): Promise<void> {
  const formatMetadata = withAtlasFormat(metadata, format);
  await validateCodexPetSpritesheet(bytes, formatMetadata, decoder);
  const spec = getPetSpritesheetSpec(formatMetadata);
  if (format === "spritesheet.webp" && spec.version === 1) {
    await assertDecodableWebpAtlas(bytes, spec, "Outfit spritesheet", false, decoder);
  }
}

async function assertDecodableWebpAtlas(bytes: Uint8Array, spec: { readonly width: number; readonly height: number }, label: string, requireAlpha: boolean, decoder: ImageDecoder): Promise<void> {
  const image = decoder.open(bytes, 50_000_000);
  let metadata: ImageMetadata;
  try {
    metadata = await image.metadata();
  } catch {
    throw new Error(`${label} metadata is invalid.`);
  }
  if (metadata.format !== "webp") throw new Error(`${label} must be WebP.`);
  if (requireAlpha && !metadata.hasAlpha) throw new Error(`${label} must include transparency.`);
  if ((metadata.pages ?? 1) !== 1) throw new Error(`${label} must contain exactly one image.`);
  if (metadata.width !== spec.width || metadata.height !== spec.height) {
    throw new Error(`${label} must be exactly ${spec.width}x${spec.height}.`);
  }
  try {
    await image.decode();
  } catch {
    throw new Error(`${label} must be fully decodable.`);
  }
}

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
  decoder: ImageDecoder,
  { exactPackage = false, copyTo }: { readonly exactPackage?: boolean; readonly copyTo?: string } = {},
): Promise<void> {
  await assertPetSpritesheetFiles(directory, metadata, exactPackage);
  // Folder/Codex sources may contain authoring collateral, but their activity
  // directory is package data and must match the declarations exactly.
  if (!exactPackage) await assertPetActivityFiles(directory, metadata.activities ?? []);
  const base = await readBoundedRegularFile(join(directory, metadata.spritesheetPath), maxBytes, metadata.spritesheetPath);
  await validateCodexPetSpritesheet(base, metadata, decoder);
  if (copyTo) await writeFile(join(copyTo, metadata.spritesheetPath), base, { mode: 0o600, flag: "wx" });
  const outfits = metadata.wardrobe?.outfits ?? [];
  if (copyTo && outfits.length > 0) await mkdir(join(copyTo, outfitsDirectoryName), { mode: 0o700 });
  for (const outfit of outfits) {
    const bytes = await readBoundedRegularFile(join(directory, outfit.spritesheetPath), maxBytes, outfit.spritesheetPath);
    await validateCodexPetOutfitSpritesheet(bytes, metadata, getOutfitAtlasFormat(outfit), decoder);
    if (copyTo) await writeFile(join(copyTo, outfit.spritesheetPath), bytes, { mode: 0o600, flag: "wx" });
  }
  const activities = metadata.activities ?? [];
  if (copyTo && activities.length > 0) await mkdir(join(copyTo, activitiesDirectoryName), { mode: 0o700 });
  let activityTotalBytes = 0;
  for (const activity of activities) {
    const bytes = await readPetActivitySpritesheet(directory, activity, decoder);
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
export async function readPetActivitySpritesheet(directory: string, activity: PetActivity, decoder: ImageDecoder): Promise<Buffer> {
  const activityDirectory = join(directory, activitiesDirectoryName);
  const stats = await lstat(activityDirectory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("Pet activities must be a directory.");
  const bytes = await readBoundedRegularFile(join(directory, activity.spritesheetPath), maxPetActivitySpritesheetBytes, activity.spritesheetPath);
  await validatePetActivitySpritesheet(bytes, activity, decoder);
  return bytes;
}

/** Fully decode bounded static WebP strips before they enter an install candidate or renderer. */
export async function validatePetActivitySpritesheet(bytes: Buffer, activity: PetActivity, decoder: ImageDecoder): Promise<void> {
  if (bytes.byteLength === 0 || bytes.byteLength > maxPetActivitySpritesheetBytes) {
    throw new Error("Pet activity spritesheet size is invalid.");
  }
  const image = decoder.open(bytes, petActivityFrameWidth * maxPetActivityFrameCount * petActivityFrameHeight);
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
    const { data, channels } = await image.decodeWithAlpha();
    if (channels < 2 || data.byteLength !== width * petActivityFrameHeight * channels) {
      throw new Error("Pet activity spritesheet decoded pixels are invalid.");
    }
    for (let frame = 0; frame < activity.frameCount; frame += 1) {
      let visiblePixels = 0;
      let hasTransparentPixel = false;
      const frameLeft = frame * petActivityFrameWidth;
      for (let y = 0; y < petActivityFrameHeight; y += 1) {
        for (let x = 0; x < petActivityFrameWidth; x += 1) {
          const pixelOffset = (y * width + frameLeft + x) * channels;
          const alpha = data[pixelOffset + channels - 1]!;
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
