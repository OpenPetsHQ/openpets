import { BrowserWindow } from "electron";

import { getAppStateSnapshot, type PetScaleValue } from "./app-state.js";
import type { DisplayChangeReason } from "./pet-display-coordinator.js";
import { registerRoamingPet, unregisterRoamingPet } from "./pet-roaming-controller.js";
import { clampToTerminalBounds, getConfinementState, getEffectiveConfinementBounds } from "./confinement-manager.js";
import { defaultPetWindowSize, clampToVisibleWorkArea, getDefaultPetInitialPosition } from "./display.js";
import { debug, info } from "./logger.js";
import { transientDisplayMs, type OpenPetsReaction } from "./local-ipc-protocol.js";
import { clearTransientReaction, createAgentPetWindow, getTransientDisplayDurationMs, getTransientReactionAnimationMs, loadExplicitPetContent, mergePetTransientDisplay, readWindowPosition, setPetReactionState, showPetWindowInactive, type PetShowMediaOptions, type PetTransientDisplay } from "./pet-window.js";
import { focusTerminalWindow } from "./terminal-focus.js";
import { createPetTransientPresentation, type PetTransientPresentation } from "./pet-transient-presentation.js";

const agentPetWindows = new Map<string, BrowserWindow>();
const transientPresentations = new Map<string, PetTransientPresentation>();
const dismissedAgentPets = new Set<string>();
const busyStatusBadgeMs = 120_000;

export function showAgentPet(petId: string): boolean {
  if (dismissedAgentPets.has(petId)) {
    info("pet.agent", "show skipped", { petId, reason: "dismissed", activeWindows: agentPetWindows.size });
    return false;
  }
  const window = getOrCreateAgentPetWindow(petId);
  info("pet.agent", "show requested", { petId, windowId: window.id, visible: window.isVisible(), minimized: window.isMinimized(), activeWindows: agentPetWindows.size });
  if (window.isMinimized()) window.restore();
  // Pull the pet into its terminal window bounds if confinement is active.
  repositionConfinedPet(petId, window);
  showPetWindowInactive(window);
  const shownWin = agentPetWindows.get(petId);
  if (shownWin && !shownWin.isDestroyed()) {
    registerRoamingPet(petId, () => agentPetWindows.get(petId) ?? null);
  }
  return true;
}

/**
 * Reposition a pet so it sits inside its terminal window bounds (if confined).
 * This is called on show and whenever confinement state changes.
 * If the pet is in free-roam mode this is a no-op.
 */
export function repositionConfinedPet(petId: string, win?: BrowserWindow): void {
  const confinementBounds = getEffectiveConfinementBounds(petId);
  if (!confinementBounds) return;
  const window = win ?? agentPetWindows.get(petId);
  if (!window || window.isDestroyed()) return;
  const [cx, cy] = window.getPosition();
  const clamped = clampToTerminalBounds({ x: cx, y: cy }, defaultPetWindowSize, confinementBounds);
  if (clamped.x !== cx || clamped.y !== cy) {
    debug("pet.agent", "reposition confined", { petId, from: { x: cx, y: cy }, to: clamped });
    window.setPosition(clamped.x, clamped.y, false);
  }
}

export function closeAgentPetIfOpen(petId: string): void {
  const window = agentPetWindows.get(petId);
  if (!window || window.isDestroyed()) {
    debug("pet.agent", "close skipped", { petId, reason: "no-window", activeWindows: agentPetWindows.size });
    return;
  }
  info("pet.agent", "close requested", { petId, windowId: window.id, activeWindows: agentPetWindows.size });
  agentPetWindows.delete(petId);
  clearAgentDisplay(petId);
  unregisterRoamingPet(petId);
  window.setIgnoreMouseEvents(false);
  window.destroy();
}

export function dismissAgentPetForActiveLease(petId: string): void {
  info("pet.agent", "dismiss requested", { petId });
  dismissedAgentPets.add(petId);
  closeAgentPetIfOpen(petId);
}

export function clearAgentPetDismissal(petId: string): void {
  debug("pet.agent", "dismissal cleared", { petId, wasDismissed: dismissedAgentPets.has(petId) });
  dismissedAgentPets.delete(petId);
}

export function clearAgentPetLeaseState(petId: string): void {
  info("pet.agent", "lease state cleared", { petId, hadWindow: agentPetWindows.has(petId), wasDismissed: dismissedAgentPets.has(petId) });
  dismissedAgentPets.delete(petId);
  closeAgentPetIfOpen(petId);
  clearAgentDisplay(petId);
}

export function applyAgentPetReaction(petId: string, reaction: OpenPetsReaction): { readonly shown: boolean; readonly reason?: string } {
  debug("pet.agent", "reaction apply", { petId, reaction });
  setAgentDisplay(petId, { reaction });
  const shown = showAgentPet(petId);
  return shown ? { shown } : { shown, reason: "dismissed" };
}

