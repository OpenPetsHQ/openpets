/**
 * pinned-pet-controller.ts
 *
 * Owns the lifetime of user-pinned pet windows.
 *
 * Before this module the only path that created an agent pet window was the local IPC
 * lease (`onFirstExplicitLease` -> `showAgentPet`), which makes every extra pet a
 * session-bound, transient signal. A pinned pet is different: the user pins it, so the
 * window lives until the user unpins it (or the pet stops being eligible) — no lease, no
 * transient presentation, no session.
 *
 * The decision of what to open and what to close lives in the pure `pinned-pets.ts`
 * planner; this module only applies that plan to Electron windows, and is the single
 * owner of `preferences.pinnedPets` writes that come from a pet window itself
 * (closing a pinned pet unpins it).
 */

import { BrowserWindow } from "electron";

import { getAppStateSnapshot, recordPinnedPetPosition, setPinnedPets, type PetScaleValue } from "./app-state.js";
import { builtInPet } from "./built-in-pet.js";
import { clampToNearestDisplayIfOffscreen, clampToVisibleWorkArea, defaultPetWindowSize, getDefaultPetInitialPosition } from "./display.js";
import { debug, info } from "./logger.js";
import { createAgentPetWindow, readWindowPosition, setPetWindowScale, showPetWindowInactive } from "./pet-window.js";
import { getEligiblePoolPetIds } from "./pet-pool.js";
import { registerRoamingPet, unregisterRoamingPet } from "./pet-roaming-controller.js";
import { maxPinnedPets, planPinnedPets } from "./pinned-pets.js";

const pinnedPetWindows = new Map<string, BrowserWindow>();

/**
 * Motion-engine handle for a pinned pet. Namespaced so a pet that is pinned AND leased
 * to a session (two windows, same pet ID) keeps two independent motion registrations
 * instead of one overwriting the other.
 */
function pinnedMotionHandle(petId: string): string {
  return `pinned:${petId}`;
}

/** Pet IDs that currently own a pinned window. */
export function getPinnedPetWindowIds(): readonly string[] {
  return [...pinnedPetWindows.keys()];
}

/**
 * Bring the pinned windows in line with `preferences.pinnedPets`.
 * Idempotent: called at startup, after a preference change and after pet install/remove.
 */
export function syncPinnedPets(): void {
  const state = getAppStateSnapshot();
  const plan = planPinnedPets({
    pinnedPets: state.preferences.pinnedPets,
    openPinnedPets: getPinnedPetWindowIds(),
    eligiblePetIds: getEligiblePoolPetIds(state.pets.installed, builtInPet.id, state.preferences.defaultPetId),
  });

  for (const petId of plan.close) closePinnedPet(petId);
  for (const petId of plan.spawn) spawnPinnedPet(petId);
}

/** Reload pinned pet content after a host-level appearance change (e.g. pet scale). */
export function refreshPinnedPetContent(): void {
  const scale = getAppStateSnapshot().preferences.petScale as PetScaleValue;
  for (const [petId, window] of pinnedPetWindows) {
    if (window.isDestroyed()) continue;
    setPetWindowScale(window, scale);
    debug("pet.pinned", "refresh scale", { petId, scale });
  }
}

/** Destroy every pinned window without touching the preference (app teardown). */
export function closeAllPinnedPets(): void {
  for (const petId of getPinnedPetWindowIds()) closePinnedPet(petId);
}

/**
 * Close a pinned window because the user asked for it: the pin is removed from the
 * preference so it does not come back on the next launch.
 */
export function unpinPinnedPet(petId: string): void {
  const pinned = getAppStateSnapshot().preferences.pinnedPets ?? [];
  if (!pinned.includes(petId)) {
    closePinnedPet(petId);
    return;
  }
  info("pet.pinned", "unpin", { petId });
  setPinnedPets(pinned.filter((id) => id !== petId));
  closePinnedPet(petId);
}

function closePinnedPet(petId: string): void {
  const window = pinnedPetWindows.get(petId);
  pinnedPetWindows.delete(petId);
  if (window && !window.isDestroyed()) {
    info("pet.pinned", "close", { petId, windowId: window.id });
    unregisterRoamingPet(pinnedMotionHandle(petId));
    window.setIgnoreMouseEvents(false);
    window.destroy();
  }
}

function spawnPinnedPet(petId: string): void {
  if (pinnedPetWindows.size >= maxPinnedPets) {
    debug("pet.pinned", "spawn skipped, cap reached", { petId, cap: maxPinnedPets });
    return;
  }

  const state = getAppStateSnapshot();
  const installed = state.pets.installed.find((pet) => pet.id === petId);
  if (!installed || installed.broken) {
    debug("pet.pinned", "spawn skipped, pet not eligible", { petId });
    return;
  }

  const remembered = state.preferences.pinnedPetPositions?.[petId];
  const base = getDefaultPetInitialPosition(defaultPetWindowSize);
  const cascadeOffset = (pinnedPetWindows.size + 1) * 48;
  const rawPosition = remembered ?? { x: base.x - cascadeOffset, y: base.y - cascadeOffset };
  const position = remembered
    ? rawPosition
    : state.preferences.petCrossDisplayEnabled
      ? clampToNearestDisplayIfOffscreen(rawPosition, defaultPetWindowSize)
      : clampToVisibleWorkArea(rawPosition, defaultPetWindowSize);

  const window = createAgentPetWindow({
    petId,
    displayName: installed.displayName,
    scale: state.preferences.petScale as PetScaleValue,
    position,
    display: null,
    badge: null,
    onCloseRequested: () => unpinPinnedPet(petId),
    onWindowReplaced: (replacement) => {
      pinnedPetWindows.set(petId, replacement);
      replacement.once("closed", () => {
        if (pinnedPetWindows.get(petId) === replacement) pinnedPetWindows.delete(petId);
      });
    },
  });

  pinnedPetWindows.set(petId, window);
  window.once("closed", () => {
    if (pinnedPetWindows.get(petId) === window) pinnedPetWindows.delete(petId);
  });
  const savePosition = debounce(() => {
    if (window.isDestroyed()) return;
    recordPinnedPetPosition(petId, readWindowPosition(window));
  }, 150);
  window.on("move", savePosition);
  window.on("moved", savePosition);
  showPetWindowInactive(window);
  const shownWindow = pinnedPetWindows.get(petId);
  if (shownWindow && !shownWindow.isDestroyed()) {
    registerRoamingPet(pinnedMotionHandle(petId), () => pinnedPetWindows.get(petId) ?? null);
  }
  info("pet.pinned", "spawn", { petId, windowId: window.id, position, remembered: Boolean(remembered), pinned: pinnedPetWindows.size });
}

function debounce(callback: () => void, delayMs: number): () => void {
  let timer: NodeJS.Timeout | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      callback();
    }, delayMs);
    timer.unref?.();
  };
}
