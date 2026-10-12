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
 * planner. This module applies that plan to Electron windows, keeps those windows on a
 * connected display, and is the single owner of the pin removals that start from a pet
 * window itself (closing a pinned pet unpins it).
 */

import { BrowserWindow } from "electron";

import { getAppStateSnapshot, recordPinnedPetPosition, setPinnedPets, type PetScaleValue } from "./app-state.js";
import { builtInPet } from "./built-in-pet.js";
import { clampToNearestDisplayIfOffscreen, clampToVisibleWorkArea, defaultPetWindowSize, getDefaultPetInitialPosition } from "./display.js";
import { error as logError, debug, info } from "./logger.js";
import { createAgentPetWindow, loadExplicitPetContent, readWindowPosition, showPetWindowInactive } from "./pet-window.js";
import type { DisplayChangeReason } from "./pet-display-coordinator.js";
import { getEligiblePoolPetIds } from "./pet-pool.js";
import { registerRoamingPet, unregisterRoamingPet } from "./pet-roaming-controller.js";
import { maxPinnedPets, planPinnedPets } from "./pinned-pets.js";
import { setWindowPosition } from "./window-position.js";

const pinnedPetWindows = new Map<string, BrowserWindow>();

/**
 * Pending position save per pinned pet. Recreated whenever the underlying window is
 * replaced, so the saver always writes the window that is actually on screen.
 */
const positionSavers = new Map<string, PositionSaver>();

interface PositionSaver {
  /** Debounced save, wired to the window's move events. */
  readonly save: () => void;
  /** Apply a pending save immediately (window close, app teardown). */
  readonly flush: () => void;
}

/**
 * Motion-engine handle for a pinned pet. Namespaced so a pet that is pinned AND leased
 * to a session (two windows, same pet ID) keeps two independent motion registrations
 * instead of one overwriting the other.
 */
function pinnedMotionHandle(petId: string): string {
  return `pinned:${petId}`;
}

function preferredPetScale(): PetScaleValue {
  return getAppStateSnapshot().preferences.petScale as PetScaleValue;
}

/** Pet IDs that currently own a pinned window. */
export function getPinnedPetWindowIds(): readonly string[] {
  return [...pinnedPetWindows.keys()];
}

/**
 * Bring the pinned windows in line with `preferences.pinnedPets`.
 * Idempotent: called at startup, after a pin change, and after any pet-management action
 * that can change what is eligible to be pinned.
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

/**
 * Reload pinned pet content. Settings and the pet context menu (size, flip) change the
 * global appearance preferences these windows render from, so they must be reloaded the
 * same way default, agent, plugin and LAN pets are.
 */
export function refreshPinnedPetContent(targetPetId?: string): void {
  const scale = preferredPetScale();
  for (const [petId, window] of pinnedPetWindows) {
    if (targetPetId && petId !== targetPetId) continue;
    if (window.isDestroyed()) continue;
    debug("pet.pinned", "refresh content", { petId, scale });
    void loadExplicitPetContent(window, petId, null, null, undefined, scale);
  }
}

/**
 * Keep pinned windows on a connected display. The display coordinator calls this on
 * display add/remove/metrics change, mirroring `reclampAgentPetWindows`: the read helper
 * clamps against the current displays, and a live display-scale change invalidates the
 * Linux click-through shape mask, so the content is reloaded as well.
 */
export function reclampPinnedPetWindows(reason?: DisplayChangeReason): void {
  for (const [petId, window] of pinnedPetWindows) {
    if (!window || window.isDestroyed()) continue;
    const safePosition = readWindowPosition(window);
    const [currentX, currentY] = window.getPosition();
    if (safePosition.x !== currentX || safePosition.y !== currentY) {
      info("pet.pinned", "reclamp position", {
        petId,
        windowId: window.id,
        from: { x: currentX, y: currentY },
        to: safePosition,
      });
      setWindowPosition(window, safePosition.x, safePosition.y, false);
    }
  }
  if (reason === "display-metrics-changed") {
    refreshPinnedPetContent();
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
  // The Control Center may be listing the pins; let it reload from the saved state.
  void import("./windows.js")
    .then(({ broadcastDashboardRefresh }) => broadcastDashboardRefresh())
    .catch((error) => {
      logError("pet.pinned", "broadcast pin change failed", error instanceof Error ? error : { error });
    });
}

function closePinnedPet(petId: string): void {
  const window = pinnedPetWindows.get(petId);
  const saver = positionSavers.get(petId);
  pinnedPetWindows.delete(petId);
  positionSavers.delete(petId);
  // Persist the newest position before the window goes away: the debounced save is still
  // holding it, and reading the position after destroy() is impossible.
  saver?.flush();
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

  // A remembered position is clamped too: the display it was saved on may be gone, and
  // an offscreen pinned pet has no way back because its window is not draggable.
  const base = getDefaultPetInitialPosition(defaultPetWindowSize);
  const cascadeOffset = (pinnedPetWindows.size + 1) * 48;
  const remembered = state.preferences.pinnedPetPositions?.[petId];
  const rawPosition = remembered ?? { x: base.x - cascadeOffset, y: base.y - cascadeOffset };
  const position = state.preferences.petCrossDisplayEnabled
    ? clampToNearestDisplayIfOffscreen(rawPosition, defaultPetWindowSize)
    : clampToVisibleWorkArea(rawPosition, defaultPetWindowSize);

  const window = createAgentPetWindow({
    petId,
    displayName: installed.displayName,
    scale: preferredPetScale(),
    position,
    display: null,
    badge: null,
    onCloseRequested: () => unpinPinnedPet(petId),
    onWindowReplaced: (replacement) => trackPinnedPetWindow(petId, replacement),
  });

  trackPinnedPetWindow(petId, window);
  showPetWindowInactive(window);
  const shownWindow = pinnedPetWindows.get(petId);
  if (shownWindow && !shownWindow.isDestroyed()) {
    registerRoamingPet(pinnedMotionHandle(petId), () => pinnedPetWindows.get(petId) ?? null);
  }
  info("pet.pinned", "spawn", {
    petId,
    windowId: window.id,
    position,
    remembered: Boolean(remembered),
    pinned: pinnedPetWindows.size,
  });
}

/**
 * Adopt a window as the live window of a pinned pet: register it, keep position saving
 * attached to it (the native helper can replace the window), and drop it again if it
 * closes by itself.
 */
function trackPinnedPetWindow(petId: string, window: BrowserWindow): void {
  pinnedPetWindows.set(petId, window);
  positionSavers.set(petId, attachPositionPersistence(petId, window));
  window.once("closed", () => {
    if (pinnedPetWindows.get(petId) === window) {
      pinnedPetWindows.delete(petId);
      positionSavers.delete(petId);
    }
  });
}

function attachPositionPersistence(petId: string, window: BrowserWindow): PositionSaver {
  const save = (): void => {
    if (window.isDestroyed()) return;
    recordPinnedPetPosition(petId, readWindowPosition(window));
  };
  const saver = createDebouncedSaver(save, 150);
  window.on("move", saver.save);
  window.on("moved", saver.save);
  return saver;
}

function createDebouncedSaver(callback: () => void, delayMs: number): PositionSaver {
  let timer: NodeJS.Timeout | null = null;
  const runNow = (): void => {
    timer = null;
    callback();
  };
  return {
    save: () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(runNow, delayMs);
      timer.unref?.();
    },
    flush: () => {
      if (!timer) return;
      clearTimeout(timer);
      runNow();
    },
  };
}
