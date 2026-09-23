import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  type IpcMainEvent,
} from "electron";

import {
  getAppStateSnapshot,
  getHudScaleForPetScale,
  isPetFlippedHorizontally,
  petScaleOptions,
  togglePetHorizontalFlip,
  updatePreferences,
  type PetScaleValue,
} from "./app-state.js";
import { isFocusActionAvailable } from "./capabilities.js";
import { t } from "./i18n/index.js";
import { error as logError, info } from "./logger.js";
import {
  executeDefaultPetPluginCommand,
  executeDefaultPetPluginMenuSelect,
  getDefaultPetPluginCommands,
  getDefaultPetPluginMenuItems,
} from "./plugin-service.js";
import type { PluginCommandForm } from "./plugin-sdk-bridge.js";
import { escapeHtml } from "./pet-window-render.js";

export function installPetContextMenu(
  window: BrowserWindow,
  action: {
    readonly label: string;
    readonly click: () => void;
    readonly defaultPet?: boolean;
    readonly petId?: string;
    readonly focusSessionWindow?: () => void;
  },
  shouldUseLayerShellBackend: () => boolean,
): void {
  const webContents = window.webContents;
  let layerShellClicks: Array<() => void> = [];

  const handleContextMenu = (event: Electron.Event, params: Electron.ContextMenuParams): void => {
    event.preventDefault();
    if (window.isDestroyed()) return;
    if (shouldUseLayerShellBackend()) {
      void buildPetContextMenuTemplate(action).then((template) => {
        let nextClickIndex = 0;
        layerShellClicks = [];
        const flatten = (items: readonly Electron.MenuItemConstructorOptions[]): unknown[] => items.map((item) => {
          if (item.type === "separator") {
            return { type: "separator" };
          }

          const label = item.type === "checkbox"
            ? `${item.checked ? "✓ " : "  "}${item.label ?? ""}`
            : item.label;
          const out: {
            label?: string;
            submenu?: unknown[];
            clickIndex?: number;
            type?: string;
            checked?: boolean;
          } = {
            label,
            ...(item.type ? { type: item.type } : {}),
            ...(item.checked !== undefined ? { checked: item.checked } : {}),
          };
          if (item.submenu) {
            out.submenu = flatten(item.submenu as readonly Electron.MenuItemConstructorOptions[]);
          }
          if (typeof item.click === "function") {
            out.clickIndex = nextClickIndex++;
            layerShellClicks.push(item.click as unknown as () => void);
          }
          return out;
        });
        webContents.send("openpets:pet-menu-data", {
          x: params.x,
          y: params.y,
          items: flatten(template),
        });
      }).catch((error: unknown) => {
        logError(
          "pet.window",
          "layer-shell context menu build failed",
          error instanceof Error ? error : { error },
        );
      });
      return;
    }
    void buildPetContextMenuTemplate(action)
      .then((template) => Menu.buildFromTemplate(template).popup({ window }))
      .catch((error) => {
        logError("pet.window", "context menu build failed", error);
        Menu.buildFromTemplate([
          { label: action.label, click: action.click },
        ]).popup({ window });
      });
  };

  const handleLayerShellSelect = (event: IpcMainEvent, index: unknown): void => {
    if (event.sender !== webContents || !shouldUseLayerShellBackend()) {
      return;
    }
    const click = layerShellClicks[Number(index)];
    layerShellClicks = [];
    if (click) {
      click();
    }
  };

  webContents.on("context-menu", handleContextMenu);
  ipcMain.on("openpets:pet-menu-select", handleLayerShellSelect);
  window.once("closed", () => {
    if (!webContents.isDestroyed()) {
      webContents.off("context-menu", handleContextMenu);
    }
    ipcMain.removeListener("openpets:pet-menu-select", handleLayerShellSelect);
  });
}

function handlePetHorizontalFlipToggle(petId: string): void {
  const flipped = togglePetHorizontalFlip(petId);
  info("pet.window", "pet horizontal flip toggled", { petId, flipped });
  const defaultPetId = getAppStateSnapshot().preferences.defaultPetId;
  if (petId === defaultPetId) {
    void import("./default-pet-controller.js")
      .then(({ refreshDefaultPetContent }) => refreshDefaultPetContent())
      .catch((error) => {
        logError(
          "pet.window",
          "refresh default pet on flip failed",
          error instanceof Error ? error : { error },
        );
      });
  }
  void import("./agent-pet-controller.js")
    .then(({ refreshAgentPetContent }) => refreshAgentPetContent(petId))
    .catch((error) => {
      logError(
        "pet.window",
        "refresh agent pet on flip failed",
        error instanceof Error ? error : { error },
      );
    });
  void import("./plugin-pet-registry.js")
    .then(({ refreshPluginPetsForPetId }) => refreshPluginPetsForPetId(petId))
    .catch((error) => {
      logError(
        "pet.window",
        "refresh plugin pet on flip failed",
        error instanceof Error ? error : { error },
      );
    });
  void import("./lan-pet-controller.js")
    .then(({ refreshLanVisitingPetsForPetId }) => refreshLanVisitingPetsForPetId(petId))
    .catch((error) => {
      logError(
        "pet.window",
        "refresh lan pet on flip failed",
        error instanceof Error ? error : { error },
      );
    });
}

