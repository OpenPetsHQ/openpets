export type VoiceDeviceKind = "audioinput" | "audiooutput";

export type VoiceDeviceDescription = {
  readonly deviceId: string;
  readonly kind: VoiceDeviceKind;
  readonly label: string;
};

export type VoiceDeviceResolutionOutcome = "preferred" | "system-default" | "preferred-unavailable";

export type VoiceDeviceAvailability = "available" | "requires-permission" | "unavailable";

export type VoiceOutputSelectionStatus = "supported" | "unsupported" | "unavailable";

export type VoiceDevicesSnapshot = {
  readonly input: { readonly status: VoiceDeviceAvailability; readonly devices: readonly VoiceDeviceDescription[] };
  readonly output: { readonly status: VoiceDeviceAvailability; readonly devices: readonly VoiceDeviceDescription[] };
  readonly preferredInputDeviceId: string | null;
  readonly preferredOutputDeviceId: string | null;
  readonly resolvedInputDeviceId: string | null;
  readonly inputResolution: VoiceDeviceResolutionOutcome;
  readonly resolvedOutputDeviceId: string | null;
  readonly outputResolution: VoiceDeviceResolutionOutcome;
  readonly outputSelectionSupported: boolean;
  readonly outputSelectionStatus: VoiceOutputSelectionStatus;
  readonly controlsSystemTts: false;
  readonly appliesTo: "future-operations";
};

export type VoiceDevicePreferencesInput = {
  readonly preferredInputDeviceId?: string | null;
  readonly preferredOutputDeviceId?: string | null;
};
