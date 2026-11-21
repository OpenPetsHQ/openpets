import { constants, accessSync, closeSync, openSync, readSync, statSync } from "node:fs";
import { posix, win32 } from "node:path";
import type { ChildProcess } from "node:child_process";

export type AppLauncherPlatform = "win32" | "darwin" | "linux";

export interface AppLauncherTargetFileSystem {
  stat(targetPath: string): { readonly isFile: boolean; readonly isDirectory: boolean } | undefined;
  isExecutable(targetPath: string): boolean;
  hasElfHeader(targetPath: string): boolean;
}

export interface AppLauncherLaunchCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface AppLauncherSpawnOptions {
  readonly shell: false;
  readonly detached: true;
  readonly stdio: "ignore";
}

export type AppLauncherSpawn = (
  command: string,
  args: readonly string[],
  options: AppLauncherSpawnOptions,
) => Pick<ChildProcess, "once" | "unref">;

const realFileSystem: AppLauncherTargetFileSystem = {
  stat(targetPath) {
    try {
      const result = statSync(targetPath);
      return { isFile: result.isFile(), isDirectory: result.isDirectory() };
    } catch {
      return undefined;
    }
  },
  isExecutable(targetPath) {
    try {
      accessSync(targetPath, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  hasElfHeader(targetPath) {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(targetPath, constants.O_RDONLY);
      const header = Buffer.alloc(4);
      return readSync(descriptor, header, 0, header.length, 0) === header.length
        && header[0] === 0x7f
        && header[1] === 0x45
        && header[2] === 0x4c
        && header[3] === 0x46;
    } catch {
      return false;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  },
};

export function isSupportedAppLauncherTarget(
  targetPath: unknown,
  platform: AppLauncherPlatform,
  fileSystem: AppLauncherTargetFileSystem = realFileSystem,
): targetPath is string {
  if (typeof targetPath !== "string" || targetPath.length === 0 || targetPath.length > 4096 || /[\u0000\r\n]/.test(targetPath)) {
    return false;
  }

  const absolute = platform === "win32" ? win32.isAbsolute(targetPath) : posix.isAbsolute(targetPath);
  if (!absolute) return false;

  const file = fileSystem.stat(targetPath);
  if (!file) return false;

  if (platform === "win32") {
    return file.isFile && win32.extname(targetPath).toLowerCase() === ".exe";
  }
  if (platform === "darwin") {
    return file.isDirectory && posix.extname(targetPath).toLowerCase() === ".app";
  }
  return file.isFile && fileSystem.isExecutable(targetPath) && fileSystem.hasElfHeader(targetPath);
}

export function getAppLauncherLaunchCommand(targetPath: string, platform: AppLauncherPlatform): AppLauncherLaunchCommand {
  if (platform === "darwin") {
    return { command: "/usr/bin/open", args: ["-a", targetPath] };
  }
  return { command: targetPath, args: [] };
}

export function getAppLauncherOpenDialogOptions(title: string, platform: AppLauncherPlatform): Electron.OpenDialogOptions {
  const base: Electron.OpenDialogOptions = {
    title,
    properties: ["openFile"],
  };
  if (platform === "win32") {
    return {
      ...base,
      properties: ["openFile", "dontAddToRecent"],
      filters: [{ name: "Applications", extensions: ["exe"] }],
    };
  }
  if (platform === "darwin") {
    return { ...base, filters: [{ name: "Applications", extensions: ["app"] }] };
  }
  return base;
}

export async function startAppLauncherTarget(
  targetPath: string,
  platform: AppLauncherPlatform,
  spawnProcess: AppLauncherSpawn,
): Promise<void> {
  const { command, args } = getAppLauncherLaunchCommand(targetPath, platform);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const child = spawnProcess(command, args, { shell: false, detached: true, stdio: "ignore" });
    child.once("error", () => {
      if (settled) return;
      settled = true;
      reject(new Error("Application could not be started."));
    });
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve();
    });
  });
}
