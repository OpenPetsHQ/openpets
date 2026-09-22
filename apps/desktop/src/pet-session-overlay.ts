import { ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

import { getDefaultPetWindowForPlugins } from "./default-pet-controller.js";
import { getPluginPlatformSettings, isInQuietHours } from "./plugin-platform-settings.js";
import { maxUserSoundBytes, userSoundMimeByExtension } from "./plugin-user-sound-store.js";
import {
  closeDefaultPetSession,
  isDefaultPetSessionOpen,
  openDefaultPetSession,
  setDefaultPetSessionMeasuredHeight,
  subscribeDefaultPetPanelState,
} from "./default-pet-chat.js";
import {
  sessionBreathingCardEstimatedHeight,
  sessionGroundingCardEstimatedHeight,
  sessionGuidedBreathingCardEstimatedHeight,
  sessionPmrCardEstimatedHeight,
} from "./default-pet-chat-geometry.js";
import { t } from "./i18n/index.js";
import { debug, info, warn } from "./logger.js";
import { closeSessionInfoWindow, refreshSessionInfoWindowIfOpen, showSessionInfoWindow } from "./pet-session-info-window.js";
import { sessionIconPaths } from "./session-icons.js";
import type {
  PluginSessionDescriptor,
  PluginSessionEvent,
  PluginSessionUpdate,
  SessionStopReason,
} from "./plugin-session-descriptor.js";

/**
 * Host-localized strings for the overlay chrome (buttons, tiles, footers).
 * Built at send time so a locale change is picked up on the next render.
 */
export function buildSessionChrome(): Record<string, string> {
  return {
    inhale: t("session.inhale"),
    hold: t("session.hold"),
    exhale: t("session.exhale"),
    inhaleGuidance: t("session.inhaleGuidance"),
    holdGuidance: t("session.holdGuidance"),
    exhaleGuidance: t("session.exhaleGuidance"),
    paused: t("session.paused"),
    pausedGuidance: t("session.pausedGuidance"),
    complete: t("session.complete"),
    completeGuidance: t("session.completeGuidance"),
    idleGuidance: t("session.idleGuidance"),
    pause: t("session.pause"),
    resume: t("session.resume"),
    start: t("session.start"),
    done: t("session.done"),
    restart: t("session.restart"),
    again: t("session.again"),
    remaining: t("session.remaining"),
    elapsed: t("session.elapsed"),
    breathPace: t("session.breathPace"),
    cyclesCount: t("session.cyclesCount"),
    cycleN: t("session.cycleN"),
    untilStopped: t("session.untilStopped"),
    footerBreathing: t("session.footerBreathing"),
    footerComplete: t("session.footerComplete"),
    footerReady: t("session.footerReady"),
    close: t("session.close"),
    about: t("session.about"),
    mute: t("session.mute"),
    unmute: t("session.unmute"),
    getReady: t("session.getReady"),
    getReadyGuidance: t("session.getReadyGuidance"),
    startNow: t("session.startNow"),
    references: t("session.references"),
    readStudy: t("session.readStudy"),
    openStudy: t("session.openStudy"),
    currentChoice: t("session.currentChoice"),
    next: t("session.next"),
    back: t("session.back"),
    finish: t("session.finish"),
    noticed: t("session.noticed"),
    footerGrounding: t("session.footerGrounding"),
    switchPractice: t("session.switchPractice"),
    tense: t("session.tense"),
    release: t("session.release"),
    groupProgress: t("session.groupProgress"),
    footerRelaxing: t("session.footerRelaxing"),
  };
}

/**
 * Practice session overlay coordinator.
 *
 * Owns the single active `ui:session` surface: which plugin holds it, the
 * validated descriptor the pet-window preload renders, and the event relay
 * from overlay controls back to the owning plugin. The pet window's preload
 * owns the 60fps orb animation and the phase clock; this module owns the
 * lifecycle (open, replace, displacement by another carrier surface, close).
 */

export interface SessionOverlayCallbacks {
  readonly onEvent: (event: PluginSessionEvent) => void;
  /** Fired exactly once when the overlay surface goes away, whatever the cause. */
  readonly onClosed?: (reason: SessionStopReason) => void;
}

export interface SessionOverlayHostHandle {
  update(patch: PluginSessionUpdate): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  close(): Promise<void>;
}

interface ActiveSessionOverlay {
  readonly pluginId: string;
  descriptor: PluginSessionDescriptor;
  readonly callbacks: SessionOverlayCallbacks;
  /** Last run progress reported by the renderer, for synthesized stop events. */
  lastPatternId: string;
  lastCycle: number;
  runActive: boolean;
  /** Live cue state; starts from the descriptor and follows overlay toggles. */
  audioEnabled: boolean;
  closed: boolean;
}

let activeSession: ActiveSessionOverlay | null = null;
let handlersInstalled = false;
let unsubscribePanelState: (() => void) | null = null;

const sessionOverlayChannel = "openpets:session-overlay";
/** Bounds on a renderer-reported carrier height (card + orb); the work area clamps further. */
const minSessionContentHeight = 240;
const maxSessionContentHeight = 1400;

export function openPluginSessionOverlay(options: {
  readonly pluginId: string;
  readonly descriptor: PluginSessionDescriptor;
  readonly callbacks: SessionOverlayCallbacks;
}): SessionOverlayHostHandle {
  const window = getDefaultPetWindowForPlugins();
  if (!window || window.isDestroyed()) {
    throw new Error("The default pet window is not available for a session overlay.");
  }

  installSessionOverlayIpcHandlers();

  const isSamePluginReplace = Boolean(
    activeSession &&
    !activeSession.closed &&
    activeSession.pluginId === options.pluginId &&
    isDefaultPetSessionOpen()
  );

  if (isSamePluginReplace && activeSession) {
    const prev = activeSession;
    prev.closed = true;
    activeSession = null;
    info("pet.session", "session overlay replaced in-place", { pluginId: prev.pluginId });
    if (prev.runActive) {
      emitToPlugin(prev, { type: "stopped", reason: "replaced", patternId: prev.lastPatternId, cycle: prev.lastCycle });
    }
    try {
      prev.callbacks.onClosed?.("replaced");
    } catch (error) {
      warn("pet.session", "session close delivery failed", { pluginId: prev.pluginId, error: error instanceof Error ? error.message : String(error) });
    }
  } else if (activeSession && !activeSession.closed) {
    finishActiveSession("replaced");
  }

  const initialPatternId = options.descriptor.kind === "breathing" ? options.descriptor.patternId : options.descriptor.kind;
  const session: ActiveSessionOverlay = {
    pluginId: options.pluginId,
    descriptor: options.descriptor,
    callbacks: options.callbacks,
    lastPatternId: initialPatternId,
    lastCycle: 0,
    runActive: false,
    audioEnabled: options.descriptor.kind === "breathing" ? (options.descriptor.audio?.enabled ?? true) : false,
    closed: false,
  };
  activeSession = session;

  if (!unsubscribePanelState) {
    unsubscribePanelState = subscribeDefaultPetPanelState((state) => {
      if (!activeSession || activeSession.closed) return;
      if (state === "expanded-session") return;
      // Another carrier surface (chat, check-in) or a collapse displaced the
      // overlay — the renderer side is already gone, so only settle state.
      debug("pet.session", "session overlay displaced by carrier state", { state, pluginId: activeSession.pluginId });
      finishActiveSession("closed", { collapseCarrier: false, notifyRenderer: false });
    });
  }

  info("pet.session", "session overlay opened", {
    pluginId: options.pluginId,
    kind: options.descriptor.kind,
    patternId: initialPatternId,
    items: options.descriptor.kind === "breathing" ? options.descriptor.patterns.length : options.descriptor.steps.length,
    autoStart: options.descriptor.autoStart,
  });
  openDefaultPetSession(estimatedCardHeight(options.descriptor));
  sendDescriptorToRenderer();
  if (isSamePluginReplace) {
    refreshSessionInfoWindowIfOpen(session.descriptor, buildSessionChrome());
  }

  return {
    async update(patch: PluginSessionUpdate): Promise<void> {
      if (session.closed || activeSession !== session) throw new Error("Plugin session overlay is no longer open.");
      if (session.descriptor.kind !== "breathing") {
        throw new Error("Session update is only supported for breathing sessions.");
      }
      const currentBreathing = session.descriptor;
      const patterns = patch.patterns ?? currentBreathing.patterns;
      if (patch.patternId !== undefined && !patterns.some((pattern) => pattern.id === patch.patternId)) {
        throw new Error("Selected session pattern id is not in the pattern list.");
      }
      const requestedPatternId = patch.patternId ?? currentBreathing.patternId;
      // A replaced pattern list may drop the current selection; fall back to
      // the first pattern of the new list.
      const patternId = patterns.some((pattern) => pattern.id === requestedPatternId)
        ? requestedPatternId
        : patterns[0].id;
      session.descriptor = {
        ...currentBreathing,
        ...(patch.info === undefined ? {} : { info: patch.info }),
        patterns,
        patternId,
      };
      session.lastPatternId = patternId;
      // A new pattern list can add or drop the chip row, so the carrier's
      // height hint may change; this resizes in place when it does.
      openDefaultPetSession(estimatedCardHeight(session.descriptor));
      sendDescriptorToRenderer();
      refreshSessionInfoWindowIfOpen(session.descriptor, buildSessionChrome());
    },
    async pause(): Promise<void> {
      sendControlToRenderer(session, "pause");
    },
    async resume(): Promise<void> {
      sendControlToRenderer(session, "resume");
    },
    async stop(): Promise<void> {
      sendControlToRenderer(session, "stop");
    },
    async close(): Promise<void> {
      if (session.closed || activeSession !== session) return;
      finishActiveSession("user");
    },
  };
}

/** Carrier height hint: the card grows with PMR's pose well, grounding's checklist, and guided breathing's chips. */
function estimatedCardHeight(descriptor: PluginSessionDescriptor): number {
  if (descriptor.kind === "pmr") return sessionPmrCardEstimatedHeight;
  if (descriptor.kind === "grounding") return sessionGroundingCardEstimatedHeight;
  if (descriptor.patterns.length > 1) return sessionGuidedBreathingCardEstimatedHeight;
  return sessionBreathingCardEstimatedHeight;
}

function sendControlToRenderer(session: ActiveSessionOverlay, action: "pause" | "resume" | "stop"): void {
  if (session.closed || activeSession !== session) throw new Error("Plugin session overlay is no longer open.");
  const window = getDefaultPetWindowForPlugins();
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  debug("pet.session", "session overlay control", { pluginId: session.pluginId, action });
  window.webContents.send("openpets:session-overlay-control", action);
}

/** Close the active overlay when its owning plugin stops or reloads. */
export function closePluginSessionOverlaysForPlugin(pluginId: string): void {
  if (!activeSession || activeSession.closed || activeSession.pluginId !== pluginId) return;
  finishActiveSession("plugin-stopped", { notifyPlugin: false });
}

function finishActiveSession(reason: SessionStopReason, options: { collapseCarrier?: boolean; notifyPlugin?: boolean; notifyRenderer?: boolean } = {}): void {
  const session = activeSession;
  if (!session || session.closed) return;
  session.closed = true;
  activeSession = null;
  info("pet.session", "session overlay closed", { pluginId: session.pluginId, reason, runActive: session.runActive, cycle: session.lastCycle });

  if (options.notifyPlugin !== false && session.runActive) {
    emitToPlugin(session, { type: "stopped", reason, patternId: session.lastPatternId, cycle: session.lastCycle });
  }
  if (options.notifyPlugin !== false) {
    try {
      session.callbacks.onClosed?.(reason);
    } catch (error) {
      warn("pet.session", "session close delivery failed", { pluginId: session.pluginId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (options.notifyRenderer !== false) sendDescriptorToRenderer();
  closeSessionInfoWindow();
  if (options.collapseCarrier !== false && isDefaultPetSessionOpen()) {
    closeDefaultPetSession();
  }
}

function emitToPlugin(session: ActiveSessionOverlay, event: PluginSessionEvent): void {
  try {
    session.callbacks.onEvent(event);
  } catch (error) {
    warn("pet.session", "session event delivery failed", { pluginId: session.pluginId, type: event.type, error: error instanceof Error ? error.message : String(error) });
  }
}

interface SessionAudioPayload {
  readonly enabled: boolean;
  readonly allowed: boolean;
  readonly inhaleDataUrl?: string;
  readonly exhaleDataUrl?: string;
}

const soundDataUrlCache = new Map<string, string | null>();

/** Read a resolved cue sound into a data URL (the pet window CSP allows media-src data: only). */
function soundDataUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const cached = soundDataUrlCache.get(path);
  if (cached !== undefined) return cached ?? undefined;
  let result: string | null = null;
  try {
    const mime = userSoundMimeByExtension[extname(path).toLowerCase()];
    const stat = statSync(path);
    if (mime && stat.isFile() && stat.size > 0 && stat.size <= maxUserSoundBytes) {
      result = `data:${mime};base64,${readFileSync(path).toString("base64")}`;
    } else {
      warn("pet.session", "session cue sound rejected", { sizeBytes: stat.size, hasMime: Boolean(mime) });
    }
  } catch (error) {
    warn("pet.session", "session cue sound read failed", { error: error instanceof Error ? error.message : String(error) });
  }
  soundDataUrlCache.set(path, result);
  return result ?? undefined;
}

function currentAudioPayload(session: ActiveSessionOverlay): SessionAudioPayload | null {
  if (session.descriptor.kind !== "breathing") return null;
  const audio = session.descriptor.audio;
  if (!audio) return null;
  const settings = getPluginPlatformSettings();
  return {
    enabled: session.audioEnabled,
    allowed: settings.allowPluginAudio && !isInQuietHours(),
    inhaleDataUrl: soundDataUrl(audio.inhaleSoundPath),
    exhaleDataUrl: soundDataUrl(audio.exhaleSoundPath),
  };
}

/**
 * Renderer copy of the descriptor: named icons become inline SVG paths (the
 * pet window never sees icon names it would have to map itself) and PMR pose
 * paths become file URLs.
 */
function buildRendererDescriptor(descriptor: PluginSessionDescriptor): PluginSessionDescriptor {
  const practices = descriptor.practices?.map((choice) => {
    const iconPaths = sessionIconPaths(choice.icon);
    return iconPaths ? { ...choice, iconPaths } : choice;
  });
  const withPractices = practices ? { ...descriptor, practices } : descriptor;

  if (withPractices.kind === "grounding") {
    return {
      ...withPractices,
      steps: withPractices.steps.map((step) => {
        const iconPaths = sessionIconPaths(step.icon);
        return iconPaths ? { ...step, iconPaths } : step;
      }),
    };
  }
  if (withPractices.kind !== "pmr") return withPractices;
  return {
    ...withPractices,
    steps: withPractices.steps.map((step) => {
      const tenseImageUrl = step.tenseIllustrationPath
        ? pathToFileURL(step.tenseIllustrationPath).href
        : undefined;
      const releaseImageUrl = step.releaseIllustrationPath
        ? pathToFileURL(step.releaseIllustrationPath).href
        : undefined;
      return {
        ...step,
        ...(tenseImageUrl ? { tenseImageUrl } : {}),
        ...(releaseImageUrl ? { releaseImageUrl } : {}),
      };
    }),
  };
}

function currentRendererPayload(): { descriptor: PluginSessionDescriptor; chrome: Record<string, string>; audio: SessionAudioPayload | null } | null {
  if (!activeSession || activeSession.closed) return null;
  return {
    descriptor: buildRendererDescriptor(activeSession.descriptor),
    chrome: buildSessionChrome(),
    audio: currentAudioPayload(activeSession),
  };
}

function sendDescriptorToRenderer(): void {
  const window = getDefaultPetWindowForPlugins();
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(sessionOverlayChannel, currentRendererPayload());
}

function isAuthorizedSessionSender(senderWebContentsId: number): boolean {
  const window = getDefaultPetWindowForPlugins();
  return Boolean(window && !window.isDestroyed() && window.webContents.id === senderWebContentsId);
}

/**
 * Install the overlay IPC handlers. Called once at startup (the pet window's
 * preload probes `session-overlay-get` on every load, session or not) and
 * defensively before each open.
 */
export function installSessionOverlayIpcHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  ipcMain.handle("openpets:session-overlay-get", (event: IpcMainInvokeEvent) => {
    if (!isAuthorizedSessionSender(event.sender.id)) return null;
    return currentRendererPayload();
  });

  ipcMain.on("openpets:session-overlay-event", (event: IpcMainEvent, payload: unknown) => {
    if (!isAuthorizedSessionSender(event.sender.id)) {
      warn("pet.session", "unauthorized session overlay event", { senderId: event.sender.id });
      return;
    }
    const session = activeSession;
    if (!session || session.closed) return;
    const parsed = parseRendererSessionEvent(payload, session);
    if (!parsed) {
      warn("pet.session", "invalid session overlay event", { payload: typeof payload });
      return;
    }
    debug("pet.session", "session overlay event", { pluginId: session.pluginId, type: parsed.kind, patternId: session.lastPatternId, cycle: session.lastCycle });

    if (parsed.kind === "dismissed") {
      // The user closed the overlay (close button or Escape).
      finishActiveSession("closed");
      return;
    }
    if (parsed.event.type === "started" || parsed.event.type === "resumed") session.runActive = true;
    if (parsed.event.type === "completed" || parsed.event.type === "stopped") session.runActive = false;
    if (parsed.event.type === "infoOpened") {
      showSessionInfoWindow(session.descriptor, buildSessionChrome());
    }
    emitToPlugin(session, parsed.event);
  });

  // The overlay measures its real card + orb and reports the carrier height it
  // needs; estimates only size the first frame.
  ipcMain.on("openpets:session-overlay-content-height", (event: IpcMainEvent, payload: unknown) => {
    if (!isAuthorizedSessionSender(event.sender.id)) return;
    const session = activeSession;
    if (!session || session.closed) return;
    if (typeof payload !== "object" || payload === null) return;
    const report = payload as Record<string, unknown>;
    const height = Number(report.height);
    if (!Number.isFinite(height)) return;
    const clamped = Math.max(minSessionContentHeight, Math.min(maxSessionContentHeight, Math.round(height)));
    // The measurement inputs make carrier-size mismatches diagnosable from openpets.log.
    const numberField = (key: string) => (typeof report[key] === "number" ? Math.round(report[key] as number * 100) / 100 : null);
    debug("pet.session", "session overlay content height", {
      pluginId: session.pluginId,
      height: clamped,
      cardHeight: numberField("cardHeight"),
      spriteHeight: numberField("spriteHeight"),
      spriteClass: typeof report.spriteClass === "string" ? report.spriteClass.slice(0, 40) : null,
      viewport: `${numberField("viewportWidth")}x${numberField("viewportHeight")}`,
      devicePixelRatio: numberField("devicePixelRatio"),
      orbRadius: numberField("orbRadius"),
      petLift: numberField("petLift"),
    });
    setDefaultPetSessionMeasuredHeight(clamped);
  });

  ipcMain.on("openpets:session-overlay-open-url", (event: IpcMainEvent, rawUrl: unknown) => {
    if (!isAuthorizedSessionSender(event.sender.id)) return;
    const session = activeSession;
    if (!session || session.closed || typeof rawUrl !== "string") return;
    // Only URLs from the validated descriptor may leave the overlay.
    const allowed = new Set<string>();
    if (session.descriptor.info?.site) allowed.add(session.descriptor.info.site.url);
    for (const citation of session.descriptor.info?.citations ?? []) {
      if (citation.url) allowed.add(citation.url);
    }
    if (!allowed.has(rawUrl)) {
      warn("pet.session", "session overlay url rejected", { pluginId: session.pluginId });
      return;
    }
    debug("pet.session", "session overlay url opened", { pluginId: session.pluginId });
    void shell.openExternal(rawUrl);
  });
}

type ParsedRendererSessionEvent =
  | { kind: "event"; event: PluginSessionEvent }
  | { kind: "dismissed" };

function parseRendererSessionEvent(payload: unknown, session: ActiveSessionOverlay): ParsedRendererSessionEvent | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const type = record.type;
  const patternId = resolvePatternId(record.patternId, session);
  const cycle = clampCount(record.cycle);
  session.lastPatternId = patternId;
  session.lastCycle = cycle;

  switch (type) {
    case "started":
      return { kind: "event", event: { type: "started", patternId } };
    case "paused":
      return { kind: "event", event: { type: "paused", patternId, cycle } };
    case "resumed":
      return { kind: "event", event: { type: "resumed", patternId, cycle } };
    case "patternChanged":
      // The overlay's selection is now the live one; a later plugin update
      // that only swaps Info must not revert it.
      if (session.descriptor.kind === "breathing") {
        session.descriptor = { ...session.descriptor, patternId };
      }
      return { kind: "event", event: { type: "patternChanged", patternId } };
    case "completed":
      return { kind: "event", event: { type: "completed", patternId, cycles: clampCount(record.cycles) } };
    case "stopped":
      return { kind: "event", event: { type: "stopped", reason: "user", patternId, cycle } };
    case "infoOpened":
      return { kind: "event", event: { type: "infoOpened" } };
    case "audioToggled": {
      const enabled = record.enabled === true;
      session.audioEnabled = enabled;
      return { kind: "event", event: { type: "audioToggled", enabled } };
    }
    case "practiceSelected": {
      if (typeof record.practiceId !== "string" || !record.practiceId) return null;
      return { kind: "event", event: { type: "practiceSelected", practiceId: record.practiceId } };
    }
    case "dismissed":
      return { kind: "dismissed" };
    default:
      return null;
  }
}

function resolvePatternId(value: unknown, session: ActiveSessionOverlay): string {
  if (session.descriptor.kind !== "breathing") return session.descriptor.kind;
  if (typeof value === "string" && session.descriptor.patterns.some((pattern) => pattern.id === value)) return value;
  return session.lastPatternId;
}

function clampCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(9_999, Math.round(count));
}
