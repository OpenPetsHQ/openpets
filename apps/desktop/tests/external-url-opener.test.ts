import assert from "node:assert/strict";

import { createExternalUrlOpener, ExternalUrlLaunchTimeoutError } from "../src/external-url-opener-core.js";

const targetUrl = "https://example.test/path?query=exact";
const parentEnvironment = {
  GDK_BACKEND: "x11",
  WAYLAND_DISPLAY: "wayland-0",
  HOME: "/home/openpets",
};

{
  let xdgUrl: string | undefined;
  let xdgEnvironment: NodeJS.ProcessEnv | undefined;
  let shellOpened = false;
  const openUrl = createExternalUrlOpener({
    platform: "linux",
    environment: parentEnvironment,
    xdgOpenTimeoutMs: 20,
    openWithXdg: async (url, environment) => {
      xdgUrl = url;
      xdgEnvironment = environment;
    },
    openWithShell: async () => {
      shellOpened = true;
    },
    onXdgFailure: () => assert.fail("successful xdg-open must not trigger fallback"),
  });

  await openUrl(targetUrl);

  assert.equal(xdgUrl, targetUrl);
  assert.deepEqual(xdgEnvironment, { WAYLAND_DISPLAY: "wayland-0", HOME: "/home/openpets" });
  assert.deepEqual(parentEnvironment, { GDK_BACKEND: "x11", WAYLAND_DISPLAY: "wayland-0", HOME: "/home/openpets" });
  assert.equal(shellOpened, false);
}

{
  const xdgError = new Error("xdg-open unavailable");
  let fallbackReason: unknown;
  let shellUrl: string | undefined;
  const openUrl = createExternalUrlOpener({
    platform: "linux",
    environment: {},
    xdgOpenTimeoutMs: 20,
    openWithXdg: async () => {
      throw xdgError;
    },
    openWithShell: async (url) => {
      shellUrl = url;
    },
    onXdgFailure: (error) => {
      fallbackReason = error;
    },
  });

  await openUrl(targetUrl);

  assert.equal(fallbackReason, xdgError);
  assert.equal(shellUrl, targetUrl);
}

{
  const shellError = new Error("no default browser");
  let fallbackAttempted = false;
  const openUrl = createExternalUrlOpener({
    platform: "linux",
    environment: {},
    xdgOpenTimeoutMs: 20,
    openWithXdg: async () => {
      throw new Error("xdg-open failed");
    },
    openWithShell: async () => {
      fallbackAttempted = true;
      throw shellError;
    },
    onXdgFailure: () => undefined,
  });

  await assert.rejects(openUrl(targetUrl), (error: unknown) => error === shellError);
  assert.equal(fallbackAttempted, true);
}

{
  let launcherStopped = false;
  let fallbackAttempted = false;
  let reportedFailure: unknown;
  const openUrl = createExternalUrlOpener({
    platform: "linux",
    environment: {},
    xdgOpenTimeoutMs: 10,
    openWithXdg: (_url, _environment, signal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        launcherStopped = true;
        reject(new Error("launcher stopped"));
      }, { once: true });
    }),
    openWithShell: async () => {
      fallbackAttempted = true;
    },
    onXdgFailure: (error) => {
      reportedFailure = error;
    },
  });

  await assert.rejects(openUrl(targetUrl), (error: unknown) => error instanceof ExternalUrlLaunchTimeoutError);

  assert.equal(launcherStopped, true);
  assert.equal(fallbackAttempted, false);
  assert.ok(reportedFailure instanceof ExternalUrlLaunchTimeoutError);
}

{
  let shellUrl: string | undefined;
  const openUrl = createExternalUrlOpener({
    platform: "darwin",
    environment: { GDK_BACKEND: "unchanged" },
    xdgOpenTimeoutMs: 20,
    openWithXdg: async () => assert.fail("xdg-open must be Linux-only"),
    openWithShell: async (url) => {
      shellUrl = url;
    },
    onXdgFailure: () => assert.fail("non-Linux opening must not report xdg failure"),
  });

  await openUrl(targetUrl);

  assert.equal(shellUrl, targetUrl);
}

console.error("External URL opener tests passed.");
