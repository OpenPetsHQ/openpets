import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser";

import {
  buildDevinMcpEntry,
  devinMcpServerName,
  isValidDevinNodeCommand,
  isValidOpenPetsMcpScriptPath,
  isValidOpenPetsPackageVersion,
  isValidPetId,
  type DevinMcpEntry,
  type DevinMcpPreviewOptions,
} from "./devin-mcp.js";

export type DevinMcpStatus = "missing" | "installed" | "disabled" | "needs-update" | "conflict" | "invalid" | "error";

export interface DevinConfigReadResult {
  readonly ok: true;
  readonly config: Record<string, unknown>;
  readonly content: string;
  readonly exists: boolean;
}

export interface DevinConfigError {
  readonly ok: false;
  readonly message: string;
  readonly reason: "parse" | "size" | "symlink" | "not-regular" | "unsafe-path" | "invalid-schema" | "conflict" | "io";
}

export interface DevinPlannedWrite {
  readonly targetPath: string;
  readonly backupPath?: string;
  readonly tempPath: string;
  readonly sourceExists: boolean;
  readonly sourceContent: string;
  readonly content: string;
}

export interface DevinMcpStatusResult {
  readonly status: DevinMcpStatus;
  readonly message: string;
  readonly configPath: string;
  readonly canInstall: boolean;
  readonly canReplace: boolean;
  readonly canRemove: boolean;
  readonly previewEntry?: DevinMcpEntry;
}

export const maxDevinConfigBytes = 256 * 1024;

const readErrorMessages: Record<DevinConfigError["reason"], string> = {
  parse: "Devin MCP config is not valid JSON.",
  size: "Devin MCP config exceeds 256 KiB.",
  symlink: "Devin MCP config path contains a symlink.",
  "not-regular": "Devin MCP config is not a regular file.",
  "unsafe-path": "Devin MCP config path is unsafe.",
  "invalid-schema": "Devin MCP config has an invalid shape.",
  conflict: "Devin MCP config changed while OpenPets was updating it.",
  io: "Failed to read Devin MCP config.",
};

export function readDevinMcpConfig(configPath: string): DevinConfigReadResult | DevinConfigError {
  try {
    const parentSafety = assertSafeParentDirectory(dirname(configPath));
    if (!parentSafety.ok) return parentSafety;

    const fileSafety = assertSafeExistingConfigFile(configPath);
    if (!fileSafety.ok) return fileSafety;
    if (!fileSafety.exists) return { ok: true, config: {}, content: "", exists: false };

    const content = readFileSync(configPath, "utf8");
    const parsed = parseDevinMcpConfig(content);
    if (!parsed.ok) return parsed;
    return { ok: true, config: parsed.value, content, exists: true };
  } catch (error) {
    return { ok: false, message: `IO error: ${error instanceof Error ? error.message : String(error)}`, reason: "io" };
  }
}

export function classifyDevinMcpStatus(
  configResult: DevinConfigReadResult | DevinConfigError,
  configPath: string,
  expected: DevinMcpPreviewOptions,
): DevinMcpStatusResult {
  if (!configResult.ok) {
    return {
      status: configResult.reason === "io" ? "error" : "invalid",
      message: readErrorMessages[configResult.reason],
      configPath,
      canInstall: false,
      canReplace: false,
      canRemove: false,
    };
  }

  const expectedEntry = buildDevinMcpEntry(expected);
  const mcpServers = isRecord(configResult.config.mcpServers) ? configResult.config.mcpServers : undefined;
  const existingEntry = mcpServers?.[devinMcpServerName];

  if (existingEntry === undefined) {
    return {
      status: "missing",
      message: configResult.exists ? "OpenPets MCP is not configured for Devin." : "Devin MCP config does not exist yet.",
      configPath,
      canInstall: true,
      canReplace: false,
      canRemove: false,
      previewEntry: expectedEntry,
    };
  }

  if (!isManagedOpenPetsMcpEntry(existingEntry)) {
    return {
      status: "conflict",
      message: "Devin MCP config has an openpets entry that OpenPets does not manage.",
      configPath,
      canInstall: false,
      canReplace: true,
      canRemove: false,
      previewEntry: expectedEntry,
    };
  }

  if (existingEntry.disabled === true) {
    return {
      status: "disabled",
      message: "OpenPets MCP is disabled in Devin. Replace it to re-enable OpenPets.",
      configPath,
      canInstall: false,
      canReplace: true,
      canRemove: true,
      previewEntry: expectedEntry,
    };
  }

  if (isSameCommand(existingEntry, expectedEntry)) {
    return {
      status: "installed",
      message: "OpenPets MCP is configured for Devin Desktop and Devin CLI.",
      configPath,
      canInstall: false,
      canReplace: false,
      canRemove: true,
      previewEntry: expectedEntry,
    };
  }

  return {
    status: "needs-update",
    message: "OpenPets MCP for Devin needs an update (version, pet, or command source differs).",
    configPath,
    canInstall: true,
    canReplace: true,
    canRemove: true,
    previewEntry: expectedEntry,
  };
}

