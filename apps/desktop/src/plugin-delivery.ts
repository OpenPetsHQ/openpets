import type { BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { join } from "node:path";
import { getDisplayKey } from "./display.js";

const require = createRequire(import.meta.url);

let mockElectron: any = null;
export function _setMockElectron(mock: any) {
  mockElectron = mock;
}

function getElectron() {
  if (mockElectron) return mockElectron;
  try {
    return require("electron");
  } catch {
    return null;
  }
}

// Lazy logger and appState loader to prevent execution of Electron imports under Node.js unit tests
let loggerModule: any = null;
function getLogger() {
  if (loggerModule) return loggerModule;
  if (getElectron()) {
    try {
      loggerModule = require("./logger.js");
      return loggerModule;
    } catch {}
  }
  return null;
}

function logWarn(scope: string, message: string, fields?: any) {
  const logger = getLogger();
  if (logger) logger.warn(scope, message, fields);
  else console.warn(`[WARN] [${scope}] ${message}`, fields || "");
}

function logInfo(scope: string, message: string, fields?: any) {
  const logger = getLogger();
  if (logger) logger.info(scope, message, fields);
  else console.log(`[INFO] [${scope}] ${message}`, fields || "");
}

function logDebug(scope: string, message: string, fields?: any) {
  const logger = getLogger();
  if (logger) logger.debug(scope, message, fields);
  else console.debug(`[DEBUG] [${scope}] ${message}`, fields || "");
}

function logError(scope: string, message: string, errorOrFields?: any, fields?: any) {
  const logger = getLogger();
  if (logger) logger.error(scope, message, errorOrFields, fields);
  else console.error(`[ERROR] [${scope}] ${message}`, errorOrFields, fields || "");
}

let appStateModule: any = null;
function getAppState() {
  if (appStateModule) return appStateModule;
  if (getElectron()) {
    try {
      appStateModule = require("./app-state.js");
      return appStateModule;
    } catch {}
  }
  return null;
}

export interface DeliveryDescriptor {
  readonly key: string;
  readonly courier: { readonly kind: "sprite"; readonly name: string };
  readonly title: string;
  readonly detail: string;
  readonly expiresAt: number;
}

export interface DeliveryHandle {
  dismiss(): void;
  onDismiss(handler: (reason: DismissReason) => void): void;
}

export type DismissReason = "click" | "manual" | "expired" | "plugin-stopped";

export interface QueuedDelivery {
  pluginId: string;
  key: string;
  courier: { pluginId: string; assetName: string; layout: CourierSpriteLayout; version: string };
  title: string;
  detail: string;
  expiresAt: number;
  addedAt: number;
  displayKey: string;
  generationId: string;
}

export interface SpriteStateDefinition {
  readonly row: number;
  readonly frames: number;
  readonly durationMs: number;
  readonly iterations?: number | "infinite";
}

export interface CourierSpriteLayout { readonly frameWidth: number; readonly frameHeight: number; readonly frames: number; readonly durationMs: number; }

export interface AirmailQueueManagerOptions {
  now(): number;
  getActiveDisplays(): { bounds: { x: number; y: number; width: number; height: number }; id?: number }[];
  getCursorDisplayKey(): string;
  getDisplayKey(bounds: { x: number; y: number; width: number; height: number }): string;
  createOrUpdateWindow(displayKey: string, activeItem: QueuedDelivery): void;
  destroyWindow(displayKey: string): void;
}

export class AirmailQueueManager {
  public queues = new Map<string, QueuedDelivery[]>();
  public rateLimits = new Map<string, number[]>();
  public dismissCallbacks = new Map<string, (reason: DismissReason) => void>();

  constructor(private options: AirmailQueueManagerOptions) {}

  public register(pluginId: string, descriptor: DeliveryDescriptor, courier: QueuedDelivery["courier"]): void {
    const now = this.options.now();

    // 1. Validate key characters [A-Za-z0-9._:-] (1–96)
    if (!descriptor.key || descriptor.key.length > 96 || !/^[A-Za-z0-9._:-]+$/.test(descriptor.key)) {
      logWarn("ui", "delivery registration rejected: invalid key format or length", { pluginId, key: descriptor.key });
      throw new Error(`Invalid delivery key: ${descriptor.key}`);
    }

    // 3. Title length check (1-160)
    if (!descriptor.title || descriptor.title.length < 1 || descriptor.title.length > 160) {
      logWarn("ui", "delivery registration rejected: title length boundaries violated", { pluginId, key: descriptor.key });
      throw new Error("Invalid title length. Expected 1-160 characters.");
    }

    // 4. Detail length check (0-200)
    if (descriptor.detail === undefined || descriptor.detail.length > 200) {
      logWarn("ui", "delivery registration rejected: detail length boundaries violated", { pluginId, key: descriptor.key });
      throw new Error("Invalid detail length. Expected 0-200 characters.");
    }

    // 5. Expiry validation (expiresAt <= now or > now + 7 days)
    if (!Number.isFinite(descriptor.expiresAt) || descriptor.expiresAt <= now || descriptor.expiresAt > now + 7 * 24 * 60 * 60 * 1000) {
      logWarn("ui", "delivery registration rejected: invalid expiresAt window", { pluginId, key: descriptor.key, expiresAt: descriptor.expiresAt });
      throw new Error("Invalid expiresAt time. Must be in the future, up to 7 days ahead.");
    }

    // 6. Rate limiting (max 9 requests per minute, 10th blocks)
    let history = this.rateLimits.get(pluginId) || [];
    history = history.filter((t) => t > now - 60000);
    if (history.length >= 9) {
      logWarn("ui", "delivery registration rejected: rate limit exceeded (9/min)", { pluginId, key: descriptor.key });
      throw new Error(`Rate limit exceeded for plugin: ${pluginId}. Max 9 requests per minute.`);
    }
    history.push(now);
    this.rateLimits.set(pluginId, history);

    // 7. Check if deduplication is needed
    let existingEntry: QueuedDelivery | null = null;
    let existingDisplayKey: string | null = null;
    for (const [dk, queue] of this.queues.entries()) {
      const idx = queue.findIndex((item) => item.pluginId === pluginId && item.key === descriptor.key);
      if (idx !== -1) {
        existingEntry = queue[idx];
        existingDisplayKey = dk;
        break;
      }
    }

    const targetDisplayKey = this.options.getCursorDisplayKey();

    if (existingEntry && existingDisplayKey) {
      // Deduplicate: replace descriptor in-place on its current display screen
      logDebug("ui", "delivery registration info: updating duplicate item in place", { pluginId, key: descriptor.key });
      const index = this.queues.get(existingDisplayKey)!.findIndex((item) => item.pluginId === pluginId && item.key === descriptor.key);
      if (index !== -1) {
        const item = this.queues.get(existingDisplayKey)![index];
        const updatedItem: QueuedDelivery = {
          ...item,
          courier,
          title: descriptor.title,
          detail: descriptor.detail,
          expiresAt: descriptor.expiresAt,
          addedAt: now,
        };
        this.queues.get(existingDisplayKey)![index] = updatedItem;

        // If it is active, notify rendering window immediately
        if (index === 0) {
          this.options.createOrUpdateWindow(existingDisplayKey, updatedItem);
        }
      }
      return;
    }

    // Checking global limit (8 entries per plugin max across all display screens)
    let globalPluginCount = 0;
    for (const queue of this.queues.values()) {
      globalPluginCount += queue.filter((item) => item.pluginId === pluginId).length;
    }
    if (globalPluginCount >= 8) {
      logWarn("ui", "delivery registration rejected: global capacity limit reached (8/plugin)", { pluginId, key: descriptor.key });
      throw new Error(`Plugin ${pluginId} queue capacity limit (8) reached.`);
    }

    // Checking local display limit (16 entries max per display screen)
    const displayQueue = this.queues.get(targetDisplayKey) || [];
    if (displayQueue.length >= 16) {
      logWarn("ui", "delivery registration rejected: display capacity limit reached (16/display)", { pluginId, key: descriptor.key, displayKey: targetDisplayKey });
      throw new Error(`Display ${targetDisplayKey} queue capacity limit (16) reached.`);
    }

    const newDelivery: QueuedDelivery = {
      pluginId,
      key: descriptor.key,
      courier,
      title: descriptor.title,
      detail: descriptor.detail,
      expiresAt: descriptor.expiresAt,
      addedAt: now,
      displayKey: targetDisplayKey,
      generationId: `${pluginId}-${descriptor.key}-${now}-${Math.random()}`,
    };

    displayQueue.push(newDelivery);
    this.queues.set(targetDisplayKey, displayQueue);

    if (displayQueue.length === 1) {
      this.advanceQueue(targetDisplayKey);
    }
  }

  public registerDismissHandler(pluginId: string, key: string, handler: (reason: DismissReason) => void): void {
    this.dismissCallbacks.set(`${pluginId}:${key}`, handler);
  }

  public dismiss(pluginId: string, key: string, reason: DismissReason, skipCallbacks = false, generationId?: string): void {
    for (const [dk, queue] of this.queues.entries()) {
      const idx = queue.findIndex((item) => item.pluginId === pluginId && item.key === key);
      if (idx !== -1) {
        const item = queue[idx];
        if (generationId && item.generationId !== generationId) {
          continue; // generation mismatch, skip dismissing this successor!
        }

        queue.splice(idx, 1);
        this.finishDismissal(item, reason, skipCallbacks);

        if (idx === 0) {
          this.advanceQueue(dk);
        }

        break;
      }
    }
  }

  private finishDismissal(item: QueuedDelivery, reason: DismissReason, skipCallbacks = false): void {
    const callbackKey = `${item.pluginId}:${item.key}`;
    const callback = this.dismissCallbacks.get(callbackKey);
    this.dismissCallbacks.delete(callbackKey);
    logInfo("ui", "delivery dismissed", { pluginId: item.pluginId, key: item.key, reason, generationId: item.generationId });
    if (callback && !skipCallbacks) {
      try {
        callback(reason);
      } catch (error) {
        logError("ui", "delivery dismiss callback exception", error);
      }
    }
  }

  public teardownPlugin(pluginId: string): void {
    logInfo("ui", "teardown plugin deliveries", { pluginId });

    // Collect all items registered by this plugin
    const toDismiss: { pluginId: string; key: string }[] = [];
    for (const queue of this.queues.values()) {
      for (const item of queue) {
        if (item.pluginId === pluginId) {
          toDismiss.push({ pluginId: item.pluginId, key: item.key });
        }
      }
    }

    // Clean them up WITHOUT invoking their callbacks (plugin host has stopped)
    for (const item of toDismiss) {
      this.dismiss(item.pluginId, item.key, "plugin-stopped", true);
    }
  }

  public cleanupExpired(): void {
    const now = this.options.now();

    for (const [dk, queue] of this.queues.entries()) {
      const expiredItems = queue.filter((item) => item.expiresAt <= now);
      if (expiredItems.length === 0) continue;

      const remainingItems = queue.filter((item) => item.expiresAt > now);
      this.queues.set(dk, remainingItems);
      if (queue[0]?.expiresAt <= now || remainingItems.length === 0) {
        this.advanceQueue(dk);
      }
      for (const item of expiredItems) this.finishDismissal(item, "expired");
    }
  }

  public handleDisplayRemoved(removedDisplayKey: string, survivingDisplays: { bounds: { x: number; y: number; width: number; height: number }; id?: number }[]): void {
    const queue = this.queues.get(removedDisplayKey);
    if (!queue || queue.length === 0) {
      this.queues.delete(removedDisplayKey);
      this.options.destroyWindow(removedDisplayKey);
      return;
    }

    if (survivingDisplays.length === 0) {
      // No display surviving, clear and close
      logInfo("ui", "no surviving displays left; clearing deliveries", { count: queue.length });
      this.queues.delete(removedDisplayKey);
      this.options.destroyWindow(removedDisplayKey);
      for (const item of queue) this.finishDismissal(item, "expired");
      return;
    }

    // Find surviving display with bounds closest to removed display
    const removedBounds = parseDisplayKeyBounds(removedDisplayKey);
    const closestDisplay = findNearestDisplay(removedBounds, survivingDisplays);
    const closestDisplayKey = this.options.getDisplayKey(closestDisplay.bounds);

    logInfo("ui", "migrating deliveries from removed display to nearest display", {
      from: removedDisplayKey,
      to: closestDisplayKey,
      count: queue.length,
    });

    const targetQueue = this.queues.get(closestDisplayKey) || [];
    this.queues.delete(removedDisplayKey);
    this.options.destroyWindow(removedDisplayKey);

    // Ensure display capacity limit: only copy up to what fits
    const copyLimit = Math.max(0, 16 - targetQueue.length);
    const copies = queue.slice(0, copyLimit);

    for (const item of copies) {
      item.displayKey = closestDisplayKey;
      targetQueue.push(item);
    }

    // Any items that overflowed are expired/dismissed
    const overflows = queue.slice(copyLimit);
    for (const item of overflows) this.finishDismissal(item, "expired");

    this.queues.set(closestDisplayKey, targetQueue);
    this.advanceQueue(closestDisplayKey);
  }

  private advanceQueue(displayKey: string): void {
    const queue = this.queues.get(displayKey) || [];
    if (queue.length > 0) {
      this.options.createOrUpdateWindow(displayKey, queue[0]);
    } else {
      this.options.destroyWindow(displayKey);
    }
  }
}

// ---------------------------------------------------------------------------
// Electron Integration Implementation
// ---------------------------------------------------------------------------

let activeWindows = new Map<string, any>();
export const testActiveWindows = activeWindows;

/** Courier windows currently on screen (one per display); used by the dev capture session. */
export function getActiveDeliveryWindows(): BrowserWindow[] {
  return [...activeWindows.values()].filter((window) => window && !window.isDestroyed());
}
const windowGenerations = new WeakMap<any, { generationId: string; pluginId: string; key: string }>();
let activeWindowAnimations = new Map<string, NodeJS.Timeout>();
let expiryInterval: NodeJS.Timeout | null = null;

function stopWindowAnimation(displayKey: string): void {
  const animation = activeWindowAnimations.get(displayKey);
  if (!animation) return;
  clearInterval(animation);
  activeWindowAnimations.delete(displayKey);
}

function getSafeInt(val: any, fallback: number): number {
  if (val === undefined || val === null) return fallback;
  const num = Math.floor(Number(val));
  return Number.isNaN(num) ? fallback : num;
}

export const manager = new AirmailQueueManager({
  now: () => Date.now(),
  getActiveDisplays: () => {
    const electron = getElectron();
    if (!electron) return [];
    return electron.screen.getAllDisplays();
  },
  getCursorDisplayKey: () => {
    const electron = getElectron();
    if (!electron) return "0,0,1920x1080";
    const cursor = electron.screen.getCursorScreenPoint();
    const display = electron.screen.getDisplayNearestPoint(cursor) ?? electron.screen.getPrimaryDisplay();
    return getDisplayKey(display.bounds);
  },
  getDisplayKey: (bounds) => getDisplayKey(bounds),
  createOrUpdateWindow: (displayKey, activeItem) => {
    createOrUpdateAirmailWindow(displayKey, activeItem).catch((err) => {
      logError("ui", "observed unhandled window construction failure", err);
      const item = manager.queues.get(displayKey)?.[0];
      if (item) {
        manager.dismiss(item.pluginId, item.key, "expired", false, activeItem.generationId);
      }
    });
  },
  destroyWindow: (displayKey) => {
    destroyAirmailWindow(displayKey);
  },
});

function startExpiryMonitor() {
  if (expiryInterval) return;
  expiryInterval = setInterval(() => {
    manager.cleanupExpired();
  }, 1000);
  if (expiryInterval.unref) {
    expiryInterval.unref();
  }
}

function stopExpiryMonitor() {
  if (expiryInterval) {
    clearInterval(expiryInterval);
    expiryInterval = null;
  }
}

function getDisplayBoundsFromKey(displayKey: string): { x: number; y: number; width: number; height: number } {
  // Format: "x,y,widthxheight"
  return parseDisplayKeyBounds(displayKey);
}

function parseDisplayKeyBounds(displayKey: string): { x: number; y: number; width: number; height: number } {
  const match = displayKey.match(/^(-?\d+),(-?\d+),(\d+)x(\d+)$/);
  if (match) {
    return {
      x: parseInt(match[1], 10),
      y: parseInt(match[2], 10),
      width: parseInt(match[3], 10),
      height: parseInt(match[4], 10),
    };
  }
  return { x: 0, y: 0, width: 1920, height: 1080 };
}

function findNearestDisplay(
  removedBounds: { x: number; y: number; width: number; height: number },
  surviving: { bounds: { x: number; y: number; width: number; height: number } }[]
) {
  let closest = surviving[0];
  let minDistance = Infinity;
  const rcX = removedBounds.x + removedBounds.width / 2;
  const rcY = removedBounds.y + removedBounds.height / 2;
  for (const s of surviving) {
    const scX = s.bounds.x + s.bounds.width / 2;
    const scY = s.bounds.y + s.bounds.height / 2;
    const dist = Math.hypot(rcX - scX, rcY - scY);
    if (dist < minDistance) {
      minDistance = dist;
      closest = s;
    }
  }
  return closest;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildAirmailHtml(
  spriteUrl: string,
  title: string,
  detail: string,
  layout: CourierSpriteLayout,
  scale = 0.5
): string {
  const escapedTitle = escapeHtml(title);
  const escapedDetail = escapeHtml(detail);

  const csp = "default-src 'none'; img-src openpets-plugin-asset: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'";

  return `<!doctype html>
<html lang="en" data-reaction-state="loading" data-motion-state="idle">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      overflow: hidden;
      user-select: none;
      -webkit-font-smoothing: antialiased;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    body {
      pointer-events: none;
    }
    .stage {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      box-sizing: border-box;
      padding: 8px;
    }
    .airmail-card {
      pointer-events: auto;
      display: flex;
      align-items: center;
      width: 460px;
      height: 130px;
      box-sizing: border-box;
      cursor: pointer;
    }
    .pet-container {
      width: ${layout.frameWidth * scale}px;
      height: ${layout.frameHeight * scale}px;
      position: relative;
      flex-shrink: 0;
    }
    .installed-sprite {
      position: absolute;
      left: 0;
      top: 0;
      width: ${layout.frameWidth}px;
      height: ${layout.frameHeight}px;
      background-image: url("${spriteUrl}");
      background-size: ${layout.frameWidth * layout.frames}px ${layout.frameHeight}px;
      background-repeat: no-repeat;
      --sprite-row-y: 0px;
      --sprite-frames: ${layout.frames};
      --sprite-duration: ${layout.durationMs}ms;
      --sprite-iterations: infinite;
      background-position: 0 var(--sprite-row-y);
      transform: scale(${scale});
      transform-origin: top left;
    }
    html[data-reaction-state="running-left"] .installed-sprite {
      animation: pet-frames var(--sprite-duration) steps(var(--sprite-frames)) var(--sprite-iterations);
    }
    html[data-reaction-state="waiting"] .installed-sprite {
      animation: none;
      background-position: -${layout.frameWidth * (layout.frames - 1)}px var(--sprite-row-y);
    }

    @keyframes pet-frames {
      from { background-position: 0 var(--sprite-row-y); }
      to { background-position: calc(-${layout.frameWidth}px * var(--sprite-frames)) var(--sprite-row-y); }
    }

    .envelope-card {
      flex: 1;
      height: 110px;
      background: repeating-linear-gradient(-45deg,
        #ef4444, #ef4444 8px,
        #ffffff 8px, #ffffff 16px,
        #3b82f6 16px, #3b82f6 24px,
        #ffffff 24px, #ffffff 32px
      );
      padding: 4px;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(15, 23, 42, 0.22);
      box-sizing: border-box;
      display: flex;
    }
    .envelope-body {
      background: #fdfcf7;
      width: 100%;
      height: 100%;
      border-radius: 9px;
      box-sizing: border-box;
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      position: relative;
      overflow: hidden;
      border: 1px solid rgba(0, 0, 0, 0.05);
    }
    .envelope-title {
      font-family: Georgia, Garamond, serif;
      font-size: 14px;
      font-weight: bold;
      color: #1e293b;
      margin: 0 0 4px 0;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
      overflow: hidden;
      padding-right: 32px;
    }
    .envelope-detail {
      font-size: 11.5px;
      line-height: 1.4;
      color: #475569;
      margin: 0;
      word-wrap: break-word;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .postmark {
      position: absolute;
      top: 10px;
      right: 12px;
      width: 38px;
      height: 38px;
      border: 1.5px dashed rgba(239, 68, 68, 0.4);
      border-radius: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: monospace;
      font-size: 6px;
      color: rgba(239, 68, 68, 0.5);
      transform: rotate(12deg);
      pointer-events: none;
      line-height: 1;
    }
    .postmark span {
      font-weight: bold;
    }
  </style>
</head>
<body class="pet-shell">
  <div class="stage">
    <div class="airmail-card pet-hitbox">
      <div class="envelope-card">
        <div class="envelope-body">
          <div class="postmark">
            <span>AIRMAIL</span>
            <div style="font-size: 4px; scale: 0.85;">OPENPETS</div>
          </div>
          <div class="envelope-title">${escapedTitle}</div>
          <div class="envelope-detail">${escapedDetail}</div>
        </div>
      </div>
      <div class="pet-container">
        <div class="installed-sprite"></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function createOrUpdateAirmailWindow(displayKey: string, activeItem: QueuedDelivery): Promise<void> {
  try {
    const electron = getElectron();
    if (!electron) return;

    const { BrowserWindow, ipcMain, app } = electron;
    startExpiryMonitor();

    const bounds = getDisplayBoundsFromKey(displayKey);
    const width = 480;
    const height = 155;

    // Upper portion coordinates (Y = 15% down display)
    const y_pos = Math.round(bounds.y + bounds.height * 0.15);
    const x_start = Math.round(bounds.x - width); // starts offscreen left
    const x_end = Math.round(bounds.x + bounds.width - width - 16); // parked 16px from right display edge

    let window = activeWindows.get(displayKey);

    const { courier } = activeItem;
    const spriteUrl = `openpets-plugin-asset://${encodeURIComponent(courier.pluginId)}/sprites/${encodeURIComponent(courier.assetName)}?v=${encodeURIComponent(courier.version)}`;
    const htmlContent = buildAirmailHtml(spriteUrl, activeItem.title, activeItem.detail, courier.layout);

    const getActiveItem = () => manager.queues.get(displayKey)?.[0];

    if (!window || window.isDestroyed()) {
      // Stop any running animations for this slot
      stopWindowAnimation(displayKey);

      window = new BrowserWindow({
        width,
        height,
        x: x_start,
        y: y_pos,
        frame: false,
        transparent: true,
        resizable: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        show: false,
        hasShadow: false,
        backgroundColor: "#00000000",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          preload: join(app.getAppPath(), "assets", "plugin-delivery-preload.cjs"),
        },
      });

      window.setMenu(null);
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event: any) => event.preventDefault());

      // Show on all workspaces for macOS Spaces compatibility
      if (process.platform === "darwin" && typeof window.setVisibleOnAllWorkspaces === "function") {
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }

      activeWindows.set(displayKey, window);

      // Track active generation on the newly constructed window
      windowGenerations.set(window, {
        generationId: activeItem.generationId,
        pluginId: activeItem.pluginId,
        key: activeItem.key,
      });

      // Click dismissed handler (resolves mutable window generation to handle reused windows)
      const handleClickEvent = (event: any) => {
        if (window.isDestroyed()) return;
        if (event.sender === window.webContents) {
          logDebug("ui", "delivery window click detected, dismissing handle", { displayKey });
          const currentGen = windowGenerations.get(window);
          const item = getActiveItem();
          if (item && currentGen && item.generationId === currentGen.generationId) {
            manager.dismiss(item.pluginId, item.key, "click", false, item.generationId);
          }
        }
      };

      const handleHitTestEvent = (event: any, interactive: boolean) => {
        if (window.isDestroyed()) return;
        if (event.sender === window.webContents) {
          setPassthrough(window, !interactive);
        }
      };

      ipcMain.on("openpets:delivery-clicked", handleClickEvent);
      ipcMain.on("openpets:delivery-hit-test", handleHitTestEvent);

      // Load failure / crash handlers, did-fail-load is strictly bound to the generation that began that load request
      window.webContents.on("did-fail-load", (event: any, errorCode: number, errorDescription: string, validatedURL: string) => {
        logError("ui", "delivery window webContents did-fail-load", { displayKey, validatedURL });
        const hashMatch = validatedURL.match(/#([^#]+)$/);
        const failedGenId = hashMatch ? hashMatch[1] : null;
        if (failedGenId) {
          const item = getActiveItem();
          if (item && item.generationId === failedGenId) {
            manager.dismiss(item.pluginId, item.key, "expired", false, failedGenId);
          }
        }
      });

      window.webContents.on("render-process-gone", (event: any, details: any) => {
        logError("ui", "delivery window renderer crashed", { displayKey, reason: details?.reason });
        const currentGen = windowGenerations.get(window);
        const item = getActiveItem();
        if (item && currentGen && item.generationId === currentGen.generationId) {
          manager.dismiss(item.pluginId, item.key, "expired", false, item.generationId);
        }
      });

      window.once("closed", () => {
        ipcMain.removeListener("openpets:delivery-clicked", handleClickEvent);
        ipcMain.removeListener("openpets:delivery-hit-test", handleHitTestEvent);
        if (activeWindows.get(displayKey) === window) {
          activeWindows.delete(displayKey);
        }
        stopWindowAnimation(displayKey);

        // Native closure: clean active queues safes (uses mutable window generation)
        const currentGen = windowGenerations.get(window);
        const item = getActiveItem();
        if (item && currentGen && item.generationId === currentGen.generationId) {
          manager.dismiss(item.pluginId, item.key, "manual", false, item.generationId);
        }

        if (activeWindows.size === 0) {
          stopExpiryMonitor();
        }
      });

      const targetUrl = `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}#${activeItem.generationId}`;
      await window.loadURL(targetUrl);

      if (window.isDestroyed() || getActiveItem()?.generationId !== activeItem.generationId) return;
      window.setPosition(x_start, y_pos);
      window.showInactive();
      const [visibleXStart, visibleYStart] = window.getPosition();
      logDebug("ui", "delivery flight starts from visible window position", { displayKey, requestedXStart: x_start, requestedYStart: y_pos, visibleXStart, visibleYStart, xEnd: x_end });
      if (!window.webContents.isDestroyed()) {
        window.webContents.send("openpets:pet-reaction-state", "running-left");
      }

      // Probe cursor hit test initially to solve Windows composite latency
      if (process.platform === "win32") {
        requestCursorHitTestProbe(window);
      }

      // Start from the position the window manager actually displayed; some platforms clamp off-screen windows on show.
      const animationDuration = 15_000; // 15 seconds sliding
      const animationStart = Date.now();

      const easeLinear = (t: number) => t;

      const animTimer = setInterval(() => {
        if (window.isDestroyed()) {
          clearInterval(animTimer);
          return;
        }

        const elapsed = Date.now() - animationStart;
        const progress = Math.min(elapsed / animationDuration, 1);
        const t = easeLinear(progress);
        const x = Math.round(visibleXStart + (x_end - visibleXStart) * t);

        window.setPosition(x, visibleYStart);

        if (progress >= 1) {
          clearInterval(animTimer);
          if (activeWindowAnimations.get(displayKey) === animTimer) {
            activeWindowAnimations.delete(displayKey);
          }
          // Set to waiting state when parked
          if (!window.webContents.isDestroyed()) {
            window.webContents.send("openpets:pet-reaction-state", "waiting");
          }
        }
      }, 16);

      activeWindowAnimations.set(displayKey, animTimer);
    } else {
      // Reused window case: Update mutable current generation mapping
      stopWindowAnimation(displayKey);
      windowGenerations.set(window, {
        generationId: activeItem.generationId,
        pluginId: activeItem.pluginId,
        key: activeItem.key,
      });

      // If window already exists, update content in place
      const targetUrl = `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}#${activeItem.generationId}`;
      await window.loadURL(targetUrl);
      if (window.isDestroyed() || getActiveItem()?.generationId !== activeItem.generationId) return;
      // Set straight to parked/waiting if we did an in-place update
      window.setPosition(x_end, y_pos);
      window.webContents.send("openpets:pet-reaction-state", "waiting");
    }
  } catch (err) {
    logError("ui", "failed to construct/load/update airmail window", err);
    // Async load attempt failed: dismiss the generation that began that load!
    const item = manager.queues.get(displayKey)?.[0];
    if (item && item.generationId === activeItem.generationId) {
      manager.dismiss(activeItem.pluginId, activeItem.key, "expired", false, activeItem.generationId);
    }
  }
}

