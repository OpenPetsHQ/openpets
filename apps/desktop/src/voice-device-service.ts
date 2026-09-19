import {
  classifyVoiceDeviceAvailability,
  normalizeEnumeratedVoiceDevices,
  normalizeVoiceDeviceId,
  resolveVoiceInputDevice,
  resolveVoiceOutputDevice,
  type VoiceDeviceAvailability,
  type VoiceDeviceDescription,
  type VoiceDeviceKind,
  type VoiceInputResolution,
  type VoiceOutputResolution,
} from "./voice-device-resolver.js";

export const VOICE_MEDIA_PARTITION = "persist:openpets-voice-media";
export const VOICE_DEVICE_ENUMERATION_TIMEOUT_MS = 2_000;
export const VOICE_OUTPUT_PROBE_TIMEOUT_MS = 2_000;

export type VoiceOutputSelectionStatus = "supported" | "unsupported" | "unavailable";

export type VoiceDevicesSnapshot = {
  readonly input: { readonly status: VoiceDeviceAvailability; readonly devices: readonly VoiceDeviceDescription[] };
  readonly output: { readonly status: VoiceDeviceAvailability; readonly devices: readonly VoiceDeviceDescription[] };
  readonly preferredInputDeviceId: string | null;
  readonly preferredOutputDeviceId: string | null;
  readonly resolvedInputDeviceId: string | null;
  readonly inputResolution: VoiceInputResolution["outcome"];
  readonly resolvedOutputDeviceId: string | null;
  readonly outputResolution: VoiceOutputResolution["outcome"];
  readonly outputSelectionSupported: boolean;
  readonly outputSelectionStatus: VoiceOutputSelectionStatus;
  readonly controlsSystemTts: false;
  readonly appliesTo: "future-operations";
};

export type VoiceDeviceOperationSnapshot = Readonly<{
  readonly inputDeviceId: string | null;
  readonly preferredInputDeviceId: string | null;
  readonly inputResolution: VoiceInputResolution["outcome"];
  readonly outputDeviceId: string | null;
  readonly preferredOutputDeviceId: string | null;
  readonly outputResolution: VoiceOutputResolution["outcome"];
}>;

export type VoiceDeviceServiceOptions = {
  readonly enumerate?: (signal?: AbortSignal) => Promise<readonly VoiceDeviceDescription[]>;
  readonly getPreferences?: () => { readonly preferredInputDeviceId: string | null; readonly preferredOutputDeviceId: string | null };
  readonly savePreferences?: (preferences: { readonly preferredInputDeviceId?: string | null; readonly preferredOutputDeviceId?: string | null }) => void;
  readonly enumerationTimeoutMs?: number;
  readonly outputProbeTimeoutMs?: number;
  readonly probeOutputSelection?: (signal?: AbortSignal) => Promise<VoiceOutputSelectionStatus>;
  /** Test seam for a trusted probe result; production supplies probeOutputSelection. */
  readonly outputSelectionSupported?: boolean;
};

export class VoiceDeviceService {
  readonly #enumerate: (signal?: AbortSignal) => Promise<readonly VoiceDeviceDescription[]>;
  readonly #enumerationTimeoutMs: number;
  readonly #outputProbeTimeoutMs: number;
  readonly #probeOutputSelection?: VoiceDeviceServiceOptions["probeOutputSelection"];
  #getPreferences?: VoiceDeviceServiceOptions["getPreferences"];
  #savePreferences?: VoiceDeviceServiceOptions["savePreferences"];
  #snapshot: VoiceDevicesSnapshot;
  #outputSelectionStatus: VoiceOutputSelectionStatus;

  constructor(options: VoiceDeviceServiceOptions = {}) {
    this.#enumerate = options.enumerate ?? (async () => []);
    this.#enumerationTimeoutMs = options.enumerationTimeoutMs ?? VOICE_DEVICE_ENUMERATION_TIMEOUT_MS;
    this.#outputProbeTimeoutMs = options.outputProbeTimeoutMs ?? VOICE_OUTPUT_PROBE_TIMEOUT_MS;
    this.#probeOutputSelection = options.probeOutputSelection;
    this.#outputSelectionStatus = options.outputSelectionSupported === undefined
      ? "unavailable"
      : options.outputSelectionSupported ? "supported" : "unsupported";
    this.#getPreferences = options.getPreferences;
    this.#savePreferences = options.savePreferences;
    this.#snapshot = this.#buildSnapshot([]);
  }

  configure(options: Pick<VoiceDeviceServiceOptions, "getPreferences" | "savePreferences">): void {
    this.#getPreferences = options.getPreferences;
    this.#savePreferences = options.savePreferences;
    this.#snapshot = this.#buildSnapshot(this.#snapshot.input.devices.concat(this.#snapshot.output.devices));
  }

