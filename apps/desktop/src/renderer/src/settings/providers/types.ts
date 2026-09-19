export type ProviderRole = "text" | "stt" | "tts";

export type ProviderAdapter =
  | "openai-compatible-text"
  | "openai-realtime"
  | "anthropic-text"
  | "openai-compatible-transcription"
  | "system-tts"
  | "minimax-tts"
  | "elevenlabs-tts"
  | "openai-compatible-speech";

export type ProviderHeader = {
  readonly name: string;
  readonly value: string;
};

export type ProviderHeaderPatch =
  | { readonly op: "add"; readonly name: string; readonly value: string }
  | { readonly op: "replace"; readonly oldName: string; readonly name: string; readonly value: string }
  | { readonly op: "delete"; readonly name: string };

export type ProviderAuth = {
  readonly headerName: string;
  readonly strategy: "bearer" | "raw";
};

export type ProviderProfileSummary = {
  readonly id: string;
  readonly label: string;
  readonly adapter: ProviderAdapter;
  readonly model: string;
  readonly baseUrl?: string;
  readonly secretRef?: string;
  readonly auth?: ProviderAuth;
  readonly headerNames: readonly string[];
  readonly hasCredential: boolean;
};

export type ProviderSelections = {
  readonly text: string | null;
  readonly stt: string | null;
  readonly tts: string | null;
};

export type ProviderStatusState = "ready" | "disabled" | "invalid" | "missing-secret" | "unsupported";

export type ProviderStatus = {
  readonly role: ProviderRole | "realtime";
  readonly state: ProviderStatusState;
  readonly code: string;
  readonly message: string;
  readonly profileId?: string;
};

export type ProviderPreset = {
  readonly id: string;
  readonly label: string;
  readonly adapter: ProviderAdapter;
  readonly model: string;
  readonly baseUrl?: string;
  readonly credentialMode: "required" | "none";
};

export type ProviderGates = {
  readonly allowPluginAudio: boolean;
  readonly allowDynamicSpeech: boolean;
  readonly allowPluginVoice: boolean;
  readonly allowMicrophone: boolean;
  readonly quietHours: {
    readonly enabled: boolean;
    readonly start: string;
    readonly end: string;
  };
};

export type ProviderGatesPatch = Partial<Omit<ProviderGates, "quietHours">> & {
  readonly quietHours?: Partial<ProviderGates["quietHours"]>;
};

export type ProviderControlCenterSnapshot = {
  readonly gates: ProviderGates;
  readonly profiles: readonly ProviderProfileSummary[];
  readonly selections: ProviderSelections;
  readonly statuses: Readonly<Record<ProviderRole | "realtime", ProviderStatus>>;
  readonly presets: readonly ProviderPreset[];
};

export type ProviderProfileInput = {
  id: string;
  label: string;
  adapter: ProviderAdapter;
  model: string;
  baseUrl?: string;
  secretRef?: string;
  auth?: ProviderAuth;
  headers?: ProviderHeader[];
};

export type ProviderProfilePatch = {
  id?: string;
  label?: string;
  adapter?: ProviderAdapter;
  model?: string;
  baseUrl?: string | null;
  secretRef?: string | null;
  auth?: ProviderAuth | null;
  headers?: ProviderHeader[];
  headerPatch?: ProviderHeaderPatch[];
};

export type ProviderConfigurationSaveInput = {
  readonly isEditing: boolean;
  readonly profileId: string;
  readonly payload: ProviderProfileInput | ProviderProfilePatch;
  readonly credentialValue?: string;
  readonly activatedRoles: readonly ProviderRole[];
  readonly deactivatedRoles: readonly ProviderRole[];
};

export function profileSupportsRole(profile: { adapter: ProviderAdapter }, role: ProviderRole): boolean {
  if (role === "text") {
    return (
      profile.adapter === "openai-compatible-text" ||
      profile.adapter === "openai-realtime" ||
      profile.adapter === "anthropic-text"
    );
  }
  if (role === "stt") {
    return profile.adapter === "openai-compatible-transcription";
  }
  return (
    profile.adapter === "system-tts" ||
    profile.adapter === "minimax-tts" ||
    profile.adapter === "elevenlabs-tts" ||
    profile.adapter === "openai-compatible-speech"
  );
}

// Role names/subtitles and adapter labels/explainers are user-facing copy and
// live in the locale catalog (`settings.providers.role.*`,
// `settings.providers.adapter.*`, `settings.providers.adapterHint.*`).

export function getDefaultAuthHeader(adapter: ProviderAdapter): string {
  if (adapter === "anthropic-text") return "x-api-key";
  if (adapter === "elevenlabs-tts") return "xi-api-key";
  return "authorization";
}

export function getDefaultAuthStrategy(adapter: ProviderAdapter): "bearer" | "raw" {
  return adapter === "anthropic-text" || adapter === "elevenlabs-tts" ? "raw" : "bearer";
}

export function isLocalOrSystemProvider(profile: {
  adapter: ProviderAdapter;
  baseUrl?: string;
  secretRef?: string;
}): boolean {
  if (profile.adapter === "system-tts") return true;
  if (!profile.secretRef) return true;
  if (profile.baseUrl) {
    const url = profile.baseUrl.toLowerCase();
    if (
      url.includes("127.0.0.1") ||
      url.includes("localhost") ||
      url.includes("::1") ||
      url.includes(".local")
    ) {
      return true;
    }
  }
  return false;
}