export function handlePetScaleChange(scale: PetScaleValue): void {
  const previousPreferences = getAppStateSnapshot().preferences;
  const hudScale = getHudScaleForPetScale(scale);
  if (scale === previousPreferences.petScale && hudScale === previousPreferences.hudScale) {
    return;
  }

  updatePreferences({ petScale: scale, hudScale });
  info("pet.window", "pet and HUD scale changed from context menu", {
    petScale: scale,
    hudScale,
    previousPetScale: previousPreferences.petScale,
    previousHudScale: previousPreferences.hudScale,
  });
  void import("./default-pet-controller.js")
    .then(({ refreshDefaultPetContent }) => refreshDefaultPetContent())
    .catch((error) => {
      logError(
        "pet.window",
        "refresh default pet on scale change failed",
        error instanceof Error ? error : { error },
      );
    });
  void import("./agent-pet-controller.js")
    .then(({ refreshAgentPetContent }) => refreshAgentPetContent())
    .catch((error) => {
      logError(
        "pet.window",
        "refresh agent pet on scale change failed",
        error instanceof Error ? error : { error },
      );
    });
}

export async function buildPetContextMenuTemplate(
  action: {
    readonly label: string;
    readonly click: () => void;
    readonly defaultPet?: boolean;
    readonly petId?: string;
    readonly focusSessionWindow?: () => void;
  },
): Promise<Electron.MenuItemConstructorOptions[]> {
  const currentPetId = action.petId ?? getAppStateSnapshot().preferences.defaultPetId;
  const isFlipped = isPetFlippedHorizontally(currentPetId);
  const currentScale = getAppStateSnapshot().preferences.petScale;

  const sizeMenuItem: Electron.MenuItemConstructorOptions = {
    label: t("pet.menu.size"),
    submenu: petScaleOptions.map((option) => {
      return {
        label: option.label,
        type: "checkbox",
        checked: currentScale === option.value,
        click: () => {
          handlePetScaleChange(option.value);
        },
      };
    }),
  };

  const flipMenuItem: Electron.MenuItemConstructorOptions = {
    label: t("pet.menu.flipHorizontally"),
    type: "checkbox",
    checked: isFlipped,
    click: () => {
      handlePetHorizontalFlipToggle(currentPetId);
    },
  };

  if (!action.defaultPet) {
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (action.focusSessionWindow) {
      const a11yReady = isFocusActionAvailable();
      const focusLabel = a11yReady
        ? t("pet.menu.focusSessionWindow")
        : t("pet.menu.focusSessionWindowNoA11y");
      template.push(
        { label: focusLabel, click: action.focusSessionWindow },
        { type: "separator" },
      );
    }
    template.push(
      sizeMenuItem,
      flipMenuItem,
      { type: "separator" },
      { label: action.label, click: action.click },
    );
    return template;
  }

  const commands = await getDefaultPetPluginCommands();
  // Root-level plugin actions stay grouped per plugin, so live controls from
  // two plugins (e.g. a timer and a focus session) never interleave.
  const topLevel = new Map<string, Electron.MenuItemConstructorOptions[]>();
  const plugins = new Map<string, { name: string; commands: Electron.MenuItemConstructorOptions[] }>();
  const sorted = [...commands].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const command of sorted) {
    const item: Electron.MenuItemConstructorOptions = {
      label: command.commandTitle,
      click: () => {
        if (command.form) {
          openPluginCommandForm(command).catch((error) => {
            logError("pet.window", "plugin command form failed", error);
          });
          return;
        }

        executeDefaultPetPluginCommand(command.pluginId, command.commandId).catch((error) => {
          logError("pet.window", "plugin command failed", error);
        });
      },
    };
    if (command.placement === "top" || command.featured) {
      const pluginTopLevel = topLevel.get(command.pluginId) ?? [];
      pluginTopLevel.push(item);
      topLevel.set(command.pluginId, pluginTopLevel);
      continue;
    }
    const group = plugins.get(command.pluginId) ?? { name: command.pluginName, commands: [] };
    group.commands.push(item);
    plugins.set(command.pluginId, group);
  }
  // Fully dynamic per-plugin menu sections (ui.menu.setItems).
  const menuItems = await getDefaultPetPluginMenuItems();
  for (const item of menuItems) {
    const group = plugins.get(item.pluginId) ?? { name: item.pluginName, commands: [] };
    group.commands.push({
      label: item.title,
      enabled: item.enabled !== false,
      type: item.checked === true ? "checkbox" : "normal",
      checked: item.checked === true ? true : undefined,
      click: () => {
        executeDefaultPetPluginMenuSelect(item.pluginId, item.itemId).catch((error) => {
          logError("pet.window", "plugin menu select failed", error);
        });
      },
    });
    plugins.set(item.pluginId, group);
  }
  const template: Electron.MenuItemConstructorOptions[] = [];
  const openControlCenter = (route: "dashboard" | "plugins"): void => {
    import("./windows.js")
      .then(({ openControlCenterWindow }) => openControlCenterWindow(route))
      .catch((error) => {
        logError("pet.window", "open control center failed", error);
      });
  };
  for (const pluginTopLevel of topLevel.values()) {
    template.push(...pluginTopLevel, { type: "separator" });
  }
  if (plugins.size > 0) {
    template.push(
      ...[...plugins.values()].map((plugin) => ({
        label: plugin.name,
        submenu: plugin.commands,
      })),
      { type: "separator" },
    );
  }
  template.push(
    {
      label: t("tray.plugins"),
      click: () => {
        openControlCenter("plugins");
      },
    },
    {
      label: t("pet.menu.openControlCenter"),
      click: () => {
        openControlCenter("dashboard");
      },
    },
    sizeMenuItem,
    flipMenuItem,
    { type: "separator" },
    { label: action.label, click: action.click },
  );
  return template;
}

