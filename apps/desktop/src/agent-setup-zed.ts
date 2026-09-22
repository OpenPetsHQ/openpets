import {
  buildZedMcpEntry,
  classifyZedMcpStatus,
  executeZedMcpWrite,
  planZedMcpInstall,
  planZedMcpRemove,
  planZedMcpReplace,
  readZedSettings,
  type ZedCommandMode,
  type ZedMcpEntry,
  type ZedMcpPreviewOptions,
  type ZedMcpStatusResult,
} from "@open-pets/zed";

export interface ZedSetupStatus {
  readonly state: "configured" | "needs_setup" | "disabled" | "needs_update" | "conflict" | "error";
  readonly label: string;
  readonly details: string;
  readonly settingsPath: string;
  readonly canInstall: boolean;
  readonly canReplace: boolean;
  readonly canRemove: boolean;
}

export interface ZedSetupPreview {
  readonly global: true;
  readonly settingsPath: string;
  readonly mcpEntry: ZedMcpEntry;
  readonly commandMode: ZedCommandMode;
}

export type ZedSetupAction = "zed-install" | "zed-replace" | "zed-remove";

export interface ZedSetupActionResult {
  readonly ok: boolean;
  readonly action: ZedSetupAction;
  readonly message: string;
  readonly changed: boolean;
}

export interface ZedSetupDependencies {
  readonly settingsPath: string;
  readonly selectedPetId?: string;
  readonly commandMode: ZedCommandMode;
  readonly mcpVersion: string;
  readonly mcpEntryPath?: string;
  readonly nodeCommand?: string;
  readonly formatUserPath: (path: string | undefined) => string | undefined;
  readonly checkNodeCommand: () => Promise<string | undefined>;
  readonly finishAction: (
    action: ZedSetupAction,
    selectedPetId: string | undefined,
    previousStatus: string,
    result: ZedSetupActionResult,
  ) => void;
}

export async function getZedSetup(dependencies: ZedSetupDependencies): Promise<{ readonly status: ZedSetupStatus; readonly preview: ZedSetupPreview }> {
  const options = buildPreviewOptions(dependencies, dependencies.selectedPetId);
  const statusResult = classifyZedMcpStatus(readZedSettings(dependencies.settingsPath), dependencies.settingsPath, options);

  return {
    status: {
      state: mapZedStatusToState(statusResult.status),
      label: mapZedStatusToLabel(statusResult.status),
      details: statusResult.message,
      settingsPath: dependencies.formatUserPath(dependencies.settingsPath) ?? dependencies.settingsPath,
      canInstall: statusResult.canInstall,
      canReplace: statusResult.canReplace,
      canRemove: statusResult.canRemove,
    },
    preview: {
      global: true,
      settingsPath: dependencies.formatUserPath(dependencies.settingsPath) ?? dependencies.settingsPath,
      mcpEntry: statusResult.previewEntry ?? buildZedMcpEntry(options),
      commandMode: dependencies.commandMode,
    },
  };
}

export async function installZedGlobal(dependencies: ZedSetupDependencies): Promise<ZedSetupActionResult> {
  const action = "zed-install" as const;
  try {
    const options = buildPreviewOptions(dependencies, dependencies.selectedPetId);
    const current = classifyZedMcpStatus(readZedSettings(dependencies.settingsPath), dependencies.settingsPath, options);
    const nodeError = await dependencies.checkNodeCommand();
    if (nodeError) {
      return finish(dependencies, action, current.status, {
        ok: false,
        action,
        message: nodeError,
        changed: false,
      });
    }

    const plan = planZedMcpInstall(dependencies.settingsPath, options);
    if ("ok" in plan && !plan.ok) {
      return finish(dependencies, action, current.status, {
        ok: false,
        action,
        message: plan.message,
        changed: false,
      });
    }
    if (!("targetPath" in plan)) {
      return finish(dependencies, action, current.status, {
        ok: false,
        action,
        message: "Failed to plan Zed MCP install.",
        changed: false,
      });
    }

    executeZedMcpWrite(plan);
    const backupMessage = plan.backupPath ? ` Backup: ${dependencies.formatUserPath(plan.backupPath) ?? plan.backupPath}.` : "";
    return finish(dependencies, action, current.status, {
      ok: true,
      action,
      message: `Installed OpenPets MCP in Zed at ${dependencies.formatUserPath(dependencies.settingsPath) ?? dependencies.settingsPath}.${backupMessage} Restart or reload Zed to load OpenPets.`,
      changed: true,
    });
  } catch (error) {
    return finish(dependencies, action, "unknown", {
      ok: false,
      action,
      message: error instanceof Error ? error.message : "Zed MCP install failed.",
      changed: false,
    });
  }
}

