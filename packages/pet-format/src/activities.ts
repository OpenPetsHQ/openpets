import { codexV1SpriteLayout } from "./sprite-layout.js";
import { defaultOutfitId, isSafeOutfitId, maxPetOutfits } from "./wardrobe.js";

/** Package-owned one-shot animations, separate from reaction atlases and outfits. */
export interface PetActivityAnimation {
  readonly outfitId: string;
  readonly spritesheetPath: string;
  readonly frameCount: number;
  readonly fps: number;
}

export interface PetActivityIdentity {
  readonly id: string;
  readonly displayName: string;
}

export interface PetActivity extends PetActivityIdentity, PetActivityAnimation {
  readonly outfitVariants?: readonly PetActivityAnimation[];
}

export const maxPetActivities = 16;
export const petActivityFrameWidth = codexV1SpriteLayout.frameWidth;
export const petActivityFrameHeight = codexV1SpriteLayout.frameHeight;
export const minPetActivityFrameCount = 4;
export const maxPetActivityFrameCount = 32;
export const minPetActivityFps = 1;
export const maxPetActivityFps = 12;
export const minPetActivityDurationMs = 1_000;
export const maxPetActivityDurationMs = 12_000;
export const maxPetActivitySpritesheetBytes = 2 * 1024 * 1024;
export const maxPetActivityTotalBytes = 16 * 1024 * 1024;

export function getPetActivityDurationMs(activity: PetActivityAnimation): number {
  return activity.frameCount * 1_000 / activity.fps;
}

/** List the primary representation followed by its outfit variants. */
export function enumeratePetActivityAnimations(activity: PetActivity): readonly PetActivityAnimation[] {
  return [activity, ...(activity.outfitVariants ?? [])];
}

export function resolvePetActivityAnimation(activity: PetActivity, outfitId: string): PetActivityAnimation | null {
  return enumeratePetActivityAnimations(activity).find((animation) => animation.outfitId === outfitId) ?? null;
}

export function validatePetActivityIdentity(value: unknown): PetActivityIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Pet activity must be an object.");
  }
  const activity = value as Record<string, unknown>;
  if (typeof activity.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(activity.id)) {
    throw new Error("Pet activity id is invalid.");
  }
  if (typeof activity.displayName !== "string"
    || activity.displayName.trim().length < 1
    || activity.displayName.trim().length > 40) {
    throw new Error("Pet activity displayName must contain 1 to 40 characters.");
  }
  return { id: activity.id, displayName: activity.displayName.trim() };
}

/** Validate untrusted pet.json data without image, filesystem, or platform dependencies. */
export function validatePetActivities(value: unknown, availableOutfitIds: readonly string[] = []): readonly PetActivity[] {
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
    const identity = validatePetActivityIdentity(activity);
    if (ids.has(identity.id)) throw new Error("Pet activity ids must be unique.");
    ids.add(identity.id);
    const outfitIds = new Set<string>();
    const validateAnimation = (value: unknown, primary: boolean): PetActivityAnimation => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Pet activity animation must be an object.");
      }
      const animation = value as Record<string, unknown>;
      if (!isSafeOutfitId(animation.outfitId) || (animation.outfitId !== defaultOutfitId && !availableOutfitIds.includes(animation.outfitId))) {
        throw new Error("Pet activity references an unknown outfit.");
      }
      if (outfitIds.has(animation.outfitId)) throw new Error("Pet activity outfits must be unique.");
      outfitIds.add(animation.outfitId);
      const expectedPath = primary ? `activities/${identity.id}.webp` : `activities/${identity.id}.${animation.outfitId}.webp`;
      if (animation.spritesheetPath !== expectedPath) {
        throw new Error("Pet activity spritesheetPath must match its activity and outfit ids.");
      }
      if (typeof animation.frameCount !== "number"
        || !Number.isInteger(animation.frameCount)
        || animation.frameCount < minPetActivityFrameCount
        || animation.frameCount > maxPetActivityFrameCount) {
        throw new Error("Pet activity frameCount must be an integer from 4 to 32.");
      }
      if (typeof animation.fps !== "number"
        || !Number.isInteger(animation.fps)
        || animation.fps < minPetActivityFps
        || animation.fps > maxPetActivityFps) {
        throw new Error("Pet activity fps must be an integer from 1 to 12.");
      }
      const validated: PetActivityAnimation = {
        outfitId: animation.outfitId,
        spritesheetPath: expectedPath,
        frameCount: animation.frameCount,
        fps: animation.fps,
      };
      const durationMs = getPetActivityDurationMs(validated);
      if (durationMs < minPetActivityDurationMs || durationMs > maxPetActivityDurationMs) {
        throw new Error("Pet activity duration must be from 1000 to 12000 milliseconds.");
      }
      return validated;
    };
    const primary = validateAnimation(activity, true);
    if (activity.outfitVariants !== undefined && (!Array.isArray(activity.outfitVariants) || activity.outfitVariants.length > maxPetOutfits)) {
      throw new Error(`Pet activity outfitVariants must be an array of at most ${maxPetOutfits} entries.`);
    }
    const outfitVariants = (activity.outfitVariants as unknown[] | undefined)?.map((variant) => validateAnimation(variant, false));
    return {
      ...identity,
      ...primary,
      ...(outfitVariants?.length ? { outfitVariants } : {}),
    };
  });
}