export function applyAgentPetSay(petId: string, message: string, reaction?: OpenPetsReaction): { readonly shown: boolean; readonly reason?: string } {
  debug("pet.agent", "say apply", { petId, reaction, messageLength: message.length });
  if (!reaction) transientPresentations.get(petId)?.clearStatusBadge();
  setAgentDisplay(petId, { message, reaction });
  const shown = showAgentPet(petId);
  return shown ? { shown } : { shown, reason: "dismissed" };
}

export function applyAgentPetShowMedia(petId: string, options: PetShowMediaOptions): { readonly shown: boolean; readonly reason?: string } {
  debug("pet.agent", "showMedia apply", { petId, reaction: options.reaction, hasMessage: Boolean(options.message), durationMs: options.durationMs });
  if (!options.reaction) transientPresentations.get(petId)?.clearStatusBadge();
  setAgentDisplay(petId, { message: options.message, reaction: options.reaction, mediaPath: options.mediaPath, displayDurationMs: options.durationMs, clickUrl: options.clickUrl });
  const shown = showAgentPet(petId);
  return shown ? { shown } : { shown, reason: "dismissed" };
}

export function closeAllAgentPets(): void {
  info("pet.agent", "close all requested", { activeWindows: agentPetWindows.size });
  for (const petId of [...agentPetWindows.keys()]) {
    closeAgentPetIfOpen(petId);
  }
  clearAllAgentDisplayTimers();
}

export function refreshAgentPetContent(targetPetId?: string): void {
  debug("pet.agent", "refresh content", { targetPetId, activeWindows: agentPetWindows.size, petIds: [...agentPetWindows.keys()] });
  const scale = getPreferredPetScale();
  for (const [petId, window] of agentPetWindows.entries()) {
    if (targetPetId && petId !== targetPetId) continue;
    if (!window.isDestroyed()) {
      const presentation = transientPresentations.get(petId);
      const display = presentation?.getDisplay() ?? null;
      const badge = presentation?.getBadge() ?? null;
      void loadExplicitPetContent(window, petId, display, badge, presentation?.getDismissToken(), scale);
    }
  }
}

/**
 * Re-clamp all live agent pet windows to a valid display position.
 * Called on display topology changes to ensure agent pets are not stranded
 * on a display that has been removed or whose geometry has changed.
 */
export function reclampAgentPetWindows(reason?: DisplayChangeReason): void {
  for (const [petId, window] of agentPetWindows.entries()) {
    if (!window || window.isDestroyed()) continue;
    const safePosition = readWindowPosition(window);
    const [currentX, currentY] = window.getPosition();
    if (safePosition.x !== currentX || safePosition.y !== currentY) {
      info("pet.agent", "reclamp position", { petId, windowId: window.id, from: { x: currentX, y: currentY }, to: safePosition });
      window.setPosition(safePosition.x, safePosition.y, false);
    }
  }
  // A live display-scale change invalidates the Linux setShape() click-through
  // mask for every agent pet window too, not just the default pet -- see the
  // matching fix in default-pet-controller.ts's reclampDefaultPetWindow().
  if (reason === "display-metrics-changed") {
    refreshAgentPetContent();
  }
}

function handleBubbleDismissed(petId: string, dismissToken: string): void {
  const presentation = transientPresentations.get(petId);
  const currentGeneration = presentation?.getDismissToken();
  debug("pet.agent", "bubble dismissed callback", { petId, windowId: agentPetWindows.get(petId)?.id, dismissToken, currentGeneration });
  if (!presentation) {
    debug("pet.agent", "bubble dismissed unmatched", { petId, dismissToken, currentGeneration });
    return;
  }
  const result = presentation.dismiss(dismissToken);
  if (!result.matched) {
    debug("pet.agent", "bubble dismissed stale token", { petId, dismissToken, currentGeneration });
    return;
  }
  if (transientPresentations.get(petId) === presentation && !presentation.getDisplay() && !presentation.getBadge()) {
    transientPresentations.delete(petId);
  }
  const window = agentPetWindows.get(petId);
  if (window && !window.isDestroyed()) {
    void loadExplicitPetContent(window, petId, null, null, undefined, getPreferredPetScale());
  }
}

