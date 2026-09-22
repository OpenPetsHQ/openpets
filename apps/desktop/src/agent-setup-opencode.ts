import {
  doctorOpenCodeGlobalSetup,
  getGlobalOpenCodeConfigDir,
  parseOpenCodeConfig,
  prepareOpenCodeGlobalRemove,
  prepareOpenCodeGlobalSetup,
  writePreparedOpenCodeGlobalRemove,
  writePreparedOpenCodeGlobalSetup,
} from "@open-pets/opencode";
import type { OpenCodeCommandMode } from "@open-pets/opencode";

export interface OpenCodeSetupStatus {
  readonly state: "configured" | "needs_setup" | "not_detected" | "error";
  readonly label: string;
  readonly details: string;
  readonly configDir: string;
  readonly canInstall: boolean;
  readonly canRemove: boolean;
}

export interface OpenCodeSetupPreview {
  readonly global: true;
  readonly configDir: string;
  readonly configPath: string;
  readonly cleanupConfigPaths: readonly string[];
  readonly mcpCommand: readonly string[];
  readonly plugin: readonly unknown[] | string;
  readonly instructionPath: string;
  readonly configPreview: Record<string, unknown>;
}

export interface OpenCodeInstallDependencies {
  readonly configDir: string;
  readonly selectedPetId?: string;
  readonly cliVersion: string;
  readonly pluginVersion: string;
  readonly commandMode: OpenCodeCommandMode;
  readonly cliEntryPath?: string;
  readonly formatUserPath: (path: string | undefined) => string | undefined;
}

export interface OpenCodeSetupDependencies extends OpenCodeInstallDependencies {
  readonly detected: boolean;
  readonly preferredCommandIsDefault: boolean;
}

export interface OpenCodeRemoveDependencies {
  readonly configDir: string;
}

export interface OpenCodeSetupActionResult {
  readonly ok: boolean;
  readonly action: "opencode-install" | "opencode-remove";
  readonly message: string;
  readonly changed: boolean;
}

export function getOpenCodeConfigDir(env: NodeJS.ProcessEnv, homeDir: string, platform: NodeJS.Platform): string {
  return getGlobalOpenCodeConfigDir(env, homeDir, platform);
}

export function getOpenCodeSetup(dependencies: OpenCodeSetupDependencies): { readonly status: OpenCodeSetupStatus; readonly preview: OpenCodeSetupPreview } {
  const petId = dependencies.selectedPetId || undefined;
  const prepared = safePrepareOpenCode(dependencies);
  const globalState = doctorOpenCodeGlobalSetup(dependencies.configDir);
  const configured = globalState.status === "installed";

  return {
    status: {
      state: globalState.status === "error" || globalState.status === "custom" || globalState.status === "conflict"
        ? "error"
        : configured
          ? "configured"
          : dependencies.detected
            ? "needs_setup"
            : "not_detected",
      label: configured
        ? "Installed"
        : globalState.status === "custom" || globalState.status === "conflict"
          ? "Needs attention"
          : dependencies.detected
            ? "Ready"
            : "Not detected",
      details: globalState.status === "custom" || globalState.status === "conflict" || globalState.status === "error"
        ? globalState.message
        : configured
          ? globalState.message
          : dependencies.detected
            ? "OpenCode was detected. Desktop setup writes global OpenCode config."
            : dependencies.preferredCommandIsDefault
              ? "OpenCode was not found on PATH or in a Scoop shim directory. You can still preview setup, but OpenCode must be installed to use it."
              : "OpenCode did not run from the saved command path. You can still preview setup, but OpenCode must be installed to use it.",
      configDir: dependencies.formatUserPath(dependencies.configDir) ?? dependencies.configDir,
      canInstall: prepared.ok && !configured,
      canRemove: configured,
    },
    preview: {
      global: true,
      configDir: dependencies.formatUserPath(dependencies.configDir) ?? dependencies.configDir,
      configPath: prepared.ok
        ? dependencies.formatUserPath(prepared.configPath) ?? prepared.configPath
        : "",
      cleanupConfigPaths: prepared.ok ? prepared.cleanupConfigPaths.map((path) => dependencies.formatUserPath(path) ?? path) : [],
      mcpCommand: prepared.ok ? prepared.command : [],
      plugin: prepared.ok
        ? prepared.plugin
        : petId
          ? [`@open-pets/opencode@${dependencies.pluginVersion}`, { pet: petId }]
          : `@open-pets/opencode@${dependencies.pluginVersion}`,
      instructionPath: prepared.ok
        ? dependencies.formatUserPath(prepared.instructionPath) ?? prepared.instructionPath
        : "",
      configPreview: prepared.ok ? prepared.configPreview : {},
    },
  };
}

