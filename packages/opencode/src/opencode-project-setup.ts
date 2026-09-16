import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { randomUUID } from "node:crypto";

import { executePlannedWrite, getProjectOpenCodeConfigPaths, parseOpenCodeConfig, planOpenCodeConfigWrite, readOpenCodeConfigFile, updateOpenCodeConfigText, type PlannedWrite } from "./opencode-config.js";
import { formatEscapesRootError, formatNotRegularFileConfigError, formatNotRegularFileInstructionError, formatSymlinkConfigError, formatSymlinkInstructionError, formatSymlinkParentError, formatUnsafeParentError, lstatIfExists, pathHasEntry } from "./opencode-path-safety.js";
import { buildOpenCodeInstructionPath, buildOpenCodeMcpEntry, buildOpenCodePluginPreview, validateOpenPetsPetArg, type OpenCodeCommandMode } from "./opencode-previews.js";
import { classifyOpenCodeInstructionsStatus, classifyOpenCodeMcpStatus, classifyOpenCodePluginStatus, isManagedOpenPetsMcpEntry, isManagedOpenPetsPluginEntry } from "./opencode-status.js";

export interface PrepareOpenCodeProjectSetupOptions {
  readonly projectDir: string;
  readonly petId: string;
  readonly cliVersion: string;
  readonly commandMode?: OpenCodeCommandMode;
  readonly cliEntryPath?: string;
  readonly excludeReactions?: readonly string[];
}

export interface PreparedOpenCodeProjectSetup {
  readonly projectDir: string;
  readonly petId: string;
  readonly configPath: string;
  readonly instructionPath: string;
  readonly configWrite: PlannedWrite;
  readonly instructionWrite: PlannedTextWrite;
}

export interface PlannedTextWrite {
  readonly targetPath: string;
  readonly backupPath?: string;
  readonly tempPath: string;
  readonly content: string;
}

const maxInstructionBytes = 1024 * 1024;
const openPetsStart = "<!-- OPENPETS:START -->";
const openPetsEnd = "<!-- OPENPETS:END -->";

export function prepareOpenCodeProjectSetup(options: PrepareOpenCodeProjectSetupOptions): PreparedOpenCodeProjectSetup {
  const petId = validateOpenPetsPetArg(options.petId);
  const paths = getProjectOpenCodeConfigPaths(options.projectDir);
  const existingConfigs = paths.candidates.flatMap((path) => {
    if (!lstatIfExists(path)) return [];
    assertSafeProjectLocalPath(options.projectDir, path, "OpenCode config");
    const parsed = readOpenCodeConfigFile(path, "project");
    if (!parsed.ok) throw new Error(parsed.message);
    return [{ path, config: parsed.value }];
  });
  const configs = existingConfigs.map((entry) => entry.config);
  const instructionRelPath = buildOpenCodeInstructionPath("project");
  const instructionPath = join(options.projectDir, instructionRelPath);
  assertSafeProjectLocalPath(options.projectDir, instructionPath, "OpenCode instruction");
  const instructionContent = lstatIfExists(instructionPath) ? readSafeInstructionFile(instructionPath) : "";
  const mcpStatus = classifyOpenCodeMcpStatus(configs, { cliVersion: options.cliVersion, petId, commandMode: options.commandMode, cliEntryPath: options.cliEntryPath });
  const instructionStatus = classifyOpenCodeInstructionsStatus(configs, "project", undefined, { [instructionRelPath]: instructionContent });
  const pluginStatus = classifyOpenCodePluginStatus(configs, petId, options.cliVersion, options.excludeReactions);
  for (const status of [mcpStatus, instructionStatus, pluginStatus]) {
    if (status.status === "custom" || status.status === "conflict" || status.status === "error") throw new Error(`${status.message} Edit or remove the custom OpenPets OpenCode entry, then rerun setup.`);
  }

  const selectedPath = selectWriteTarget(paths.candidates, existingConfigs, paths.defaultCreatePath);
  const selectedStat = lstatIfExists(selectedPath);
  if (selectedStat?.isSymbolicLink()) throw new Error(formatSymlinkConfigError(selectedPath, "project"));
  if (selectedStat && !selectedStat.isFile()) throw new Error(formatNotRegularFileConfigError(selectedPath, "project"));
  const selectedText = selectedStat ? readFileSync(selectedPath, "utf8") : "{}\n";
  const parsedSelected = parseOpenCodeConfig(selectedText);
  if (!parsedSelected.ok) throw new Error(parsedSelected.message);
  const nextConfig = buildNextConfig(parsedSelected.value, petId, options);
  const nextText = updateOpenCodeConfigText(selectedText, [
    { path: ["mcp"], value: nextConfig.mcp },
    { path: ["instructions"], value: nextConfig.instructions },
    { path: ["plugin"], value: nextConfig.plugin },
  ]);
  if (typeof nextText !== "string") throw new Error(nextText.message);
  const configWrite = planOpenCodeConfigWrite(options.projectDir, selectedPath, nextText);
  if ("ok" in configWrite) throw new Error(configWrite.message);
  const instructionWrite = planInstructionWrite(options.projectDir, instructionPath, upsertOpenPetsInstructionBlock(instructionContent));
  return { projectDir: options.projectDir, petId, configPath: selectedPath, instructionPath, configWrite, instructionWrite };
}

