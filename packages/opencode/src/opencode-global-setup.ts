import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { randomUUID } from "node:crypto";

import { parseOpenCodeConfig, readOpenCodeConfigFile, updateOpenCodeConfigText, type OpenCodeConfigPaths, type PlannedWrite } from "./opencode-config.js";
import { formatEscapesRootError, formatNotRegularFileConfigError, formatNotRegularFileInstructionError, formatSymlinkConfigError, formatSymlinkInstructionError, formatSymlinkParentError, formatUnsafeDirectoryError, formatUnsafeParentError, lstatIfExists, pathHasEntry } from "./opencode-path-safety.js";
import { buildOpenCodeInstructionPath, buildOpenCodeMcpEntry, buildOpenCodePluginPreview, validateOpenPetsPetArg, type OpenCodeCommandMode } from "./opencode-previews.js";
import { classifyOpenCodeInstructionsStatus, classifyOpenCodeMcpStatus, classifyOpenCodePluginStatus, isManagedOpenPetsMcpEntry, isManagedOpenPetsPluginEntry, isOpenPetsLikePluginEntry } from "./opencode-status.js";
import { createOpenPetsInstructionBlock } from "./opencode-project-setup.js";

export interface PrepareOpenCodeGlobalSetupOptions {
  readonly configDir: string;
  readonly petId?: string;
  readonly cliVersion: string;
  readonly pluginVersion?: string;
  readonly commandMode?: OpenCodeCommandMode;
  readonly cliEntryPath?: string;
  readonly excludeReactions?: readonly string[];
}

export interface PreparedOpenCodeGlobalSetup {
  readonly configDir: string;
  readonly petId?: string;
  readonly configPath: string;
  readonly instructionPath: string;
  readonly configWrite: PlannedWrite;
  readonly cleanupConfigWrites: readonly PlannedWrite[];
  readonly instructionWrite: GlobalPlannedTextWrite;
}

export interface GlobalPlannedTextWrite {
  readonly targetPath: string;
  readonly backupPath?: string;
  readonly tempPath: string;
  readonly content: string;
}

export interface OpenCodeGlobalState {
  readonly status: "not_installed" | "installed" | "custom" | "conflict" | "error";
  readonly message: string;
}

const maxInstructionBytes = 1024 * 1024;
const openPetsStart = "<!-- OPENPETS:START -->";
const openPetsEnd = "<!-- OPENPETS:END -->";

export function getExplicitGlobalOpenCodeConfigPaths(configDir: string): OpenCodeConfigPaths {
  assertSafeDirectoryRoot(configDir, true);
  return { candidates: [join(configDir, "config.json"), join(configDir, "opencode.json"), join(configDir, "opencode.jsonc")], defaultCreatePath: join(configDir, "opencode.jsonc") };
}