export function installOpenCodeGlobal(dependencies: OpenCodeInstallDependencies): OpenCodeSetupActionResult {
  try {
    const prepared = prepareOpenCodeGlobalSetup({
      configDir: dependencies.configDir,
      petId: dependencies.selectedPetId || undefined,
      cliVersion: dependencies.cliVersion,
      pluginVersion: dependencies.pluginVersion,
      commandMode: dependencies.commandMode,
      cliEntryPath: dependencies.cliEntryPath,
    });
    writePreparedOpenCodeGlobalSetup(prepared);
    return {
      ok: true,
      action: "opencode-install",
      message: `Installed global OpenCode OpenPets setup. Config: ${dependencies.formatUserPath(prepared.configPath) ?? prepared.configPath}. Instructions: ${dependencies.formatUserPath(prepared.instructionPath) ?? prepared.instructionPath}.`,
      changed: true,
    };
  } catch (error) {
    return { ok: false, action: "opencode-install", message: error instanceof Error ? error.message : "OpenCode setup failed.", changed: false };
  }
}

export function removeOpenCodeGlobal(dependencies: OpenCodeRemoveDependencies): OpenCodeSetupActionResult {
  try {
    const prepared = prepareOpenCodeGlobalRemove(dependencies.configDir);
    writePreparedOpenCodeGlobalRemove(prepared);
    return {
      ok: true,
      action: "opencode-remove",
      message: prepared.configWrites.length > 0 ? "Removed global OpenCode OpenPets setup." : "Global OpenCode OpenPets setup was already absent.",
      changed: prepared.configWrites.length > 0,
    };
  } catch (error) {
    return { ok: false, action: "opencode-remove", message: error instanceof Error ? error.message : "OpenCode removal failed.", changed: false };
  }
}

function safePrepareOpenCode(
  dependencies: OpenCodeSetupDependencies,
):
  | {
    readonly ok: true;
    readonly command: readonly string[];
    readonly configPath: string;
    readonly cleanupConfigPaths: readonly string[];
    readonly instructionPath: string;
    readonly plugin: readonly unknown[] | string;
    readonly configPreview: Record<string, unknown>;
  }
  | {
    readonly ok: false;
    readonly message: string;
  } {
  try {
    const prepared = prepareOpenCodeGlobalSetup({
      configDir: dependencies.configDir,
      petId: dependencies.selectedPetId || undefined,
      cliVersion: dependencies.cliVersion,
      pluginVersion: dependencies.pluginVersion,
      commandMode: dependencies.commandMode,
      cliEntryPath: dependencies.cliEntryPath,
    });
    const parsed = parseOpenCodeConfig(prepared.configWrite.content);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    const config = parsed.value as { mcp?: { openpets?: { command?: readonly string[] } }; plugin?: readonly unknown[] };
    const plugin = Array.isArray(config.plugin) ? config.plugin[config.plugin.length - 1] : undefined;
    return {
      ok: true,
      command: config.mcp?.openpets?.command ?? [],
      configPath: prepared.configPath,
      cleanupConfigPaths: prepared.cleanupConfigWrites.map((write) => write.targetPath),
      instructionPath: prepared.instructionPath,
      plugin: plugin === undefined ? [] : (plugin as readonly unknown[] | string),
      configPreview: parsed.value,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "OpenCode setup preview failed." };
  }
}
