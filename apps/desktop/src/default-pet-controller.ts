import { BrowserWindow, powerMonitor, screen, shell, type Display } from "electron";

import { getAppStateSnapshot, getDefaultPetPositionState, recordDefaultPetPosition, resetDefaultPetPosition, updatePreferences } from "./app-state.js";
import { shouldShowDefaultPetForExternalEvent } from "./app-state-core.js";
import { defaultPetWindowSize, getAllDisplayKeys, getDefaultPetInitialPosition, getDisplayKey, getDisplayKeyForPosition, invalidateDisplayCache, type Point } from "./display.js";
import { motionMoveTo } from "./pet-motion-engine.js";
import { registerRoamingPet, unregisterRoamingPet } from "./pet-roaming-controller.js";
import { bindDefaultPetChatWindow, collapseDefaultPetChat, unbindDefaultPetChatWindow } from "./default-pet-chat.js";
import { debug, info } from "./logger.js";
import { t } from "./i18n/index.js";
import { transientDisplayMs, type OpenPetsReaction } from "./local-ipc-protocol.js";
import { clearTransientReaction, createDefaultPetWindow, getSafeDefaultPetPosition, getTransientDisplayDurationMs, getTransientReactionAnimationMs, isPetWindowDragging, loadDefaultPetContent, mergePetTransientDisplay, readWindowPosition, recoverPetMouseInterop, setPetReactionState, type PetPluginBubbles, type PetShowMediaOptions, type PetStatusBadgeReaction, type PetTransientDisplay } from "./pet-window.js";
import { PetBubbleArbiter, type ActiveBubble, type PetBubbleSink } from "./plugin-bubble-arbiter.js";
import { publishPluginPetEvent } from "./plugin-events-source.js";
import { reclampAgentPetWindows } from "./agent-pet-controller.js";
import { reclampPluginPetWindows } from "./plugin-pet-registry.js";
import { reclampLanVisitingPetWindows } from "./lan-pet-controller.js";
import { composeVoiceActivityBadge, composeVoiceActivityDisplay } from "./voice-activity-slot.js";
import { createPetTransientPresentation, type PetTransientPresentation } from "./pet-transient-presentation.js";
import type { ManagerCheckInOffer } from "./manager-check-in-service.js";

let defaultPetWindow: BrowserWindow | null = null;
let paused = false;
let voiceActivityReaction: OpenPetsReaction | null = null;
let voiceTerminalReaction: OpenPetsReaction | null = null;
let voiceTerminalReactionTimeout: NodeJS.Timeout | null = null;
const maxPluginMoveDistance = 160;
const minPluginMoveDurationMs = 250;
const maxPluginMoveDurationMs = 1_500;
let movementInProgress = false;
const busyStatusBadgeMs = 120_000;

const transientPresentation: PetTransientPresentation = createPetTransientPresentation({
  mergeDisplay: mergePetTransientDisplay,
  getDisplayDurationMs: getDefaultTransientDisplayDurationMs,
  getReactionAnimationMs: getDefaultTransientReactionAnimationMs,
  clearReaction: clearTransientReaction,
  badgeExpiryMs: { busy: busyStatusBadgeMs, normal: transientDisplayMs },
  callbacks: {
    onRenderNeeded: () => refreshDefaultPetContent(),
    onReactionIdle: () => {
      if (defaultPetWindow && !defaultPetWindow.isDestroyed()) setPetReactionState(defaultPetWindow, "idle");
    },
  },
});

export type PetMoveOptions = { readonly x: number; readonly y: number; readonly durationMs?: number };
export type PetWanderOptions = { readonly distance?: number; readonly durationMs?: number };
export type PetReactionOptions = { readonly showMessage?: boolean };

// Plugin bubble slots (SDK v3): the arbiter decides what each slot shows; the
// sink merges its decisions into the default pet render.
let pluginTransientBubble: ActiveBubble | null = null;
let pluginPinnedBubble: ActiveBubble | null = null;
const managerCheckInBubblePluginId = "openpets.manager-check-ins";
const managerCheckInPresentationCallbacks = new Map<string, () => void>();
let pendingManagerCheckInPresentation: (() => void) | null = null;