export function prepareOpenCodeGlobalSetup(options: PrepareOpenCodeGlobalSetupOptions): PreparedOpenCodeGlobalSetup {
  const petId = options.petId === undefined ? undefined : validateOpenPetsPetArg(options.petId);
  const paths = getExplicitGlobalOpenCodeConfigPaths(options.configDir);
  const existingConfigs = readExistingGlobalConfigs(options.configDir, paths.candidates);
  const configs = existingConfigs.map((entry) => entry.config);
  const instructionPath = buildOpenCodeInstructionPath("global", options.configDir);
  assertSafeGlobalPath(options.configDir, instructionPath, "OpenCode instruction");
  const instructionContent = lstatIfExists(instructionPath) ? readSafeInstructionFile(instructionPath) : "";
  const mcpStatus = classifyOpenCodeMcpStatus(configs, { cliVersion: options.cliVersion, petId, commandMode: options.commandMode, cliEntryPath: options.cliEntryPath });
  const instructionStatus = classifyOpenCodeInstructionsStatus(configs, "global", options.configDir, { [instructionPath]: instructionContent });
  const pluginStatus = classifyOpenCodePluginStatus(configs, petId, options.pluginVersion ?? options.cliVersion, options.excludeReactions);
  for (const status of [mcpStatus, instructionStatus, pluginStatus]) {
    if (status.status === "custom" || status.status === "conflict" || status.status === "error") throw new Error(`${status.message} Edit or remove the custom OpenPets OpenCode entry, then rerun setup.`);
  }
  const selectedPath = selectWriteTarget(options.configDir, paths.candidates, existingConfigs, paths.defaultCreatePath);
  const selectedStat = lstatIfExists(selectedPath);
  if (selectedStat?.isSymbolicLink()) throw new Error(formatSymlinkConfigError(selectedPath));
  if (selectedStat && !selectedStat.isFile()) throw new Error(formatNotRegularFileConfigError(selectedPath));
  const selectedText = selectedStat ? readFileSync(selectedPath, "utf8") : "{}\n";
  const parsed = parseOpenCodeConfig(selectedText);
  if (!parsed.ok) throw new Error(parsed.message);
  const nextConfig = buildNextGlobalConfig(parsed.value, petId, options);
  const nextText = updateOpenCodeConfigText(selectedText, [
    { path: ["mcp"], value: nextConfig.mcp },
    { path: ["instructions"], value: nextConfig.instructions },
    { path: ["plugin"], value: nextConfig.plugin },
  ]);
  if (typeof nextText !== "string") throw new Error(nextText.message);
  const configWrite = planGlobalConfigWrite(options.configDir, selectedPath, nextText);
  const cleanupConfigWrites = planSetupCleanupWrites(options.configDir, selectedPath, existingConfigs);
  const instructionWrite = planTextWrite(options.configDir, instructionPath, upsertOpenPetsBlock(instructionContent));
  return { configDir: options.configDir, petId, configPath: selectedPath, instructionPath, configWrite, cleanupConfigWrites, instructionWrite };
}

export function writePreparedOpenCodeGlobalSetup(prepared: PreparedOpenCodeGlobalSetup): void {
  executeTextWrite(prepared.instructionWrite);
  for (const write of prepared.cleanupConfigWrites) executeGlobalConfigWrite(write);
  executeGlobalConfigWrite(prepared.configWrite);
}

export function prepareOpenCodeGlobalRemove(configDir: string): { readonly configWrites: readonly PlannedWrite[]; readonly instructionWrite?: GlobalPlannedTextWrite } {
  const paths = getExplicitGlobalOpenCodeConfigPaths(configDir);
  const existingConfigs = readExistingGlobalConfigs(configDir, paths.candidates);
  const state = classifyGlobalState(configDir, existingConfigs);
  if (state.status === "custom" || state.status === "conflict" || state.status === "error") throw new Error(state.message);
  const owners = existingConfigs.filter((entry) => hasManagedOpenPetsEntry(configDir, entry.config));
  if (owners.length === 0) return { configWrites: [] };
  if (owners.length > 1) throw new Error("OpenCode has OpenPets entries in multiple global config files. Remove duplicates manually.");
  const owner = owners[0];
  if (!owner) return { configWrites: [] };
  const text = readFileSync(owner.path, "utf8");
  const next = removeManagedConfig(configDir, owner.config);
  const nextText = updateOpenCodeConfigText(text, [
    { path: ["mcp"], value: next.mcp },
    { path: ["instructions"], value: next.instructions },
    { path: ["plugin"], value: next.plugin },
  ]);
  if (typeof nextText !== "string") throw new Error(nextText.message);
  const configWrite = planGlobalConfigWrite(configDir, owner.path, nextText);
  const instructionPath = buildOpenCodeInstructionPath("global", configDir);
  const instructionContent = lstatIfExists(instructionPath) ? readSafeInstructionFile(instructionPath) : "";
  const instructionWrite = hasManagedInstructionBlock(instructionContent) ? planTextWrite(configDir, instructionPath, removeOpenPetsBlock(instructionContent)) : undefined;
  return { configWrites: [configWrite], instructionWrite };
}

export function writePreparedOpenCodeGlobalRemove(prepared: { readonly configWrites: readonly PlannedWrite[]; readonly instructionWrite?: GlobalPlannedTextWrite }): void {
  for (const write of prepared.configWrites) executeGlobalConfigWrite(write);
  if (prepared.instructionWrite) executeTextWrite(prepared.instructionWrite);
}

