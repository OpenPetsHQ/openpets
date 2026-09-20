import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent } from "electron";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { getAppStateSnapshot, type HudScaleValue, type PetScaleValue } from "./app-state.js";
import { clampToNearestDisplayIfOffscreen, clampToVisibleWorkArea, defaultPetWindowSize, getDefaultPetInitialPosition, isCrossDisplayRoamingEnabled, type Point } from "./display.js";
import { builtInPet } from "./built-in-pet.js";
import { getActiveLocale, t } from "./i18n/index.js";
import { defaultMediaDurationMs } from "./local-ipc-protocol.js";
import { pickReactionMessage } from "./reaction-messages.js";
import { debug, error as logError, info, warn } from "./logger.js";
import { defaultPetSprite, getConfiguredSpriteStates, type PetMotionState, type UniversalSpriteState } from "./reaction-animation-mapping.js";
import { canForwardMouseEvents as platformCanForwardMouseEvents, shouldWatchForwardedMouseEvents } from "./mouse-forwarding.js";
import { computeEffectiveWaylandBackend, isLayerShellBackendRequested, shouldPetWindowBeFocusable } from "./wayland-backend.js";
import { adoptPetWindowForLayerShell, isLayerShellHelperAvailable } from "./wayland-layer-backend.js";
import { isLatestPetRenderSequence } from "./pet-render-lifecycle.js";
import { calculatePetInteractiveShape } from "./pet-window-shape.js";
import { toCollapsedPosition } from "./default-pet-chat-geometry.js";
import { getActiveChatPanelHeight, isDefaultPetChatCompactOpen, isDefaultPetChatExpanded } from "./default-pet-chat.js";

import type { AgentPetWindowOptions, DefaultPetWindowOptions, PetContentRender, PetPluginBubbles, PetShowMediaOptions, PetStatusBadgeReaction, PetTransientDisplay, PetWindowAudioPayload, PetWindowInteractionHooks, PetWindowSpeechCompletion } from "./pet-window-types.js";
import { createBubbleMarkup, createBuiltInPetRender, createDefaultPetRenderContent, createInstalledPetRender, getReactionSpriteState } from "./pet-window-render.js";
import { registerPetGazeWindow, resetPetGazeWindow, setPetGazeDragging, setPetGazeMotionState, setPetGazePluginOverride, setPetGazeReactionState, setPetGazeRendererReady, suspendPetGazeForMovement, updatePetGazeConfiguration } from "./pet-window-gaze.js";
import { installPetContextMenu } from "./pet-window-context-menu.js";

export type { AgentPetWindowOptions, DefaultPetWindowOptions, PetContentRender, PetPluginBubbles, PetShowMediaOptions, PetStatusBadgeReaction, PetTransientDisplay, PetWindowAudioPayload, PetWindowInteractionHooks, PetWindowSpeechCompletion } from "./pet-window-types.js";
export { createPetBodyMarkup, pluginBubblesCacheKey } from "./pet-window-render.js";
export { refreshPetGazePreference } from "./pet-window-gaze.js";
export { buildPetContextMenuTemplate, handlePetScaleChange } from "./pet-window-context-menu.js";

const petWindowRenderCache = new WeakMap<BrowserWindow, string>();

const windowLoadChains = new WeakMap<BrowserWindow, Promise<void>>();
const windowLoadSequences = new WeakMap<BrowserWindow, number>();
const petWindowFocusPolicy = new WeakMap<BrowserWindow, boolean>();
const petMouseInteropRecovery = new WeakMap<BrowserWindow, (reason: string) => void>();
const petWindowDragging = new WeakMap<BrowserWindow, boolean>();

const petWindowSpeechCompletionListeners = new Set<(completion: PetWindowSpeechCompletion) => void>();

export function subscribePetWindowSpeechCompletion(listener: (completion: PetWindowSpeechCompletion) => void): () => void {
  petWindowSpeechCompletionListeners.add(listener);
  return () => { petWindowSpeechCompletionListeners.delete(listener); };
}

/**
 * Returns true when Electron is effectively running on the native Wayland
 * backend (ozone-platform=wayland). Under x11/XWayland this returns false
 * even on a Wayland session, because the positioning and z-order APIs work.
 *
 * Must be called after app is ready (after main.ts has appended the switch).
 * Cached on first call so window-creation cost is negligible.
 */
let _effectiveWaylandBackendCache: boolean | undefined;
export function isEffectiveWaylandBackend(): boolean {
  if (_effectiveWaylandBackendCache !== undefined) return _effectiveWaylandBackendCache;
  // Delegate to the pure, Electron-free decision in wayland-backend.ts so the
  // exact production logic is unit-testable without importing this module.
  const result = computeEffectiveWaylandBackend(
    process.platform,
    app.commandLine.getSwitchValue("ozone-platform"),
    process.env.XDG_SESSION_TYPE,
    process.env.WAYLAND_DISPLAY,
  );
  _effectiveWaylandBackendCache = result;
  return result;
}

export function _resetEffectiveWaylandBackendCache(): void {
  _effectiveWaylandBackendCache = undefined;
}

/**
 * Whether to use Wayland native window-move drag instead of the manual
 * setBounds drag path.  Under x11/XWayland the manual path works correctly.
 * In layer-shell mode the pet is dragged by the native helper (which moves
 * the overlay surface directly), so the renderer must not participate in the
 * manual setBounds drag either — it would fight the helper's own motion.
 */
export function shouldUseWaylandNativePetDrag(): boolean {
  return isEffectiveWaylandBackend() || shouldUseLayerShellBackend();
}

export function isPetWindowDragging(window: BrowserWindow): boolean {
  return petWindowDragging.get(window) === true;
}

export function createDefaultPetWindow(options: DefaultPetWindowOptions, dismissToken?: string): BrowserWindow {
  const window = createBasePetWindow(
    "OpenPets — Default Pet",
    options.position,
    { hasInteractiveInput: petPluginBubblesHaveInteractiveInput(options.pluginBubbles ?? null) },
    (fallbackPosition, wasVisible) => {
      // layer-shell backend failed asynchronously — rebuild as a normal window
      // at the pet's latest tracked position, not its original spawn point.
      info("pet.window", "layer-shell failed; rebuilding default pet as a normal window", { position: fallbackPosition, wasVisible });
      const replacement = createBasePetWindowWithMode("OpenPets — Default Pet", fallbackPosition, { hasInteractiveInput: petPluginBubblesHaveInteractiveInput(options.pluginBubbles ?? null) }, false);
      installDefaultPetWindow(replacement, options, dismissToken);
      options.onWindowReplaced?.(replacement);
      if (wasVisible) replacement.showInactive();
    },
  );
  if (!window.isDestroyed()) installDefaultPetWindow(window, options, dismissToken);
  return window;
}

