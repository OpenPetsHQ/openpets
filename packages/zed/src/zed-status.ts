import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser";

import {
  buildZedMcpEntry,
  isValidOpenPetsMcpScriptPath,
  isValidOpenPetsPackageVersion,
  isValidPetId,
  isValidZedNodeCommand,
  zedMcpServerName,
  type ZedMcpEntry,
  type ZedMcpPreviewOptions,
} from "./zed-mcp.js";

export type ZedMcpStatus = "missing" | "installed" | "disabled" | "needs-update" | "conflict" | "invalid" | "error";

export interface ZedSettingsReadResult {
  readonly ok: true;
  readonly config: Record<string, unknown>;
  readonly content: string;
  readonly exists: boolean;
}

export interface ZedConfigError {
  readonly ok: false;
  readonly message: string;
  readonly reason: "parse" | "size" | "symlink" | "not-regular" | "unsafe-path" | "invalid-schema" | "io";
}

export interface ZedPlannedWrite {
  readonly targetPath: string;
  readonly backupPath?: string;
  readonly claimPath?: string;
  readonly tempPath: string;
  readonly sourceExists: boolean;
  readonly sourceContent: string;
  readonly content: string;
}

export interface ZedMcpStatusResult {
  readonly status: ZedMcpStatus;
  readonly message: string;
  readonly settingsPath: string;
  readonly canInstall: boolean;
  readonly canReplace: boolean;
  readonly canRemove: boolean;
  readonly previewEntry?: ZedMcpEntry;
  readonly redactedDetails?: string;
}

export interface ParsedZedSettings {
  readonly ok: true;
  readonly value: Record<string, unknown>;
}

export const maxZedSettingsBytes = 256 * 1024;

const zedWriteLockVersion = 1;
const maxZedWriteLockBytes = 16 * 1024;
const staleUnownedZedLockMs = 10 * 60 * 1000;
const activeZedWriteLockTokens = new Set<string>();

interface ZedWriteLockRecord {
  readonly version: number;
  readonly token: string;
  readonly pid: number;
  readonly lockTempPath: string;
  readonly targetPath: string;
  readonly backupPath?: string;
  readonly claimPath?: string;
  readonly withdrawalPath?: string;
  readonly tempPath: string;
  readonly sourceExists: boolean;
  readonly sourceHash: string;
  readonly contentHash: string;
}

export function parseZedSettings(text: string): ParsedZedSettings | ZedConfigError {
  if (Buffer.byteLength(text, "utf8") > maxZedSettingsBytes) {
    return { ok: false, message: "Zed settings exceed 256 KiB.", reason: "size" };
  }

  const errors: ParseError[] = [];
  const parsed = parseJsonc(text.trim() ? text : "{}", errors, { allowTrailingComma: true, disallowComments: false }) as unknown;
  if (errors.length > 0) return { ok: false, message: "Zed settings JSONC is invalid.", reason: "parse" };
  if (parsed === undefined) return { ok: true, value: {} };
  if (!isRecord(parsed)) return { ok: false, message: "Zed settings must be a JSON object.", reason: "invalid-schema" };
  if (parsed.context_servers !== undefined && !isRecord(parsed.context_servers)) {
    return { ok: false, message: "Zed settings context_servers must be an object.", reason: "invalid-schema" };
  }
  return { ok: true, value: parsed };
}

export function updateZedSettingsText(
  text: string,
  path: readonly (string | number)[],
  value: unknown,
): string | ZedConfigError {
  const parsed = parseZedSettings(text);
  if (!parsed.ok) return parsed;

  let next = text.trim() ? text : "{}\n";
  const edits = modify(next, [...path], value, { formattingOptions: { tabSize: 2, insertSpaces: true } });
  next = applyEdits(next, edits);
  const validated = parseZedSettings(next);
  if (!validated.ok) return validated;
  return next.endsWith("\n") ? next : `${next}\n`;
}

export function readZedSettings(settingsPath: string): ZedSettingsReadResult | ZedConfigError {
  try {
    const pathSafety = assertSafeConfigPath(settingsPath);
    if (!pathSafety.ok) return pathSafety;

    const existing = assertSafeExistingSettingsFile(settingsPath, true);
    if (!existing.ok) return existing;

    if (!existing.exists) return { ok: true, config: {}, content: "", exists: false };

    const content = readFileSync(settingsPath, "utf8");
    if (Buffer.byteLength(content, "utf8") > maxZedSettingsBytes) {
      return { ok: false, message: "Zed settings exceed 256 KiB.", reason: "size" };
    }

    const parsed = parseZedSettings(content);
    if (!parsed.ok) return parsed;
    return { ok: true, config: parsed.value, content, exists: true };
  } catch (error) {
    return { ok: false, message: `IO error: ${error instanceof Error ? error.message : String(error)}`, reason: "io" };
  }
}

export const readZedMcpConfig = readZedSettings;

export function classifyZedMcpStatus(
  configResult: ZedSettingsReadResult | ZedConfigError,
  settingsPath: string,
  expected: ZedMcpPreviewOptions,
): ZedMcpStatusResult {
  if (!configResult.ok) {
    const messages: Record<ZedConfigError["reason"], string> = {
      parse: "Zed settings JSONC is invalid.",
      size: "Zed settings are too large.",
      symlink: "Zed settings path is a symlink.",
      "not-regular": "Zed settings path is not a regular file.",
      "unsafe-path": "Zed settings path is unsafe.",
      "invalid-schema": "Zed settings have an invalid schema.",
      io: "Failed to read Zed settings.",
    };
    return {
      status: configResult.reason === "io" ? "error" : "invalid",
      message: messages[configResult.reason],
      settingsPath,
      canInstall: false,
      canReplace: false,
      canRemove: false,
      redactedDetails: configResult.message,
    };
  }

  if (!configResult.exists) return missingStatus(settingsPath, expected, "Zed settings do not exist.");

  const contextServers = isRecord(configResult.config.context_servers) ? configResult.config.context_servers : undefined;
  if (!contextServers || contextServers[zedMcpServerName] === undefined) {
    return missingStatus(settingsPath, expected, "OpenPets MCP is not configured in Zed settings.");
  }

  const entry = contextServers[zedMcpServerName];
  const expectedEntry = buildZedMcpEntry(expected);
  const shape = inspectZedMcpEntry(entry);
  if (shape === "invalid") {
    return {
      status: "invalid",
      message: "Zed openpets MCP entry has an invalid schema.",
      settingsPath,
      canInstall: false,
      canReplace: false,
      canRemove: false,
      redactedDetails: "context_servers.openpets is malformed",
    };
  }
  if (shape === "conflict") {
    return {
      status: "conflict",
      message: "Zed settings have a non-OpenPets context server using the openpets key.",
      settingsPath,
      canInstall: false,
      canReplace: true,
      canRemove: false,
      redactedDetails: "Existing context_servers.openpets entry is not managed by OpenPets",
    };
  }
  if (isRecord(entry) && entry.remote === true) {
    const disabled = entry.enabled === false;
    return {
      status: "needs-update",
      message: disabled
        ? "OpenPets MCP is configured for remote execution and disabled in Zed; local execution is required. Use replace to re-enable it."
        : "OpenPets MCP is configured for remote execution in Zed; local execution is required.",
      settingsPath,
      canInstall: !disabled,
      canReplace: true,
      canRemove: true,
      previewEntry: expectedEntry,
    };
  }

  if (shape === "disabled") {
    return {
      status: "disabled",
      message: "OpenPets MCP is configured in Zed but disabled.",
      settingsPath,
      canInstall: false,
      canReplace: true,
      canRemove: true,
      previewEntry: buildZedMcpEntry(expected),
    };
  }

  if (isSameZedMcpEntry(entry, expectedEntry)) {
    return {
      status: "installed",
      message: "OpenPets MCP is installed in Zed and up to date.",
      settingsPath,
      canInstall: false,
      canReplace: false,
      canRemove: true,
      previewEntry: expectedEntry,
    };
  }

  return {
    status: "needs-update",
    message: "OpenPets MCP in Zed needs an update (version, pet, or command differs).",
    settingsPath,
    canInstall: true,
    canReplace: true,
    canRemove: true,
    previewEntry: expectedEntry,
  };
}