function requestCursorHitTestProbe(window: any) {
  const electron = getElectron();
  if (!electron || window.isDestroyed() || window.webContents.isDestroyed()) return;
  const cursor = electron.screen.getCursorScreenPoint();
  const bounds = window.getContentBounds();
  const clientX = cursor.x - bounds.x;
  const clientY = cursor.y - bounds.y;
  const inside = clientX >= 0 && clientX < bounds.width && clientY >= 0 && clientY < bounds.height;
  if (!inside) return;
  window.webContents.send("openpets:delivery-probe-hit-test", { clientX, clientY });
}

function setPassthrough(window: any, passthrough: boolean): void {
  if (window.isDestroyed()) return;
  if (process.platform === "linux") {
    // Keep Linux delivery window interactive to ensure mouse events work on Linux compositors
    window.setIgnoreMouseEvents(false);
    return;
  }
  const canForwardMouseEvents = process.platform === "darwin" || process.platform === "win32";
  if (passthrough && canForwardMouseEvents) {
    window.setIgnoreMouseEvents(true, { forward: true });
  } else if (passthrough) {
    window.setIgnoreMouseEvents(true);
  } else {
    window.setIgnoreMouseEvents(false);
  }
}

function destroyAirmailWindow(displayKey: string): void {
  // Clear any active sliding flight animation timer first
  if (activeWindowAnimations.has(displayKey)) {
    clearInterval(activeWindowAnimations.get(displayKey)!);
    activeWindowAnimations.delete(displayKey);
  }

  const window = activeWindows.get(displayKey);
  if (window) {
    activeWindows.delete(displayKey);
    // Lazy window destroy wrap in setTimeout to handles load-vs-dismiss races & transition safety
    setTimeout(() => {
      if (!window.isDestroyed()) {
        window.destroy();
      }
      if (activeWindows.size === 0) {
        stopExpiryMonitor();
      }
    }, 100);
  }
}

