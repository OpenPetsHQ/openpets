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
const { setPluginServiceForTests } = await import("../src/plugin-service.js");

try {
  initializeAppState();

  // 1. Initial state: petScale defaults to Medium (0.75)
  assert.equal(getAppStateSnapshot().preferences.petScale, 0.75);

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
  assert.equal(getAppStateSnapshot().preferences.petScale, 1.25, "clicking Huge updates the global petScale preference");
  assert.equal(getAppStateSnapshot().preferences.hudScale, 1.7, "clicking Huge updates the global HUD scale preference");

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
  handlePetScaleChange(0.35 as PetScaleValue);
  assert.equal(getAppStateSnapshot().preferences.petScale, 0.35, "handlePetScaleChange updates global preference to XS");
  assert.equal(getAppStateSnapshot().preferences.hudScale, 0.85, "XS pet size uses the minimum readable HUD scale (0.85)");

  handlePetScaleChange(0.5 as PetScaleValue);
  assert.equal(getAppStateSnapshot().preferences.petScale, 0.5, "handlePetScaleChange updates global preference to Small");
  assert.equal(getAppStateSnapshot().preferences.hudScale, 0.85, "Small pet size keeps the minimum readable HUD scale (0.85)");

  handlePetScaleChange(0.75 as PetScaleValue);
  assert.equal(getAppStateSnapshot().preferences.petScale, 0.75, "handlePetScaleChange updates global preference to Medium");
  assert.equal(getAppStateSnapshot().preferences.hudScale, 1.1, "Medium pet size uses the 1.1 HUD scale");

  handlePetScaleChange(1 as PetScaleValue);
  assert.equal(getAppStateSnapshot().preferences.petScale, 1, "handlePetScaleChange updates global preference to Large");
  assert.equal(getAppStateSnapshot().preferences.hudScale, 1.4, "Large pet size uses the 1.4 HUD scale");

  // 7. Featured/top-placement commands stay inside their plugin group,
  // including forms and Stopwatch controls. There is no eight-plugin cap.
  const timerPlugins = [
    {
      id: "openpets.simple-timer",
      name: "Simple Timer",
      commands: [
        { id: "start-timer", title: "Start timer…", placement: "top", featured: true, form: { submitLabel: "Start", fields: [{ id: "minutes", type: "number", label: "Minutes" }] } },
        { id: "start-stopwatch", title: "Start stopwatch…", placement: "top", featured: true, form: { submitLabel: "Start", fields: [{ id: "label", type: "text", label: "Label" }] } },
        { id: "pause-resume-stopwatch", title: "Pause/resume stopwatch", placement: "top", featured: true },
        { id: "reset-stopwatch", title: "Reset stopwatch", placement: "top", featured: true },
        { id: "show-stopwatch", title: "Show stopwatch", placement: "top", featured: true },
      ],
    },
    { id: "openpets.quick-reminders", name: "Quick Reminders", commands: [{ id: "add-reminder", title: "Add reminder", placement: "top", featured: true }] },
    { id: "openpets.usage-buddy", name: "Usage Buddy", commands: [{ id: "show-usage", title: "Show usage", placement: "top", featured: true }] },
    { id: "openpets.system-resources", name: "System Resources", commands: [{ id: "show-resources", title: "Show resources", placement: "top", featured: true }] },
  ];
  const manyPlugins = Array.from({ length: 5 }, (_, index) => {
    const suffix = String(index + 1).padStart(2, "0");
    return {
      id: `plugin-${suffix}`,
      name: `Plugin ${suffix}`,
      version: "1.0.0",
      source: "catalog",
      enabled: true,
      approvedPermissions: [],
      commands: [{ id: "run", title: `Plugin ${suffix} action`, placement: "top", featured: true }],
    };
  });
  const allPlugins = [...timerPlugins, ...manyPlugins].map((plugin) => ({
    version: "1.0.0",
    source: "catalog",
    enabled: true,
    approvedPermissions: [],
    ...plugin,
  }));
  setPluginServiceForTests({
    getSnapshot: async () => ({ plugins: allPlugins }),
    runtime: { getPluginState: () => ({ commands: [], menuItems: [] }) },
    stop() {},
  } as never);
  const populatedDefaultMenu = await buildPetContextMenuTemplate({
    label: "Hide pet",
    click: () => {},
    defaultPet: true,
  });
  const pluginMenuItems = populatedDefaultMenu.filter((item) =>
    allPlugins.some((plugin) => plugin.name === item.label),
  );
  assert.equal(pluginMenuItems.length, 9, "all nine plugin groups remain accessible");
  for (const plugin of allPlugins) {
    const group = populatedDefaultMenu.find((item) => item.label === plugin.name);
    assert.ok(Array.isArray(group?.submenu), `${plugin.name} remains a submenu`);
    for (const command of plugin.commands) {
      assert.equal(
        populatedDefaultMenu.filter((item) => item.label === command.title).length,
        0,
        `${command.title} must not appear at the pet menu root`,
      );
      const submenu = group.submenu as Electron.MenuItemConstructorOptions[];
      const matches = submenu.filter((item) => item.label === command.title);
      assert.equal(matches.length, 1, `${command.title} appears once in ${plugin.name}`);
      assert.equal(typeof matches[0]?.click, "function", `${command.title} remains actionable`);
    }
  }
  const timerGroup = populatedDefaultMenu.find((item) => item.label === "Simple Timer");
  const timerSubmenu = timerGroup?.submenu as Electron.MenuItemConstructorOptions[];
  assert.ok(timerSubmenu.find((item) => item.label === "Start timer…")?.click, "Start Timer form remains actionable");
  assert.ok(populatedDefaultMenu.some((item) => item.label === "Plugins..."), "built-in Plugins action remains at the root");
  assert.ok(populatedDefaultMenu.some((item) => item.label === "Size"), "built-in Size action remains at the root");
  assert.ok(populatedDefaultMenu.some((item) => item.label === "Flip horizontally"), "built-in flip action remains at the root");
  assert.ok(populatedDefaultMenu.some((item) => item.label === "Hide pet"), "built-in pet action remains at the root");

  // 8. Priority ordering remains local to each plugin submenu.
  const livePlugins = [
    {
      id: "timer",
      name: "Timer",
      version: "1.0.0",
      source: "catalog",
      enabled: true,
      approvedPermissions: [],
      commands: [
        { id: "pause", title: "Pause timer", placement: "top", priority: 3 },
        { id: "cancel", title: "Cancel timer", placement: "top", priority: 1 },
      ],
    },
    {
      id: "focus",
      name: "Focus",
      version: "1.0.0",
      source: "catalog",
      enabled: true,
      approvedPermissions: [],
      commands: [{ id: "end", title: "End focus session", placement: "top", priority: 2 }],
    },
  ];
  setPluginServiceForTests({
    getSnapshot: async () => ({ plugins: livePlugins }),
    runtime: { getPluginState: () => ({ commands: [], menuItems: [] }) },
    stop() {},
  } as never);
  const liveMenu = await buildPetContextMenuTemplate({
    label: "Hide pet",
    click: () => {},
    defaultPet: true,
  });
  const timerMenu = liveMenu.find((item) => item.label === "Timer");
  const focusMenu = liveMenu.find((item) => item.label === "Focus");
  assert.deepEqual(
    (timerMenu?.submenu as Electron.MenuItemConstructorOptions[]).map((item) => item.label),
    ["Pause timer", "Cancel timer"],
    "timer actions remain grouped and priority-ordered in their submenu",
  );
  assert.deepEqual(
    (focusMenu?.submenu as Electron.MenuItemConstructorOptions[]).map((item) => item.label),
    ["End focus session"],
    "focus actions remain inside their own submenu",
  );
  assert.equal(liveMenu.some((item) => ["Pause timer", "Cancel timer", "End focus session"].includes(String(item.label))), false);
} finally {
  setPluginServiceForTests(null);
  releaseStartupInstallLock();
  rmSync(userDataPath, { recursive: true, force: true });
}
