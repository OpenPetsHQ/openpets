import { execFile } from "node:child_process";
import { shell } from "electron";

import { createExternalUrlOpener } from "./external-url-opener-core.js";
import { warn } from "./logger.js";

const XDG_OPEN_TIMEOUT_MS = 10_000;

const openExternalUrl = createExternalUrlOpener({
  platform: process.platform,
  environment: process.env,
  xdgOpenTimeoutMs: XDG_OPEN_TIMEOUT_MS,
  openWithXdg: (url, environment, signal) => new Promise<void>((resolve, reject) => {
    const child = execFile("xdg-open", [url], { env: environment }, (error) => {
      signal.removeEventListener("abort", stopLauncher);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    const stopLauncher = (): void => {
      // Only xdg-open is owned here; browser descendants may already be serving
      // the request and must not be terminated with it.
      child.kill("SIGKILL");
    };

    if (signal.aborted) {
      stopLauncher();
      return;
    }
    signal.addEventListener("abort", stopLauncher, { once: true });
  }),
  openWithShell: (url) => shell.openExternal(url),
  onXdgFailure: (error) => warn("app", "xdg-open failed", {
    reason: error instanceof Error ? error.message : String(error),
  }),
});

export { openExternalUrl };
