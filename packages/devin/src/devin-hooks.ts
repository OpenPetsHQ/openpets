import { isAbsolute, join } from "node:path";
import { homedir } from "node:os";

import {
  editDevinConfigText,
  isRecord,
  planDevinConfigWrite,
  readDevinConfigFile,
  type DevinConfigError,
  type DevinConfigReadResult,
  type DevinPlannedWrite,
} from "./devin-config-file.js";
import { devinCliHookEvents, devinCliReactiveToolPattern, devinDesktopHookEvents } from "./devin-hook-events.js";
import { getDevinConfigDir, isValidDevinNodeCommand, isValidOpenPetsPackageVersion, validateOpenPetsPetId, type DevinCommandMode } from "./devin-mcp.js";

/**
 * Manages the OpenPets lifecycle hooks for both Devin hook systems:
 *
 * - `cli`: Devin CLI (Devin Local agent) user hooks, the `hooks` key of
 *   `<devin config dir>/config.json`, in Claude Code-compatible format.
 * - `desktop`: Devin Desktop (Cascade) user hooks in
 *   `~/.codeium/windsurf/hooks.json`.
 *
 * Both run `openpets hook --openpets-managed --agent devin`, which maps the
 * payload with `mapDevinHookPayload()` and reacts over local IPC.
 */

export type DevinHookTarget = "cli" | "desktop";
export type DevinHooksStatus = "missing" | "installed" | "needs-update" | "invalid" | "error";

export interface DevinHookCommandOptions {
  readonly cliVersion: string;
  readonly petId?: string;
  readonly commandMode?: DevinCommandMode;
  readonly cliEntryPath?: string;
  readonly nodeCommand?: string;
}

export interface DevinHooksStatusResult {
  readonly target: DevinHookTarget;
  readonly status: DevinHooksStatus;
  readonly message: string;
  readonly path: string;
  readonly canInstall: boolean;
  readonly canRemove: boolean;
}

export const devinHookMarker = "--openpets-managed";
const devinHookAgentArgs = "--agent devin";
const devinCliHookTimeoutSeconds = 5;

interface HookFormat {
  readonly label: string;
  readonly events: readonly string[];
  readonly buildEntry: (event: string, command: string) => unknown;
  readonly withoutManagedHooks: (entry: unknown) => unknown | null;
}

export function getDevinCliConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir(),
  platform: NodeJS.Platform | string = process.platform,
): string {
  return join(getDevinConfigDir(env, homeDir, platform), "config.json");
}

export function getDevinDesktopHooksPath(homeDir = homedir()): string {
  return join(homeDir, ".codeium", "windsurf", "hooks.json");
}

export function buildDevinHookCommand(options: DevinHookCommandOptions): string {
  const petArgs = options.petId === undefined ? "" : ` --pet ${validateOpenPetsPetId(options.petId)}`;
  const hookArgs = `hook ${devinHookMarker} ${devinHookAgentArgs}${petArgs}`;
  const mode = options.commandMode ?? "published";

  if (mode === "local" || mode === "bundled") {
    if (!options.cliEntryPath || !isValidOpenPetsCliScriptPath(options.cliEntryPath)) {
      throw new Error("Devin local hook setup requires a safe absolute OpenPets CLI entry path.");
    }
    const nodeCommand = options.nodeCommand ?? "node";
    if (!isValidDevinNodeCommand(nodeCommand)) {
      throw new Error("Invalid Devin Node.js command.");
    }
    return `${shellQuote(nodeCommand)} ${shellQuote(options.cliEntryPath)} ${hookArgs}`;
  }

  if (!isValidOpenPetsPackageVersion(options.cliVersion)) {
    throw new Error("Invalid OpenPets package version.");
  }
  return `npx -y @open-pets/cli@${options.cliVersion} ${hookArgs}`;
}

export function readDevinHooksFile(target: DevinHookTarget, path: string): DevinConfigReadResult | DevinConfigError {
  const format = getHookFormat(target);
  return readDevinConfigFile(path, format.label, (config) => validateHooksShape(config, format));
}

export function classifyDevinHooks(
  target: DevinHookTarget,
  path: string,
  options: DevinHookCommandOptions,
  platform: NodeJS.Platform | string = process.platform,
): DevinHooksStatusResult {
  const existing = readDevinHooksFile(target, path);
  if (!existing.ok) {
    return {
      target,
      status: existing.reason === "io" ? "error" : "invalid",
      message: existing.message,
      path,
      canInstall: false,
      canRemove: false,
    };
  }

  const format = getHookFormat(target, platform);
  const hooks = isRecord(existing.config.hooks) ? existing.config.hooks : {};
  const command = buildDevinHookCommand(options);
  let managedCount = 0;
  let isCurrent = true;

  // Installed means each required event holds exactly one managed entry equal
  // to the current hook, and no other event holds a managed entry.
  for (const event of new Set([...Object.keys(hooks), ...format.events])) {
    const entries: unknown = hooks[event];
    const managedEntries = Array.isArray(entries)
      ? entries.filter((entry) => format.withoutManagedHooks(entry) !== entry)
      : [];
    managedCount += managedEntries.length;

    if (!format.events.includes(event)) {
      if (managedEntries.length > 0) isCurrent = false;
      continue;
    }

    const expected = JSON.stringify(format.buildEntry(event, command));
    const hasOnlyCurrentHook = managedEntries.length === 1 && JSON.stringify(managedEntries[0]) === expected;
    if (!hasOnlyCurrentHook) isCurrent = false;
  }

  const name = target === "cli" ? "Devin CLI" : "Devin Desktop";
  if (managedCount === 0) {
    return { target, status: "missing", message: `OpenPets hooks are not installed for ${name}.`, path, canInstall: true, canRemove: false };
  }
  if (isCurrent) {
    return { target, status: "installed", message: `OpenPets hooks are installed for ${name}.`, path, canInstall: false, canRemove: true };
  }
  return { target, status: "needs-update", message: `OpenPets hooks for ${name} need an update.`, path, canInstall: true, canRemove: true };
}

