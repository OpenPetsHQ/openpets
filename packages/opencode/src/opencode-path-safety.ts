import { readlinkSync } from "node:fs";

const safetyRationale =
  "OpenPets only writes regular files inside the validated config root to preserve atomic-write and path-safety guarantees.";

const globalConfigRemediation =
  "Replace/materialize the symlink with a regular file (back up the target first) or use project-local OpenCode setup (`openpets configure --agent opencode --cwd <project-dir>`).";

const instructionRemediation =
  "Replace/materialize the symlink with a regular file (back up the target first) or rerun setup after removing the symlinked instruction file.";

const parentRemediation =
  "Replace/materialize the symlinked directory with a regular directory or choose a non-symlinked location. Project-local setup (`openpets configure --agent opencode --cwd <project-dir>`) avoids global dotfiles symlinks.";

export function tryReadSymlinkTarget(path: string): string | undefined {
  try {
    return readlinkSync(path);
  } catch {
    return undefined;
  }
}

function targetSuffix(path: string): string {
  const target = tryReadSymlinkTarget(path);
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
  const target = tryReadSymlinkTarget(path);
  if (target !== undefined) {
    return `${label} ${path} is a symlink to ${target} and was not modified. ${safetyRationale} ${parentRemediation}`;
  }
  return `${label} ${path} is unsafe and was not modified. ${safetyRationale} ${parentRemediation}`;
}

export function formatEscapesRootError(label: string, targetPath: string, rootPath: string): string {
  return `${label} path ${targetPath} escapes validated root ${rootPath} and was not modified. ${safetyRationale}`;
}