export function isManagedOpenPetsMcpEntry(value: unknown): boolean {
  const shape = inspectZedMcpEntry(value);
  return shape === "managed" || shape === "disabled";
}

export function planZedMcpInstall(
  settingsPath: string,
  options: ZedMcpPreviewOptions,
  allowReplace = false,
): ZedPlannedWrite | ZedConfigError {
  const existing = readZedSettings(settingsPath);
  if (!existing.ok) return existing;

  const status = classifyZedMcpStatus(existing, settingsPath, options);
  if (status.status === "invalid" || status.status === "error") {
    return { ok: false, message: status.message, reason: "invalid-schema" };
  }
  if (status.status === "disabled") {
    return { ok: false, message: "Cannot install: OpenPets MCP is disabled in Zed settings. Use replace to explicitly re-enable it.", reason: "invalid-schema" };
  }
  if (status.status === "needs-update" && !status.canInstall) {
    return { ok: false, message: "Cannot install: OpenPets MCP is disabled in Zed settings. Use replace to explicitly re-enable it.", reason: "invalid-schema" };
  }
  if (status.status === "conflict" && !allowReplace) {
    return { ok: false, message: "Cannot install: Zed has a conflicting openpets context server. Use replace instead.", reason: "invalid-schema" };
  }
  if (status.status === "installed") {
    return { ok: false, message: "OpenPets MCP is already installed in Zed.", reason: "invalid-schema" };
  }

  const currentEntry = getOpenPetsEntry(existing.config);
  const nextEntry = status.status === "needs-update" ? preserveManagedFields(currentEntry, options) : buildZedMcpEntry(options);
  return planZedSettingsWrite(settingsPath, existing.content, existing.exists, nextEntry);
}

export function planZedMcpReplace(
  settingsPath: string,
  options: ZedMcpPreviewOptions,
): ZedPlannedWrite | ZedConfigError {
  const existing = readZedSettings(settingsPath);
  if (!existing.ok) return existing;

  const status = classifyZedMcpStatus(existing, settingsPath, options);
  if (status.status === "invalid" || status.status === "error") {
    return { ok: false, message: status.message, reason: "invalid-schema" };
  }
  if (status.status === "missing") {
    return { ok: false, message: "Cannot replace: OpenPets MCP is not configured in Zed settings. Use install instead.", reason: "invalid-schema" };
  }
  if (status.status === "installed") {
    return { ok: false, message: "Cannot replace: OpenPets MCP is already installed in Zed.", reason: "invalid-schema" };
  }

  const currentEntry = getOpenPetsEntry(existing.config);
  const nextEntry = status.status === "conflict"
    ? buildZedMcpEntry(options)
    : preserveManagedFields(currentEntry, options, isRecord(currentEntry) && currentEntry.enabled === false);
  return planZedSettingsWrite(settingsPath, existing.content, existing.exists, nextEntry);
}

export function planZedMcpRemove(settingsPath: string, expectedOptions?: ZedMcpPreviewOptions): ZedPlannedWrite | ZedConfigError {
  const existing = readZedSettings(settingsPath);
  if (!existing.ok) return existing;

  const status = classifyZedMcpStatus(existing, settingsPath, expectedOptions ?? { mcpVersion: "0.0.0" });
  if (status.status === "invalid" || status.status === "error") {
    return { ok: false, message: status.message, reason: "invalid-schema" };
  }
  if (status.status === "missing") {
    return { ok: false, message: "OpenPets MCP is not installed in Zed settings.", reason: "invalid-schema" };
  }
  if (status.status === "conflict") {
    return { ok: false, message: "Cannot remove: Zed's openpets context server is not managed by OpenPets.", reason: "invalid-schema" };
  }

  const next = updateZedSettingsText(existing.content, ["context_servers", zedMcpServerName], undefined);
  if (typeof next !== "string") return next;
  return buildZedWritePlan(settingsPath, next, existing.content, existing.exists);
}

