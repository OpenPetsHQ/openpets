import assert from "node:assert/strict";

import { installControlCenterAppLauncherIpcHandlers, type ControlCenterAppLauncherIpcHandler } from "../src/control-center-app-launcher-ipc.js";
import { createAppLauncherService, type AppLauncherStoredEntry } from "../src/app-launcher-service.js";

const event = { sender: { id: 1 } };
const handlers = new Map<string, ControlCenterAppLauncherIpcHandler>();
let persisted: unknown = { version: 1, entries: [] };
let pickedPath = "C:/Approved/Editor.exe";
let pickerCalls = 0;

const service = createAppLauncherService({
  storage: {
    load: async () => structuredClone(persisted),
    save: async (entries: readonly AppLauncherStoredEntry[]) => { persisted = { version: 1, entries: structuredClone(entries) }; },
  },
  isTargetAvailable: () => true,
  getIconDataUrl: () => undefined,
  launchTarget: async () => undefined,
  createId: () => "00000000-0000-4000-8000-000000000001",
});

installControlCenterAppLauncherIpcHandlers({
  registerHandle: (channel, handler) => { handlers.set(channel, handler); },
  authorizeSender: () => undefined,
  service,
  pickTarget: async () => {
    pickerCalls += 1;
    return pickedPath;
  },
});

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  assert.ok(handler, `Missing handler ${channel}`);
  return handler(event, ...args);
}

const added = await invoke("openpets:app-launcher-add", "Editor", "C:/Untrusted/renderer-path.exe") as readonly { id: string; name: string }[];
assert.equal(added.length, 1);
assert.equal(added[0]?.name, "Editor");
assert.equal(pickerCalls, 1, "the main process opens the picker for every new target");
assert.equal(JSON.stringify(added).includes("C:/Approved"), false, "IPC snapshots never expose the selected path");
assert.equal(JSON.stringify(persisted).includes("C:/Untrusted"), false, "renderer-supplied paths are ignored");
assert.equal((persisted as { entries: AppLauncherStoredEntry[] }).entries[0]?.targetPath, pickedPath, "only the native picker result is stored");
assert.equal(handlers.has("openpets:app-launcher-launch"), false, "there is no renderer launch operation");

pickedPath = "C:/Approved/Editor-v2.exe";
await invoke("openpets:app-launcher-change-target", added[0]?.id, "C:/Untrusted/replacement.exe");
assert.equal(JSON.stringify(persisted).includes("Editor-v2.exe"), true);
assert.equal(JSON.stringify(persisted).includes("Untrusted"), false);

const unauthorizedHandlers = new Map<string, ControlCenterAppLauncherIpcHandler>();
let unauthorizedPickerCalls = 0;
installControlCenterAppLauncherIpcHandlers({
  registerHandle: (channel, handler) => { unauthorizedHandlers.set(channel, handler); },
  authorizeSender: () => { throw new Error("Unauthorized sender."); },
  service,
  pickTarget: async () => {
    unauthorizedPickerCalls += 1;
    return undefined;
  },
});
const unauthorizedAdd = unauthorizedHandlers.get("openpets:app-launcher-add");
assert.ok(unauthorizedAdd);
await assert.rejects(async () => {
  await unauthorizedAdd(event, "Editor");
}, /Unauthorized/);
assert.equal(unauthorizedPickerCalls, 0, "authorization runs before opening a native dialog");

console.log("Control Center app launcher IPC boundary passed.");
