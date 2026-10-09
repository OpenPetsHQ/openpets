import {
  buildDevinHookCommand,
  buildDevinMcpEntry,
  classifyDevinHooks,
  classifyDevinMcpStatus,
  executeDevinConfigWrite,
  planDevinHooksInstall,
  planDevinHooksRemove,
  planDevinMcpInstall,
  planDevinMcpRemove,
  planDevinMcpReplace,
  readDevinMcpConfig,
  type DevinCommandMode,
  type DevinConfigError,
  type DevinHookCommandOptions,
  type DevinHookTarget,
  type DevinHooksStatusResult,
  type DevinMcpEntry,
  type DevinMcpPreviewOptions,
  type DevinMcpStatusResult,
  type DevinPlannedWrite,
} from "@open-pets/devin";

export interface DevinHookTargetSetupStatus {
  readonly state: "configured" | "needs_setup" | "needs_update" | "error";
  readonly label: string;
  readonly details: string;
  readonly path: string;
}

export interface DevinHooksSetupStatus {
  readonly cli: DevinHookTargetSetupStatus;
  readonly desktop: DevinHookTargetSetupStatus;
  readonly canInstall: boolean;
  readonly canRemove: boolean;
}

export interface DevinSetupStatus {
  readonly state: "configured" | "needs_setup" | "disabled" | "needs_update" | "conflict" | "error";
  readonly label: string;
  readonly details: string;
  readonly configPath: string;
  readonly canInstall: boolean;
  readonly canReplace: boolean;
  readonly canRemove: boolean;
  readonly hooks: DevinHooksSetupStatus;
}

export interface DevinSetupPreview {
  readonly global: true;
  readonly configPath: string;
  readonly mcpEntry: DevinMcpEntry;
  readonly hookCommand: string;
  readonly commandMode: DevinCommandMode;
}

export type DevinSetupAction = "devin-install" | "devin-replace" | "devin-remove" | "devin-install-hooks" | "devin-remove-hooks";

export interface DevinSetupActionResult {
  readonly ok: boolean;
  readonly action: DevinSetupAction;
  readonly message: string;
  readonly changed: boolean;
}

