/**
 * Experimental native Wayland `wlr-layer-shell` backend (Linux only).
 *
 * Electron/Chromium's Ozone does not implement `wlr-layer-shell`, so a real
 * layer-shell overlay surface cannot be created from inside Electron. Instead a
 * small native helper process (`openpets-wayland-helper`, a Rust binary built
 * from `apps/desktop/native/openpets-wayland-helper`) owns the layer-shell
 * surface and this module streams rendered frames to it.
 *
 * The pet itself is still rendered by the normal OpenPets renderer: a hidden
 * offscreen `BrowserWindow` keeps running the exact same HTML/CSS pet page,
 * and every composited frame is forwarded to the helper over a Unix socket.
 * The `BrowserWindow`'s display-facing methods (`show`/`hide`/`setPosition`/
 * `getPosition`/...) are patched on the instance so the existing pet
 * controllers keep working unchanged while the visible carrier is a
 * layer-shell overlay instead of an XDG toplevel.
 *
 * This backend is opt-in (`OPENPETS_NATIVE_WAYLAND=1`); when it cannot start
 * the caller falls back to the normal window path.
 */

import { app, BrowserWindow, type NativeImage } from "electron";
import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as net from "node:net";

import { debug, error as logError, info } from "./logger.js";
import type { Point } from "./display.js";
import {
  createWaylandMessageDecoder,
  cropTransparentFrame,
  encodeFrame,
  encodeHide,
  encodeMove,
  encodeQuit,
  encodeShow,
  mapPointerButton,
  mapPointerCoordinates,
} from "./wayland-layer-protocol.js";

const MAX_QUEUED_MESSAGES = 512;
const MAX_CONNECT_ATTEMPTS = 40;
const CONNECT_RETRY_MS = 50;
/** Poll interval for `capturePage` frame streaming (~30 fps). */
const FRAME_POLL_MS = 33;
/** How long to wait for `beginFrameSubscription` before falling back to polling. */
const FRAME_PROBE_MS = 1200;

/**
 * Resolve the native helper binary path.
 *
 * Priority: `OPENPETS_WAYLAND_HELPER` env override → dev build path → packaged
 * resources path. Returns `null` when no usable binary exists (caller falls
 * back to the normal window path).
 */
