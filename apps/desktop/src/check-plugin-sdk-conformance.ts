/**
 * Drift guard between the runtime plugin SDK and the published
 * `@open-pets/plugin-sdk` type contract.
 *
 * The runtime part of this check executes the shipped plugin SDK preload with
 * small Electron stubs. This makes the check observe the public bridge and
 * its IPC transport, rather than depending on source-text route extraction.
 */
import type { OpenPetsContext, OpenPetsPermission } from "@open-pets/plugin-sdk";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, Script } from "node:vm";

import type { PluginJavascriptPermission } from "./plugin-manifest.js";
import type { PluginSdkApi } from "./plugin-sdk-bridge.js";
import type { sdkCallHandlers } from "./plugin-js-host.js";
import {
  pluginSdkAsyncRoutes,
  pluginSdkHostOnlyRoutes,
  pluginSdkPreloadAsyncRoutes,
  pluginSdkSyncRoutes,
  type PluginSdkRoute,
} from "./plugin-sdk-routes.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// Every namespace the published SDK exposes (ctx.pet, ctx.schedule, …) must
// exist on the runtime API, and the runtime must expose nothing extra.
type _NamespacesMatch = Expect<Equal<keyof PluginSdkApi, keyof OpenPetsContext>>;

// The JavaScript plugin permission union must match the published contract.
type _PermissionsMatch = Expect<Equal<PluginJavascriptPermission, OpenPetsPermission>>;
type _HostRoutesMatch = Expect<Equal<keyof typeof sdkCallHandlers, PluginSdkRoute>>;

// Reference the aliases so unused-type tooling never strips the guard.
export type PluginSdkConformance = [_NamespacesMatch, _PermissionsMatch, _HostRoutesMatch];

type TransportRecord = { readonly channel: string; readonly path: string; readonly args: unknown[] };
type PreloadSdk = OpenPetsContext;
type CallbackRunner = (id: string, args?: unknown[]) => Promise<unknown>;

const preloadPath = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin-sdk-preload.cjs");
const preloadSource = readFileSync(preloadPath, "utf8");
const harness = executePreload(preloadSource);
const { sdk, asyncCalls, syncCalls, runCallback } = harness;

await exercisePublicSdk(sdk, asyncCalls, runCallback);

const observedAsyncRoutes = new Set(asyncCalls.map((record) => record.path));
const observedSyncRoutes = new Set(syncCalls.map((record) => record.path));
const observedChannels = [...asyncCalls, ...syncCalls].map((record) => record.channel);
const expectedChannel = "openpets:plugin-sdk:conformance-token";

assertSetEqual("Plugin SDK preload async routes", observedAsyncRoutes, new Set(pluginSdkPreloadAsyncRoutes));
assertSetEqual("Plugin SDK preload sync routes", observedSyncRoutes, new Set(pluginSdkSyncRoutes));
assertSetEqual(
  "Plugin SDK host-only routes",
  new Set(
    (pluginSdkAsyncRoutes as readonly string[]).filter(
      (route) => !(pluginSdkPreloadAsyncRoutes as readonly string[]).includes(route),
    ),
  ),
  new Set(pluginSdkHostOnlyRoutes),
);
if (observedChannels.some((channel) => channel !== expectedChannel)) {
  throw new Error(`Plugin SDK preload used an unexpected IPC channel. Expected ${expectedChannel}.`);
}

console.error("Plugin SDK conformance validation passed.");

