/**
 * Catches regressions where right-clicking a pet omits the Size submenu,
 * misidentifies the currently checked scale option, or fails to update
 * the global pet and HUD scale preferences when an option is selected.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { petScaleOptions, type PetScaleValue } from "../src/app-state-core.js";

const userDataPath = mkdtempSync(join(tmpdir(), "openpets-pet-context-menu-scale-"));
const electronMock = `data:text/javascript,${encodeURIComponent(`
  export class BrowserWindow {
    webContents = { on: () => {}, off: () => {}, send: () => {} };
    isDestroyed() { return false; }
    once() {}
  }
  export const app = { getPath: (name) => name === "userData" ? ${JSON.stringify(userDataPath)} : "" };
  export const clipboard = { readText: () => "", writeText: () => {} };
  export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showMessageBox: async () => ({ response: 0 }) };
  export const globalShortcut = { register: () => true, unregister: () => {}, unregisterAll: () => {} };
  export const ipcMain = { on: () => {}, off: () => {}, removeListener: () => {}, handle: () => {} };
  export const Menu = { buildFromTemplate: (template) => ({ popup: () => {} }) };
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
  getAppStateSnapshot,
  initializeAppState,
  releaseStartupInstallLock,
} = await import("../src/app-state.js");

const {
  buildPetContextMenuTemplate,
  handlePetScaleChange,
} = await import("../src/pet-window.js");

try {
  initializeAppState();

  // 1. Initial state: petScale should default to 1 (Medium)
  assert.equal(getAppStateSnapshot().preferences.petScale, 1);

  // 2. Default pet context menu contains Size submenu with correct checkmarks
  const defaultMenu = await buildPetContextMenuTemplate({
    label: "Hide pet",
    click: () => {},
    defaultPet: true,
  });

  const defaultSizeItem = defaultMenu.find((item) => Array.isArray(item.submenu));
  assert.ok(defaultSizeItem, "default pet menu includes a submenu for Size");
  const defaultSubmenu = defaultSizeItem.submenu as Electron.MenuItemConstructorOptions[];
  assert.equal(defaultSubmenu.length, petScaleOptions.length, "size submenu contains all scale options");

  const mediumOption = defaultSubmenu.find((opt) => opt.label === "Medium");
  assert.ok(mediumOption, "Medium scale option is present");
  assert.equal(mediumOption.checked, true, "Medium option is initially checked");

  const hugeOption = defaultSubmenu.find((opt) => opt.label === "Huge");
  assert.ok(hugeOption, "Huge scale option is present");
  assert.equal(hugeOption.checked, false, "Huge option is initially unchecked");

  // 3. Selecting a different size option updates both global scales.
  if (typeof hugeOption.click === "function") {
    hugeOption.click({} as any, undefined as any, undefined as any);
  }
  assert.equal(getAppStateSnapshot().preferences.petScale, 1.5, "clicking Huge updates the global petScale preference");
  assert.equal(getAppStateSnapshot().preferences.hudScale, 2, "clicking Huge updates the global HUD scale preference");

  // 4. Next menu build reflects the newly selected size as checked
  const updatedDefaultMenu = await buildPetContextMenuTemplate({
    label: "Hide pet",
    click: () => {},
    defaultPet: true,
  });
  const updatedSizeItem = updatedDefaultMenu.find((item) => Array.isArray(item.submenu));
  const updatedSubmenu = updatedSizeItem?.submenu as Electron.MenuItemConstructorOptions[];
  const updatedHugeOption = updatedSubmenu.find((opt) => opt.label === "Huge");
  const updatedMediumOption = updatedSubmenu.find((opt) => opt.label === "Medium");
  assert.equal(updatedHugeOption?.checked, true, "Huge option is now checked");
  assert.equal(updatedMediumOption?.checked, false, "Medium option is no longer checked");

  // 5. Agent pet context menu also includes the Size submenu and reflects the same global preference
  const agentMenu = await buildPetContextMenuTemplate({
    label: "Close pet",
    click: () => {},
    petId: "fox",
  });
  const agentSizeItem = agentMenu.find((item) => Array.isArray(item.submenu));
  assert.ok(agentSizeItem, "agent pet menu includes Size submenu");
  const agentSubmenu = agentSizeItem.submenu as Electron.MenuItemConstructorOptions[];
  const agentHugeOption = agentSubmenu.find((opt) => opt.label === "Huge");
  assert.equal(agentHugeOption?.checked, true, "agent pet menu reflects global Huge scale");

  // 6. Direct scale change through handlePetScaleChange updates preference across all stepped tiers
  handlePetScaleChange(0.75 as PetScaleValue);
  assert.equal(getAppStateSnapshot().preferences.petScale, 0.75, "handlePetScaleChange updates global preference to Small");
  assert.equal(getAppStateSnapshot().preferences.hudScale, 1.1, "Small pet size uses the Small HUD scale (1.1)");

  handlePetScaleChange(0.5 as PetScaleValue);
  assert.equal(getAppStateSnapshot().preferences.petScale, 0.5, "handlePetScaleChange updates global preference to XS");
  assert.equal(getAppStateSnapshot().preferences.hudScale, 0.85, "XS pet size uses the minimum HUD scale (0.85)");

  handlePetScaleChange(1.25 as PetScaleValue);
  assert.equal(getAppStateSnapshot().preferences.petScale, 1.25, "handlePetScaleChange updates global preference to Large");
  assert.equal(getAppStateSnapshot().preferences.hudScale, 1.7, "Large pet size uses the Large HUD scale (1.7)");

  handlePetScaleChange(1 as PetScaleValue);
  assert.equal(getAppStateSnapshot().preferences.petScale, 1, "handlePetScaleChange updates global preference to Medium");
  assert.equal(getAppStateSnapshot().preferences.hudScale, 1.4, "Medium pet size uses the Medium HUD scale (1.4)");
} finally {
  releaseStartupInstallLock();
  rmSync(userDataPath, { recursive: true, force: true });
}