export function doctorOpenCodeGlobalSetup(configDir: string): OpenCodeGlobalState {
  try {
    const paths = getExplicitGlobalOpenCodeConfigPaths(configDir);
    return classifyGlobalState(configDir, readExistingGlobalConfigs(configDir, paths.candidates));
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "OpenCode global setup status is unavailable." };
  }
}

function readExistingGlobalConfigs(configDir: string, candidates: readonly string[]): Array<{ readonly path: string; readonly config: Record<string, unknown> }> {
  return candidates.flatMap((path) => {
    if (!lstatIfExists(path)) return [];
    assertSafeGlobalPath(configDir, path, "OpenCode config");
    const parsed = readOpenCodeConfigFile(path);
    if (!parsed.ok) throw new Error(parsed.message);
    return [{ path, config: parsed.value }];
  });
}

function buildNextGlobalConfig(config: Record<string, unknown>, petId: string | undefined, options: PrepareOpenCodeGlobalSetupOptions): { readonly mcp: Record<string, unknown>; readonly instructions: readonly string[]; readonly plugin: readonly unknown[] } {
  const mcp = isRecord(config.mcp) ? { ...config.mcp } : {};
  mcp.openpets = buildOpenCodeMcpEntry({ cliVersion: options.cliVersion, petId, commandMode: options.commandMode, cliEntryPath: options.cliEntryPath });
  const instructionPath = buildOpenCodeInstructionPath("global", options.configDir);
  const instructions = [...new Set([...(Array.isArray(config.instructions) ? config.instructions.filter((entry): entry is string => typeof entry === "string") : []), instructionPath])];
  const plugin = [...(Array.isArray(config.plugin) ? config.plugin.filter((entry) => !isManagedOpenPetsPluginEntry(entry)) : []), buildOpenCodePluginPreview({ petId, packageVersion: options.pluginVersion ?? options.cliVersion, excludeReactions: options.excludeReactions })];
  return { mcp, instructions, plugin };
}

function removeManagedConfig(configDir: string, config: Record<string, unknown>): { readonly mcp?: Record<string, unknown>; readonly instructions?: readonly string[]; readonly plugin?: readonly unknown[] } {
  const mcp = isRecord(config.mcp) ? { ...config.mcp } : {};
  if (isManagedOpenPetsMcpEntry(mcp.openpets)) delete mcp.openpets;
  const instructionPath = buildOpenCodeInstructionPath("global", configDir);
  const instructions = Array.isArray(config.instructions) ? config.instructions.filter((entry) => typeof entry === "string" && entry !== instructionPath) : [];
  const plugin = Array.isArray(config.plugin) ? config.plugin.filter((entry) => !isManagedOpenPetsPluginEntry(entry)) : [];
  return { mcp: Object.keys(mcp).length > 0 ? mcp : undefined, instructions: instructions.length > 0 ? instructions : undefined, plugin: plugin.length > 0 ? plugin : undefined };
}

function selectWriteTarget(configDir: string, candidates: readonly string[], existing: readonly { readonly path: string; readonly config: Record<string, unknown> }[], fallback: string): string {
  const owners = existing.filter((entry) => hasManagedOpenPetsEntry(configDir, entry.config)).map((entry) => entry.path);
  const uniqueOwners = [...new Set(owners)];
  if (uniqueOwners.length > 1) throw new Error("OpenCode has OpenPets entries in multiple global config files. Remove duplicates manually.");
  const arrayOwner = selectArrayFieldOwner(configDir, candidates, existing);
  if (arrayOwner) return arrayOwner;
  if (uniqueOwners.length === 1) return uniqueOwners[0] ?? fallback;
  const highestPrecedenceExisting = [...candidates].reverse().find((candidate) => existing.some((entry) => entry.path === candidate));
  if (highestPrecedenceExisting) return highestPrecedenceExisting;
  return fallback;
}

function planSetupCleanupWrites(configDir: string, selectedPath: string, existing: readonly { readonly path: string; readonly config: Record<string, unknown> }[]): readonly PlannedWrite[] {
  return existing.flatMap((entry) => {
    if (entry.path === selectedPath || !hasManagedOpenPetsEntry(configDir, entry.config)) return [];
    const source = readFileSync(entry.path, "utf8");
    const next = removeManagedConfig(configDir, entry.config);
    const nextText = updateOpenCodeConfigText(source, [
      { path: ["mcp"], value: next.mcp },
      { path: ["instructions"], value: next.instructions },
      { path: ["plugin"], value: next.plugin },
    ]);
    if (typeof nextText !== "string") throw new Error(nextText.message);
    return [planGlobalConfigWrite(configDir, entry.path, nextText)];
  });
}