function executePreload(source: string): {
  sdk: PreloadSdk;
  asyncCalls: TransportRecord[];
  syncCalls: TransportRecord[];
  runCallback: CallbackRunner;
} {
  const asyncCalls: TransportRecord[] = [];
  const syncCalls: TransportRecord[] = [];
  let exposedSdk: unknown;
  let exposedCallback: unknown;
  let responseId = 0;

  const responseFor = (path: string): unknown => {
    if (path === "files.pick") return [{ fileId: "picked-file-1", name: "bell.wav", sizeBytes: 3 }];
    if (path === "pets.spawn") return { petHandleId: "spawned-pet" };
    if (path === "pet.speak" || path === "ui.bubble" || path === "ui.alert") return { bubbleId: "bubble-1" };
    if (path === "ui.panel") return { panelId: "panel-1" };
    if (path === "ui.delivery") return { deliveryId: "delivery-1" };
    if (path === "ui.session") return { sessionId: "session-1" };
    if (
      path.endsWith(".on") ||
      path.endsWith("Subscribe") ||
      path === "pet.onTick" ||
      path === "pets.onChange" ||
      path === "ui.menuOnSelect" ||
      path === "bus.subscribe" ||
      path === "storage.subscribe"
    ) {
      return { subscriptionId: `subscription-${++responseId}` };
    }
    return undefined;
  };

  const electron = {
    contextBridge: {
      exposeInMainWorld(name: string, value: unknown) {
        if (name === "__openPetsSdk") exposedSdk = value;
        if (name === "__openPetsRunCallback") exposedCallback = value;
      },
    },
    ipcRenderer: {
      invoke(channel: string, path: string, args: unknown[]): Promise<unknown> {
        asyncCalls.push({ channel, path, args });
        return Promise.resolve(responseFor(path));
      },
      sendSync(channel: string, path: string, args: unknown[]): unknown {
        syncCalls.push({ channel, path, args });
        return path === "i18n.locale" ? "en" : "translated";
      },
    },
  };

  const context = createContext({
    require: (id: string) => {
      if (id === "electron") return electron;
      throw new Error(`Unexpected preload dependency: ${id}`);
    },
    process: { argv: ["node", "plugin-sdk-preload.cjs", "--openpets-plugin-token=conformance-token"] },
  });
  new Script(source, { filename: preloadPath }).runInContext(context);

  if (!exposedSdk || typeof exposedSdk !== "object" || typeof exposedCallback !== "function") {
    throw new Error("Plugin SDK preload did not expose its public APIs.");
  }

  return {
    sdk: exposedSdk as PreloadSdk,
    asyncCalls,
    syncCalls,
    runCallback: exposedCallback as CallbackRunner,
  };
}