function installDefaultPetWindow(window: BrowserWindow, options: DefaultPetWindowOptions, dismissToken?: string): void {
  info("pet.window", "default window create", { windowId: window.id, position: options.position, paused: options.paused, hasDisplay: Boolean(options.display), badge: options.badge });
  installMousePassthroughAndDrag(window, options);
  installMotionStatePublisher(window);
  installPetContextMenu(window, { label: t("pet.menu.hidePet"), click: options.onHideRequested, defaultPet: true }, shouldUseLayerShellBackend);

  const savePosition = debounce(() => {
    if (window.isDestroyed()) {
      return;
    }

    options.onPositionChanged(readWindowPosition(window));
  }, 150);

  window.on("move", savePosition);
  window.on("moved", savePosition);
  window.on("close", () => {
    info("pet.window", "default window close", { windowId: window.id, position: readWindowPosition(window) });
    options.onPositionChanged(readWindowPosition(window));
  });

  void loadDefaultPetContent(window, options.paused, options.display, options.badge, dismissToken, options.pluginBubbles ?? null);
}

export function createAgentPetWindow(options: AgentPetWindowOptions, dismissToken?: string): BrowserWindow {
  const window = createBasePetWindow(
    `OpenPets — ${options.displayName}`,
    options.position,
    {},
    (fallbackPosition, wasVisible) => {
      // layer-shell backend failed asynchronously — rebuild as a normal window
      // at the pet's latest tracked position, not its original spawn point.
      info("pet.window", "layer-shell failed; rebuilding agent pet as a normal window", { petId: options.petId, position: fallbackPosition, wasVisible });
      const replacement = createBasePetWindowWithMode(`OpenPets — ${options.displayName}`, fallbackPosition, {}, false);
      installAgentPetWindow(replacement, options, dismissToken);
      options.onWindowReplaced?.(replacement);
      if (wasVisible) replacement.showInactive();
    },
  );
  if (!window.isDestroyed()) installAgentPetWindow(window, options, dismissToken);
  return window;
}

function installAgentPetWindow(window: BrowserWindow, options: AgentPetWindowOptions, dismissToken?: string): void {
  info("pet.window", "agent window create", { windowId: window.id, petId: options.petId, displayName: options.displayName, position: options.position, hasDisplay: Boolean(options.display), badge: options.badge });
  installMousePassthroughAndDrag(window, options);
  installMotionStatePublisher(window);
  installPetContextMenu(window, { label: t("pet.menu.closePet"), click: options.onCloseRequested, focusSessionWindow: options.onFocusSessionWindow, petId: options.petId }, shouldUseLayerShellBackend);
  void loadExplicitPetContent(window, options.petId, options.display, options.badge, dismissToken, options.scale);
}

export function recoverPetMouseInterop(window: BrowserWindow, reason: string): void {
  if (window.isDestroyed()) return;
  const recover = petMouseInteropRecovery.get(window);
  if (recover) {
    recover(reason);
    return;
  }

  debug("pet.window", "mouse interop recovery skipped", { windowId: window.id, reason, skippedReason: "unregistered-window" });
}

export async function createDefaultPetRender(
  paused: boolean,
  display: PetTransientDisplay | null,
  badge: PetStatusBadgeReaction | null,
  dismissToken?: string,
  pluginBubbles: PetPluginBubbles | null = null,
): Promise<PetContentRender> {
  return createDefaultPetRenderContent(
    paused,
    display,
    badge,
    dismissToken,
    pluginBubbles,
    shouldUseWaylandNativePetDrag() ? "drag" : "no-drag",
  );
}

