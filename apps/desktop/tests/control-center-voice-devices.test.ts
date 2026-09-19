import assert from "node:assert/strict";
import {
  resolveVoiceInputDevice,
  resolveVoiceOutputDevice,
  type VoiceDeviceDescription,
} from "../src/voice-device-resolver.js";
import { VoiceDeviceService, type VoiceDevicesSnapshot } from "../src/voice-device-service.js";

const devices: readonly VoiceDeviceDescription[] = [
  { deviceId: "mic-built-in", kind: "audioinput", label: "MacBook Pro Microphone" },
  { deviceId: "mic-usb", kind: "audioinput", label: "USB Podcast Mic" },
  { deviceId: "speaker-built-in", kind: "audiooutput", label: "MacBook Pro Speakers" },
  { deviceId: "speaker-usb", kind: "audiooutput", label: "Studio Monitors" },
];

// 1. Initial snapshot resolution with system default (null preference)
let currentPreferences = {
  preferredInputDeviceId: null as string | null,
  preferredOutputDeviceId: null as string | null,
};

const service = new VoiceDeviceService({
  enumerate: async () => devices,
  getPreferences: () => currentPreferences,
  savePreferences: (pref) => {
    currentPreferences = {
      preferredInputDeviceId: pref.preferredInputDeviceId !== undefined ? pref.preferredInputDeviceId : currentPreferences.preferredInputDeviceId,
      preferredOutputDeviceId: pref.preferredOutputDeviceId !== undefined ? pref.preferredOutputDeviceId : currentPreferences.preferredOutputDeviceId,
    };
  },
  outputSelectionSupported: true,
});

const initialSnapshot: VoiceDevicesSnapshot = await service.refresh();
assert.equal(initialSnapshot.input.status, "available");
assert.equal(initialSnapshot.input.devices.length, 2);
assert.equal(initialSnapshot.output.status, "available");
assert.equal(initialSnapshot.output.devices.length, 2);
assert.equal(initialSnapshot.preferredInputDeviceId, null);
assert.equal(initialSnapshot.resolvedInputDeviceId, null);
assert.equal(initialSnapshot.inputResolution, "system-default");
assert.equal(initialSnapshot.preferredOutputDeviceId, null);
assert.equal(initialSnapshot.resolvedOutputDeviceId, null);
assert.equal(initialSnapshot.outputResolution, "system-default");
assert.equal(initialSnapshot.outputSelectionSupported, true);
assert.equal(initialSnapshot.outputSelectionStatus, "supported");
assert.equal(initialSnapshot.controlsSystemTts, false);
assert.equal(initialSnapshot.appliesTo, "future-operations");

// 2. Selecting a connected device resolves as "preferred"
service.savePreferences({ preferredInputDeviceId: "mic-usb", preferredOutputDeviceId: "speaker-usb" });
const activeSnapshot = service.snapshot();
assert.equal(activeSnapshot.preferredInputDeviceId, "mic-usb");
assert.equal(activeSnapshot.resolvedInputDeviceId, "mic-usb");
assert.equal(activeSnapshot.inputResolution, "preferred");
assert.equal(activeSnapshot.preferredOutputDeviceId, "speaker-usb");
assert.equal(activeSnapshot.resolvedOutputDeviceId, "speaker-usb");
assert.equal(activeSnapshot.outputResolution, "preferred");

// 3. Disconnected preferred device preserves preference while falling back to system default (outcome: "preferred-unavailable")
const disconnectedDevices: readonly VoiceDeviceDescription[] = [
  { deviceId: "mic-built-in", kind: "audioinput", label: "MacBook Pro Microphone" },
  { deviceId: "speaker-built-in", kind: "audiooutput", label: "MacBook Pro Speakers" },
];

const disconnectedService = new VoiceDeviceService({
  enumerate: async () => disconnectedDevices,
  getPreferences: () => ({ preferredInputDeviceId: "mic-usb", preferredOutputDeviceId: "speaker-usb" }),
  outputSelectionSupported: true,
});

const disconnectedSnapshot = await disconnectedService.refresh();
assert.equal(disconnectedSnapshot.preferredInputDeviceId, "mic-usb", "durable preference is preserved");
assert.equal(disconnectedSnapshot.resolvedInputDeviceId, null, "routing falls back to system default");
assert.equal(disconnectedSnapshot.inputResolution, "preferred-unavailable", "outcome reflects disconnected fallback");
assert.equal(disconnectedSnapshot.preferredOutputDeviceId, "speaker-usb", "durable output preference is preserved");
assert.equal(disconnectedSnapshot.resolvedOutputDeviceId, null, "routing falls back to system default");
assert.equal(disconnectedSnapshot.outputResolution, "preferred-unavailable", "outcome reflects disconnected fallback");

// 4. Unsupported output selection environment correctly signals non-actionable state
const unsupportedService = new VoiceDeviceService({
  enumerate: async () => devices,
  outputSelectionSupported: false,
});

const unsupportedSnapshot = await unsupportedService.refresh();
assert.equal(unsupportedSnapshot.outputSelectionSupported, false);
assert.equal(unsupportedSnapshot.outputSelectionStatus, "unsupported");
assert.equal(unsupportedSnapshot.controlsSystemTts, false);

// 5. Output capability unavailable is cleanly separated from device enumeration status
// Case A: Capability probe returns "unavailable", while device enumeration succeeds
const capabilityUnavailableService = new VoiceDeviceService({
  enumerate: async () => devices,
  probeOutputSelection: async () => "unavailable",
});

