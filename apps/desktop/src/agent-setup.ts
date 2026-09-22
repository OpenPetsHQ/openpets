import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { createRequire } from "node:module";

import { app } from "electron";
import { createOpenPetsHookSettingsPreview, mapAsarPathToUnpacked, type ClaudeCommandSpec, type OpenPetsCommandMode } from "@open-pets/claude";
import { buildOpenClawCommand, openClawMaxStructuredOutputBytes, type OpenClawCommandAction } from "@open-pets/openclaw/management";
import { getZedGlobalSettingsPath, isValidZedNodeCommand } from "@open-pets/zed";

import { getAppStateSnapshot, updatePreferences, type InstalledPetState, type OpenPetsStateV1 } from "./app-state.js";
import { buildExtraCommandPaths, resolveCommandMode } from "./agent-command-env.js";
import { getDefaultOpenCodeCommand, getOpenCodeCommandCandidates } from "./opencode-command.js";
import { getCursorSetup, installCursorGlobal, removeCursorGlobal, replaceCursorGlobal, type CursorSetupPreview, type CursorSetupStatus } from "./agent-setup-cursor.js";
import { getClaudeSetup as buildClaudeSetup, runClaudeAction as applyClaudeAction, type ClaudeCodeStatus, type ClaudeCommandResult, type ClaudeHookDoctorResult, type ClaudeMcpPreview, type ClaudeOpenPetsMemoryStatus, type ClaudeSetupAction, type ClaudeSetupDependencies, type ClaudeSetupJournalEntry } from "./agent-setup-claude.js";
import { getOpenCodeConfigDir, getOpenCodeSetup as buildOpenCodeSetup, installOpenCodeGlobal as applyOpenCodeInstall, removeOpenCodeGlobal as applyOpenCodeRemove, type OpenCodeSetupPreview, type OpenCodeSetupStatus } from "./agent-setup-opencode.js";
import { getOpenClawSetup as buildOpenClawSetup, mutateOpenClaw as applyOpenClawMutation, type OpenClawPluginStatus, type OpenClawSetupPreview } from "./agent-setup-openclaw.js";
import { getZedSetup as buildZedSetup, installZedGlobal as applyZedInstall, removeZedGlobal as applyZedRemove, replaceZedGlobal as applyZedReplace, type ZedSetupPreview, type ZedSetupStatus } from "./agent-setup-zed.js";

export type { CursorSetupPreview, CursorSetupStatus } from "./agent-setup-cursor.js";
export type { OpenCodeSetupPreview, OpenCodeSetupStatus } from "./agent-setup-opencode.js";
export type { ZedSetupPreview, ZedSetupStatus } from "./agent-setup-zed.js";
export type { ClaudeCodeStatus } from "./agent-setup-claude.js";

export type AgentSetupAction = "configure" | "replace" | "remove" | "install-memory" | "doctor-hooks" | "install-hooks" | "uninstall-hooks" | "opencode-install" | "opencode-remove" | "cursor-install" | "cursor-replace" | "cursor-remove" | "openclaw-install" | "openclaw-update" | "openclaw-remove" | "zed-install" | "zed-replace" | "zed-remove";
export type JournalAction = "configure" | "update" | "replace" | "remove";

export interface AgentSetupPetOption {
  readonly id: string;
  readonly displayName: string;
  readonly default: boolean;
}

export interface AgentSetupSnapshot {
  readonly selectedPetId?: string;
  readonly commandMode: OpenPetsCommandMode;
  readonly localDevAvailable: boolean;
  readonly petOptions: readonly AgentSetupPetOption[];
  readonly preview: ClaudeMcpPreview;
  readonly status: ClaudeCodeStatus;
  readonly hookStatus: ClaudeHookDoctorResult;
  readonly memoryStatus: ClaudeOpenPetsMemoryStatus;
  readonly opencodeStatus: OpenCodeSetupStatus;
  readonly opencodePreview: OpenCodeSetupPreview;
  readonly cursorStatus: CursorSetupStatus;
  readonly cursorPreview: CursorSetupPreview;
  readonly openclawStatus: OpenClawPluginStatus;
  readonly openclawPreview: OpenClawSetupPreview;
  readonly zedStatus: ZedSetupStatus;
  readonly zedPreview: ZedSetupPreview;
  readonly commandPaths: AgentSetupCommandPaths;
  readonly busy: boolean;
  readonly lastAction?: AgentSetupActionResult;
}

