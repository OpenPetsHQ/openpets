import { app, nativeImage, screen, type BrowserWindow } from "electron";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, isAbsolute, join } from "node:path";

import { updatePreferences } from "./app-state.js";
import { frameVisibleContent } from "./capture-image-core.js";
import { resolveDevControlCenterRoute } from "./control-center-route.js";
import { collapseDefaultPetChat, expandDefaultPetChat, setDefaultPetChatCompactOpen } from "./default-pet-chat.js";
import { applyExternalPetReaction, applyExternalPetSay, getDefaultPetWindowForPlugins, isDefaultPetVisible, openDefaultPetManagerCheckIn, refreshDefaultPetContent } from "./default-pet-controller.js";
import { isRecord, validateReaction, validateSayMessage } from "./local-ipc-protocol.js";
import { debug, info, warn } from "./logger.js";
import { getPetAssistantConversationController } from "./pet-assistant-host.js";
import { getManagerCheckInService } from "./manager-check-in-service.js";
import { setDefaultInstalledPet } from "./pet-installation.js";
import { getPluginPlatformSettings, profileSupportsRole, selectProviderProfile, type ProviderRole } from "./plugin-platform-settings.js";
import { getTeamService, type TeamServiceSnapshot } from "./team-service.js";
import { getControlCenterWindow, openControlCenterWindow, openControlCenterWindowTarget } from "./windows.js";
import { refreshPetGazePreference } from "./pet-window-gaze.js";
import { getActiveDeliveryWindows } from "./plugin-delivery.js";
import type { PluginHostCapabilities } from "./plugin-sdk-bridge.js";
import type { PluginService } from "./plugin-service.js";

/**
 * Dev-only screenshot session (see docs/screenshots.md).
 *
 * `scripts/capture.mjs` starts an unpackaged app with
 * `OPENPETS_CAPTURE_SESSION_DIR`. That app runs on a throwaway profile inside
 * the session folder and listens on a private Unix socket there, so the
 * runner can drive plugin commands and take trimmed transparent screenshots
 * of the default pet while the app keeps running.
 *
 * This channel is deliberately separate from the public local IPC protocol:
 * running arbitrary plugin commands and reading window pixels must never be
 * reachable in a shipped build.
 */

export const captureSessionEnvKey = "OPENPETS_CAPTURE_SESSION_DIR";

const socketFileName = "control.sock";
const profileDirName = "profile";
const maxRequestBytes = 64 * 1024;
const defaultShotPaddingPoints = 24;
const maxShotPaddingPoints = 400;
const defaultSettleMs = 250;
const maxSettleMs = 10_000;
/** Near-invisible pixels (≈3% alpha) are treated as background when trimming. */
const trimAlphaThreshold = 8;

type CaptureRequestHandler = (params: Record<string, unknown>) => Promise<unknown>;

export interface CaptureSessionOptions {
  readonly sessionDir: string;
  readonly pluginService: PluginService;
  readonly pluginCapabilities: PluginHostCapabilities;
  readonly pluginStartup: Promise<void>;
}

/** Returns the session folder when capture mode is requested for a dev build. */
export function resolveCaptureSessionDir(env: NodeJS.ProcessEnv, isPackaged: boolean): string | null {
  const value = env[captureSessionEnvKey]?.trim();
  if (!value) return null;
  if (isPackaged) return null;
  if (!isAbsolute(value)) {
    throw new Error(`${captureSessionEnvKey} must be an absolute path.`);
  }
  return value;
}

/**
 * Must run before `app.requestSingleInstanceLock()` and app ready: the
 * profile path scopes the single-instance lock, so a capture session can run
 * next to the user's normal OpenPets without either quitting.
 */
export function prepareCaptureSessionBeforeReady(sessionDir: string): void {
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  app.setPath("userData", join(sessionDir, profileDirName));
  // Without this macOS renders in the display's P3 space and the PNGs,
  // which carry no color profile, come out washed out.
  app.commandLine.appendSwitch("force-color-profile", "srgb");
}