export function writePreparedOpenCodeProjectSetup(prepared: PreparedOpenCodeProjectSetup): void {
  executeTextWrite(prepared.instructionWrite);
  executePlannedWrite(prepared.configWrite);
}

export function createOpenPetsInstructionBlock(): string {
  return `${openPetsStart}\n## OpenPets\n\nOpenPets MCP tools may be available.\n\nUse OpenPets as a short visible status channel for meaningful coding progress:\n- Use \`openpets_say\` when starting, completing, blocking, or needing review on non-trivial work.\n- Keep messages brief, user-facing, and non-sensitive.\n- Do not include code, logs, secrets, URLs, or file paths.\n- Use \`openpets_react\` for small visual or emotional feedback.\n- Use \`openpets_status\` only when checking availability or the targeted pet.\n- Do not spam every internal step.\n${openPetsEnd}\n`;
}

function buildNextConfig(config: Record<string, unknown>, petId: string, options: PrepareOpenCodeProjectSetupOptions): { readonly mcp: Record<string, unknown>; readonly instructions: readonly string[]; readonly plugin: readonly unknown[] } {
  const mcp = isRecord(config.mcp) ? { ...config.mcp } : {};
  mcp.openpets = buildOpenCodeMcpEntry({ cliVersion: options.cliVersion, petId, commandMode: options.commandMode, cliEntryPath: options.cliEntryPath });
  const instructionPath = buildOpenCodeInstructionPath("project");
  const instructions = [...new Set([...(Array.isArray(config.instructions) ? config.instructions.filter((entry): entry is string => typeof entry === "string") : []), instructionPath])];
  const pluginSpec = buildOpenCodePluginPreview({ petId, packageVersion: options.cliVersion, excludeReactions: options.excludeReactions });
  const plugin = [...(Array.isArray(config.plugin) ? config.plugin.filter((entry) => !isManagedOpenPetsPluginEntry(entry)) : []), pluginSpec];
  return { mcp, instructions, plugin };
}

function selectWriteTarget(candidates: readonly string[], existing: readonly { readonly path: string; readonly config: Record<string, unknown> }[], fallback: string): string {
  const owners = existing.filter((entry) => hasManagedOpenPetsEntry(entry.config)).map((entry) => entry.path);
  const uniqueOwners = [...new Set(owners)];
  if (uniqueOwners.length > 1) throw new Error("OpenCode has OpenPets entries in multiple config files. Remove duplicates, then rerun setup.");
  if (uniqueOwners.length === 1) return uniqueOwners[0] ?? fallback;
  return candidates.find((candidate) => existing.some((entry) => entry.path === candidate)) ?? fallback;
}

