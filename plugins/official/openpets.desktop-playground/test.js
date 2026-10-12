import assert from "node:assert/strict";
import { register } from "./index.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createContext({ config = {}, createPanel } = {}) {
  const configListeners = new Set();
  const panels = [];
  let command;
  let currentConfig = { ...config };

  const ctx = {
    assets: { icon: (name) => `icon:${name}` },
    commands: {
      register: async (spec, handler) => {
        command = { spec, handler };
      },
    },
    config: {
      get: async () => ({ ...currentConfig }),
      onChange: (handler) => {
        configListeners.add(handler);
        return () => configListeners.delete(handler);
      },
    },
    t: (key) => `translated:${key}`,
    ui: {
      panel: async (spec) => {
        const panel = createPanel
          ? await createPanel(spec, panels.length)
          : createMockPanel();
        panels.push({ spec, panel });
        return panel;
      },
    },
  };

  return {
    ctx,
    panels,
    get command() { return command; },
    async setConfig(value) {
      currentConfig = { ...value };
      await Promise.all([...configListeners].map((listener) => listener({ ...currentConfig })));
    },
  };
}

function createMockPanel({ rejectShow = false } = {}) {
  const panel = {
    messages: [],
    closed: false,
    rejectNextShow: rejectShow,
    rejectPostMessage: undefined,
    handler: undefined,
    async show() {
      if (panel.rejectNextShow) {
        panel.rejectNextShow = false;
        throw new Error("Panel is closed.");
      }
    },
    async postMessage(message) {
      if (panel.rejectPostMessage) {
        const error = panel.rejectPostMessage;
        panel.rejectPostMessage = undefined;
        throw error;
      }
      panel.messages.push(message);
    },
    onMessage(handler) {
      panel.handler = handler;
    },
    async close() {
      panel.closed = true;
    },
  };
  return panel;
}

function initMessage(panel) {
  return panel.messages.at(-1);
}

{
  const mock = createContext({
    config: { soundEnabled: false, defaultTool: "paint" },
  });
  let lifecycle;
  register({ register: (value) => { lifecycle = value; } });
  await lifecycle.start(mock.ctx);

  assert.equal(mock.command.spec.id, "open");
  assert.notEqual(mock.command.spec.placement, "top", "opening stays in the plugin submenu");
  assert.equal(mock.panels.length, 0, "startup does not open a panel");

  const [panel] = await Promise.all([
    mock.command.handler(),
    mock.command.handler(),
  ]);
  assert.equal(mock.panels.length, 1, "concurrent opens share one panel creation");
  assert.equal(panel, mock.panels[0].panel);
  assert.deepEqual(initMessage(panel).config, { soundEnabled: false, defaultTool: "paint" });
  assert.equal(initMessage(panel).strings["tool.paint"], "translated:tool.paint");

  await panel.handler({ type: "ready" });
  await mock.setConfig({ soundEnabled: true, defaultTool: "stamp" });
  assert.deepEqual(initMessage(panel).config, {
    soundEnabled: true,
    defaultTool: "stamp",
  });

  await mock.command.handler();
  assert.equal(mock.panels.length, 1, "a live panel is reused");

  panel.rejectNextShow = true;
  const reopened = await mock.command.handler();
  assert.equal(mock.panels.length, 2, "a closed handle is replaced");
  assert.notEqual(reopened, panel);

  await lifecycle.stop(mock.ctx);
  assert.equal(reopened.closed, true, "stop closes the active panel");
  const finalMessageBeforeStopConfigChange = initMessage(reopened);
  await mock.setConfig({ soundEnabled: false, defaultTool: "erase" });
  await reopened.handler({ type: "request-init" });
  assert.equal(initMessage(reopened), finalMessageBeforeStopConfigChange, "stop prevents late panel writes");
  assert.equal(await mock.command.handler(), undefined, "a stopped plugin cannot reopen a panel");
  assert.equal(mock.panels.length, 2);
}

{
  const pendingPanel = deferred();
  const mock = createContext({
    createPanel: () => pendingPanel.promise,
  });
  let lifecycle;
  register({ register: (value) => { lifecycle = value; } });
  await lifecycle.start(mock.ctx);

  const opening = mock.command.handler();
  await Promise.resolve();
  const stopping = lifecycle.stop(mock.ctx);
  const latePanel = createMockPanel();
  pendingPanel.resolve(latePanel);

  assert.equal(await opening, undefined, "pending open is cancelled by stop");
  await stopping;
  assert.equal(latePanel.closed, true, "a panel created after stop is immediately closed");
  assert.equal(initMessage(latePanel), undefined, "a stopped opening never posts initialization");
  assert.equal(await mock.command.handler(), undefined);
}

{
  const mock = createContext();
  let lifecycle;
  register({ register: (value) => { lifecycle = value; } });
  await lifecycle.start(mock.ctx);
  const stalePanel = await mock.command.handler();

  stalePanel.rejectPostMessage = new Error("Plugin panel is no longer open.");
  await mock.setConfig({ soundEnabled: false, defaultTool: "erase" });
  const reopenedPanel = await mock.command.handler();
  assert.equal(mock.panels.length, 2, "config updates discard stale closed panel handles");
  assert.notEqual(reopenedPanel, stalePanel);

  reopenedPanel.rejectPostMessage = new Error("Unexpected panel transport failure.");
  await assert.rejects(
    reopenedPanel.handler({ type: "request-init" }),
    "unrelated panel errors remain visible",
  );
  await lifecycle.stop(mock.ctx);
}

console.log("openpets.desktop-playground: all checks passed.");
