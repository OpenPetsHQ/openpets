import { existsSync } from "node:fs";
import { join } from "node:path";

import type { OpenPetsCommandMode } from "@open-pets/claude";

export interface CommandPathProbeOptions {
  readonly homeDir: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform | string;
}

/**
 * Normalize the renderer-requested integration command mode.
 *
 * Packaged builds default to the bundled desktop CLI but must honor an
 * explicit "published" choice (Package CLI over npx). Dev builds keep the
 * historical behavior ("local" in dev, "published" otherwise). "local" is
 * never valid in a packaged build.
 */
export function resolveCommandMode(value: unknown, isPackaged: boolean): OpenPetsCommandMode {
  if (!isPackaged) {
    return value === "local" ? "local" : "published";
  }
  if (value === "published") {
    return "published";
  }
  return "bundled";
}

/**
 * Extra PATH entries so the Electron main process can resolve CLIs that are
 * normally only visible after shell profile evaluation. GUI apps launched
 * from Finder/Explorer never evaluate profiles (fnm/nvm shims, Homebrew),
 * so detection wrongly reports "not detected" even though the user's
 * terminal resolves the same command fine. Only directories that exist on
 * disk are returned.
 */
export function buildExtraCommandPaths(options: CommandPathProbeOptions): readonly string[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir;
  const candidates: (string | undefined)[] = [];
  if (platform !== "win32") {
    candidates.push(
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      join(homeDir, "bin"),
      join(homeDir, ".local", "bin"),
      join(homeDir, ".opencode", "bin"),
      join(env.VOLTA_HOME || join(homeDir, ".volta"), "bin"),
      join(env.BUN_INSTALL || join(homeDir, ".bun"), "bin"),
      join(env.MISE_DATA_DIR || join(homeDir, ".local", "share", "mise"), "shims"),
      join(env.ASDF_DATA_DIR || join(homeDir, ".asdf"), "shims"),
      env.PNPM_HOME,
      join(homeDir, ".local", "share", "pnpm"),
      join(homeDir, "Library", "pnpm"),
      join(env.NVM_DIR || join(homeDir, ".nvm"), "current", "bin"),
    );
  }
  candidates.push(...buildFnmCommandPaths(homeDir, env, platform));
  return filterExistingPaths(candidates);
}

/**
 * Stable fnm Node binary directories (fnm installs such as Claude Code run
 * from the default alias). The per-shell multishell path is deliberately
 * excluded: it is a transient directory that only exists for shells that
 * evaluated `fnm env`, so a GUI process must use the persistent
 * `aliases/default` link instead.
 */
function buildFnmCommandPaths(homeDir: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform | string): readonly (string | undefined)[] {
  const roots = [
    env.FNM_DIR,
    join(homeDir, ".local", "share", "fnm"),
    join(homeDir, ".fnm"),
  ];
  if (platform === "win32") {
    const windowsRoots = [
      ...roots,
      env.APPDATA ? join(env.APPDATA, "fnm") : undefined,
      join(homeDir, "AppData", "Roaming", "fnm"),
    ];
    return windowsRoots.map((root) => (root ? join(root, "aliases", "default") : undefined));
  }
  const macRoots = platform === "darwin" ? [join(homeDir, "Library", "Application Support", "fnm")] : [];
  return [...roots, ...macRoots].map((root) => (root ? join(root, "aliases", "default", "bin") : undefined));
}

function filterExistingPaths(paths: readonly (string | undefined)[]): readonly string[] {
  return paths.filter((path): path is string => Boolean(path && existsSync(path)));
}