function planInstructionWrite(projectDir: string, targetPath: string, content: string): PlannedTextWrite {
  assertSafeProjectLocalPath(projectDir, targetPath, "OpenCode instruction");
  const stat = lstatIfExists(targetPath);
  if (stat) {
    if (stat.isSymbolicLink()) throw new Error(formatSymlinkInstructionError(targetPath, "project"));
    if (!stat.isFile()) throw new Error(formatNotRegularFileInstructionError(targetPath, "project"));
    if (stat.size > maxInstructionBytes) throw new Error(`OpenCode instruction ${targetPath} is too large and was not modified.`);
  }
  const parent = dirname(targetPath);
  const parentStat = lstatIfExists(parent);
  if (parentStat) {
    if (parentStat.isSymbolicLink()) throw new Error(formatSymlinkParentError("OpenCode instruction", parent, "project"));
    if (!parentStat.isDirectory()) throw new Error(formatUnsafeParentError("OpenCode instruction", parent, "project"));
  }
  const stamp = `${process.pid}-${Date.now()}-${randomUUID()}`;
  return { targetPath, backupPath: stat ? `${targetPath}.openpets-backup-${stamp}.md` : undefined, tempPath: join(parent, `.openpets-${stamp}.tmp`), content };
}

function executeTextWrite(plan: PlannedTextWrite): void {
  const parent = dirname(plan.targetPath);
  const parentStat = lstatIfExists(parent);
  if (parentStat) {
    if (parentStat.isSymbolicLink()) throw new Error(formatSymlinkParentError("OpenCode instruction", parent, "project"));
    if (!parentStat.isDirectory()) throw new Error(formatUnsafeParentError("OpenCode instruction", parent, "project"));
  }
  const targetStat = lstatIfExists(plan.targetPath);
  if (targetStat) {
    if (targetStat.isSymbolicLink()) throw new Error(formatSymlinkInstructionError(plan.targetPath, "project"));
    if (!targetStat.isFile()) throw new Error(formatNotRegularFileInstructionError(plan.targetPath, "project"));
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

function readSafeInstructionFile(path: string): string {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(formatSymlinkInstructionError(path, "project"));
  if (!stat.isFile()) throw new Error(formatNotRegularFileInstructionError(path, "project"));
  if (stat.size > maxInstructionBytes) throw new Error(`OpenCode instruction ${path} is too large and was not modified.`);
  return readFileSync(path, "utf8");
}

function assertSafeProjectLocalPath(projectDir: string, targetPath: string, label: string): void {
  const rel = relative(projectDir, targetPath);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(formatEscapesRootError(label, targetPath, projectDir));
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  let current = projectDir;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = join(current, parts[index] ?? "");
    const stat = lstatIfExists(current);
    if (!stat) continue;
    if (stat.isSymbolicLink()) throw new Error(formatSymlinkParentError(label, current, "project"));
    if (!stat.isDirectory()) throw new Error(formatUnsafeParentError(label, current, "project"));
  }
}

function upsertOpenPetsInstructionBlock(source: string): string {
  const withoutBlock = source.replace(new RegExp(`${escapeRegExp(openPetsStart)}[\\s\\S]*?${escapeRegExp(openPetsEnd)}\\n?`, "g"), "").replace(/\n{3,}/g, "\n\n").replace(/\s*$/u, "");
  const block = createOpenPetsInstructionBlock();
  return withoutBlock ? `${withoutBlock}\n\n${block}` : block;
}

function hasManagedOpenPetsEntry(config: Record<string, unknown>): boolean {
  if (isRecord(config.mcp) && isManagedOpenPetsMcpEntry(config.mcp.openpets)) return true;
  if (Array.isArray(config.instructions) && config.instructions.some((entry) => entry === buildOpenCodeInstructionPath("project"))) return true;
  if (Array.isArray(config.plugin) && config.plugin.some(isManagedOpenPetsPluginEntry)) return true;
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
