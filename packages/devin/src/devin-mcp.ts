import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export const devinMcpServerName = "openpets";
export const openPetsMcpPackageName = "@open-pets/mcp";
export type DevinCommandMode = "published" | "local" | "bundled";

/**
 * A Devin stdio MCP server entry. Devin Desktop (formerly Windsurf) and the
 * Devin CLI share the same user-scope `mcp_config.json`, whose stdio schema is
 * `command`, `args`, `env`, and `disabled`. OpenPets writes only the fields it
 * owns.
 */
export interface DevinMcpEntry {
  readonly command: string;
  readonly args: readonly string[];
}

export interface DevinMcpPreviewOptions {
  readonly mcpVersion: string;
  readonly petId?: string;
  readonly commandMode?: DevinCommandMode;
  readonly mcpEntryPath?: string;
  readonly nodeCommand?: string;
}

const petIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidPetId(value: string): boolean {
  return petIdPattern.test(value);
}

export function validateOpenPetsPetId(value: string): string {
  if (!isValidPetId(value)) throw new Error("Invalid OpenPets pet id.");
  return value;
}

export function isValidOpenPetsPackageVersion(value: string): boolean {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) return false;

  const prerelease = match[4];
  if (prerelease === undefined) return true;
  return prerelease.split(".").every((identifier) => !/^0\d+$/u.test(identifier));
}

export function isValidDevinNodeCommand(value: string): boolean {
  if (value === "node") return true;
  return isAbsolute(value)
    && value.trim() === value
    && value.length <= 4096
    && !/[\0\r\n]/u.test(value);
}

export function isValidOpenPetsMcpScriptPath(value: string): boolean {
  if (!isAbsolute(value)) return false;
  if (value.length > 4096 || /[\0\r\n]/u.test(value)) return false;
  if (value.split(/[\\/]+/u).includes("..")) return false;
  return /(?:^|[\\/])node_modules[\\/]@open-pets[\\/]mcp[\\/]dist[\\/]index\.js$/u.test(value)
    || /(?:^|[\\/])packages[\\/]mcp[\\/]dist[\\/]index\.js$/u.test(value);
}

export function buildDevinMcpEntry(options: DevinMcpPreviewOptions): DevinMcpEntry {
  const petArgs = options.petId === undefined ? [] : ["--pet", validateOpenPetsPetId(options.petId)];
  const mode = options.commandMode ?? "published";

  if (mode === "local" || mode === "bundled") {
    if (!options.mcpEntryPath || !isValidOpenPetsMcpScriptPath(options.mcpEntryPath)) {
      throw new Error("Devin local MCP setup requires a safe absolute OpenPets MCP entry path.");
    }
    const nodeCommand = options.nodeCommand ?? "node";
    if (!isValidDevinNodeCommand(nodeCommand)) {
      throw new Error("Invalid Devin Node.js command.");
    }
    return { command: nodeCommand, args: [options.mcpEntryPath, ...petArgs] };
  }

  if (!isValidOpenPetsPackageVersion(options.mcpVersion)) {
    throw new Error("Invalid OpenPets package version.");
  }
  return { command: "npx", args: ["-y", `${openPetsMcpPackageName}@${options.mcpVersion}`, ...petArgs] };
}

/**
 * The Devin user configuration directory: `%APPDATA%\devin` on Windows and
 * `$XDG_CONFIG_HOME/devin` (default `~/.config/devin`) on macOS and Linux.
 */
export function getDevinConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir(),
  platform: NodeJS.Platform | string = process.platform,
): string {
  if (platform === "win32") {
    return join(env.APPDATA || join(homeDir, "AppData", "Roaming"), "devin");
  }

  const xdgConfigHome = env.XDG_CONFIG_HOME;
  if (xdgConfigHome && isAbsolute(xdgConfigHome)) {
    return join(xdgConfigHome, "devin");
  }
  return join(homeDir, ".config", "devin");
}

/** User-scope MCP config shared by Devin Desktop and the Devin CLI. */
export function getDevinGlobalMcpConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir(),
  platform: NodeJS.Platform | string = process.platform,
): string {
  return join(getDevinConfigDir(env, homeDir, platform), "mcp_config.json");
}