/**
 * Recognizes entries OpenPets wrote: a pinned `npx -y @open-pets/mcp@VERSION`
 * command or a Node.js command running an OpenPets MCP entry script, each with
 * an optional `--pet <id>`.
 */
export function isManagedOpenPetsMcpEntry(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (typeof value.command !== "string") return false;
  if (!Array.isArray(value.args)) return false;
  if (!value.args.every((arg) => typeof arg === "string")) return false;

  const args = value.args as readonly string[];
  if (value.command === "npx") return isPublishedOpenPetsMcpArgs(args);
  if (isValidDevinNodeCommand(value.command)) return isNodeOpenPetsMcpArgs(args);
  return false;
}

export function planDevinMcpInstall(configPath: string, options: DevinMcpPreviewOptions): DevinPlannedWrite | DevinConfigError {
  const existing = readDevinMcpConfig(configPath);
  if (!existing.ok) return existing;

  const status = classifyDevinMcpStatus(existing, configPath, options);
  if (!status.canInstall) {
    return { ok: false, message: describeBlockedWrite(status, "install"), reason: "conflict" };
  }
  return planEntryWrite(configPath, existing, buildDevinMcpEntry(options));
}

export function planDevinMcpReplace(configPath: string, options: DevinMcpPreviewOptions): DevinPlannedWrite | DevinConfigError {
  const existing = readDevinMcpConfig(configPath);
  if (!existing.ok) return existing;

  const status = classifyDevinMcpStatus(existing, configPath, options);
  if (!status.canReplace) {
    return { ok: false, message: describeBlockedWrite(status, "replace"), reason: "conflict" };
  }
  return planEntryWrite(configPath, existing, buildDevinMcpEntry(options));
}

export function planDevinMcpRemove(configPath: string): DevinPlannedWrite | DevinConfigError {
  const existing = readDevinMcpConfig(configPath);
  if (!existing.ok) return existing;

  const mcpServers = isRecord(existing.config.mcpServers) ? existing.config.mcpServers : undefined;
  const existingEntry = mcpServers?.[devinMcpServerName];
  if (existingEntry === undefined) {
    return { ok: false, message: "OpenPets MCP is not configured for Devin.", reason: "conflict" };
  }
  if (!isManagedOpenPetsMcpEntry(existingEntry)) {
    return { ok: false, message: "Cannot remove: the Devin openpets entry is not managed by OpenPets.", reason: "conflict" };
  }

  const edited = editConfigText(existing.content, ["mcpServers", devinMcpServerName], undefined);
  if (typeof edited !== "string") return edited;
  return buildWritePlan(configPath, existing, edited);
}

/**
 * Publishes a planned write: refuses when the config changed since planning,
 * keeps a byte-for-byte backup of the previous file, and replaces the target
 * through an exclusive temp file and an atomic rename.
 */
export function executeDevinMcpWrite(plan: DevinPlannedWrite): void {
  const parent = dirname(plan.targetPath);
  const parentSafety = assertSafeParentDirectory(parent);
  if (!parentSafety.ok) throw new Error(parentSafety.message);

  const current = readDevinMcpConfig(plan.targetPath);
  if (!current.ok) throw new Error(current.message);
  if (current.exists !== plan.sourceExists || current.content !== plan.sourceContent) {
    throw new Error(readErrorMessages.conflict);
  }

  const validated = parseDevinMcpConfig(plan.content);
  if (!validated.ok) throw new Error(validated.message);

  mkdirSync(parent, { recursive: true, mode: 0o700 });

  if (plan.backupPath) {
    writeExclusiveFile(plan.backupPath, plan.sourceContent);
  }

  writeExclusiveFile(plan.tempPath, plan.content);
  try {
    renameSync(plan.tempPath, plan.targetPath);
  } catch (error) {
    rmSync(plan.tempPath, { force: true });
    throw error;
  }

  try {
    chmodSync(plan.targetPath, 0o600);
  } catch {
    // Best effort: Windows and some filesystems ignore POSIX modes, and the
    // published content is already complete.
  }
}

function planEntryWrite(
  configPath: string,
  existing: DevinConfigReadResult,
  entry: DevinMcpEntry,
): DevinPlannedWrite | DevinConfigError {
  const edited = editConfigText(existing.content, ["mcpServers", devinMcpServerName], entry);
  if (typeof edited !== "string") return edited;
  return buildWritePlan(configPath, existing, edited);
}

