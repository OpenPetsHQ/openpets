import { getAppStateSnapshot, getPetWardrobePreference, setPetWardrobePreference } from "./app-state.js";
import { builtInPet, builtInPetWardrobe } from "./built-in-pet.js";
import { readInstalledPetPackage } from "./installed-pet-layout.js";
import { info } from "./logger.js";
import { assertSafePetId } from "./pet-paths.js";
import { getRenderedOutfits } from "./pet-wardrobe-render-state.js";
import type { PetWardrobeSnapshot } from "./pet-wardrobe-types.js";
import {
  automaticOutfitChoice,
  defaultOutfitId,
  findActiveOutfitRuleIndex,
  getEffectiveOutfitSchedule,
  isWardrobeOutfit,
  maxOutfitScheduleRules,
  parseOutfitScheduleRule,
  resolveWornOutfitId,
  type WardrobeDefinition,
  type PetWardrobePreference,
} from "@open-pets/pet-format/wardrobe";

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
  readonly wardrobe: WardrobeDefinition;
  readonly outfitId: string;
}

const wornOutfits = new Map<string, WornOutfit>();
let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
let wardrobeChangeHandler: ((petId: string, reason: "manual" | "scheduled", retry: boolean) => void) | null = null;
const wardrobeListeners = new Set<(petId: string) => void>();

export function setPetWardrobeChangeHandler(handler: typeof wardrobeChangeHandler): void {
  wardrobeChangeHandler = handler;
}

export function subscribePetWardrobeChanges(listener: (petId: string) => void): () => void {
  wardrobeListeners.add(listener);
  return () => { wardrobeListeners.delete(listener); };
}

function notifyWardrobeChanged(petId: string): void {
  for (const listener of wardrobeListeners) listener(petId);
}

/** Resolve the outfit a pet window renders now and keep it under schedule watch. */
export function resolveRenderedPetOutfit(petId: string, wardrobe: WardrobeDefinition | undefined): string {
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
    wardrobeChangeHandler?.(petId, "scheduled", false);
    notifyWardrobeChanged(petId);
  }
  if (wornOutfits.size > 0) armScheduleTimer();
}

export type { PetWardrobeSnapshot } from "./pet-wardrobe-types.js";

/** Wardrobe view for one installed pet, or null when it has no outfits. */
export async function getPetWardrobeSnapshot(petId: string): Promise<PetWardrobeSnapshot | null> {
  const appearance = await readInstalledPetWardrobe(petId);
  if (!appearance) return null;
  const { wardrobe } = appearance;
  const preference = getPetWardrobePreference(petId);
  const schedule = getEffectiveOutfitSchedule(wardrobe, preference);
  const now = new Date();
  const activeRuleIndex = findActiveOutfitRuleIndex(wardrobe, schedule, now);
  const rendered = getRenderedOutfits(petId);
  const committed = new Set(rendered.flatMap((entry) => entry.outfitId === null ? [] : [entry.outfitId]));
  return {
    petId,
    format: appearance.format,
    previewFormat: appearance.format === "motion" ? "image" : "atlas",
    ...(appearance.format === "motion" ? { previewWidth: appearance.width, previewHeight: appearance.height } : {}),
    outfits: wardrobe.outfits.map((outfit) => ({ id: outfit.id, displayName: outfit.displayName })),
    creatorSchedule: wardrobe.schedule,
    schedule,
    scheduleCustomized: preference?.schedule !== undefined,
    choice: isWardrobeOutfit(wardrobe, preference?.outfit) ? preference.outfit : automaticOutfitChoice,
    requested: resolveWornOutfitId(wardrobe, preference, now),
    wearing: committed.size === 1 && rendered.every((entry) => entry.outfitId !== null) ? [...committed][0]! : null,
    rendered,
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
  const appearance = await readInstalledPetWardrobe(petId);
  if (!appearance) throw new Error("This pet has no wardrobe.");
  const { wardrobe } = appearance;
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
  wardrobeChangeHandler?.(petId, "manual", false);
  notifyWardrobeChanged(petId);
  return getPetWardrobeSnapshot(petId);
}

export async function retryPetOutfit(petId: string, outfitId: string): Promise<PetWardrobeSnapshot> {
  const appearance = await readInstalledPetWardrobe(petId);
  if (!appearance || !isWardrobeOutfit(appearance.wardrobe, outfitId)) throw new Error("Unknown outfit.");
  const requested = resolveWornOutfitId(appearance.wardrobe, getPetWardrobePreference(petId), new Date());
  if (requested !== outfitId) throw new Error("Only the currently requested outfit can be retried.");
  wardrobeChangeHandler?.(petId, "manual", true);
  notifyWardrobeChanged(petId);
  const snapshot = await getPetWardrobeSnapshot(petId);
  if (!snapshot) throw new Error("This pet has no wardrobe.");
  return snapshot;
}

type InstalledWardrobe =
  | { readonly format: "classic"; readonly wardrobe: WardrobeDefinition }
  | { readonly format: "motion"; readonly wardrobe: WardrobeDefinition; readonly width: number; readonly height: number };

async function readInstalledPetWardrobe(petId: string): Promise<InstalledWardrobe | undefined> {
  const pet = getAppStateSnapshot().pets.installed.find((candidate) => candidate.id === petId);
  if (!pet) return undefined;
  if (pet.id === builtInPet.id) return { format: "classic", wardrobe: builtInPetWardrobe };
  assertSafePetId(petId);
  const petPackage = await readInstalledPetPackage(petId, pet.source?.kind === "team" ? "team" : "personal");
  const wardrobe = petPackage.metadata.wardrobe;
  if (!wardrobe) return undefined;
  if (petPackage.format === "motion") {
    return { format: "motion", wardrobe, width: petPackage.metadata.geometry.width, height: petPackage.metadata.geometry.height };
  }
  return { format: "classic", wardrobe };
}
