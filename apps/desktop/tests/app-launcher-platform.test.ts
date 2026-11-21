import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import {
  getAppLauncherLaunchCommand,
  getAppLauncherOpenDialogOptions,
  isSupportedAppLauncherTarget,
  startAppLauncherTarget,
  type AppLauncherSpawnOptions,
  type AppLauncherTargetFileSystem,
} from "../src/app-launcher-platform.js";

const files = new Map<string, { isFile: boolean; isDirectory: boolean }>([
  ["C:\\Apps\\Editor.exe", { isFile: true, isDirectory: false }],
  ["C:\\Apps\\Bad.cmd", { isFile: true, isDirectory: false }],
  ["C:\\Apps\\Directory.exe", { isFile: false, isDirectory: true }],
  ["/Applications/Editor.app", { isFile: false, isDirectory: true }],
  ["/Applications/not-an-app.app", { isFile: true, isDirectory: false }],
  ["/opt/Editor.AppImage", { isFile: true, isDirectory: false }],
  ["/opt/run-script", { isFile: true, isDirectory: false }],
]);

const fileSystem: AppLauncherTargetFileSystem = {
  stat: (targetPath) => files.get(targetPath),
  isExecutable: (targetPath) => targetPath === "/opt/Editor.AppImage" || targetPath === "/opt/run-script",
  hasElfHeader: (targetPath) => targetPath === "/opt/Editor.AppImage",
};

assert.equal(isSupportedAppLauncherTarget("C:\\Apps\\Editor.exe", "win32", fileSystem), true);
assert.equal(isSupportedAppLauncherTarget("C:\\Apps\\Bad.cmd", "win32", fileSystem), false);
assert.equal(isSupportedAppLauncherTarget("C:\\Apps\\Directory.exe", "win32", fileSystem), false);
assert.equal(isSupportedAppLauncherTarget("/Applications/Editor.app", "darwin", fileSystem), true);
assert.equal(isSupportedAppLauncherTarget("/Applications/not-an-app.app", "darwin", fileSystem), false);
assert.equal(isSupportedAppLauncherTarget("/opt/Editor.AppImage", "linux", fileSystem), true);
assert.equal(isSupportedAppLauncherTarget("/opt/run-script", "linux", fileSystem), false, "Linux scripts are not launcher targets");
assert.equal(isSupportedAppLauncherTarget("relative.exe", "win32", fileSystem), false);

assert.deepEqual(getAppLauncherLaunchCommand("C:\\Apps\\Editor.exe", "win32"), {
  command: "C:\\Apps\\Editor.exe",
  args: [],
});
assert.deepEqual(getAppLauncherLaunchCommand("/Applications/Editor.app", "darwin"), {
  command: "/usr/bin/open",
  args: ["-a", "/Applications/Editor.app"],
});
assert.deepEqual(getAppLauncherLaunchCommand("/opt/Editor.AppImage", "linux"), {
  command: "/opt/Editor.AppImage",
  args: [],
});
assert.deepEqual(getAppLauncherOpenDialogOptions("Choose an application", "win32").filters, [
  { name: "Applications", extensions: ["exe"] },
]);
assert.deepEqual(getAppLauncherOpenDialogOptions("Choose an application", "darwin").filters, [
  { name: "Applications", extensions: ["app"] },
]);
assert.deepEqual(getAppLauncherOpenDialogOptions("Choose an application", "win32").properties, ["openFile", "dontAddToRecent"]);
assert.deepEqual(getAppLauncherOpenDialogOptions("Choose an application", "darwin").properties, ["openFile"]);
assert.deepEqual(getAppLauncherOpenDialogOptions("Choose an application", "linux").properties, ["openFile"]);

const childEmitter = new EventEmitter();
const child = Object.assign(childEmitter, { unref: () => childEmitter }) as unknown as Pick<ChildProcess, "once" | "unref">;
let spawnCall: { command: string; args: readonly string[]; options: AppLauncherSpawnOptions } | undefined;
const started = startAppLauncherTarget("C:\\Apps\\Editor.exe", "win32", (command, args, options) => {
  spawnCall = { command, args, options };
  return child;
});
childEmitter.emit("spawn");
await started;
assert.deepEqual(spawnCall, {
  command: "C:\\Apps\\Editor.exe",
  args: [],
  options: { shell: false, detached: true, stdio: "ignore" },
});

const failedChildEmitter = new EventEmitter();
const failedChild = Object.assign(failedChildEmitter, { unref: () => failedChildEmitter }) as unknown as Pick<ChildProcess, "once" | "unref">;
const failedStart = startAppLauncherTarget("C:\\Private\\app.exe", "win32", () => failedChild);
failedChildEmitter.emit("error", new Error("could not start C:\\Private\\app.exe"));
await assert.rejects(failedStart, { message: "Application could not be started." });

console.log("App launcher platform behavior passed.");