export interface AgentSetupCommandPaths {
  readonly claude: string;
  readonly node: string;
  readonly opencode: string;
  readonly openclaw: string;
}

export type { OpenClawSetupPreview } from "./agent-setup-openclaw.js";

export interface AgentSetupActionResult {
  readonly ok: boolean;
  readonly action: AgentSetupAction;
  readonly message: string;
  readonly changed: boolean;
}

export interface AgentSetupJournalEntry {
  readonly timestamp: string;
  readonly action: JournalAction;
  readonly selectedPetId?: string;
  readonly command: readonly string[];
  readonly previousStatus: string;
  readonly success: boolean;
  readonly message: string;
}

interface CommandResult {
  readonly ok: boolean;
  readonly timedOut: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
  readonly overflow?: boolean;
}

interface BoundedOutput {
  readonly value: string;
  readonly overflow: boolean;
}

const commandTimeoutMs = 6_000;
const managementCommandTimeoutMs = 60_000;
const maxOutputBytes = 16_384;
const require = createRequire(import.meta.url);
let operationRunning = false;
let lastAction: AgentSetupActionResult | undefined;

export async function getAgentSetupSnapshot(selectedPetId?: unknown, commandModeInput?: unknown): Promise<AgentSetupSnapshot> {
  const petId = validateSelectedPetId(selectedPetId);
  const commandMode = validateCommandMode(commandModeInput);
  const claude = await buildClaudeSetup(getClaudeSetupDependencies(petId, commandMode));
  const opencode = await getOpenCodeSetup(commandMode, petId);
  const cursor = await getCursorSetup(petId, getCursorSetupDependencies());
  const openclaw = await getOpenClawSetup();
  const zed = await getZedSetup(commandMode, petId);

  return {
    selectedPetId: petId,
    commandMode,
    localDevAvailable: !app.isPackaged,
    petOptions: getPetOptions(),
    preview: claude.preview,
    status: claude.status,
    hookStatus: claude.hookStatus,
    memoryStatus: claude.memoryStatus,
    opencodeStatus: opencode.status,
    opencodePreview: opencode.preview,
    cursorStatus: cursor.status,
    cursorPreview: cursor.preview,
    openclawStatus: openclaw.status,
    openclawPreview: openclaw.preview,
    zedStatus: zed.status,
    zedPreview: zed.preview,
    commandPaths: getAgentSetupCommandPaths(),
    busy: operationRunning,
    lastAction,
  };
}

