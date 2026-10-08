import { execFile } from "node:child_process";
import { shell } from "electron";

import { createExternalUrlOpener } from "./external-url-opener-core.js";
import { warn } from "./logger.js";

const openExternalUrl = createExternalUrlOpener({
  platform: process.platform,
  environment: process.env,
  openWithXdg: (url, environment) => new Promise<void>((resolve, reject) => {
    execFile("xdg-open", [url], { env: environment }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  }),
  openWithShell: (url) => shell.openExternal(url),
  onXdgFailure: (error) => warn("app", "xdg-open failed, falling back to shell.openExternal", {
    reason: error instanceof Error ? error.message : String(error),
  }),
});

export { openExternalUrl };