async function openPluginCommandForm(
  command: {
    readonly pluginId: string;
    readonly commandId: string;
    readonly commandTitle: string;
    readonly form?: PluginCommandForm;
  },
): Promise<void> {
  if (!command.form) {
    return;
  }

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) ?? screen.getPrimaryDisplay();
  const maxWidth = Math.max(420, display.workArea.width - 48);
  const maxHeight = Math.max(360, display.workArea.height - 48);
  const width = Math.min(620, maxWidth);
  const height = Math.min(Math.max(380, estimatePluginCommandFormHeight(command.form)), maxHeight);
  const window = new BrowserWindow({
    title: command.commandTitle,
    width,
    height,
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + (display.workArea.height - height) / 2),
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    parent: BrowserWindow.getFocusedWindow() ?? undefined,
    modal: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: `${app.getAppPath()}/plugin-command-form-preload.cjs`,
    },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => {
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  const token = `plugin-command-form-${window.id}`;
  const resizeToken = `plugin-command-form-resize-${window.id}`;
  ipcMain.handle(token, async (event, values: unknown) => {
    if (event.sender !== window.webContents) {
      throw new Error("Invalid command form sender.");
    }
    const result = await executeDefaultPetPluginCommand(
      command.pluginId,
      command.commandId,
      isRecord(values) ? values : {},
    );
    if (!window.isDestroyed()) {
      window.close();
    }
    return result;
  });
  ipcMain.on(resizeToken, (event, size: unknown) => {
    if (event.sender !== window.webContents || window.isDestroyed() || !isRecord(size)) {
      return;
    }
    const nextWidth = clampNumber(Number(size.width), 420, maxWidth);
    const nextHeight = clampNumber(Number(size.height), 260, maxHeight);
    const [currentWidth, currentHeight] = window.getContentSize();
    if (Math.abs(currentWidth - nextWidth) < 8 && Math.abs(currentHeight - nextHeight) < 8) {
      return;
    }
    window.setContentSize(Math.round(nextWidth), Math.round(nextHeight));
    const bounds = window.getBounds();
    const nextX = Math.min(
      Math.max(bounds.x, display.workArea.x),
      display.workArea.x + display.workArea.width - bounds.width,
    );
    const nextY = Math.min(
      Math.max(bounds.y, display.workArea.y),
      display.workArea.y + display.workArea.height - bounds.height,
    );
    if (nextX !== bounds.x || nextY !== bounds.y) {
      window.setPosition(Math.round(nextX), Math.round(nextY));
    }
  });
  window.once("closed", () => {
    ipcMain.removeHandler(token);
    ipcMain.removeAllListeners(resizeToken);
  });
  await window.loadURL(buildPluginCommandFormUrl(command.commandTitle, command.form, token, resizeToken));
  window.show();
}

