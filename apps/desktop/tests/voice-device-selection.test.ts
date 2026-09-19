import assert from "node:assert/strict";

import {
  classifyVoiceDeviceAvailability,
  normalizeVoiceDeviceId,
  resolveVoiceInputDevice,
  resolveVoiceOutputDevice,
  normalizeEnumeratedVoiceDevices,
  type VoiceDeviceDescription,
} from "../src/voice-device-resolver.js";
import { VoiceDeviceService } from "../src/voice-device-service.js";
import { VoiceCaptureService } from "../src/voice-capture.js";
import { VoiceMicrophoneArbiter } from "../src/voice-microphone-arbiter.js";
import { VoicePrivacyIndicator } from "../src/voice-privacy-indicator.js";
import { VoiceConversationService } from "../src/voice-conversation.js";
import { isVoiceMediaPermissionAllowed } from "../src/voice-device-permissions.js";

const devices: readonly VoiceDeviceDescription[] = [
  { deviceId: "mic-1", kind: "audioinput", label: "Desk microphone" },
  { deviceId: "speaker-1", kind: "audiooutput", label: "Desk speakers" },
];

const captureUrl = "file:///openpets/voice-capture.html";
const realtimeUrl = "file:///openpets/voice-realtime.html";
const playerUrl = "file:///openpets/voice-media-player.html";
const audioRequest = { mediaTypes: ["audio"] };
assert.equal(isVoiceMediaPermissionAllowed("media", captureUrl, audioRequest, [captureUrl, realtimeUrl], [realtimeUrl, playerUrl]), true);
assert.equal(isVoiceMediaPermissionAllowed("media", playerUrl, audioRequest, [captureUrl, realtimeUrl], [realtimeUrl, playerUrl]), false);
assert.equal(isVoiceMediaPermissionAllowed("speaker-selection", playerUrl, undefined, [captureUrl, realtimeUrl], [realtimeUrl, playerUrl]), true);
assert.equal(isVoiceMediaPermissionAllowed("speaker-selection", captureUrl, undefined, [captureUrl, realtimeUrl], [realtimeUrl, playerUrl]), false);

assert.deepEqual(resolveVoiceInputDevice(devices, "mic-1"), { inputDeviceId: "mic-1", outcome: "preferred" });
assert.deepEqual(resolveVoiceInputDevice(devices, null), { inputDeviceId: null, outcome: "system-default" });
assert.deepEqual(resolveVoiceInputDevice(devices, "missing"), { inputDeviceId: null, outcome: "preferred-unavailable" });
assert.deepEqual(resolveVoiceOutputDevice(devices, "speaker-1"), { outputDeviceId: "speaker-1", outcome: "preferred" });
assert.deepEqual(resolveVoiceOutputDevice(devices, "missing"), { outputDeviceId: null, outcome: "preferred-unavailable" });
assert.equal(classifyVoiceDeviceAvailability(devices, "audioinput"), "available");
assert.equal(classifyVoiceDeviceAvailability([{ deviceId: "mic-1", kind: "audioinput", label: "" }], "audioinput"), "requires-permission");
assert.equal(classifyVoiceDeviceAvailability([], "audioinput"), "unavailable");
assert.equal(normalizeVoiceDeviceId("  mic-1  "), "  mic-1  ");
assert.equal(normalizeVoiceDeviceId(""), null);
assert.equal(normalizeVoiceDeviceId("µ-mic"), "µ-mic");
assert.equal(normalizeVoiceDeviceId("default"), null);
assert.deepEqual(resolveVoiceInputDevice([{ deviceId: "default", kind: "audioinput", label: "Default" }], "default"), { inputDeviceId: null, outcome: "system-default" });
assert.deepEqual(normalizeEnumeratedVoiceDevices([
  { deviceId: " default ", kind: "audioinput", label: "spaced" },
  { deviceId: "default", kind: "audioinput", label: "Default" },
  { deviceId: " µ-mic ", kind: "audioinput", label: "Unicode" },
]), [{ deviceId: " default ", kind: "audioinput", label: "spaced" }, { deviceId: " µ-mic ", kind: "audioinput", label: "Unicode" }]);

const service = new VoiceDeviceService({
  enumerate: async () => devices,
  getPreferences: () => ({ preferredInputDeviceId: "mic-1", preferredOutputDeviceId: "speaker-1" }),
  outputSelectionSupported: true,
});
const snapshot = await service.refresh();
assert.equal(snapshot.resolvedInputDeviceId, "mic-1");
assert.equal(snapshot.resolvedOutputDeviceId, "speaker-1");
assert.equal(snapshot.outputSelectionSupported, true);
assert.equal(snapshot.outputSelectionStatus, "supported");
assert.equal(snapshot.controlsSystemTts, false);
assert.equal(snapshot.appliesTo, "future-operations");
const operation = await service.snapshotOperation();
assert.deepEqual(operation, { inputDeviceId: "mic-1", preferredInputDeviceId: "mic-1", inputResolution: "preferred", outputDeviceId: "speaker-1", preferredOutputDeviceId: "speaker-1", outputResolution: "preferred" });
assert.ok(Object.isFrozen(operation), "operation snapshots are immutable");

