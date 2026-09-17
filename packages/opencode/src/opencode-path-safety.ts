import { lstatSync, readlinkSync, realpathSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export type OpenCodePathScope = "global" | "project";

const safetyRationale =
  "OpenPets only writes regular files inside the validated config root to preserve atomic-write and path-safety guarantees.";

const globalConfigRemediation =
  "Replace/materialize the symlink with a regular file (back up the target first) or use project-local OpenCode setup (`openpets configure --agent opencode --cwd <project-dir>`).";

const projectConfigRemediation =
  "Replace/materialize the symlink with a regular file (back up the target first) or choose a non-symlinked project/config location, then rerun project setup.";

const instructionRemediation =
  "Replace/materialize the symlink with a regular file (back up the target first) or rerun setup after removing the symlinked instruction file.";

const globalParentRemediation =
  "Replace/materialize the symlinked directory with a regular directory or choose a non-symlinked location. Project-local setup (`openpets configure --agent opencode --cwd <project-dir>`) avoids global dotfiles symlinks.";

const projectParentRemediation =
  "Replace/materialize the symlinked directory with a regular directory or choose a non-symlinked project location, then rerun project setup.";

function configRemediation(scope: OpenCodePathScope): string {
  return scope === "global" ? globalConfigRemediation : projectConfigRemediation;
}

function parentRemediation(scope: OpenCodePathScope): string {
  return scope === "global" ? globalParentRemediation : projectParentRemediation;
}

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

/**
 * Reject any symlink in the configured root or any existing ancestor up to
 * the filesystem root. Uses lstat semantics throughout: neither valid nor
 * dangling ancestor symlinks are resolved or accepted, so writes can never
 * traverse them. Diagnostic-only; nothing is modified or followed.
 */
export function assertNoSymlinkAncestors(root: string, label: string, scope: OpenCodePathScope): void {
  if (!isAbsolute(root)) throw new Error(`${label} directory ${root} must be absolute and was not modified. ${safetyRationale}`);
  for (const ancestor of orderedExistingAncestors(root)) {
    if (lstatIfExists(ancestor)?.isSymbolicLink()) throw new Error(formatSymlinkParentError(label, ancestor, scope));
  }
}

function orderedExistingAncestors(path: string): string[] {
  const chain: string[] = [];
  let current = path;
  for (;;) {
    chain.unshift(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return chain.filter((candidate) => pathHasEntry(candidate));
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

export function formatSymlinkConfigError(path: string, scope: OpenCodePathScope, label = "OpenCode config"): string {
  return `${label} ${path} is a symlink${targetSuffix(path)} and was not modified. ${safetyRationale} ${configRemediation(scope)}`;
}

export function formatNotRegularFileConfigError(path: string, scope: OpenCodePathScope, label = "OpenCode config"): string {
  return `${label} ${path} is not a regular file and was not modified. ${safetyRationale} ${configRemediation(scope)}`;
}

export function formatSymlinkInstructionError(path: string, scope: OpenCodePathScope): string {
  return `OpenCode instruction ${path} is a symlink${targetSuffix(path)} and was not modified. ${safetyRationale} ${instructionRemediation}`;
}

export function formatNotRegularFileInstructionError(path: string, scope: OpenCodePathScope): string {
  return `OpenCode instruction ${path} is not a regular file and was not modified. ${safetyRationale} ${instructionRemediation}`;
}

export function formatSymlinkParentError(label: string, path: string, scope: OpenCodePathScope): string {
  return `${label} parent ${path} is a symlink${targetSuffix(path)} and was not modified. ${safetyRationale} ${parentRemediation(scope)}`;
}

export function formatUnsafeParentError(label: string, path: string, scope: OpenCodePathScope): string {
  return `${label} parent ${path} is unsafe and was not modified. ${safetyRationale} ${parentRemediation(scope)}`;
}

export function formatUnsafeDirectoryError(label: string, path: string, scope: OpenCodePathScope): string {
  const target = getSymlinkTargetDisplay(path);
  if (target !== undefined) {
    return `${label} ${path} is a symlink to ${target} and was not modified. ${safetyRationale} ${parentRemediation(scope)}`;
  }
  return `${label} ${path} is unsafe and was not modified. ${safetyRationale} ${parentRemediation(scope)}`;
}

export function formatEscapesRootError(label: string, targetPath: string, rootPath: string): string {
  return `${label} path ${targetPath} escapes validated root ${rootPath} and was not modified. ${safetyRationale}`;
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}