const defaultPetBubbleSink: PetBubbleSink = {
  present(slot, content) {
    if (slot === "pinned") pluginPinnedBubble = content;
    else pluginTransientBubble = content;
    if (slot === "transient" && content?.pluginId === managerCheckInBubblePluginId) {
      const onPresented = managerCheckInPresentationCallbacks.get(content.token) ?? pendingManagerCheckInPresentation;
      if (onPresented) {
        managerCheckInPresentationCallbacks.delete(content.token);
        if (pendingManagerCheckInPresentation === onPresented) {
          pendingManagerCheckInPresentation = null;
        }
        onPresented();
      }
    }
    debug("pet.default", "plugin bubble slot", { slot, token: content?.token ?? null, pluginId: content?.pluginId });
    if (content) showDefaultPetForExternalEvent();
    refreshDefaultPetContent();
  },
};

/** The default pet's bubble arbiter — the Electron bubbles capability targets this. */
export const defaultPetBubbleArbiter = new PetBubbleArbiter(defaultPetBubbleSink);

export function getDefaultPetPluginBubbles(): PetPluginBubbles | null {
  if (!pluginTransientBubble && !pluginPinnedBubble) return null;
  return { transient: pluginTransientBubble, pinned: pluginPinnedBubble };
}

export function showDefaultPet(): void {
  updatePreferences({ openDefaultPetOnLaunch: true });
  showDefaultPetWindow("user");
}

export function showDefaultPetForLan(): void {
  showDefaultPetWindow("external-event");
}

function showDefaultPetWindow(source: "user" | "external-event"): void {
  const window = getOrCreateDefaultPetWindow();
  info("pet.default", "show requested", { source, windowId: window.id, visible: window.isVisible(), minimized: window.isMinimized(), paused, petId: getAppStateSnapshot().preferences.defaultPetId });

  if (window.isMinimized()) {
    window.restore();
  }

  window.showInactive();
  registerRoamingPet("default", getDefaultPetWindowForPlugins);
}

export function hideDefaultPet(): void {
  updatePreferences({ openDefaultPetOnLaunch: false });
  hideDefaultPetWindow();
}

export function hideDefaultPetForLan(): void {
  hideDefaultPetWindow();
}

function hideDefaultPetWindow(): void {
  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) {
    debug("pet.default", "hide skipped", { reason: "no-window" });
    return;
  }
  if (!defaultPetWindow.isVisible()) {
    return;
  }

  const hidePosition = readWindowPosition(defaultPetWindow);
  info("pet.default", "hide requested", { windowId: defaultPetWindow.id, position: hidePosition, petId: getAppStateSnapshot().preferences.defaultPetId });
  handlePositionChanged(hidePosition);
  collapseDefaultPetChat();
  defaultPetWindow.hide();
}

export function getDefaultPetLanPosition(): { readonly x: number; readonly y: number } | null {
  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) return null;
  return readWindowPosition(defaultPetWindow);
}

export function isDefaultPetVisible(): boolean {
  return Boolean(defaultPetWindow && !defaultPetWindow.isDestroyed() && defaultPetWindow.isVisible());
}

export function setDefaultPetPaused(nextPaused: boolean): void {
  paused = nextPaused;
  if (paused) {
    voiceActivityReaction = null;
    clearVoiceTerminalFeedback();
  }
  info("pet.default", "pause changed", { paused });

  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) {
    return;
  }

  void loadDefaultPetContent(defaultPetWindow, paused, getRenderedDisplay(), getRenderedBadge(), getCurrentDismissToken(), getDefaultPetPluginBubbles());
}

export function getDefaultPetPaused(): boolean {
  return paused;
}

export function getDefaultPetWindowForPlugins(): BrowserWindow | null {
  return defaultPetWindow && !defaultPetWindow.isDestroyed() ? defaultPetWindow : null;
}