  snapshot(): VoiceDevicesSnapshot { return this.#snapshot; }

  async refresh(signal?: AbortSignal): Promise<VoiceDevicesSnapshot> {
    const enumeration = this.#enumerateWithDeadline(signal)
      .then((devices) => ({ devices: normalizeEnumeratedVoiceDevices(devices), failed: false }))
      .catch((error: unknown) => {
        if (signal?.aborted) throw error;
        return { devices: [] as readonly VoiceDeviceDescription[], failed: true };
      });
    const outputProbe = this.#probeOutputWithDeadline(signal)
      .catch((error: unknown) => {
        if (signal?.aborted) throw error;
        return "unavailable" as const;
      });
    const [enumerated, outputSelectionStatus] = await Promise.all([enumeration, outputProbe]);
    this.#outputSelectionStatus = outputSelectionStatus;
    this.#snapshot = this.#buildSnapshot(enumerated.devices, enumerated.failed);
    return this.#snapshot;
  }

  async snapshotOperation(signal?: AbortSignal): Promise<VoiceDeviceOperationSnapshot> {
    const snapshot = await this.refresh(signal);
    return Object.freeze({
      inputDeviceId: snapshot.resolvedInputDeviceId,
      preferredInputDeviceId: snapshot.preferredInputDeviceId,
      inputResolution: snapshot.inputResolution,
      outputDeviceId: snapshot.resolvedOutputDeviceId,
      preferredOutputDeviceId: snapshot.preferredOutputDeviceId,
      outputResolution: snapshot.outputResolution,
    });
  }

  async #enumerateWithDeadline(signal?: AbortSignal): Promise<readonly VoiceDeviceDescription[]> {
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | null = null;
    let abortListener: (() => void) | null = null;
    const enumeration = Promise.resolve().then(() => this.#enumerate(controller.signal));
    const cancellation = new Promise<never>((_resolve, reject) => {
      abortListener = () => {
        controller.abort();
        reject(new Error("Voice device enumeration was cancelled."));
      };
      if (signal?.aborted) abortListener();
      else signal?.addEventListener("abort", abortListener, { once: true });
    });
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("Voice device enumeration timed out."));
      }, this.#enumerationTimeoutMs);
    });
    try {
      return await Promise.race([enumeration, cancellation, deadline]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (abortListener && signal) signal.removeEventListener("abort", abortListener);
    }
  }

  async #probeOutputWithDeadline(signal?: AbortSignal): Promise<VoiceOutputSelectionStatus> {
    if (!this.#probeOutputSelection) return this.#outputSelectionStatus;
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | null = null;
    let abortListener: (() => void) | null = null;
    const probe = Promise.resolve().then(() => this.#probeOutputSelection!(controller.signal));
    const cancellation = new Promise<never>((_resolve, reject) => {
      abortListener = () => {
        controller.abort();
        reject(new Error("Voice output capability probe was cancelled."));
      };
      if (signal?.aborted) abortListener();
      else signal?.addEventListener("abort", abortListener, { once: true });
    });
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("Voice output capability probe timed out."));
      }, this.#outputProbeTimeoutMs);
    });
    try {
      return await Promise.race([probe, cancellation, deadline]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (abortListener && signal) signal.removeEventListener("abort", abortListener);
    }
  }

  savePreferences(preferences: { readonly preferredInputDeviceId?: string | null; readonly preferredOutputDeviceId?: string | null }): VoiceDevicesSnapshot {
    if (!this.#savePreferences) throw new Error("Voice device preferences are not configured.");
    this.#savePreferences(preferences);
    this.#snapshot = this.#buildSnapshot(this.#snapshot.input.devices.concat(this.#snapshot.output.devices));
    return this.#snapshot;
  }

  #buildSnapshot(devices: readonly VoiceDeviceDescription[], enumerationFailed = false): VoiceDevicesSnapshot {
    const rawPreferences = this.#getPreferences?.() ?? readVoiceDevicePreferences();
    const preferences = {
      preferredInputDeviceId: normalizeVoiceDeviceId(rawPreferences.preferredInputDeviceId),
      preferredOutputDeviceId: normalizeVoiceDeviceId(rawPreferences.preferredOutputDeviceId),
    };
    const inputResolution = resolveVoiceInputDevice(devices, preferences.preferredInputDeviceId);
    const outputResolution = resolveVoiceOutputDevice(devices, preferences.preferredOutputDeviceId);
    const input = devices.filter((device) => device.kind === "audioinput");
    const output = devices.filter((device) => device.kind === "audiooutput");
    return Object.freeze({
      input: Object.freeze({ status: classifyVoiceDeviceAvailability(devices, "audioinput", enumerationFailed), devices: Object.freeze(input) }),
      output: Object.freeze({ status: classifyVoiceDeviceAvailability(devices, "audiooutput", enumerationFailed), devices: Object.freeze(output) }),
      preferredInputDeviceId: preferences.preferredInputDeviceId,
      preferredOutputDeviceId: preferences.preferredOutputDeviceId,
      resolvedInputDeviceId: inputResolution.inputDeviceId,
      inputResolution: inputResolution.outcome,
      resolvedOutputDeviceId: outputResolution.outputDeviceId,
      outputResolution: outputResolution.outcome,
       outputSelectionSupported: this.#outputSelectionStatus === "supported",
       outputSelectionStatus: this.#outputSelectionStatus,
      controlsSystemTts: false as const,
      appliesTo: "future-operations" as const,
    });
  }
}

function readVoiceDevicePreferences(): { readonly preferredInputDeviceId: string | null; readonly preferredOutputDeviceId: string | null } {
  return { preferredInputDeviceId: null, preferredOutputDeviceId: null };
}

let sharedVoiceDeviceService: VoiceDeviceService | null = null;

export function getSharedVoiceDeviceService(options?: VoiceDeviceServiceOptions): VoiceDeviceService {
  if (!sharedVoiceDeviceService) sharedVoiceDeviceService = new VoiceDeviceService(options);
  else if (options?.getPreferences || options?.savePreferences) sharedVoiceDeviceService.configure(options);
  return sharedVoiceDeviceService;
}
