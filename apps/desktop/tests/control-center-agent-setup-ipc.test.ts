import assert from "node:assert/strict";

import {
  installControlCenterAgentSetupIpcHandlers,
  type ControlCenterAgentSetupIpcEvent,
  type ControlCenterAgentSetupIpcHandler,
} from "../src/control-center-agent-setup-ipc.js";
import type {
  AgentSetupCommandPaths,
  AgentSetupSnapshot,
} from "../src/agent-setup.js";

// Contract: authorized Control Center agent-setup IPC delegates validated payloads.

const channels = [
  "openpets:agent-setup-snapshot",
  "openpets:agent-setup-action",
  "openpets:agent-setup-command-paths",
] as const;

const event: ControlCenterAgentSetupIpcEvent = { sender: { id: 7 } };
const snapshot = { source: "fake-snapshot" } as unknown as AgentSetupSnapshot;
const commandPaths = { source: "fake-command-paths" } as unknown as AgentSetupCommandPaths;

type Harness = {
  readonly handlers: Map<string, ControlCenterAgentSetupIpcHandler>;
  readonly authorizationCalls: number;
  readonly delegated: Array<{ readonly operation: string; readonly args: readonly unknown[] }>;
};

function createHarness(options?: {
  readonly authorize?: (event: ControlCenterAgentSetupIpcEvent) => void;
}): Harness {
  const handlers = new Map<string, ControlCenterAgentSetupIpcHandler>();
  const delegated: Array<{ readonly operation: string; readonly args: readonly unknown[] }> = [];
  let authorizationCalls = 0;

  installControlCenterAgentSetupIpcHandlers({
    registerHandle: (channel, handler) => handlers.set(channel, handler),
    authorizeSender: (authorizedEvent) => {
      authorizationCalls += 1;
      options?.authorize?.(authorizedEvent);
    },
    getAgentSetupSnapshot: async (...args) => {
      delegated.push({ operation: "snapshot", args });
      return snapshot;
    },
    runAgentSetupAction: async (...args) => {
      delegated.push({ operation: "action", args });
      return snapshot;
    },
    updateAgentSetupCommandPaths: (patch) => {
      delegated.push({ operation: "command-paths", args: [patch] });
      return commandPaths;
    },
  });

  return {
    handlers,
    get authorizationCalls() { return authorizationCalls; },
    delegated,
  };
}

function getHandler(
  handlers: Map<string, ControlCenterAgentSetupIpcHandler>,
  channel: (typeof channels)[number],
): ControlCenterAgentSetupIpcHandler {
  const handler = handlers.get(channel);
  assert.ok(handler, `missing handler ${channel}`);
  return handler;
}

{
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()], channels);

  const selectedPetId = "pet-1";
  const commandMode = "bundled";
  const result = await getHandler(harness.handlers, "openpets:agent-setup-snapshot")(event, selectedPetId, commandMode);

  assert.strictEqual(result, snapshot);
  assert.deepEqual(harness.delegated, [{ operation: "snapshot", args: [selectedPetId, commandMode] }]);
  assert.equal(harness.authorizationCalls, 1);
}

{
  const harness = createHarness();
  const selectedPetId = "pet-2";
  const commandMode = "local";
  const result = await getHandler(harness.handlers, "openpets:agent-setup-action")(event, "zed-remove", selectedPetId, commandMode);

  assert.strictEqual(result, snapshot);
  assert.deepEqual(harness.delegated, [{ operation: "action", args: ["zed-remove", selectedPetId, commandMode] }]);
}

{
  const harness = createHarness();
  await assert.rejects(
    async () => getHandler(harness.handlers, "openpets:agent-setup-action")(event, "unsupported-action", "pet-1", "bundled"),
    { message: "Invalid agent setup action." },
  );

  assert.deepEqual(harness.delegated, []);
  assert.equal(harness.authorizationCalls, 1, "unsupported actions are authorized before validation");
}

{
  const patch = { claude: "/custom/claude", node: "/custom/node" };
  const harness = createHarness();
  const result = await getHandler(harness.handlers, "openpets:agent-setup-command-paths")(event, patch);

  assert.strictEqual(result, commandPaths);
  assert.equal(harness.delegated[0]?.operation, "command-paths");
  assert.strictEqual(harness.delegated[0]?.args[0], patch, "command-path patch is forwarded untouched");
}

{
  const harness = createHarness({
    authorize: () => { throw new Error("unauthorized"); },
  });

  await assert.rejects(
    async () => getHandler(harness.handlers, "openpets:agent-setup-snapshot")(event, "pet-1", "bundled"),
    { message: "unauthorized" },
  );
  await assert.rejects(
    async () => getHandler(harness.handlers, "openpets:agent-setup-action")(event, "zed-remove", "pet-1", "bundled"),
    { message: "unauthorized" },
  );
  await assert.rejects(
    async () => getHandler(harness.handlers, "openpets:agent-setup-command-paths")(event, { node: "/custom/node" }),
    { message: "unauthorized" },
  );

  assert.equal(harness.authorizationCalls, 3);
  assert.deepEqual(harness.delegated, [], "authorization precedes every operation delegation");
}

console.log("control-center agent-setup IPC handlers passed.");