export function updateAgentSetupCommandPaths(patch: unknown): AgentSetupCommandPaths {
  if (!isRecord(patch)) throw new Error("Invalid command path settings.");
  for (const key of Object.keys(patch)) {
    if (key !== "claude" && key !== "node" && key !== "opencode" && key !== "openclaw") throw new Error("Invalid command path setting.");
  }
  const updates: Writable<Partial<OpenPetsStateV1["preferences"]>> = {};
  if ("claude" in patch) updates.claudeCommandPath = normalizeOptionalCommandPath(patch.claude, "Claude");
  if ("node" in patch) updates.nodeCommandPath = normalizeOptionalCommandPath(patch.node, "Node.js");
  if ("opencode" in patch) updates.opencodeCommandPath = normalizeOptionalCommandPath(patch.opencode, "OpenCode");
  if ("openclaw" in patch) updates.openclawCommandPath = normalizeOptionalCommandPath(patch.openclaw, "OpenClaw");
  updatePreferences(updates);
  return getAgentSetupCommandPaths();
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

export async function runAgentSetupAction(action: AgentSetupAction, selectedPetId?: unknown, commandModeInput?: unknown): Promise<AgentSetupSnapshot> {
  if (operationRunning) throw new Error("Another integration setup operation is already running.");
  const petId = validateSelectedPetId(selectedPetId);
  const commandMode = validateCommandMode(commandModeInput);
  operationRunning = true;

  try {
    lastAction = await runAction(action, petId, commandMode);
    operationRunning = false;
    return getAgentSetupSnapshot(petId, commandMode);
  } finally {
    operationRunning = false;
  }
}

export function sanitizeAgentSetupOutput(value: string): string {
  const home = app.isReady() ? app.getPath("home") : "";
  return value
    .replaceAll(home, "~")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"']{2,}/g, "<path>")
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/gi, "<redacted-private-key>")
    .replace(/bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer <redacted>")
    .replace(/\b(api[_-]?key|secret|password|token)\s*[:=]\s*\S+/gi, "$1=<redacted>")
    .slice(0, 500);
}

async function runAction(action: AgentSetupAction, selectedPetId: string | undefined, commandMode: OpenPetsCommandMode): Promise<AgentSetupActionResult> {
  if (isClaudeSetupAction(action)) return applyClaudeAction(action, getClaudeSetupDependencies(selectedPetId, commandMode));
  if (action === "opencode-install") return installOpenCodeGlobal(selectedPetId, commandMode);
  if (action === "opencode-remove") return removeOpenCodeGlobal();
  if (action === "openclaw-install") return mutateOpenClaw("configure");
  if (action === "openclaw-update") return mutateOpenClaw("update");
  if (action === "openclaw-remove") return mutateOpenClaw("remove");
  if (action === "cursor-install") return installCursorGlobal(selectedPetId, getCursorSetupDependencies());
  if (action === "cursor-replace") return replaceCursorGlobal(selectedPetId, getCursorSetupDependencies());
  if (action === "cursor-remove") return removeCursorGlobal(getCursorSetupDependencies());
  if (action === "zed-install") return installZedGlobal(selectedPetId, commandMode);
  if (action === "zed-replace") return replaceZedGlobal(selectedPetId, commandMode);
  if (action === "zed-remove") return removeZedGlobal(selectedPetId, commandMode);
  throw new Error("Unsupported agent setup action.");
}

function isClaudeSetupAction(action: AgentSetupAction): action is ClaudeSetupAction {
  return action === "configure"
    || action === "replace"
    || action === "remove"
    || action === "install-memory"
    || action === "doctor-hooks"
    || action === "install-hooks"
    || action === "uninstall-hooks";
}

function getClaudeSetupDependencies(selectedPetId: string | undefined, commandMode: OpenPetsCommandMode): ClaudeSetupDependencies {
  return {
    selectedPetId,
    commandMode,
    preferredClaudeCommand: getPreferredClaudeCommand(),
    preferredNodeCommand: getPreferredNodeCommand(),
    homeDir: app.getPath("home"),
    formatUserPath,
    sanitizeOutput: sanitizeAgentSetupOutput,
    summarizeCommandResult: (result: ClaudeCommandResult) => summarizeCommandResult({
      ok: result.ok,
      timedOut: result.timedOut,
      exitCode: result.exitCode ?? null,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error,
    }),
    runClaudeCommand: (spec) => runClaudeCommand(spec),
    runNodePreflight: () => runCommand({ command: getPreferredNodeCommand(), args: ["--version"] }),
    finishAction: (entry: ClaudeSetupJournalEntry) => writeActionJournal(entry),
  };
}

async function getOpenCodeSetup(commandMode: OpenPetsCommandMode, selectedPetId: string | undefined): Promise<{ readonly status: OpenCodeSetupStatus; readonly preview: OpenCodeSetupPreview }> {
  const configDir = getOpenCodeConfigDir(process.env, app.getPath("home"), process.platform);
  const detected = await runOpenCodeCommand(["--version"]);
  return buildOpenCodeSetup({
    configDir,
    selectedPetId,
    cliVersion: getCliPackageVersion(),
    pluginVersion: getOpenCodePackageVersion(),
    commandMode,
    cliEntryPath: commandMode === "published" ? undefined : getDesktopCliEntryPath(commandMode),
    detected: detected.ok,
    preferredCommandIsDefault: getPreferredOpenCodeCommand() === getDefaultOpenCodeCommand(),
    formatUserPath,
  });
}

async function getOpenClawSetup(): Promise<{ readonly status: OpenClawPluginStatus; readonly preview: OpenClawSetupPreview }> {
  return buildOpenClawSetup(getOpenClawSetupDependencies());
}

async function mutateOpenClaw(mutation: "configure" | "update" | "remove"): Promise<AgentSetupActionResult> {
  return applyOpenClawMutation(mutation, getOpenClawSetupDependencies());
}

function getOpenClawSetupDependencies() {
  return {
    preferredCommand: getPreferredOpenClawCommand(),
    targetVersion: getOpenClawPackageVersion(),
    platform: process.platform,
    managementDisabled: process.env.OPENCLAW_NIX_MODE === "1",
    statusTimeoutMs: commandTimeoutMs,
    mutationTimeoutMs: managementCommandTimeoutMs,
    runCommand: (action: OpenClawCommandAction, targetVersion?: string, timeoutMs?: number) => runOpenClawCommand(action, targetVersion, timeoutMs),
  };
}

async function getZedSetup(commandMode: OpenPetsCommandMode, selectedPetId: string | undefined): Promise<{ readonly status: ZedSetupStatus; readonly preview: ZedSetupPreview }> {
  const settingsPath = getZedGlobalSettingsPath(process.env, app.getPath("home"), process.platform);
  return buildZedSetup({
    settingsPath,
    selectedPetId,
    commandMode,
    mcpVersion: getMcpPackageVersion(),
    mcpEntryPath: commandMode === "published" ? undefined : getDesktopMcpEntryPath(commandMode),
    nodeCommand: commandMode === "published" ? undefined : getPreferredNodeCommand(),
    formatUserPath,
    checkNodeCommand: () => checkZedNodeCommand(commandMode),
    finishAction: finishZedAction,
  });
}

function getAgentSetupCommandPaths(): AgentSetupCommandPaths {
  const preferences = getAppStateSnapshot().preferences;
  return {
    claude: preferences.claudeCommandPath ?? "",
    node: preferences.nodeCommandPath ?? "",
    opencode: preferences.opencodeCommandPath ?? "",
    openclaw: preferences.openclawCommandPath ?? "",
  };
}

function getPreferredClaudeCommand(): string {
  return getAppStateSnapshot().preferences.claudeCommandPath || "claude";
}

function getPreferredNodeCommand(): string {
  return getAppStateSnapshot().preferences.nodeCommandPath || "node";
}

function getPreferredOpenCodeCommand(): string {
  return getAppStateSnapshot().preferences.opencodeCommandPath || getDefaultOpenCodeCommand();
}

function getPreferredOpenClawCommand(): string {
  return getAppStateSnapshot().preferences.openclawCommandPath || "openclaw";
}

function normalizeOptionalCommandPath(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${label} command path must be text.`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 4096 || /[\r\n\0]/.test(trimmed)) throw new Error(`${label} command path is invalid.`);
  if (!isAbsolute(trimmed)) throw new Error(`${label} command path must be a full absolute path.`);
  if (process.platform === "win32" && /[&|<>^%!]/.test(trimmed)) throw new Error(`${label} command path contains unsupported shell characters.`);
  let normalized = normalize(trimmed);
  if (label === "Node.js") {
    try {
      normalized = realpathSync(trimmed);
    } catch {
      throw new Error(`${label} command path must point to an existing executable file.`);
    }
    if (!isValidZedNodeCommand(normalized)) throw new Error(`${label} command path is invalid.`);
  }
  if (process.platform === "win32" && /[&|<>^%!]/.test(normalized)) throw new Error(`${label} command path contains unsupported shell characters.`);
  try {
    const stat = statSync(normalized);
    if (!stat.isFile()) throw new Error();
    if (process.platform !== "win32") accessSync(normalized, constants.X_OK);
  } catch {
    throw new Error(`${label} command path must point to an existing executable file.`);
  }
  return label === "Node.js" ? trimmed : normalized;
}

function quoteCommandForDisplay(command: string): string {
  return /\s/.test(command) ? JSON.stringify(command) : command;
}

async function installOpenCodeGlobal(selectedPetId: string | undefined, commandMode: OpenPetsCommandMode): Promise<AgentSetupActionResult> {
  if (commandMode === "bundled") {
    const node = await runCommand({ command: getPreferredNodeCommand(), args: ["--version"] });
    if (!node.ok) return { ok: false, action: "opencode-install", message: `Node.js is required for packaged OpenPets commands. Open OpenCode configuration, set the Node.js command path, then try again. ${summarizeCommandResult(node)}`, changed: false };
  }
  const configDir = getOpenCodeConfigDir(process.env, app.getPath("home"), process.platform);
  return applyOpenCodeInstall({
    configDir,
    selectedPetId,
    cliVersion: getCliPackageVersion(),
    pluginVersion: getOpenCodePackageVersion(),
    commandMode,
    cliEntryPath: commandMode === "published" ? undefined : getDesktopCliEntryPath(commandMode),
    formatUserPath,
  });
}

async function removeOpenCodeGlobal(): Promise<AgentSetupActionResult> {
  const configDir = getOpenCodeConfigDir(process.env, app.getPath("home"), process.platform);
  return applyOpenCodeRemove({ configDir });
}

async function installZedGlobal(selectedPetId: string | undefined, commandMode: OpenPetsCommandMode): Promise<AgentSetupActionResult> {
  const settingsPath = getZedGlobalSettingsPath(process.env, app.getPath("home"), process.platform);
  return applyZedInstall({
    settingsPath,
    selectedPetId,
    commandMode,
    mcpVersion: getMcpPackageVersion(),
    mcpEntryPath: commandMode === "published" ? undefined : getDesktopMcpEntryPath(commandMode),
    nodeCommand: commandMode === "published" ? undefined : getPreferredNodeCommand(),
    formatUserPath,
    checkNodeCommand: () => checkZedNodeCommand(commandMode),
    finishAction: finishZedAction,
  });
}

async function replaceZedGlobal(selectedPetId: string | undefined, commandMode: OpenPetsCommandMode): Promise<AgentSetupActionResult> {
  const settingsPath = getZedGlobalSettingsPath(process.env, app.getPath("home"), process.platform);
  return applyZedReplace({
    settingsPath,
    selectedPetId,
    commandMode,
    mcpVersion: getMcpPackageVersion(),
    mcpEntryPath: commandMode === "published" ? undefined : getDesktopMcpEntryPath(commandMode),
    nodeCommand: commandMode === "published" ? undefined : getPreferredNodeCommand(),
    formatUserPath,
    checkNodeCommand: () => checkZedNodeCommand(commandMode),
    finishAction: finishZedAction,
  });
}

async function removeZedGlobal(selectedPetId: string | undefined, commandMode: OpenPetsCommandMode): Promise<AgentSetupActionResult> {
  const settingsPath = getZedGlobalSettingsPath(process.env, app.getPath("home"), process.platform);
  return applyZedRemove({
    settingsPath,
    selectedPetId,
    commandMode,
    mcpVersion: getMcpPackageVersion(),
    mcpEntryPath: commandMode === "published" ? undefined : getDesktopMcpEntryPath(commandMode),
    nodeCommand: commandMode === "published" ? undefined : getPreferredNodeCommand(),
    formatUserPath,
    checkNodeCommand: () => checkZedNodeCommand(commandMode),
    finishAction: finishZedAction,
  });
}

async function checkZedNodeCommand(commandMode: OpenPetsCommandMode): Promise<string | undefined> {
  if (commandMode === "published") return undefined;
  const node = await runCommand({ command: getPreferredNodeCommand(), args: ["--version"] });
  if (node.ok) return undefined;
  return `Node.js is required for local OpenPets commands. Open Zed configuration, set the Node.js command path, then try again. ${summarizeCommandResult(node)}`;
}

function finishZedAction(action: "zed-install" | "zed-replace" | "zed-remove", selectedPetId: string | undefined, previousStatus: string, result: AgentSetupActionResult): AgentSetupActionResult {
  const journalAction: JournalAction = action === "zed-replace" ? "replace" : action === "zed-remove" ? "remove" : "configure";
  writeActionJournal({
    action: journalAction,
    selectedPetId,
    command: ["zed", action.replace("zed-", ""), ...(selectedPetId ? ["--pet", selectedPetId] : [])],
    previousStatus,
    success: result.ok,
    message: result.message,
  });
  return result;
}

function getDesktopCliEntryPath(commandMode: OpenPetsCommandMode): string {
  const path = require.resolve("@open-pets/cli");
  return commandMode === "bundled" ? mapAsarPathToUnpacked(path) : path;
}

function getDesktopMcpEntryPath(commandMode: OpenPetsCommandMode): string {
  const path = require.resolve("@open-pets/mcp");
  return commandMode === "bundled" ? mapAsarPathToUnpacked(path) : path;
}

function getCliPackageVersion(): string {
  return getWorkspacePackageVersion("@open-pets/cli");
}

function getOpenCodePackageVersion(): string {
  return getWorkspacePackageVersion("@open-pets/opencode");
}

function getOpenClawPackageVersion(): string {
  return getWorkspacePackageVersion("@open-pets/openclaw");
}

function getWorkspacePackageVersion(packageName: string): string {
  try {
    const entryPath = require.resolve(packageName);
    const packageJsonPath = join(dirname(dirname(entryPath)), "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { readonly version?: unknown };
    return typeof packageJson.version === "string" && packageJson.version ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function getMcpPackageVersion(): string {
  return getWorkspacePackageVersion("@open-pets/mcp");
}

function getCursorSetupDependencies(): {
  readonly homeDir: string;
  readonly mcpVersion: string;
  readonly formatUserPath: (path: string | undefined) => string | undefined;
} {
  return { homeDir: app.getPath("home"), mcpVersion: getMcpPackageVersion(), formatUserPath };
}

function validateSelectedPetId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("Invalid selected pet id.");
  const pet = getAppStateSnapshot().pets.installed.find((candidate) => candidate.id === value);
  if (!pet || pet.broken) throw new Error("Selected pet is not installed or is broken.");
  return pet.id;
}

function validateCommandMode(value: unknown): OpenPetsCommandMode {
  return resolveCommandMode(value, app.isPackaged);
}

function getPetOptions(): readonly AgentSetupPetOption[] {
  const state = getAppStateSnapshot();
  return state.pets.installed.filter(isUsablePet).map((pet) => ({ id: pet.id, displayName: pet.displayName, default: pet.id === state.preferences.defaultPetId }));
}

function isUsablePet(pet: InstalledPetState): boolean {
  return pet.installed && !pet.broken && !pet.builtIn;
}

async function runClaudeCommand(spec: ClaudeCommandSpec): Promise<CommandResult> {
  for (const command of getClaudeCommandCandidates(spec.command)) {
    const result = await runCommand({ command, args: spec.args });
    if (result.ok || !isCommandNotFound(result)) return result;
  }
  return { ok: false, timedOut: false, exitCode: null, stdout: "", stderr: "", error: "Claude command was not found." };
}

async function runOpenCodeCommand(args: readonly string[]): Promise<CommandResult> {
  const preferences = getAppStateSnapshot().preferences;
  const commands = getOpenCodeCommandCandidates({
    configuredCommand: preferences.opencodeCommandPath,
    env: process.env,
    homeDir: app.getPath("home"),
    platform: process.platform,
  });
  for (const command of commands) {
    const result = await runCommand({ command, args });
    if (result.ok || !isCommandNotFound(result)) return result;
  }
  return { ok: false, timedOut: false, exitCode: null, stdout: "", stderr: "", error: "OpenCode command was not found." };
}

async function runOpenClawCommand(action: OpenClawCommandAction, targetVersion?: string, timeoutMs = managementCommandTimeoutMs): Promise<CommandResult> {
  const configured = getAppStateSnapshot().preferences.openclawCommandPath;
  const commands = configured ? [configured] : process.platform === "win32" ? ["openclaw", "openclaw.cmd"] : ["openclaw"];
  for (const command of commands) {
    const result = await runCommand(buildOpenClawCommand(action, targetVersion, { openclaw: command }), timeoutMs, false, openClawMaxStructuredOutputBytes, true);
    if (result.ok || !isCommandNotFound(result)) return result;
  }
  return { ok: false, timedOut: false, exitCode: null, stdout: "", stderr: "", error: "OpenClaw command was not found." };
}

function runCommand(spec: ClaudeCommandSpec, timeoutMs = commandTimeoutMs, sanitizeOutput = true, outputLimitBytes = maxOutputBytes, structuredOutput = false): Promise<CommandResult> {
  return new Promise((resolve) => {
    const command = process.platform === "win32" && spec.command.toLowerCase().endsWith(".cmd") ? "cmd.exe" : spec.command;
    const args = process.platform === "win32" && spec.command.toLowerCase().endsWith(".cmd") ? ["/d", "/s", "/c", spec.command, ...spec.args] : spec.args;
    let child;
    try {
      child = spawn(command, args, { cwd: app.getPath("home"), env: createCommandEnv(), windowsHide: true, shell: false });
    } catch (error) {
      resolve({ ok: false, timedOut: false, exitCode: null, stdout: "", stderr: "", error: error instanceof Error ? error.message : "Command failed to start.", overflow: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let overflow = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ ok: false, timedOut: true, exitCode: null, stdout: formatCommandOutput(stdout, sanitizeOutput, outputLimitBytes), stderr: formatCommandOutput(stderr, sanitizeOutput, outputLimitBytes), error: "Command timed out.", overflow });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (overflow) return;
      if (!structuredOutput) {
        stdout = appendTailBounded(stdout, chunk.toString("utf8"), outputLimitBytes);
        return;
      }
      const captured = appendBounded(stdout, chunk.toString("utf8"), outputLimitBytes);
      stdout = captured.value;
      overflow ||= captured.overflow;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (overflow) return;
      if (!structuredOutput) {
        stderr = appendTailBounded(stderr, chunk.toString("utf8"), outputLimitBytes);
        return;
      }
      const captured = appendBounded(stderr, chunk.toString("utf8"), outputLimitBytes);
      stderr = captured.value;
      overflow ||= captured.overflow;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, timedOut: false, exitCode: null, stdout: formatCommandOutput(stdout, sanitizeOutput, outputLimitBytes), stderr: formatCommandOutput(stderr, sanitizeOutput, outputLimitBytes), error: error.message, overflow });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, timedOut: false, exitCode: code, stdout: formatCommandOutput(stdout, sanitizeOutput, outputLimitBytes), stderr: formatCommandOutput(stderr, sanitizeOutput, outputLimitBytes), error: undefined, overflow });
    });
  });
}

function formatCommandOutput(value: string, sanitize: boolean, outputLimitBytes: number): string {
  return sanitize ? sanitizeAgentSetupOutput(value) : value.slice(0, outputLimitBytes);
}

function getClaudeCommandCandidates(command: string): readonly string[] {
  if (command !== "claude") return [command];
  const preferred = getPreferredClaudeCommand();
  if (preferred !== "claude") return [preferred];
  if (process.platform === "win32") return ["claude", "claude.cmd"];
  return ["claude"];
}

function createCommandEnv(): NodeJS.ProcessEnv {
  const separator = process.platform === "win32" ? ";" : ":";
  const existingPath = process.env.PATH ?? "";
  return { ...process.env, PATH: dedupePathEntries([existingPath, ...getExtraCommandPaths()], separator).join(separator) };
}

function getExtraCommandPaths(): readonly string[] {
  return buildExtraCommandPaths({ homeDir: app.getPath("home"), env: process.env, platform: process.platform });
}

function dedupePathEntries(paths: readonly string[], separator: string): readonly string[] {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const path of paths.flatMap((value) => value.split(separator)).filter(Boolean)) {
    if (seen.has(path)) continue;
    seen.add(path);
    entries.push(path);
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCommandNotFound(result: CommandResult): boolean {
  return Boolean(result.error && /ENOENT|not found/i.test(result.error));
}

function summarizeCommandResult(result: CommandResult): string {
  if (result.timedOut) return "command timed out.";
  const output = sanitizeAgentSetupOutput(result.stderr || result.stdout || result.error || `exit code ${result.exitCode ?? "unknown"}`);
  return output || "command failed.";
}

function formatUserPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.replace(app.getPath("home"), "~");
}

function appendBounded(existing: string, next: string, maxBytes: number): BoundedOutput {
  const existingBytes = Buffer.byteLength(existing, "utf8");
  const nextBytes = Buffer.byteLength(next, "utf8");
  if (existingBytes + nextBytes <= maxBytes) return { value: existing + next, overflow: false };
  const availableBytes = Math.max(0, maxBytes - existingBytes);
  return { value: existing + Buffer.from(next, "utf8").subarray(0, availableBytes).toString("utf8"), overflow: true };
}

function appendTailBounded(existing: string, next: string, maxChars: number): string {
  const combined = existing + next;
  return combined.length > maxChars ? combined.slice(combined.length - maxChars) : combined;
}

function writeActionJournal(entry: Omit<AgentSetupJournalEntry, "timestamp"> & { readonly timestamp?: string }): void {
  try {
    const path = getJournalPath();
    const entries = readActionJournal().concat({ ...entry, command: entry.command.map((part) => formatUserPath(part) ?? part), message: sanitizeAgentSetupOutput(entry.message), timestamp: entry.timestamp || new Date().toISOString() }).slice(-20);
    mkdirSync(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
    renameSync(tempPath, path);
  } catch (error) {
    console.error("Failed to write OpenPets agent setup action journal.", error);
  }
}

function readActionJournal(): AgentSetupJournalEntry[] {
  const path = getJournalPath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isJournalEntry).slice(-20) : [];
  } catch {
    return [];
  }
}

function getJournalPath(): string {
  return join(app.getPath("userData"), "agent-setup-actions.json");
}

function isJournalEntry(value: unknown): value is AgentSetupJournalEntry {
  return typeof value === "object" && value !== null && typeof (value as { timestamp?: unknown }).timestamp === "string";
}

export const agentSetupInternalsForChecks = {
  sanitizeAgentSetupOutput,
  createOpenPetsHookSettingsPreview,
};
