/**
 * pinned-pets.ts
 *
 * Pure logic for user-pinned desktop pets.
 *
 * A pinned pet is a window the USER owns: it is not bound to an agent lease, not bound
 * to a plugin lifetime and not tied to the current session. It stays on the desktop
 * until the user unpins it. The preference is an ordered list of pet IDs in
 * `preferences.pinnedPets`; undefined / empty keeps the legacy single-pet behaviour, so
 * no migration is required for existing profiles.
 *
 * Eligibility mirrors the pet pool (installed, not broken, not the built-in pet, not the
 * current default pet) for the same reason: one pet ID must never be rendered by two
 * windows at once.
 *
 * Window positions are remembered per pinned pet ID in `preferences.pinnedPetPositions`,
 * validated with the same position normaliser the default pet uses.
 */

import { normalizePosition, type DefaultPetPosition } from "./default-pet-position-state.js";
import { assertSafePetId } from "./pet-paths.js";

/** Hard cap on simultaneously pinned pets — every pin is a real OS window. */
export const maxPinnedPets = 8;

export interface PinnedPetPlanInput {
  /** Ordered pinned pet IDs from preferences; undefined/empty = feature off. */
  readonly pinnedPets: readonly string[] | undefined;
  /** Pet IDs that currently own a pinned window. */
  readonly openPinnedPets: readonly string[];
  /** Installed, non-broken, non-built-in, non-default pet IDs that may be pinned. */
  readonly eligiblePetIds: readonly string[];
}

export interface PinnedPetPlan {
  /** Pet IDs that must own a window, in pin order. */
  readonly spawn: readonly string[];
  /** Pet IDs whose pinned window must be destroyed (unpinned, uninstalled or broken). */
  readonly close: readonly string[];
}

/**
 * Resolve the difference between the pinned preference and the windows that exist.
 * Pure: it never touches Electron, so the spawn/close decision is unit-testable.
 */
export function planPinnedPets(input: PinnedPetPlanInput): PinnedPetPlan {
  const { pinnedPets, openPinnedPets, eligiblePetIds } = input;
  const eligible = new Set(eligiblePetIds);
  const desired = (pinnedPets ?? []).filter((petId) => eligible.has(petId));
  const desiredSet = new Set(desired);
  const open = new Set(openPinnedPets);

  return {
    spawn: desired.filter((petId) => !open.has(petId)),
    close: openPinnedPets.filter((petId) => !desiredSet.has(petId)),
  };
}

/**
 * Normalise `pinnedPets`: trim entries, drop blanks, drop duplicates (keeping the first
 * occurrence), drop IDs that fail the safe-pet-id check, and cap the list at
 * `maxPinnedPets`. Returns `undefined` when nothing is pinned, which preserves the
 * legacy single-pet behaviour.
 */
export function normalizePinnedPetIds(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (result.length >= maxPinnedPets) break;
    if (typeof entry !== "string") continue;
    const petId = entry.trim();
    if (!petId || seen.has(petId)) continue;
    try {
      assertSafePetId(petId);
    } catch {
      continue;
    }
    seen.add(petId);
    result.push(petId);
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Normalise the remembered position of each pinned pet. Entries that are not a safe pet
 * ID or not a valid position are dropped. Returns `undefined` when nothing survives.
 */
export function normalizePinnedPetPositions(value: unknown): Readonly<Record<string, DefaultPetPosition>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const result: Record<string, DefaultPetPosition> = {};
  for (const [petId, rawPosition] of Object.entries(value as Record<string, unknown>)) {
    try {
      assertSafePetId(petId);
    } catch {
      continue;
    }
    const position: DefaultPetPosition | undefined = normalizePosition(rawPosition);
    if (!position) continue;
    result[petId] = { x: position.x, y: position.y };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Keep only the positions of pets that are still pinned, so no unpin path can leave a
 * stale entry behind. Called from preference normalisation, which every writer goes
 * through, and therefore the single owner of this cleanup.
 */
export function prunePinnedPetPositions(
  positions: Readonly<Record<string, DefaultPetPosition>> | undefined,
  pinnedPets: readonly string[] | undefined,
): Readonly<Record<string, DefaultPetPosition>> | undefined {
  if (!positions || !pinnedPets || pinnedPets.length === 0) return undefined;
  const pinned = new Set(pinnedPets);
  const kept = Object.entries(positions).filter(([petId]) => pinned.has(petId));
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}