function selectArrayFieldOwner(configDir: string, candidates: readonly string[], existing: readonly { readonly path: string; readonly config: Record<string, unknown> }[]): string | undefined {
  const pluginOwner = findEffectiveArrayOwner(candidates, existing, "plugin", (entry) => !isManagedOpenPetsPluginEntry(entry), isManagedOpenPetsPluginEntry);
  const instructionPath = buildOpenCodeInstructionPath("global", configDir);
  const instructionOwner = findEffectiveArrayOwner(candidates, existing, "instructions", (entry) => typeof entry === "string" && entry !== instructionPath, (entry) => entry === instructionPath);
  const owners = [...new Set([pluginOwner, instructionOwner].filter((value): value is string => typeof value === "string"))];
  if (owners.length > 1) throw new Error("OpenCode global plugin and instruction arrays live in different config files. Consolidate them before installing OpenPets.");
  return owners[0];
}

function findEffectiveArrayOwner(candidates: readonly string[], existing: readonly { readonly path: string; readonly config: Record<string, unknown> }[], field: "plugin" | "instructions", isUserEntry: (entry: unknown) => boolean, isManagedEntry: (entry: unknown) => boolean): string | undefined {
  const entries = [...candidates].reverse().flatMap((candidate) => {
    const entry = existing.find((item) => item.path === candidate);
    const value = entry?.config[field];
    return entry && Array.isArray(value) ? [{ path: entry.path, values: value as readonly unknown[] }] : [];
  });
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (entry.values.some(isUserEntry)) return entry.path;
    const lowerUserOwner = entries.slice(index + 1).find((item) => item.values.some(isUserEntry))?.path;
    if (entry.values.some(isManagedEntry)) return lowerUserOwner ?? entry.path;
    if (lowerUserOwner) throw new Error(`OpenCode global ${field} array in a higher-precedence config shadows user ${field} entries in a lower-precedence config. Consolidate them before installing OpenPets.`);
    return entry.path;
  }
  return undefined;
}

function hasManagedOpenPetsEntry(configDir: string, config: Record<string, unknown>): boolean {
  if (isRecord(config.mcp) && isManagedOpenPetsMcpEntry(config.mcp.openpets)) return true;
  if (Array.isArray(config.instructions) && config.instructions.some((entry) => entry === buildOpenCodeInstructionPath("global", configDir))) return true;
  if (Array.isArray(config.plugin) && config.plugin.some(isManagedOpenPetsPluginEntry)) return true;
  return false;
}

function hasCustomOpenPetsEntry(configDir: string, config: Record<string, unknown>): boolean {
  if (isRecord(config.mcp) && config.mcp.openpets !== undefined && !isManagedOpenPetsMcpEntry(config.mcp.openpets)) return true;
  if (Array.isArray(config.instructions) && config.instructions.some((entry) => typeof entry === "string" && /openpets\.md$/i.test(entry) && entry !== buildOpenCodeInstructionPath("global", configDir))) return true;
  if (Array.isArray(config.plugin) && config.plugin.some((entry) => isOpenPetsLikePluginEntry(entry) && !isManagedOpenPetsPluginEntry(entry))) return true;
  return false;
}

function classifyGlobalState(configDir: string, existing: readonly { readonly path: string; readonly config: Record<string, unknown> }[]): OpenCodeGlobalState {
  if (existing.some((entry) => hasCustomOpenPetsEntry(configDir, entry.config))) return { status: "custom", message: "OpenCode has custom OpenPets-like global entries. Edit or remove them manually." };
  const owners = existing.filter((entry) => hasManagedOpenPetsEntry(configDir, entry.config));
  if (owners.length > 1) return { status: "conflict", message: "OpenCode has OpenPets entries in multiple global config files. Remove duplicates manually." };
  if (owners.length === 1) return { status: "installed", message: "OpenCode global OpenPets setup is installed." };
  return { status: "not_installed", message: "OpenCode global OpenPets setup is not installed." };
}