function installMousePassthroughAndDrag(window: BrowserWindow, hooks: PetWindowInteractionHooks = {}): void {
  const { onBubbleDismissed, onBubbleAction, onBubbleSubmit, onPetEvent } = hooks;
  const windowId = window.id;
  const useWaylandNativeDrag = shouldUseWaylandNativePetDrag();
  if (useWaylandNativeDrag) {
    debug("pet.window", "Wayland native pet drag enabled", { windowId });
  }
  let dragging: { readonly startScreenX: number; readonly startScreenY: number; readonly startWindowX: number; readonly startWindowY: number; readonly width: number; readonly height: number } | null = null;
  let rendererReady = false;
  let listenersRemoved = false;
  let lastInteractive = false;
  let forwardingWatchTimer: NodeJS.Timeout | null = null;
  const rearmTimers = new Set<NodeJS.Timeout>();
  const webContents = window.webContents;
  const canForwardMouseEvents = platformCanForwardMouseEvents(process.platform);

  const scheduleMouseInteropRecovery = (reason: string): void => {
    if (window.isDestroyed()) return;
    dragging = null;
    rendererReady = false;
    lastInteractive = false;
    clearRearmTimers();
    debug("pet.window", "mouse interop recovery", { windowId, reason });
    setPassthrough(false);
    if (process.platform === "win32") {
      requestCursorHitTestProbe(reason);
      scheduleWindowsMouseForwardingRearm(`${reason}+250ms`, 250);
      scheduleWindowsMouseForwardingRearm(`${reason}+500ms`, 500);
      scheduleWindowsMouseForwardingRearm(`${reason}+1000ms`, 1_000);
      scheduleWindowsMouseForwardingRearm(`${reason}+1500ms`, 1_500);
      return;
    }

    rearmPassthrough(reason);
  };

  const isFromWindow = (event: IpcMainEvent): boolean => event.sender === webContents;
  const setPassthrough = (passthrough: boolean): void => {
    if (window.isDestroyed()) return;
    if (process.platform === "linux") {
      // Electron does not support forwarded mouse events on Linux, so ignored
      // windows cannot receive the renderer events required to start dragging.
      // Keep Linux pet windows interactive; this trades click-through for reliable drag.
      window.setIgnoreMouseEvents(false);
      return;
    }

    if (passthrough && canForwardMouseEvents) window.setIgnoreMouseEvents(true, { forward: true });
    else if (passthrough) window.setIgnoreMouseEvents(true);
    else window.setIgnoreMouseEvents(false);
  };

  const clearRearmTimers = (): void => {
    for (const timer of rearmTimers) clearTimeout(timer);
    rearmTimers.clear();
  };

  const clearForwardingWatch = (): void => {
    if (!forwardingWatchTimer) return;
    clearTimeout(forwardingWatchTimer);
    forwardingWatchTimer = null;
  };

  const getCursorProbe = (): { readonly inside: boolean; readonly cursor: Point; readonly bounds: Electron.Rectangle; readonly clientX: number; readonly clientY: number } => {
    const cursor = screen.getCursorScreenPoint();
    const bounds = window.getContentBounds();
    const clientX = cursor.x - bounds.x;
    const clientY = cursor.y - bounds.y;
    return {
      cursor,
      bounds,
      clientX,
      clientY,
      inside: clientX >= 0 && clientX < bounds.width && clientY >= 0 && clientY < bounds.height,
    };
  };

  const requestCursorHitTestProbe = (reason: string, logProbe = true): void => {
    if (window.isDestroyed() || webContents.isDestroyed()) return;
    const probe = getCursorProbe();
    if (logProbe) debug("pet.window", "cursor hit-test probe", { windowId, reason, inside: probe.inside, cursor: probe.cursor, bounds: probe.bounds });
    if (!probe.inside) return;
    webContents.send("openpets:pet-probe-hit-test", { clientX: probe.clientX, clientY: probe.clientY, reason });
  };

  const rearmMouseForwarding = (reason: string, logRearm = true): void => {
    if (window.isDestroyed()) return;
    if (dragging || lastInteractive) {
      if (logRearm) debug("pet.window", "mouse forwarding rearm skipped", { windowId, reason, dragging: Boolean(dragging), interactive: lastInteractive });
      return;
    }
    if (logRearm) debug("pet.window", "mouse forwarding rearm", { windowId, reason });
    window.setIgnoreMouseEvents(false);
    window.setIgnoreMouseEvents(true, { forward: true });
    requestCursorHitTestProbe(reason, logRearm);
  };

  const scheduleWindowsMouseForwardingRearm = (reason: string, delayMs: number): void => {
    const timer = setTimeout(() => {
      rearmTimers.delete(timer);
      rearmMouseForwarding(reason);
    }, delayMs);
    rearmTimers.add(timer);
  };

  const scheduleForwardingWatch = (reason: string): void => {
    if (!shouldWatchForwardedMouseEvents(process.platform) || forwardingWatchTimer || dragging || lastInteractive || window.isDestroyed()) return;
    forwardingWatchTimer = setTimeout(() => {
      forwardingWatchTimer = null;
      if (window.isDestroyed() || dragging || lastInteractive) return;
      if (getCursorProbe().inside) rearmMouseForwarding(reason, false);
      scheduleForwardingWatch(reason);
    }, 750);
    forwardingWatchTimer.unref?.();
  };

  const rearmPassthrough = (reason: string): void => {
    if (window.isDestroyed()) return;
    if (process.platform !== "win32") {
      setPassthrough(true);
      // macOS also depends on forwarded mouse events, and the WindowServer can
      // stop delivering them across Space switches / display sleep. Probe the
      // cursor now and keep the watchdog armed so the pet cannot get stuck
      // click-through with no way back to interactive.
      if (canForwardMouseEvents) {
        requestCursorHitTestProbe(reason);
        scheduleForwardingWatch(reason);
      }
      return;
    }

    // On Windows, rapid pet HTML reloads can leave Chromium's forwarded mouse
    // tracking stale while the cursor is already over the transparent window.
    // Toggle immediately, probe the current cursor hit target, then repeat the
    // toggle shortly after load because Windows sometimes re-registers mouse
    // forwarding after Chromium finishes late compositing work.
    rearmMouseForwarding(reason);
    scheduleWindowsMouseForwardingRearm(`${reason}+75ms`, 75);
    scheduleWindowsMouseForwardingRearm(`${reason}+175ms`, 175);
  };

  const rearmPassthroughAfterLoad = (): void => {
    rearmPassthrough("did-finish-load");
  };

  const handleHitTest = (event: IpcMainEvent, interactive: unknown, source: unknown): void => {
    if (!isFromWindow(event)) return;
    rendererReady = true;
    lastInteractive = Boolean(interactive);
    const sourceName = typeof source === "string" ? source : undefined;
    if (sourceName !== "idle-forwarding-watch" || lastInteractive) debug("pet.window", "hit test", { windowId, interactive: lastInteractive, dragging, source: sourceName });
    setPassthrough(!lastInteractive && !dragging);
    if (lastInteractive || dragging) clearForwardingWatch();
    else scheduleForwardingWatch("idle-forwarding-watch");
  };

  const handleReady = (event: IpcMainEvent): void => {
    if (!isFromWindow(event)) return;
    rendererReady = true;
    setPetGazeRendererReady(window);
    setPassthrough(true);
    scheduleForwardingWatch("ready-forwarding-watch");
  };

  const handleDragStart = (event: IpcMainEvent, point: unknown): void => {
    if (!isFromWindow(event) || !isScreenPoint(point) || window.isDestroyed()) return;
    setPetGazeDragging(window, true);
    suspendPetGazeForMovement(window);
    if (useWaylandNativeDrag) {
      debug("pet.window", "manual drag start ignored on Wayland native drag", { windowId });
      return;
    }
    const startBounds = window.getBounds();
    dragging = { startScreenX: point.screenX, startScreenY: point.screenY, startWindowX: startBounds.x, startWindowY: startBounds.y, width: startBounds.width, height: startBounds.height };
    petWindowDragging.set(window, true);
    debug("pet.window", "drag start", { windowId, point, startBounds });
    clearForwardingWatch();
    setPassthrough(false);
    onPetEvent?.("pet:dragStart", {});
  };

  const handleDragMove = (event: IpcMainEvent, point: unknown): void => {
    if (!isFromWindow(event) || !dragging || !isScreenPoint(point) || window.isDestroyed()) return;
    suspendPetGazeForMovement(window);
    if (useWaylandNativeDrag) {
      debug("pet.window", "manual drag move ignored on Wayland native drag", { windowId });
      return;
    }
    const nextX = dragging.startWindowX + Math.round(point.screenX - dragging.startScreenX);
    const nextY = dragging.startWindowY + Math.round(point.screenY - dragging.startScreenY);
    window.setBounds({ x: nextX, y: nextY, width: dragging.width, height: dragging.height }, false);
  };

  const handleDragEnd = (event: IpcMainEvent): void => {
    if (!isFromWindow(event)) return;
    setPetGazeDragging(window, false);
    suspendPetGazeForMovement(window);
    if (useWaylandNativeDrag) {
      debug("pet.window", "manual drag end ignored on Wayland native drag", { windowId });
      return;
    }
    const wasDragging = dragging !== null;
    dragging = null;
    petWindowDragging.set(window, false);
    debug("pet.window", "drag end", { windowId, position: window.isDestroyed() ? null : readWindowPosition(window) });
    if (wasDragging) onPetEvent?.("pet:dragEnd", {});
  };

  const handleBubbleDismissed = (event: IpcMainEvent, dismissToken: unknown): void => {
    if (!isFromWindow(event)) return;
    debug("pet.window", "bubble dismissed", { windowId, dismissToken });
    if (typeof dismissToken === "string") onBubbleDismissed?.(dismissToken);
  };

  const handleBubbleAction = (event: IpcMainEvent, dismissToken: unknown, actionId: unknown): void => {
    if (!isFromWindow(event)) return;
    debug("pet.window", "bubble action", { windowId, dismissToken, actionId });
    if (typeof dismissToken === "string" && typeof actionId === "string" && actionId.length <= 64) onBubbleAction?.(dismissToken, actionId);
  };

  const handleBubbleSubmit = (event: IpcMainEvent, dismissToken: unknown, values: unknown): void => {
    if (!isFromWindow(event)) return;
    debug("pet.window", "bubble submit", { windowId, dismissToken });
    if (typeof dismissToken !== "string" || typeof values !== "object" || values === null) return;
    const out: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(values as Record<string, unknown>).slice(0, 8)) {
      if (typeof value === "string" && value.length <= 1000) out[key] = value;
      else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    }
    onBubbleSubmit?.(dismissToken, out);
  };

  const allowedPetEventNames = new Set(["pet:clicked", "pet:doubleClicked", "pet:hover", "pet:drop"]);
  const handlePetEvent = (event: IpcMainEvent, name: unknown, payload: unknown): void => {
    if (!isFromWindow(event)) return;
    if (typeof name !== "string" || !allowedPetEventNames.has(name)) return;
    const data = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    if (name !== "pet:hover") debug("pet.window", "pet event", { windowId, name });
    onPetEvent?.(name, data);
  };

  const handleSpeechCompletion = (event: IpcMainEvent, payload: unknown): void => {
    if (!isFromWindow(event) || !isRecord(payload) || typeof payload.requestId !== "string" || payload.requestId.length === 0) return;
    if (payload.kind !== "system" || (payload.outcome !== "ended" && payload.outcome !== "error" && payload.outcome !== "stopped")) return;
    const completion: PetWindowSpeechCompletion = { window, requestId: payload.requestId, kind: payload.kind, outcome: payload.outcome };
    for (const listener of [...petWindowSpeechCompletionListeners]) {
      try { listener(completion); } catch { /* observers cannot affect pet-window cleanup */ }
    }
  };

  const resetForNavigation = (): void => {
    dragging = null;
    petWindowDragging.set(window, false);
    rendererReady = false;
    lastInteractive = false;
    resetPetGazeWindow(window);
    clearRearmTimers();
    debug("pet.window", "navigation reset passthrough", { windowId });
    setPassthrough(false);
  };

  const rearmAfterLoad = (): void => {
    dragging = null;
    petWindowDragging.set(window, false);
    lastInteractive = false;
    debug("pet.window", "load rearm passthrough", { windowId });
    rearmPassthroughAfterLoad();
  };

  const handleDomReady = (): void => {
    if (!rendererReady) setPassthrough(true);
  };

  const handleLoadFailure = (): void => {
    dragging = null;
    lastInteractive = false;
    resetPetGazeWindow(window);
    debug("pet.window", "load failure rearm passthrough", { windowId });
    setPassthrough(true);
  };

  const removeListeners = (): void => {
    if (listenersRemoved) return;
    listenersRemoved = true;
    ipcMain.off("openpets:pet-ready", handleReady);
    ipcMain.off("openpets:pet-hit-test", handleHitTest);
    ipcMain.off("openpets:pet-drag-start", handleDragStart);
    ipcMain.off("openpets:pet-drag-move", handleDragMove);
    ipcMain.off("openpets:pet-drag-end", handleDragEnd);
    ipcMain.off("openpets:bubble-dismissed", handleBubbleDismissed);
    ipcMain.off("openpets:bubble-action", handleBubbleAction);
    ipcMain.off("openpets:bubble-submit", handleBubbleSubmit);
    ipcMain.off("openpets:pet-event", handlePetEvent);
    ipcMain.off("openpets:tts-speech-finished", handleSpeechCompletion);
    clearRearmTimers();
    clearForwardingWatch();
    petMouseInteropRecovery.delete(window);
    petWindowDragging.delete(window);
    if (!webContents.isDestroyed()) {
      webContents.off("did-start-navigation", resetForNavigation);
      webContents.off("did-start-loading", resetForNavigation);
      webContents.off("did-finish-load", rearmAfterLoad);
      webContents.off("dom-ready", handleDomReady);
      webContents.off("did-fail-load", handleLoadFailure);
    }
  };

  petMouseInteropRecovery.set(window, scheduleMouseInteropRecovery);

  ipcMain.on("openpets:pet-ready", handleReady);
  ipcMain.on("openpets:pet-hit-test", handleHitTest);
  ipcMain.on("openpets:pet-drag-start", handleDragStart);
  ipcMain.on("openpets:pet-drag-move", handleDragMove);
  ipcMain.on("openpets:pet-drag-end", handleDragEnd);
  ipcMain.on("openpets:bubble-dismissed", handleBubbleDismissed);
  ipcMain.on("openpets:bubble-action", handleBubbleAction);
  ipcMain.on("openpets:bubble-submit", handleBubbleSubmit);
  ipcMain.on("openpets:pet-event", handlePetEvent);
  ipcMain.on("openpets:tts-speech-finished", handleSpeechCompletion);
  webContents.on("did-start-navigation", resetForNavigation);
  webContents.on("did-start-loading", resetForNavigation);
  webContents.on("did-finish-load", rearmAfterLoad);
  webContents.on("dom-ready", handleDomReady);
  webContents.on("did-fail-load", handleLoadFailure);
  window.on("close", removeListeners);
  window.once("closed", removeListeners);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScreenPoint(value: unknown): value is { readonly screenX: number; readonly screenY: number } {
  return typeof value === "object" && value !== null && typeof (value as { readonly screenX?: unknown }).screenX === "number" && typeof (value as { readonly screenY?: unknown }).screenY === "number";
}

