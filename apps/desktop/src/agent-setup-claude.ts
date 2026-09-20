import {
  buildClaudeMcpGetCommand,
  buildClaudeMcpPreview,
  classifyClaudeMcpStatus,
  doctorClaudeHooks,
  installClaudeHooks,
  type ClaudeCommandSpec,
  type ClaudeHookDoctorResult,
  type ClaudeMcpPreview,
  type OpenPetsCommandMode,
  type ParsedClaudeMcpEntry,
  uninstallClaudeHooks,
} from "@open-pets/claude";
import {
  doctorClaudeOpenPetsMemory,
  installClaudeOpenPetsMemory,
  uninstallClaudeOpenPetsMemory,
  type ClaudeOpenPetsMemoryStatus,
} from "./claude-memory.js";

export type {
  ClaudeHookDoctorResult,
  ClaudeMcpPreview,
  OpenPetsCommandMode,
  ParsedClaudeMcpEntry,
} from "@open-pets/claude";
export type { ClaudeOpenPetsMemoryStatus } from "./claude-memory.js";

export interface ClaudeCodeStatus {
  readonly state: "detected" | "not_detected" | "configured" | "needs_setup" | "error";
  readonly label: string;
  readonly details: string;
  readonly claudeCommand?: string;
  readonly version?: string;
  readonly mcpListWorks: boolean;
  readonly openPetsEntry: ParsedClaudeMcpEntry;
  readonly canConfigure: boolean;
  readonly canReplace: boolean;
  readonly canRemove: boolean;
}

export type ClaudeSetupAction = "configure" | "replace" | "remove" | "install-memory" | "doctor-hooks" | "install-hooks" | "uninstall-hooks";

export interface ClaudeSetupActionResult {
  readonly ok: boolean;
  readonly action: ClaudeSetupAction;
  readonly message: string;
  readonly changed: boolean;
}

export interface ClaudeCommandResult {
  readonly ok: boolean;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode?: number | null;
  readonly error?: string;
}

export interface ClaudeSetupJournalEntry {
  readonly action: "configure" | "update" | "replace" | "remove";
  readonly selectedPetId?: string;
  readonly command: readonly string[];
  readonly previousStatus: string;
  readonly success: boolean;
  readonly message: string;
}

export interface ClaudeSetupDependencies {
  readonly selectedPetId?: string;
  readonly commandMode: OpenPetsCommandMode;
  readonly preferredClaudeCommand: string;
  readonly preferredNodeCommand: string;
  readonly homeDir: string;
  readonly formatUserPath: (path: string | undefined) => string | undefined;
  readonly sanitizeOutput: (value: string) => string;
  readonly summarizeCommandResult: (result: ClaudeCommandResult) => string;
  readonly runClaudeCommand: (spec: ClaudeCommandSpec) => Promise<ClaudeCommandResult>;
  readonly runNodePreflight: () => Promise<ClaudeCommandResult>;
  readonly finishAction: (entry: ClaudeSetupJournalEntry) => void;
}

export interface ClaudeSetupSnapshot {
  readonly preview: ClaudeMcpPreview;
  readonly status: ClaudeCodeStatus;
  readonly hookStatus: ClaudeHookDoctorResult;
  readonly memoryStatus: ClaudeOpenPetsMemoryStatus;
}

export async function getClaudeSetup(dependencies: ClaudeSetupDependencies): Promise<ClaudeSetupSnapshot> {
  const previewResult = safeBuildClaudeMcpPreview(dependencies);
  const status = previewResult.error
    ? createBundledResourceErrorStatus(previewResult.error)
    : await detectClaudeCodeStatus(dependencies);
  const rawHookStatus = previewResult.error
    ? createHookErrorStatus(previewResult.error)
    : safeDoctorClaudeHooks(dependencies);
  const rawMemoryStatus = doctorClaudeOpenPetsMemory(dependencies.homeDir);

  return {
    preview: previewResult.preview,
    status,
    hookStatus: {
      ...rawHookStatus,
      settingsPath: dependencies.formatUserPath(rawHookStatus.settingsPath) ?? rawHookStatus.settingsPath,
      backupPath: dependencies.formatUserPath(rawHookStatus.backupPath),
    },
    memoryStatus: {
      ...rawMemoryStatus,
      claudeMdPath: dependencies.formatUserPath(rawMemoryStatus.claudeMdPath) ?? rawMemoryStatus.claudeMdPath,
      openPetsMemoryPath: dependencies.formatUserPath(rawMemoryStatus.openPetsMemoryPath) ?? rawMemoryStatus.openPetsMemoryPath,
    },
  };
}