function planTextWrite(root: string, targetPath: string, content: string): GlobalPlannedTextWrite {
  assertSafeGlobalPath(root, targetPath, "OpenCode instruction");
  const stat = lstatIfExists(targetPath);
  if (stat) {
    if (stat.isSymbolicLink()) throw new Error(formatSymlinkInstructionError(targetPath));
    if (!stat.isFile()) throw new Error(formatNotRegularFileInstructionError(targetPath));
    if (stat.size > maxInstructionBytes) throw new Error(`OpenCode instruction ${targetPath} is too large and was not modified.`);
  }
  const stamp = `${process.pid}-${Date.now()}-${randomUUID()}`;
  return { targetPath, backupPath: stat ? `${targetPath}.openpets-backup-${stamp}.md` : undefined, tempPath: join(dirname(targetPath), `.openpets-${stamp}.tmp`), content };
}

function executeTextWrite(plan: GlobalPlannedTextWrite): void {
  const parent = dirname(plan.targetPath);
  const parentStat = lstatIfExists(parent);
  if (parentStat) {
    if (parentStat.isSymbolicLink()) throw new Error(formatSymlinkParentError("OpenCode instruction", parent));
    if (!parentStat.isDirectory()) throw new Error(formatUnsafeParentError("OpenCode instruction", parent));
  }
  const targetStat = lstatIfExists(plan.targetPath);
  if (targetStat) {
    if (targetStat.isSymbolicLink()) throw new Error(formatSymlinkInstructionError(plan.targetPath));
    if (!targetStat.isFile()) throw new Error(formatNotRegularFileInstructionError(plan.targetPath));
    if (targetStat.size > maxInstructionBytes) throw new Error(`OpenCode instruction ${plan.targetPath} is too large and was not modified.`);
  }
  if (plan.backupPath && dirname(plan.backupPath) !== parent) throw new Error("OpenCode instruction backup path is unsafe.");
  if (dirname(plan.tempPath) !== parent) throw new Error("OpenCode instruction temp path is unsafe.");
  if (pathHasEntry(plan.tempPath)) throw new Error("OpenCode instruction temp path is unsafe.");
  if (plan.backupPath && pathHasEntry(plan.backupPath)) throw new Error("OpenCode instruction backup path is unsafe.");
  mkdirSync(dirname(plan.targetPath), { recursive: true, mode: 0o700 });
  if (plan.backupPath && pathHasEntry(plan.targetPath)) {
    const backup = openSync(plan.backupPath, "wx", 0o600);
    try { writeFileSync(backup, readFileSync(plan.targetPath)); } finally { closeSync(backup); }
  }
  const fd = openSync(plan.tempPath, "wx", 0o600);
  try { writeFileSync(fd, plan.content, "utf8"); } finally { closeSync(fd); }
  renameSync(plan.tempPath, plan.targetPath);
  try { chmodSync(plan.targetPath, 0o600); } catch { /* best effort */ }
}

function planGlobalConfigWrite(rootPath: string, targetPath: string, content: string): PlannedWrite {
  assertSafeGlobalPath(rootPath, targetPath, "OpenCode config");
  const existing = lstatIfExists(targetPath);
  if (existing?.isSymbolicLink()) throw new Error(formatSymlinkConfigError(targetPath));
  if (existing && !existing.isFile()) throw new Error(formatNotRegularFileConfigError(targetPath));
  const parsed = parseOpenCodeConfig(content);
  if (!parsed.ok) throw new Error(parsed.message);
  const stamp = `${process.pid}-${Date.now()}-${randomUUID()}`;
  return { rootPath, targetPath, backupPath: existing ? `${targetPath}.openpets-backup-${stamp}.json` : undefined, tempPath: join(dirname(targetPath), `.openpets-${stamp}.tmp`), content };
}

