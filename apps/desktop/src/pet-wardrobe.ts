import { getAppStateSnapshot, getPetWardrobePreference, setPetWardrobePreference } from "./app-state.js";
import { readInstalledPetMetadata } from "./installed-pet-layout.js";
import { info } from "./logger.js";
import { assertSafePetId } from "./pet-paths.js";
import { refreshPetWindowsForPetId } from "./pet-window-refresh.js";
import {
  automaticOutfitChoice,
  defaultOutfitId,
  findActiveOutfitRuleIndex,
  getEffectiveOutfitSchedule,
  isWardrobeOutfit,
  maxOutfitScheduleRules,
  parseOutfitScheduleRule,
  resolveWornOutfitId,
  type OutfitScheduleRule,
  type PetWardrobe,
  type PetWardrobePreference,
} from "./pet-wardrobe-core.js";

/**
 * Owns which outfit each rendered pet wears: resolution at render time, the
 * minute ticker that swaps outfits when the schedule moves on, and the user's
 * wardrobe preference updates from Control Center and the pet context menu.
 *
 * Precedence (highest first): user "always wear" choice, user schedule, the
 * pet's creator schedule, the default outfit. A future plugin SDK override
 * belongs above the user choice and should stay in-memory, owned here.
 */

interface WornOutfit {
  readonly wardrobe: PetWardrobe;
  readonly outfitId: string;
}

const wornOutfits = new Map<string, WornOutfit>();
let scheduleTimer: ReturnType<typeof setTimeout> | null = null;

/** Resolve the outfit a pet window renders now and keep it under schedule watch. */
export function resolveRenderedPetOutfit(petId: string, wardrobe: PetWardrobe | undefined): string {
  if (!wardrobe) {
    wornOutfits.delete(petId);
    return defaultOutfitId;
  }
  const outfitId = resolveWornOutfitId(wardrobe, getPetWardrobePreference(petId), new Date());
  wornOutfits.set(petId, { wardrobe, outfitId });
  armScheduleTimer();
  return outfitId;
}

function armScheduleTimer(): void {
  if (scheduleTimer) return;
  // Schedules have minute resolution; wake just after each minute boundary.
  const delayMs = 60_000 - (Date.now() % 60_000) + 250;
  scheduleTimer = setTimeout(checkScheduledOutfits, delayMs);
  scheduleTimer.unref?.();
}

function checkScheduledOutfits(): void {
  scheduleTimer = null;
  const now = new Date();
  for (const [petId, worn] of wornOutfits) {
    const next = resolveWornOutfitId(worn.wardrobe, getPetWardrobePreference(petId), now);
    if (next === worn.outfitId) continue;
    info("pet.wardrobe", "scheduled outfit change", { petId, from: worn.outfitId, to: next });
    // The re-render records the pet again; a pet no longer on screen simply drops out.
    wornOutfits.delete(petId);
    refreshPetWindowsForPetId(petId, "outfit-schedule");
  }
  if (wornOutfits.size > 0) armScheduleTimer();
}

export interface PetWardrobeSnapshot {
  readonly petId: string;
  readonly outfits: ReadonlyArray<{ readonly id: string; readonly displayName: string }>;
  /** The creator schedule shipped in pet.json. */
  readonly creatorSchedule: readonly OutfitScheduleRule[];
  /** The schedule in effect: the user's copy when customized, else the creator's. */
  readonly schedule: readonly OutfitScheduleRule[];
  readonly scheduleCustomized: boolean;
  /** "auto" follows the schedule; otherwise the outfit the user always wears. */
  readonly choice: string;
  readonly wearing: string;
  /** What the schedule alone picks right now, regardless of an "always wear" choice. */
  readonly scheduled: string;
  /** Index into `schedule` of the rule that matches now, or -1 when the default applies. */
  readonly activeRuleIndex: number;
}

/** Wardrobe view for one installed pet, or null when it has no outfits. */
export async function getPetWardrobeSnapshot(petId: string): Promise<PetWardrobeSnapshot | null> {
  const wardrobe = await readInstalledPetWardrobe(petId);
  if (!wardrobe) return null;
  const preference = getPetWardrobePreference(petId);
  const schedule = getEffectiveOutfitSchedule(wardrobe, preference);
  const now = new Date();
  const activeRuleIndex = findActiveOutfitRuleIndex(wardrobe, schedule, now);
  return {
    petId,
    outfits: wardrobe.outfits.map((outfit) => ({ id: outfit.id, displayName: outfit.displayName })),
    creatorSchedule: wardrobe.schedule,
    schedule,
    scheduleCustomized: preference?.schedule !== undefined,
    choice: isWardrobeOutfit(wardrobe, preference?.outfit) ? preference.outfit : automaticOutfitChoice,
    wearing: resolveWornOutfitId(wardrobe, preference, now),
    scheduled: schedule[activeRuleIndex]?.outfit ?? defaultOutfitId,
    activeRuleIndex,
  };
}

/**
 * Apply a wardrobe change for one pet. `outfit: "auto"` returns to the
 * schedule; `schedule: null` restores the creator schedule. Fields left
 * undefined keep their current value.
 */
export async function updatePetWardrobe(petId: string, patch: unknown): Promise<PetWardrobeSnapshot | null> {
  if (typeof patch !== "object" || patch === null) throw new Error("Invalid wardrobe update.");
  const wardrobe = await readInstalledPetWardrobe(petId);
  if (!wardrobe) throw new Error("This pet has no wardrobe.");
  const { outfit, schedule } = patch as { readonly outfit?: unknown; readonly schedule?: unknown };
  const known = (id: unknown): id is string => isWardrobeOutfit(wardrobe, id);
  const current = getPetWardrobePreference(petId);
  let nextOutfit = current?.outfit;
  let nextSchedule = current?.schedule;

  if (outfit !== undefined) {
    if (outfit === automaticOutfitChoice) nextOutfit = undefined;
    else if (known(outfit)) nextOutfit = outfit;
    else throw new Error("Unknown outfit.");
  }
  if (schedule !== undefined) {
    if (schedule === null) {
      nextSchedule = undefined;
    } else {
      if (!Array.isArray(schedule) || schedule.length > maxOutfitScheduleRules) throw new Error("Invalid outfit schedule.");
      nextSchedule = schedule.map((entry: unknown) => {
        const rule = parseOutfitScheduleRule(entry);
        if (!known(rule.outfit)) throw new Error(`Outfit schedule references an unknown outfit: ${rule.outfit}`);
        return rule;
      });
    }
  }

  const preference: PetWardrobePreference = {
    ...(nextOutfit !== undefined ? { outfit: nextOutfit } : {}),
    ...(nextSchedule !== undefined ? { schedule: nextSchedule } : {}),
  };
  setPetWardrobePreference(petId, preference);
  info("pet.wardrobe", "wardrobe preference updated", { petId, outfit: nextOutfit ?? "auto", scheduleCustomized: nextSchedule !== undefined });
  wornOutfits.delete(petId);
  refreshPetWindowsForPetId(petId, "outfit-preference");
  return getPetWardrobeSnapshot(petId);
}

async function readInstalledPetWardrobe(petId: string): Promise<PetWardrobe | undefined> {
  const pet = getAppStateSnapshot().pets.installed.find((candidate) => candidate.id === petId);
  if (!pet || pet.builtIn) return undefined;
  assertSafePetId(petId);
  return (await readInstalledPetMetadata(petId, pet.source?.kind === "team" ? "team" : "personal")).wardrobe;
}