function parseDevinMcpConfig(text: string): { readonly ok: true; readonly value: Record<string, unknown> } | DevinConfigError {
  if (Buffer.byteLength(text, "utf8") > maxDevinConfigBytes) {
    return { ok: false, message: readErrorMessages.size, reason: "size" };
  }
  if (!text.trim()) return { ok: true, value: {} };

  const errors: ParseError[] = [];
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false }) as unknown;
  if (errors.length > 0) {
    return { ok: false, message: readErrorMessages.parse, reason: "parse" };
  }
  if (!isRecord(parsed)) {
    return { ok: false, message: "Devin MCP config must be a JSON object.", reason: "invalid-schema" };
  }
  if (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers)) {
    return { ok: false, message: "Devin MCP config mcpServers must be an object.", reason: "invalid-schema" };
  }
  return { ok: true, value: parsed };
}

/** Targeted JSONC edit so comments, ordering, and unrelated servers survive. */
function editConfigText(text: string, path: readonly string[], value: unknown): string | DevinConfigError {
  const source = text.trim() ? text : "{}\n";
  const edits = modify(source, [...path], value, { formattingOptions: { tabSize: 2, insertSpaces: true } });
  const next = applyEdits(source, edits);

  const validated = parseDevinMcpConfig(next);
  if (!validated.ok) return validated;
  return next.endsWith("\n") ? next : `${next}\n`;
}

function buildWritePlan(configPath: string, existing: DevinConfigReadResult, content: string): DevinPlannedWrite {
  const parent = dirname(configPath);
  const stamp = `${process.pid}-${Date.now()}-${randomUUID()}`;
  return {
    targetPath: configPath,
    backupPath: existing.exists ? `${configPath}.openpets-backup-${stamp}.json` : undefined,
    tempPath: join(parent, `.openpets-${stamp}.tmp`),
    sourceExists: existing.exists,
    sourceContent: existing.content,
    content,
  };
}

function describeBlockedWrite(status: DevinMcpStatusResult, operation: "install" | "replace"): string {
  if (status.status === "installed") return "OpenPets MCP is already configured for Devin.";
  if (status.status === "missing") return "Cannot replace: OpenPets MCP is not configured for Devin. Install it instead.";
  if (status.status === "conflict" || status.status === "disabled") {
    return `${status.message} Use replace to overwrite the openpets entry.`;
  }
  return `Cannot ${operation} Devin MCP config: ${status.message}`;
}

function isPublishedOpenPetsMcpArgs(args: readonly string[]): boolean {
  if (args.length < 2) return false;
  if (args[0] !== "-y") return false;

  const match = /^@open-pets\/mcp@(.+)$/u.exec(args[1] ?? "");
  if (!match || !isValidOpenPetsPackageVersion(match[1] ?? "")) return false;
  return hasValidPetArgs(args.slice(2));
}

function isNodeOpenPetsMcpArgs(args: readonly string[]): boolean {
  if (args.length < 1) return false;
  if (!isValidOpenPetsMcpScriptPath(args[0] ?? "")) return false;
  return hasValidPetArgs(args.slice(1));
}

function hasValidPetArgs(args: readonly string[]): boolean {
  if (args.length === 0) return true;
  if (args.length !== 2) return false;
  return args[0] === "--pet" && isValidPetId(args[1] ?? "");
}

function isSameCommand(value: Record<string, unknown>, expected: DevinMcpEntry): boolean {
  if (value.command !== expected.command) return false;
  if (!Array.isArray(value.args)) return false;
  if (value.args.length !== expected.args.length) return false;
  return value.args.every((arg: unknown, index: number) => arg === expected.args[index]);
}

function writeExclusiveFile(path: string, content: string): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, content, "utf8");
  } finally {
    closeSync(fd);
  }
}

function assertSafeExistingConfigFile(path: string): DevinConfigError | { readonly ok: true; readonly exists: boolean } {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return { ok: true, exists: false };
  if (stat.isSymbolicLink()) return { ok: false, message: readErrorMessages.symlink, reason: "symlink" };
  if (!stat.isFile()) return { ok: false, message: readErrorMessages["not-regular"], reason: "not-regular" };
  if (stat.size > maxDevinConfigBytes) return { ok: false, message: readErrorMessages.size, reason: "size" };
  return { ok: true, exists: true };
}

function assertSafeParentDirectory(path: string): DevinConfigError | { readonly ok: true } {
  if (path.split(/[\\/]+/u).includes("..")) {
    return { ok: false, message: "Devin MCP config path must not contain parent traversal segments.", reason: "unsafe-path" };
  }

  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  const parts = absolutePath.slice(root.length).split(/[\\/]+/u).filter(Boolean);
  let current = root;

  for (const part of parts) {
    current = join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat) break;
    if (stat.isSymbolicLink()) return { ok: false, message: readErrorMessages.symlink, reason: "symlink" };
    if (!stat.isDirectory()) return { ok: false, message: "Devin MCP config parent path segment must be a directory.", reason: "unsafe-path" };
  }

  return { ok: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
