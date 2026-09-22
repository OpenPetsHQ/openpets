import { app, BrowserWindow, screen } from "electron";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { getAppStateSnapshot, type HudScaleValue, type PetScaleValue } from "./app-state.js";
import { clampToNearestDisplayIfOffscreen, clampToVisibleWorkArea, defaultPetWindowSize, getDefaultPetInitialPosition, isCrossDisplayRoamingEnabled, type Point } from "./display.js";
import { builtInPet } from "./built-in-pet.js";
import { t } from "./i18n/index.js";
import { debug, error as logError, info, warn } from "./logger.js";
import { defaultPetSprite, type PetMotionState, type UniversalSpriteState } from "./reaction-animation-mapping.js";
import { computeEffectiveWaylandBackend, isLayerShellBackendRequested, shouldPetWindowBeFocusable } from "./wayland-backend.js";
import { adoptPetWindowForLayerShell, isLayerShellHelperAvailable } from "./wayland-layer-backend.js";
import { isLatestPetRenderSequence } from "./pet-render-lifecycle.js";
import { calculatePetInteractiveShape } from "./pet-window-shape.js";
import { toCollapsedPosition } from "./default-pet-chat-geometry.js";
import { getActiveChatPanelHeight, isDefaultPetCarrierExpanded, isDefaultPetChatCompactOpen } from "./default-pet-chat.js";

import type { AgentPetWindowOptions, DefaultPetWindowOptions, PetContentRender, PetPluginBubbles, PetShowMediaOptions, PetStatusBadgeReaction, PetTransientDisplay, PetWindowAudioPayload, PetWindowInteractionHooks, PetWindowSpeechCompletion } from "./pet-window-types.js";
import { createBubbleMarkup, createBuiltInPetRender, createDefaultPetRenderContent, createInstalledPetRender } from "./pet-window-render.js";
import { registerPetGazeWindow, resetPetGazeWindow, setPetGazeDragging, setPetGazeMotionState, setPetGazePluginOverride, setPetGazeReactionState, setPetGazeRendererReady, suspendPetGazeForMovement, updatePetGazeConfiguration } from "./pet-window-gaze.js";
import { installPetContextMenu } from "./pet-window-context-menu.js";
import { installPetWindowInteraction } from "./pet-window-interaction.js";

export type { AgentPetWindowOptions, DefaultPetWindowOptions, PetContentRender, PetPluginBubbles, PetShowMediaOptions, PetStatusBadgeReaction, PetTransientDisplay, PetWindowAudioPayload, PetWindowInteractionHooks, PetWindowSpeechCompletion } from "./pet-window-types.js";
export { createPetBodyMarkup, pluginBubblesCacheKey } from "./pet-window-render.js";
export { refreshPetGazePreference } from "./pet-window-gaze.js";
export { buildPetContextMenuTemplate, handlePetScaleChange } from "./pet-window-context-menu.js";
export { clearTransientReaction, getTransientDisplayDurationMs, getTransientReactionAnimationMs, mergePetTransientDisplay, preparePetTransientDisplay } from "./pet-transient-policy.js";

const petWindowRenderCache = new WeakMap<BrowserWindow, string>();

const windowLoadChains = new WeakMap<BrowserWindow, Promise<void>>();
const windowLoadSequences = new WeakMap<BrowserWindow, number>();
const petWindowFocusPolicy = new WeakMap<BrowserWindow, boolean>();
export { isPetWindowDragging, recoverPetMouseInterop, subscribePetWindowSpeechCompletion } from "./pet-window-interaction.js";

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
  installPetWindowInteraction(window, {
    useWaylandNativeDrag: shouldUseWaylandNativePetDrag(),
    readWindowPosition,
  }, options);
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
  installPetWindowInteraction(window, {
    useWaylandNativeDrag: shouldUseWaylandNativePetDrag(),
    readWindowPosition,
  }, options);
  installMotionStatePublisher(window);
  installPetContextMenu(window, { label: t("pet.menu.closePet"), click: options.onCloseRequested, focusSessionWindow: options.onFocusSessionWindow, petId: options.petId }, shouldUseLayerShellBackend);
  void loadExplicitPetContent(window, options.petId, options.display, options.badge, dismissToken, options.scale);
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
      preload: join(app.getAppPath(), "dist", "pet-preload.cjs"),
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
  applyPetWindowFocusPolicy(window, petPluginBubblesHaveInteractiveInput(pluginBubbles) || isDefaultPetCarrierExpanded() || isDefaultPetChatCompactOpen());
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

  const isExpanded = isDefaultPetCarrierExpanded();
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
  const expanded = isDefaultPetCarrierExpanded();
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
