import assert from "node:assert/strict";
import { installMarketplacePageIpcHandler, type ControlCenterPetManagementIpcHandler } from "../src/control-center-pet-management-ipc.js";

let handler: ControlCenterPetManagementIpcHandler | undefined;
const opened: string[] = [];
let authorized = true;
installMarketplacePageIpcHandler({
  registerHandle: (_channel, registered) => { handler = registered; },
  authorizeSender: () => { if (!authorized) throw new Error("Unauthorized"); },
  openExternal: async (url) => { opened.push(url); },
  logger: { debug: () => {}, error: () => {} },
});
assert.ok(handler);
const invoke = handler;
const event = { sender: { id: 1 } };
await invoke(event);
const pluginId = "openpets.example-plugin_1";
await invoke(event, pluginId);
assert.deepEqual(opened, ["https://openpets.dev/plugins/publish", `https://openpets.dev/plugins/${encodeURIComponent(pluginId)}`]);
await assert.rejects(async () => invoke(event, "../outside"));
await assert.rejects(async () => invoke(event, "https://example.com"));
await assert.rejects(async () => invoke(event, "openpets.example%2Foutside"));
authorized = false;
await assert.rejects(async () => invoke(event, "openpets.example"));
assert.equal(opened.length, 2);