async function exercisePublicSdk(sdk: PreloadSdk, asyncCalls: TransportRecord[], runCallback: CallbackRunner): Promise<void> {
  assertEqual(sdk.pet, sdk.pets.default, "default pet handle is not shared");
  const pet = sdk.pets.get("pet-1");
  const bubble = await pet.speak("hello");
  await pet.react("happy", { showMessage: false });
  await pet.setAnimation("idle");
  await pet.setScale(1);
  await pet.setStatusReaction("working");
  await pet.moveBy({ x: 1, y: 2 });
  await pet.wander({ distance: 1 });
  await pet.moveToHome();
  await pet.moveTo({ x: 10, y: 20 });
  await pet.followCursor({ enabled: true });
  await pet.physics({ gravity: true });
  await pet.getState();
  await pet.show();
  await pet.hide();
  await pet.close();

  const tickDisposer = pet.onTick(() => undefined);
  tickDisposer();
  await sdk.pets.list();
  const spawnedPet = await sdk.pets.spawn({ petId: "spawned" });
  await spawnedPet.getState();
  await spawnedPet.close();
  const petsChangeDisposer = sdk.pets.onChange(() => undefined);
  petsChangeDisposer();

  await bubble.update({ text: "updated" });
  await bubble.dismiss();
  await bubble.pin();
  await bubble.unpin();
  bubble.onAction(() => undefined);
  bubble.onSubmit(() => undefined);
  bubble.onDismiss(() => undefined);
  const standaloneBubble = await sdk.ui.bubble({ text: "standalone" });
  await standaloneBubble.dismiss();
  const alert = await sdk.ui.alert({ text: "alert" });
  await alert.acknowledge();
  await sdk.ui.toast({ text: "toast" });
  const panel = await sdk.ui.panel({ panel: "panel" });
  await panel.show();
  await panel.hide();
  await panel.postMessage({ ready: true });
  panel.onMessage(() => undefined);
  await panel.close();
  const delivery = await sdk.ui.delivery({
    key: "delivery",
    courier: sdk.assets.sprite("courier"),
    title: "Delivery",
    detail: "Details",
    expiresAt: Date.now() + 60_000,
  });
  await delivery.dismiss();
  delivery.onDismiss(() => undefined);
  const session = await sdk.ui.session({
    kind: "breathing",
    title: "Breathing",
    patterns: [{ id: "calm", name: "Calm 4-6", phases: [{ kind: "in", seconds: 4 }, { kind: "out", seconds: 6 }], cycles: 12 }],
  });
  session.onEvent(() => undefined);
  await session.update({ patternId: "calm" });
  await session.pause();
  await session.resume();
  await session.stop();
  await session.close();

  const groundingSession = await sdk.ui.session({
    kind: "grounding",
    title: "Grounding",
    countdownSeconds: 0,
    practices: [{ id: "grounding", name: "Grounding", icon: "anchor" }],
    practiceId: "grounding",
    steps: [
      { id: "see", label: "See", title: "Look around you", prompt: "Find 2 things you can see", icon: "eye", items: [{ text: "A color", guidance: "Look closely." }, { text: "A shadow" }] },
      { id: "hear", label: "Hear", title: "Listen", prompt: "Find 1 thing you can hear", icon: "ear", items: [{ text: "Your breath" }] },
    ],
  });
  groundingSession.onEvent(() => undefined);
  await groundingSession.close();

  const pmrSession = await sdk.ui.session({
    kind: "pmr",
    title: "Muscle relaxation",
    steps: [
      {
        id: "step-1",
        name: "Hands",
        tenseSeconds: 10,
        releaseSeconds: 10,
        tenseLabel: "Tense",
        releaseLabel: "Release",
        tenseCue: "Clench fists.",
        releaseCue: "Release fists.",
        tenseIllustration: sdk.assets.svg("svg"),
        releaseIllustration: sdk.assets.svg("svg"),
      },
      {
        id: "step-2",
        name: "Arms",
        tenseSeconds: 10,
        releaseSeconds: 10,
        tenseLabel: "Tense",
        releaseLabel: "Release",
        tenseCue: "Flex biceps.",
        releaseCue: "Lower arms.",
      },
    ],
  });
  pmrSession.onEvent(() => undefined);
  await pmrSession.pause();
  await pmrSession.resume();
  await pmrSession.stop();
  await pmrSession.close();
  await sdk.ui.menu.setItems([]);
  const menuDisposer = sdk.ui.menu.onSelect(() => undefined);
  menuDisposer();

  await sdk.audio.play("bell");
  const picked = await sdk.files.pick({ accept: ["audio/*"], multiple: false });
  await picked[0].readText();
  await picked[0].readBytes();
  await sdk.audio.importUserSound(picked[0], { name: "Bell" });
  const importCall = findLastRecord(asyncCalls, "audio.importUserSound");
  assertEqual(importCall?.args[0], "picked-file-1", "audio.importUserSound must send the picked file id");
  await sdk.audio.forgetUserSound({ kind: "user-sound", id: "sound-1" });
  await sdk.audio.stop();

  let callbackPayload: unknown;
  const eventDisposer = sdk.events.on("pet:drop", (payload: unknown) => { callbackPayload = payload; });
  await settle();
  const eventCall = findLastRecord(asyncCalls, "events.on");
  const callbackId = eventCall?.args[1];
  if (typeof callbackId !== "string") throw new Error("Plugin SDK callback id was not transported.");
  await runCallback(callbackId, [{ files: [] }]);
  assertEqual((callbackPayload as { files?: unknown[] } | undefined)?.files?.length, 0, "callback round trip failed");
  eventDisposer();

  await sdk.bus.publish("topic", {});
  const busDisposer = sdk.bus.subscribe("topic", () => undefined);
  busDisposer();
  await sdk.schedule.once("once", 1, () => undefined);
  await sdk.schedule.every("every", 1, () => undefined);
  await sdk.schedule.daily("daily", "09:00", () => undefined);
  await sdk.schedule.cron("cron", "* * * * *", () => undefined);
  await sdk.schedule.at("at", "2026-01-01T00:00:00Z", () => undefined);
  await sdk.schedule.list();
  await sdk.schedule.cancel("once");
  await sdk.schedule.cancelAll();
  await sdk.storage.get("key");
  await sdk.storage.set("key", "value");
  await sdk.storage.delete("key");
  await sdk.storage.keys();
  const storageDisposer = sdk.storage.subscribe("key", () => undefined);
  storageDisposer();
  await sdk.config.get();
  const configDisposer = sdk.config.onChange(() => undefined);
  configDisposer();

  await sdk.net.fetch("https://example.com");
  await sdk.net.stream("https://example.com", {}, () => undefined);
  await sdk.notify.notify({ title: "title", body: "body" });
  await sdk.ai.available();
  const aiRequest = { messages: [{ role: "user" as const, content: "hello" }] };
  await sdk.ai.complete(aiRequest);
  await sdk.ai.stream(aiRequest, () => undefined);
  await sdk.secrets.get("key");
  await sdk.secrets.set("key", "value");
  await sdk.secrets.delete("key");
  await sdk.secrets.has("key");
  await sdk.voice.speak("hello");
  await sdk.voice.listen({});
  await sdk.auth.oauth({ provider: "google", clientId: "client", scopes: ["profile"] });
  await sdk.auth.refresh("google");
  await sdk.auth.signOut("google");
  await sdk.files.save({ suggestedName: "file.txt", data: "contents" });
  await sdk.system.info();
  await sdk.system.metrics();
  await sdk.system.openExternal("https://example.com");
  await sdk.system.readClipboardText();
  await sdk.system.writeClipboardText("contents");
  await sdk.commands.register({ id: "command", title: "Command" }, () => undefined);
  await sdk.commands.unregister("command");
  await sdk.status.set({ text: "Ready", tone: "info" });
  await sdk.status.clear();
  await sdk.assistant.registerCapability({ id: "capability", description: "Capability", inputSchema: { type: "object" } }, () => ({}));
  await sdk.assistant.unregisterCapability("capability");
  await sdk.http.fetch("https://example.com");
  sdk.log.debug("debug");
  sdk.log.info("info");
  sdk.log.warn("warn");
  sdk.log.error("error");

  assertEqual(sdk.assets.icon("icon").kind, "icon", "icon asset constructor drifted");
  assertEqual(sdk.assets.image("image").kind, "image", "image asset constructor drifted");
  assertEqual(sdk.assets.svg("svg").kind, "svg", "svg asset constructor drifted");
  assertEqual(sdk.assets.sprite("sprite").kind, "sprite", "sprite asset constructor drifted");
  assertEqual(sdk.assets.sound("sound").kind, "sound", "sound asset constructor drifted");
  assertEqual(sdk.t("hello"), "translated", "i18n.t drifted");
  assertEqual(sdk.locale, "en", "i18n.locale drifted");
  await settle();
}

async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}.`);
}

function findLastRecord(records: readonly TransportRecord[], path: string): TransportRecord | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record?.path === path) return record;
  }
  return undefined;
}

function assertSetEqual(label: string, actual: Set<string>, expected: Set<string>): void {
  const missing = [...expected].filter((route) => !actual.has(route)).sort();
  const extra = [...actual].filter((route) => !expected.has(route)).sort();
  if (missing.length > 0 || extra.length > 0) throw new Error(`${label} drift. Missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}.`);
}