export function refreshDefaultPetContent(): void {
  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) {
    debug("pet.default", "refresh skipped", { reason: "no-window" });
    return;
  }

  debug("pet.default", "refresh content", { windowId: defaultPetWindow.id, paused, hasDisplay: Boolean(getRenderedDisplay()), badge: getRenderedBadge(), petId: getAppStateSnapshot().preferences.defaultPetId });
  void loadDefaultPetContent(defaultPetWindow, paused, getRenderedDisplay(), getRenderedBadge(), getCurrentDismissToken(), getDefaultPetPluginBubbles());
}

export function recoverDefaultPetMouseInterop(reason: string): void {
  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) {
    debug("pet.default", "mouse interop recovery skipped", { reason, skippedReason: "no-window" });
    return;
  }

  debug("pet.default", "mouse interop recovery requested", { windowId: defaultPetWindow.id, reason, petId: getAppStateSnapshot().preferences.defaultPetId });
  recoverPetMouseInterop(defaultPetWindow, reason);
}

export function applyExternalPetReaction(reaction: OpenPetsReaction, options: PetReactionOptions = {}): { readonly shown: boolean; readonly reason?: string } {
  if (paused) {
    return { shown: false, reason: "paused" };
  }

  setTransientDisplay({ reaction, ...(options.showMessage === false ? { suppressReactionMessage: true } : {}) });
  showDefaultPetForExternalEvent();
  return { shown: isDefaultPetVisible() };
}

export function applyExternalPetSay(message: string, reaction?: OpenPetsReaction): { readonly shown: boolean; readonly reason?: string } {
  if (paused) {
    return { shown: false, reason: "paused" };
  }

  if (!reaction) clearStatusBadge();
  setTransientDisplay({ message, reaction });
  showDefaultPetForExternalEvent();
  return { shown: isDefaultPetVisible() };
}

export function presentManagerCheckInOffer(
  offer: ManagerCheckInOffer,
  onOpenCheckIn: () => void,
  onPresented: () => void,
): { readonly shown: boolean; readonly reason?: string } {
  if (paused) {
    return { shown: false, reason: "paused" };
  }

  pendingManagerCheckInPresentation = onPresented;
  let handleId: string | null = null;
  const handle = defaultPetBubbleArbiter.show(
    managerCheckInBubblePluginId,
    {
      text: `${offer.title}\n${offer.introduction}\n${t("teams.checkIn.description")}`,
      priority: "high",
      durationMs: 12_000,
      actions: [
        {
          id: "open-manager-check-in",
          label: t("teams.checkIn.action.checkInNow"),
          style: "primary",
          dismissesBubble: true,
        },
      ],
    },
    {
      onAction: (actionId) => {
        if (actionId === "open-manager-check-in") {
          onOpenCheckIn();
        }
      },
      onSubmit: () => undefined,
      onDismiss: () => {
        if (handleId) {
          managerCheckInPresentationCallbacks.delete(handleId);
        }
        if (pendingManagerCheckInPresentation === onPresented) {
          pendingManagerCheckInPresentation = null;
        }
      },
    },
  );
  handleId = handle.id;

  if (pendingManagerCheckInPresentation === onPresented) {
    pendingManagerCheckInPresentation = null;
    managerCheckInPresentationCallbacks.set(handle.id, onPresented);
  }

  showDefaultPetForExternalEvent();
  const shown = defaultPetBubbleArbiter.snapshot().current?.token === handle.id;
  return { shown, ...(shown ? {} : { reason: "queued" }) };
}

export function applyExternalPetShowMedia(options: PetShowMediaOptions): { readonly shown: boolean; readonly reason?: string } {
  if (paused) {
    return { shown: false, reason: "paused" };
  }

  if (!options.reaction) clearStatusBadge();
  setTransientDisplay({ message: options.message, reaction: options.reaction, mediaPath: options.mediaPath, displayDurationMs: options.durationMs, clickUrl: options.clickUrl });
  showDefaultPetForExternalEvent();
  return { shown: isDefaultPetVisible() };
}

