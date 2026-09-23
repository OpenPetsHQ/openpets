/**
 * Protects the pet-side Check-ins queue card: one runtime action beside
 * Chat/Talk, a count badge only when more than one is due, compact private
 * card chrome, and no celebration/gradient/glow task styling.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

const userDataPath = mkdtempSync(join(tmpdir(), "openpets-pet-check-in-queue-ui-"));
const electronMock = `data:text/javascript,${encodeURIComponent(`
  export class BrowserWindow {
    webContents = { on: () => {}, off: () => {}, send: () => {}, getURL: () => "data:text/html,mock" };
    isDestroyed() { return false; }
    once() {}
  }
  export const app = {
    getPath: (name) => name === "userData" ? ${JSON.stringify(userDataPath)} : "",
    getAppPath: () => ${JSON.stringify(userDataPath)},
    commandLine: { getSwitchValue: () => "" },
  };
  export const clipboard = { readText: () => "", writeText: () => {} };
  export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showMessageBox: async () => ({ response: 0 }) };
  export const globalShortcut = { register: () => true, unregister: () => {}, unregisterAll: () => {} };
  export const ipcMain = { on: () => {}, off: () => {}, removeListener: () => {}, handle: () => {} };
  export const Menu = { buildFromTemplate: () => ({ popup: () => {} }) };
  export const nativeImage = { createEmpty: () => ({ isEmpty: () => true }) };
  export const nativeTheme = { themeSource: "system" };
  export const net = {};
  export const Notification = class { show() {} };
  export const powerMonitor = { on: () => {}, getSystemIdleTime: () => 0 };
  export const protocol = { registerSchemesAsPrivileged: () => {}, handle: () => {} };
  export const safeStorage = { isEncryptionAvailable: () => false };
  export const screen = {
    on: () => {},
    getAllDisplays: () => [],
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getDisplayMatching: () => ({ scaleFactor: 1 }),
  };
  export const session = { defaultSession: { webRequest: { onHeadersReceived: () => {} } } };
  export const shell = { openPath: async () => "" };
  export const systemPreferences = { isTrustedAccessibilityClient: () => false };
  export const Tray = class { setToolTip() {} setContextMenu() {} };
  export default { BrowserWindow, app, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, net, Notification, powerMonitor, protocol, safeStorage, screen, session, shell, systemPreferences, Tray };
`)}`;

register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: ${JSON.stringify(electronMock)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

const {
  initializeAppState,
  releaseStartupInstallLock,
  updatePreferences,
} = await import("../src/app-state.js");

const { createPetBodyMarkup } = await import("../src/pet-window-render.js");
const { createPetWindowCss } = await import("../src/pet-window-styles.js");

function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing CSS rule ${selector}`);
  const end = css.indexOf("}", start);
  assert.ok(end > start, `unclosed CSS rule ${selector}`);
  return css.slice(start, end + 1);
}

try {
  initializeAppState();
  updatePreferences({ showChatButton: true, showTalkButton: true, petButtonsSize: "medium" });

  const defaultBody = createPetBodyMarkup("OpenPets default pet", "", `<div class="sprite"></div>`, "", false, "default");
  assert.ok(defaultBody.includes("openpets-pet-buttons"), "Chat/Talk stack must exist so the Check-in action can sit beside them");
  assert.ok(defaultBody.includes("data-openpets-companion-launcher"), "Chat action remains in the pet button stack");
  assert.ok(defaultBody.includes("data-openpets-talk-button"), "Talk action remains in the pet button stack");
  assert.equal(
    (defaultBody.match(/data-openpets-check-in-button/g) || []).length,
    0,
    "static pet markup must not bake a second Check-in action; preload injects the one due action",
  );

  const agentBody = createPetBodyMarkup("Agent Pet", "", `<div class="sprite"></div>`, "", false, "agent");
  assert.ok(!agentBody.includes("data-openpets-check-in-button"), "agent pets must not render a Check-in action");

  const css = createPetWindowCss(false, 1, 1.1, "no-drag");
  // A stray brace makes the browser drop the next rule; it once dropped the
  // chat panel's `display: none` and left its tail visible under the pet.
  let braceDepth = 0;
  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth -= 1;
    assert.ok(braceDepth >= 0, "pet window CSS closes a block it never opened");
  }
  assert.equal(braceDepth, 0, "pet window CSS leaves a block open");
  const badge = ruleBlock(css, ".openpets-check-in-badge");
  assert.match(badge, /display:\s*none/, "count badge stays hidden for a single due check-in");
  const visibleBadge = ruleBlock(css, ".openpets-check-in-badge.is-visible");
  assert.match(visibleBadge, /display:\s*flex/, "count badge appears only when marked visible");

  assert.ok(css.includes(".check-in-progress"), "queue card can show quiet 1 of N progress");
  assert.ok(css.includes(".check-in-title-row"), "schedule name and progress share a compact header");
  assert.ok(!css.includes(".check-in-badge-pill"), "queue card must not use a generic task pill");
  assert.ok(!css.includes(".check-in-feeling-tag"), "feelings must not wear extra task tags");
  assert.ok(!css.includes(".check-in-cancel-btn"), "close is local; there is no cancel/skip action");
  assert.ok(!css.includes(".check-in-success-view"), "successful share must not swap in a celebration view");
  assert.ok(!css.includes("check-in-badge-pulse"), "check-in badge must not pulse or glow");

  const submit = ruleBlock(css, ".check-in-submit-btn");
  assert.ok(!submit.includes("linear-gradient"), "Share is a solid action, not a gradient control");
  const submitHover = ruleBlock(css, ".check-in-submit-btn:hover:not(:disabled)");
  assert.ok(!submitHover.includes("linear-gradient"), "Share hover stays solid");

  const textareaFocus = ruleBlock(css, ".check-in-textarea:focus");
  assert.ok(!textareaFocus.includes("0 0 0"), "note focus must not use a glow ring");

  updatePreferences({ petButtonsSize: "small" });
  const smallCss = createPetWindowCss(false, 1, 1.1, "no-drag");
  updatePreferences({ petButtonsSize: "large" });
  const largeCss = createPetWindowCss(false, 1, 1.1, "no-drag");
  const smallBadge = ruleBlock(smallCss, ".openpets-check-in-badge");
  const largeBadge = ruleBlock(largeCss, ".openpets-check-in-badge");
  const smallFont = Number(smallBadge.match(/font-size:\s*(\d+)px/)?.[1]);
  const largeFont = Number(largeBadge.match(/font-size:\s*(\d+)px/)?.[1]);
  assert.ok(Number.isFinite(smallFont) && Number.isFinite(largeFont), "badge font size is present");
  assert.ok(largeFont > smallFont, "count badge scales with pet button size");

  console.log("pet-check-in-queue-ui tests passed.");
} finally {
  releaseStartupInstallLock();
  rmSync(userDataPath, { recursive: true, force: true });
}