export async function runClaudeAction(
  action: ClaudeSetupAction,
  dependencies: ClaudeSetupDependencies,
): Promise<ClaudeSetupActionResult> {
  if (action === "doctor-hooks") {
    const doctor = safeDoctorClaudeHooks(dependencies);
    dependencies.finishAction({
      action: "update",
      selectedPetId: dependencies.selectedPetId,
      command: createHookJournalCommand("doctor-hooks", dependencies.selectedPetId),
      previousStatus: doctor.status,
      success: doctor.status !== "error",
      message: doctor.message,
    });
    return { ok: doctor.status !== "error", action, message: doctor.message, changed: false };
  }

  if (action === "uninstall-hooks") {
    let result;
    try {
      result = uninstallClaudeHooks(undefined, dependencies.commandMode);
    } catch (error) {
      return { ok: false, action, message: error instanceof Error ? error.message : "OpenPets hook uninstall failed.", changed: false };
    }
    const message = result.changed
      ? `Uninstalled OpenPets Claude hooks. Backup: ${dependencies.formatUserPath(result.backupPath) ?? "not needed"}`
      : result.message;
    dependencies.finishAction({
      action: "remove",
      selectedPetId: dependencies.selectedPetId,
      command: ["open-pets-claude", "uninstall-hooks"],
      previousStatus: result.status,
      success: result.status !== "error",
      message,
    });
    return { ok: result.status !== "error", action, message, changed: result.changed };
  }

  if (action === "install-memory") {
    const result = safeInstallClaudeMemory(dependencies.homeDir);
    return {
      ok: result.ok,
      action,
      message: result.ok ? result.message : `Claude instructions were not updated: ${result.message}`,
      changed: result.ok && result.message.startsWith("Added"),
    };
  }

  if (action === "remove") {
    return runRemove(createErrorPreview(dependencies), dependencies, "Unknown", action);
  }

  if (dependencies.commandMode === "bundled") {
    const node = await dependencies.runNodePreflight();
    if (!node.ok) {
      return {
        ok: false,
        action,
        message: `Node.js is required for packaged OpenPets commands. Open Claude configuration, set the Node.js command path, then try again. ${dependencies.summarizeCommandResult(node)}`,
        changed: false,
      };
    }
  }

  const previewResult = safeBuildClaudeMcpPreview(dependencies);
  if (previewResult.error) return { ok: false, action, message: previewResult.error, changed: false };

  if (action === "install-hooks") {
    let result;
    try {
      result = installClaudeHooks(undefined, dependencies.commandMode, dependencies.selectedPetId, dependencies.preferredNodeCommand);
    } catch (error) {
      return { ok: false, action, message: error instanceof Error ? error.message : "OpenPets hook install failed.", changed: false };
    }
    const message = result.changed
      ? `Installed OpenPets Claude hooks. Backup: ${dependencies.formatUserPath(result.backupPath) ?? "not needed"}`
      : result.message;
    dependencies.finishAction({
      action: "update",
      selectedPetId: dependencies.selectedPetId,
      command: createHookJournalCommand("install-hooks", dependencies.selectedPetId),
      previousStatus: result.status,
      success: result.status !== "error",
      message,
    });
    return { ok: result.status !== "error", action, message, changed: result.changed };
  }

  const detection = await detectClaudeCodeStatus(dependencies);
  const previousStatus = detection.label;
  const preview = previewResult.preview;
  if (detection.state === "not_detected") {
    const result = { ok: false, action, message: "Claude Code was not found. Install Claude Code or use Copy command to configure manually.", changed: false };
    finishAction(dependencies, action, dependencies.selectedPetId, [preview.add.command, ...preview.add.args], previousStatus, result.ok, result.message);
    return result;
  }

  if (action === "configure") {
    if (detection.openPetsEntry.present && detection.openPetsEntry.verified && detection.openPetsEntry.matchesExpected) {
      const memoryResult = safeInstallClaudeMemory(dependencies.homeDir);
      const message = `OpenPets MCP is already configured for Claude Code.${memoryResult.ok ? ` ${memoryResult.message}` : ` Claude instructions were not updated: ${memoryResult.message}`}`;
      return { ok: true, action, message, changed: memoryResult.ok && memoryResult.message.startsWith("Added") };
    }
    if (detection.openPetsEntry.present) {
      return { ok: false, action, message: "Claude already has an openpets MCP entry. OpenPets will keep it as installed; use Replace only if you want to recreate it with the recommended command.", changed: false };
    }
    return runAdd(preview, dependencies, previousStatus, action);
  }

  if (!detection.openPetsEntry.present) return runAdd(preview, dependencies, previousStatus, action);

  const removed = await runRemove(preview, dependencies, previousStatus, action);
  if (!removed.ok) return removed;
  const added = await runAdd(preview, dependencies, previousStatus, action);
  if (!added.ok) {
    return {
      ok: false,
      action,
      message: `${added.message} The previous openpets entry was removed; use this command to restore the intended entry: ${preview.displayCommand}`,
      changed: true,
    };
  }
  return { ok: true, action, message: `Replaced Claude Code OpenPets MCP entry.${summarizeMemoryMessages(removed.message, added.message)}`, changed: true };
}