function estimatePluginCommandFormHeight(form: PluginCommandForm): number {
  const fieldHeight = form.fields.reduce((total, field) => {
    if (field.type === "textarea" || field.type === "list") {
      return total + 170;
    }
    if (field.type === "boolean") {
      return total + 76;
    }
    return total + 100;
  }, 0);
  return 170 + fieldHeight;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function buildPluginCommandFormUrl(
  title: string,
  form: PluginCommandForm,
  channel: string,
  resizeChannel: string,
): string {
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'";
  const data = JSON.stringify({ title, form, channel, resizeChannel }).replace(/</g, "\\u003c");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escapeHtml(title)}</title><style>*{box-sizing:border-box}html,body{margin:0;min-width:0}body{font:14px system-ui,"Hiragino Sans","Yu Gothic","Malgun Gothic","Apple SD Gothic Neo","PingFang SC","PingFang TC","Microsoft YaHei","Microsoft JhengHei","Noto Sans CJK JP","Noto Sans CJK KR","Noto Sans CJK SC","Noto Sans CJK TC",sans-serif;background:#fff;color:#161616;overflow:hidden}.wrap{padding:24px}h1{font-size:20px;line-height:1.2;margin:0 0 18px}.field{margin-top:14px}label{display:block;font-weight:700;margin:0 0 7px}.hint{display:block;color:#64748b;font-size:12px;line-height:1.35;margin-top:5px}input,textarea,select{width:100%;border:1px solid #aeb8c8;border-radius:10px;padding:11px 12px;font:inherit;outline:none;background:white;color:#161616}input:focus,textarea:focus,select:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.16)}textarea{min-height:148px;resize:vertical}.check{display:flex;align-items:center;gap:10px;font-weight:700}.check input{width:auto}.error{color:#b00020;min-height:20px;margin-top:10px}.buttons{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}button{border:0;border-radius:10px;padding:10px 14px;font:inherit;font-weight:700}button.primary{background:#2563eb;color:white}</style></head><body><form class="wrap"><h1></h1><div id="fields"></div><div class="error" role="alert"></div><div class="buttons"><button type="button" id="cancel">${escapeHtml(t("common.cancel"))}</button><button class="primary" type="submit"></button></div></form><script>const data=${data};const api=window.openPetsCommandForm;const form=document.querySelector('form'),fields=document.getElementById('fields'),err=document.querySelector('.error');document.querySelector('h1').textContent=data.title;document.querySelector('.primary').textContent=data.form.submitLabel||'Set';const values={};function resize(){requestAnimationFrame(()=>{const root=document.documentElement;api.resize(data.resizeChannel,{width:Math.ceil(Math.max(root.scrollWidth,document.body.scrollWidth)+2),height:Math.ceil(Math.max(root.scrollHeight,document.body.scrollHeight)+2)});});}function addOption(select,option){const el=document.createElement('option');el.value=option.value;el.textContent=option.label||option.value;select.appendChild(el);}for(const f of data.form.fields){const box=document.createElement('div');box.className='field';const label=document.createElement('label');label.textContent=f.label;label.htmlFor=f.id;let input;if(f.type==='textarea'){input=document.createElement('textarea');}else if(f.type==='select'){input=document.createElement('select');for(const option of f.options||[])addOption(input,option);}else if(f.type==='boolean'){label.className='check';input=document.createElement('input');input.type='checkbox';label.prepend(input);}else{input=document.createElement('input');if(f.type==='number')input.type='number';else if(f.type==='time')input.type='time';else if(f.type==='date')input.type='date';else input.type='text';}input.id=f.id;input.name=f.id;if(f.default!==undefined){if(input.type==='checkbox')input.checked=Boolean(f.default);else input.value=f.default;}if(f.min!==undefined)input.min=f.min;if(f.max!==undefined)input.max=f.max;if(f.maxLength!==undefined)input.maxLength=f.maxLength;if(f.required)input.required=true;if(f.type==='boolean'){box.append(label);}else{box.append(label,input);}fields.append(box);input.addEventListener('input',resize);}new ResizeObserver(resize).observe(document.body);resize();form.addEventListener('submit',async(event)=>{event.preventDefault();err.textContent='';for(const f of data.form.fields){const el=form.elements[f.id];values[f.id]=el.type==='number'?Number(el.value):el.type==='checkbox'?Boolean(el.checked):el.value;}try{await api.submit(data.channel,values);}catch(error){err.textContent=String(error&&error.message||error);resize();}});document.getElementById('cancel').addEventListener('click',()=>api.close());</script></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
