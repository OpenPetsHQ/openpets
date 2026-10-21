/** Package-owned one-shot animations, separate from reaction atlases and outfits. */
export interface PetActivity {
  readonly id: string;
  readonly displayName: string;
  readonly outfitId: "default";
  readonly spritesheetPath: string;
  readonly frameCount: number;
  readonly fps: number;
}

export const maxPetActivities = 16;
export const petActivityFrameWidth = 192;
export const petActivityFrameHeight = 208;
export const minPetActivityFrameCount = 4;
export const maxPetActivityFrameCount = 32;
export const minPetActivityFps = 1;
export const maxPetActivityFps = 12;
export const minPetActivityDurationMs = 1_000;
export const maxPetActivityDurationMs = 12_000;
export const maxPetActivitySpritesheetBytes = 2 * 1024 * 1024;
export const maxPetActivityTotalBytes = 16 * 1024 * 1024;

export function getPetActivityDurationMs(activity: PetActivity): number {
  return activity.frameCount * 1_000 / activity.fps;
}

/** Validate untrusted pet.json data without image, filesystem, or platform dependencies. */
export function validatePetActivities(value: unknown): readonly PetActivity[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxPetActivities) {
    throw new Error(`Pet activities must be an array of at most ${maxPetActivities} entries.`);
  }

  const ids = new Set<string>();
  return Array.from(value, (entry: unknown): PetActivity => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("Pet activity must be an object.");
    }
    const activity = entry as Record<string, unknown>;
    if (typeof activity.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(activity.id)) {
      throw new Error("Pet activity id is invalid.");
    }
    if (ids.has(activity.id)) throw new Error("Pet activity ids must be unique.");
    ids.add(activity.id);
    if (typeof activity.displayName !== "string"
      || activity.displayName.trim().length < 1
      || activity.displayName.trim().length > 40) {
      throw new Error("Pet activity displayName must contain 1 to 40 characters.");
    }
    if (activity.outfitId !== "default") throw new Error("Pet activities must use the default outfit.");
    if (activity.spritesheetPath !== `activities/${activity.id}.webp`) {
      throw new Error("Pet activity spritesheetPath must match its activity id.");
    }
    if (typeof activity.frameCount !== "number"
      || !Number.isInteger(activity.frameCount)
      || activity.frameCount < minPetActivityFrameCount
      || activity.frameCount > maxPetActivityFrameCount) {
      throw new Error("Pet activity frameCount must be an integer from 4 to 32.");
    }
    if (typeof activity.fps !== "number"
      || !Number.isInteger(activity.fps)
      || activity.fps < minPetActivityFps
      || activity.fps > maxPetActivityFps) {
      throw new Error("Pet activity fps must be an integer from 1 to 12.");
    }
    const validated: PetActivity = {
      id: activity.id,
      displayName: activity.displayName.trim(),
      outfitId: "default",
      spritesheetPath: activity.spritesheetPath,
      frameCount: activity.frameCount,
      fps: activity.fps,
    };
    const durationMs = getPetActivityDurationMs(validated);
    if (durationMs < minPetActivityDurationMs || durationMs > maxPetActivityDurationMs) {
      throw new Error("Pet activity duration must be from 1000 to 12000 milliseconds.");
    }
    return validated;
  });
}
