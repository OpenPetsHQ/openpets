import { screen, type BrowserWindow } from "electron";

import { getAppStateSnapshot } from "./app-state.js";
import { getCodexV2GazeSpritePosition, isCodexV2GazeActive, mirrorCodexV2GazeIndex, quantizeCodexV2GazeDirection, shouldTrackCodexV2Gaze } from "./codex-pets-core.js";
import type { Point } from "./display.js";
import type { PetContentRender } from "./pet-window-types.js";
import type { PetMotionState, UniversalSpriteState } from "./reaction-animation-mapping.js";

interface PetGazeEntry {
  readonly window: BrowserWindow;
  codexSpriteVersion: 1 | 2;
  paused: boolean;
  reactionState: UniversalSpriteState;
  motionState: PetMotionState;
  flipped: boolean;
  pluginSpriteOverride: boolean;
  rendererReady: boolean;
  dragging: boolean;
  movementSuspended: boolean;
  movementTimer: NodeJS.Timeout | null;
  movementGeneration: number;
  lastBounds: Electron.Rectangle | null;
  lastDirection: number | null;
}

const petGazeEntries = new Map<BrowserWindow, PetGazeEntry>();
let petGazeTicker: NodeJS.Timeout | null = null;
const petGazeTickerIntervalMs = 100;
let petGazeCursorPoint: Point | null = null;
let petGazeLastCursorMovedAt: number | null = null;

export function registerPetGazeWindow(window: BrowserWindow): void {
  if (petGazeEntries.has(window)) return;
  const entry: PetGazeEntry = {
    window,
    codexSpriteVersion: 1,
    paused: false,
    reactionState: "idle",
    motionState: "idle",
    flipped: false,
    pluginSpriteOverride: false,
    rendererReady: false,
    dragging: false,
    movementSuspended: false,
    movementTimer: null,
    movementGeneration: 0,
    lastBounds: null,
    lastDirection: null,
  };
  petGazeEntries.set(window, entry);

  const resetForNavigation = (): void => resetPetGazeWindow(window);
  const handleLoad = (): void => setPetGazeRendererReady(window);
  const handleRendererGone = (): void => resetPetGazeWindow(window);
  const handleHide = (): void => {
    const current = petGazeEntries.get(window);
    if (!current) return;
    if (current.movementTimer) {
      clearTimeout(current.movementTimer);
      current.movementTimer = null;
    }
    current.movementGeneration += 1;
    current.movementSuspended = false;
    current.dragging = false;
    current.lastBounds = null;
    resetPetGazeDirection(current);
    syncPetGazeTicker();
  };
  const handleShow = (): void => forcePetGazeEvaluation(window);
  // Held directly: `closed` fires after destroy(), when the
  // `window.webContents` getter throws "Object has been destroyed".
  const webContents = window.webContents;
  webContents.on("did-start-navigation", resetForNavigation);
  webContents.on("did-start-loading", resetForNavigation);
  webContents.on("did-finish-load", handleLoad);
  webContents.on("did-fail-load", resetForNavigation);
  webContents.on("render-process-gone", handleRendererGone);
  window.on("hide", handleHide);
  window.on("show", handleShow);
  const remove = (): void => {
    const current = petGazeEntries.get(window);
    if (!current) return;
    if (current.movementTimer) clearTimeout(current.movementTimer);
    if (!webContents.isDestroyed()) {
      webContents.off("did-start-navigation", resetForNavigation);
      webContents.off("did-start-loading", resetForNavigation);
      webContents.off("did-finish-load", handleLoad);
      webContents.off("did-fail-load", resetForNavigation);
      webContents.off("render-process-gone", handleRendererGone);
    }
    window.off("hide", handleHide);
    window.off("show", handleShow);
    petGazeEntries.delete(window);
    syncPetGazeTicker();
  };
  window.once("closed", remove);
}

function stopPetGazeTicker(): void {
  if (petGazeTicker) clearInterval(petGazeTicker);
  petGazeTicker = null;
  petGazeCursorPoint = null;
  petGazeLastCursorMovedAt = null;
}