export function applyExternalPetStatusReaction(reaction: OpenPetsReaction | null): void {
  if (reaction === null || reaction === "idle") clearStatusBadge();
  else setStatusBadge(reaction);
  refreshDefaultPetContent();
}

/** Set only the voice-owned activity slot; plugin display and status state remain independent. */
export function setDefaultPetVoiceActivity(reaction: OpenPetsReaction | null): void {
  voiceActivityReaction = paused || reaction === "idle" ? null : reaction;
  debug("pet.default", "voice activity slot changed", { reaction: voiceActivityReaction });
  if (voiceActivityReaction) showDefaultPetForExternalEvent();
  refreshDefaultPetContent();
}

/** Keep terminal Talk feedback above the next listening activity for one bounded display window. */
export function setDefaultPetVoiceTerminalFeedback(reaction: OpenPetsReaction | null): void {
  clearVoiceTerminalFeedback();
  if (reaction === null || reaction === "idle" || paused) {
    refreshDefaultPetContent();
    return;
  }
  voiceTerminalReaction = reaction;
  voiceTerminalReactionTimeout = setTimeout(() => {
    clearVoiceTerminalFeedback();
    refreshDefaultPetContent();
  }, 2_500);
  refreshDefaultPetContent();
}

export function applyExternalPetMoveBy(options: PetMoveOptions): Promise<{ readonly moved: boolean; readonly reason?: string }> {
  return moveDefaultPetBy(Number(options.x), Number(options.y), options.durationMs);
}

export function applyExternalPetWander(options: PetWanderOptions): Promise<{ readonly moved: boolean; readonly reason?: string }> {
  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) return Promise.resolve({ moved: false, reason: "no-window" });
  const blockedReason = getMovementBlockedReason(defaultPetWindow);
  if (blockedReason) {
    debug("pet.default", "wander skipped", { reason: blockedReason });
    return Promise.resolve({ moved: false, reason: blockedReason });
  }
  const distance = clampNumber(Number(options.distance ?? 80), 0, maxPluginMoveDistance);
  const angle = Math.random() * Math.PI * 2;
  const current = readWindowPosition(defaultPetWindow);
  const durationMs = clampNumber(Number(options.durationMs ?? 700), minPluginMoveDurationMs, maxPluginMoveDurationMs);
  const rawTarget = {
    x: current.x + Math.cos(angle) * distance,
    y: current.y + Math.sin(angle) * distance,
  };
  const target = getSafeDefaultPetPosition(rawTarget);
  return motionMoveTo("default", getDefaultPetWindowForPlugins, target, { durationMs })
    .then(() => ({ moved: true } as const))
    .catch(() => ({ moved: false, reason: "engine-error" } as const));
}

export function applyExternalPetMoveToHome(): Promise<{ readonly moved: boolean; readonly reason?: string }> {
  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) return Promise.resolve({ moved: false, reason: "no-window" });
  const current = readWindowPosition(defaultPetWindow);
  const home = getSafeDefaultPetPosition(getDefaultPetInitialPosition(defaultPetWindowSize));
  return moveDefaultPetBy(home.x - current.x, home.y - current.y, maxPluginMoveDurationMs, Number.POSITIVE_INFINITY);
}

export function destroyDefaultPet(): void {
  clearDefaultPetDisplayTimers();
  voiceActivityReaction = null;

  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) {
    debug("pet.default", "destroy skipped", { reason: "no-window" });
    defaultPetWindow = null;
    return;
  }

  const destroyPosition = readWindowPosition(defaultPetWindow);
  info("pet.default", "destroy requested", { windowId: defaultPetWindow.id, position: destroyPosition, petId: getAppStateSnapshot().preferences.defaultPetId });
  handlePositionChanged(destroyPosition);
  const window = defaultPetWindow;
  unregisterRoamingPet("default");
  collapseDefaultPetChat();
  unbindDefaultPetChatWindow();
  defaultPetWindow = null;
  window.setIgnoreMouseEvents(false);
  window.destroy();
}

