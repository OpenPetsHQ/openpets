import {
  buildDevinMcpEntry,
  classifyDevinMcpStatus,
  executeDevinMcpWrite,
  planDevinMcpInstall,
  planDevinMcpRemove,
  planDevinMcpReplace,
  readDevinMcpConfig,
  type DevinCommandMode,
  type DevinConfigError,
  type DevinMcpEntry,
  type DevinMcpPreviewOptions,
  type DevinMcpStatusResult,
  type DevinPlannedWrite,
} from "@open-pets/devin";

export interface DevinSetupStatus {
  readonly state: "configured" | "needs_setup" | "disabled" | "needs_update" | "conflict" | "error";
  readonly label: string;
  readonly details: string;
  readonly configPath: string;
  readonly canInstall: boolean;
  readonly canReplace: boolean;
  readonly canRemove: boolean;
}

export interface DevinSetupPreview {
  readonly global: true;
  readonly configPath: string;
  readonly mcpEntry: DevinMcpEntry;
  readonly commandMode: DevinCommandMode;
}

export type DevinSetupAction = "devin-install" | "devin-replace" | "devin-remove";

export interface DevinSetupActionResult {
  readonly ok: boolean;
  readonly action: DevinSetupAction;
  readonly message: string;
  readonly changed: boolean;
}

export interface DevinSetupDependencies {
  readonly configPath: string;
  readonly selectedPetId?: string;
  readonly commandMode: DevinCommandMode;
  readonly mcpVersion: string;
  readonly mcpEntryPath?: string;
  readonly nodeCommand?: string;
  readonly formatUserPath: (path: string | undefined) => string | undefined;
  readonly checkNodeCommand: () => Promise<string | undefined>;
  readonly finishAction: (
    action: DevinSetupAction,
    selectedPetId: string | undefined,
    previousStatus: string,
    result: DevinSetupActionResult,
  ) => void;
}

const reloadHint = "Refresh MCP servers in Devin Desktop, or start a new Devin CLI session, to apply the change.";

export async function getDevinSetup(dependencies: DevinSetupDependencies): Promise<{ readonly status: DevinSetupStatus; readonly preview: DevinSetupPreview }> {
  const options = buildPreviewOptions(dependencies);
  const statusResult = readStatus(dependencies, options);
  const displayPath = formatConfigPath(dependencies);

  return {
    status: {
      state: mapDevinStatusToState(statusResult.status),
      label: mapDevinStatusToLabel(statusResult.status),
      details: statusResult.message,
      configPath: displayPath,
      canInstall: statusResult.canInstall,
      canReplace: statusResult.canReplace,
      canRemove: statusResult.canRemove,
    },
    preview: {
      global: true,
      configPath: displayPath,
      mcpEntry: statusResult.previewEntry ?? buildDevinMcpEntry(options),
      commandMode: dependencies.commandMode,
    },
  };
}

export async function installDevinGlobal(dependencies: DevinSetupDependencies): Promise<DevinSetupActionResult> {
  return runDevinWrite(dependencies, "devin-install", {
    requiresNode: true,
    plan: (options) => planDevinMcpInstall(dependencies.configPath, options),
    successMessage: (backupMessage) => `Installed OpenPets MCP for Devin Desktop and Devin CLI at ${formatConfigPath(dependencies)}.${backupMessage} ${reloadHint}`,
  });
}

export async function replaceDevinGlobal(dependencies: DevinSetupDependencies): Promise<DevinSetupActionResult> {
  return runDevinWrite(dependencies, "devin-replace", {
    requiresNode: true,
    plan: (options) => planDevinMcpReplace(dependencies.configPath, options),
    successMessage: (backupMessage) => `Replaced OpenPets MCP for Devin Desktop and Devin CLI at ${formatConfigPath(dependencies)}.${backupMessage} ${reloadHint}`,
  });
}

export async function removeDevinGlobal(dependencies: DevinSetupDependencies): Promise<DevinSetupActionResult> {
  return runDevinWrite(dependencies, "devin-remove", {
    requiresNode: false,
    plan: () => planDevinMcpRemove(dependencies.configPath),
    successMessage: (backupMessage) => `Removed OpenPets MCP from Devin at ${formatConfigPath(dependencies)}.${backupMessage} ${reloadHint}`,
  });
}

interface DevinWriteSpec {
  readonly requiresNode: boolean;
  readonly plan: (options: DevinMcpPreviewOptions) => DevinPlannedWrite | DevinConfigError;
  readonly successMessage: (backupMessage: string) => string;
}

async function runDevinWrite(
  dependencies: DevinSetupDependencies,
  action: DevinSetupAction,
  spec: DevinWriteSpec,
): Promise<DevinSetupActionResult> {
  let previousStatus = "unknown";
  try {
    const options = buildPreviewOptions(dependencies);
    previousStatus = readStatus(dependencies, options).status;

    if (spec.requiresNode) {
      const nodeError = await dependencies.checkNodeCommand();
      if (nodeError) {
        return finish(dependencies, action, previousStatus, { ok: false, action, message: nodeError, changed: false });
      }
    }

    const plan = spec.plan(options);
    if ("ok" in plan) {
      return finish(dependencies, action, previousStatus, { ok: false, action, message: plan.message, changed: false });
    }

    executeDevinMcpWrite(plan);
    const backupPath = plan.backupPath ? dependencies.formatUserPath(plan.backupPath) ?? plan.backupPath : undefined;
    const backupMessage = backupPath ? ` Backup: ${backupPath}.` : "";
    return finish(dependencies, action, previousStatus, {
      ok: true,
      action,
      message: spec.successMessage(backupMessage),
      changed: true,
    });
  } catch (error) {
    return finish(dependencies, action, previousStatus, {
      ok: false,
      action,
      message: error instanceof Error ? error.message : "Devin MCP setup failed.",
      changed: false,
    });
  }
}

function readStatus(dependencies: DevinSetupDependencies, options: DevinMcpPreviewOptions): DevinMcpStatusResult {
  return classifyDevinMcpStatus(readDevinMcpConfig(dependencies.configPath), dependencies.configPath, options);
}

function buildPreviewOptions(dependencies: DevinSetupDependencies): DevinMcpPreviewOptions {
  const usesNode = dependencies.commandMode !== "published";
  return {
    mcpVersion: dependencies.mcpVersion,
    petId: dependencies.selectedPetId || undefined,
    commandMode: dependencies.commandMode,
    mcpEntryPath: usesNode ? dependencies.mcpEntryPath : undefined,
    nodeCommand: usesNode ? dependencies.nodeCommand : undefined,
  };
}

function formatConfigPath(dependencies: DevinSetupDependencies): string {
  return dependencies.formatUserPath(dependencies.configPath) ?? dependencies.configPath;
}

function finish(
  dependencies: DevinSetupDependencies,
  action: DevinSetupAction,
  previousStatus: string,
  result: DevinSetupActionResult,
): DevinSetupActionResult {
  dependencies.finishAction(action, dependencies.selectedPetId, previousStatus, result);
  return result;
}

function mapDevinStatusToState(status: DevinMcpStatusResult["status"]): DevinSetupStatus["state"] {
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
  }
}

function mapDevinStatusToLabel(status: DevinMcpStatusResult["status"]): string {
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
  }
}