function syncPetGazeTicker(): void {
  const needsTicker = [...petGazeEntries.values()].some(isPetGazeEligible);
  if (!needsTicker) {
    stopPetGazeTicker();
    return;
  }
  if (petGazeTicker) return;
  petGazeTicker = setInterval(tickPetGaze, petGazeTickerIntervalMs);
  petGazeTicker.unref?.();
}

function isPetGazeEligible(entry: PetGazeEntry): boolean {
  return shouldTrackCodexV2Gaze({
    spriteVersion: entry.codexSpriteVersion,
    idleCursorGazeEnabled: getAppStateSnapshot().preferences.idleCursorGazeEnabled,
    paused: entry.paused,
    reactionState: entry.reactionState,
    motionState: entry.motionState,
    pluginSpriteOverride: entry.pluginSpriteOverride,
  })
    && !entry.dragging
    && !entry.movementSuspended
    && entry.rendererReady
    && !entry.window.isDestroyed()
    && entry.window.isVisible()
    && !entry.window.webContents.isDestroyed();
}

/** Apply an idle cursor-gaze preference change without waiting for the ticker. */
export function refreshPetGazePreference(): void {
  const enabled = getAppStateSnapshot().preferences.idleCursorGazeEnabled;
  for (const entry of petGazeEntries.values()) {
    resetPetGazeDirection(entry);
    if (enabled) forcePetGazeEvaluation(entry.window);
  }
  syncPetGazeTicker();
}

function sendPetGaze(entry: PetGazeEntry, direction: number | null): void {
  if (!entry.rendererReady || entry.window.isDestroyed() || entry.window.webContents.isDestroyed()) return;
  if (entry.lastDirection === direction) return;
  entry.lastDirection = direction;
  entry.window.webContents.send("openpets:pet-gaze", { index: direction });
}

function resetPetGazeDirection(entry: PetGazeEntry): void {
  const hadDirection = entry.lastDirection !== null;
  entry.lastDirection = null;
  if (!hadDirection || !entry.rendererReady || entry.window.isDestroyed() || entry.window.webContents.isDestroyed()) return;
  entry.window.webContents.send("openpets:pet-gaze", { index: null });
}

function evaluatePetGaze(entry: PetGazeEntry, cursor: Point, now = Date.now()): void {
  if (!isPetGazeEligible(entry)) {
    if (!entry.rendererReady || entry.window.isDestroyed() || entry.window.webContents.isDestroyed()) entry.lastDirection = null;
    else resetPetGazeDirection(entry);
    return;
  }
  if (!isCodexV2GazeActive(petGazeLastCursorMovedAt, now)) {
    sendPetGaze(entry, null);
    return;
  }
  let bounds: Electron.Rectangle;
  try {
    bounds = entry.window.getContentBounds();
  } catch {
    resetPetGazeDirection(entry);
    return;
  }
  const direction = quantizeCodexV2GazeDirection(
    cursor,
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
  );
  const selected = direction === null ? null : getCodexV2GazeSpritePosition(direction, entry.flipped);
  const selectedDirection = direction === null ? null : (entry.flipped ? mirrorCodexV2GazeIndex(direction) : direction);
  sendPetGaze(entry, selected ? selectedDirection : null);
}

function updatePetGazeCursor(cursor: Point, now: number): void {
  if (!petGazeCursorPoint) {
    petGazeCursorPoint = cursor;
    return;
  }
  if (petGazeCursorPoint.x === cursor.x && petGazeCursorPoint.y === cursor.y) return;
  petGazeCursorPoint = cursor;
  petGazeLastCursorMovedAt = now;
}