function createBasePetWindow(title: string, position: Point, focusOptions: { readonly hasInteractiveInput?: boolean } = {}, onLayerShellFatal?: (position: Point, wasVisible: boolean) => void): BrowserWindow {
  return createBasePetWindowWithMode(title, position, focusOptions, shouldUseLayerShellBackend(), onLayerShellFatal);
}

/**
 * Whether the experimental native Wayland layer-shell backend should carry pet
 * windows. Opt-in via `OPENPETS_NATIVE_WAYLAND=1` and only when the native
 * helper binary is present. See `wayland-layer-backend.ts`.
 */
export function shouldUseLayerShellBackend(): boolean {
  return isLayerShellBackendRequested(process.platform, process.env) && isLayerShellHelperAvailable();
}

function createBasePetWindowWithMode(title: string, position: Point, focusOptions: { readonly hasInteractiveInput?: boolean }, useLayerShell: boolean, onLayerShellFatal?: (position: Point, wasVisible: boolean) => void): BrowserWindow {
  const effectiveWaylandBackend = isEffectiveWaylandBackend();
  const focusable = shouldPetWindowBeFocusable(process.platform, effectiveWaylandBackend, focusOptions.hasInteractiveInput === true);
  const window = new BrowserWindow({
    title,
    width: defaultPetWindowSize.width,
    height: defaultPetWindowSize.height,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable,
    show: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    // In layer-shell mode this window never appears on screen — it only
    // renders the pet page offscreen so its frames can be streamed to the
    // native layer-shell helper. The visible pet is the helper's overlay
    // surface, not this window. `paintWhenInitiallyHidden` must be a
    // top-level option so the hidden renderer keeps painting (and therefore
    // `beginFrameSubscription` keeps producing frames); `offscreen` and
    // `backgroundThrottling` belong in webPreferences.
    ...(useLayerShell ? { paintWhenInitiallyHidden: true } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: join(app.getAppPath(), "pet-preload.cjs"),
      ...(useLayerShell ? { offscreen: true, backgroundThrottling: false } : {}),
    },
  });

  petWindowFocusPolicy.set(window, focusable);
  window.setMenu(null);
  applyPetAlwaysOnTop(window);
  window.on("show", () => applyPetAlwaysOnTop(window));
  window.on("restore", () => applyPetAlwaysOnTop(window));

  // Windows silently strips HWND_TOPMOST from other windows when an app
  // enters fullscreen (browser video, games) and never restores it, and no
  // Electron event fires when that happens — the pet stays buried behind
  // normal windows until the user manually toggles it. Periodic re-assertion
  // is the only reliable recovery, and matches the macOS visibleOnFullScreen
  // intent below. The shell's demotion sweep re-strips the flag every ~2-4s
  // while a fullscreen app is foreground (measured: a forced re-assert held
  // for ~2-3s before being swept), so a 1s cadence keeps the pet on top of
  // fullscreen content with sub-second gaps at worst; the two SetWindowPos
  // calls per tick are negligible.
  if (process.platform === "win32") {
    const topmostTimer = setInterval(() => {
      if (window.isDestroyed()) {
        clearInterval(topmostTimer);
        return;
      }
      if (window.isVisible()) applyPetAlwaysOnTop(window);
    }, 1_000);
    window.on("closed", () => clearInterval(topmostTimer));
  }

  // Show the pet window on all macOS Spaces (desktop workspaces).
  // Without this, the window is bound to the Space where it was created
  // and disappears when the user switches to another Space.
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedPetDocumentUrl(url)) return;
    event.preventDefault();
  });
  window.webContents.on("will-redirect", (event) => {
    event.preventDefault();
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    logError("pet.window", "renderer load failed", { windowId: window.id, errorCode, errorDescription });
    console.error("Failed to load default pet window.", { errorCode, errorDescription });
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const fields = { windowId: window.id, level, line, sourceId, message };
    if (level >= 3) logError("pet.window", "renderer console", fields);
    else if (level === 2) warn("pet.window", "renderer console", fields);
    else debug("pet.window", "renderer console", fields);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    logError("pet.window", "renderer process gone", { windowId: window.id, details });
    console.error("Default pet renderer process gone.", details);
  });

  if (useLayerShell) {
    try {
      // Adopt the window into a native layer-shell surface. This patches the
      // display-facing methods on the instance so the rest of the pet stack
      // (controllers, motion engine, content loading) keeps working unchanged
      // while the visible carrier is the helper's overlay surface.
      const surface = adoptPetWindowForLayerShell(window, position);
      // Asynchronous startup/runtime failure (helper cannot start, keeps
      // dying, never becomes ready) — tear the offscreen window down and let
      // the caller rebuild the pet as a normal visible window.
      surface.onFatal = () => {
        if (window.isDestroyed()) return;
        logError("pet.window", "layer-shell backend fatal; falling back to a normal window", {});
        // Build and publish the replacement first. The old window's `closed`
        // listener can then see that it no longer owns the controller slot and
        // must not clear the replacement's state.
        try {
          onLayerShellFatal?.(readWindowPosition(window), window.isVisible());
        } catch (error) {
          logError("pet.window", "normal-window fallback failed", error instanceof Error ? error : { error });
        } finally {
          try {
            if (!window.isDestroyed()) window.destroy();
          } catch {
            // window may already be gone
          }
        }
      };
    } catch (error) {
      logError("pet.window", "layer-shell adoption failed; falling back to a normal window", error instanceof Error ? error : { error });
      if (!window.isDestroyed()) window.destroy();
      return createBasePetWindowWithMode(title, position, focusOptions, false);
    }
  }

  return window;
}

