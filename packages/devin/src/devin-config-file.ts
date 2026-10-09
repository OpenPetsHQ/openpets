import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser";

/**
 * Safe read/edit/publish transaction shared by every Devin config file
 * OpenPets touches (MCP config, Devin CLI config, Devin Desktop hooks). Files
 * are JSON with comments; edits are targeted so unrelated content survives.
 */

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

/** Extra shape checks a caller applies to a parsed config object. */
export type DevinConfigValidator = (config: Record<string, unknown>) => string | undefined;

export const maxDevinConfigBytes = 256 * 1024;

export function readDevinConfigFile(
  path: string,
  label: string,
  validate?: DevinConfigValidator,
): DevinConfigReadResult | DevinConfigError {
  try {
    const parentSafety = assertSafeParentDirectory(dirname(path), label);
    if (!parentSafety.ok) return parentSafety;

    const fileSafety = assertSafeExistingFile(path, label);
    if (!fileSafety.ok) return fileSafety;
    if (!fileSafety.exists) return { ok: true, config: {}, content: "", exists: false };

    const content = readFileSync(path, "utf8");
    const parsed = parseDevinConfigText(content, label, validate);
    if (!parsed.ok) return parsed;
    return { ok: true, config: parsed.value, content, exists: true };
  } catch (error) {
    return { ok: false, message: `Failed to read ${label}: ${error instanceof Error ? error.message : String(error)}`, reason: "io" };
  }
}

/** Applies one targeted JSONC edit; `undefined` removes the property. */
export function editDevinConfigText(
  text: string,
  path: readonly string[],
  value: unknown,
  label: string,
  validate?: DevinConfigValidator,
): string | DevinConfigError {
  const source = text.trim() ? text : "{}\n";
  const edits = modify(source, [...path], value, { formattingOptions: { tabSize: 2, insertSpaces: true } });
  const next = applyEdits(source, edits);

  const validated = parseDevinConfigText(next, label, validate);
  if (!validated.ok) return validated;
  return next.endsWith("\n") ? next : `${next}\n`;
}

export function planDevinConfigWrite(path: string, existing: DevinConfigReadResult, content: string): DevinPlannedWrite {
  const stamp = `${process.pid}-${Date.now()}-${randomUUID()}`;
  return {
    targetPath: path,
    backupPath: existing.exists ? `${path}.openpets-backup-${stamp}.json` : undefined,
    tempPath: join(dirname(path), `.openpets-${stamp}.tmp`),
    sourceExists: existing.exists,
    sourceContent: existing.content,
    content,
  };
}

/**
 * Publishes a planned write: keeps a byte-for-byte backup of the previous
 * file, stages the new content in an exclusive temp file, then refuses when
 * the target changed since planning and otherwise replaces it with an atomic
 * rename. The stale check runs after the slow file writes so the window in
 * which another writer's save could be overwritten is as small as possible.
 */
export function executeDevinConfigWrite(plan: DevinPlannedWrite): void {
  const label = "Devin config";
  const parent = dirname(plan.targetPath);
  const parentSafety = assertSafeParentDirectory(parent, label);
  if (!parentSafety.ok) throw new Error(parentSafety.message);

  const validated = parseDevinConfigText(plan.content, label);
  if (!validated.ok) throw new Error(validated.message);

  mkdirSync(parent, { recursive: true, mode: 0o700 });

  if (plan.backupPath) {
    writeExclusiveFile(plan.backupPath, plan.sourceContent);
  }

  writeExclusiveFile(plan.tempPath, plan.content);
  try {
    assertUnchangedSincePlanning(plan, label);
    renameSync(plan.tempPath, plan.targetPath);
  } catch (error) {
    rmSync(plan.tempPath, { force: true });
    if (plan.backupPath) rmSync(plan.backupPath, { force: true });
    throw error;
  }

  try {
    chmodSync(plan.targetPath, 0o600);
  } catch {
    // Best effort: Windows and some filesystems ignore POSIX modes, and the
    // published content is already complete.
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDevinConfigText(
  text: string,
  label: string,
  validate?: DevinConfigValidator,
): { readonly ok: true; readonly value: Record<string, unknown> } | DevinConfigError {
  if (Buffer.byteLength(text, "utf8") > maxDevinConfigBytes) {
    return { ok: false, message: `${label} exceeds 256 KiB.`, reason: "size" };
  }
  if (!text.trim()) return { ok: true, value: {} };

  const errors: ParseError[] = [];
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false }) as unknown;
  if (errors.length > 0) {
    return { ok: false, message: `${label} is not valid JSON.`, reason: "parse" };
  }
  if (!isRecord(parsed)) {
    return { ok: false, message: `${label} must be a JSON object.`, reason: "invalid-schema" };
  }

  const schemaError = validate?.(parsed);
  if (schemaError) {
    return { ok: false, message: `${label} ${schemaError}`, reason: "invalid-schema" };
  }
  return { ok: true, value: parsed };
}

function assertUnchangedSincePlanning(plan: DevinPlannedWrite, label: string): void {
  const current = readDevinConfigFile(plan.targetPath, label);
  if (!current.ok) throw new Error(current.message);
  if (current.exists !== plan.sourceExists || current.content !== plan.sourceContent) {
    throw new Error(`${plan.targetPath} changed while OpenPets was updating it. Try again.`);
  }
}

function writeExclusiveFile(path: string, content: string): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, content, "utf8");
  } finally {
    closeSync(fd);
  }
}

function assertSafeExistingFile(path: string, label: string): DevinConfigError | { readonly ok: true; readonly exists: boolean } {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return { ok: true, exists: false };
  if (stat.isSymbolicLink()) return { ok: false, message: `${label} path is a symlink.`, reason: "symlink" };
  if (!stat.isFile()) return { ok: false, message: `${label} is not a regular file.`, reason: "not-regular" };
  if (stat.size > maxDevinConfigBytes) return { ok: false, message: `${label} exceeds 256 KiB.`, reason: "size" };
  return { ok: true, exists: true };
}

function assertSafeParentDirectory(path: string, label: string): DevinConfigError | { readonly ok: true } {
  if (path.split(/[\\/]+/u).includes("..")) {
    return { ok: false, message: `${label} path must not contain parent traversal segments.`, reason: "unsafe-path" };
  }

  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  const parts = absolutePath.slice(root.length).split(/[\\/]+/u).filter(Boolean);
  let current = root;

  for (const part of parts) {
    current = join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat) break;
    if (stat.isSymbolicLink()) return { ok: false, message: `${label} path contains a symlink.`, reason: "symlink" };
    if (!stat.isDirectory()) return { ok: false, message: `${label} parent path segment must be a directory.`, reason: "unsafe-path" };
  }

  return { ok: true };
}