function executeGlobalConfigWrite(plan: PlannedWrite): void {
  const parent = dirname(plan.targetPath);
  assertSafeGlobalPath(plan.rootPath, plan.targetPath, "OpenCode config");
  const targetStat = lstatIfExists(plan.targetPath);
  if (targetStat?.isSymbolicLink()) throw new Error(formatSymlinkConfigError(plan.targetPath));
  if (targetStat && !targetStat.isFile()) throw new Error(formatNotRegularFileConfigError(plan.targetPath));
  if (plan.backupPath && (dirname(plan.backupPath) !== parent || pathHasEntry(plan.backupPath))) throw new Error("OpenCode config backup path is unsafe.");
  if (dirname(plan.tempPath) !== parent || pathHasEntry(plan.tempPath)) throw new Error("OpenCode config temp path is unsafe.");
  const parsed = parseOpenCodeConfig(plan.content);
  if (!parsed.ok) throw new Error(parsed.message);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (plan.backupPath && pathHasEntry(plan.targetPath)) {
    const backup = openSync(plan.backupPath, "wx", 0o600);
    try { writeFileSync(backup, readFileSync(plan.targetPath)); } finally { closeSync(backup); }
  }
  const fd = openSync(plan.tempPath, "wx", 0o600);
  try { writeFileSync(fd, plan.content, "utf8"); } finally { closeSync(fd); }
  renameSync(plan.tempPath, plan.targetPath);
  try { chmodSync(plan.targetPath, 0o600); } catch { /* best effort */ }
}

function readSafeInstructionFile(path: string): string {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(formatSymlinkInstructionError(path));
  if (!stat.isFile()) throw new Error(formatNotRegularFileInstructionError(path));
  if (stat.size > maxInstructionBytes) throw new Error(`OpenCode instruction ${path} is too large and was not modified.`);
  return readFileSync(path, "utf8");
}

function upsertOpenPetsBlock(source: string): string {
  const withoutBlock = source.replace(new RegExp(`${escapeRegExp(openPetsStart)}[\\s\\S]*?${escapeRegExp(openPetsEnd)}\\n?`, "g"), "").replace(/\n{3,}/g, "\n\n").replace(/\s*$/u, "");
  const block = createOpenPetsInstructionBlock();
  return withoutBlock ? `${withoutBlock}\n\n${block}` : block;
}

function removeOpenPetsBlock(source: string): string {
  return source.replace(new RegExp(`${escapeRegExp(openPetsStart)}[\\s\\S]*?${escapeRegExp(openPetsEnd)}\\n?`, "g"), "").replace(/\n{3,}/g, "\n\n").replace(/\s*$/u, (match) => (match.includes("\n") ? "\n" : ""));
}

function hasManagedInstructionBlock(value: string): boolean {
  return new RegExp(`${escapeRegExp(openPetsStart)}[\\s\\S]*?${escapeRegExp(openPetsEnd)}`).test(value);
}

function assertSafeDirectoryRoot(root: string, allowMissing: boolean): void {
  if (!isAbsolute(root)) throw new Error(`OpenCode global config directory ${root} must be absolute and was not modified.`);
  const stat = lstatIfExists(root);
  if (!stat) {
    if (allowMissing) return;
    throw new Error(`OpenCode global config directory ${root} does not exist and was not modified.`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(formatUnsafeDirectoryError("OpenCode global config directory", root));
}

function assertSafeGlobalPath(root: string, targetPath: string, label: string): void {
  assertSafeNearestExistingRoot(root);
  const rel = relative(root, targetPath);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(formatEscapesRootError(label, targetPath, root));
  let current = root;
  for (const part of rel.split(/[\\/]+/).filter(Boolean).slice(0, -1)) {
    current = join(current, part);
    const stat = lstatIfExists(current);
    if (!stat) continue;
    if (stat.isSymbolicLink()) throw new Error(formatSymlinkParentError(label, current));
    if (!stat.isDirectory()) throw new Error(formatUnsafeParentError(label, current));
  }
}

function assertSafeNearestExistingRoot(root: string): void {
  if (!isAbsolute(root)) throw new Error(`OpenCode global config directory ${root} must be absolute and was not modified.`);
  let current = root;
  while (!pathHasEntry(current)) current = dirname(current);
  const stat = statSync(current);
  if (!stat.isDirectory()) throw new Error(formatUnsafeParentError("OpenCode global config parent", current));
  if (lstatSync(current).isSymbolicLink()) throw new Error(formatSymlinkParentError("OpenCode global config parent", current));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