export function installDefaultPetDisplayHandlers(): void {
  screen.on("display-added", debounceDisplayChange("display-added"));
  screen.on("display-removed", debounceDisplayChange("display-removed"));
  screen.on("display-metrics-changed", debounceDisplayChange("display-metrics-changed"));
  powerMonitor.on("resume", recoverDefaultPetWindowAfterResume);
}

export type DisplayChangeReason = "display-added" | "display-removed" | "display-metrics-changed";

function debounceDisplayChange(reason: DisplayChangeReason): (_event: unknown, display: Display) => void {
  let timer: NodeJS.Timeout | null = null;
  let latestDisplay: Display | undefined;
  return (_event: unknown, display: Display) => {
    latestDisplay = display;
    invalidateDisplayCache();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      reclampAllLivePetWindows(reason, latestDisplay);
    }, 200);
  };
}

function handleBubbleDismissed(dismissToken: string): void {
  debug("pet.default", "bubble dismissed callback", { windowId: defaultPetWindow?.id, dismissToken, currentGeneration: transientPresentation.getDismissToken() });
  if (PetBubbleArbiter.isArbiterToken(dismissToken)) {
    defaultPetBubbleArbiter.handleDismissed(dismissToken);
    return;
  }
  const result = transientPresentation.dismiss(dismissToken);
  if (!result.matched) {
    debug("pet.default", "bubble dismissed stale token", { dismissToken, currentGeneration: transientPresentation.getDismissToken() });
    return;
  }
  const clickUrl = result.display?.clickUrl;
  if (clickUrl) {
    info("pet.default", "media bubble clicked", { windowId: defaultPetWindow?.id });
    void shell.openExternal(clickUrl).catch((error: unknown) => {
      debug("pet.default", "media bubble click open failed", { error: error instanceof Error ? error.message : String(error) });
    });
  }
  clearVoiceTerminalFeedback();
  if (defaultPetWindow && !defaultPetWindow.isDestroyed()) {
    void loadDefaultPetContent(defaultPetWindow, paused, getRenderedDisplay(), getRenderedBadge(), getCurrentDismissToken(), getDefaultPetPluginBubbles());
  }
}

function getOrCreateDefaultPetWindow(): BrowserWindow {
  if (defaultPetWindow && !defaultPetWindow.isDestroyed()) {
    return defaultPetWindow;
  }

  // The flat position is the most recently saved position across all monitors.
  // Do not scan every connected per-monitor entry here: display order is usually
  // primary-first, which can override the true last position with an older
  // primary-display entry.
  const position = getSafeDefaultPetPosition(getDefaultPetPositionState().position);

  defaultPetWindow = createDefaultPetWindow({
    position,
    paused,
    display: getRenderedDisplay(),
    badge: getRenderedBadge(),
    pluginBubbles: getDefaultPetPluginBubbles(),
    onPositionChanged: handlePositionChanged,
    onHideRequested: hideDefaultPet,
    onBubbleDismissed: handleBubbleDismissed,
    onBubbleAction: (token, actionId) => defaultPetBubbleArbiter.handleAction(token, actionId),
    onBubbleSubmit: (token, values) => defaultPetBubbleArbiter.handleSubmit(token, values),
    onPetEvent: (name, payload) => publishPluginPetEvent("default", name, payload),
    onWindowReplaced: (replacement) => {
      defaultPetWindow = replacement;
      bindDefaultPetChatWindow(replacement);
      void loadDefaultPetContent(replacement, paused, getRenderedDisplay(), getRenderedBadge(), getCurrentDismissToken(), getDefaultPetPluginBubbles());
      const replacementId = replacement.id;
      replacement.on("closed", () => {
        if (defaultPetWindow !== replacement) return;
        unregisterRoamingPet("default");
        collapseDefaultPetChat();
        unbindDefaultPetChatWindow();
        info("pet.default", "closed", { windowId: replacementId });
        defaultPetWindow = null;
      });
    },
  }, getCurrentDismissToken());
  const createdWindow = defaultPetWindow;
  bindDefaultPetChatWindow(createdWindow);
  const windowId = createdWindow.id;
  info("pet.default", "created", { windowId, position, paused, petId: getAppStateSnapshot().preferences.defaultPetId });

  createdWindow.on("closed", () => {
    if (defaultPetWindow !== createdWindow) return;
    unregisterRoamingPet("default");
    collapseDefaultPetChat();
    unbindDefaultPetChatWindow();
    info("pet.default", "closed", { windowId });
    defaultPetWindow = null;
  });

  return defaultPetWindow;
}

