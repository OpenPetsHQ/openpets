import type {
  PluginConfigSoundPickResult,
  PluginService,
  PluginServiceResult,
} from "./plugin-service.js";

export type ControlCenterPluginIpcChannel =
  | "openpets:plugins-snapshot"
  | "openpets:plugins-set-enabled"
  | "openpets:plugins-save-config"
  | "openpets:plugins-pick-config-sound"
  | "openpets:plugins-reload"
  | "openpets:plugins-refresh-local"
  | "openpets:plugins-execute-command"
  | "openpets:plugins-load-local"
  | "openpets:plugins-catalog-snapshot"
  | "openpets:plugins-install-catalog"
  | "openpets:plugins-update-catalog"
  | "openpets:plugins-uninstall"
  | "openpets:plugins-inspector";

export type ControlCenterPluginIpcEvent = {
  readonly sender: { readonly id: number };
};

export type ControlCenterPluginIpcHandler = (event: ControlCenterPluginIpcEvent, ...args: unknown[]) => Promise<unknown>;
export type ControlCenterPluginIpcHandleRegistrar = (channel: ControlCenterPluginIpcChannel, handler: ControlCenterPluginIpcHandler) => void;

export type ControlCenterPluginService = Pick<
  PluginService,
  | "getSnapshot"
  | "setEnabled"
  | "saveConfig"
  | "pickConfigSound"
  | "reload"
  | "refreshLocal"
  | "executeCommand"
  | "loadLocal"
  | "getCatalogSnapshot"
  | "installCatalog"
  | "updateCatalog"
  | "uninstall"
> & {
  readonly runtime: Pick<PluginService["runtime"], "getInspectorState">;
};

export type ControlCenterPluginIpcLogger = {
  readonly debug: (message: string, fields?: Record<string, unknown>) => void;
  readonly warn: (message: string, fields?: Record<string, unknown>) => void;
  readonly error: (message: string, fields?: Record<string, unknown>) => void;
};

export type ControlCenterPluginIpcDependencies = {
  readonly registerHandle: ControlCenterPluginIpcHandleRegistrar;
  readonly authorizeSender: (event: ControlCenterPluginIpcEvent) => void;
  readonly getPluginService: () => ControlCenterPluginService;
  readonly logger: ControlCenterPluginIpcLogger;
};

export function installControlCenterPluginIpcHandlers({
  registerHandle,
  authorizeSender,
  getPluginService,
  logger,
}: ControlCenterPluginIpcDependencies): void {
  registerHandle("openpets:plugins-snapshot", async (event) => {
    authorizeSender(event);
    return getPluginService().getSnapshot();
  });

  registerHandle("openpets:plugins-set-enabled", async (event, id: unknown, enabled: unknown): Promise<PluginServiceResult> => {
    authorizeSender(event);
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id) || typeof enabled !== "boolean") return pluginUiError("Invalid plugin enable request.");
    return getPluginService().setEnabled(id, enabled);
  });

  registerHandle("openpets:plugins-save-config", async (event, id: unknown, config: unknown): Promise<PluginServiceResult> => {
    authorizeSender(event);
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id) || !isPlainObject(config)) return pluginUiError("Invalid plugin config request.");
    return getPluginService().saveConfig(id, config);
  });

  registerHandle("openpets:plugins-pick-config-sound", async (event, id: unknown): Promise<PluginConfigSoundPickResult> => {
    authorizeSender(event);
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id)) {
      logger.warn("Plugin sound pick invalid request.", { ok: false, reason: "invalid-plugin-id" });
      return pluginUiSoundError("Invalid plugin sound request.");
    }
    logger.debug("Plugin sound pick requested.", { pluginId: id });
    try {
      const result = await getPluginService().pickConfigSound(id);
      if (result.ok && "sound" in result && result.sound.id) logger.debug("Plugin sound pick succeeded.", { pluginId: id, ok: true, soundId: result.sound.id });
      else if (result.ok) logger.debug("Plugin sound pick canceled.", { pluginId: id, ok: true, canceled: true });
      else logger.warn("Plugin sound pick failed.", { pluginId: id, ok: false, reason: result.error });
      return result;
    } catch (error) {
      logger.error("Plugin sound pick errored.", { pluginId: id, ok: false, reason: error instanceof Error ? error.message : "unknown" });
      throw error;
    }
  });

  registerHandle("openpets:plugins-reload", async (event, id: unknown): Promise<PluginServiceResult> => {
    authorizeSender(event);
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id)) return pluginUiError("Invalid plugin reload request.");
    return getPluginService().reload(id);
  });

  registerHandle("openpets:plugins-refresh-local", async (event, id: unknown): Promise<PluginServiceResult> => {
    authorizeSender(event);
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id)) return pluginUiError("Invalid plugin refresh request.");
    return getPluginService().refreshLocal(id);
  });

  registerHandle("openpets:plugins-execute-command", async (event, id: unknown, commandId: unknown, args: unknown): Promise<PluginServiceResult> => {
    authorizeSender(event);
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id) || typeof commandId !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(commandId) || (args !== undefined && !isPlainObject(args))) return pluginUiError("Invalid plugin command request.");
    return getPluginService().executeCommand(id, commandId, isPlainObject(args) ? args as Record<string, unknown> : undefined);
  });

  registerHandle("openpets:plugins-load-local", async (event): Promise<PluginServiceResult> => {
    authorizeSender(event);
    return getPluginService().loadLocal();
  });

  registerHandle("openpets:plugins-catalog-snapshot", async (event, refresh: unknown) => {
    authorizeSender(event);
    return getPluginService().getCatalogSnapshot(refresh === true);
  });

  registerHandle("openpets:plugins-install-catalog", async (event, id: unknown): Promise<PluginServiceResult> => {
    authorizeSender(event);
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id)) return pluginUiError("Invalid plugin install request.");
    return getPluginService().installCatalog(id);
  });

  registerHandle("openpets:plugins-update-catalog", async (event, id: unknown): Promise<PluginServiceResult> => {
    authorizeSender(event);
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id)) return pluginUiError("Invalid plugin update request.");
    return getPluginService().updateCatalog(id);
  });

  registerHandle("openpets:plugins-uninstall", async (event, id: unknown): Promise<PluginServiceResult> => {
    authorizeSender(event);
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id)) return pluginUiError("Invalid plugin uninstall request.");
    return getPluginService().uninstall(id);
  });

  registerHandle("openpets:plugins-inspector", async (event, id: unknown) => {
    authorizeSender(event);
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id)) throw new Error("Invalid plugin inspector request.");
    return getPluginService().runtime.getInspectorState(id);
  });
}

function pluginUiError(error: string): PluginServiceResult {
  return { ok: false, error, snapshot: { plugins: [] } };
}

function pluginUiSoundError(error: string): PluginConfigSoundPickResult {
  return { ok: false, error, snapshot: { plugins: [] } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
