import { lstatSync, readlinkSync, realpathSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

const safetyRationale =
  "OpenPets only writes regular files inside the validated config root to preserve atomic-write and path-safety guarantees.";

const globalConfigRemediation =
  "Replace/materialize the symlink with a regular file (back up the target first) or use project-local OpenCode setup (`openpets configure --agent opencode --cwd <project-dir>`).";

const instructionRemediation =
  "Replace/materialize the symlink with a regular file (back up the target first) or rerun setup after removing the symlinked instruction file.";

const parentRemediation =
  "Replace/materialize the symlinked directory with a regular directory or choose a non-symlinked location. Project-local setup (`openpets configure --agent opencode --cwd <project-dir>`) avoids global dotfiles symlinks.";

/**
 * lstat-based existence check. Returns the lstat result when a directory
 * entry exists (including dangling symlinks) and undefined only when the
 * path truly has no entry (ENOENT). Other errors propagate.
 */
export function lstatIfExists(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
}

/** True when any directory entry exists, including dangling symlinks. */
export function pathHasEntry(path: string): boolean {
  return lstatIfExists(path) !== undefined;
}

export function tryReadSymlinkTarget(path: string): string | undefined {
  return getSymlinkTargetDisplay(path);
}

/**
 * Diagnostic-only symlink target display. Prefers the fully resolved
 * absolute target for valid links; falls back to resolving the literal
 * link contents relative to the link directory for dangling links.
 * Never modifies or writes through targets.
 */
export function getSymlinkTargetDisplay(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    try {
      const raw = readlinkSync(path);
      if (!raw) return undefined;
      if (isAbsolute(raw)) return raw;
      return join(dirname(path), raw);
    } catch {
      return undefined;
    }
  }
}

function targetSuffix(path: string): string {
  const target = getSymlinkTargetDisplay(path);
  return target ? ` to ${target}` : "";
}

export function formatSymlinkConfigError(path: string, label = "OpenCode config"): string {
  return `${label} ${path} is a symlink${targetSuffix(path)} and was not modified. ${safetyRationale} ${globalConfigRemediation}`;
}

export function formatNotRegularFileConfigError(path: string, label = "OpenCode config"): string {
  return `${label} ${path} is not a regular file and was not modified. ${safetyRationale} ${globalConfigRemediation}`;
}

export function formatSymlinkInstructionError(path: string): string {
  return `OpenCode instruction ${path} is a symlink${targetSuffix(path)} and was not modified. ${safetyRationale} ${instructionRemediation}`;
}

export function formatNotRegularFileInstructionError(path: string): string {
  return `OpenCode instruction ${path} is not a regular file and was not modified. ${safetyRationale} ${instructionRemediation}`;
}

export function formatSymlinkParentError(label: string, path: string): string {
  return `${label} parent ${path} is a symlink${targetSuffix(path)} and was not modified. ${safetyRationale} ${parentRemediation}`;
}

export function formatUnsafeParentError(label: string, path: string): string {
  return `${label} parent ${path} is unsafe and was not modified. ${safetyRationale} ${parentRemediation}`;
}

export function formatUnsafeDirectoryError(label: string, path: string): string {
  const target = getSymlinkTargetDisplay(path);
  if (target !== undefined) {
    return `${label} ${path} is a symlink to ${target} and was not modified. ${safetyRationale} ${parentRemediation}`;
  }
  return `${label} ${path} is unsafe and was not modified. ${safetyRationale} ${parentRemediation}`;
}

export function formatEscapesRootError(label: string, targetPath: string, rootPath: string): string {
  return `${label} path ${targetPath} escapes validated root ${rootPath} and was not modified. ${safetyRationale}`;
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}
