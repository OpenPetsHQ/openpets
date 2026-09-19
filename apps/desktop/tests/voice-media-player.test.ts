import assert from "node:assert/strict";
import { register } from "node:module";

type FakeWindow = {
  readonly loadStarted: Promise<void>;
  resolveLoad(): void;
  resolveWait(): void;
  readonly scripts: string[];
};

const electronMock = `
  const sessions = new Map();
  export const app = { getAppPath: () => "/openpets" };
  export class BrowserWindow {
    static instances = [];
    destroyed = false;
    scripts = [];
    loadStarted;
    resolveLoad;
    webContents = {
      setWindowOpenHandler: () => {},
      on: () => {},
      executeJavaScript: async (script) => {
        this.scripts.push(script);
        if (script.includes("__openPetsVoicePlayer.play(")) return { output: "system-default", reason: "no-selection" };
        if (script.includes("__openPetsVoicePlayer.wait()")) return new Promise((resolve) => { this.resolveWait = resolve; });
        if (script.includes("__openPetsVoicePlayer.stop()")) { this.resolveWait?.(); return true; }
        return true;
      },
    };
    constructor() {
      this.loadStarted = new Promise((resolve) => { this.resolveLoad = resolve; });
      BrowserWindow.instances.push(this);
    }
    loadFile() { return this.loadStarted; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.resolveLoad?.(); this.resolveWait?.(); }
  }
  export const session = { fromPartition: (partition) => sessions.get(partition) ?? (() => { const value = { setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {} }; sessions.set(partition, value); return value; })() };
`;
const electronUrl = `data:text/javascript,${encodeURIComponent(electronMock)}`;
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: ${JSON.stringify(electronUrl)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

const { getSharedVoiceDeviceService } = await import("../src/voice-device-service.js");
let enumerate: (signal?: AbortSignal) => Promise<readonly never[]>;
getSharedVoiceDeviceService({ enumerate: (signal) => enumerate(signal) });
const { VoiceMediaPlayer } = await import("../src/voice-media-player.js");

let resolveEnumeration: (() => void) | null = null;
let enumerationBlocked = false;
enumerate = async (signal) => {
  if (!enumerationBlocked) return [];
  await new Promise<void>((resolve, reject) => {
    resolveEnumeration = resolve;
    signal?.addEventListener("abort", () => reject(new Error("enumeration cancelled")), { once: true });
  });
  return [];
};

const player = new VoiceMediaPlayer();
const initializationPlay = player.play("initializing", new Uint8Array([1]), "audio/mpeg");
await new Promise<void>((resolve) => setImmediate(resolve));
const stopInitialization = player.stop("initializing");
const firstWindow = ((await import("electron")).BrowserWindow as unknown as { instances: FakeWindow[] }).instances[0];
firstWindow.resolveLoad();
await stopInitialization;
await assert.rejects(initializationPlay, /cancelled|replaced/);
assert.equal(firstWindow.scripts.some((script) => script.includes("__openPetsVoicePlayer.play(")), false, "stop during setup must prevent playback");

const replacementA = player.play("replacement-a", new Uint8Array([1]), "audio/mpeg");
await new Promise<void>((resolve) => setImmediate(resolve));
const replacementB = player.play("replacement-b", new Uint8Array([1]), "audio/mpeg");
const windows = (await import("electron")).BrowserWindow as unknown as { instances: FakeWindow[] };
windows.instances[1]?.resolveLoad();
await assert.rejects(replacementA, /cancelled|replaced/);
await new Promise<void>((resolve) => setImmediate(resolve));
const replacementWindow = windows.instances[2];
replacementWindow.resolveLoad();
await player.stop("replacement-b");
await assert.rejects(replacementB, /cancelled|replaced/);
assert.equal(replacementWindow.scripts.some((script) => script.includes("__openPetsVoicePlayer.play(")), false, "replacement during setup must prevent the replaced start");

enumerationBlocked = true;
const windowCountBeforeAbort = windows.instances.length;
const controller = new AbortController();
const abortedPlay = player.play("aborted", new Uint8Array([1]), "audio/mpeg", controller.signal);
controller.abort();
const releaseBlockedEnumeration = resolveEnumeration as (() => void) | null;
releaseBlockedEnumeration?.();
await assert.rejects(abortedPlay, /cancelled|replaced/);
assert.equal(((await import("electron")).BrowserWindow as unknown as { instances: FakeWindow[] }).instances.length, windowCountBeforeAbort, "aborting device resolution must not create a player window");

enumerationBlocked = false;
const reusablePlayer = new VoiceMediaPlayer();
const firstTalk = reusablePlayer.play("talk-completed", new Uint8Array([1]), "audio/mpeg");
await new Promise<void>((resolve) => setImmediate(resolve));
const reusableWindow = windows.instances[windows.instances.length - 1];
reusableWindow.resolveLoad();
await new Promise<void>((resolve) => setImmediate(resolve));
reusableWindow.resolveWait();
await firstTalk;

const secondTalkOrPreview = reusablePlayer.play("generated-audio-after-talk", new Uint8Array([2]), "audio/mpeg");
await new Promise<void>((resolve) => setImmediate(resolve));
reusableWindow.resolveWait();
await secondTalkOrPreview;

console.log("Voice media player initialization cancellation and completed-talk reuse behavior verified.");