function applyPetAlwaysOnTop(window: BrowserWindow): void {
  if (window.isDestroyed()) return;

  // On Windows the shell strips WS_EX_TOPMOST behind Electron's back
  // (fullscreen apps), but Electron's cached always-on-top state still says
  // "on", so a plain setAlwaysOnTop(true) short-circuits without reaching the
  // OS — verified live: the flag stayed off for minutes of re-asserts. Drop
  // the cached flag first so the re-assert issues a real SetWindowPos.
  if (process.platform === "win32" && window.isAlwaysOnTop()) {
    window.setAlwaysOnTop(false);
  }

  window.setAlwaysOnTop(true, process.platform === "linux" ? "screen-saver" : "floating");

  if (process.platform === "linux") {
    window.setVisibleOnAllWorkspaces(true);
  }
}

export async function loadDefaultPetContent(window: BrowserWindow, paused: boolean, display: PetTransientDisplay | null = null, badge: PetStatusBadgeReaction | null = null, dismissToken?: string, pluginBubbles: PetPluginBubbles | null = null): Promise<void> {
  const sequence = allocateWindowLoadSequence(window);
  debug("pet.window", "default content render begin", { windowId: window.id, sequence, paused, hasDisplay: Boolean(display), reaction: display?.reaction, hasMessage: Boolean(display?.message), badge, hasPluginBubble: Boolean(pluginBubbles?.transient), hasPinned: Boolean(pluginBubbles?.pinned), defaultPetId: getAppStateSnapshot().preferences.defaultPetId });
  applyPetWindowFocusPolicy(window, petPluginBubblesHaveInteractiveInput(pluginBubbles) || isDefaultPetChatExpanded() || isDefaultPetChatCompactOpen());
  const render = await createDefaultPetRender(paused, display, badge, dismissToken, pluginBubbles);
  if (windowLoadSequences.get(window) === sequence) updatePetGazeConfiguration(window, render, render.flipped);
  const hasPinned = Boolean(pluginBubbles?.pinned);
  const bubbleHtml = createBubbleMarkup(display, paused, badge, dismissToken, pluginBubbles);
  const hasBubble = Boolean(bubbleHtml.trim());
  applyLinuxPetWindowShape(window, getAppStateSnapshot().preferences.petScale as PetScaleValue, hasBubble, hasPinned);
  if (tryUpdateLoadedPetContent(window, render, "default", sequence)) return;
  await loadPetHtmlFile(window, render.html, "default", sequence).then(() => {
    petWindowRenderCache.set(window, render.cacheKey);
    if (windowLoadSequences.get(window) === sequence) updatePetGazeConfiguration(window, render, render.flipped);
  }).catch((error: unknown) => {
    logError("pet.window", "default content load failed", error instanceof Error ? error : { error });
    console.error("Failed to load default pet URL.", error);
  });
}

