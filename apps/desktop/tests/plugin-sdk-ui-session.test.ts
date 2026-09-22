import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PluginSdkBridge, type PluginHostCapabilities } from "../src/plugin-sdk-bridge.js";
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
      moveBy: async () => undefined,
      wander: async () => undefined,
      moveToHome: async () => undefined,
      moveTo: async () => undefined,
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

function createTestHarness(customCapabilities?: Partial<PluginHostCapabilities>) {
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
    approvedPermissions: ["ui:session", "commands"],
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
    permissions: ["ui:session", "commands"],
  };

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

console.log("plugin-sdk-ui-session tests passed successfully.");
