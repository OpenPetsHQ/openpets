import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { app, BrowserWindow, dialog, type WebContents } from "electron";

import { createAppLauncherService, type AppLauncherService } from "./app-launcher-service.js";
import { isSupportedAppLauncherTarget, getAppLauncherOpenDialogOptions, startAppLauncherTarget, type AppLauncherPlatform } from "./app-launcher-platform.js";
import type { AppLauncherStoredEntry } from "./app-launcher-service.js";

let service: AppLauncherService | undefined;

function getPlatform(): AppLauncherPlatform {
  if (process.platform === "win32" || process.platform === "darwin" || process.platform === "linux") {
    return process.platform;
  }
  throw new Error("Application launcher is not supported on this platform.");
}

export function getAppLauncherService(): AppLauncherService {
  if (service) return service;

  const platform = getPlatform();
  const statePath = join(app.getPath("userData"), "openpets-app-launchers.json");
  service = createAppLauncherService({
    storage: {
      async load() {
        try {
          const contents = await readFile(statePath, "utf8");
          if (contents.length > 1_000_000) throw new Error("too large");
          return JSON.parse(contents) as unknown;
        } catch (error) {
          if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return { version: 1, entries: [] };
          }
          throw new Error("Application launcher settings could not be read.");
        }
      },
      async save(entries: readonly AppLauncherStoredEntry[]) {
        const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
        await mkdir(dirname(statePath), { recursive: true });
        try {
          const handle = await open(temporaryPath, "wx", 0o600);
          try {
            await handle.writeFile(JSON.stringify({ version: 1, entries }), "utf8");
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(temporaryPath, statePath);
        } catch {
          await rm(temporaryPath, { force: true }).catch(() => undefined);
          throw new Error("Application launcher settings could not be written.");
        }
      },
    },
    isTargetAvailable: (targetPath) => isSupportedAppLauncherTarget(targetPath, platform),
    getIconDataUrl: async (targetPath) => {
      const icon = await app.getFileIcon(targetPath, { size: "small" });
      return icon.isEmpty() ? undefined : icon.toDataURL();
    },
    launchTarget: (targetPath) => startAppLauncherTarget(targetPath, platform, spawn),
  });

  return service;
}

export async function pickAppLauncherTarget(sender: WebContents, title: string): Promise<string | undefined> {
  const platform = getPlatform();
  const owner = BrowserWindow.fromWebContents(sender);
  const options = getAppLauncherOpenDialogOptions(title, platform);
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled) return undefined;
  return result.filePaths[0];
}
