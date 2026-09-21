import { ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";

import { getDefaultPetWindowForPlugins } from "./default-pet-controller.js";
import {
  closeDefaultPetSession,
  isDefaultPetSessionOpen,
  openDefaultPetSession,
  subscribeDefaultPetPanelState,
} from "./default-pet-chat.js";
import { debug, info, warn } from "./logger.js";
import type {
  PluginSessionDescriptor,
  PluginSessionEvent,
  PluginSessionUpdate,
  SessionStopReason,
} from "./plugin-session-descriptor.js";

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
  closed: boolean;
}

let activeSession: ActiveSessionOverlay | null = null;
let handlersInstalled = false;
let unsubscribePanelState: (() => void) | null = null;

const sessionOverlayChannel = "openpets:session-overlay";

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

  if (activeSession && !activeSession.closed) {
    finishActiveSession("replaced");
  }

  const session: ActiveSessionOverlay = {
    pluginId: options.pluginId,
    descriptor: options.descriptor,
    callbacks: options.callbacks,
    lastPatternId: options.descriptor.patternId,
    lastCycle: 0,
    runActive: false,
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
    patternId: options.descriptor.patternId,
    patterns: options.descriptor.patterns.length,
    autoStart: options.descriptor.autoStart,
  });
  openDefaultPetSession();
  sendDescriptorToRenderer();

  return {
    async update(patch: PluginSessionUpdate): Promise<void> {
      if (session.closed || activeSession !== session) throw new Error("Plugin session overlay is no longer open.");
      const patterns = patch.patterns ?? session.descriptor.patterns;
      if (patch.patternId !== undefined && !patterns.some((pattern) => pattern.id === patch.patternId)) {
        throw new Error("Selected session pattern id is not in the pattern list.");
      }
      const requestedPatternId = patch.patternId ?? session.descriptor.patternId;
      // A replaced pattern list may drop the current selection; fall back to
      // the first pattern of the new list.
      const patternId = patterns.some((pattern) => pattern.id === requestedPatternId)
        ? requestedPatternId
        : patterns[0].id;
      session.descriptor = {
        ...session.descriptor,
        ...(patch.info === undefined ? {} : { info: patch.info }),
        patterns,
        patternId,
      };
      session.lastPatternId = patternId;
      sendDescriptorToRenderer();
    },
    async close(): Promise<void> {
      if (session.closed || activeSession !== session) return;
      finishActiveSession("user");
    },
  };
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

function sendDescriptorToRenderer(): void {
  const window = getDefaultPetWindowForPlugins();
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(sessionOverlayChannel, activeSession && !activeSession.closed ? activeSession.descriptor : null);
}

function isAuthorizedSessionSender(senderWebContentsId: number): boolean {
  const window = getDefaultPetWindowForPlugins();
  return Boolean(window && !window.isDestroyed() && window.webContents.id === senderWebContentsId);
}

function installSessionOverlayIpcHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  ipcMain.handle("openpets:session-overlay-get", (event: IpcMainInvokeEvent) => {
    if (!isAuthorizedSessionSender(event.sender.id)) return null;
    return activeSession && !activeSession.closed ? activeSession.descriptor : null;
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
    emitToPlugin(session, parsed.event);
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
      return { kind: "event", event: { type: "patternChanged", patternId } };
    case "completed":
      return { kind: "event", event: { type: "completed", patternId, cycles: clampCount(record.cycles) } };
    case "stopped":
      return { kind: "event", event: { type: "stopped", reason: "user", patternId, cycle } };
    case "infoOpened":
      return { kind: "event", event: { type: "infoOpened" } };
    case "dismissed":
      return { kind: "dismissed" };
    default:
      return null;
  }
}

function resolvePatternId(value: unknown, session: ActiveSessionOverlay): string {
  if (typeof value === "string" && session.descriptor.patterns.some((pattern) => pattern.id === value)) return value;
  return session.lastPatternId;
}

function clampCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(9_999, Math.round(count));
}