export function startCaptureSession(options: CaptureSessionOptions): void {
  const socketPath = join(options.sessionDir, socketFileName);
  const pluginStartupState = trackPluginStartup(options.pluginStartup);
  const handlers = createHandlers(options.pluginService, options.pluginCapabilities, pluginStartupState);
  // The pet otherwise turns toward wherever the mouse happens to be.
  updatePreferences({ idleCursorGazeEnabled: false });
  refreshPetGazePreference();

  rmSync(socketPath, { force: true });
  const server = net.createServer((socket) => handleConnection(socket, handlers));
  server.on("error", (error) => warn("capture", "control socket error", { error: error.message }));
  server.listen(socketPath, () => {
    chmodSync(socketPath, 0o600);
    info("capture", "capture session listening", { sessionDir: options.sessionDir, socketPath });
  });

  app.once("will-quit", () => {
    server.close();
    rmSync(socketPath, { force: true });
  });
}

interface PluginStartupState {
  readonly ready: () => boolean;
  readonly failure: () => string | null;
}

function trackPluginStartup(pluginStartup: Promise<void>): PluginStartupState {
  let ready = false;
  let failure: string | null = null;
  pluginStartup.then(
    () => {
      ready = true;
    },
    (error: unknown) => {
      failure = error instanceof Error ? error.message : String(error);
    },
  );
  return {
    ready: () => ready,
    failure: () => failure,
  };
}

function createHandlers(pluginService: PluginService, capabilities: PluginHostCapabilities, pluginStartup: PluginStartupState): Map<string, CaptureRequestHandler> {
  return new Map<string, CaptureRequestHandler>([
    ["status", async () => getStatus(pluginService, pluginStartup)],
    ["plugin.command", async (params) => runPluginCommand(pluginService, params)],
    ["pet.say", async (params) => sayOnPet(params)],
    ["pet.react", async (params) => reactOnPet(params)],
    ["chat.panel", async (params) => setChatPanel(params)],
    ["chat.send", async (params) => sendChatMessage(params)],
    ["chat.clear", async () => clearChatHistory()],
    ["pet.buttons", async (params) => setPetButtons(params)],
    ["control-center.open", async (params) => openControlCenter(params)],
    ["teams.enroll", async (params) => enrollInTeam(params)],
    ["teams.approve", async () => approveTeamPlugins()],
    ["teams.sync", async () => syncTeam()],
    ["delivery.show", async (params) => showDelivery(capabilities, params)],
    ["delivery.clear", async (params) => {
      capabilities.delivery.teardown(requireString(params, "pluginId"));
      return { cleared: true };
    }],
    ["pet.select", async (params) => selectPet(params)],
    ["ui.click", async (params) => clickInWindow(params)],
    ["ui.type", async (params) => typeInWindow(params)],
    ["ui.scroll", async (params) => scrollInWindow(params)],
    ["check-in.open", async () => {
      openDefaultPetManagerCheckIn();
      return { opened: true };
    }],
    ["providers", async () => describeProviders()],
    ["providers.auto", async () => selectFirstProviders()],
    ["shot", async (params) => takeShot(params)],
    ["quit", async () => {
      setTimeout(() => app.quit(), 50);
      return { quitting: true };
    }],
  ]);
}

async function getStatus(pluginService: PluginService, pluginStartup: PluginStartupState): Promise<unknown> {
  const snapshot = await pluginService.getSnapshot();
  const plugins = snapshot.plugins.map((plugin) => {
    const commands = pluginService.runtime.getPluginState(plugin.id).commands.map((command) => command.id);
    return {
      id: plugin.id,
      enabled: plugin.enabled,
      broken: plugin.brokenReason ?? null,
      commands,
    };
  });
  return {
    pid: process.pid,
    pluginsReady: pluginStartup.ready(),
    pluginStartupError: pluginStartup.failure(),
    petVisible: isDefaultPetVisible(),
    plugins,
  };
}

async function runPluginCommand(pluginService: PluginService, params: Record<string, unknown>): Promise<unknown> {
  const pluginId = requireString(params, "pluginId");
  const commandId = requireString(params, "commandId");
  const args = params.args === undefined ? undefined : requireRecord(params.args, "args");
  info("capture", "plugin command", { pluginId, commandId, hasArgs: args !== undefined });
  const result = await pluginService.executeCommand(pluginId, commandId, args);
  if (!result.ok) throw new Error(result.error);
  return { pluginId, commandId };
}

async function sayOnPet(params: Record<string, unknown>): Promise<unknown> {
  const message = validateSayMessage(params.message);
  const reaction = params.reaction === undefined ? undefined : validateReaction(params.reaction);
  return applyExternalPetSay(message, reaction);
}

async function reactOnPet(params: Record<string, unknown>): Promise<unknown> {
  const reaction = validateReaction(params.reaction);
  return applyExternalPetReaction(reaction);
}