let isScreenListenerRegistered = false;
let displayRemovedHandler: any = null;

export function startDeliverySystem(): void {
  const electron = getElectron();
  if (electron && electron.screen && !isScreenListenerRegistered) {
    displayRemovedHandler = (event: any, oldDisplay: any) => {
      const oldKey = getDisplayKey(oldDisplay.bounds);
      const surviving = electron.screen.getAllDisplays();
      manager.handleDisplayRemoved(oldKey, surviving);
    };
    electron.screen.on("display-removed", displayRemovedHandler);
    isScreenListenerRegistered = true;
  }
}

export function stopDeliverySystem(): void {
  const electron = getElectron();
  if (electron && electron.screen && isScreenListenerRegistered && displayRemovedHandler) {
    electron.screen.off("display-removed", displayRemovedHandler);
    displayRemovedHandler = null;
    isScreenListenerRegistered = false;
  }
  stopExpiryMonitor();
  for (const displayKey of [...activeWindows.keys()]) {
    destroyAirmailWindow(displayKey);
  }
}

// ---------------------------------------------------------------------------
// narrow host API wiring exported for plugin-host-capabilities
// ---------------------------------------------------------------------------

export async function registerDelivery(
  courier: QueuedDelivery["courier"],
  descriptor: DeliveryDescriptor
): Promise<DeliveryHandle> {
  startDeliverySystem();
  manager.register(courier.pluginId, descriptor, courier);

  return {
    dismiss: () => {
      manager.dismiss(courier.pluginId, descriptor.key, "manual");
    },
    onDismiss: (handler) => {
      manager.registerDismissHandler(courier.pluginId, descriptor.key, handler);
    },
  };
}

export function teardownPluginDeliveries(pluginId: string): void {
  manager.teardownPlugin(pluginId);
}

// Hook desktop lifecycle will-quit event to cleanly trigger stopDeliverySystem on shutdown
const mainElectron = getElectron();
if (mainElectron && mainElectron.app) {
  mainElectron.app.on("will-quit", () => {
    stopDeliverySystem();
  });
}