export function executeZedMcpWrite(plan: ZedPlannedWrite): void {
  const pathSafety = assertSafeConfigPath(plan.targetPath);
  if (!pathSafety.ok) throw new Error(pathSafety.message);

  const targetSafety = assertSafeExistingSettingsFile(plan.targetPath, true);
  if (!targetSafety.ok) throw new Error(targetSafety.message);
  const parsed = parseZedSettings(plan.content);
  if (!parsed.ok) throw new Error(parsed.message);

  const parent = dirname(plan.targetPath);
  if (targetSafety.exists && !plan.backupPath) throw new Error("Zed writes require a backup path for existing settings.");

  const parentSafety = assertSafeParentDirectory(parent);
  if (!parentSafety.ok) throw new Error(parentSafety.message);
  mkdirSync(parent, { recursive: true, mode: 0o700 });

  const lockPath = join(parent, ".openpets-zed.lock");
  if (!isSafeSiblingPath(parent, lockPath)) throw new Error("Zed write lock path is unsafe.");
  const withdrawalPath = targetSafety.exists
    ? uniquePath(join(parent, `.openpets-zed-withdraw-${process.pid}-${Date.now()}-${randomUUID()}.tmp`))
    : undefined;
  let lockFd: number | undefined;
  let lockToken: string | undefined;
  let lockOwnerTempPath: string | undefined;
  let lockOwnerTempHash: string | undefined;
  let tempCreated = false;
  let backupCreated = false;
  let claimCreated = false;
  let withdrawalCreated = false;
  let committed = false;
  let retainLock = false;
  try {
    assertZedHardLinkSupport(parent);
    const lock = acquireZedWriteLock(lockPath, parent, plan, withdrawalPath);
    lockFd = lock.fd;
    lockToken = lock.token;
    lockOwnerTempPath = lock.ownerTempPath;
    lockOwnerTempHash = lock.ownerTempHash;
    const supportPaths = [plan.backupPath, plan.claimPath, withdrawalPath, plan.tempPath].filter((path): path is string => typeof path === "string");
    for (const supportPath of supportPaths) {
      if (!isSafeSiblingPath(parent, supportPath)) throw new Error("Zed write support path is unsafe.");
      if (lstatSync(supportPath, { throwIfNoEntry: false })) throw new Error("Zed write support path already exists.");
    }

    const currentTarget = assertSafeExistingSettingsFile(plan.targetPath, true);
    if (!currentTarget.ok) throw new Error(currentTarget.message);
    const currentContent = currentTarget.exists ? readFileSync(plan.targetPath, "utf8") : "";
    if (currentTarget.exists !== plan.sourceExists || currentContent !== plan.sourceContent) throw new Error("Zed settings changed since this operation was previewed. Refresh the status and try again.");

    const fd = openSync(plan.tempPath, "wx", 0o600);
    tempCreated = true;
    try {
      writeFileSync(fd, plan.content, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    const finalTarget = assertSafeExistingSettingsFile(plan.targetPath, true);
    if (!finalTarget.ok) throw new Error(finalTarget.message);
    const finalContent = finalTarget.exists ? readFileSync(plan.targetPath, "utf8") : "";
    if (finalTarget.exists !== plan.sourceExists || finalContent !== plan.sourceContent) throw new Error("Zed settings changed during this operation. Refresh the status and try again.");

    if (finalTarget.exists) {
      if (!plan.backupPath || !plan.claimPath || !withdrawalPath) throw new Error("Zed writes require backup, claim, and withdrawal paths for existing settings.");
      try {
        // Keep the original inode recoverable while the visible target is
        // withdrawn. An exclusive hard link also preserves writes through an
        // already-open descriptor after publication.
        linkSync(plan.targetPath, plan.backupPath);
      } catch (error) {
        if (isAlreadyExistsError(error)) throw new Error("Zed settings changed during this operation. Refresh the status and try again.");
        throw error;
      }
      backupCreated = true;
      const backup = readZedRecoveryArtifact(plan.backupPath, parent);
      if (!backup.exists || backup.content !== plan.sourceContent) {
        throw new Error("Zed settings changed during this operation. Refresh the status and try again.");
      }
      const copiedTarget = assertSafeExistingSettingsFile(plan.targetPath, true);
      if (!copiedTarget.ok) throw new Error(copiedTarget.message);
      const copiedContent = copiedTarget.exists ? readFileSync(plan.targetPath, "utf8") : "";
      if (!copiedTarget.exists || copiedContent !== plan.sourceContent) throw new Error("Zed settings changed during this operation. Refresh the status and try again.");

      try {
        // Claim creation is no-clobber. The backup hard link keeps the source
        // inode recoverable even after the target directory entry is removed.
        linkSync(plan.targetPath, plan.claimPath);
      } catch (error) {
        if (isAlreadyExistsError(error)) throw new Error("Zed settings changed during this operation. Refresh the status and try again.");
        throw error;
      }
      claimCreated = true;
      const claim = readZedRecoveryArtifact(plan.claimPath, parent);
      if (!claim.exists || claim.content !== plan.sourceContent) {
        throw new Error("Zed settings changed during this operation. Refresh the status and try again.");
      }
      const claimStat = lstatSync(plan.claimPath);
      const targetStat = lstatSync(plan.targetPath);
      if (claimStat.dev !== targetStat.dev || claimStat.ino !== targetStat.ino) {
        throw new Error("Zed settings changed during this operation. Refresh the status and try again.");
      }
      try {
        renameSync(plan.targetPath, withdrawalPath);
      } catch (error) {
        if (isAlreadyExistsError(error)) throw new Error("Zed settings changed during this operation. Refresh the status and try again.");
        throw error;
      }
      withdrawalCreated = true;
      const withdrawnTarget = assertSafeExistingSettingsFile(plan.targetPath, true);
      if (!withdrawnTarget.ok) throw new Error(withdrawnTarget.message);
      if (withdrawnTarget.exists) throw new Error("Zed settings changed during this operation. Refresh the status and try again.");

      try {
        linkSync(plan.tempPath, plan.targetPath);
      } catch (error) {
        if (isAlreadyExistsError(error)) throw new Error("Zed settings changed during this operation. Refresh the status and try again.");
        throw error;
      }
      const publishedClaim = readZedRecoveryArtifact(plan.claimPath, parent);
      if (!publishedClaim.exists || publishedClaim.content !== plan.sourceContent) {
        throw new Error("Zed settings changed during this operation. Refresh the status and try again.");
      }
      const publishedBackup = readZedRecoveryArtifact(plan.backupPath, parent);
      if (!publishedBackup.exists || publishedBackup.content !== plan.sourceContent) {
        throw new Error("Zed settings changed during this operation. Refresh the status and try again.");
      }
      const publishedWithdrawal = readZedRecoveryArtifact(withdrawalPath, parent);
      if (!publishedWithdrawal.exists || publishedWithdrawal.content !== plan.sourceContent) {
        throw new Error("Zed settings changed during this operation. Refresh the status and try again.");
      }
      tempCreated = false;
      committed = true;
      try {
        removeZedRecoveryArtifact(plan.tempPath, parent, hashZedSettingsContent(plan.content), "Zed write recovery is ambiguous; the prepared settings changed.");
      } catch {
        retainLock = true;
      }
      try {
        removeZedRecoveryArtifact(plan.claimPath, parent, hashZedSettingsContent(plan.sourceContent), "Zed write recovery is ambiguous; the original claim changed.");
        claimCreated = false;
      } catch {
        retainLock = true;
      }
      try {
        removeZedRecoveryArtifact(withdrawalPath, parent, hashZedSettingsContent(plan.sourceContent), "Zed write recovery is ambiguous; the withdrawn settings changed.");
        withdrawalCreated = false;
      } catch {
        retainLock = true;
      }
    } else {
      // A missing target must not be replaced if another writer creates it first.
      try {
        linkSync(plan.tempPath, plan.targetPath);
      } catch (error) {
        if (isAlreadyExistsError(error)) throw new Error("Zed settings changed during this operation. Refresh the status and try again.");
        throw error;
      }
      committed = true;
      try {
        removeZedRecoveryArtifact(plan.tempPath, parent, hashZedSettingsContent(plan.content), "Zed write recovery is ambiguous; the prepared settings changed.");
      } catch {
        retainLock = true;
      }
      tempCreated = false;
    }
    try { chmodSync(plan.targetPath, 0o600); } catch { /* best effort */ }
    const committedTarget = assertSafeExistingSettingsFile(plan.targetPath, true);
    if (!committedTarget.ok) throw new Error(committedTarget.message);
    if (!committedTarget.exists || readFileSync(plan.targetPath, "utf8") !== plan.content) throw new Error("Zed settings changed during this operation. Refresh the status and try again.");
  } catch (error) {
    if (committed) retainLock = true;
    if (!committed && withdrawalCreated && plan.backupPath && plan.claimPath && withdrawalPath) {
      try {
        const restoredContent = restoreZedWithdrawalAfterFailedWrite(plan.targetPath, plan.tempPath, withdrawalPath, plan.content);
        if (restoredContent !== undefined) {
          withdrawalCreated = false;
          if (restoredContent === plan.sourceContent && cleanupZedRollbackArtifacts(plan.targetPath, plan.backupPath, plan.claimPath, plan.sourceContent)) {
            claimCreated = false;
            backupCreated = false;
          } else {
            retainLock = true;
          }
        } else {
          retainLock = true;
        }
      } catch {
        retainLock = true;
      }
    }
    if (!committed && claimCreated && !withdrawalCreated && plan.backupPath && plan.claimPath) {
      try {
        if (cleanupZedRollbackArtifacts(plan.targetPath, plan.backupPath, plan.claimPath, plan.sourceContent)) {
          claimCreated = false;
          backupCreated = false;
        } else {
          retainLock = true;
        }
      } catch {
        retainLock = true;
      }
    }
    if (!committed && backupCreated && plan.backupPath && !claimCreated) {
      try {
        const currentTarget = assertSafeExistingSettingsFile(plan.targetPath, true);
        if (!currentTarget.ok || !currentTarget.exists || readFileSync(plan.targetPath, "utf8") !== plan.sourceContent) {
          retainLock = true;
        } else {
          removeZedRecoveryArtifact(plan.backupPath, parent, hashZedSettingsContent(plan.sourceContent), "Zed write recovery is ambiguous; the original backup changed.");
          backupCreated = false;
        }
      } catch {
        retainLock = true;
      }
    }
    if (tempCreated) {
      try {
        removeZedRecoveryArtifact(plan.tempPath, parent, hashZedSettingsContent(plan.content), "Zed write recovery is ambiguous; the prepared settings changed.");
      } catch {
        retainLock = true;
      }
    }
    throw error;
  } finally {
    if (lockFd !== undefined) {
      try {
        closeSync(lockFd);
      } finally {
        if (lockToken && !retainLock) removeOwnedZedWriteLock(lockPath, lockToken);
        if (lockOwnerTempPath && lockOwnerTempHash) {
          try {
            removeZedRecoveryArtifact(lockOwnerTempPath, parent, lockOwnerTempHash, "Zed write lock owner artifact changed during cleanup.");
          } catch { /* best effort; preserve ambiguous artifacts */ }
        }
        if (lockToken) activeZedWriteLockTokens.delete(lockToken);
      }
    }
  }
}

function assertZedHardLinkSupport(parent: string): void {
  const stamp = `${process.pid}-${Date.now()}-${randomUUID()}`;
  const sourcePath = uniquePath(join(parent, `.openpets-zed-link-probe-${stamp}.tmp`));
  const linkPath = uniquePath(join(parent, `.openpets-zed-link-probe-${stamp}.link`));
  let sourceCreated = false;
  let linkCreated = false;
  let sourceFd: number | undefined;
  try {
    sourceFd = openSync(sourcePath, "wx", 0o600);
    sourceCreated = true;
    closeSync(sourceFd);
    sourceFd = undefined;
    linkSync(sourcePath, linkPath);
    linkCreated = true;
  } catch {
    throw new Error("Zed settings writes require filesystem hard-link support.");
  } finally {
    if (sourceFd !== undefined) {
      try { closeSync(sourceFd); } catch { /* best effort */ }
    }
    if (sourceCreated) {
      try { rmSync(sourcePath, { force: true }); } catch { /* best effort */ }
    }
    if (linkCreated) {
      try { rmSync(linkPath, { force: true }); } catch { /* best effort */ }
    }
  }
}

function acquireZedWriteLock(lockPath: string, parent: string, plan: ZedPlannedWrite, withdrawalPath?: string): { readonly fd: number; readonly token: string; readonly ownerTempPath: string; readonly ownerTempHash: string } {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomUUID();
    const ownerTempPath = uniquePath(join(parent, `.openpets-zed-lock-${process.pid}-${Date.now()}-${token}.tmp`));
    const record: ZedWriteLockRecord = {
      version: zedWriteLockVersion,
      token,
      pid: process.pid,
      lockTempPath: ownerTempPath,
      targetPath: plan.targetPath,
      ...(plan.backupPath ? { backupPath: plan.backupPath } : {}),
      ...(plan.claimPath ? { claimPath: plan.claimPath } : {}),
      ...(withdrawalPath ? { withdrawalPath } : {}),
      tempPath: plan.tempPath,
      sourceExists: plan.sourceExists,
      sourceHash: hashZedSettingsContent(plan.sourceContent),
      contentHash: hashZedSettingsContent(plan.content),
    };
    const recordContent = JSON.stringify(record);
    const ownerTempHash = hashZedSettingsContent(recordContent);

    const ownerFd = openSync(ownerTempPath, "wx", 0o600);
    try {
      writeFileSync(ownerFd, recordContent, "utf8");
      fsyncSync(ownerFd);
    } catch (error) {
      closeSync(ownerFd);
      try {
        removeZedRecoveryArtifact(ownerTempPath, parent, ownerTempHash, "Zed write lock owner artifact changed during cleanup.");
      } catch { /* preserve an ambiguous owner artifact */ }
      throw error;
    }
    closeSync(ownerFd);

    try {
      linkSync(ownerTempPath, lockPath);
    } catch (error) {
      try {
        removeZedRecoveryArtifact(ownerTempPath, parent, ownerTempHash, "Zed write lock owner artifact changed during cleanup.");
      } catch {
        throw error;
      }
      if (!isAlreadyExistsError(error)) throw error;
      if (attempt === 2) throw zedWriteInProgressError();
      recoverStaleZedWriteLock(lockPath, parent, plan.targetPath);
      continue;
    }

    removeZedRecoveryArtifact(ownerTempPath, parent, ownerTempHash, "Zed write lock owner artifact changed during acquisition.");
    try {
      const fd = openSync(lockPath, "r+");
      activeZedWriteLockTokens.add(token);
      return { fd, token, ownerTempPath, ownerTempHash };
    } catch (error) {
      removeOwnedZedWriteLock(lockPath, token);
      try {
        removeZedRecoveryArtifact(ownerTempPath, parent, ownerTempHash, "Zed write lock owner artifact changed during cleanup.");
      } catch { /* best effort; preserve ambiguous owner artifacts */ }
      throw error;
    }
  }

  throw zedWriteInProgressError();
}

function recoverStaleZedWriteLock(lockPath: string, parent: string, targetPath: string): void {
  const lockStat = lstatSync(lockPath, { throwIfNoEntry: false });
  if (!lockStat) return;
  if (lockStat.isSymbolicLink() || !lockStat.isFile()) throw new Error("Zed write lock path is not a regular file.");

  const record = readZedWriteLockRecord(lockPath);
  if (!record) {
    if (Date.now() - lockStat.mtimeMs < staleUnownedZedLockMs) throw zedWriteInProgressError();
  }

  // A retained lock from a completed write may be retried by this process,
  // but a live lock owned by another process must never be recovered.
  if (record && isZedWriteLockInUse(record)) {
    throw zedWriteInProgressError();
  }

  const claimPath = uniquePath(join(parent, `.openpets-zed-lock-recovery-${process.pid}-${Date.now()}-${randomUUID()}.tmp`));
  try {
    renameSync(lockPath, claimPath);
  } catch (error) {
    if (isMissingError(error)) return;
    throw error;
  }

  let claimOwned = true;
  try {
    const claimedArtifact = readZedRecoveryArtifact(claimPath, parent);
    const claimedRecord = readZedWriteLockRecord(claimPath);
    if ((record && (!claimedRecord || claimedRecord.token !== record.token)) || (!record && claimedRecord)) {
      restoreZedWriteLockClaim(claimPath, lockPath);
      claimOwned = false;
      return;
    }

    if (claimedRecord) {
      if (isZedWriteLockInUse(claimedRecord)) {
        restoreZedWriteLockClaim(claimPath, lockPath);
        claimOwned = false;
        throw zedWriteInProgressError();
      }
      validateZedWriteLockRecord(claimedRecord, lockPath, parent, targetPath);
      if (lstatSync(lockPath, { throwIfNoEntry: false })) {
        if (claimedArtifact.exists && claimedArtifact.content !== undefined) {
          removeZedRecoveryArtifact(claimPath, parent, hashZedSettingsContent(claimedArtifact.content), "Zed write lock claim changed during recovery.");
        }
        claimOwned = false;
        return;
      }
      const ownerTemp = readZedRecoveryArtifact(claimedRecord.lockTempPath, parent);
      recoverZedWriteArtifacts(claimedRecord, parent);
      if (ownerTemp.exists && ownerTemp.content !== undefined) {
        removeZedRecoveryArtifact(claimedRecord.lockTempPath, parent, hashZedSettingsContent(ownerTemp.content), "Zed write lock owner artifact changed during recovery.");
      }
    }

    if (claimedArtifact.exists && claimedArtifact.content !== undefined) {
      removeZedRecoveryArtifact(claimPath, parent, hashZedSettingsContent(claimedArtifact.content), "Zed write lock claim changed during recovery.");
    }
    claimOwned = false;
  } catch (error) {
    if (claimOwned) {
      try { restoreZedWriteLockClaim(claimPath, lockPath); } catch { /* preserve the claim for safe manual recovery */ }
    }
    throw error;
  }
}

function isZedWriteLockInUse(record: ZedWriteLockRecord): boolean {
  return isProcessAlive(record.pid) && (record.pid !== process.pid || activeZedWriteLockTokens.has(record.token));
}

function restoreZedWriteLockClaim(claimPath: string, lockPath: string): void {
  const parent = dirname(lockPath);
  const claim = readZedRecoveryArtifact(claimPath, parent);
  try {
    linkSync(claimPath, lockPath);
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }
  if (claim.exists && claim.content !== undefined) {
    removeZedRecoveryArtifact(claimPath, parent, hashZedSettingsContent(claim.content), "Zed write lock claim changed during recovery.");
  }
}

function readZedWriteLockRecord(lockPath: string): ZedWriteLockRecord | undefined {
  const stat = lstatSync(lockPath, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Zed write lock path is not a regular file.");
  if (stat.size > maxZedWriteLockBytes) throw new Error("Zed write lock metadata is too large.");

  const text = readFileSync(lockPath, "utf8");
  if (!text.trim()) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Zed write lock metadata is invalid.");
  }
  if (!isRecord(parsed)) throw new Error("Zed write lock metadata is invalid.");

  const backupPath = parsed.backupPath;
  const claimPath = parsed.claimPath;
  const withdrawalPath = parsed.withdrawalPath;
  if (
    parsed.version !== zedWriteLockVersion
    || typeof parsed.token !== "string" || parsed.token.length < 1 || parsed.token.length > 128
    || !Number.isSafeInteger(parsed.pid) || (parsed.pid as number) < 1
    || typeof parsed.lockTempPath !== "string"
    || typeof parsed.targetPath !== "string"
    || (backupPath !== undefined && typeof backupPath !== "string")
    || (claimPath !== undefined && typeof claimPath !== "string")
    || (withdrawalPath !== undefined && typeof withdrawalPath !== "string")
    || typeof parsed.tempPath !== "string"
    || typeof parsed.sourceExists !== "boolean"
    || !isZedContentHash(parsed.sourceHash)
    || !isZedContentHash(parsed.contentHash)
  ) {
    throw new Error("Zed write lock metadata is invalid.");
  }

  return {
    version: parsed.version as number,
    token: parsed.token as string,
    pid: parsed.pid as number,
    lockTempPath: parsed.lockTempPath as string,
    targetPath: parsed.targetPath as string,
    ...(backupPath === undefined ? {} : { backupPath }),
    ...(claimPath === undefined ? {} : { claimPath }),
    ...(withdrawalPath === undefined ? {} : { withdrawalPath }),
    tempPath: parsed.tempPath as string,
    sourceExists: parsed.sourceExists as boolean,
    sourceHash: parsed.sourceHash as string,
    contentHash: parsed.contentHash as string,
  };
}

function validateZedWriteLockRecord(record: ZedWriteLockRecord, lockPath: string, parent: string, targetPath: string): void {
  if (resolve(record.targetPath) !== resolve(targetPath) || !isSafeSiblingPath(parent, record.targetPath)) {
    throw new Error("Zed write lock metadata targets an unsafe settings path.");
  }
  if (!isSafeSiblingPath(parent, record.lockTempPath) || !parse(record.lockTempPath).base.startsWith(".openpets-zed-lock-")) {
    throw new Error("Zed write lock metadata targets an unsafe lock path.");
  }
  if (resolve(record.lockTempPath) === resolve(lockPath) || resolve(record.lockTempPath) === resolve(record.targetPath) || resolve(record.lockTempPath) === resolve(record.tempPath) || (record.backupPath !== undefined && resolve(record.lockTempPath) === resolve(record.backupPath)) || (record.claimPath !== undefined && resolve(record.lockTempPath) === resolve(record.claimPath)) || (record.withdrawalPath !== undefined && resolve(record.lockTempPath) === resolve(record.withdrawalPath))) {
    throw new Error("Zed write lock metadata targets an unsafe lock path.");
  }
  if (!isSafeSiblingPath(parent, record.tempPath) || !parse(record.tempPath).base.startsWith(".openpets-")) {
    throw new Error("Zed write lock metadata targets an unsafe temp path.");
  }
  if (resolve(record.tempPath) === resolve(lockPath) || resolve(record.tempPath) === resolve(record.targetPath) || (record.backupPath !== undefined && resolve(record.tempPath) === resolve(record.backupPath)) || (record.claimPath !== undefined && resolve(record.tempPath) === resolve(record.claimPath)) || (record.withdrawalPath !== undefined && resolve(record.tempPath) === resolve(record.withdrawalPath))) {
    throw new Error("Zed write lock metadata targets an unsafe temp path.");
  }
  if (record.claimPath !== undefined) {
    if (!record.sourceExists || record.backupPath === undefined) {
      throw new Error("Zed write lock metadata has inconsistent claim state.");
    }
    const claimName = parse(record.claimPath).base;
    if (!isSafeSiblingPath(parent, record.claimPath) || !claimName.startsWith(".openpets-zed-claim-")) {
      throw new Error("Zed write lock metadata targets an unsafe claim path.");
    }
    if (resolve(record.claimPath) === resolve(lockPath) || resolve(record.claimPath) === resolve(record.targetPath) || resolve(record.claimPath) === resolve(record.tempPath) || (record.backupPath !== undefined && resolve(record.claimPath) === resolve(record.backupPath)) || (record.withdrawalPath !== undefined && resolve(record.claimPath) === resolve(record.withdrawalPath))) {
      throw new Error("Zed write lock metadata targets an unsafe claim path.");
    }
  }
  if (record.withdrawalPath !== undefined) {
    if (!record.sourceExists) throw new Error("Zed write lock metadata has inconsistent withdrawal state.");
    const withdrawalName = parse(record.withdrawalPath).base;
    if (!isSafeSiblingPath(parent, record.withdrawalPath) || !withdrawalName.startsWith(".openpets-zed-withdraw-")) {
      throw new Error("Zed write lock metadata targets an unsafe withdrawal path.");
    }
    if (resolve(record.withdrawalPath) === resolve(lockPath) || resolve(record.withdrawalPath) === resolve(record.targetPath) || resolve(record.withdrawalPath) === resolve(record.tempPath) || (record.backupPath !== undefined && resolve(record.withdrawalPath) === resolve(record.backupPath))) {
      throw new Error("Zed write lock metadata targets an unsafe withdrawal path.");
    }
  }
  if (record.sourceExists !== (record.backupPath !== undefined)) {
    throw new Error("Zed write lock metadata has inconsistent backup state.");
  }
  if (record.backupPath !== undefined) {
    const backupName = parse(record.backupPath).base;
    const targetName = parse(record.targetPath).base;
    if (!isSafeSiblingPath(parent, record.backupPath) || !backupName.startsWith(`${targetName}.openpets-backup-`)) {
      throw new Error("Zed write lock metadata targets an unsafe backup path.");
    }
    if (resolve(record.backupPath) === resolve(lockPath) || resolve(record.backupPath) === resolve(record.targetPath) || resolve(record.backupPath) === resolve(record.tempPath) || (record.withdrawalPath !== undefined && resolve(record.backupPath) === resolve(record.withdrawalPath))) {
      throw new Error("Zed write lock metadata targets an unsafe backup path.");
    }
  }
}

function recoverZedWriteArtifacts(record: ZedWriteLockRecord, parent: string): void {
  const targetSafety = assertSafeExistingSettingsFile(record.targetPath, true);
  if (!targetSafety.ok) throw new Error(targetSafety.message);
  const targetContent = targetSafety.exists ? readFileSync(record.targetPath, "utf8") : undefined;
  const temp = readZedRecoveryArtifact(record.tempPath, parent);
  const backup = record.backupPath ? readZedRecoveryArtifact(record.backupPath, parent) : undefined;
  const claim = record.claimPath ? readZedRecoveryArtifact(record.claimPath, parent) : undefined;
  const withdrawal = record.withdrawalPath ? readZedRecoveryArtifact(record.withdrawalPath, parent) : undefined;
  const targetHash = targetContent === undefined ? undefined : hashZedSettingsContent(targetContent);
  const backupHash = backup?.content === undefined ? undefined : hashZedSettingsContent(backup.content);
  const targetMatchesSource = targetSafety.exists === record.sourceExists && (!targetSafety.exists || targetHash === record.sourceHash);
  const targetMatchesContent = targetSafety.exists && targetHash === record.contentHash;

  if (targetMatchesContent) {
    if (record.sourceExists && (!backup?.exists || backupHash !== record.sourceHash)) {
      throw new Error("Zed write recovery is ambiguous; the original backup is missing or changed.");
    }
    removeZedRecoveryTemp(record, temp);
    removeZedRecoveryClaim(record, claim);
    removeZedRecoveryWithdrawal(record, withdrawal);
    return;
  }

  if (record.sourceExists && !targetSafety.exists && backup?.exists && backupHash === record.sourceHash) {
    restoreZedOriginalFromJournal(record, parent, backup.content!);
    removeZedRecoveryTemp(record, temp);
    removeZedRecoveryClaim(record, claim);
    removeZedRecoveryWithdrawal(record, withdrawal);
    removeZedRecoveryArtifact(record.backupPath!, parent, record.sourceHash, "Zed write recovery is ambiguous; the original backup changed.");
    return;
  }

  if (targetMatchesSource) {
    if (record.sourceExists && backup?.exists && backupHash !== record.sourceHash) {
      throw new Error("Zed write recovery is ambiguous; the original backup is missing or changed.");
    }
    removeZedRecoveryTemp(record, temp);
    removeZedRecoveryClaim(record, claim);
    removeZedRecoveryWithdrawal(record, withdrawal);
    if (backup?.exists) removeZedRecoveryArtifact(record.backupPath!, parent, record.sourceHash, "Zed write recovery is ambiguous; the original backup changed.");
    return;
  }

  if (!record.sourceExists && !targetSafety.exists) {
    removeZedRecoveryTemp(record, temp);
    return;
  }

  throw new Error("Zed write recovery is ambiguous; settings changed while the previous write was interrupted.");
}

function removeZedRecoveryTemp(record: ZedWriteLockRecord, temp: { readonly exists: boolean; readonly content?: string }): void {
  if (!temp.exists) return;
  if (temp.content === undefined || hashZedSettingsContent(temp.content) !== record.contentHash) {
    throw new Error("Zed write recovery is ambiguous; the prepared settings changed.");
  }
  removeZedRecoveryArtifact(record.tempPath, dirname(record.targetPath), record.contentHash, "Zed write recovery is ambiguous; the prepared settings changed.");
}

function removeZedRecoveryClaim(record: ZedWriteLockRecord, claim: { readonly exists: boolean; readonly content?: string } | undefined): void {
  if (!record.claimPath || !claim?.exists) return;
  if (claim.content === undefined || hashZedSettingsContent(claim.content) !== record.sourceHash) {
    throw new Error("Zed write recovery is ambiguous; the original claim changed.");
  }
  removeZedRecoveryArtifact(record.claimPath, dirname(record.targetPath), record.sourceHash, "Zed write recovery is ambiguous; the original claim changed.");
}

function removeZedRecoveryWithdrawal(record: ZedWriteLockRecord, withdrawal: { readonly exists: boolean; readonly content?: string } | undefined): void {
  if (!record.withdrawalPath || !withdrawal?.exists) return;
  if (withdrawal.content === undefined || hashZedSettingsContent(withdrawal.content) !== record.sourceHash) {
    throw new Error("Zed write recovery is ambiguous; the withdrawn settings changed.");
  }
  removeZedRecoveryArtifact(record.withdrawalPath, dirname(record.targetPath), record.sourceHash, "Zed write recovery is ambiguous; the withdrawn settings changed.");
}

function readZedRecoveryArtifact(path: string, parent: string): { readonly exists: boolean; readonly content?: string } {
  if (!isSafeSiblingPath(parent, path)) throw new Error("Zed write recovery path is unsafe.");
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return { exists: false };
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Zed write recovery artifact is not a regular file.");
  if (stat.size > maxZedSettingsBytes) throw new Error("Zed write recovery artifact is too large.");
  return { exists: true, content: readFileSync(path, "utf8") };
}

function removeZedRecoveryArtifact(path: string, parent: string, expectedHash: string, ambiguousMessage: string): void {
  const artifact = readZedRecoveryArtifact(path, parent);
  if (!artifact.exists) return;
  if (artifact.content === undefined || hashZedSettingsContent(artifact.content) !== expectedHash) throw new Error(ambiguousMessage);

  const cleanupPath = uniquePath(join(parent, `.openpets-zed-cleanup-${process.pid}-${Date.now()}-${randomUUID()}.tmp`));
  try {
    renameSync(path, cleanupPath);
  } catch (error) {
    if (isMissingError(error)) return;
    throw error;
  }

  const moved = readZedRecoveryArtifact(cleanupPath, parent);
  if (!moved.exists || moved.content === undefined || hashZedSettingsContent(moved.content) !== expectedHash) {
    restoreZedCleanupArtifact(cleanupPath, path, parent);
    throw new Error(ambiguousMessage);
  }
  rmSync(cleanupPath, { force: true });
}

function restoreZedCleanupArtifact(cleanupPath: string, originalPath: string, parent: string): void {
  const original = readZedRecoveryArtifact(originalPath, parent);
  if (original.exists) return;
  try {
    linkSync(cleanupPath, originalPath);
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    return;
  }
  rmSync(cleanupPath, { force: true });
}

function restoreZedOriginalFromJournal(record: ZedWriteLockRecord, parent: string, content: string): void {
  const restorePath = uniquePath(join(parent, `.openpets-zed-recovery-${process.pid}-${randomUUID()}.tmp`));
  if (!isSafeSiblingPath(parent, restorePath)) throw new Error("Zed write recovery path is unsafe.");
  const fd = openSync(restorePath, "wx", 0o600);
  try {
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    try {
      linkSync(restorePath, record.targetPath);
    } catch (error) {
      if (isAlreadyExistsError(error)) throw new Error("Zed settings changed during recovery. Refresh the status and try again.");
      throw error;
    }
  } finally {
    rmSync(restorePath, { force: true });
  }
}

function restoreZedWithdrawalAfterFailedWrite(targetPath: string, preparedPath: string, withdrawalPath: string, preparedContent: string): string | undefined {
  const parent = dirname(targetPath);
  const withdrawal = readZedRecoveryArtifact(withdrawalPath, parent);
  if (!withdrawal.exists || withdrawal.content === undefined) return undefined;
  const target = assertSafeExistingSettingsFile(targetPath, true);
  if (!target.ok) throw new Error(target.message);
  if (target.exists) {
    if (readFileSync(targetPath, "utf8") !== preparedContent) return undefined;
    const prepared = readZedRecoveryArtifact(preparedPath, parent);
    if (!prepared.exists || prepared.content !== preparedContent) return undefined;
    const targetStat = lstatSync(targetPath);
    const preparedStat = lstatSync(preparedPath);
    if (targetStat.dev !== preparedStat.dev || targetStat.ino !== preparedStat.ino) return undefined;
    removeZedRecoveryArtifact(targetPath, parent, hashZedSettingsContent(preparedContent), "Zed settings changed during recovery. Refresh the status and try again.");
  }
  try {
    linkSync(withdrawalPath, targetPath);
  } catch (error) {
    if (isAlreadyExistsError(error)) return undefined;
    throw error;
  }
  const restored = assertSafeExistingSettingsFile(targetPath, true);
  if (!restored.ok) throw new Error(restored.message);
  if (!restored.exists || readFileSync(targetPath, "utf8") !== withdrawal.content) {
    throw new Error("Zed settings changed during recovery. Refresh the status and try again.");
  }
  removeZedRecoveryArtifact(withdrawalPath, parent, hashZedSettingsContent(withdrawal.content), "Zed settings changed during recovery. Refresh the status and try again.");
  return withdrawal.content;
}

function cleanupZedRollbackArtifacts(targetPath: string, backupPath: string, claimPath: string, sourceContent: string): boolean {
  const parent = dirname(targetPath);
  const target = assertSafeExistingSettingsFile(targetPath, true);
  const backup = readZedRecoveryArtifact(backupPath, parent);
  const claim = readZedRecoveryArtifact(claimPath, parent);
  if (!target.ok || !target.exists || readFileSync(targetPath, "utf8") !== sourceContent || !backup.exists || backup.content !== sourceContent || !claim.exists || claim.content !== sourceContent) return false;
  removeZedRecoveryArtifact(claimPath, parent, hashZedSettingsContent(sourceContent), "Zed write recovery is ambiguous; the original claim changed.");
  removeZedRecoveryArtifact(backupPath, parent, hashZedSettingsContent(sourceContent), "Zed write recovery is ambiguous; the original backup changed.");
  return true;
}

function removeOwnedZedWriteLock(lockPath: string, token: string): void {
  try {
    const record = readZedWriteLockRecord(lockPath);
    if (record?.token !== token) return;
    const lock = readZedRecoveryArtifact(lockPath, dirname(lockPath));
    if (lock.exists && lock.content !== undefined) {
      removeZedRecoveryArtifact(lockPath, dirname(lockPath), hashZedSettingsContent(lock.content), "Zed write lock changed during cleanup.");
    }
  } catch {
    // Leave an unreadable lock for the next invocation to handle safely.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error !== null && typeof error === "object" && "code" in error && error.code === "EPERM";
  }
}

function zedWriteInProgressError(): Error {
  return new Error("EEXIST: Zed settings write is already in progress. Try again later.");
}

function hashZedSettingsContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isZedContentHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isAlreadyExistsError(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "EEXIST";
}

function isMissingError(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function missingStatus(settingsPath: string, expected: ZedMcpPreviewOptions, message: string): ZedMcpStatusResult {
  return {
    status: "missing",
    message,
    settingsPath,
    canInstall: true,
    canReplace: false,
    canRemove: false,
    previewEntry: buildZedMcpEntry(expected),
  };
}

function inspectZedMcpEntry(value: unknown): "managed" | "disabled" | "conflict" | "invalid" {
  if (!isRecord(value)) return "invalid";
  const commandLooksManaged = looksLikeOpenPetsCommand(value.command, value.args);
  if (!isValidZedEntryShape(value)) return commandLooksManaged ? "invalid" : "conflict";
  if (!commandLooksManaged) return "conflict";
  return value.enabled === false ? "disabled" : "managed";
}

function isValidZedEntryShape(value: Record<string, unknown>): boolean {
  const allowedKeys = new Set(["command", "args", "enabled", "remote", "env", "timeout"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  if (typeof value.command !== "string" || !Array.isArray(value.args) || !value.args.every((arg) => typeof arg === "string")) return false;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") return false;
  if (value.remote !== undefined && typeof value.remote !== "boolean") return false;
  if (value.env !== undefined && (!isRecord(value.env) || !Object.values(value.env).every((entry) => typeof entry === "string"))) return false;
  if (value.timeout !== undefined && (typeof value.timeout !== "number" || !Number.isSafeInteger(value.timeout) || value.timeout < 0)) return false;
  return true;
}

function looksLikeOpenPetsCommand(command: unknown, args: unknown): boolean {
  if (typeof command !== "string" || !Array.isArray(args) || !args.every((arg) => typeof arg === "string")) return false;
  const parts = args as readonly string[];
  if (command === "npx") return isPublishedOpenPetsArgs(parts);
  return isNodeCommand(command) && isLocalOpenPetsArgs(parts);
}

function isPublishedOpenPetsArgs(args: readonly string[]): boolean {
  if (args.length < 2 || args[0] !== "-y") return false;
  const packageArg = args[1] ?? "";
  if (!packageArg.startsWith("@open-pets/mcp@") || !isValidOpenPetsPackageVersion(packageArg.slice("@open-pets/mcp@".length))) return false;
  return hasValidPetArgs(args.slice(2));
}

function isLocalOpenPetsArgs(args: readonly string[]): boolean {
  if (args.length < 1) return false;
  const scriptPath = args[0] ?? "";
  return isValidOpenPetsMcpScriptPath(scriptPath) && hasValidPetArgs(args.slice(1));
}

function isNodeCommand(command: string): boolean {
  return isValidZedNodeCommand(command);
}

function hasValidPetArgs(args: readonly string[]): boolean {
  if (args.length === 0) return true;
  return args.length === 2 && args[0] === "--pet" && isValidPetId(args[1] ?? "");
}

function isSameZedMcpEntry(value: unknown, expected: ZedMcpEntry): boolean {
  if (!isRecord(value) || value.command !== expected.command || !Array.isArray(value.args)) return false;
  return value.args.length === expected.args.length && value.args.every((part: unknown, index: number) => part === expected.args[index]);
}

function getOpenPetsEntry(config: Record<string, unknown>): unknown {
  return isRecord(config.context_servers) ? config.context_servers[zedMcpServerName] : undefined;
}

function preserveManagedFields(existing: unknown, options: ZedMcpPreviewOptions, reenable = false): ZedMcpEntry {
  const base = buildZedMcpEntry(options);
  if (!isRecord(existing)) return base;

  return {
    ...base,
    ...(existing.enabled === true && !reenable ? { enabled: true } : {}),
    ...(isRecord(existing.env) && Object.values(existing.env).every((entry) => typeof entry === "string") ? { env: existing.env as Record<string, string> } : {}),
    ...(typeof existing.timeout === "number" && Number.isSafeInteger(existing.timeout) && existing.timeout >= 0 ? { timeout: existing.timeout } : {}),
    ...(reenable ? { enabled: true } : {}),
  };
}

function planZedSettingsWrite(settingsPath: string, source: string, sourceExists: boolean, entry: ZedMcpEntry): ZedPlannedWrite | ZedConfigError {
  const next = updateZedSettingsText(source, ["context_servers", zedMcpServerName], entry);
  if (typeof next !== "string") return next;
  return buildZedWritePlan(settingsPath, next, source, sourceExists);
}

function buildZedWritePlan(settingsPath: string, content: string, sourceContent = "", sourceExists = false): ZedPlannedWrite | ZedConfigError {
  const pathSafety = assertSafeConfigPath(settingsPath);
  if (!pathSafety.ok) return pathSafety;
  const targetSafety = assertSafeExistingSettingsFile(settingsPath, true);
  if (!targetSafety.ok) return targetSafety;

  const parent = dirname(settingsPath);
  const stamp = `${process.pid}-${Date.now()}-${randomUUID()}`;
  return {
    targetPath: settingsPath,
    backupPath: targetSafety.exists ? uniquePath(`${settingsPath}.openpets-backup-${stamp}.jsonc`) : undefined,
    claimPath: targetSafety.exists ? uniquePath(join(parent, `.openpets-zed-claim-${stamp}.tmp`)) : undefined,
    tempPath: uniquePath(join(parent, `.openpets-${stamp}.tmp`)),
    sourceExists,
    sourceContent,
    content,
  };
}

function assertSafeConfigPath(settingsPath: string): ZedConfigError | { readonly ok: true } {
  if (!isAbsolute(settingsPath) || settingsPath.includes("\0")) {
    return { ok: false, message: "Zed settings path must be an absolute safe path.", reason: "unsafe-path" };
  }
  if (hasParentTraversal(settingsPath)) {
    return { ok: false, message: "Zed settings path must not contain parent traversal segments.", reason: "unsafe-path" };
  }
  return assertSafeParentDirectory(dirname(settingsPath));
}

function assertSafeExistingSettingsFile(settingsPath: string, allowMissing: boolean): ZedConfigError | { readonly ok: true; readonly exists: boolean } {
  const stat = lstatSync(settingsPath, { throwIfNoEntry: false });
  if (!stat) {
    return allowMissing ? { ok: true, exists: false } : { ok: false, message: "Zed settings file does not exist.", reason: "io" };
  }
  if (stat.isSymbolicLink()) return { ok: false, message: "Zed settings file is a symlink.", reason: "symlink" };
  if (!stat.isFile()) return { ok: false, message: "Zed settings path is not a regular file.", reason: "not-regular" };
  if (stat.size > maxZedSettingsBytes) return { ok: false, message: "Zed settings exceed 256 KiB.", reason: "size" };
  return { ok: true, exists: true };
}

function assertSafeParentDirectory(path: string): ZedConfigError | { readonly ok: true } {
  if (!isAbsolute(path) || path.includes("\0") || hasParentTraversal(path)) {
    return { ok: false, message: "Zed settings parent path is unsafe.", reason: "unsafe-path" };
  }

  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  const parts = absolutePath.slice(root.length).split(/[\\/]+/u).filter(Boolean);
  let current = root;

  for (const part of parts) {
    current = join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat) break;
    if (stat.isSymbolicLink()) return { ok: false, message: "Zed settings parent must not contain symlink segments.", reason: "symlink" };
    if (!stat.isDirectory()) return { ok: false, message: "Zed settings parent path segment must be a directory.", reason: "unsafe-path" };
  }

  return { ok: true };
}

function isSafeSiblingPath(parent: string, candidate: string): boolean {
  if (!isAbsolute(candidate) || candidate.includes("\0") || hasParentTraversal(candidate)) return false;
  return resolve(dirname(candidate)) === resolve(parent);
}

function hasParentTraversal(path: string): boolean {
  return path.split(/[\\/]+/u).includes("..");
}

function uniquePath(path: string): string {
  if (!lstatSync(path, { throwIfNoEntry: false })) return path;
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${path}.${index}`;
    if (!lstatSync(candidate, { throwIfNoEntry: false })) return candidate;
  }
  throw new Error("Unable to allocate unique Zed temp path.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