export async function replaceZedGlobal(dependencies: ZedSetupDependencies): Promise<ZedSetupActionResult> {
  const action = "zed-replace" as const;
  try {
    const options = buildPreviewOptions(dependencies, dependencies.selectedPetId);
    const current = classifyZedMcpStatus(readZedSettings(dependencies.settingsPath), dependencies.settingsPath, options);
    const nodeError = await dependencies.checkNodeCommand();
    if (nodeError) {
      return finish(dependencies, action, current.status, {
        ok: false,
        action,
        message: nodeError,
        changed: false,
      });
    }

    const plan = planZedMcpReplace(dependencies.settingsPath, options);
    if ("ok" in plan && !plan.ok) {
      return finish(dependencies, action, current.status, {
        ok: false,
        action,
        message: plan.message,
        changed: false,
      });
    }
    if (!("targetPath" in plan)) {
      return finish(dependencies, action, current.status, {
        ok: false,
        action,
        message: "Failed to plan Zed MCP replace.",
        changed: false,
      });
    }

    executeZedMcpWrite(plan);
    const backupMessage = plan.backupPath ? ` Backup: ${dependencies.formatUserPath(plan.backupPath) ?? plan.backupPath}.` : "";
    return finish(dependencies, action, current.status, {
      ok: true,
      action,
      message: `Replaced OpenPets MCP in Zed at ${dependencies.formatUserPath(dependencies.settingsPath) ?? dependencies.settingsPath}.${backupMessage} Restart or reload Zed to load OpenPets.`,
      changed: true,
    });
  } catch (error) {
    return finish(dependencies, action, "unknown", {
      ok: false,
      action,
      message: error instanceof Error ? error.message : "Zed MCP replace failed.",
      changed: false,
    });
  }
}

export async function removeZedGlobal(dependencies: ZedSetupDependencies): Promise<ZedSetupActionResult> {
  const action = "zed-remove" as const;
  try {
    const options = buildPreviewOptions(dependencies, undefined);
    const current = classifyZedMcpStatus(readZedSettings(dependencies.settingsPath), dependencies.settingsPath, options);
    const plan = planZedMcpRemove(dependencies.settingsPath, options);
    if ("ok" in plan && !plan.ok) {
      return finish(dependencies, action, current.status, {
        ok: false,
        action,
        message: plan.message,
        changed: false,
      });
    }
    if (!("targetPath" in plan)) {
      return finish(dependencies, action, current.status, {
        ok: false,
        action,
        message: "Failed to plan Zed MCP remove.",
        changed: false,
      });
    }

    executeZedMcpWrite(plan);
    return finish(dependencies, action, current.status, {
      ok: true,
      action,
      message: `Removed OpenPets MCP from Zed at ${dependencies.formatUserPath(dependencies.settingsPath) ?? dependencies.settingsPath}. Restart or reload Zed to apply the change.`,
      changed: true,
    });
  } catch (error) {
    return finish(dependencies, action, "unknown", {
      ok: false,
      action,
      message: error instanceof Error ? error.message : "Zed MCP remove failed.",
      changed: false,
    });
  }
}

function buildPreviewOptions(dependencies: ZedSetupDependencies, selectedPetId: string | undefined): ZedMcpPreviewOptions {
  return {
    mcpVersion: dependencies.mcpVersion,
    petId: selectedPetId || undefined,
    commandMode: dependencies.commandMode,
    mcpEntryPath: dependencies.commandMode === "published" ? undefined : dependencies.mcpEntryPath,
    nodeCommand: dependencies.commandMode === "published" ? undefined : dependencies.nodeCommand,
  };
}

function finish(
  dependencies: ZedSetupDependencies,
  action: ZedSetupAction,
  previousStatus: string,
  result: ZedSetupActionResult,
): ZedSetupActionResult {
  dependencies.finishAction(action, dependencies.selectedPetId, previousStatus, result);
  return result;
}

function mapZedStatusToState(status: ZedMcpStatusResult["status"]): ZedSetupStatus["state"] {
  switch (status) {
    case "installed":
      return "configured";
    case "missing":
      return "needs_setup";
    case "disabled":
      return "disabled";
    case "needs-update":
      return "needs_update";
    case "conflict":
      return "conflict";
    case "invalid":
    case "error":
      return "error";
    default:
      return "error";
  }
}

function mapZedStatusToLabel(status: ZedMcpStatusResult["status"]): string {
  switch (status) {
    case "installed":
      return "Configured";
    case "missing":
      return "Not configured";
    case "disabled":
      return "Disabled";
    case "needs-update":
      return "Needs update";
    case "conflict":
      return "Conflict";
    case "invalid":
      return "Config error";
    case "error":
      return "Read error";
    default:
      return "Checking";
  }
}