function setTransientDisplay(display: PetTransientDisplay): void {
  debug("pet.default", "transient display set", { reaction: display.reaction, hasMessage: Boolean(display.message), hasReactionMessage: Boolean(display.reactionMessage) });
  transientPresentation.setDisplay(display);
}

function getDefaultTransientReactionAnimationMs(transientDisplay: PetTransientDisplay): number | null {
  return getTransientReactionAnimationMs(transientDisplay);
}

function getDefaultTransientDisplayDurationMs(transientDisplay: PetTransientDisplay): number {
  return getTransientDisplayDurationMs(transientDisplay);
}

function showDefaultPetForExternalEvent(): void {
  const state = getAppStateSnapshot();
  const visible = isDefaultPetVisible();
  if (!shouldShowDefaultPetForExternalEvent(visible, state.preferences.openDefaultPetOnLaunch, paused)) {
    debug("pet.default", "external show skipped", { reason: "paused", visible, openDefaultPetOnLaunch: state.preferences.openDefaultPetOnLaunch });
    return;
  }

  showDefaultPetWindow("external-event");
}

async function moveDefaultPetBy(rawX: number, rawY: number, rawDurationMs: unknown, maxDistance = maxPluginMoveDistance): Promise<{ readonly moved: boolean; readonly reason?: string }> {
  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) return { moved: false, reason: "no-window" };
  const window = defaultPetWindow;
  const blockedReason = getMovementBlockedReason(window);
  if (blockedReason) {
    debug("pet.default", "move skipped", { reason: blockedReason });
    return { moved: false, reason: blockedReason };
  }
  const current = readWindowPosition(window);
  const distance = Math.min(Math.hypot(rawX, rawY), maxDistance);
  if (!Number.isFinite(distance) || distance <= 0) return { moved: false, reason: "invalid-distance" };
  const scale = distance / Math.hypot(rawX, rawY);
  const target = getSafeDefaultPetPosition({ x: current.x + rawX * scale, y: current.y + rawY * scale });
  const durationMs = clampNumber(Number(rawDurationMs ?? 700), minPluginMoveDurationMs, maxPluginMoveDurationMs);
  const steps = Math.max(8, Math.min(16, Math.round(durationMs / 100)));
  movementInProgress = true;
  debug("pet.default", "move start", { windowId: window.id, from: current, target, durationMs, steps });
  try {
    for (let step = 1; step <= steps; step += 1) {
      if (window.isDestroyed()) return { moved: false, reason: "destroyed" };
      const blocked = getMovementBlockedReason(window, true);
      if (blocked) return { moved: false, reason: blocked };
      const t = step / steps;
      window.setPosition(Math.round(current.x + (target.x - current.x) * t), Math.round(current.y + (target.y - current.y) * t), false);
      await delay(durationMs / steps);
    }
    window.setPosition(target.x, target.y, false);
    handlePositionChanged(target);
    debug("pet.default", "move finished", { windowId: window.id, target });
    return { moved: true };
  } finally {
    movementInProgress = false;
  }
}

