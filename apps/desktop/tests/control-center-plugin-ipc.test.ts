import assert from "node:assert/strict";

import {
  installControlCenterPluginIpcHandlers,
  type ControlCenterPluginIpcEvent,
  type ControlCenterPluginIpcHandler,
  type ControlCenterPluginIpcLogger,
  type ControlCenterPluginService,
} from "../src/control-center-plugin-ipc.js";

const channels = [
  "openpets:plugins-snapshot",
  "openpets:plugins-set-enabled",
  "openpets:plugins-save-config",
  "openpets:plugins-pick-config-sound",
  "openpets:plugins-reload",
  "openpets:plugins-refresh-local",
  "openpets:plugins-execute-command",
  "openpets:plugins-load-local",
  "openpets:plugins-catalog-snapshot",
  "openpets:plugins-install-catalog",
  "openpets:plugins-update-catalog",
  "openpets:plugins-uninstall",
  "openpets:plugins-inspector",
] as const;

const event: ControlCenterPluginIpcEvent = { sender: { id: 7 } };
const snapshot = { plugins: [] } as const;

type Call = { readonly method: string; readonly args: readonly unknown[] };

function createHarness(): {
  readonly handlers: Map<string, ControlCenterPluginIpcHandler>;
  readonly calls: Call[];
  readonly loggerCalls: Array<{ readonly level: string; readonly message: string; readonly fields?: Record<string, unknown> }>;
  readonly service: ControlCenterPluginService;
  readonly setPickConfigSound: (implementation: ControlCenterPluginService["pickConfigSound"]) => void;
} {
  const handlers = new Map<string, ControlCenterPluginIpcHandler>();
  const calls: Call[] = [];
  const loggerCalls: Array<{ readonly level: string; readonly message: string; readonly fields?: Record<string, unknown> }> = [];
  const record = (method: string, ...args: unknown[]) => { calls.push({ method, args }); };
  let pickConfigSound: ControlCenterPluginService["pickConfigSound"] = async (id) => {
    record("pickConfigSound", id);
    return { ok: true, sound: { kind: "user-sound", id: "sound-1", name: "tone.ogg" }, snapshot };
  };
  const service: ControlCenterPluginService = {
    getSnapshot: async () => { record("getSnapshot"); return snapshot; },
    setEnabled: async (...args) => { record("setEnabled", ...args); return { ok: true, snapshot }; },
    saveConfig: async (...args) => { record("saveConfig", ...args); return { ok: true, snapshot }; },
    pickConfigSound: (id) => pickConfigSound(id),
    reload: async (...args) => { record("reload", ...args); return { ok: true, snapshot }; },
    refreshLocal: async (...args) => { record("refreshLocal", ...args); return { ok: true, snapshot }; },
    executeCommand: async (...args) => { record("executeCommand", ...args); return { ok: true, snapshot }; },
    loadLocal: async () => { record("loadLocal"); return { ok: true, snapshot }; },
    getCatalogSnapshot: async (...args) => { record("getCatalogSnapshot", ...args); return { plugins: [] }; },
    installCatalog: async (...args) => { record("installCatalog", ...args); return { ok: true, snapshot }; },
    updateCatalog: async (...args) => { record("updateCatalog", ...args); return { ok: true, snapshot }; },
    uninstall: async (...args) => { record("uninstall", ...args); return { ok: true, snapshot }; },
    runtime: { getInspectorState: (...args) => { record("getInspectorState", ...args); return { id: args[0] } as unknown as ReturnType<ControlCenterPluginService["runtime"]["getInspectorState"]>; } },
  };
  const logger: ControlCenterPluginIpcLogger = {
    debug: (message, fields) => loggerCalls.push({ level: "debug", message, fields }),
    warn: (message, fields) => loggerCalls.push({ level: "warn", message, fields }),
    error: (message, fields) => loggerCalls.push({ level: "error", message, fields }),
  };
  installControlCenterPluginIpcHandlers({
    registerHandle: (channel, handler) => handlers.set(channel, handler),
    authorizeSender: () => undefined,
    getPluginService: () => service,
    logger,
  });
  return { handlers, calls, loggerCalls, service, setPickConfigSound: (implementation) => { pickConfigSound = implementation; } };
}

const validArgs: Record<(typeof channels)[number], readonly unknown[]> = {
  "openpets:plugins-snapshot": [],
  "openpets:plugins-set-enabled": ["plugin", true],
  "openpets:plugins-save-config": ["plugin", { enabled: true }],
  "openpets:plugins-pick-config-sound": ["plugin"],
  "openpets:plugins-reload": ["plugin"],
  "openpets:plugins-refresh-local": ["plugin"],
  "openpets:plugins-execute-command": ["plugin", "command:run", { value: 1 }],
  "openpets:plugins-load-local": [],
  "openpets:plugins-catalog-snapshot": [true],
  "openpets:plugins-install-catalog": ["plugin"],
  "openpets:plugins-update-catalog": ["plugin"],
  "openpets:plugins-uninstall": ["plugin"],
  "openpets:plugins-inspector": ["plugin"],
};

function getHandler(handlers: Map<string, ControlCenterPluginIpcHandler>, channel: (typeof channels)[number]): ControlCenterPluginIpcHandler {
  const handler = handlers.get(channel);
  assert.ok(handler, `missing handler ${channel}`);
  return handler;
}

assert.deepEqual([...createHarness().handlers.keys()], channels, "only the fixed plugin channels are registered");

