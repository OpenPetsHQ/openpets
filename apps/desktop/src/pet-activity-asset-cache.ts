import { lstat } from "node:fs/promises";
import { join } from "node:path";

import type { PetActivity } from "./pet-activities-core.js";
import { readPetActivitySpritesheet } from "./pet-file-safety.js";

interface AssetValidation {
  readonly version: string;
  readonly available: Promise<boolean>;
}

interface PetValidation {
  readonly directory: string;
  readonly declaration: string;
  readonly activities: Map<string, AssetValidation>;
}

/** Snapshot-only validation results: no image bytes, timers, or filesystem watchers. */
export class PetActivityAssetCache {
  private readonly pets = new Map<string, PetValidation>();

  constructor(private readonly readSpritesheet = readPetActivitySpritesheet) {}

  retainPets(installedIds: readonly string[]): void {
    const installed = new Set(installedIds);
    for (const petId of this.pets.keys()) {
      if (!installed.has(petId)) this.forgetPet(petId);
    }
  }

  forgetPet(petId: string): void {
    this.pets.delete(petId);
  }

  clear(): void {
    this.pets.clear();
  }

  async getUnavailableIds(petId: string, directory: string, activities: readonly PetActivity[]): Promise<ReadonlySet<string>> {
    if (activities.length === 0) {
      this.forgetPet(petId);
      return new Set();
    }
    const declaration = activities.map((activity) => {
      return `${activity.id}:${activity.spritesheetPath}:${activity.frameCount}`;
    }).join("/");
    let pet = this.pets.get(petId);
    if (!pet || pet.directory !== directory || pet.declaration !== declaration) {
      pet = { directory, declaration, activities: new Map() };
      this.pets.set(petId, pet);
    }
    // A changed declaration gets its own bucket so an older in-flight snapshot
    // cannot reinsert removed activities. Each current package has at most 16
    // entries; retainPets bounds the outer map to current installed pets.
    const availability = await Promise.all(activities.map(async (activity) => ({
      id: activity.id,
      available: await this.isAvailable(pet, activity),
    })));
    return new Set(availability.filter((activity) => !activity.available).map((activity) => activity.id));
  }

  private async isAvailable(pet: PetValidation, activity: PetActivity): Promise<boolean> {
    let version: string;
    try {
      version = await readAssetVersion(pet.directory, activity);
    } catch {
      // A missing/unsafe path is checked again next snapshot, not negatively
      // cached forever. A repaired file can become available without reinstall.
      pet.activities.delete(activity.id);
      return false;
    }
    const previous = pet.activities.get(activity.id);
    if (previous?.version === version) return previous.available;

    const available = this.readSpritesheet(pet.directory, activity).then(async () => {
      // Do not associate decoded old bytes with a file changed during decoding.
      return await readAssetVersion(pet.directory, activity) === version;
    }).catch(() => false);
    // Store the pending result too, so simultaneous polls share one decode.
    // Invalidation detaches this map; completion never repopulates it.
    pet.activities.set(activity.id, { version, available });
    return available;
  }
}

async function readAssetVersion(directory: string, activity: PetActivity): Promise<string> {
  const [packageStats, directoryStats, fileStats] = await Promise.all([
    lstat(directory, { bigint: true }),
    lstat(join(directory, "activities"), { bigint: true }),
    lstat(join(directory, activity.spritesheetPath), { bigint: true }),
  ]);
  if (!packageStats.isDirectory() || !directoryStats.isDirectory() || !fileStats.isFile()) {
    throw new Error("Pet activity asset paths must be regular package files and directories.");
  }
  // Inode/device detect atomic replacements; nanosecond ctime also detects an
  // in-place edit with restored mtime/size. Include directories to detect swaps
  // or redirects without trusting a previously validated optional asset.
  const identity = [packageStats, directoryStats, fileStats].map((stats) => {
    return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(":");
  }).join("/");
  return `${activity.spritesheetPath}:${activity.frameCount}:${identity}`;
}