function tickPetGaze(): void {
  if (![...petGazeEntries.values()].some(isPetGazeEligible)) {
    for (const entry of petGazeEntries.values()) evaluatePetGaze(entry, { x: 0, y: 0 });
    syncPetGazeTicker();
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  const now = Date.now();
  updatePetGazeCursor(cursor, now);
  for (const entry of petGazeEntries.values()) {
    if (!entry.window.isDestroyed() && !entry.window.webContents.isDestroyed() && entry.window.isVisible()) {
      try {
        const bounds = entry.window.getContentBounds();
        const previous = entry.lastBounds;
        entry.lastBounds = bounds;
        if (previous && (previous.x !== bounds.x || previous.y !== bounds.y || previous.width !== bounds.width || previous.height !== bounds.height)) {
          suspendPetGazeForMovement(entry.window);
        }
      } catch {
        entry.lastBounds = null;
      }
    }
    evaluatePetGaze(entry, cursor, now);
  }
}

function forcePetGazeEvaluation(window: BrowserWindow): void {
  const entry = petGazeEntries.get(window);
  if (!entry || !entry.rendererReady || window.isDestroyed() || window.webContents.isDestroyed() || !window.isVisible()) return;
  evaluatePetGaze(entry, screen.getCursorScreenPoint());
  syncPetGazeTicker();
}

export function resetPetGazeWindow(window: BrowserWindow): void {
  const entry = petGazeEntries.get(window);
  if (!entry) return;
  if (entry.movementTimer) {
    clearTimeout(entry.movementTimer);
    entry.movementTimer = null;
  }
  entry.movementGeneration += 1;
  entry.rendererReady = false;
  entry.dragging = false;
  entry.motionState = "idle";
  entry.movementSuspended = false;
  entry.lastBounds = null;
  resetPetGazeDirection(entry);
  syncPetGazeTicker();
}

export function setPetGazeRendererReady(window: BrowserWindow): void {
  const entry = petGazeEntries.get(window);
  if (!entry || window.isDestroyed() || window.webContents.isDestroyed()) return;
  entry.rendererReady = true;
  forcePetGazeEvaluation(window);
}

export function updatePetGazeConfiguration(window: BrowserWindow, render: PetContentRender, flipped: boolean): void {
  const entry = petGazeEntries.get(window);
  if (!entry) return;
  const changed = entry.codexSpriteVersion !== render.codexSpriteVersion
    || entry.paused !== render.paused
    || entry.reactionState !== render.reactionState
    || entry.flipped !== flipped;
  entry.codexSpriteVersion = render.codexSpriteVersion;
  entry.paused = render.paused;
  entry.reactionState = render.reactionState;
  entry.flipped = flipped;
  if (changed) resetPetGazeDirection(entry);
  syncPetGazeTicker();
}

export function setPetGazeMotionState(window: BrowserWindow, state: PetMotionState): void {
  const entry = petGazeEntries.get(window);
  if (!entry) return;
  entry.motionState = state;
  if (state !== "idle") resetPetGazeDirection(entry);
  syncPetGazeTicker();
  if (state === "idle") forcePetGazeEvaluation(window);
}

export function setPetGazeDragging(window: BrowserWindow, dragging: boolean): void {
  const entry = petGazeEntries.get(window);
  if (!entry) return;
  entry.dragging = dragging;
  if (dragging) resetPetGazeDirection(entry);
  syncPetGazeTicker();
}

export function suspendPetGazeForMovement(window: BrowserWindow): void {
  const entry = petGazeEntries.get(window);
  if (!entry) return;
  entry.movementSuspended = true;
  entry.lastBounds = null;
  resetPetGazeDirection(entry);
  if (entry.movementTimer) clearTimeout(entry.movementTimer);
  const movementGeneration = ++entry.movementGeneration;
  entry.movementTimer = setTimeout(() => {
    if (entry.movementGeneration !== movementGeneration) return;
    entry.movementTimer = null;
    entry.movementSuspended = false;
    syncPetGazeTicker();
    forcePetGazeEvaluation(window);
  }, 180);
  entry.movementTimer.unref?.();
  syncPetGazeTicker();
}

export function setPetGazeReactionState(window: BrowserWindow, state: UniversalSpriteState): void {
  const entry = petGazeEntries.get(window);
  if (!entry) return;
  entry.reactionState = state;
  if (state !== "idle") resetPetGazeDirection(entry);
  syncPetGazeTicker();
}

export function setPetGazePluginOverride(window: BrowserWindow, active: boolean): void {
  const entry = petGazeEntries.get(window);
  if (!entry) return;
  entry.pluginSpriteOverride = active;
  resetPetGazeDirection(entry);
  syncPetGazeTicker();
}
