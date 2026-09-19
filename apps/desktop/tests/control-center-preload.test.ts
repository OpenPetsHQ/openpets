import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const desktopRoot = process.env.OPENPETS_DESKTOP_ROOT ?? new URL("../..", import.meta.url).pathname;
const source = readFileSync(join(desktopRoot, "control-center-preload.cjs"), "utf8");
let exposed: Record<string, (...args: any[]) => any> | undefined;
const listeners = new Map<string, Function>();
const sent: Array<{ channel: string; args: unknown[] }> = [];
const invoked: Array<{ channel: string; args: unknown[] }> = [];
const ipcRenderer = {
  invoke: async (channel: string, ...args: unknown[]) => { invoked.push({ channel, args }); return undefined; },
  on: (channel: string, listener: Function) => { listeners.set(channel, listener); },
  removeListener: (channel: string, listener: Function) => { if (listeners.get(channel) === listener) listeners.delete(channel); },
  send: (channel: string, ...args: unknown[]) => { sent.push({ channel, args }); },
};
runInNewContext(source, {
  require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, api: Record<string, (...args: any[]) => any>) => { exposed = api; } }, ipcRenderer }),
});

assert.ok(exposed);

// Control Center does not expose pet assistant conversation methods (relocated to pet companion chat)
assert.equal(exposed.onConversationEvent, undefined);
assert.equal(exposed.getConversationHistory, undefined);
assert.equal(exposed.getVoiceAssistantSnapshot, undefined);

// Verify routing listener registration and cleanup
const routeCallback = () => {};
const cleanupRoute = exposed.onRouteChange(routeCallback);
assert.equal(listeners.has("openpets:control-center-route"), true);
cleanupRoute();
assert.equal(listeners.has("openpets:control-center-route"), false);

// Verify plugins refresh listener registration and cleanup
const pluginsCallback = () => {};
const cleanupPlugins = exposed.onPluginsRefresh(pluginsCallback);
assert.equal(listeners.has("openpets:plugins-refresh"), true);
cleanupPlugins();
assert.equal(listeners.has("openpets:plugins-refresh"), false);

// Verify standard invocations work
await exposed.getPetsState();
await exposed.getDashboardSnapshot();
await exposed.getSettingsState();

assert.deepEqual(invoked.map(({ channel }) => channel), [
  "openpets:get-pets-state",
  "openpets:get-dashboard-snapshot",
  "openpets:get-settings-state",
]);

console.log("control-center preload contract passed.");