export async function loadExplicitPetContent(window: BrowserWindow, petId: string, display: PetTransientDisplay | null = null, badge: PetStatusBadgeReaction | null = null, dismissToken?: string, scaleOverride?: PetScaleValue, pluginBubbles: PetPluginBubbles | null = null): Promise<void> {
  const sequence = allocateWindowLoadSequence(window);
  try {
    applyPetWindowFocusPolicy(window, petPluginBubblesHaveInteractiveInput(pluginBubbles));
    const state = getAppStateSnapshot();
    const pet = state.pets.installed.find((candidate) => candidate.id === petId);
    if (!pet || pet.broken) {
      throw new Error(`Cannot render explicit pet: ${petId}`);
    }
    debug("pet.window", "explicit content render begin", { windowId: window.id, sequence, petId, displayName: pet.displayName, hasDisplay: Boolean(display), reaction: display?.reaction, hasMessage: Boolean(display?.message), badge });
    const scale = scaleOverride ?? state.preferences.petScale as PetScaleValue;
    const render = pet.id === builtInPet.id
      ? createBuiltInPetRender(false, display, badge, scale, `explicit:${pet.id}`, pet.id, dismissToken, pluginBubbles, "agent", shouldUseWaylandNativePetDrag() ? "drag" : "no-drag")
      : await createInstalledPetRender(
        pet.id,
        pet.displayName,
        false,
        display,
        scale,
        badge,
        `explicit:${pet.id}`,
        dismissToken,
        pluginBubbles,
        pet.source?.kind === "team" ? "team" : "personal",
        "agent",
        undefined,
        shouldUseWaylandNativePetDrag() ? "drag" : "no-drag",
      );
    if (windowLoadSequences.get(window) === sequence) updatePetGazeConfiguration(window, render, render.flipped);
    const hasPinned = Boolean(pluginBubbles?.pinned);
    const bubbleHtml = createBubbleMarkup(display, false, badge, dismissToken, pluginBubbles);
    const hasBubble = Boolean(bubbleHtml.trim());
    applyLinuxPetWindowShape(window, scale, hasBubble, hasPinned);
    if (tryUpdateLoadedPetContent(window, render, `explicit-${pet.id}`, sequence)) return;
    await loadPetHtmlFile(window, render.html, `explicit-${pet.id}`, sequence);
    petWindowRenderCache.set(window, render.cacheKey);
    if (windowLoadSequences.get(window) === sequence) updatePetGazeConfiguration(window, render, render.flipped);
  } catch (error: unknown) {
    logError("pet.window", "explicit content load failed", error instanceof Error ? error : { petId, error });
    console.error(`Failed to load explicit pet ${petId} URL.`, error);
  }
}

function petPluginBubblesHaveInteractiveInput(pluginBubbles: PetPluginBubbles | null | undefined): boolean {
  return Boolean(pluginBubbles?.transient?.bubble.input || pluginBubbles?.pinned?.bubble.input);
}

function applyPetWindowFocusPolicy(window: BrowserWindow, hasInteractiveInput: boolean): void {
  if (window.isDestroyed()) return;
  const effectiveWaylandBackend = isEffectiveWaylandBackend();
  const focusable = shouldPetWindowBeFocusable(process.platform, effectiveWaylandBackend, hasInteractiveInput);
  if (petWindowFocusPolicy.get(window) === focusable) return;
  try {
    window.setFocusable(focusable);
    petWindowFocusPolicy.set(window, focusable);
    debug("pet.window", "focus policy applied", { windowId: window.id, focusable, hasInteractiveInput, platform: process.platform, effectiveWaylandBackend });
  } catch (error) {
    logError("pet.window", "focus policy failed", error instanceof Error ? error : { windowId: window.id, focusable, hasInteractiveInput, error });
  }
}

export function preparePetTransientDisplay(display: PetTransientDisplay): PetTransientDisplay {
  if (display.suppressReactionMessage) return display;
  if (!display.reaction || display.message || display.reactionMessage) return display;
  return { ...display, reactionMessage: pickReactionMessage(display.reaction, Math.random, getActiveLocale()) };
}