async function setChatPanel(params: Record<string, unknown>): Promise<unknown> {
  const state = requireString(params, "state");
  if (state === "expanded") {
    expandDefaultPetChat();
  } else if (state === "compact") {
    // Compact is only reachable from collapsed; the host ignores it while expanded.
    collapseDefaultPetChat();
    setDefaultPetChatCompactOpen(true);
  } else if (state === "collapsed") {
    collapseDefaultPetChat();
  } else {
    throw new Error("\"state\" must be collapsed, compact, or expanded.");
  }
  info("capture", "chat panel", { state });
  return { state };
}

/**
 * Sends a typed chat turn the same way the chat composer does. By default it
 * resolves once the reply (and any tool calls) finished, so the next shot
 * shows the complete answer.
 */
async function sendChatMessage(params: Record<string, unknown>): Promise<unknown> {
  const message = requireString(params, "message");
  const waitForReply = params.wait !== false;
  const controller = getPetAssistantConversationController();
  if (!controller) {
    throw new Error("Pet Assistant is still starting.");
  }
  info("capture", "chat send", { length: message.length, waitForReply });
  const turn = controller.sendTypedMessage(message);
  if (!waitForReply) {
    turn.catch((error: unknown) => warn("capture", "chat turn failed", { error: error instanceof Error ? error.message : String(error) }));
    return { status: "started" };
  }
  const result = await turn;
  if (result.status === "failed") {
    throw new Error(`Chat turn failed: ${result.error ?? "unknown error"}`);
  }
  return result;
}

/** Forgets earlier capture conversations so they don't shape the next replies. */
async function clearChatHistory(): Promise<unknown> {
  const controller = getPetAssistantConversationController();
  if (!controller) {
    throw new Error("Pet Assistant is still starting.");
  }
  controller.clearConversationHistory();
  return { cleared: true };
}

const defaultControlCenterSize = { width: 1180, height: 800 };

async function openControlCenter(params: Record<string, unknown>): Promise<unknown> {
  const resolved = resolveDevControlCenterRoute(requireString(params, "route"), false);
  if (resolved?.kind === "route") {
    openControlCenterWindow(resolved.route);
  } else if (resolved?.kind === "target") {
    openControlCenterWindowTarget(resolved.target);
  } else {
    throw new Error("\"route\" is not a Control Center route.");
  }
  const window = getControlCenterWindow();
  if (!window) throw new Error("The Control Center window did not open.");
  await waitUntil(() => window.isVisible(), "the Control Center window to show");
  const width = optionalNumber(params, "width", defaultControlCenterSize.width, 640, 2400);
  const height = optionalNumber(params, "height", defaultControlCenterSize.height, 480, 1600);
  window.setContentSize(Math.round(width), Math.round(height));
  return { route: params.route, width, height };
}

/**
 * Completes Teams enrollment through the real desktop flow: the deep link
 * stores the pending intent, then the display name is submitted exactly as the
 * Control Center Teams route does.
 */
async function enrollInTeam(params: Record<string, unknown>): Promise<unknown> {
  const intentId = requireString(params, "intentId");
  const displayName = requireString(params, "displayName");
  const teamService = getTeamService();
  if (!teamService.handleDeepLink(`openpets://teams/enroll?intent=${encodeURIComponent(intentId)}`)) {
    throw new Error("The enrollment intent was rejected.");
  }
  await waitForTeamSnapshot(teamService.getSnapshot.bind(teamService), (snapshot) => snapshot.pendingEnrollmentStatus !== null);
  const enrolled = await teamService.submitEnrollment(displayName);
  if (!enrolled.enrolled) throw new Error(enrolled.lastError ?? "Teams enrollment did not complete.");
  info("capture", "teams enrolled", { organizationId: enrolled.organizationId });
  return summarizeTeam(await teamService.syncNow());
}

async function approveTeamPlugins(): Promise<unknown> {
  const teamService = getTeamService();
  let snapshot = teamService.getSnapshot();
  for (const plugin of snapshot.teamPlugins) {
    if (!plugin.permissionBlocked || !plugin.approvalToken) continue;
    snapshot = await teamService.approveTeamPluginPermissions(plugin.id, plugin.approvalToken);
  }
  return summarizeTeam(snapshot);
}

async function syncTeam(): Promise<unknown> {
  const snapshot = await getTeamService().syncNow();
  await getManagerCheckInService().syncNow();
  return summarizeTeam(snapshot);
}

