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

export function getRoleDisplayName(role: ProviderRole): string {
  switch (role) {
    case "text":
      return "Pet Brain";
    case "stt":
      return "Hearing";
    case "tts":
      return "Speech";
  }
}

export function getRoleSubtitle(role: ProviderRole): string {
  switch (role) {
    case "text":
      return "Text generation, conversation & tools";
    case "stt":
      return "Speech-to-text audio input";
    case "tts":
      return "Spoken companion voice";
  }
}

export function getAdapterFriendlyLabel(adapter: ProviderAdapter): string {
  switch (adapter) {
    case "openai-compatible-text":
      return "Cloud & Local Text";
    case "openai-realtime":
      return "OpenAI Realtime Voice & Text";
    case "anthropic-text":
      return "Anthropic Claude";
    case "openai-compatible-transcription":
      return "Whisper Audio Transcription";
    case "system-tts":
      return "Built-in System Voice";
    case "minimax-tts":
      return "MiniMax Speech";
    case "elevenlabs-tts":
      return "ElevenLabs Voice";
    case "openai-compatible-speech":
      return "OpenAI Speech";
    default:
      return adapter;
  }
}

export function getAdapterExplainer(adapter: ProviderAdapter): string {
  switch (adapter) {
    case "openai-compatible-text":
      return "Compatible with OpenRouter, OpenAI, Ollama, LM Studio, vLLM, and any OpenAI-style completions API.";
    case "openai-realtime":
      return "Native bidirectional WebRTC realtime session. Powers low-latency pet audio conversations.";
    case "anthropic-text":
      return "Direct Anthropic Messages API for Claude 3.5 and 3.7 models.";
    case "openai-compatible-transcription":
      return "Converts speech from your microphone into text using Whisper-compatible endpoints.";
    case "system-tts":
      return "Uses your operating system's built-in text-to-speech. Works offline with zero configuration and no API keys.";
    case "minimax-tts":
      return "High quality neural speech synthesis from MiniMax.";
    case "elevenlabs-tts":
      return "Ultra-expressive custom voices and voice cloning from ElevenLabs.";
    case "openai-compatible-speech":
      return "OpenAI audio/speech synthesis endpoint.";
    default:
      return "";
  }
}

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
