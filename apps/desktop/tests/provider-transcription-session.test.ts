import assert from "node:assert/strict";
import { register } from "node:module";

const pluginMock = `
  export const state = { operationBegin: 0, operationSettle: 0, operationRelease: 0, arbiterRelease: 0, captureStarts: 0, captureCancels: 0, pendingDevice: true, arbiterBusy: false, cancelHook: null };
  export function reserveSharedVoiceOperation() {
    return {
      begin(cancel) { state.operationBegin++; state.cancelHook = cancel; },
      setPhase() {},
      settle() { state.operationSettle++; },
      release() { state.operationRelease++; },
    };
  }
  export function getSharedVoiceMicrophoneArbiter() {
    return { reserve: () => { if (state.arbiterBusy) throw new Error("microphone busy"); return { generation: 1, acquireTrack: () => ({ generation: 1, owner: "listen", release() {} }) }; }, releaseReservation: () => { state.arbiterRelease++; } };
  }
  export function getSharedVoiceCaptureService() {
    return {
      async start() { state.captureStarts++; return new Promise(() => {}); },
      async cancelActive() { state.captureCancels++; },
    };
  }
`;
const deviceMock = `
  export const state = { pending: true };
  export function getSharedVoiceDeviceService() {
    return { snapshotOperation(signal) {
      if (!state.pending) return Promise.resolve({ inputDeviceId: null });
      return new Promise((resolve, reject) => { signal?.addEventListener("abort", () => reject(new Error("device enumeration cancelled")), { once: true }); });
    } };
  }
`;
const pluginUrl = `data:text/javascript,${encodeURIComponent(pluginMock)}`;
const deviceUrl = `data:text/javascript,${encodeURIComponent(deviceMock)}`;
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "./plugin-voice.js" && context.parentURL.includes("provider-configuration-test-session")) return { url: ${JSON.stringify(pluginUrl)}, shortCircuit: true };
    if (specifier === "./voice-device-service.js" && context.parentURL.includes("provider-configuration-test-session")) return { url: ${JSON.stringify(deviceUrl)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

const pluginState = (await import(pluginUrl)).state as {
  operationBegin: number;
  operationSettle: number;
  operationRelease: number;
  arbiterRelease: number;
  captureStarts: number;
  captureCancels: number;
  pendingDevice: boolean;
  arbiterBusy: boolean;
  cancelHook: (() => Promise<void>) | null;
};
const deviceState = (await import(deviceUrl)).state as { pending: boolean };
const { startProviderTranscriptionTest } = await import("../src/provider-configuration-test-session.js");

const initializing = startProviderTranscriptionTest(async () => "never");
await new Promise<void>((resolve) => setImmediate(resolve));
assert.equal(pluginState.operationBegin, 1);
assert.equal(pluginState.captureStarts, 0, "initialization owns the arbiter before capture starts");
await initializing.cancel("Control Center renderer was lost.");
await initializing.cancel("Provider modal closed.");
assert.equal(pluginState.operationRelease, 1);
assert.equal(pluginState.operationSettle, 1);
assert.equal(pluginState.arbiterRelease, 1);
await assert.rejects(initializing.result, /cancelled|enumeration/);

pluginState.arbiterBusy = true;
assert.throws(() => startProviderTranscriptionTest(async () => "never"), /microphone busy/);
assert.equal(pluginState.operationRelease, 2, "a busy microphone must release shared operation ownership");
assert.equal(pluginState.operationSettle, 2, "a busy microphone settles shared operation ownership");
pluginState.arbiterBusy = false;
deviceState.pending = false;
const recording = startProviderTranscriptionTest(async () => "never");
await new Promise<void>((resolve) => setImmediate(resolve));
assert.equal(pluginState.captureStarts, 1);
await recording.cancel("Provider modal closed.");
assert.equal(pluginState.arbiterRelease, 2, "recording cancellation releases the reservation once");
assert.equal(pluginState.captureCancels > 0, true);
await assert.rejects(recording.result, /cancelled|Provider modal closed/);

console.log("Provider transcription initialization and recording cancellation behavior verified.");
