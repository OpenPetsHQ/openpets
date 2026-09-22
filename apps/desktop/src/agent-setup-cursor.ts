import { buildCursorRulesPreview, classifyCursorMcpStatus, executeCursorMcpWrite, getCursorGlobalMcpPath, planCursorMcpInstall, planCursorMcpRemove, planCursorMcpReplace, readCursorMcpConfig, type CursorMcpStatusResult, buildOpenPetsOnlyPreview, type RedactedPreview } from "@open-pets/cursor";

export interface CursorSetupStatus {
  readonly state: "configured" | "needs_setup" | "not_detected" | "error" | "conflict" | "needs_update";
  readonly label: string;
  readonly details: string;
  readonly configPath: string;
  readonly canInstall: boolean;
  readonly canReplace: boolean;
  readonly canRemove: boolean;
}

export interface CursorSetupPreview {
  readonly global: true;
  readonly configPath: string;
  readonly mcpEntry: RedactedPreview;
  readonly rulesPath: string;
  readonly rulesContent: string;
  readonly commandMode: "published" | "local" | "bundled";
}

export type CursorSetupAction = "cursor-install" | "cursor-replace" | "cursor-remove";

export interface CursorSetupActionResult {
  readonly ok: boolean;
  readonly action: CursorSetupAction;
  readonly message: string;
  readonly changed: boolean;
}

export interface CursorSetupDependencies {
  readonly homeDir: string;
  readonly mcpVersion: string;
  readonly formatUserPath: (path: string | undefined) => string | undefined;
}

export async function getCursorSetup(selectedPetId: string | undefined, dependencies: CursorSetupDependencies): Promise<{ readonly status: CursorSetupStatus; readonly preview: CursorSetupPreview }> {
  const configPath = getCursorGlobalMcpPath(dependencies.homeDir);
  const petId = selectedPetId || undefined;
  const configResult = readCursorMcpConfig(configPath);
  const statusResult = classifyCursorMcpStatus(configResult, configPath, { mcpVersion: dependencies.mcpVersion, petId, commandMode: "published" });

  return {
    status: {
      state: mapCursorStatusToState(statusResult.status),
      label: mapCursorStatusToLabel(statusResult.status),
      details: statusResult.message,
      configPath: dependencies.formatUserPath(configPath) ?? configPath,
      canInstall: statusResult.canInstall,
      canReplace: statusResult.canReplace,
      canRemove: statusResult.canRemove,
    },
    preview: {
      global: true,
      configPath: dependencies.formatUserPath(configPath) ?? configPath,
      mcpEntry: buildOpenPetsOnlyPreview({ mcpVersion: dependencies.mcpVersion, petId, commandMode: "published" }),
      rulesPath: ".cursor/rules/openpets.mdc",
      rulesContent: buildCursorRulesPreview(),
      commandMode: "published",
    },
  };
}

export async function installCursorGlobal(selectedPetId: string | undefined, dependencies: CursorSetupDependencies): Promise<CursorSetupActionResult> {
  try {
    const configPath = getCursorGlobalMcpPath(dependencies.homeDir);
    const plan = planCursorMcpInstall(configPath, { mcpVersion: dependencies.mcpVersion, petId: selectedPetId || undefined, commandMode: "published" });
    if ("ok" in plan && !plan.ok) {
      return { ok: false, action: "cursor-install", message: plan.message, changed: false };
    }
    if ("targetPath" in plan) {
      executeCursorMcpWrite(plan);
      const backupMsg = plan.backupPath ? ` Backup: ${dependencies.formatUserPath(plan.backupPath) ?? plan.backupPath}.` : "";
      return { ok: true, action: "cursor-install", message: `Installed Cursor OpenPets MCP config at ${dependencies.formatUserPath(configPath) ?? configPath}.${backupMsg} Cursor may need to be restarted or reloaded.`, changed: true };
    }
    return { ok: false, action: "cursor-install", message: "Failed to plan Cursor MCP install.", changed: false };
  } catch (error) {
    return { ok: false, action: "cursor-install", message: error instanceof Error ? error.message : "Cursor MCP install failed.", changed: false };
  }
}

export async function replaceCursorGlobal(selectedPetId: string | undefined, dependencies: CursorSetupDependencies): Promise<CursorSetupActionResult> {
  try {
    const configPath = getCursorGlobalMcpPath(dependencies.homeDir);
    const plan = planCursorMcpReplace(configPath, { mcpVersion: dependencies.mcpVersion, petId: selectedPetId || undefined, commandMode: "published" });
    if ("ok" in plan && !plan.ok) {
      return { ok: false, action: "cursor-replace", message: plan.message, changed: false };
    }
    if ("targetPath" in plan) {
      executeCursorMcpWrite(plan);
      const backupMsg = plan.backupPath ? ` Backup: ${dependencies.formatUserPath(plan.backupPath) ?? plan.backupPath}.` : "";
      return { ok: true, action: "cursor-replace", message: `Replaced Cursor OpenPets MCP config at ${dependencies.formatUserPath(configPath) ?? configPath}.${backupMsg} Cursor may need to be restarted or reloaded.`, changed: true };
    }
    return { ok: false, action: "cursor-replace", message: "Failed to plan Cursor MCP replace.", changed: false };
  } catch (error) {
    return { ok: false, action: "cursor-replace", message: error instanceof Error ? error.message : "Cursor MCP replace failed.", changed: false };
  }
}

export async function removeCursorGlobal(dependencies: CursorSetupDependencies): Promise<CursorSetupActionResult> {
  try {
    const configPath = getCursorGlobalMcpPath(dependencies.homeDir);
    const plan = planCursorMcpRemove(configPath);
    if ("ok" in plan && !plan.ok) {
      return { ok: false, action: "cursor-remove", message: plan.message, changed: false };
    }
    if ("targetPath" in plan) {
      executeCursorMcpWrite(plan);
      return { ok: true, action: "cursor-remove", message: `Removed Cursor OpenPets MCP config at ${dependencies.formatUserPath(configPath) ?? configPath}. Cursor may need to be restarted or reloaded.`, changed: true };
    }
    return { ok: false, action: "cursor-remove", message: "Failed to plan Cursor MCP remove.", changed: false };
  } catch (error) {
    return { ok: false, action: "cursor-remove", message: error instanceof Error ? error.message : "Cursor MCP remove failed.", changed: false };
  }
}

function mapCursorStatusToState(status: CursorMcpStatusResult["status"]): CursorSetupStatus["state"] {
  switch (status) {
    case "installed":
      return "configured";
    case "missing":
      return "needs_setup";
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

function mapCursorStatusToLabel(status: CursorMcpStatusResult["status"]): string {
  switch (status) {
    case "installed":
      return "Configured";
    case "missing":
      return "Not configured";
    case "needs-update":
      return "Needs update";
    case "conflict":
      return "Conflict";
    case "invalid":
    case "error":
      return "Config error";
    default:
      return "Checking";
  }
}
