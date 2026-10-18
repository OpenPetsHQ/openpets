import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertPetPackageFiles, type PetSpritesheetPath } from "install-pet/spritesheet";

import { validateCodexPetSpritesheet, type CodexPetMetadata } from "./codex-pets-core.js";
import type { PetOutfit } from "./pet-wardrobe-core.js";

const outfitsDirectoryName = "outfits";

type PetAtlasSelection = Pick<CodexPetMetadata, "spritesheetPath" | "wardrobe">;

/** One validated atlas file of a pet package, addressed relative to the pet directory. */
export interface PetAtlasFile {
  readonly relativePath: string;
  readonly bytes: Buffer;
}

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

/** Read and validate every atlas a pet selects: the base spritesheet, then each outfit in manifest order. */
export async function readValidatedPetAtlases(
  directory: string,
  metadata: CodexPetMetadata,
  maxBytes: number,
  exactPackage = false,
): Promise<readonly PetAtlasFile[]> {
  await assertPetSpritesheetFiles(directory, metadata, exactPackage);
  const base = await readBoundedRegularFile(join(directory, metadata.spritesheetPath), maxBytes, metadata.spritesheetPath);
  await validateCodexPetSpritesheet(base, metadata);
  const atlases: PetAtlasFile[] = [{ relativePath: metadata.spritesheetPath, bytes: base }];
  for (const outfit of metadata.wardrobe?.outfits ?? []) {
    atlases.push({ relativePath: outfit.spritesheetPath, bytes: await readValidatedOutfitAtlas(directory, metadata, outfit, maxBytes) });
  }
  return atlases;
}

/** Read one outfit atlas and require it to match the pet's own atlas layout. */
async function readValidatedOutfitAtlas(directory: string, metadata: CodexPetMetadata, outfit: PetOutfit, maxBytes: number): Promise<Buffer> {
  const bytes = await readBoundedRegularFile(join(directory, outfit.spritesheetPath), maxBytes, outfit.spritesheetPath);
  await validateCodexPetSpritesheet(bytes, { spriteVersionNumber: metadata.spriteVersionNumber, spritesheetPath: getOutfitAtlasFormat(outfit) });
  return bytes;
}

/** Write validated atlases into a fresh private install candidate. */
export async function writePetAtlases(directory: string, atlases: readonly PetAtlasFile[]): Promise<void> {
  if (atlases.some((atlas) => atlas.relativePath.startsWith(`${outfitsDirectoryName}/`))) {
    await mkdir(join(directory, outfitsDirectoryName), { mode: 0o700 });
  }
  for (const atlas of atlases) {
    await writeFile(join(directory, atlas.relativePath), atlas.bytes, { mode: 0o600, flag: "wx" });
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