const unavailableService = new VoiceDeviceService({
  enumerationTimeoutMs: 5,
  enumerate: async () => new Promise<readonly VoiceDeviceDescription[]>(() => undefined),
  getPreferences: () => ({ preferredInputDeviceId: "mic-1", preferredOutputDeviceId: null }),
});
const unavailableOperation = await unavailableService.snapshotOperation();
assert.deepEqual(unavailableOperation, { inputDeviceId: null, preferredInputDeviceId: "mic-1", inputResolution: "preferred-unavailable", outputDeviceId: null, preferredOutputDeviceId: null, outputResolution: "system-default" });
assert.equal(unavailableService.snapshot().input.status, "unavailable");
assert.equal(unavailableService.snapshot().outputSelectionStatus, "unavailable");

const unsupportedService = new VoiceDeviceService({
  enumerate: async () => devices,
  probeOutputSelection: async () => "unsupported",
});
assert.equal((await unsupportedService.refresh()).outputSelectionSupported, false);
assert.equal(unsupportedService.snapshot().outputSelectionStatus, "unsupported");

let captureInputDeviceId: string | null = null;
const capture = new VoiceCaptureService((_duration, onAcquired, inputDeviceId) => {
  captureInputDeviceId = inputDeviceId;
  const result = Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/webm" });
  return {
    acquire: async () => { onAcquired(); return { result, stop: async () => await result, cancel: async () => undefined, close: async () => undefined }; },
    cancel: async () => undefined,
    dispose: async () => undefined,
  };
}, new VoicePrivacyIndicator());
const captureHandle = await capture.start(1_000, undefined, "mic-1");
await captureHandle.cancel("test cleanup");
assert.equal(captureInputDeviceId, "mic-1", "generic capture receives the immutable selected input id");
const defaultCaptureHandle = await capture.start(1_000, undefined, "default");
await defaultCaptureHandle.cancel("test cleanup");
assert.equal(captureInputDeviceId, null, "Chromium's default pseudo-device uses OS-default constraints");

const attemptedInputIds: (string | null)[] = [];
let fallbackDisposed = false;
const fallbackCapture = new VoiceCaptureService((_duration, onAcquired, inputDeviceId) => {
  attemptedInputIds.push(inputDeviceId);
  if (inputDeviceId !== null) {
    return {
      acquire: async () => { throw Object.assign(new Error("selected device disappeared"), { name: "NotFoundError" }); },
      cancel: async () => undefined,
      dispose: async () => { fallbackDisposed = true; },
    };
  }
  const result = Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/webm" });
  return {
    acquire: async () => { onAcquired(); return { result, stop: async () => await result, cancel: async () => undefined, close: async () => undefined }; },
    cancel: async () => undefined,
    dispose: async () => undefined,
  };
}, new VoicePrivacyIndicator());
const fallbackHandle = await fallbackCapture.start(1_000, undefined, "missing-mic");
await fallbackHandle.cancel("test cleanup");
assert.deepEqual(attemptedInputIds, ["missing-mic", null]);
assert.equal(fallbackDisposed, true);

const permissionAttempts: (string | null)[] = [];
const permissionCapture = new VoiceCaptureService((_duration, _onAcquired, inputDeviceId) => {
  permissionAttempts.push(inputDeviceId);
  return {
    acquire: async () => { throw Object.assign(new Error("permission denied"), { name: "NotAllowedError" }); },
    cancel: async () => undefined,
    dispose: async () => undefined,
  };
}, new VoicePrivacyIndicator());
await assert.rejects(() => permissionCapture.start(1_000, undefined, "missing-mic"), /permission denied/);
assert.deepEqual(permissionAttempts, ["missing-mic"]);

const liveAttempts: (string | null)[] = [];
const liveIndicator = new VoicePrivacyIndicator();
const liveCapture = new VoiceCaptureService((_duration, onAcquired, inputDeviceId) => {
  liveAttempts.push(inputDeviceId);
  return {
    acquire: async () => {
      onAcquired();
      throw Object.assign(new Error("device changed after acquisition"), { name: "OverconstrainedError" });
    },
    cancel: async () => undefined,
    dispose: async () => undefined,
  };
}, liveIndicator);
await assert.rejects(() => liveCapture.start(1_000, undefined, "mic-1"), /device changed after acquisition/);
assert.deepEqual(liveAttempts, ["mic-1"]);
assert.equal(liveIndicator.liveTracks, 0);

let realtimeInputDeviceId: string | null = null;
const conversation = new VoiceConversationService({
  microphoneArbiter: new VoiceMicrophoneArbiter(),
  privacyIndicator: new VoicePrivacyIndicator(),
  inputDeviceId: "mic-1",
  transportFactory: (context) => {
    realtimeInputDeviceId = context.inputDeviceId;
    return { start: async () => context.emit({ type: "connected" }), setMuted: () => {}, close: async () => {} };
  },
});
await conversation.start();
await conversation.close();
assert.equal(realtimeInputDeviceId, "mic-1", "realtime transport receives the immutable selected input id");

console.log("Voice device resolver and operation snapshot behavior verified.");