function summarizeTeam(snapshot: TeamServiceSnapshot): unknown {
  return {
    enrolled: snapshot.enrolled,
    organizationName: snapshot.organizationName,
    installationId: snapshot.installationId,
    appliedRevision: snapshot.appliedRevision,
    pendingRevision: snapshot.pendingRevision,
    teamPets: snapshot.teamPets.map((pet) => pet.id),
    teamPlugins: snapshot.teamPlugins.map((plugin) => ({ id: plugin.id, enabled: plugin.enabled, blocked: plugin.permissionBlocked })),
    lastError: snapshot.lastError ?? null,
  };
}

async function waitForTeamSnapshot(read: () => TeamServiceSnapshot, ready: (snapshot: TeamServiceSnapshot) => boolean): Promise<void> {
  await waitUntil(() => ready(read()), "the Teams enrollment preview");
}

async function waitUntil(condition: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}.`);
    await delay(100);
  }
}

/**
 * Sends an airmail delivery through the same host capability a plugin's
 * ctx.ui.delivery uses (plugin and courier sprite validated), so shots show a
 * real courier without an OAuth-connected calendar.
 */
async function showDelivery(capabilities: PluginHostCapabilities, params: Record<string, unknown>): Promise<unknown> {
  const pluginId = requireString(params, "pluginId");
  const courier = requireString(params, "courier");
  const now = Date.now();
  await capabilities.delivery.register(pluginId, {
    key: `capture.${now}`,
    courier: { kind: "sprite", name: courier },
    title: requireString(params, "title"),
    detail: requireString(params, "detail"),
    expiresAt: now + 30 * 60_000,
  });
  await waitUntil(() => getActiveDeliveryWindows().some((window) => window.isVisible()), "the courier window");
  return { pluginId, courier };
}

async function selectPet(params: Record<string, unknown>): Promise<unknown> {
  const petId = requireString(params, "petId");
  await setDefaultInstalledPet(petId);
  refreshDefaultPetContent();
  return { petId };
}

/**
 * Screenshot staging only: drives renderer UI the way a click or keystrokes
 * would (the renderer's own listeners handle the events), for states such as
 * a filled-in check-in card that no command reaches.
 */
async function clickInWindow(params: Record<string, unknown>): Promise<unknown> {
  const selector = requireString(params, "selector");
  const clicked = await captureTargetWindow(params).webContents.executeJavaScript(
    `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`,
  );
  if (clicked !== true) throw new Error(`No element matches ${selector}.`);
  return { clicked: selector };
}

async function typeInWindow(params: Record<string, unknown>): Promise<unknown> {
  const selector = requireString(params, "selector");
  const text = typeof params.text === "string" ? params.text : (() => { throw new Error("\"text\" must be a string."); })();
  const typed = await captureTargetWindow(params).webContents.executeJavaScript(
    `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element || !("value" in element)) return false; element.focus(); element.value = ${JSON.stringify(text)}; element.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`,
  );
  if (typed !== true) throw new Error(`No text field matches ${selector}.`);
  return { typed: selector };
}

async function scrollInWindow(params: Record<string, unknown>): Promise<unknown> {
  const selector = requireString(params, "selector");
  const scrolled = await captureTargetWindow(params).webContents.executeJavaScript(
    `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.scrollIntoView({ block: "start" }); return true; })()`,
  );
  if (scrolled !== true) throw new Error(`No element matches ${selector}.`);
  return { scrolled: selector };
}

function captureTargetWindow(params: Record<string, unknown>): BrowserWindow {
  const target = params.window === undefined ? "pet" : requireString(params, "window");
  const window = target === "pet"
    ? getDefaultPetWindowForPlugins()
    : target === "control-center"
      ? getControlCenterWindow()
      : target === "delivery"
        ? getActiveDeliveryWindows()[0] ?? null
        : null;
  if (!window) throw new Error(`The ${target} window is not open.`);
  return window;
}

const providerRoles: readonly ProviderRole[] = ["text", "stt", "tts"];

function describeProviders(): unknown {
  const settings = getPluginPlatformSettings();
  const profiles = Object.values(settings.profiles).map((profile) => ({
    id: profile.id,
    label: profile.label,
    adapter: profile.adapter,
    roles: providerRoles.filter((role) => profileSupportsRole(profile, role)),
  }));
  return { selections: settings.selections, profiles };
}

/**
 * Selects, for every role with nothing selected, the first configured profile
 * that supports it — so chat scenarios work without hard-coding the random
 * profile ids created in the capture profile's Control Center.
 */
function selectFirstProviders(): unknown {
  for (const role of providerRoles) {
    const settings = getPluginPlatformSettings();
    if (settings.selections[role]) continue;
    const candidate = Object.values(settings.profiles).find((profile) => profileSupportsRole(profile, role));
    if (!candidate) continue;
    selectProviderProfile(role, candidate.id);
    info("capture", "provider selected", { role, profileId: candidate.id });
  }
  return describeProviders();
}

async function setPetButtons(params: Record<string, unknown>): Promise<unknown> {
  const chat = requireBoolean(params, "chat");
  const talk = requireBoolean(params, "talk");
  updatePreferences({ showChatButton: chat, showTalkButton: talk });
  refreshDefaultPetContent();
  return { chat, talk };
}

async function takeShot(params: Record<string, unknown>): Promise<unknown> {
  const outputPath = requireString(params, "path");
  if (!isAbsolute(outputPath) || !outputPath.endsWith(".png")) {
    throw new Error("Shot path must be an absolute .png path.");
  }
  const window = captureTargetWindow(params);
  if (!window.isVisible()) throw new Error("The window is not visible.");
  // The Control Center is opaque, so its shots are the window as-is.
  const defaultPadding = window === getControlCenterWindow() ? 0 : defaultShotPaddingPoints;
  const paddingPoints = optionalNumber(params, "padding", defaultPadding, 0, maxShotPaddingPoints);
  const settleMs = optionalNumber(params, "settleMs", defaultSettleMs, 0, maxSettleMs);
  await delay(settleMs);

  const image = await window.webContents.capturePage();
  const size = image.getSize();
  const scaleFactor = getWindowScaleFactor(window);
  const framed = frameVisibleContent(
    { data: image.toBitmap(), width: size.width, height: size.height },
    { padding: paddingPoints * scaleFactor, alphaThreshold: trimAlphaThreshold },
  );
  if (!framed) {
    throw new Error("The capture is fully transparent; the pet has not rendered yet.");
  }

  const output = nativeImage.createFromBitmap(Buffer.from(framed.data), {
    width: framed.width,
    height: framed.height,
    scaleFactor,
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output.toPNG({ scaleFactor }));
  info("capture", "shot written", { path: outputPath, width: framed.width, height: framed.height, scaleFactor });
  return {
    path: outputPath,
    width: framed.width,
    height: framed.height,
    scaleFactor,
  };
}

function getWindowScaleFactor(window: BrowserWindow): number {
  return screen.getDisplayMatching(window.getBounds()).scaleFactor;
}

function handleConnection(socket: net.Socket, handlers: Map<string, CaptureRequestHandler>): void {
  let buffered = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffered += chunk;
    if (buffered.length > maxRequestBytes) {
      respond(socket, { ok: false, error: "Request is too large." });
      return;
    }
    const newlineIndex = buffered.indexOf("\n");
    if (newlineIndex < 0) return;
    const line = buffered.slice(0, newlineIndex);
    socket.removeAllListeners("data");
    void dispatch(line, handlers).then((response) => respond(socket, response));
  });
  socket.on("error", (error) => debug("capture", "control connection error", { error: error.message }));
}

async function dispatch(line: string, handlers: Map<string, CaptureRequestHandler>): Promise<Record<string, unknown>> {
  let method = "unknown";
  try {
    const request: unknown = JSON.parse(line);
    if (!isRecord(request) || typeof request.method !== "string") {
      throw new Error("Request must be {\"method\": string, \"params\"?: object}.");
    }
    method = request.method;
    const handler = handlers.get(method);
    if (!handler) {
      throw new Error(`Unknown capture method: ${method}`);
    }
    const params = request.params === undefined ? {} : requireRecord(request.params, "params");
    const result = await handler(params);
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn("capture", "capture request failed", { method, error: message });
    return { ok: false, error: message };
  }
}

function respond(socket: net.Socket, response: Record<string, unknown>): void {
  if (socket.destroyed) return;
  socket.end(`${JSON.stringify(response)}\n`);
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`"${key}" must be a non-empty string.`);
  }
  return value;
}

function requireBoolean(params: Record<string, unknown>, key: string): boolean {
  const value = params[key];
  if (typeof value !== "boolean") {
    throw new Error(`"${key}" must be true or false.`);
  }
  return value;
}

function requireRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`"${key}" must be an object.`);
  }
  return value;
}

function optionalNumber(params: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = params[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`"${key}" must be a number from ${min} to ${max}.`);
  }
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
