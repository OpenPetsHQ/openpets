import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertPetPackageFiles, type PetSpritesheetPath } from "install-pet/spritesheet";

import { validateCodexPetOutfitSpritesheet, validateCodexPetSpritesheet, type CodexPetMetadata } from "./codex-pets-core.js";
import type { PetOutfit } from "./pet-wardrobe-core.js";

const outfitsDirectoryName = "outfits";

type PetAtlasSelection = Pick<CodexPetMetadata, "spritesheetPath" | "wardrobe">;

/**
 * Check the atlas files pet.json selects. An exact package may contain nothing
 * else: the base atlas, pet.json, and — only with a wardrobe — an `outfits/`
 * directory holding exactly the declared outfit atlases.
 */
export async function assertPetSpritesheetFiles(directory: string, metadata: PetAtlasSelection, exactPackage = false): Promise<void> {
  const names = await readdir(directory);
  const hasOutfits = Boolean(metadata.wardrobe);
  const files = exactPackage
    ? names.filter((name) => !(hasOutfits && name === outfitsDirectoryName))
    : names.filter((name) => name === "pet.json" || name === "spritesheet.webp" || name === "spritesheet.svg");
  assertPetPackageFiles(files, metadata.spritesheetPath);
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
