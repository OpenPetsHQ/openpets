import { isAbsolute, join } from "node:path";
import { homedir } from "node:os";

export const zedMcpServerName = "openpets";
export const openPetsMcpPackageName = "@open-pets/mcp";
export type ZedCommandMode = "published" | "local" | "bundled";

export interface ZedMcpEntry {
  readonly command: string;
  readonly args: readonly string[];
  readonly enabled?: boolean;
  readonly remote?: boolean;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeout?: number;
}

export interface ZedMcpConfig {
  readonly context_servers?: {
    readonly openpets?: ZedMcpEntry | unknown;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

export interface ZedMcpPreviewOptions {
  readonly mcpVersion: string;
  readonly petId?: string;
  readonly commandMode?: ZedCommandMode;
  readonly mcpEntryPath?: string;
  readonly nodeCommand?: string;
}

export function validateOpenPetsPetId(value: string): string {
  const trimmed = value.trim();
  if (trimmed !== value || trimmed.length < 1) throw new Error("Invalid OpenPets pet id.");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(trimmed)) throw new Error("Invalid OpenPets pet id.");
  return trimmed;
}

export function isValidPetId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
}

export function validateOpenPetsPackageVersion(value: string): string {
  if (!isValidOpenPetsPackageVersion(value)) {
    throw new Error("Invalid OpenPets package version.");
  }
  return value;
}

export function isValidOpenPetsPackageVersion(value: string): boolean {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) return false;

  const prerelease = match[4];
  return prerelease === undefined || prerelease.split(".").every((identifier) => !/^0\d+$/u.test(identifier));
}

export function isValidZedNodeCommand(value: string): boolean {
  return value === "node" || (isAbsolute(value) && value.trim() === value && value.length <= 4096 && !/[\0\r\n]/u.test(value));
}

export function isValidOpenPetsMcpScriptPath(value: string): boolean {
  if (!isAbsolute(value) || value.length > 4096 || /[\0\r\n]/u.test(value) || hasParentTraversal(value)) return false;
  return /(?:^|[\\/])node_modules[\\/]@open-pets[\\/]mcp[\\/]dist[\\/]index\.js$/u.test(value)
    || /(?:^|[\\/])packages[\\/]mcp[\\/]dist[\\/]index\.js$/u.test(value);
}

export function buildZedMcpEntry(options: ZedMcpPreviewOptions): ZedMcpEntry {
  const petArgs = options.petId === undefined ? [] : ["--pet", validateOpenPetsPetId(options.petId)];
  const mode = options.commandMode ?? "published";

  if (mode === "local" || mode === "bundled") {
    if (!options.mcpEntryPath || !isValidOpenPetsMcpScriptPath(options.mcpEntryPath)) {
      throw new Error("Zed local MCP preview requires a safe absolute OpenPets MCP entry path.");
    }
    const nodeCommand = options.nodeCommand ?? "node";
    if (!isValidZedNodeCommand(nodeCommand)) {
      throw new Error("Invalid Zed Node.js command.");
    }
    return { command: nodeCommand, args: [options.mcpEntryPath, ...petArgs] };
  }

  validateOpenPetsPackageVersion(options.mcpVersion);
  return { command: "npx", args: ["-y", `${openPetsMcpPackageName}@${options.mcpVersion}`, ...petArgs] };
}

export function formatZedMcpConfig(options: ZedMcpPreviewOptions): ZedMcpConfig {
  return { context_servers: { [zedMcpServerName]: buildZedMcpEntry(options) } };
}

export function getZedGlobalSettingsDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir(),
  platform: NodeJS.Platform | string = process.platform,
): string {
  if (platform === "win32") {
    return join(env.APPDATA || join(homeDir, "AppData", "Roaming"), "Zed");
  }

  if (platform === "darwin") {
    return join(homeDir, ".config", "zed");
  }

  return join(env.FLATPAK_XDG_CONFIG_HOME || env.XDG_CONFIG_HOME || join(homeDir, ".config"), "zed");
}

export function getZedGlobalSettingsPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir(),
  platform: NodeJS.Platform | string = process.platform,
): string {
  return join(getZedGlobalSettingsDir(env, homeDir, platform), "settings.json");
}

function hasParentTraversal(path: string): boolean {
  return path.split(/[\\/]+/u).includes("..");
}
