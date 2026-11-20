import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PluginSdkBridge, type PluginHostCapabilities, type PluginPanelHostHandle } from "../src/plugin-sdk-bridge.js";
import { PluginStateStore, type PluginStateRecord } from "../src/plugin-state.js";
import type { OpenPetsJavascriptPluginManifest } from "../src/plugin-manifest.js";
import type { PluginSessionEvent, SessionStopReason } from "../src/plugin-session-descriptor.js";

const sampleBreathingDescriptor = {
  kind: "breathing",
  title: "Calm Practice",
  patterns: [
    {
      id: "calm-4-6",
      name: "Calm 4-6",
      phases: [
        { kind: "in", seconds: 4 },
        { kind: "out", seconds: 6 },
      ],
    },
  ],
  autoStart: true,
};

function createTestCapabilities(): PluginHostCapabilities {
  return {
    bubbles: {
      show: async () => ({
        id: "bubble",
        update: async () => undefined,
        dismiss: async () => undefined,
        pin: async () => undefined,
        unpin: async () => undefined,
      }),
    },
    audio: {
      play: async () => undefined,
      importUserSound: async (_pluginId, _fileId, opts) => ({
        kind: "user-sound",
        id: "0".repeat(32),
        name: opts?.name,
      }),
      forgetUserSound: async () => undefined,
      stop: async () => undefined,
    },
    events: {
      subscribe: () => () => undefined,
    },
    pets: {
      list: () => [],
      spawn: async () => "pet",
      close: async () => undefined,
      show: async () => undefined,
      hide: async () => undefined,
      react: async () => undefined,
      setAnimation: async () => undefined,
      setScale: async () => undefined,
      setStatusReaction: async () => undefined,
      cancelMove: async () => undefined,
      moveBy: async () => undefined,
      wander: async () => undefined,
      moveToHome: async () => undefined,
      moveTo: async () => undefined,
      setAutomaticMovement: async () => undefined,
      followCursor: async () => undefined,
      physics: async () => undefined,
      getState: async () => ({
        position: { x: 0, y: 0 },
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        currentAnimation: "idle",
        visible: true,
        dragging: false,
      }),
      onTick: () => () => undefined,
      onChange: () => () => undefined,
    },
    toast: async () => undefined,
    notify: async () => undefined,
    panels: {
      open: async () => ({
        id: "panel",
        show: async () => undefined,
        hide: async () => undefined,
        postMessage: async () => undefined,
        close: async () => undefined,
      }),
    },
    session: {
      open: async () => ({
        update: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        stop: async () => undefined,
        close: async () => undefined,
      }),
    },
    delivery: {
      register: async () => ({
        dismiss: () => undefined,
        onDismiss: () => undefined,
      }),
      teardown: () => undefined,
    },
    secrets: {
      get: async () => undefined,
      set: async () => undefined,
      delete: async () => undefined,
      has: async () => false,
    },
    ai: {
      available: async () => false,
      complete: async () => ({ text: "" }),
      stream: async () => ({ text: "" }),
    },
    voice: {
      speak: async () => undefined,
      listen: async () => ({ text: "" }),
    },
    auth: {
      oauth: async () => ({ accessToken: "" }),
      refresh: async () => ({ accessToken: "" }),
      signOut: async () => undefined,
    },
    files: {
      pick: async () => [],
      read: async () => "",
      save: async () => undefined,
    },
    system: {
      info: async () => ({
        platform: "mac",
        locale: "en-US",
        timezone: "UTC",
        theme: "light",
        appVersion: "0.0.0",
        online: true,
      }),
      metrics: async () => ({ cpuPercent: 0, memUsedPercent: 0 }),
      openExternal: async () => undefined,
      readClipboardText: async () => "",
      writeClipboardText: async () => undefined,
    },
    settings: {
      audioAllowed: () => true,
      dynamicSpeechAllowed: () => false,
      voiceAllowed: () => true,
      listenAllowed: () => false,
      inQuietHours: () => false,
    },
  };
}

function createPanelHandle(close: () => Promise<void> = async () => undefined): PluginPanelHostHandle {
  return {
    id: "panel",
    show: async () => undefined,
    hide: async () => undefined,
    postMessage: async () => undefined,
    close,
  };
}