{
  const harness = createHarness();
  let authorized = false;
  let serviceAccesses = 0;
  installControlCenterPluginIpcHandlers({
    registerHandle: (channel, handler) => harness.handlers.set(channel, handler),
    authorizeSender: () => { authorized = true; throw new Error("unauthorized"); },
    getPluginService: () => { serviceAccesses += 1; return harness.service; },
    logger: { debug() {}, warn() {}, error() {} },
  });
  for (const channel of channels) await assert.rejects(() => getHandler(harness.handlers, channel)(event, ...validArgs[channel]), /unauthorized/);
  assert.equal(authorized, true);
  assert.equal(serviceAccesses, 0, "authorization precedes plugin-service access for every handler");
  assert.deepEqual(harness.calls, []);
}

{
  const harness = createHarness();
  const invalidRequests: Array<{ readonly channel: (typeof channels)[number]; readonly args: readonly unknown[]; readonly error: string }> = [
    { channel: "openpets:plugins-set-enabled", args: ["Bad", true], error: "Invalid plugin enable request." },
    { channel: "openpets:plugins-save-config", args: ["plugin", []], error: "Invalid plugin config request." },
    { channel: "openpets:plugins-pick-config-sound", args: ["Bad"], error: "Invalid plugin sound request." },
    { channel: "openpets:plugins-reload", args: ["Bad"], error: "Invalid plugin reload request." },
    { channel: "openpets:plugins-refresh-local", args: ["Bad"], error: "Invalid plugin refresh request." },
    { channel: "openpets:plugins-execute-command", args: ["plugin", "bad command", {}], error: "Invalid plugin command request." },
    { channel: "openpets:plugins-install-catalog", args: ["Bad"], error: "Invalid plugin install request." },
    { channel: "openpets:plugins-update-catalog", args: ["Bad"], error: "Invalid plugin update request." },
    { channel: "openpets:plugins-uninstall", args: ["Bad"], error: "Invalid plugin uninstall request." },
  ];
  for (const request of invalidRequests) {
    const result = await getHandler(harness.handlers, request.channel)(event, ...request.args) as { readonly ok: false; readonly error: string };
    assert.equal(result.ok, false);
    assert.equal(result.error, request.error);
  }
  await assert.rejects(() => getHandler(harness.handlers, "openpets:plugins-inspector")(event, "Bad"), /Invalid plugin inspector request\./);
  assert.deepEqual(harness.calls, [], "invalid ids, config, and command args do not call the service");
  assert.equal(harness.loggerCalls.some((entry) => entry.message === "Plugin sound pick invalid request."), true);
}

{
  const harness = createHarness();
  const commandArgs = { value: 1 };
  const config = { enabled: true };
  for (const channel of channels) {
    const result = await getHandler(harness.handlers, channel)(event, ...(channel === "openpets:plugins-save-config" ? ["plugin", config] : channel === "openpets:plugins-execute-command" ? ["plugin", "command:run", commandArgs] : validArgs[channel]));
    if (channel === "openpets:plugins-inspector") assert.deepEqual(result, { id: "plugin" }, "inspector returns the current runtime inspector result unchanged");
  }
  assert.deepEqual(harness.calls.map(({ method }) => method), [
    "getSnapshot", "setEnabled", "saveConfig", "pickConfigSound", "reload", "refreshLocal", "executeCommand", "loadLocal", "getCatalogSnapshot", "installCatalog", "updateCatalog", "uninstall", "getInspectorState",
  ]);
  assert.deepEqual(harness.calls[1]?.args, ["plugin", true]);
  assert.equal(harness.calls[2]?.args[1], config);
  assert.equal(harness.calls[6]?.args[2], commandArgs);
  assert.deepEqual(harness.calls[12]?.args, ["plugin"]);
}

{
  const harness = createHarness();
  for (const refresh of [true, false, 1, "true", undefined, null]) {
    await getHandler(harness.handlers, "openpets:plugins-catalog-snapshot")(event, refresh);
  }
  assert.deepEqual(harness.calls.map(({ args }) => args[0]), [true, false, false, false, false, false], "only literal true enables catalog refresh");
}

{
  const harness = createHarness();
  const picker = getHandler(harness.handlers, "openpets:plugins-pick-config-sound");
  await picker(event, "plugin");
  assert.equal(harness.loggerCalls.some((entry) => entry.message === "Plugin sound pick requested." && entry.fields?.pluginId === "plugin"), true);
  assert.equal(harness.loggerCalls.some((entry) => entry.message === "Plugin sound pick succeeded." && entry.fields?.soundId === "sound-1"), true);
  harness.setPickConfigSound(async () => ({ ok: true, canceled: true, snapshot }));
  await picker(event, "plugin");
  assert.equal(harness.loggerCalls.some((entry) => entry.message === "Plugin sound pick canceled."), true);
  harness.setPickConfigSound(async () => ({ ok: false, error: "picker failed", snapshot }));
  await picker(event, "plugin");
  assert.equal(harness.loggerCalls.some((entry) => entry.message === "Plugin sound pick failed." && entry.fields?.reason === "picker failed"), true);
  harness.setPickConfigSound(async () => { throw new Error("picker exploded"); });
  await assert.rejects(() => picker(event, "plugin"), /picker exploded/);
  assert.equal(harness.loggerCalls.some((entry) => entry.message === "Plugin sound pick errored." && entry.fields?.reason === "picker exploded"), true);
}

console.log("control-center plugin IPC handlers passed.");