export function planDevinHooksInstall(
  target: DevinHookTarget,
  path: string,
  options: DevinHookCommandOptions,
  platform: NodeJS.Platform | string = process.platform,
): DevinPlannedWrite | DevinConfigError {
  const format = getHookFormat(target, platform);
  const command = buildDevinHookCommand(options);
  return planHooksEdit(target, path, format, (event, entries) => {
    if (!format.events.includes(event)) return entries;
    return [...entries, format.buildEntry(event, command)];
  });
}

export function planDevinHooksRemove(target: DevinHookTarget, path: string): DevinPlannedWrite | DevinConfigError {
  const format = getHookFormat(target);
  return planHooksEdit(target, path, format, (_event, entries) => entries);
}

/**
 * Strips every OpenPets-managed hook, lets `finalize` add the current ones,
 * and edits only the event arrays that change.
 */
function planHooksEdit(
  target: DevinHookTarget,
  path: string,
  format: HookFormat,
  finalize: (event: string, unmanagedEntries: readonly unknown[]) => readonly unknown[],
): DevinPlannedWrite | DevinConfigError {
  const existing = readDevinHooksFile(target, path);
  if (!existing.ok) return existing;

  const hooks = isRecord(existing.config.hooks) ? existing.config.hooks : {};
  const events = new Set([...Object.keys(hooks), ...format.events]);
  const validate = (config: Record<string, unknown>) => validateHooksShape(config, format);
  let content = existing.content;
  let remainingEvents = 0;

  for (const event of events) {
    const current = hooks[event];
    if (current !== undefined && !Array.isArray(current)) {
      remainingEvents += 1;
      continue;
    }

    const currentEntries = Array.isArray(current) ? current : [];
    const unmanaged = currentEntries
      .map((entry) => format.withoutManagedHooks(entry))
      .filter((entry) => entry !== null);
    const next = finalize(event, unmanaged);
    if (next.length > 0) remainingEvents += 1;
    if (JSON.stringify(next) === JSON.stringify(currentEntries)) continue;

    const edited = editDevinConfigText(content, ["hooks", event], next.length > 0 ? next : undefined, format.label, validate);
    if (typeof edited !== "string") return edited;
    content = edited;
  }

  if (remainingEvents === 0 && existing.config.hooks !== undefined) {
    const edited = editDevinConfigText(content, ["hooks"], undefined, format.label, validate);
    if (typeof edited !== "string") return edited;
    content = edited;
  }

  if (content === existing.content) {
    return { ok: false, message: `${format.label} has no OpenPets hook changes to make.`, reason: "conflict" };
  }
  return planDevinConfigWrite(path, existing, content);
}

function getHookFormat(target: DevinHookTarget, platform: NodeJS.Platform | string = process.platform): HookFormat {
  if (target === "cli") {
    return {
      label: "Devin CLI config",
      events: devinCliHookEvents,
      buildEntry: (event, command) => {
        const hook = { type: "command", command, timeout: devinCliHookTimeoutSeconds };
        if (event === "PreToolUse") return { matcher: devinCliReactiveToolPattern, hooks: [hook] };
        return { hooks: [hook] };
      },
      withoutManagedHooks: (entry) => {
        if (!isRecord(entry) || !Array.isArray(entry.hooks)) return entry;
        const hooks = entry.hooks.filter((hook) => !isManagedHook(hook));
        if (hooks.length === entry.hooks.length) return entry;
        return hooks.length > 0 ? { ...entry, hooks } : null;
      },
    };
  }

  return {
    label: "Devin Desktop hooks",
    events: devinDesktopHookEvents,
    buildEntry: (_event, command) => {
      // Cascade runs `powershell` on Windows; a command starting with a quoted
      // executable path needs the call operator there.
      const needsCallOperator = platform === "win32" && command.startsWith("\"");
      if (needsCallOperator) return { command, powershell: `& ${command}`, show_output: false };
      return { command, show_output: false };
    },
    withoutManagedHooks: (entry) => (isManagedHook(entry) ? null : entry),
  };
}

function isManagedHook(value: unknown): boolean {
  if (!isRecord(value) || typeof value.command !== "string") return false;
  return value.command.includes(devinHookMarker) && value.command.includes(devinHookAgentArgs);
}

function validateHooksShape(config: Record<string, unknown>, format: HookFormat): string | undefined {
  if (config.hooks === undefined) return undefined;
  if (!isRecord(config.hooks)) return "hooks must be an object.";
  for (const event of format.events) {
    const entries = config.hooks[event];
    if (entries !== undefined && !Array.isArray(entries)) return `hooks.${event} must be an array.`;
  }
  return undefined;
}

function isValidOpenPetsCliScriptPath(value: string): boolean {
  if (!isAbsolute(value)) return false;
  if (value.length > 4096 || /[\0\r\n"]/u.test(value)) return false;
  if (value.split(/[\\/]+/u).includes("..")) return false;
  return /(?:^|[\\/])node_modules[\\/]@open-pets[\\/]cli[\\/]dist[\\/]index\.js$/u.test(value)
    || /(?:^|[\\/])packages[\\/]cli[\\/]dist[\\/]index\.js$/u.test(value);
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/u.test(value)) return value;
  if (/[\r\n"\0]/u.test(value)) throw new Error("Devin hook command path contains unsupported characters.");
  return `"${value.replaceAll("$", "\\$").replaceAll("`", "\\`")}"`;
}