function createTestHarness(customCapabilities?: Partial<PluginHostCapabilities>, access: { permissions?: string[]; networkHosts?: string[] } = {}) {
  const permissions = (access.permissions ?? ["ui:session", "commands"]) as PluginStateRecord["approvedPermissions"];
  const root = mkdtempSync(join(tmpdir(), "openpets-session-test-"));
  const store = new PluginStateStore({ statePath: join(root, "state.json") });
  store.initialize();

  const record: PluginStateRecord = {
    id: "test.session-plugin",
    version: "1.0.0",
    manifestPath: join(root, "openpets.plugin.json"),
    installPath: root,
    source: "local",
    manifestVersion: 3,
    runtime: "javascript",
    sdkVersion: "3.0.0",
    enabled: true,
    approvedPermissions: permissions,
    ...(access.networkHosts ? { approvedNetworkHosts: access.networkHosts } : {}),
    config: {},
  };
  store.upsertRecord(record);

  const manifest: OpenPetsJavascriptPluginManifest = {
    manifestVersion: 3,
    id: "test.session-plugin",
    name: "Test Session Plugin",
    version: "1.0.0",
    runtime: "javascript",
    sdkVersion: "3.0.0",
    entry: "index.js",
    permissions: [...permissions],
    panels: { main: "panel.html" },
    ...(access.networkHosts ? { network: { hosts: access.networkHosts } } : {}),
  } as OpenPetsJavascriptPluginManifest;

  const capabilities = {
    ...createTestCapabilities(),
    ...customCapabilities,
  };

  const bridge = new PluginSdkBridge({
    stateStore: store,
    petApi: {
      speak() {},
      react() {},
      moveBy() {},
      wander() {},
      moveToHome() {},
    },
    scheduler: {
      setTimeout: () => ({ cancel() {} }),
    },
    capabilities,
    onError: (_id, reason) => {
      throw new Error(`Unexpected bridge error: ${reason}`);
    },
  });

  const api = bridge.createApi(record, manifest);

  return {
    api,
    bridge,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// Test 1: Auto-start event emitted during capabilities.session.open is buffered and delivered when onEvent subscribes
{
  let onEventCallback: ((event: PluginSessionEvent) => void) | undefined;
  const { api, cleanup } = createTestHarness({
    session: {
      open: async (options) => {
        onEventCallback = options.callbacks.onEvent;
        // Simulate auto-start overlay emitting 'started' before open completes
        options.callbacks.onEvent({ type: "started", patternId: "calm-4-6" });
        return {
          update: async () => undefined,
          pause: async () => undefined,
          resume: async () => undefined,
          stop: async () => undefined,
          close: async () => undefined,
        };
      },
    },
  });

  try {
    const { sessionId } = await api.ui.session(sampleBreathingDescriptor);
    const received: PluginSessionEvent[] = [];

    // Plugin subscribes only after await session(...) resolves (as Anxiety Aid Tools does)
    const subResult = api.ui.sessionSubscribe(sessionId, (event) => {
      received.push(event);
    });

    assert.equal(subResult.ok, true);
    assert.deepEqual(received, [
      { type: "started", patternId: "calm-4-6" },
    ]);

    // Subsequent events after subscription are delivered live
    onEventCallback?.({ type: "paused", patternId: "calm-4-6", cycle: 1 });
    assert.deepEqual(received, [
      { type: "started", patternId: "calm-4-6" },
      { type: "paused", patternId: "calm-4-6", cycle: 1 },
    ]);
  } finally {
    cleanup();
  }
}

// Test 2: Auto-start event emitted after open resolves but before sessionSubscribe arrives
{
  let onEventCallback: ((event: PluginSessionEvent) => void) | undefined;
  const { api, cleanup } = createTestHarness({
    session: {
      open: async (options) => {
        onEventCallback = options.callbacks.onEvent;
        return {
          update: async () => undefined,
          pause: async () => undefined,
          resume: async () => undefined,
          stop: async () => undefined,
          close: async () => undefined,
        };
      },
    },
  });

  try {
    const { sessionId } = await api.ui.session(sampleBreathingDescriptor);

    // Event arrives during the turn/IPC gap before sessionSubscribe
    onEventCallback?.({ type: "started", patternId: "calm-4-6" });

    const received: PluginSessionEvent[] = [];
    const subResult = api.ui.sessionSubscribe(sessionId, (event) => {
      received.push(event);
    });

    assert.equal(subResult.ok, true);
    assert.deepEqual(received, [
      { type: "started", patternId: "calm-4-6" },
    ]);
  } finally {
    cleanup();
  }
}

// Test 3: Closing the session before subscribing clears the buffer and rejects subscription
{
  let onEventCallback: ((event: PluginSessionEvent) => void) | undefined;
  let onClosedCallback: ((reason: SessionStopReason) => void) | undefined;
  const { api, cleanup } = createTestHarness({
    session: {
      open: async (options) => {
        onEventCallback = options.callbacks.onEvent;
        onClosedCallback = options.callbacks.onClosed;
        return {
          update: async () => undefined,
          pause: async () => undefined,
          resume: async () => undefined,
          stop: async () => undefined,
          close: async () => undefined,
        };
      },
    },
  });

  try {
    const { sessionId } = await api.ui.session(sampleBreathingDescriptor);

    // Event is emitted, but session is closed before subscriber attaches
    onEventCallback?.({ type: "started", patternId: "calm-4-6" });
    onClosedCallback?.("user");

    const received: PluginSessionEvent[] = [];
    const subResult = api.ui.sessionSubscribe(sessionId, (event) => {
      received.push(event);
    });

    assert.equal(subResult.ok, false);
    assert.equal(received.length, 0);
  } finally {
    cleanup();
  }
}

// Panel messages delivered before `onMessage` is registered are replayed in order.
{
  let onPanelMessage: ((msg: unknown) => void) | undefined;
  const { api, cleanup } = createTestHarness({
    panels: {
      open: async (options) => {
        onPanelMessage = options.onMessage;
        options.onMessage({ type: "ready" });
        return createPanelHandle();
      },
    },
  }, { permissions: ["ui:panel"] });

  try {
    const { panelId } = await api.ui.panel({ panel: "main" });
    onPanelMessage?.({ type: "loaded" });

    const received: unknown[] = [];
    api.ui.panelOnMessage(panelId, (message) => received.push(message));
    onPanelMessage?.({ type: "ready-for-host" });
    await Promise.resolve();

    assert.deepEqual(received, [
      { type: "ready" },
      { type: "loaded" },
      { type: "ready-for-host" },
    ]);
  } finally {
    cleanup();
  }
}

// Early-message overflow keeps the first 16 messages and drops later arrivals.
{
  let onPanelMessage: ((msg: unknown) => void) | undefined;
  const { api, cleanup } = createTestHarness({
    panels: {
      open: async (options) => {
        onPanelMessage = options.onMessage;
        return createPanelHandle();
      },
    },
  }, { permissions: ["ui:panel"] });

  try {
    const { panelId } = await api.ui.panel({ panel: "main" });
    for (let index = 0; index < 20; index += 1) {
      onPanelMessage?.({ index });
    }

    const received: unknown[] = [];
    api.ui.panelOnMessage(panelId, (message) => received.push(message));
    await Promise.resolve();

    assert.deepEqual(received, Array.from({ length: 16 }, (_, index) => ({ index })));
  } finally {
    cleanup();
  }
}

// Registering a callback enables normal delivery and a later registration replaces it.
{
  let onPanelMessage: ((msg: unknown) => void) | undefined;
  const { api, cleanup } = createTestHarness({
    panels: {
      open: async (options) => {
        onPanelMessage = options.onMessage;
        return createPanelHandle();
      },
    },
  }, { permissions: ["ui:panel"] });

  try {
    const { panelId } = await api.ui.panel({ panel: "main" });
    const firstReceived: unknown[] = [];
    const replacementReceived: unknown[] = [];

    api.ui.panelOnMessage(panelId, (message) => firstReceived.push(message));
    onPanelMessage?.({ type: "first" });
    api.ui.panelOnMessage(panelId, (message) => replacementReceived.push(message));
    onPanelMessage?.({ type: "second" });
    await Promise.resolve();

    assert.deepEqual(firstReceived, [{ type: "first" }]);
    assert.deepEqual(replacementReceived, [{ type: "second" }]);
  } finally {
    cleanup();
  }
}

// Closing a panel clears its delivery path and rejects later callback registration.
{
  let onPanelMessage: ((msg: unknown) => void) | undefined;
  let onPanelClosed: (() => void) | undefined;
  const { api, cleanup } = createTestHarness({
    panels: {
      open: async (options) => {
        onPanelMessage = options.onMessage;
        onPanelClosed = options.onClosed;
        return createPanelHandle(async () => { onPanelClosed?.(); });
      },
    },
  }, { permissions: ["ui:panel"] });

  try {
    const { panelId } = await api.ui.panel({ panel: "main" });
    onPanelMessage?.({ type: "before-close" });
    await api.ui.panelClose(panelId);

    const received: unknown[] = [];
    assert.throws(() => api.ui.panelOnMessage(panelId, (message) => received.push(message)), /no longer open/);
    onPanelMessage?.({ type: "after-close" });
    assert.deepEqual(received, []);
  } finally {
    cleanup();
  }
}

// A panel that closes while opening is not registered as an active panel.
{
  let onPanelMessage: ((msg: unknown) => void) | undefined;
  const { api, bridge, cleanup } = createTestHarness({
    panels: {
      open: async (options) => {
        onPanelMessage = options.onMessage;
        options.onClosed();
        return createPanelHandle();
      },
    },
  }, { permissions: ["ui:panel"] });

  try {
    await assert.rejects(api.ui.panel({ panel: "main" }));
    onPanelMessage?.({ type: "after-close" });
    assert.equal(bridge.getInspectorState("test.session-plugin").activePanels, 0);
  } finally {
    cleanup();
  }
}

// A deferred panel open that resolves after plugin shutdown is closed and rejected.
{
  let completeOpen: ((host: PluginPanelHostHandle) => void) | undefined;
  let onPanelMessage: ((msg: unknown) => void) | undefined;
  let onPanelClosed: (() => void) | undefined;
  let closeCalls = 0;
  const { api, bridge, cleanup } = createTestHarness({
    panels: {
      open: (options) => {
        onPanelMessage = options.onMessage;
        onPanelClosed = options.onClosed;
        options.onMessage({ type: "before-shutdown" });
        return new Promise<PluginPanelHostHandle>((resolve) => {
          completeOpen = resolve;
        });
      },
    },
  }, { permissions: ["ui:panel"] });

  try {
    const opening = api.ui.panel({ panel: "main" });
    const resolveOpen = completeOpen;
    assert.ok(resolveOpen);

    await bridge.clearPlugin("test.session-plugin");
    resolveOpen(createPanelHandle(async () => {
      closeCalls += 1;
      onPanelClosed?.();
    }));

    await assert.rejects(opening);
    onPanelMessage?.({ type: "after-shutdown" });
    assert.equal(closeCalls, 1);
    assert.equal(bridge.getInspectorState("test.session-plugin").activePanels, 0);
  } finally {
    cleanup();
  }
}

// Player media is downloaded on the plugin's behalf, so every segment must be
// on a host the user approved, and those hosts travel with the session open.
{
  const playerDescriptor = {
    kind: "player",
    title: "Guided meditation",
    tracks: [{ id: "calm", title: "Calm", segments: [{ audioUrl: "https://media.example.com/calm/01.mp3", caption: "Settle in." }] }],
  };
  let openedHosts: ReadonlySet<string> | undefined;
  const { api, cleanup } = createTestHarness({
    session: {
      open: async (options) => {
        openedHosts = options.mediaHosts;
        return { update: async () => undefined, pause: async () => undefined, resume: async () => undefined, stop: async () => undefined, close: async () => undefined };
      },
    },
  }, { permissions: ["ui:session", "commands", "network"], networkHosts: ["media.example.com"] });
  try {
    await api.ui.session(playerDescriptor);
    assert.deepEqual([...(openedHosts ?? [])], ["media.example.com"]);
    await assert.rejects(
      api.ui.session({ ...playerDescriptor, tracks: [{ ...playerDescriptor.tracks[0], segments: [{ audioUrl: "https://elsewhere.example.net/a.mp3" }] }] }),
      /not an approved network host/,
    );
  } finally {
    cleanup();
  }
}

console.log("plugin-sdk-ui-session tests passed successfully.");