export function mergePetTransientDisplay(current: PetTransientDisplay | null, next: PetTransientDisplay): PetTransientDisplay {
  if (next.message || next.mediaPath || !next.reaction || !current?.message) return preparePetTransientDisplay(next);
  return { ...current, reaction: next.reaction, dismissToken: next.dismissToken ?? current.dismissToken };
}

export function getTransientReactionAnimationMs(display: PetTransientDisplay): number | null {
  if (!display.reaction) return null;
  const state = getReactionSpriteState(display.reaction);
  const row = getConfiguredSpriteStates(getAppStateSnapshot().preferences.waitingAnimationDurationMs)[state];
  const iterations = "iterations" in row ? row.iterations : "infinite";
  return typeof iterations === "number" ? row.durationMs * iterations : null;
}

export function getTransientDisplayDurationMs(display: PetTransientDisplay): number {
  if (display.displayDurationMs) return display.displayDurationMs;
  if (display.mediaPath) return defaultMediaDurationMs;
  const baseMs = display.reaction === "success" || display.reaction === "error" ? 5_000 : 4_000;
  const message = display.message ?? display.reactionMessage;
  if (!message) return baseMs;
  return Math.min(12_000, Math.max(baseMs, message.length * 70));
}

export function clearTransientReaction(display: PetTransientDisplay): PetTransientDisplay {
  if (!display.reaction) return display;
  return { ...display, reaction: undefined };
}

export function setPetReactionState(window: BrowserWindow, state: UniversalSpriteState): void {
  if (window.isDestroyed()) return;
  setPetGazeReactionState(window, state);
  window.webContents.send("openpets:pet-reaction-state", state);
}

/** Override the pet sprite with a plugin-bundled spritesheet strip (§5), or clear with null. */
export function setPetSpriteOverride(window: BrowserWindow, override: { readonly filePath: string; readonly fps: number; readonly loop: boolean } | null): void {
  if (window.isDestroyed()) return;
  setPetGazePluginOverride(window, override !== null);
  window.webContents.send("openpets:pet-sprite-override", override ? { fileUrl: pathToFileURL(override.filePath).toString(), fps: override.fps, loop: override.loop } : null);
}

/** Scale override for a single pet window (plugin setScale). */
export function setPetWindowScale(window: BrowserWindow, scale: number): void {
  if (window.isDestroyed()) return;
  window.webContents.send("openpets:pet-scale-override", scale);
}

/** Play a sound through the pet window's WebAudio pipeline. */
export function playPetWindowAudio(window: BrowserWindow, payload: PetWindowAudioPayload): void {
  if (window.isDestroyed()) return;
  window.webContents.send("openpets:play-audio", payload);
}

export function stopPetWindowAudio(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  window.webContents.send("openpets:stop-audio");
}

/** Speak text via the renderer speechSynthesis voice (plugin voice.speak). */
export function speakPetWindowTts(window: BrowserWindow, text: string, opts: { readonly voice?: string; readonly rate?: number; readonly requestId?: string }): void {
  if (window.isDestroyed()) return;
  window.webContents.send("openpets:tts-speak", { text, voice: opts.voice, rate: opts.rate, requestId: opts.requestId });
}

export function stopPetWindowTts(window: BrowserWindow, requestId?: string): void {
  if (window.isDestroyed()) return;
  window.webContents.send("openpets:tts-stop", { requestId });
}

function tryUpdateLoadedPetContent(window: BrowserWindow, render: PetContentRender, name: string, sequence: number): boolean {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
  if (!isLatestPetRenderSequence(windowLoadSequences.get(window), sequence)) {
    debug("pet.window", "content update skipped", { windowId: window.id, name, sequence, latestSequence: windowLoadSequences.get(window), reason: "superseded" });
    return false;
  }
  if (petWindowRenderCache.get(window) !== render.cacheKey) return false;
  const url = window.webContents.getURL();
  if (!isAllowedPetDocumentUrl(url)) return false;
  updatePetGazeConfiguration(window, render, render.flipped);
  debug("pet.window", "content update in place", { windowId: window.id, name, sequence, reactionState: render.reactionState });
  window.webContents.send("openpets:pet-content-state", {
    bodyHtml: render.bodyHtml,
    displayName: render.displayName,
    assetName: render.assetName,
    reactionState: render.reactionState,
  });
  return true;
}

export function getSafeDefaultPetPosition(position: Point | undefined): Point {
  const pos = position ?? getDefaultPetInitialPosition();
  if (isCrossDisplayRoamingEnabled()) return clampToNearestDisplayIfOffscreen(pos, defaultPetWindowSize);
  return clampToVisibleWorkArea(pos, defaultPetWindowSize);
}

export function readWindowPosition(window: BrowserWindow): Point {
  const [x, y] = window.getPosition();
  const bounds = window.getBounds();
  let rawPos: Point = { x, y };
  if (bounds.width > defaultPetWindowSize.width || bounds.height > defaultPetWindowSize.height) {
    rawPos = toCollapsedPosition(rawPos, { width: bounds.width, height: bounds.height }, defaultPetWindowSize);
  }
  if (isCrossDisplayRoamingEnabled()) return clampToNearestDisplayIfOffscreen(rawPos, defaultPetWindowSize);
  return clampToVisibleWorkArea(rawPos, defaultPetWindowSize);
}

function applyLinuxPetWindowShape(window: BrowserWindow, scale: PetScaleValue, hasBubble: boolean, hasPinned = false): void {
  if (process.platform !== "linux" || window.isDestroyed()) return;

  const isExpanded = isDefaultPetChatExpanded();
  const bounds = window.getBounds();
  const hudScale = getAppStateSnapshot().preferences.hudScale as HudScaleValue;
  const { shape } = calculatePetInteractiveShape({
    windowWidth: bounds.width,
    windowHeight: bounds.height,
    spriteWidth: defaultPetSprite.frameWidth,
    spriteHeight: defaultPetSprite.frameHeight,
    scale,
    hasBubble,
    hasPinned,
    hudScale,
    isExpanded,
    isCompactOpen: !isExpanded && isDefaultPetChatCompactOpen(),
    panelHeight: isExpanded ? getActiveChatPanelHeight() : undefined,
  });

  // setShape's rects are undocumented as to units, but empirically the window's
  // true on-screen size/position are scaled by the display's scaleFactor, while
  // window.getBounds()/getContentBounds() unreliably report values close to the
  // unscaled logical size instead of the true physical geometry — so getBounds()
  // must not be used here. Scale the DIP-computed rect by the live scaleFactor
  // directly instead.
  const scaleFactor = screen.getDisplayMatching(bounds).scaleFactor;
  const physicalShape: Electron.Rectangle[] = scaleFactor === 1 ? [...shape] : shape.map((rect) => ({
    x: Math.round(rect.x * scaleFactor),
    y: Math.round(rect.y * scaleFactor),
    width: Math.round(rect.width * scaleFactor),
    height: Math.round(rect.height * scaleFactor),
  }));

  try {
    window.setShape(physicalShape);
    debug("pet.window", "linux window shape applied", { windowId: window.id, scale, hasBubble, hasPinned, hudScale, scaleFactor, shape: physicalShape });
  } catch (error) {
    logError("pet.window", "linux window shape failed", error instanceof Error ? error : { error });
  }
}

