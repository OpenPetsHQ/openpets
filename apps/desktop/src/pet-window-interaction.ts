import { ipcMain, screen, type BrowserWindow, type IpcMainEvent } from "electron";

import type { Point } from "./display.js";
import { debug } from "./logger.js";
import { canForwardMouseEvents as platformCanForwardMouseEvents, shouldWatchForwardedMouseEvents } from "./mouse-forwarding.js";
import { resetPetGazeWindow, setPetGazeDragging, setPetGazeRendererReady, suspendPetGazeForMovement } from "./pet-window-gaze.js";
import type { PetWindowInteractionHooks, PetWindowSpeechCompletion } from "./pet-window-types.js";

export interface PetWindowInteractionDependencies {
  readonly useWaylandNativeDrag: boolean;
  readonly readWindowPosition: (window: BrowserWindow) => Point;
}

const petMouseInteropRecovery = new WeakMap<BrowserWindow, (reason: string) => void>();
const petWindowDragging = new WeakMap<BrowserWindow, boolean>();
const petWindowSpeechCompletionListeners = new Set<(completion: PetWindowSpeechCompletion) => void>();

export function subscribePetWindowSpeechCompletion(listener: (completion: PetWindowSpeechCompletion) => void): () => void {
  petWindowSpeechCompletionListeners.add(listener);
  return () => {
    petWindowSpeechCompletionListeners.delete(listener);
  };
}

export function isPetWindowDragging(window: BrowserWindow): boolean {
  return petWindowDragging.get(window) === true;
}

export function recoverPetMouseInterop(window: BrowserWindow, reason: string): void {
  if (window.isDestroyed()) return;
  const recover = petMouseInteropRecovery.get(window);
  if (recover) {
    recover(reason);
    return;
  }

  debug("pet.window", "mouse interop recovery skipped", {
    windowId: window.id,
    reason,
    skippedReason: "unregistered-window",
  });
}

export function installPetWindowInteraction(
  window: BrowserWindow,
  dependencies: PetWindowInteractionDependencies,
  hooks: PetWindowInteractionHooks = {},
): void {
  const { onBubbleDismissed, onBubbleAction, onBubbleSubmit, onPetEvent } = hooks;
  const { readWindowPosition, useWaylandNativeDrag } = dependencies;
  const windowId = window.id;

  if (useWaylandNativeDrag) {
    debug("pet.window", "Wayland native pet drag enabled", { windowId });
  }

  let dragging: {
    readonly startScreenX: number;
    readonly startScreenY: number;
    readonly startWindowX: number;
    readonly startWindowY: number;
    readonly width: number;
    readonly height: number;
  } | null = null;
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

    if (passthrough && canForwardMouseEvents) {
      window.setIgnoreMouseEvents(true, { forward: true });
    } else if (passthrough) {
      window.setIgnoreMouseEvents(true);
    } else {
      window.setIgnoreMouseEvents(false);
    }
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

  const getCursorProbe = (): {
    readonly inside: boolean;
    readonly cursor: Point;
    readonly bounds: Electron.Rectangle;
    readonly clientX: number;
    readonly clientY: number;
  } => {
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
    if (logProbe) {
      debug("pet.window", "cursor hit-test probe", {
        windowId,
        reason,
        inside: probe.inside,
        cursor: probe.cursor,
        bounds: probe.bounds,
      });
    }
    if (!probe.inside) return;

    webContents.send("openpets:pet-probe-hit-test", {
      clientX: probe.clientX,
      clientY: probe.clientY,
      reason,
    });
  };

  const rearmMouseForwarding = (reason: string, logRearm = true): void => {
    if (window.isDestroyed()) return;

    if (dragging || lastInteractive) {
      if (logRearm) {
        debug("pet.window", "mouse forwarding rearm skipped", {
          windowId,
          reason,
          dragging: Boolean(dragging),
          interactive: lastInteractive,
        });
      }
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
    if (sourceName !== "idle-forwarding-watch" || lastInteractive) {
      debug("pet.window", "hit test", {
        windowId,
        interactive: lastInteractive,
        dragging,
        source: sourceName,
      });
    }
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
    dragging = {
      startScreenX: point.screenX,
      startScreenY: point.screenY,
      startWindowX: startBounds.x,
      startWindowY: startBounds.y,
      width: startBounds.width,
      height: startBounds.height,
    };
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
    debug("pet.window", "drag end", {
      windowId,
      position: window.isDestroyed() ? null : readWindowPosition(window),
    });
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
    if (typeof dismissToken === "string" && typeof actionId === "string" && actionId.length <= 64) {
      onBubbleAction?.(dismissToken, actionId);
    }
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

    const data = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    if (name !== "pet:hover") debug("pet.window", "pet event", { windowId, name });
    onPetEvent?.(name, data);
  };

  const handleSpeechCompletion = (event: IpcMainEvent, payload: unknown): void => {
    if (!isFromWindow(event) || !isRecord(payload) || typeof payload.requestId !== "string" || payload.requestId.length === 0) return;
    if (payload.kind !== "system" || (payload.outcome !== "ended" && payload.outcome !== "error" && payload.outcome !== "stopped")) return;

    const completion: PetWindowSpeechCompletion = {
      window,
      requestId: payload.requestId,
      kind: payload.kind,
      outcome: payload.outcome,
    };
    for (const listener of [...petWindowSpeechCompletionListeners]) {
      try {
        listener(completion);
      } catch {
        // Observers cannot affect pet-window cleanup.
      }
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
  return typeof value === "object"
    && value !== null
    && typeof (value as { readonly screenX?: unknown }).screenX === "number"
    && typeof (value as { readonly screenY?: unknown }).screenY === "number";
}