function getOrCreateAgentPetWindow(petId: string): BrowserWindow {
  const existing = agentPetWindows.get(petId);
  if (existing && !existing.isDestroyed()) {
    debug("pet.agent", "reuse existing window", { petId, windowId: existing.id, activeWindows: agentPetWindows.size });
    return existing;
  }

  const state = getAppStateSnapshot();
  const scale = state.preferences.petScale as PetScaleValue;
  const pet = state.pets.installed.find((candidate) => candidate.id === petId);
  if (!pet) throw new Error(`Installed pet is unavailable: ${petId}`);
  const offset = agentPetWindows.size + 1;
  // Use terminal bounds for initial position when confinement is active.
  const confinementBounds = getEffectiveConfinementBounds(petId);
  const baseInitial = confinementBounds
    ? { x: confinementBounds.x + Math.max(0, (confinementBounds.width - defaultPetWindowSize.width) / 2), y: confinementBounds.y + Math.max(0, confinementBounds.height - defaultPetWindowSize.height) }
    : getDefaultPetInitialPosition(defaultPetWindowSize);
  const rawPosition = { x: baseInitial.x - offset * 36, y: baseInitial.y - offset * 24 };
  // Clamp the offset position so multi-pet stacking stays within bounds.
  const initial = confinementBounds
    ? clampToTerminalBounds(rawPosition, defaultPetWindowSize, confinementBounds)
    : clampToVisibleWorkArea(rawPosition, defaultPetWindowSize);
  const presentation = transientPresentations.get(petId);
  const display = presentation?.getDisplay() ?? null;
  const badge = presentation?.getBadge() ?? null;
  const window = createAgentPetWindow({
    petId,
    displayName: pet.displayName,
    scale,
    position: { x: initial.x, y: initial.y },
    display,
    badge,
    onCloseRequested: () => dismissAgentPetForActiveLease(petId),
    onBubbleDismissed: (token) => handleBubbleDismissed(petId, token),
    onWindowReplaced: (replacement) => {
      agentPetWindows.set(petId, replacement);
      const presentation = transientPresentations.get(petId);
      const currentDisplay = presentation?.getDisplay() ?? null;
      const currentBadge = presentation?.getBadge() ?? null;
      void loadExplicitPetContent(replacement, petId, currentDisplay, currentBadge, presentation?.getDismissToken(), getPreferredPetScale());
      replacement.on("closed", () => {
        if (agentPetWindows.get(petId) !== replacement) return;
        unregisterRoamingPet(petId);
        agentPetWindows.delete(petId);
        clearAgentDisplay(petId);
      });
    },
    onFocusSessionWindow: () => {
      const confinement = getConfinementState(petId);
      if (confinement?.terminalOwnerPid) {
        focusTerminalWindow(confinement.terminalOwnerPid).catch((err) => {
          debug("pet.agent", "focus session window failed", { petId, error: String(err) });
        });
      }
    },
  }, presentation?.getDismissToken());
  const windowId = window.id;

  window.on("closed", () => {
    if (agentPetWindows.get(petId) !== window) return;
    info("pet.agent", "closed", { petId, windowId, activeWindowsBeforeDelete: agentPetWindows.size });
    // Unregister from the motion engine BEFORE deleting the window map entry
    // to prevent the shared ticker from touching the destroyed window.
    unregisterRoamingPet(petId);
    agentPetWindows.delete(petId);
    clearAgentDisplay(petId);
  });
  agentPetWindows.set(petId, window);
  info("pet.agent", "created", { petId, windowId: window.id, offset, activeWindows: agentPetWindows.size, position: initial, confined: confinementBounds !== null });
  return window;
}

function setAgentDisplay(petId: string, display: PetTransientDisplay): void {
  debug("pet.agent", "display set", { petId, reaction: display.reaction, hasMessage: Boolean(display.message), hasReactionMessage: Boolean(display.reactionMessage) });
  getOrCreateAgentPresentation(petId).setDisplay(display);
}

function clearAgentDisplay(petId: string): void {
  const presentation = transientPresentations.get(petId);
  debug("pet.agent", "display cleared", { petId, hadDisplay: Boolean(presentation?.getDisplay()), hadBadge: Boolean(presentation?.getBadge()) });
  if (!presentation) return;
  presentation.reset();
  if (transientPresentations.get(petId) === presentation && !presentation.getDisplay() && !presentation.getBadge()) {
    transientPresentations.delete(petId);
  }
}

function clearAllAgentDisplayTimers(): void {
  for (const presentation of transientPresentations.values()) presentation.reset();
  transientPresentations.clear();
}

function getOrCreateAgentPresentation(petId: string): PetTransientPresentation {
  const existing = transientPresentations.get(petId);
  if (existing) return existing;

  let presentation: PetTransientPresentation;
  presentation = createPetTransientPresentation({
    mergeDisplay: mergePetTransientDisplay,
    getDisplayDurationMs: (preparedDisplay) => getTransientDisplayDurationMs(preparedDisplay),
    getReactionAnimationMs: getTransientReactionAnimationMs,
    clearReaction: clearTransientReaction,
    badgeExpiryMs: { busy: busyStatusBadgeMs, normal: transientDisplayMs },
    callbacks: {
      onRenderNeeded: () => {
        if (transientPresentations.get(petId) !== presentation) return;
        const display = presentation.getDisplay();
        const badge = presentation.getBadge();
        const window = agentPetWindows.get(petId);
        if (window && !window.isDestroyed()) void loadExplicitPetContent(window, petId, display, badge, presentation.getDismissToken(), getPreferredPetScale());
        if (!display && !badge && transientPresentations.get(petId) === presentation) transientPresentations.delete(petId);
      },
      onReactionIdle: () => {
        if (transientPresentations.get(petId) !== presentation) return;
        const window = agentPetWindows.get(petId);
        if (window && !window.isDestroyed()) setPetReactionState(window, "idle");
      },
    },
  });
  transientPresentations.set(petId, presentation);
  return presentation;
}

function getPreferredPetScale(): PetScaleValue {
  return getAppStateSnapshot().preferences.petScale as PetScaleValue;
}
