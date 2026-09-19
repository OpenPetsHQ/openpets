/**
 * Protects the on-pet visual treatment for active and inactive Talk sessions.
 * Verifies that voice activity renders the Talk button with an active end-talk
 * affordance (restrained red, subtle pulse, "End talk" title/aria-label) and
 * does not generate detached popup bubbles or hide the button.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

const userDataPath = mkdtempSync(join(tmpdir(), "openpets-pet-talk-button-"));
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

const {
  createDefaultPetRender,
  createPetBodyMarkup,
} = await import("../src/pet-window.js");

try {
  initializeAppState();
  updatePreferences({ showChatButton: true, showTalkButton: true });

  // 1. Inactive Talk button rendering (normal default pet)
  const inactiveRender = await createDefaultPetRender(false, null, null);
  assert.ok(inactiveRender.bodyHtml.includes("data-openpets-talk-button"), "inactive talk button must have data-openpets-talk-button");
  assert.ok(inactiveRender.bodyHtml.includes('aria-label="Talk to companion"'), "inactive talk button has 'Talk to companion' aria-label");
  assert.ok(inactiveRender.bodyHtml.includes('title="Talk to companion"'), "inactive talk button has 'Talk to companion' title");
  assert.ok(!inactiveRender.bodyHtml.includes("openpets-talk-button is-active"), "inactive talk button must not have is-active class");
  assert.ok(inactiveRender.bodyHtml.includes("openpets-companion-launcher openpets-talk-button"), "inactive talk button has base talk-button class");
  assert.ok(!inactiveRender.bodyHtml.includes("bubble"), "no bubble is rendered for idle pet");

  // 2. Active Talk button rendering:
  // 2a. Recording/listening with canSubmitRecording: true renders red/pulsing interactive 'Stop recording and send'
  const activeSubmitDisplay = { reaction: "thinking" as const, suppressReactionMessage: true, canSubmitRecording: true };
  const activeSubmitRender = await createDefaultPetRender(false, activeSubmitDisplay, null);
  assert.ok(activeSubmitRender.bodyHtml.includes("data-openpets-talk-button"), "active talk button must preserve data-openpets-talk-button");
  assert.ok(activeSubmitRender.bodyHtml.includes('aria-label="Stop recording and send"'), "active talk button with canSubmitRecording must have 'Stop recording and send' aria-label");
  assert.ok(activeSubmitRender.bodyHtml.includes('title="Stop recording and send"'), "active talk button with canSubmitRecording must have 'Stop recording and send' title");
  assert.ok(activeSubmitRender.bodyHtml.includes("openpets-companion-launcher openpets-talk-button is-active"), "active talk button with canSubmitRecording must have is-active class");
  assert.ok(!activeSubmitRender.bodyHtml.includes("is-processing"), "recording talk button must not have is-processing class");
  assert.ok(!activeSubmitRender.bodyHtml.includes("disabled"), "recording talk button must not be disabled");
  assert.ok(!activeSubmitRender.bodyHtml.includes("bubble"), "voice activity must not render detached text bubbles");

  // 2b. Submitting/STT/Brain processing and speaking (canSubmitRecording is false or omitted):
  // mic is NOT red/pulsing (not is-active), visually subdued and disabled (is-processing)
  const activeProcessingDisplay = { reaction: "thinking" as const, suppressReactionMessage: true, canSubmitRecording: false };
  const activeProcessingRender = await createDefaultPetRender(false, activeProcessingDisplay, null);
  assert.ok(activeProcessingRender.bodyHtml.includes("data-openpets-talk-button"), "processing talk button must preserve data-openpets-talk-button");
  assert.ok(activeProcessingRender.bodyHtml.includes('aria-label="Processing..."'), "processing talk button must have 'Processing...' aria-label");
  assert.ok(activeProcessingRender.bodyHtml.includes('title="Processing..."'), "processing talk button must have 'Processing...' title");
  assert.ok(activeProcessingRender.bodyHtml.includes("openpets-companion-launcher openpets-talk-button is-processing"), "processing talk button must have is-processing class");
  assert.ok(!activeProcessingRender.bodyHtml.includes("is-active"), "processing/speaking talk button must NOT have is-active class (not red/pulsing)");
  assert.ok(activeProcessingRender.bodyHtml.includes("disabled"), "processing talk button must be disabled");
  assert.ok(activeProcessingRender.bodyHtml.includes('aria-disabled="true"'), "processing talk button must have aria-disabled='true'");
  assert.ok(!activeProcessingRender.bodyHtml.includes("bubble"), "processing voice must not render detached text bubbles");

  const submitMarkup = createPetBodyMarkup("OpenPets default pet", "", `<div class="sprite"></div>`, "", false, "default", true, true);
  assert.ok(submitMarkup.includes('aria-label="Stop recording and send"'), "createPetBodyMarkup with canSubmitRecording=true has 'Stop recording and send' aria-label");
  assert.ok(submitMarkup.includes('title="Stop recording and send"'), "createPetBodyMarkup with canSubmitRecording=true has 'Stop recording and send' title");
  assert.ok(submitMarkup.includes("openpets-companion-launcher openpets-talk-button is-active"), "createPetBodyMarkup with canSubmitRecording=true has is-active class");
  assert.ok(!submitMarkup.includes("disabled"), "createPetBodyMarkup with canSubmitRecording=true is not disabled");

  const processingMarkup = createPetBodyMarkup("OpenPets default pet", "", `<div class="sprite"></div>`, "", false, "default", true, false);
  assert.ok(processingMarkup.includes('aria-label="Processing..."'), "createPetBodyMarkup with canSubmitRecording=false has 'Processing...' aria-label");
  assert.ok(processingMarkup.includes('title="Processing..."'), "createPetBodyMarkup with canSubmitRecording=false has 'Processing...' title");
  assert.ok(processingMarkup.includes("openpets-companion-launcher openpets-talk-button is-processing"), "createPetBodyMarkup with canSubmitRecording=false has is-processing class");
  assert.ok(!processingMarkup.includes("is-active"), "createPetBodyMarkup with canSubmitRecording=false does not have is-active class");
  assert.ok(processingMarkup.includes("disabled"), "createPetBodyMarkup with canSubmitRecording=false is disabled");

  // 3. Talk button styling in generated CSS
  assert.ok(activeSubmitRender.html.includes(".openpets-talk-button.is-active"), "CSS includes active talk button selector");
  assert.ok(activeSubmitRender.html.includes("#ef4444") || activeSubmitRender.html.includes("#dc2626"), "CSS includes restrained red active styling");
  assert.ok(activeSubmitRender.html.includes("talk-pulse"), "CSS includes talk-pulse animation for active state");
  assert.ok(activeSubmitRender.html.includes("@keyframes talk-pulse"), "CSS defines talk-pulse keyframes");
  assert.ok(activeSubmitRender.html.includes(".openpets-talk-button.is-processing"), "CSS includes processing talk button selector");
  assert.ok(activeSubmitRender.html.includes("processing-breathe"), "CSS includes processing-breathe animation");
  assert.ok(activeSubmitRender.html.includes("@keyframes processing-breathe"), "CSS defines processing-breathe keyframes");

  // 4. External transient bubble suppresses launcher buttons as normal
  const displayWithExternalMessage = { message: "Hello from human or plugin", reaction: "working" as const, suppressReactionMessage: true };
  const messageRender = await createDefaultPetRender(false, displayWithExternalMessage, null);
  assert.ok(messageRender.bodyHtml.includes("bubble"), "external message bubble is rendered");
  assert.ok(!messageRender.bodyHtml.includes("openpets-pet-buttons"), "assistant buttons are omitted while external message bubble is visible");

  // 5. Pinned plugin HUD does not hide active Talk button
  const pinnedBubble = {
    token: "hud-1",
    pluginId: "test-plugin",
    bubble: { priority: "normal" as const, items: [{ label: "CPU", value: "10%" }] },
  };
  const renderWithPinned = await createDefaultPetRender(false, activeSubmitDisplay, null, undefined, { transient: null, pinned: pinnedBubble });
  assert.ok(renderWithPinned.bodyHtml.includes("is-pinned"), "pinned HUD is rendered");
  assert.ok(renderWithPinned.bodyHtml.includes("openpets-talk-button is-active"), "active talk button remains visible alongside pinned HUD");

  // 6. Agent pets (petRole: agent) do not render assistant buttons
  const agentBody = createPetBodyMarkup("Agent Pet", "", `<div class="sprite"></div>`, "", false, "agent", true);
  assert.ok(!agentBody.includes("openpets-pet-buttons"), "agent pets must not render assistant buttons");
  assert.ok(!agentBody.includes("data-openpets-talk-button"), "agent pets must not render talk button");

  console.log("pet-talk-button-active tests passed.");
} finally {
  releaseStartupInstallLock();
  rmSync(userDataPath, { recursive: true, force: true });
}
