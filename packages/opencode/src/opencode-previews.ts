import { isAbsolute, join } from "node:path";

import { allowedReactions, type OpenPetsReaction } from "@open-pets/client";

export const openCodeMcpServerName = "openpets";
export const openPetsCliPackageName = "@open-pets/cli";
export type OpenCodeCommandMode = "published" | "local" | "bundled";

export interface OpenCodeMcpEntry {
  readonly type: "local";
  readonly command: readonly string[];
  readonly enabled: true;
  readonly environment?: Record<string, string>;
}

export interface OpenCodePreviewOptions {
  readonly cliVersion: string;
  readonly petId?: string;
  readonly commandMode?: OpenCodeCommandMode;
  readonly cliEntryPath?: string;
  readonly environment?: Record<string, string>;
}

export function validateOpenPetsPetArg(value: string): string {
  const trimmed = value.trim();
  if (trimmed !== value || trimmed.length < 1) throw new Error("Invalid OpenPets pet id.");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(trimmed)) throw new Error("Invalid OpenPets pet id.");
  return trimmed;
}

export function buildOpenCodeMcpEntry(options: OpenCodePreviewOptions): OpenCodeMcpEntry {
  const petArgs = options.petId === undefined ? [] : ["--pet", validateOpenPetsPetArg(options.petId)];
  const mode = options.commandMode ?? "published";
  const environment = options.environment && Object.keys(options.environment).length > 0 ? { environment: options.environment } : {};
  if (mode === "local" || mode === "bundled") {
    if (!options.cliEntryPath || !isAbsolute(options.cliEntryPath)) throw new Error("OpenCode local MCP preview requires an absolute CLI entry path.");
    return { type: "local", command: ["node", options.cliEntryPath, "mcp", ...petArgs], enabled: true, ...environment };
  }
  return { type: "local", command: ["npx", "-y", `${openPetsCliPackageName}@${options.cliVersion}`, "mcp", ...petArgs], enabled: true, ...environment };
}

export function buildOpenCodeInstructionPath(scope: "project" | "global", configDir?: string): string {
  if (scope === "project") return ".opencode/openpets.md";
  if (!configDir) throw new Error("Global OpenCode instruction path requires config directory.");
  return join(configDir, "openpets.md");
}

export type OpenCodePluginSpecOptions = {
  readonly pet?: string;
  readonly excludeReactions?: readonly string[];
};

export type OpenCodePluginSpec = string | readonly [string, OpenCodePluginSpecOptions];

export interface BuildOpenCodePluginPreviewOptions {
  readonly petId?: string;
  readonly packageVersion?: string;
  readonly excludeReactions?: readonly string[];
}

export function sanitizeOpenCodeExcludedReactions(excludeReactions?: readonly unknown[]): readonly OpenPetsReaction[] {
  if (!excludeReactions) return [];
  const recognized = excludeReactions.filter((reaction): reaction is OpenPetsReaction => {
    return typeof reaction === "string" && allowedReactions.includes(reaction as OpenPetsReaction);
  });
  return [...new Set(recognized)];
}

export function buildOpenCodePluginPreview(options?: BuildOpenCodePluginPreviewOptions): OpenCodePluginSpec {
  const spec = options?.packageVersion ? `@open-pets/opencode@${options.packageVersion}` : "@open-pets/opencode";
  const hasPet = options?.petId !== undefined;
  const excludeReactions = sanitizeOpenCodeExcludedReactions(options?.excludeReactions);
  const hasExclusions = excludeReactions.length > 0;
  if (!hasPet && !hasExclusions) return spec;
  return [spec, {
    ...(hasPet ? { pet: validateOpenPetsPetArg(options!.petId!) } : {}),
    ...(hasExclusions ? { excludeReactions } : {}),
  }];
}

export function formatOpenCodeMcpConfig(options: OpenCodePreviewOptions): Record<string, unknown> {
  return { mcp: { [openCodeMcpServerName]: buildOpenCodeMcpEntry(options) } };
}