export function applyLinuxPetWindowShapeWithExpansion(
  window: BrowserWindow,
  isExpanded: boolean,
  isCompactOpen = isDefaultPetChatCompactOpen(),
  panelHeight = isExpanded ? getActiveChatPanelHeight() : undefined,
): void {
  if (process.platform !== "linux" || window.isDestroyed()) return;

  const state = getAppStateSnapshot();
  const scale = state.preferences.petScale as PetScaleValue;
  const hudScale = state.preferences.hudScale as HudScaleValue;
  const bounds = window.getBounds();
  const { shape } = calculatePetInteractiveShape({
    windowWidth: bounds.width,
    windowHeight: bounds.height,
    spriteWidth: defaultPetSprite.frameWidth,
    spriteHeight: defaultPetSprite.frameHeight,
    scale,
    hasBubble: false,
    hudScale,
    isExpanded,
    isCompactOpen: !isExpanded && isCompactOpen,
    panelHeight,
  });

  const scaleFactor = screen.getDisplayMatching(bounds).scaleFactor;
  const physicalShape: Electron.Rectangle[] = scaleFactor === 1 ? [...shape] : shape.map((rect) => ({
    x: Math.round(rect.x * scaleFactor),
    y: Math.round(rect.y * scaleFactor),
    width: Math.round(rect.width * scaleFactor),
    height: Math.round(rect.height * scaleFactor),
  }));

  try {
    window.setShape(physicalShape);
    debug("pet.window", "linux window shape applied with expansion", { windowId: window.id, isExpanded, isCompactOpen, scaleFactor, shape: physicalShape });
  } catch (error) {
    logError("pet.window", "linux window shape with expansion failed", error instanceof Error ? error : { error });
  }
}

export function refreshDefaultPetFocusPolicy(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  const expanded = isDefaultPetChatExpanded();
  applyPetWindowFocusPolicy(window, expanded || isDefaultPetChatCompactOpen());
}

function installMotionStatePublisher(window: BrowserWindow): void {
  registerPetGazeWindow(window);
  let lastX = window.getPosition()[0];
  let lastSent: PetMotionState = "idle";
  let idleTimer: NodeJS.Timeout | null = null;

  const sendMotionState = (state: PetMotionState): void => {
    if (window.isDestroyed() || lastSent === state) return;
    lastSent = state;
    setPetGazeMotionState(window, state);
    window.webContents.send("openpets:pet-motion", state);
  };

  const scheduleIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      sendMotionState("idle");
    }, 180);
  };

  const handleMove = (): void => {
    if (window.isDestroyed()) return;
    suspendPetGazeForMovement(window);
    const [x] = window.getPosition();
    const deltaX = x - lastX;
    lastX = x;

    if (Math.abs(deltaX) >= 3) {
      sendMotionState(deltaX > 0 ? "run-right" : "run-left");
    }
    scheduleIdle();
  };

  window.on("move", handleMove);
  window.on("moved", handleMove);
  window.webContents.on("did-finish-load", () => {
    lastSent = "idle";
    setPetGazeMotionState(window, "idle");
    window.webContents.send("openpets:pet-motion", "idle");
  });
  window.on("closed", () => {
    if (idleTimer) clearTimeout(idleTimer);
  });
}

function isAllowedPetDocumentUrl(url: string): boolean {
  return url.startsWith("data:text/html") || url.startsWith("file://");
}

function allocateWindowLoadSequence(window: BrowserWindow): number {
  const sequence = (windowLoadSequences.get(window) ?? 0) + 1;
  windowLoadSequences.set(window, sequence);
  return sequence;
}

async function loadPetHtmlFile(window: BrowserWindow, html: string, name: string, sequence: number): Promise<void> {
  const safeName = name.replace(/[^a-z0-9_-]/gi, "-").slice(0, 80) || "pet";

  const previous = windowLoadChains.get(window) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    if (window.isDestroyed()) {
      debug("pet.window", "load skipped", { windowId: window.id, name: safeName, sequence, reason: "destroyed" });
      return;
    }

    if (windowLoadSequences.get(window) !== sequence) {
      debug("pet.window", "load skipped", { windowId: window.id, name: safeName, sequence, latestSequence: windowLoadSequences.get(window), reason: "superseded" });
      return;
    }

    const dir = join(app.getPath("userData"), "rendered-pets");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${safeName}.html`);
    await writeFile(filePath, html, "utf8");
    if (window.isDestroyed()) {
      debug("pet.window", "load skipped", { windowId: window.id, name: safeName, sequence, reason: "destroyed-after-write" });
      return;
    }
    debug("pet.window", "load file begin", { windowId: window.id, name: safeName, sequence, filePath });
    window.setIgnoreMouseEvents(false);
    try {
      await window.loadFile(filePath);
      debug("pet.window", "load file complete", { windowId: window.id, name: safeName, sequence, url: window.webContents.getURL() });
    } catch (error) {
      if (!window.isDestroyed()) {
        if (process.platform === "linux") window.setIgnoreMouseEvents(false);
        else window.setIgnoreMouseEvents(true, { forward: true });
      }
      logError("pet.window", "load file rejected", error instanceof Error ? error : { windowId: window.id, name: safeName, sequence, error });
      throw error;
    }
  });

  windowLoadChains.set(window, next);
  void next.catch(() => {}).finally(() => {
    if (windowLoadChains.get(window) === next) windowLoadChains.delete(window);
  });

  return next;
}

function debounce(callback: () => void, delayMs: number): () => void {
  let timeout: NodeJS.Timeout | undefined;

  return () => {
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(callback, delayMs);
  };
}
