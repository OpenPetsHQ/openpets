import {
  editDevinConfigText,
  isRecord,
  planDevinConfigWrite,
  readDevinConfigFile,
  type DevinConfigError,
  type DevinConfigReadResult,
  type DevinPlannedWrite,
} from "./devin-config-file.js";
import {
  buildDevinMcpEntry,
  devinMcpServerName,
  isValidDevinNodeCommand,
  isValidOpenPetsMcpScriptPath,
  isValidOpenPetsPackageVersion,
  isValidPetId,
  type DevinMcpEntry,
  type DevinMcpPreviewOptions,
} from "./devin-mcp.js";

export type DevinMcpStatus = "missing" | "installed" | "disabled" | "needs-update" | "conflict" | "invalid" | "error";

export interface DevinMcpStatusResult {
  readonly status: DevinMcpStatus;
  readonly message: string;
  readonly configPath: string;
  readonly canInstall: boolean;
  readonly canReplace: boolean;
  readonly canRemove: boolean;
  readonly previewEntry?: DevinMcpEntry;
}

const mcpConfigLabel = "Devin MCP config";

export function readDevinMcpConfig(configPath: string): DevinConfigReadResult | DevinConfigError {
  return readDevinConfigFile(configPath, mcpConfigLabel, validateMcpConfigShape);
}

export function classifyDevinMcpStatus(
  configResult: DevinConfigReadResult | DevinConfigError,
  configPath: string,
  expected: DevinMcpPreviewOptions,
): DevinMcpStatusResult {
  if (!configResult.ok) {
    return {
      status: configResult.reason === "io" ? "error" : "invalid",
      message: configResult.message,
      configPath,
      canInstall: false,
      canReplace: false,
      canRemove: false,
    };
  }

  const expectedEntry = buildDevinMcpEntry(expected);
  const mcpServers = isRecord(configResult.config.mcpServers) ? configResult.config.mcpServers : undefined;
  const existingEntry = mcpServers?.[devinMcpServerName];

  if (existingEntry === undefined) {
    return {
      status: "missing",
      message: configResult.exists ? "OpenPets MCP is not configured for Devin." : "Devin MCP config does not exist yet.",
      configPath,
      canInstall: true,
      canReplace: false,
      canRemove: false,
      previewEntry: expectedEntry,
    };
  }

  if (!isManagedOpenPetsMcpEntry(existingEntry)) {
    return {
      status: "conflict",
      message: "Devin MCP config has an openpets entry that OpenPets does not manage.",
      configPath,
      canInstall: false,
      canReplace: true,
      canRemove: false,
      previewEntry: expectedEntry,
    };
  }

  if (existingEntry.disabled === true) {
    return {
      status: "disabled",
      message: "OpenPets MCP is disabled in Devin. Replace it to re-enable OpenPets.",
      configPath,
      canInstall: false,
      canReplace: true,
      canRemove: true,
      previewEntry: expectedEntry,
    };
  }

  if (isSameCommand(existingEntry, expectedEntry)) {
    return {
      status: "installed",
      message: "OpenPets MCP is configured for Devin Desktop and Devin CLI.",
      configPath,
      canInstall: false,
      canReplace: false,
      canRemove: true,
      previewEntry: expectedEntry,
    };
  }

  return {
    status: "needs-update",
    message: "OpenPets MCP for Devin needs an update (version, pet, or command source differs).",
    configPath,
    canInstall: true,
    canReplace: true,
    canRemove: true,
    previewEntry: expectedEntry,
  };
}

/**
 * Recognizes entries OpenPets wrote: a pinned `npx -y @open-pets/mcp@VERSION`
 * command or a Node.js command running an OpenPets MCP entry script, each with
 * an optional `--pet <id>`.
 */
export function isManagedOpenPetsMcpEntry(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (typeof value.command !== "string") return false;
  if (!Array.isArray(value.args)) return false;
  if (!value.args.every((arg) => typeof arg === "string")) return false;

  const args = value.args as readonly string[];
  if (value.command === "npx") return isPublishedOpenPetsMcpArgs(args);
  if (isValidDevinNodeCommand(value.command)) return isNodeOpenPetsMcpArgs(args);
  return false;
}

export function planDevinMcpInstall(configPath: string, options: DevinMcpPreviewOptions): DevinPlannedWrite | DevinConfigError {
  const existing = readDevinMcpConfig(configPath);
  if (!existing.ok) return existing;

  const status = classifyDevinMcpStatus(existing, configPath, options);
  if (!status.canInstall) {
    return { ok: false, message: describeBlockedWrite(status, "install"), reason: "conflict" };
  }
  return planEntryWrite(configPath, existing, buildDevinMcpEntry(options));
}