const capUnavailableSnapshot = await capabilityUnavailableService.refresh();
assert.equal(capUnavailableSnapshot.outputSelectionSupported, false);
assert.equal(capUnavailableSnapshot.outputSelectionStatus, "unavailable", "capability is undetermined");
assert.equal(capUnavailableSnapshot.output.status, "available", "output devices were successfully enumerated");
assert.equal(capUnavailableSnapshot.output.devices.length, 2, "device list is populated");
assert.equal(capUnavailableSnapshot.input.status, "available");

// Case B: Capability is supported, but device enumeration fails/times out
const enumerationFailedService = new VoiceDeviceService({
  enumerate: async () => { throw new Error("Audio hardware enumeration failed"); },
  outputSelectionSupported: true,
});

const enumFailedSnapshot = await enumerationFailedService.refresh();
assert.equal(enumFailedSnapshot.outputSelectionSupported, true, "capability remains supported");
assert.equal(enumFailedSnapshot.outputSelectionStatus, "supported");
assert.equal(enumFailedSnapshot.output.status, "unavailable", "output enumeration status reflects failure");
assert.equal(enumFailedSnapshot.output.devices.length, 0, "no output devices available");
assert.equal(enumFailedSnapshot.input.status, "unavailable", "input enumeration status reflects failure");
assert.equal(enumFailedSnapshot.input.devices.length, 0, "no input devices available");

// 6. Null / Failed snapshot recovery lifecycle
// When the snapshot is null prior to load or after a fetch error, consumer preserves null state
let consumerSnapshot: VoiceDevicesSnapshot | null = null;
assert.equal(consumerSnapshot, null, "snapshot is null initially before load");

// Failed fetch leaves consumer snapshot as null (triggers truthful neutral unavailable UI)
const fetchFailingApi = {
  getVoiceDevices: async (): Promise<VoiceDevicesSnapshot> => {
    throw new Error("Bridge connection failed");
  },
};

let fetchError: string | null = null;
try {
  consumerSnapshot = await fetchFailingApi.getVoiceDevices();
} catch (err: unknown) {
  fetchError = err instanceof Error ? err.message : String(err);
}
assert.equal(consumerSnapshot, null, "consumer snapshot remains null on fetch failure");
assert.equal(fetchError, "Bridge connection failed");

// Clear recovery action: Refresh succeeds and establishes a truthful snapshot
const recoveringApi = {
  refreshVoiceDevices: async (): Promise<VoiceDevicesSnapshot> => {
    return service.refresh();
  },
};

consumerSnapshot = await recoveringApi.refreshVoiceDevices();
assert.notEqual(consumerSnapshot, null, "refresh recovery successfully establishes snapshot");
assert.equal(consumerSnapshot.input.status, "available");
assert.equal(consumerSnapshot.outputSelectionStatus, "supported");

// 7. Switching back to System Default resets preferences to null
service.savePreferences({ preferredInputDeviceId: null, preferredOutputDeviceId: null });
const resetSnapshot = service.snapshot();
assert.equal(resetSnapshot.preferredInputDeviceId, null);
assert.equal(resetSnapshot.resolvedInputDeviceId, null);
assert.equal(resetSnapshot.inputResolution, "system-default");
assert.equal(resetSnapshot.preferredOutputDeviceId, null);
assert.equal(resetSnapshot.resolvedOutputDeviceId, null);
assert.equal(resetSnapshot.outputResolution, "system-default");

// 8. Control Center ownership invariant: Voice devices hardware routing belongs exclusively to Settings → General, never Providers
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const desktopRoot = process.env.OPENPETS_DESKTOP_ROOT ?? new URL("../..", import.meta.url).pathname;

// General settings module exports VoiceDevicesSection
assert.equal(existsSync(join(desktopRoot, "src/renderer/src/settings/general/VoiceDevicesSection.tsx")), true, "VoiceDevicesSection is located under settings/general");
const generalIndex = readFileSync(join(desktopRoot, "src/renderer/src/settings/general/index.ts"), "utf8");
assert.match(generalIndex, /export\s+\{\s*VoiceDevicesSection/, "settings/general exports VoiceDevicesSection");

// Providers module does NOT export VoiceDevicesSection
const providersIndex = readFileSync(join(desktopRoot, "src/renderer/src/settings/providers/index.ts"), "utf8");
assert.doesNotMatch(providersIndex, /VoiceDevicesSection/, "settings/providers does not export VoiceDevicesSection");

// ProvidersSection component does NOT contain VoiceDevicesSection JSX or voice device methods
const providersSectionSource = readFileSync(join(desktopRoot, "src/renderer/src/settings/providers/ProvidersSection.tsx"), "utf8");
assert.doesNotMatch(providersSectionSource, /VoiceDevicesSection/, "ProvidersSection does not reference VoiceDevicesSection");
assert.doesNotMatch(providersSectionSource, /getVoiceDevices|refreshVoiceDevices|saveVoiceDevicePreferences/, "ProvidersSection does not own voice device API operations");

// Main Control Center Settings shell mounts VoiceDevicesSection in General tab and not in Providers tab
const mainSource = readFileSync(join(desktopRoot, "src/renderer/src/main.tsx"), "utf8");
assert.match(mainSource, /from "\.\/settings\/general\/index\.js"/, "main.tsx imports from settings/general");
const generalTabBlock = mainSource.slice(mainSource.indexOf('activeTab === "general"'), mainSource.indexOf('activeTab === "personality"'));
assert.match(generalTabBlock, /<VoiceDevicesSection/, "VoiceDevicesSection is mounted in Settings -> General tab");

const providersTabBlock = mainSource.slice(mainSource.indexOf('activeTab === "providers"'), mainSource.indexOf('activeTab === "lan"'));
assert.doesNotMatch(providersTabBlock, /VoiceDevicesSection|voiceDevices/, "Providers tab does not contain VoiceDevicesSection");

console.log("Control Center voice devices contract and resolution behavior verified.");