function safeBuildClaudeMcpPreview(dependencies: ClaudeSetupDependencies): { readonly preview: ClaudeMcpPreview; readonly error?: string } {
  try {
    return {
      preview: withPreferredClaudeCommand(
        buildClaudeMcpPreview(dependencies.selectedPetId, dependencies.commandMode, dependencies.preferredNodeCommand),
        dependencies.preferredClaudeCommand,
      ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Packaged OpenPets command resources are unavailable.";
    return { preview: createErrorPreview(dependencies, message), error: message };
  }
}

function createErrorPreview(dependencies: ClaudeSetupDependencies, displayCommand = ""): ClaudeMcpPreview {
  return {
    commandMode: dependencies.commandMode,
    add: { command: dependencies.preferredClaudeCommand, args: [] },
    remove: { command: dependencies.preferredClaudeCommand, args: ["mcp", "remove", "--scope", "user", "openpets"] },
    mcpJson: { mcpServers: { openpets: { type: "stdio", command: "node", args: [] } } },
    displayCommand,
  };
}

function withPreferredClaudeCommand(preview: ClaudeMcpPreview, preferredCommand: string): ClaudeMcpPreview {
  if (preferredCommand === preview.add.command && preferredCommand === preview.remove.command) return preview;
  return {
    ...preview,
    add: { ...preview.add, command: preferredCommand },
    remove: { ...preview.remove, command: preferredCommand },
    displayCommand: preview.displayCommand.replace(/^claude(?=\s|$)/, quoteCommandForDisplay(preferredCommand)),
  };
}

function createBundledResourceErrorStatus(message: string): ClaudeCodeStatus {
  return createStatus(
    "error",
    "Packaged commands unavailable",
    message,
    undefined,
    { ok: false, timedOut: false, stdout: "", stderr: "", error: message },
    { present: false, source: "none", verified: false, matchesExpected: false },
  );
}

function createHookErrorStatus(message: string): ClaudeHookDoctorResult {
  return { status: "error", settingsPath: "~/.claude/settings.json", exists: false, valid: false, message, preview: {}, asyncSupported: false };
}

async function detectClaudeCodeStatus(dependencies: ClaudeSetupDependencies): Promise<ClaudeCodeStatus> {
  if (dependencies.commandMode === "bundled") {
    const node = await dependencies.runNodePreflight();
    if (!node.ok) {
      return createStatus(
        "error",
        "Node required",
        `Node.js is required for packaged OpenPets commands. Open Claude configuration, expand Advanced detection, set the Node.js command path, then try again. ${dependencies.summarizeCommandResult(node)}`,
        undefined,
        node,
        { present: false, source: "none", verified: false, matchesExpected: false },
      );
    }
  }

  const version = await dependencies.runClaudeCommand({ command: "claude", args: ["--version"] });
  if (!version.ok) {
    const hasOverride = dependencies.preferredClaudeCommand !== "claude";
    return createStatus(
      "not_detected",
      "Not detected",
      `${hasOverride ? "Claude Code did not run from the saved command path" : "Claude Code was not found or did not run"}: ${dependencies.summarizeCommandResult(version)}`,
      undefined,
      version,
      { present: false, source: "none", verified: false, matchesExpected: false },
    );
  }

  const list = await runClaudeCommandWithTimeoutRetry(dependencies, { command: "claude", args: ["mcp", "list"] });
  if (!list.ok) {
    return createStatus(
      "error",
      "Error / needs attention",
      `Claude Code was detected, but MCP status failed: ${dependencies.summarizeCommandResult(list)}`,
      dependencies.sanitizeOutput(version.stdout || version.stderr),
      list,
      { present: false, source: "none", verified: false, matchesExpected: false },
    );
  }

  const listed = classifyClaudeMcpStatus(list.stdout, undefined, dependencies.selectedPetId, dependencies.commandMode, dependencies.preferredNodeCommand);
  let entry = listed;
  if (listed.present) {
    const get = await dependencies.runClaudeCommand(buildClaudeMcpGetCommand());
    if (get.ok) {
      entry = classifyClaudeMcpStatus(list.stdout, get.stdout, dependencies.selectedPetId, dependencies.commandMode, dependencies.preferredNodeCommand);
    }
  }

  const versionOutput = dependencies.sanitizeOutput(version.stdout || version.stderr);
  if (!entry.present) return createStatus("needs_setup", "Needs setup", "Claude Code is detected, but OpenPets MCP is not configured.", versionOutput, list, entry);
  if (entry.verified && entry.matchesExpected) return createStatus("configured", "Configured", "Claude Code has the expected OpenPets MCP entry.", versionOutput, list, entry);
  if (entry.verified) return createStatus("configured", "Installed — custom", "Claude Code has an openpets MCP entry with a custom command. OpenPets will leave it alone unless you choose Replace with recommended.", versionOutput, list, entry);
  return createStatus("configured", "Installed — unverified", "Claude Code lists an openpets MCP entry, but command details were not available. OpenPets will leave it alone unless you choose Replace with recommended.", versionOutput, list, entry);
}

async function runClaudeCommandWithTimeoutRetry(dependencies: ClaudeSetupDependencies, spec: ClaudeCommandSpec): Promise<ClaudeCommandResult> {
  const first = await dependencies.runClaudeCommand(spec);
  if (!first.timedOut) return first;
  await delay(250);
  const second = await dependencies.runClaudeCommand(spec);
  return second.ok ? second : first;
}

function createStatus(
  state: ClaudeCodeStatus["state"],
  label: string,
  details: string,
  version: string | undefined,
  listResult: ClaudeCommandResult,
  entry: ParsedClaudeMcpEntry,
): ClaudeCodeStatus {
  return {
    state,
    label,
    details,
    claudeCommand: "claude",
    version,
    mcpListWorks: listResult.ok,
    openPetsEntry: entry,
    canConfigure: state === "needs_setup",
    canReplace: entry.present && !(entry.verified && entry.matchesExpected),
    canRemove: entry.present,
  };
}

async function runAdd(
  preview: ClaudeMcpPreview,
  dependencies: ClaudeSetupDependencies,
  previousStatus: string,
  action: ClaudeSetupAction,
): Promise<ClaudeSetupActionResult> {
  const result = await dependencies.runClaudeCommand(preview.add);
  const memoryResult = result.ok ? safeInstallClaudeMemory(dependencies.homeDir) : { ok: false as const, message: "" };
  const message = result.ok
    ? `Configured Claude Code OpenPets MCP entry.${memoryResult.ok ? ` ${memoryResult.message}` : ` Claude instructions were not updated: ${memoryResult.message}`}`
    : `Claude MCP add failed: ${dependencies.summarizeCommandResult(result)}`;
  finishAction(dependencies, action, dependencies.selectedPetId, [preview.add.command, ...preview.add.args], previousStatus, result.ok, message);
  return { ok: result.ok, action, message, changed: result.ok };
}

async function runRemove(
  preview: ClaudeMcpPreview,
  dependencies: ClaudeSetupDependencies,
  previousStatus: string,
  action: ClaudeSetupAction,
): Promise<ClaudeSetupActionResult> {
  const result = await dependencies.runClaudeCommand(preview.remove);
  const memoryResult = result.ok ? safeUninstallClaudeMemory(dependencies.homeDir) : { ok: false as const, message: "" };
  const message = result.ok
    ? `Removed Claude Code OpenPets MCP entry.${memoryResult.ok ? ` ${memoryResult.message}` : ` Claude instructions were not updated: ${memoryResult.message}`}`
    : `Claude MCP remove failed: ${dependencies.summarizeCommandResult(result)}`;
  finishAction(dependencies, action, dependencies.selectedPetId, [preview.remove.command, ...preview.remove.args], previousStatus, result.ok, message);
  return { ok: result.ok, action, message, changed: result.ok };
}

function safeInstallClaudeMemory(homeDir: string): { readonly ok: true; readonly message: string } | { readonly ok: false; readonly message: string } {
  try {
    const result = installClaudeOpenPetsMemory(homeDir);
    return { ok: true, message: result.changed ? "Added Claude OpenPets instructions." : "Claude OpenPets instructions already present." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Unknown error." };
  }
}

function safeUninstallClaudeMemory(homeDir: string): { readonly ok: true; readonly message: string } | { readonly ok: false; readonly message: string } {
  try {
    const result = uninstallClaudeOpenPetsMemory(homeDir);
    return { ok: true, message: result.changed ? "Removed Claude OpenPets instructions." : "Claude OpenPets instructions were already absent." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Unknown error." };
  }
}

function safeDoctorClaudeHooks(dependencies: ClaudeSetupDependencies): ClaudeHookDoctorResult {
  try {
    return doctorClaudeHooks(undefined, dependencies.commandMode, dependencies.selectedPetId, dependencies.preferredNodeCommand);
  } catch (error) {
    return createHookErrorStatus(error instanceof Error ? error.message : "Packaged OpenPets hook resources are unavailable.");
  }
}

function finishAction(
  dependencies: ClaudeSetupDependencies,
  action: ClaudeSetupAction,
  selectedPetId: string | undefined,
  command: readonly string[],
  previousStatus: string,
  success: boolean,
  message: string,
): void {
  dependencies.finishAction({
    action: journalActionFor(action),
    selectedPetId,
    command,
    previousStatus,
    success,
    message,
  });
}

function createHookJournalCommand(command: "doctor-hooks" | "install-hooks", selectedPetId: string | undefined): readonly string[] {
  return selectedPetId ? ["open-pets-claude", command, "--pet", selectedPetId] : ["open-pets-claude", command];
}

function journalActionFor(action: ClaudeSetupAction): "configure" | "replace" | "remove" {
  if (action === "replace") return "replace";
  if (action === "remove" || action === "uninstall-hooks") return "remove";
  return "configure";
}

function summarizeMemoryMessages(...messages: readonly string[]): string {
  const memoryMessages = messages.flatMap((message) => message.match(/Claude (?:OpenPets )?instructions[^.]*\./g) ?? []);
  return memoryMessages.length > 0 ? ` ${memoryMessages.join(" ")}` : "";
}

function quoteCommandForDisplay(command: string): string {
  return /\s/.test(command) ? JSON.stringify(command) : command;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
