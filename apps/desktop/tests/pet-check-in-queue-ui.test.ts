/**
 * Protects the pet-side Check-ins queue card: one runtime action beside
 * Chat/Talk, a count badge only when more than one is due, compact private
 * card chrome, and no celebration/gradient/glow task styling.
 * Also checks the generated V2 idle sprite rules, reusing this Electron mock.
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

const { createBuiltInPetRender, createPetBodyMarkup } = await import("../src/pet-window-render.js");
const { createCodexV2GazeCss, createInstalledSpriteStateCss, createPetWindowCss, createSpriteStateCss } = await import("../src/pet-window-styles.js");
const { codexV1SpriteLayout, codexV2SpriteLayout, getCodexV2GazeSpritePosition } = await import("../src/codex-pets-core.js");
const { getConfiguredSpriteStates } = await import("../src/reaction-animation-mapping.js");

function assertV2IdleSpriteRules(): void {
  const states = getConfiguredSpriteStates();
  const frameWidth = codexV2SpriteLayout.frameWidth;
  const frameHeight = codexV2SpriteLayout.frameHeight;
  const v2Css = `${createSpriteStateCss(".sprite", states, codexV2SpriteLayout)}\n${createCodexV2GazeCss(".sprite", codexV2SpriteLayout)}`;
  const idleSelector = `html[data-reaction-state="idle"] .sprite`;
  const motionSelector = `html:not([data-flip-x="true"])[data-motion-state="run-right"] .sprite`;
  const gazeIndex = 4;
  const gaze = getCodexV2GazeSpritePosition(gazeIndex);
  assert.ok(gaze, "gaze index must select a look-direction cell");
  const gazeSelector = `html[data-codex-sprite-version="2"][data-paused="false"][data-reaction-state="idle"][data-motion-state="idle"][data-codex-gaze-index="${gazeIndex}"] .sprite`;

  assertAnimatedLoop(ruleBlock(v2Css, idleSelector), 0, states.idle.frames, frameWidth, frameHeight);
  assertStaticCell(
    ruleBlock(v2Css, `html[data-reaction-state="idle"][data-paused="true"] .sprite`),
    0,
    codexV2SpriteLayout.neutralPose?.column ?? -1,
    frameWidth,
    frameHeight,
  );
  const gazeRule = ruleBlock(v2Css, gazeSelector);
  assert.equal(declaration(gazeRule, "animation"), "none", "an active glance disables the idle loop");
  assertStaticCell(gazeRule, gaze.row, gaze.column, frameWidth, frameHeight);
  assert.equal(v2Css.includes(`[data-reaction-state="idle"][data-paused="false"]`), false, "animated idle must not gain a paused attribute");
  assert.ok(attributeCount(motionSelector) > attributeCount(idleSelector), "movement rules stay more specific than animated idle");
  assert.ok(attributeCount(gazeSelector) > attributeCount(idleSelector), "an active glance stays more specific than animated idle");
  assert.ok(v2Css.includes(`${motionSelector} {`), "movement rules are still emitted");

  const installedV2 = createInstalledSpriteStateCss(states, codexV2SpriteLayout);
  assertAnimatedLoop(ruleBlock(installedV2, `html[data-reaction-state="idle"] .installed-sprite`), 0, states.idle.frames, frameWidth, frameHeight);
  const v1Css = createInstalledSpriteStateCss(states, codexV1SpriteLayout);
  assert.equal(v1Css.includes('data-paused="true"'), false, "V1 idle does not gain the paused neutral cell");
  assert.equal(v1Css.includes("data-codex-gaze-index"), false, "V1 idle does not gain V2 glance rules");
  assertAnimatedLoop(ruleBlock(v1Css, `html[data-reaction-state="idle"] .installed-sprite`), 0, states.idle.frames, codexV1SpriteLayout.frameWidth, codexV1SpriteLayout.frameHeight);
}

function assertBuiltInRenderOutput(paused: boolean): void {
  const render = createBuiltInPetRender(
    paused,
    null,
    null,
    0.75,
    "test:builtin",
    "builtin",
    undefined,
    null,
    "default",
    "no-drag",
  );
  const style = render.html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(style, "built-in render includes its generated stylesheet");

  const spriteBase = ruleBlock(style, ".sprite");
  assert.ok(
    declaration(spriteBase, "animation").includes("var(--sprite-animation"),
    "built-in sprite animation uses the state-selected animation variable",
  );
  assert.equal(declaration(spriteBase, "animation-play-state"), "var(--play-state)");

  assert.ok(
    /@keyframes pet-frames\s*\{\s*from\s*\{\s*background-position:\s*var\(--sprite-offset-x\) var\(--sprite-row-y\);\s*\}\s*to\s*\{\s*background-position:\s*var\(--sprite-end-offset-x\) var\(--sprite-row-y\);/.test(style),
    "generated sprite keyframes use the selected start and end frame offsets",
  );

  if (paused) {
    const pausedIdle = ruleBlock(style, 'html[data-reaction-state="idle"][data-paused="true"] .sprite');
    assertStaticCell(
      pausedIdle,
      0,
      codexV2SpriteLayout.neutralPose?.column ?? -1,
      codexV2SpriteLayout.frameWidth,
      codexV2SpriteLayout.frameHeight,
    );
    assert.match(style, /--play-state:\s*paused/);
    return;
  }

  const idle = ruleBlock(style, 'html[data-reaction-state="idle"] .sprite');
  assertAnimatedLoop(
    idle,
    0,
    getConfiguredSpriteStates().idle.frames,
    codexV2SpriteLayout.frameWidth,
    codexV2SpriteLayout.frameHeight,
  );
}

function attributeCount(selector: string): number {
  return selector.match(/\[[^\]]+\]/g)?.length ?? 0;
}

function assertAnimatedLoop(rule: string, row: number, frames: number, frameWidth: number, frameHeight: number): void {
  assert.ok(declaration(rule, "--sprite-animation").startsWith("pet-frames"), "sprite loop must stay animated");
  assert.equal(offsetPx(rule, "--sprite-row-y"), pixelOffset(-(row * frameHeight)));
  assert.equal(offsetPx(rule, "--sprite-offset-x"), 0);
  assert.equal(offsetPx(rule, "--sprite-end-offset-x"), pixelOffset(-(frames * frameWidth)));
}

function assertStaticCell(rule: string, row: number, column: number, frameWidth: number, frameHeight: number): void {
  assert.equal(declaration(rule, "--sprite-animation"), "none", "static cell must disable the sprite loop");
  const offset = pixelOffset(-(column * frameWidth));
  assert.equal(offsetPx(rule, "--sprite-row-y"), pixelOffset(-(row * frameHeight)));
  assert.equal(offsetPx(rule, "--sprite-offset-x"), offset);
  assert.equal(offsetPx(rule, "--sprite-end-offset-x"), offset);
}

function declaration(rule: string, property: string): string {
  const token = `${property}:`;
  let start = rule.indexOf(token);
  while (start > 0 && /[\w-]/.test(rule[start - 1] ?? "")) {
    start = rule.indexOf(token, start + token.length);
  }
  assert.ok(start >= 0, `missing ${property}`);
  const valueStart = start + token.length;
  const end = rule.indexOf(";", valueStart);
  return rule.slice(valueStart, end === -1 ? rule.length : end).trim();
}

function offsetPx(rule: string, property: string): number {
  const value = declaration(rule, property);
  assert.match(value, /^-?\d+px$/, `${property} must be a pixel offset`);
  return pixelOffset(Number(value.slice(0, -2)));
}

function pixelOffset(value: number): number {
  return value === 0 ? 0 : value;
}

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
  assertBuiltInRenderOutput(false);
  assertBuiltInRenderOutput(true);

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
  assertV2IdleSpriteRules();

  console.log("pet-check-in-queue-ui tests passed.");
} finally {
  releaseStartupInstallLock();
  rmSync(userDataPath, { recursive: true, force: true });
}
