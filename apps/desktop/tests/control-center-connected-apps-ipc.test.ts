import assert from "node:assert/strict";

import {
  installControlCenterConnectedAppsIpcHandlers,
  type ControlCenterConnectedAppsEvent,
  type ControlCenterConnectedAppsHandler,
} from "../src/control-center-connected-apps-ipc.js";
import type { ConnectedAppsProvider } from "../src/connected-apps-contract.js";
import type { SafePluginRecord } from "../src/plugin-service.js";

const event: ControlCenterConnectedAppsEvent = { sender: { id: 11 } };
const plugins: readonly SafePluginRecord[] = [
  { id: "openpets.deadline-buddy", name: "Deadline Buddy", version: "1.0.0", source: "catalog", enabled: true, approvedPermissions: ["calendar:connect"], requestedPermissions: ["calendar:connect"] },
  { id: "openpets.other-calendar", name: "Other Calendar", version: "1.0.0", source: "local", enabled: true, approvedPermissions: ["calendar:connect"], requestedPermissions: ["calendar:connect"] },
  { id: "openpets.no-calendar", name: "No Calendar", version: "1.0.0", source: "local", enabled: true, approvedPermissions: [], requestedPermissions: [] },
];

const handlers = new Map<string, ControlCenterConnectedAppsHandler>();
const grants = new Set<string>();
const disconnectCalls: Array<{ readonly pluginId: string; readonly provider: ConnectedAppsProvider }> = [];
const connectCalls: Array<{ readonly pluginId: string; readonly provider: ConnectedAppsProvider }> = [];
const statusCalls: Array<{ readonly pluginId: string; readonly provider: ConnectedAppsProvider }> = [];
let pluginSnapshotReads = 0;
let authorized = true;

installControlCenterConnectedAppsIpcHandlers({
  registerHandle: (channel, handler) => handlers.set(channel, handler),
  authorizeSender: () => { if (!authorized) throw new Error("unauthorized"); },
  getPluginService: () => ({ getSnapshot: async () => { pluginSnapshotReads += 1; return { plugins }; } }),
  getConsentStore: () => ({
    hasAccess: async (pluginId, provider) => grants.has(`${pluginId}\0${provider}`),
    setAccess: async (pluginId, provider, enabled) => {
      const key = `${pluginId}\0${provider}`;
      if (enabled) grants.add(key);
      else grants.delete(key);
    },
  }),
  getCalendarManager: () => ({
    status: async (pluginId, provider) => {
      statusCalls.push({ pluginId, provider });
      return { provider, state: "not_connected", checkedAt: "2026-09-23T00:00:00.000Z" };
    },
    connect: async (pluginId, provider) => { connectCalls.push({ pluginId, provider }); return { state: "link_opened" }; },
    disconnect: async (pluginId, provider) => { disconnectCalls.push({ pluginId, provider }); },
  }),
});

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  assert.ok(handler, `Expected registered IPC channel ${channel}.`);
  return Promise.resolve(handler(event, ...args));
}

assert.deepEqual([...handlers.keys()], [
  "openpets:connected-apps-snapshot",
  "openpets:connected-apps-connect",
  "openpets:connected-apps-set-plugin-access",
  "openpets:connected-apps-disconnect",
]);

{
  const snapshot = await invoke("openpets:connected-apps-snapshot") as Awaited<ReturnType<typeof import("../src/connected-apps-service.js").buildConnectedAppsSnapshot>>;
  assert.deepEqual(snapshot.providers.map((provider) => provider.provider), ["google", "outlook"]);
  assert.equal(snapshot.providers[0]?.connectAllowed, false);
  assert.equal(snapshot.providers[0]?.blockerCode, "calendar_identity_verification_unavailable");
  assert.deepEqual(snapshot.providers[0]?.connections.map((connection) => connection.pluginId), ["openpets.deadline-buddy", "openpets.other-calendar"]);
  assert.equal(snapshot.providers[0]?.connections[0]?.accessGranted, false);
  assert.equal(snapshot.providers[0]?.connections[0]?.state, "unavailable");
  assert.equal(snapshot.providers[0]?.connections[0]?.accountLabel, null, "the unverified Composio owner identity is not surfaced as an account label");
  assert.equal(snapshot.providers[0]?.connections[0]?.lastSyncAt, null);
  assert.equal(statusCalls.length, 0, "disabled OAuth does not query a connection status route or infer an account from its transport result");
  await assert.rejects(
    () => invoke("openpets:connected-apps-connect", "openpets.deadline-buddy", "google"),
    /independently verified/,
  );
  assert.deepEqual(connectCalls, [], "disabled OAuth cannot invoke the broker connect operation");
}

{
  await invoke("openpets:connected-apps-set-plugin-access", "openpets.deadline-buddy", "google", true);
  await invoke("openpets:connected-apps-set-plugin-access", "openpets.deadline-buddy", "google", true);
  assert.equal(grants.has("openpets.deadline-buddy\0google"), true, "repeated approval converges to one grant");
  assert.equal(grants.has("openpets.deadline-buddy\0outlook"), false, "approval is provider-specific");
  assert.equal(grants.has("openpets.other-calendar\0google"), false, "one plugin's approval never grants another plugin");

  await assert.rejects(
    () => invoke("openpets:connected-apps-set-plugin-access", "openpets.no-calendar", "google", true),
    /Plugin has not requested calendar access/,
  );
  await assert.rejects(
    () => invoke("openpets:connected-apps-disconnect", "openpets.no-calendar", "google"),
    /Plugin has not requested calendar access/,
  );
  await invoke("openpets:connected-apps-disconnect", "openpets.deadline-buddy", "outlook");
  assert.deepEqual(disconnectCalls, [{ pluginId: "openpets.deadline-buddy", provider: "outlook" }]);
  assert.equal(grants.has("openpets.deadline-buddy\0google"), true, "disconnecting an account does not revoke its separate plugin grant");

  await invoke("openpets:connected-apps-set-plugin-access", "openpets.deadline-buddy", "google", false);
  await invoke("openpets:connected-apps-set-plugin-access", "openpets.deadline-buddy", "google", false);
  assert.equal(grants.has("openpets.deadline-buddy\0google"), false, "repeated revocation converges to no grant");
}

{
  const beforeReads = pluginSnapshotReads;
  authorized = false;
  await assert.rejects(() => invoke("openpets:connected-apps-snapshot"), /unauthorized/);
  await assert.rejects(() => invoke("openpets:connected-apps-set-plugin-access", "openpets.deadline-buddy", "google", true), /unauthorized/);
  authorized = true;
  assert.equal(pluginSnapshotReads, beforeReads, "unauthorized renderers are rejected before plugin state is read");
}

await assert.rejects(() => invoke("openpets:connected-apps-set-plugin-access", "../other-plugin", "google", true), /Invalid calendar connection scope/);
await assert.rejects(() => invoke("openpets:connected-apps-disconnect", "openpets.deadline-buddy", "unknown"), /Invalid calendar connection scope/);