export function resolveHelperBinaryPath(): string | null {
  const envPath = process.env.OPENPETS_WAYLAND_HELPER;
  if (envPath) {
    return existsSync(envPath) ? envPath : null;
  }
  const candidates = [
    // Dev: the crate's release binary inside the repo.
    join(app.getAppPath(), "native", "openpets-wayland-helper", "target", "release", "openpets-wayland-helper"),
    // Packaged: shipped as an extra resource next to the app bundle.
    join(process.resourcesPath ?? "", "openpets-wayland-helper"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Synchronous availability check used before creating an offscreen window. */
export function isLayerShellHelperAvailable(): boolean {
  return resolveHelperBinaryPath() !== null;
}

// --- Surface controller ---

/**
 * Owns one helper process + socket and the frame pipeline for one pet surface.
 */
class LayerShellSurface {
  readonly width: number;
  readonly height: number;
  private frameOffset = { x: 0, y: 0 };

  /**
   * Fatal backend failure (helper cannot start / keeps dying). When set, the
   * owner should tear down the offscreen pet and rebuild it as a normal
   * window so the pet stays visible even when layer-shell is unavailable.
   */
  onFatal: (() => void) | null = null;
  private restartCount = 0;
  private startupTimer: NodeJS.Timeout | null = null;
  private stabilityTimer: NodeJS.Timeout | null = null;
  private static readonly MAX_RESTARTS = 2;
  private static readonly STARTUP_TIMEOUT_MS = 10_000;
  private static readonly STABLE_RUNTIME_MS = 30_000;

  private readonly socketPath: string;
  private readonly helperPath: string;
  private helper: ReturnType<typeof import("node:child_process").spawn> | null = null;
  private socket: net.Socket | null = null;
  private connected = false;
  private ready = false;
  private destroyed = false;
  /** Invalidates delayed socket retries from an exited/replaced helper. */
  private connectionGeneration = 0;
  private position: Point;
  private visible = true;
  /** Commands queued while the socket is still connecting. */
  private pending: Buffer[] = [];
  private readonly messageDecoder = createWaylandMessageDecoder();
  private window: BrowserWindow | null = null;

  constructor(options: { helperPath: string; socketPath: string; width: number; height: number; position: Point }) {
    this.helperPath = options.helperPath;
    this.socketPath = options.socketPath;
    this.width = options.width;
    this.height = options.height;
    this.position = { x: options.position.x, y: options.position.y };
  }

  /** Spawn the helper and open the socket. Must be called once. */
  start(): void {
    this.restartCount = 0;
    const child = spawnHelper(this.helperPath, this.socketPath, this.width, this.height, this.position);
    if (!child) {
      throw new Error(`failed to spawn ${this.helperPath}`);
    }
    this.helper = child;
    child.on("exit", () => this.restart());

    // The helper binds its socket shortly after launch; retry the connect so
    // we never lose the race against a fresh process.
    const generation = ++this.connectionGeneration;
    this.connectWithRetry(0, generation);
    this.armStartupTimer();
  }

  /**
   * The helper process exited (crash, lock screen, session teardown) — spawn
   * a fresh one and re-establish the surface so the pet does not vanish until
   * the whole app is restarted. If it keeps dying (e.g. the compositor does
   * not actually provide wlr-layer-shell), give up and ask the owner to fall
   * back to a normal window instead of restarting forever.
   */
  private restart(): void {
    if (this.destroyed) return;
    this.clearStabilityTimer();
    this.restartCount += 1;
    if (this.restartCount > LayerShellSurface.MAX_RESTARTS) {
      logError("pet.wayland", "helper kept failing; giving up on layer-shell", {
        socketPath: this.socketPath,
        restartCount: this.restartCount,
      });
      this.fatal();
      return;
    }
    info("pet.wayland", "helper exited; restarting layer-shell surface", { socketPath: this.socketPath, restartCount: this.restartCount });
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // already closed
      }
      this.socket = null;
    }
    this.connected = false;
    this.ready = false;
    this.pending = [];
    this.messageDecoder.reset();
    // A killed helper can leave a stale socket file behind; the new helper's
    // `bind` would fail on it, so remove it first.
    try {
      if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
    } catch {
      // ignore
    }
    const child = spawnHelper(this.helperPath, this.socketPath, this.width, this.height, this.position);
    if (!child) {
      logError("pet.wayland", "helper restart failed", { socketPath: this.socketPath });
      this.fatal();
      return;
    }
    this.helper = child;
    child.on("exit", () => this.restart());
    const generation = ++this.connectionGeneration;
    this.connectWithRetry(0, generation);
    if (!this.visible) this.write(encodeHide());
    this.armStartupTimer();
  }

  /** Start a timer that gives up if the helper never reports READY. */
  private armStartupTimer(): void {
    this.clearStartupTimer();
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      debug("pet.wayland", "helper did not become ready in time", { socketPath: this.socketPath });
      this.fatal();
    }, LayerShellSurface.STARTUP_TIMEOUT_MS);
  }

  private clearStartupTimer(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  /** A READY helper must stay alive for a while before failures are forgiven. */
  private armStabilityTimer(): void {
    this.clearStabilityTimer();
    this.stabilityTimer = setTimeout(() => {
      this.stabilityTimer = null;
      this.restartCount = 0;
      debug("pet.wayland", "helper runtime considered stable", { socketPath: this.socketPath });
    }, LayerShellSurface.STABLE_RUNTIME_MS);
  }

  private clearStabilityTimer(): void {
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
  }

  /**
   * Permanently stop the layer-shell backend and notify the owner so it can
   * rebuild the pet as a normal window.
   */
  private fatal(): void {
    if (this.destroyed) return;
    this.destroyed = true; // stops the restart loop and any further teardown
    this.connectionGeneration += 1; // invalidates delayed connect retries
    this.clearStartupTimer();
    this.clearStabilityTimer();
    this.stopFrameStreaming();
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // already closed
      }
      this.socket = null;
    }
    if (this.helper && !this.helper.killed) {
      try {
        this.helper.kill();
      } catch {
        // already gone
      }
      this.helper = null;
    }
    try {
      if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
    } catch {
      // ignore stale socket cleanup failure
    }
    logError("pet.wayland", "layer-shell backend fatal; falling back", { socketPath: this.socketPath });
    this.onFatal?.();
  }

  private connectWithRetry(attempt: number, generation: number): void {
    if (this.destroyed || generation !== this.connectionGeneration) return;
    const socket = net.connect(this.socketPath);
    this.socket = socket;
    socket.setNoDelay(true);

    socket.on("connect", () => {
      if (this.destroyed || generation !== this.connectionGeneration) {
        socket.destroy();
        return;
      }
      this.connected = true;
      debug("pet.wayland", "helper socket connected", { socketPath: this.socketPath, attempt });
      this.flushPending();
    });
    socket.on("data", (chunk: Buffer) => {
      if (!this.destroyed && generation === this.connectionGeneration) this.handleIncoming(chunk);
    });
    socket.on("error", (error) => {
      if (this.destroyed || generation !== this.connectionGeneration) {
        socket.destroy();
        return;
      }
      const refused = (error as NodeJS.ErrnoException).code === "ECONNREFUSED" || (error as NodeJS.ErrnoException).code === "ENOENT";
      if (refused && attempt < MAX_CONNECT_ATTEMPTS && !this.destroyed && generation === this.connectionGeneration) {
        // Not bound yet — tear down and try again shortly. The generation
        // check prevents retries from an exited helper racing a replacement.
        socket.destroy();
        if (this.socket === socket) this.socket = null;
        setTimeout(() => this.connectWithRetry(attempt + 1, generation), CONNECT_RETRY_MS);
        return;
      }
      logError("pet.wayland", "helper socket error", { socketPath: this.socketPath, error: error.message, attempt });
      socket.destroy();
      if (this.socket === socket) this.socket = null;
    });
    socket.on("close", () => {
      if (this.socket === socket) {
        this.connected = false;
        debug("pet.wayland", "helper socket closed", { socketPath: this.socketPath });
      }
    });
  }

  private write(msg: Buffer): void {
    if (this.destroyed) return;
    if (!this.connected) {
      if (this.pending.length < MAX_QUEUED_MESSAGES) this.pending.push(msg);
      return;
    }
    this.socket?.write(msg);
  }

  private flushPending(): void {
    if (!this.connected) return;
    for (const msg of this.pending) this.socket?.write(msg);
    this.pending = [];
  }

  private handleIncoming(chunk: Buffer): void {
    const result = this.messageDecoder.push(chunk);
    for (const issue of result.diagnostics) {
      if (issue.severity === "fatal") {
        logError("pet.wayland", "helper protocol fatal", { message: issue.message });
      } else {
        debug("pet.wayland", "helper protocol diagnostic", { message: issue.message });
      }
    }
    if (result.fatal) {
      this.fatal();
      return;
    }
    for (const message of result.messages) {
      if (message.type === "ready") {
        if (this.ready) continue;
        this.ready = true;
        this.clearStartupTimer();
        this.armStabilityTimer();
        info("pet.wayland", "helper surface ready (layer-shell configured)");
        this.attachFrameStreaming();
      } else if (message.type === "pointer") {
        this.handlePointer(message.kind, message.x, message.y, message.button);
      } else {
        this.handlePositionUpdate(message.x, message.y);
      }
    }
  }

  /**
   * Replay a compositor pointer event into the offscreen renderer so the
   * existing pet click/drag/hover handlers fire unchanged. Coordinates from
   * the helper are surface-local; screen coordinates are derived from the
   * surface's tracked position.
   */
  private handlePointer(kind: "move" | "press" | "release" | "enter" | "leave", x: number, y: number, button: number): void {
    if (!this.window || this.window.isDestroyed() || this.window.webContents.isDestroyed()) {
      return;
    }
    if (kind === "enter") return;
    if (kind === "leave") {
      // Pointer left the pet surface. The inline context menu (if open) must
      // close: clicks outside the surface (desktop / other windows) never
      // reach the offscreen renderer, and layer-shell has no keyboard focus
      // (Escape can't arrive), so this Leave is the only reliable signal.
      try {
        this.window.webContents.send("openpets:pet-menu-close");
      } catch {
        // webContents may be mid-teardown
      }
      return;
    }
    // The helper moves the surface itself while dragging (absolute anchor, so
    // it tracks the cursor precisely); here we just pause frame polling so
    // pointer-motion messages stay responsive and resume on release.
    const mappedButton = mapPointerButton(button);
    if (kind === "press" && mappedButton.isPrimary && !this.leftButtonDown) {
      this.leftButtonDown = true;
      this.pauseFrameStreaming();
    } else if (kind === "release" && mappedButton.isPrimary && this.leftButtonDown) {
      this.leftButtonDown = false;
      this.resumeFrameStreaming();
    }
    const coordinates = mapPointerCoordinates(x, y, this.frameOffset, this.position);
    try {
      if (kind === "move") {
        this.window.webContents.sendInputEvent({ type: "mouseMove", x: coordinates.logicalX, y: coordinates.logicalY, globalX: coordinates.globalX, globalY: coordinates.globalY } as Electron.MouseInputEvent);
      } else if (kind === "press") {
        this.window.webContents.sendInputEvent({ type: "mouseDown", x: coordinates.logicalX, y: coordinates.logicalY, globalX: coordinates.globalX, globalY: coordinates.globalY, button: mappedButton.button, clickCount: 1 } as Electron.MouseInputEvent);
      } else if (kind === "release") {
        this.window.webContents.sendInputEvent({ type: "mouseUp", x: coordinates.logicalX, y: coordinates.logicalY, globalX: coordinates.globalX, globalY: coordinates.globalY, button: mappedButton.button, clickCount: 1 } as Electron.MouseInputEvent);
      }
    } catch (error) {
      debug("pet.wayland", "sendInputEvent failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * The helper moved the surface during a drag. Sync our tracked position so
   * `getPosition()` (and therefore position persistence and the motion-state
   * publisher) stays correct, and emit a synthetic `move` so the run-left/
   * run-right animation triggers.
   */
  private handlePositionUpdate(x: number, y: number): void {
    if (this.destroyed) return;
    if (this.position.x === x && this.position.y === y) return;
    this.position = { x, y };
    if (this.window && !this.window.isDestroyed()) {
      try {
        this.window.emit("move");
      } catch {
        // synthetic move is best-effort (drives drag animation only)
      }
    }
  }

  private frameTimer: NodeJS.Timeout | null = null;
  private frameSendFn: ((image: NativeImage) => void) | null = null;
  /** Left button held (drag in progress) → pause frame polling to keep motion snappy. */
  private leftButtonDown = false;

  /**
   * Stream frames from the offscreen renderer. Prefers the event-driven
   * `beginFrameSubscription` (only fires when content changes → smooth, low
   * overhead); falls back to `capturePage` polling when the subscription does
   * not produce frames (it can silently idle for windows never shown on
   * screen on some compositors).
   */
  private attachFrameStreaming(): void {
    if (!this.window || this.window.isDestroyed() || this.window.webContents.isDestroyed()) {
      debug("pet.wayland", "frame streaming skipped (window not ready)", {});
      return;
    }
    // A re-attach (helper restart) must stop any previous polling timer first,
    // otherwise old captures and a fresh subscription would double-send frames.
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
    debug("pet.wayland", "frame streaming attached", { windowId: this.window.id });
    let lastBitmap: Buffer | null = null;
    let usingSubscription = false;
    let framesSent = 0;
    let framesSkipped = 0;
    const sendFrame = (image: NativeImage): void => {
      const frame = cropTransparentFrame(image.toBitmap(), image.getSize());
      if (!frame) return;
      const bitmap = frame.bitmap;
      // Skip frames identical to the previous one (static content) to keep
      // the socket quiet and the helper from re-committing unchanged frames.
      if (lastBitmap && bitmap.length === lastBitmap.length && bitmap.equals(lastBitmap)) {
        framesSkipped += 1;
        if (framesSkipped % 300 === 0) {
          debug("pet.wayland", "frame dedup", { framesSent, framesSkipped });
        }
        return;
      }
      lastBitmap = bitmap;
      framesSent += 1;
      if (framesSent % 60 === 0) {
        debug("pet.wayland", "frame sent", { framesSent, framesSkipped });
      }
      let encodedFrame: Buffer;
      try {
        encodedFrame = encodeFrame(frame);
      } catch (error) {
        debug("pet.wayland", "frame encoding failed; dropping frame", {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      this.frameOffset = { x: frame.offsetX, y: frame.offsetY };
      this.write(encodedFrame);
    };
    this.frameSendFn = sendFrame;

    // If the subscription yields nothing within the probe window, fall back.
    const probeTimer = setTimeout(() => {
      if (!usingSubscription) this.attachFrameStreamingFallback();
    }, FRAME_PROBE_MS);

    try {
      this.window.webContents.beginFrameSubscription(false, (image: NativeImage) => {
        usingSubscription = true;
        clearTimeout(probeTimer);
        sendFrame(image);
      });
    } catch (error) {
      clearTimeout(probeTimer);
      debug("pet.wayland", "beginFrameSubscription failed; using capturePage polling", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.attachFrameStreamingFallback();
    }
  }

  /** Poll `capturePage` at the animation frame rate (fallback path). */
  private attachFrameStreamingFallback(): void {
    if (this.frameTimer || !this.frameSendFn) return;
    debug("pet.wayland", "frame streaming fallback: capturePage polling", {});
    this.frameTimer = setInterval(() => {
      if (!this.window || this.window.isDestroyed() || this.window.webContents.isDestroyed()) {
        this.stopFrameStreaming();
        return;
      }
      void this.window.webContents.capturePage().then(this.frameSendFn!).catch(() => {
        // Transient capture failures are harmless; try again next tick.
      });
    }, FRAME_POLL_MS);
    this.frameTimer.unref?.();
  }

  /**
   * Pause polling-based frame streaming while the pet is being dragged so the
   * main process stays free to service pointer-motion messages (a slow
   * `capturePage` can otherwise starve drag handling and make it stutter).
   */
  private pauseFrameStreaming(): void {
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
  }

  private resumeFrameStreaming(): void {
    this.attachFrameStreamingFallback();
  }

  /** Stop polling frames (called on destroy). */
  private stopFrameStreaming(): void {
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
  }

  // --- Controller-facing surface operations (called by patched window methods) ---

  show(): void {
    if (!this.visible) {
      this.visible = true;
      this.write(encodeShow());
    }
  }

  hide(): void {
    if (this.visible) {
      this.visible = false;
      this.write(encodeHide());
    }
  }

  move(x: number, y: number): void {
    if (this.position.x === x && this.position.y === y) return;
    this.position = { x, y };
    this.write(encodeMove(x, y));
  }

  isVisible(): boolean {
    return this.visible;
  }

  getPosition(): Point {
    return { x: this.position.x, y: this.position.y };
  }

  /** Attach a window to stream frames from (call once the offscreen window exists). */
  attachWindow(window: BrowserWindow): void {
    this.window = window;
    if (this.ready) this.attachFrameStreaming();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.connectionGeneration += 1;
    this.clearStartupTimer();
    this.clearStabilityTimer();
    this.stopFrameStreaming();
    if (this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      try {
        this.window.webContents.endFrameSubscription();
      } catch {
        // webContents may already be torn down
      }
    }
    if (this.socket) {
      try {
        if (this.connected) this.socket.write(encodeQuit());
      } catch {
        // ignore
      }
      this.socket.destroy();
      this.socket = null;
    }
    if (this.helper && !this.helper.killed) {
      this.helper.kill();
      this.helper = null;
    }
    try {
      // Unix sockets are removed automatically when the last reference closes,
      // but remove explicitly to be safe on abrupt teardown.
      if (existsSync(this.socketPath)) {
        unlinkSync(this.socketPath);
      }
    } catch {
      // ignore
    }
  }
}

// --- Helper process management ---

function spawnHelper(
  helperPath: string,
  socketPath: string,
  width: number,
  height: number,
  position: Point,
): ReturnType<typeof import("node:child_process").spawn> | null {
  const args = ["--socket", socketPath, "--width", String(width), "--height", String(height), "--x", String(position.x), "--y", String(position.y)];
  try {
    const child = spawn(helperPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: process.env,
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (line.trim()) debug("pet.wayland", "helper stderr", { line: line.trim() });
      }
    });
    child.on("error", (error) => {
      logError("pet.wayland", "helper process error", { error: error.message });
    });
    child.on("exit", (code, signal) => {
      info("pet.wayland", "helper process exited", { code, signal });
    });
    return child;
  } catch (error) {
    logError("pet.wayland", "failed to spawn helper", error instanceof Error ? error : { error });
    return null;
  }
}

// --- Window adoption ---

/**
 * Patch a pet `BrowserWindow` so its display-facing methods route to a
 * layer-shell surface, and stream the window's offscreen frames to the helper.
 *
 * The returned window is the same object with instance methods overridden; the
 * existing pet controllers keep working unchanged. Throws when the helper
 * cannot be started (caller should fall back to a normal window).
 */
export function adoptPetWindowForLayerShell(window: BrowserWindow, position: Point): LayerShellSurface {
  const helperPath = resolveHelperBinaryPath();
  if (!helperPath) {
    throw new Error("openpets-wayland-helper binary not found");
  }

  const socketPath = join(resolveRuntimeDir(), `openpets-wayland-${process.pid}-${Date.now()}.sock`);
  const surface = new LayerShellSurface({
    helperPath,
    socketPath,
    width: window.getContentSize()[0],
    height: window.getContentSize()[1],
    position,
  });
  surface.start();
  surface.attachWindow(window);

  // Override display-facing methods on the instance so controllers never touch
  // the real (hidden/offscreen) window. This is deliberately narrow: content
  // loading, webContents messaging and lifecycle events keep using the real
  // window underneath.
  patchWindowSurface(window, surface);

  debug("pet.wayland", "layer-shell surface adopted", {
    windowId: window.id,
    position,
    size: [surface.width, surface.height],
    socketPath,
  });
  return surface;
}

function resolveRuntimeDir(): string {
  if (process.env.XDG_RUNTIME_DIR) return process.env.XDG_RUNTIME_DIR;
  return tmpdir();
}

function patchWindowSurface(window: BrowserWindow, surface: LayerShellSurface): void {
  // Capture the original destroy so we can also tear down the helper.
  const originalDestroy = window.destroy.bind(window);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;

  w.show = () => surface.show();
  w.showInactive = () => surface.show();
  w.hide = () => surface.hide();
  w.isVisible = () => surface.isVisible();
  w.isMinimized = () => false;
  w.restore = () => {};
  w.setPosition = (x: number, y: number) => surface.move(x, y);
  w.getPosition = () => {
    const p = surface.getPosition();
    return [p.x, p.y];
  };
  w.setBounds = (bounds: Electron.Rectangle) => surface.move(bounds.x, bounds.y);
  w.getBounds = () => {
    const p = surface.getPosition();
    return { x: p.x, y: p.y, width: surface.width, height: surface.height };
  };
  w.getContentBounds = () => {
    const p = surface.getPosition();
    return { x: p.x, y: p.y, width: surface.width, height: surface.height };
  };
  w.setContentSize = () => {};
  w.setIgnoreMouseEvents = () => {};
  w.setAlwaysOnTop = () => {};
  w.setVisibleOnAllWorkspaces = () => {};
  w.setFocusable = () => {};
  w.destroy = () => {
    surface.destroy();
    originalDestroy();
  };
}