export interface DevinSetupDependencies {
  readonly configPath: string;
  readonly cliConfigPath: string;
  readonly desktopHooksPath: string;
  readonly selectedPetId?: string;
  readonly commandMode: DevinCommandMode;
  readonly mcpVersion: string;
  readonly mcpEntryPath?: string;
  readonly cliVersion: string;
  readonly cliEntryPath?: string;
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
const hooksReloadHint = "Start a new Devin CLI session or Devin Desktop conversation to apply the change.";
const hookTargets: readonly DevinHookTarget[] = ["cli", "desktop"];

export async function getDevinSetup(dependencies: DevinSetupDependencies): Promise<{ readonly status: DevinSetupStatus; readonly preview: DevinSetupPreview }> {
  const options = buildPreviewOptions(dependencies);
  const statusResult = readStatus(dependencies, options);
  const displayPath = formatPath(dependencies, dependencies.configPath);

  return {
    status: {
      state: mapDevinStatusToState(statusResult.status),
      label: mapDevinStatusToLabel(statusResult.status),
      details: statusResult.message,
      configPath: displayPath,
      canInstall: statusResult.canInstall,
      canReplace: statusResult.canReplace,
      canRemove: statusResult.canRemove,
      hooks: getHooksStatus(dependencies),
    },
    preview: {
      global: true,
      configPath: displayPath,
      mcpEntry: statusResult.previewEntry ?? buildDevinMcpEntry(options),
      hookCommand: getHookCommandPreview(dependencies),
      commandMode: dependencies.commandMode,
    },
  };
}

export async function installDevinGlobal(dependencies: DevinSetupDependencies): Promise<DevinSetupActionResult> {
  return runDevinWrite(dependencies, "devin-install", {
    requiresNode: true,
    plan: (options) => planDevinMcpInstall(dependencies.configPath, options),
    successMessage: (backupMessage) => `Installed OpenPets MCP for Devin Desktop and Devin CLI at ${formatPath(dependencies, dependencies.configPath)}.${backupMessage} ${reloadHint}`,
  });
}

export async function replaceDevinGlobal(dependencies: DevinSetupDependencies): Promise<DevinSetupActionResult> {
  return runDevinWrite(dependencies, "devin-replace", {
    requiresNode: true,
    plan: (options) => planDevinMcpReplace(dependencies.configPath, options),
    successMessage: (backupMessage) => `Replaced OpenPets MCP for Devin Desktop and Devin CLI at ${formatPath(dependencies, dependencies.configPath)}.${backupMessage} ${reloadHint}`,
  });
}

export async function removeDevinGlobal(dependencies: DevinSetupDependencies): Promise<DevinSetupActionResult> {
  return runDevinWrite(dependencies, "devin-remove", {
    requiresNode: false,
    plan: () => planDevinMcpRemove(dependencies.configPath),
    successMessage: (backupMessage) => `Removed OpenPets MCP from Devin at ${formatPath(dependencies, dependencies.configPath)}.${backupMessage} ${reloadHint}`,
  });
}

/** Installs or updates OpenPets hooks for Devin CLI and Devin Desktop. */
export async function installDevinHooks(dependencies: DevinSetupDependencies): Promise<DevinSetupActionResult> {
  return runDevinHooksWrite(dependencies, "devin-install-hooks");
}

/** Removes OpenPets hooks from Devin CLI and Devin Desktop, leaving user hooks. */
export async function removeDevinHooks(dependencies: DevinSetupDependencies): Promise<DevinSetupActionResult> {
  return runDevinHooksWrite(dependencies, "devin-remove-hooks");
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

    executeDevinConfigWrite(plan);
    return finish(dependencies, action, previousStatus, {
      ok: true,
      action,
      message: spec.successMessage(formatBackupMessage(dependencies, plan)),
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

async function runDevinHooksWrite(
  dependencies: DevinSetupDependencies,
  action: "devin-install-hooks" | "devin-remove-hooks",
): Promise<DevinSetupActionResult> {
  const installing = action === "devin-install-hooks";
  const hookOptions = buildHookOptions(dependencies);
  const before = hookTargets.map((target) => classifyDevinHooks(target, getHookPath(dependencies, target), hookOptions));
  const previousStatus = before.map((status) => `${status.target}:${status.status}`).join(",");

  if (installing) {
    const nodeError = await dependencies.checkNodeCommand();
    if (nodeError) {
      return finish(dependencies, action, previousStatus, { ok: false, action, message: nodeError, changed: false });
    }
  }

  const written: string[] = [];
  const failures: string[] = [];
  for (const status of before) {
    const pending = installing ? status.canInstall : status.canRemove;
    if (!pending) continue;

    try {
      const plan = installing
        ? planDevinHooksInstall(status.target, status.path, hookOptions)
        : planDevinHooksRemove(status.target, status.path);
      if ("ok" in plan) {
        failures.push(`${describeHookTarget(status.target)}: ${plan.message}`);
        continue;
      }
      executeDevinConfigWrite(plan);
      written.push(`${describeHookTarget(status.target)} (${formatPath(dependencies, status.path)})${formatBackupMessage(dependencies, plan)}`);
    } catch (error) {
      failures.push(`${describeHookTarget(status.target)}: ${error instanceof Error ? error.message : "write failed."}`);
    }
  }

  const blocked = before.filter((status) => status.status === "invalid" || status.status === "error");
  for (const status of blocked) {
    failures.push(`${describeHookTarget(status.target)}: ${status.message}`);
  }

  const verb = installing ? "Installed" : "Removed";
  const summary = written.length > 0
    ? `${verb} OpenPets hooks for ${written.join(" and ")}. ${hooksReloadHint}`
    : installing ? "OpenPets hooks are already installed for Devin." : "OpenPets hooks are not installed for Devin.";
  const message = failures.length > 0 ? `${summary} Not changed: ${failures.join(" ")}` : summary;
  return finish(dependencies, action, previousStatus, {
    ok: failures.length === 0,
    action,
    message,
    changed: written.length > 0,
  });
}

function getHooksStatus(dependencies: DevinSetupDependencies): DevinHooksSetupStatus {
  const hookOptions = buildHookOptions(dependencies);
  const [cli, desktop] = hookTargets.map((target) => classifyDevinHooks(target, getHookPath(dependencies, target), hookOptions));
  return {
    cli: mapHookTargetStatus(dependencies, cli),
    desktop: mapHookTargetStatus(dependencies, desktop),
    canInstall: cli.canInstall || desktop.canInstall,
    canRemove: cli.canRemove || desktop.canRemove,
  };
}

function mapHookTargetStatus(dependencies: DevinSetupDependencies, result: DevinHooksStatusResult): DevinHookTargetSetupStatus {
  const path = formatPath(dependencies, result.path);
  switch (result.status) {
    case "installed":
      return { state: "configured", label: "Installed", details: result.message, path };
    case "missing":
      return { state: "needs_setup", label: "Not installed", details: result.message, path };
    case "needs-update":
      return { state: "needs_update", label: "Needs update", details: result.message, path };
    case "invalid":
    case "error":
      return { state: "error", label: "Config error", details: result.message, path };
  }
}

function getHookCommandPreview(dependencies: DevinSetupDependencies): string {
  try {
    return buildDevinHookCommand(buildHookOptions(dependencies));
  } catch (error) {
    return error instanceof Error ? error.message : "Hook command unavailable.";
  }
}

function getHookPath(dependencies: DevinSetupDependencies, target: DevinHookTarget): string {
  return target === "cli" ? dependencies.cliConfigPath : dependencies.desktopHooksPath;
}

function describeHookTarget(target: DevinHookTarget): string {
  return target === "cli" ? "Devin CLI" : "Devin Desktop";
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

function buildHookOptions(dependencies: DevinSetupDependencies): DevinHookCommandOptions {
  const usesNode = dependencies.commandMode !== "published";
  return {
    cliVersion: dependencies.cliVersion,
    petId: dependencies.selectedPetId || undefined,
    commandMode: dependencies.commandMode,
    cliEntryPath: usesNode ? dependencies.cliEntryPath : undefined,
    nodeCommand: usesNode ? dependencies.nodeCommand : undefined,
  };
}

function formatPath(dependencies: DevinSetupDependencies, path: string): string {
  return dependencies.formatUserPath(path) ?? path;
}

function formatBackupMessage(dependencies: DevinSetupDependencies, plan: DevinPlannedWrite): string {
  if (!plan.backupPath) return "";
  return ` Backup: ${formatPath(dependencies, plan.backupPath)}.`;
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
