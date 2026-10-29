import { getPetSpritesheetSpec, type PetSpritesheetPath } from "install-pet/spritesheet";
import { validatePetWardrobe, type PetWardrobe } from "./wardrobe.js";
import { validatePetActivities, type PetActivity } from "./activities.js";

export const maxCodexPetJsonBytes = 128 * 1024;
export const maxCodexSpritesheetBytes = 100 * 1024 * 1024;

export interface CodexPetMetadata {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly spritesheetPath: PetSpritesheetPath;
  readonly spriteVersionNumber?: 2;
  readonly gazeAnchor?: CodexPetGazeAnchor;
  /** Optional outfits sharing this pet's atlas layout. */
  readonly wardrobe?: PetWardrobe;
  readonly activities?: readonly PetActivity[];
}

/** A gaze target normalized within one sprite frame, measured from its top-left. */
export interface CodexPetGazeAnchor {
  readonly x: number;
  readonly y: number;
}

export function validateCodexPetMetadata(value: unknown, folderName: string): CodexPetMetadata {
  if (!isSafeCodexPetId(folderName)) throw new Error("Codex pet folder name is invalid.");
  if (!isRecord(value)) throw new Error("pet.json must be an object.");
  const spritesheet = getPetSpritesheetSpec(value);
  if (value.id !== folderName || typeof value.id !== "string") throw new Error("Codex pet id must match its folder name.");
  if (!isSafeCodexPetId(value.id)) throw new Error("Codex pet id is invalid.");
  if (typeof value.displayName !== "string" || value.displayName.trim().length === 0 || value.displayName.length > 80) throw new Error("Codex pet displayName is invalid.");
  if (typeof value.description !== "string" || value.description.trim().length === 0 || value.description.length > 500) throw new Error("Codex pet description is invalid.");
  const gazeAnchor = value.gazeAnchor === undefined ? undefined : validateCodexPetGazeAnchor(value.gazeAnchor);
  const wardrobe = value.wardrobe === undefined ? undefined : validatePetWardrobe(value.wardrobe);
  const activities = validatePetActivities(value.activities);
  return {
    id: value.id,
    displayName: value.displayName.trim(),
    description: value.description.trim(),
    spritesheetPath: spritesheet.spritesheetPath,
    ...(spritesheet.version === 2 ? { spriteVersionNumber: 2 as const } : {}),
    ...(gazeAnchor ? { gazeAnchor } : {}),
    ...(wardrobe ? { wardrobe } : {}),
    ...(value.activities !== undefined ? { activities } : {}),
  };
}

function validateCodexPetGazeAnchor(value: unknown): CodexPetGazeAnchor {
  if (!isRecord(value)
    || typeof value.x !== "number"
    || !Number.isFinite(value.x)
    || value.x < 0
    || value.x > 1
    || typeof value.y !== "number"
    || !Number.isFinite(value.y)
    || value.y < 0
    || value.y > 1) {
    throw new Error("Codex pet gazeAnchor must contain normalized finite x and y coordinates.");
  }
  return { x: value.x, y: value.y };
}

function isSafeCodexPetId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) && value !== "builtin";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
