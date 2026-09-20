import assert from "node:assert/strict";

import {
  installControlCenterRemoteIpcHandlers,
  type ControlCenterRemoteIpcEvent,
  type ControlCenterRemoteIpcHandler,
  type ControlCenterRemoteIpcService,
} from "../src/control-center-remote-ipc.js";
import type {
  RemoteControlClientSummary,
  RemoteControlConfigSnapshot,
  RemotePairingResult,
} from "../src/remote-control-service.js";

const channels = [
  "openpets:remote-get-snapshot",
  "openpets:remote-configure",
  "openpets:remote-pair-client",
  "openpets:remote-rotate-client",
  "openpets:remote-revoke-client",
] as const;

const event: ControlCenterRemoteIpcEvent = { sender: { id: 7 } };
const config: RemoteControlConfigSnapshot = {
  enabled: false,
  address: null,
  port: null,
  listening: false,
};
const clients: readonly RemoteControlClientSummary[] = [{
  id: "client-1",
  name: "Test client",
  scopes: ["status", "react"],
  createdAt: 1,
  updatedAt: 2,
  revoked: false,
}];
const pairing: RemotePairingResult = { clientId: "client-1", token: "token" };
const rotated: RemotePairingResult = { clientId: "client-1", token: "rotated-token" };
const revoked = { revoked: true };

type Harness = {
  readonly handlers: Map<string, ControlCenterRemoteIpcHandler>;
  readonly authorizationCalls: number;
  readonly serviceLookups: number;
  readonly delegated: Array<{ readonly operation: string; readonly args: readonly unknown[] }>;
};

function createHarness(options?: {
  readonly authorize?: (event: ControlCenterRemoteIpcEvent) => void;
}): Harness {
  const handlers = new Map<string, ControlCenterRemoteIpcHandler>();
  const delegated: Array<{ readonly operation: string; readonly args: readonly unknown[] }> = [];
  let authorizationCalls = 0;
  let serviceLookups = 0;
  const service: ControlCenterRemoteIpcService = {
    getConfiguration: () => {
      delegated.push({ operation: "getConfiguration", args: [] });
      return config;
    },
    listClients: () => {
      delegated.push({ operation: "listClients", args: [] });
      return clients;
    },
    configure: async (input) => {
      delegated.push({ operation: "configure", args: [input] });
      return config;
    },
    pairClient: (input) => {
      delegated.push({ operation: "pairClient", args: [input] });
      return pairing;
    },
    rotateClient: (clientId) => {
      delegated.push({ operation: "rotateClient", args: [clientId] });
      return rotated;
    },
    revokeClient: (clientId) => {
      delegated.push({ operation: "revokeClient", args: [clientId] });
      return revoked;
    },
  };

  installControlCenterRemoteIpcHandlers({
    registerHandle: (channel, handler) => handlers.set(channel, handler),
    authorizeSender: (authorizedEvent) => {
      authorizationCalls += 1;
      options?.authorize?.(authorizedEvent);
    },
    getRemoteControlService: () => {
      serviceLookups += 1;
      return service;
    },
  });

  return {
    handlers,
    get authorizationCalls() { return authorizationCalls; },
    get serviceLookups() { return serviceLookups; },
    delegated,
  };
}

function getHandler(
  handlers: Map<string, ControlCenterRemoteIpcHandler>,
  channel: (typeof channels)[number],
): ControlCenterRemoteIpcHandler {
  const handler = handlers.get(channel);
  assert.ok(handler, `missing handler ${channel}`);
  return handler;
}

{
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()], channels);

  const result = await getHandler(harness.handlers, "openpets:remote-get-snapshot")(event);

  assert.deepEqual(result, { config, clients });
  assert.deepEqual(harness.delegated, [
    { operation: "getConfiguration", args: [] },
    { operation: "listClients", args: [] },
  ]);
  assert.equal(harness.authorizationCalls, 1);
  assert.equal(harness.serviceLookups, 1);
}

{
  const harness = createHarness();
  const result = await getHandler(harness.handlers, "openpets:remote-configure")(event, {
    enabled: true,
    address: "127.0.0.1",
    port: 4321,
  });

  assert.deepEqual(result, { config, clients });
  assert.deepEqual(harness.delegated, [
    { operation: "configure", args: [{ enabled: true, address: "127.0.0.1", port: 4321 }] },
    { operation: "listClients", args: [] },
  ]);
}

{
  const harness = createHarness();
  const result = await getHandler(harness.handlers, "openpets:remote-pair-client")(event, {
    name: "Test client",
    scopes: ["status", "react"],
  });

  assert.strictEqual(result, pairing);
  assert.deepEqual(harness.delegated, [{
    operation: "pairClient",
    args: [{ name: "Test client", scopes: ["status", "react"] }],
  }]);
}

{
  const harness = createHarness();
  assert.strictEqual(await getHandler(harness.handlers, "openpets:remote-rotate-client")(event, "client-1"), rotated);
  assert.strictEqual(await getHandler(harness.handlers, "openpets:remote-revoke-client")(event, "client-1"), revoked);
  assert.deepEqual(harness.delegated, [
    { operation: "rotateClient", args: ["client-1"] },
    { operation: "revokeClient", args: ["client-1"] },
  ]);
}

for (const [channel, input, message] of [
  ["openpets:remote-configure", { enabled: "yes" }, "Invalid remote control configuration request."],
  ["openpets:remote-configure", { enabled: true, address: 123 }, "Invalid remote control configuration request."],
  ["openpets:remote-configure", { enabled: true, port: "4321" }, "Invalid remote control configuration request."],
  ["openpets:remote-pair-client", { name: "Test client", scopes: ["react", "status"] }, "Invalid remote client pair request."],
  ["openpets:remote-pair-client", { name: "Test client", scopes: ["status", "react", "say", "extra"] }, "Invalid remote client pair request."],
  ["openpets:remote-rotate-client", "", "Invalid remote client rotate request."],
  ["openpets:remote-rotate-client", 42, "Invalid remote client rotate request."],
  ["openpets:remote-revoke-client", "", "Invalid remote client revoke request."],
  ["openpets:remote-revoke-client", 42, "Invalid remote client revoke request."],
] as const) {
  const harness = createHarness();
  await assert.rejects(
    async () => getHandler(harness.handlers, channel)(event, input),
    { message },
  );
  assert.deepEqual(harness.delegated, [], `${channel} rejected input must not delegate`);
  assert.equal(harness.serviceLookups, 0, `${channel} validates before service lookup`);
}

{
  const harness = createHarness({
    authorize: () => { throw new Error("unauthorized"); },
  });

  for (const channel of channels) {
    const input = channel === "openpets:remote-configure"
      ? { enabled: true }
      : channel === "openpets:remote-pair-client"
        ? { name: "Test client", scopes: ["status", "react"] }
        : channel === "openpets:remote-get-snapshot"
          ? undefined
          : "client-1";
    await assert.rejects(
      async () => getHandler(harness.handlers, channel)(event, input),
      { message: "unauthorized" },
    );
  }

  assert.equal(harness.authorizationCalls, channels.length);
  assert.equal(harness.serviceLookups, 0, "authorization blocks every channel before service lookup");
  assert.deepEqual(harness.delegated, [], "authorization blocks every channel before delegation");
}

console.log("control-center remote IPC handlers passed.");