function getMovementBlockedReason(window: BrowserWindow, allowMoving = false): string | undefined {
  if (movementInProgress && !allowMoving) return "already-moving";
  if (!window.isVisible()) return "hidden";
  if (paused) return "paused";
  if (isPetWindowDragging(window)) return "dragging";
  if (getRenderedDisplay()) return "transient-display";
  if (getRenderedBadge()) return "status-active";
  return undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setStatusBadge(reaction: OpenPetsReaction): void {
  transientPresentation.setStatusBadge(reaction);
}

function clearStatusBadge(): void {
  transientPresentation.clearStatusBadge();
}

function clearDefaultPetDisplayTimers(): void {
  transientPresentation.reset();
  clearVoiceTerminalFeedback();
}

function getRenderedDisplay(): PetTransientDisplay | null {
  return composeVoiceActivityDisplay(transientPresentation.getDisplay(), voiceActivityReaction, voiceTerminalReaction) as PetTransientDisplay | null;
}

function getRenderedBadge(): PetStatusBadgeReaction | null {
  return composeVoiceActivityBadge(transientPresentation.getBadge(), voiceActivityReaction, voiceTerminalReaction) as PetStatusBadgeReaction | null;
}

function clearVoiceTerminalFeedback(): void {
  voiceTerminalReaction = null;
  if (voiceTerminalReactionTimeout) clearTimeout(voiceTerminalReactionTimeout);
  voiceTerminalReactionTimeout = null;
}

function getCurrentDismissToken(): string | undefined {
  return transientPresentation.getDismissToken();
}

/** Save the flat fallback and the per-monitor position in one state operation. */
function handlePositionChanged(position: Point): void {
  const displayKey = getDisplayKeyForPosition(position);
  recordDefaultPetPosition(position, displayKey);
}

function reclampDefaultPetWindow(reason: DisplayChangeReason, changedDisplay?: Display): void {
  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) {
    return;
  }

  const currentPosition = readWindowPosition(defaultPetWindow);
  const currentDisplayKey = getDisplayKeyForPosition(currentPosition);
  const changedDisplayKey = changedDisplay ? getDisplayKey(changedDisplay.bounds) : undefined;
  let restoredPosition: Point | undefined;

  // Only restore to a newly-added display. Iterating every connected display can
  // pick the primary display first and skip the secondary monitor that was just
  // reconnected.
  if (reason === "display-added" && changedDisplayKey && changedDisplayKey !== currentDisplayKey && getAllDisplayKeys().includes(changedDisplayKey)) {
    restoredPosition = getDefaultPetPositionState().perMonitorPositions?.[changedDisplayKey];
  }

  const safePosition = restoredPosition
    ? getSafeDefaultPetPosition(restoredPosition)
    : getSafeDefaultPetPosition(currentPosition);

  info("pet.default", "reclamp position", { windowId: defaultPetWindow.id, position: safePosition, restored: Boolean(restoredPosition), reason, changedDisplayKey });
  defaultPetWindow.setPosition(safePosition.x, safePosition.y, false);
  handlePositionChanged(safePosition);
  recoverDefaultPetMouseInterop("display-change");
  // A live display-scale change invalidates the Linux setShape() click-through mask
  // (it's computed from the display's scaleFactor at render time — see
  // applyLinuxPetWindowShape() in pet-window.ts) — repositioning alone isn't enough,
  // the content/shape must be recomputed too, or the mask goes stale relative to the
  // new scale and the pet becomes invisible/unclickable.
  if (reason === "display-metrics-changed") {
    refreshDefaultPetContent();
  }
}

function reclampAllLivePetWindows(reason: DisplayChangeReason, changedDisplay?: Display): void {
  reclampDefaultPetWindow(reason, changedDisplay);
  reclampAgentPetWindows(reason);
  reclampLanVisitingPetWindows();
  reclampPluginPetWindows(reason);
}

function recoverDefaultPetWindowAfterResume(): void {
  recoverDefaultPetMouseInterop("power-resume");
  setTimeout(() => recoverDefaultPetMouseInterop("power-resume+500ms"), 500).unref?.();
}

export function shouldOpenDefaultPetOnLaunch(): boolean {
  return getAppStateSnapshot().preferences.openDefaultPetOnLaunch;
}

export function resetDefaultPetToInitialPosition(): void {
  const safePosition = getSafeDefaultPetPosition(getDefaultPetInitialPosition(defaultPetWindowSize));
  resetDefaultPetPosition(safePosition);

  if (defaultPetWindow && !defaultPetWindow.isDestroyed()) {
    defaultPetWindow.setPosition(safePosition.x, safePosition.y, false);
  }
}
