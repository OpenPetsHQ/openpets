import { resolve, sep } from "node:path";
import type { PetSpritesheetPath } from "install-pet/spritesheet";

export interface SafeZipEntryPath {
  readonly originalName: string;
  readonly normalizedName: string;
  readonly topLevelDirectory: string;
  readonly relativeOutputPath: "pet.json" | PetSpritesheetPath | `outfits/${string}` | `activities/${string}` | null;
  readonly isDirectory: boolean;
  /** A wardrobe atlas under `outfits/`; the manifest decides later whether it is expected. */
  readonly isOutfitAtlas: boolean;
}

const outfitAtlasFileName = /^[a-z0-9][a-z0-9_-]{0,31}\.(?:webp|svg)$/;
const activityAtlasFileName = /^[a-z0-9][a-z0-9_-]{0,31}\.webp$/;

export class ZipEntryPathTracker {
  readonly #normalizedPaths = new Set<string>();
  readonly #caseFoldedPaths = new Set<string>();
  #topLevelDirectory: string | null = null;

  accept(fileName: string): SafeZipEntryPath {
    const entry = validateZipEntryName(fileName);

    if (this.#topLevelDirectory !== null && entry.topLevelDirectory !== this.#topLevelDirectory) {
      throw new Error("Zip contains mixed or multiple top-level layouts.");
    }

    this.#topLevelDirectory = entry.topLevelDirectory;

    if (this.#normalizedPaths.has(entry.normalizedName)) {
      throw new Error(`Duplicate zip entry path: ${entry.normalizedName}`);
    }

    const caseFolded = entry.normalizedName.toLocaleLowerCase("en-US");
    if (this.#caseFoldedPaths.has(caseFolded)) {
      throw new Error(`Case-insensitive zip entry collision: ${entry.normalizedName}`);
    }

    this.#normalizedPaths.add(entry.normalizedName);
    this.#caseFoldedPaths.add(caseFolded);
    return entry;
  }
}

export function validateZipEntryName(fileName: string): SafeZipEntryPath {
  if (fileName.includes("\0")) throw new Error("Zip entry contains NUL byte.");
  if (fileName.includes("\\")) throw new Error("Zip entry contains backslash separator.");
  if (fileName.startsWith("/") || fileName.startsWith("//")) throw new Error("Zip entry is absolute.");
  if (/^[a-zA-Z]:\//.test(fileName)) throw new Error("Zip entry contains Windows drive path.");
  if (fileName.includes("//")) throw new Error("Zip entry contains empty path segment.");

  const parts = fileName.split("/").filter(Boolean);
  if (parts.some((part) => part === "..")) throw new Error("Zip entry contains parent traversal.");
  if (parts.some((part) => part === ".")) throw new Error("Zip entry contains current-directory segment.");

  const isDirectory = fileName.endsWith("/");
  if (isDirectory) {
    if (parts.length !== 1 && !(parts.length === 2 && (parts[1] === "outfits" || parts[1] === "activities"))) throw new Error("Zip directory layout is unsupported.");
    return {
      originalName: fileName,
      normalizedName: parts.join("/"),
      // Bare asset folders belong to the root layout, not a wrapper pet folder.
      topLevelDirectory: parts.length === 1 && (parts[0] === "outfits" || parts[0] === "activities") ? "" : parts[0] ?? "",
      relativeOutputPath: null,
      isDirectory: true,
      isOutfitAtlas: false,
    };
  }

  const leaf = parts.at(-1) ?? "";
  if ((parts.length === 2 || parts.length === 3)
    && parts.at(-2) === "activities"
    && activityAtlasFileName.test(leaf)) {
    return {
      originalName: fileName,
      normalizedName: parts.join("/"),
      topLevelDirectory: parts.length === 3 ? parts[0] ?? "" : "",
      relativeOutputPath: `activities/${leaf}`,
      isDirectory: false,
      isOutfitAtlas: false,
    };
  }
  if (leaf !== "pet.json" && leaf !== "spritesheet.webp" && leaf !== "spritesheet.svg") {
    const outfitDepth = parts.at(-2) === "outfits" ? parts.length : 0;
    if ((outfitDepth === 2 || outfitDepth === 3) && outfitAtlasFileName.test(leaf)) {
      return {
        originalName: fileName,
        normalizedName: parts.join("/"),
        topLevelDirectory: outfitDepth === 3 ? parts[0] ?? "" : "",
        relativeOutputPath: `outfits/${leaf}`,
        isDirectory: false,
        isOutfitAtlas: true,
      };
    }
    throw new Error(`Unexpected zip file: ${leaf}`);
  }

  if (parts.length !== 1 && parts.length !== 2) throw new Error("Zip must contain pet files at the root or under exactly one top-level directory.");

  return {
    originalName: fileName,
    normalizedName: parts.join("/"),
    topLevelDirectory: parts.length === 1 ? "" : parts[0] ?? "",
    relativeOutputPath: leaf,
    isDirectory: false,
    isOutfitAtlas: false,
  };
}

export function assertOutputPathInside(tempDir: string, outputPath: string): void {
  const root = resolve(tempDir);
  const target = resolve(outputPath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("Zip entry output path escapes temp directory.");
  }
}

export function hasSupportedZipMagic(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return false;
  }

  const signature = buffer.readUInt32LE(0);
  return signature === 0x04034b50 || signature === 0x06054b50;
}

export function assertRejectsPath(fileName: string): void {
  try {
    validateZipEntryName(fileName);
  } catch {
    return;
  }
  throw new Error(`Unsafe zip path was accepted: ${fileName}`);
}
