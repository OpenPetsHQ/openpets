import type { PetActivity } from "./pet-activities-core.js";

export const activityIdleDelayMs = 60_000;
export const activityCooldownMs = 300_000;

/** A full package replacement may remove ids that still exist in saved preferences. */
export function updateEnabledPetActivityIds(
  activities: readonly PetActivity[],
  savedIds: readonly string[],
  activityId: string,
  enabled: boolean,
): readonly string[] {
  const installedIds = new Set(activities.map((activity) => activity.id));
  if (!installedIds.has(activityId)) throw new Error("Unknown pet activity.");
  const currentIds = savedIds.filter((id) => installedIds.has(id));
  return enabled
    ? [...new Set([...currentIds, activityId])]
    : currentIds.filter((id) => id !== activityId);
}

export function nextActivityOpportunityMs(random: () => number): number {
  return activityIdleDelayMs + 60_000 + Math.floor(Math.max(0, Math.min(1, random())) * 120_000);
}

export function selectIdlePetActivity(
  activities: readonly PetActivity[],
  enabledIds: readonly string[],
  lastPlayedAt: ReadonlyMap<string, number>,
  lastActivityId: string | null,
  now: number,
  random: () => number,
): PetActivity | null {
  const enabled = activities.filter((activity) => enabledIds.includes(activity.id));
  const candidates = enabled.filter((activity) => {
    const previous = lastPlayedAt.get(activity.id);
    return (previous === undefined || now - previous >= activityCooldownMs)
      && (enabled.length === 1 || activity.id !== lastActivityId);
  });
  if (candidates.length === 0) return null;
  const index = Math.min(candidates.length - 1, Math.floor(Math.max(0, random()) * candidates.length));
  return candidates[index] ?? null;
}

/** Saved ids are opt-in only; invalid entries never turn a new activity on. */
export function normalizePetActivityPreferences(value: unknown): Readonly<Record<string, readonly string[]>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries: Array<[string, string[]]> = [];
  for (const [petId, ids] of Object.entries(value)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(petId) || !Array.isArray(ids)) continue;
    const normalized = [...new Set(ids.filter((id): id is string => typeof id === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)))].slice(0, 16);
    if (normalized.length > 0) entries.push([petId, normalized]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
