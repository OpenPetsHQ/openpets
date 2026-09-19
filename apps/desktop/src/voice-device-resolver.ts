export type VoiceDeviceKind = "audioinput" | "audiooutput";

export type VoiceDeviceDescription = {
  readonly deviceId: string;
  readonly kind: VoiceDeviceKind;
  readonly label: string;
};

export type VoiceDeviceResolutionOutcome = "preferred" | "system-default" | "preferred-unavailable";

export type VoiceInputResolution = {
  readonly inputDeviceId: string | null;
  readonly outcome: VoiceDeviceResolutionOutcome;
};
export type VoiceOutputResolution = {
  readonly outputDeviceId: string | null;
  readonly outcome: VoiceDeviceResolutionOutcome;
};

export type VoiceDeviceAvailability = "available" | "requires-permission" | "unavailable";

export function normalizeVoiceDeviceId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  if (!value || value.length > 512 || value === "default" || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

export function resolveVoiceInputDevice(
  devices: readonly VoiceDeviceDescription[],
  preferredDeviceId: string | null,
): VoiceInputResolution {
  if (preferredDeviceId === "default") {
    return { inputDeviceId: null, outcome: "system-default" };
  }
  if (preferredDeviceId !== null && devices.some((device) => device.kind === "audioinput" && device.deviceId === preferredDeviceId && device.deviceId !== "default")) {
    return { inputDeviceId: preferredDeviceId, outcome: "preferred" };
  }
  return {
    inputDeviceId: null,
    outcome: preferredDeviceId === null ? "system-default" : "preferred-unavailable",
  };
}

export function resolveVoiceOutputDevice(
  devices: readonly VoiceDeviceDescription[],
  preferredDeviceId: string | null,
): VoiceOutputResolution {
  if (preferredDeviceId !== null && devices.some((device) => device.kind === "audiooutput" && device.deviceId === preferredDeviceId && device.deviceId !== "default")) {
    return { outputDeviceId: preferredDeviceId, outcome: "preferred" };
  }
  return {
    outputDeviceId: null,
    outcome: preferredDeviceId === null ? "system-default" : "preferred-unavailable",
  };
}

export function classifyVoiceDeviceAvailability(
  devices: readonly VoiceDeviceDescription[],
  kind: VoiceDeviceKind,
  enumerationFailed = false,
): VoiceDeviceAvailability {
  const matching = devices.filter((device) => device.kind === kind);
  if (enumerationFailed || matching.length === 0) return "unavailable";
  if (matching.some((device) => device.label.trim() !== "")) return "available";
  return "requires-permission";
}

export function normalizeEnumeratedVoiceDevices(value: readonly VoiceDeviceDescription[]): readonly VoiceDeviceDescription[] {
  const seen = new Set<string>();
  const normalized: VoiceDeviceDescription[] = [];
  for (const device of value) {
    if (!device || (device.kind !== "audioinput" && device.kind !== "audiooutput")) continue;
    const deviceId = typeof device.deviceId === "string" ? device.deviceId : "";
    if (!deviceId || deviceId === "default" || deviceId.length > 512 || /[\u0000-\u001f\u007f]/.test(deviceId) || seen.has(`${device.kind}:${deviceId}`)) continue;
    const label = typeof device.label === "string" ? device.label.slice(0, 512) : "";
    seen.add(`${device.kind}:${deviceId}`);
    normalized.push(Object.freeze({ deviceId, kind: device.kind, label }));
  }
  return Object.freeze(normalized);
}