export function planDevinMcpReplace(configPath: string, options: DevinMcpPreviewOptions): DevinPlannedWrite | DevinConfigError {
  const existing = readDevinMcpConfig(configPath);
  if (!existing.ok) return existing;

  const status = classifyDevinMcpStatus(existing, configPath, options);
  if (!status.canReplace) {
    return { ok: false, message: describeBlockedWrite(status, "replace"), reason: "conflict" };
  }
  return planEntryWrite(configPath, existing, buildDevinMcpEntry(options));
}

export function planDevinMcpRemove(configPath: string): DevinPlannedWrite | DevinConfigError {
  const existing = readDevinMcpConfig(configPath);
  if (!existing.ok) return existing;

  const mcpServers = isRecord(existing.config.mcpServers) ? existing.config.mcpServers : undefined;
  const existingEntry = mcpServers?.[devinMcpServerName];
  if (existingEntry === undefined) {
    return { ok: false, message: "OpenPets MCP is not configured for Devin.", reason: "conflict" };
  }
  if (!isManagedOpenPetsMcpEntry(existingEntry)) {
    return { ok: false, message: "Cannot remove: the Devin openpets entry is not managed by OpenPets.", reason: "conflict" };
  }

  const edited = editDevinConfigText(existing.content, ["mcpServers", devinMcpServerName], undefined, mcpConfigLabel, validateMcpConfigShape);
  if (typeof edited !== "string") return edited;
  return planDevinConfigWrite(configPath, existing, edited);
}

/**
 * Writes the OpenPets entry. An entry OpenPets already manages is updated in
 * place: only `command` and `args` change and `disabled` is cleared, so user
 * fields such as `env` survive. Any other entry is replaced as a whole.
 */
function planEntryWrite(
  configPath: string,
  existing: DevinConfigReadResult,
  entry: DevinMcpEntry,
): DevinPlannedWrite | DevinConfigError {
  const entryPath = ["mcpServers", devinMcpServerName];
  const mcpServers = isRecord(existing.config.mcpServers) ? existing.config.mcpServers : undefined;
  const updatesManagedEntry = isManagedOpenPetsMcpEntry(mcpServers?.[devinMcpServerName]);

  const edits: readonly (readonly [readonly string[], unknown])[] = updatesManagedEntry
    ? [
        [[...entryPath, "command"], entry.command],
        [[...entryPath, "args"], entry.args],
        [[...entryPath, "disabled"], undefined],
      ]
    : [[entryPath, entry]];

  let content = existing.content;
  for (const [path, value] of edits) {
    const edited = editDevinConfigText(content, path, value, mcpConfigLabel, validateMcpConfigShape);
    if (typeof edited !== "string") return edited;
    content = edited;
  }
  return planDevinConfigWrite(configPath, existing, content);
}

function validateMcpConfigShape(config: Record<string, unknown>): string | undefined {
  if (config.mcpServers !== undefined && !isRecord(config.mcpServers)) return "mcpServers must be an object.";
  return undefined;
}

function describeBlockedWrite(status: DevinMcpStatusResult, operation: "install" | "replace"): string {
  if (status.status === "installed") return "OpenPets MCP is already configured for Devin.";
  if (status.status === "missing") return "Cannot replace: OpenPets MCP is not configured for Devin. Install it instead.";
  if (status.status === "conflict" || status.status === "disabled") {
    return `${status.message} Use replace to overwrite the openpets entry.`;
  }
  return `Cannot ${operation} Devin MCP config: ${status.message}`;
}

function isPublishedOpenPetsMcpArgs(args: readonly string[]): boolean {
  if (args.length < 2) return false;
  if (args[0] !== "-y") return false;

  const match = /^@open-pets\/mcp@(.+)$/u.exec(args[1] ?? "");
  if (!match || !isValidOpenPetsPackageVersion(match[1] ?? "")) return false;
  return hasValidPetArgs(args.slice(2));
}

function isNodeOpenPetsMcpArgs(args: readonly string[]): boolean {
  if (args.length < 1) return false;
  if (!isValidOpenPetsMcpScriptPath(args[0] ?? "")) return false;
  return hasValidPetArgs(args.slice(1));
}

function hasValidPetArgs(args: readonly string[]): boolean {
  if (args.length === 0) return true;
  if (args.length !== 2) return false;
  return args[0] === "--pet" && isValidPetId(args[1] ?? "");
}

function isSameCommand(value: Record<string, unknown>, expected: DevinMcpEntry): boolean {
  if (value.command !== expected.command) return false;
  if (!Array.isArray(value.args)) return false;
  if (value.args.length !== expected.args.length) return false;
  return value.args.every((arg: unknown, index: number) => arg === expected.args[index]);
}
