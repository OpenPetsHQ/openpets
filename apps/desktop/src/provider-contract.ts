/**
 * The provider contract is deliberately platform-neutral.  Keep this module
 * safe to import from the renderer and from persisted-settings tooling.
 */

export type ProviderRole = "text" | "stt" | "tts";

export type ProviderAdapter =
  | "openai-compatible-text"
  | "openai-realtime"
  | "anthropic-text"
  | "openai-compatible-transcription"
  | "elevenlabs-transcription"
  | "system-tts"
  | "minimax-tts"
  | "elevenlabs-tts"
  | "openai-compatible-speech";

export type ProviderCredentialPolicy = "required" | "optional" | "none";
export type ProviderAuth = { readonly headerName: string; readonly strategy: "bearer" | "raw" };

export type ProviderHeader = { readonly name: string; readonly value: string };
export type ProviderHeaderPatch =
  | { readonly op: "add"; readonly name: string; readonly value: string }
  | { readonly op: "replace"; readonly oldName: string; readonly name: string; readonly value: string }
  | { readonly op: "delete"; readonly name: string };

type ProviderProfileBase = {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly secretRef?: string;
  readonly auth?: ProviderAuth;
  readonly headers?: readonly ProviderHeader[];
};

export type OpenAiCompatibleTextProfile = ProviderProfileBase & {
  readonly adapter: "openai-compatible-text";
  readonly voice?: never;
};

export type OpenAiRealtimeProfile = ProviderProfileBase & {
  readonly adapter: "openai-realtime";
  /** Model used by normal Pet Assistant text turns. */
  readonly model: string;
  /** Independent model used for WebRTC realtime negotiation. */
  readonly realtimeModel: string;
  readonly voice?: never;
};

export type AnthropicTextProfile = ProviderProfileBase & {
  readonly adapter: "anthropic-text";
  readonly voice?: never;
};

export type OpenAiCompatibleTranscriptionProfile = ProviderProfileBase & {
  readonly adapter: "openai-compatible-transcription";
  readonly voice?: never;
};

export type ElevenLabsTranscriptionProfile = ProviderProfileBase & {
  readonly adapter: "elevenlabs-transcription";
  readonly voice?: never;
};

export type SystemTtsProfile = {
  readonly id: string;
  readonly label: string;
  readonly adapter: "system-tts";
  readonly model: "";
  readonly baseUrl?: never;
  readonly secretRef?: never;
  readonly auth?: never;
  readonly headers?: never;
  /** Optional installed operating-system voice name; absent means system default. */
  readonly voice?: string;
};

export type MinimaxTtsProfile = ProviderProfileBase & {
  readonly adapter: "minimax-tts";
  readonly voice: string;
};

export type ElevenLabsTtsProfile = ProviderProfileBase & {
  readonly adapter: "elevenlabs-tts";
  readonly voice: string;
};

export type OpenAiCompatibleSpeechProfile = ProviderProfileBase & {
  readonly adapter: "openai-compatible-speech";
  readonly voice: string;
};

/** Exhaustive provider profile union. */
export type ProviderProfile =
  | OpenAiCompatibleTextProfile
  | OpenAiRealtimeProfile
  | AnthropicTextProfile
  | OpenAiCompatibleTranscriptionProfile
  | ElevenLabsTranscriptionProfile
  | SystemTtsProfile
  | MinimaxTtsProfile
  | ElevenLabsTtsProfile
  | OpenAiCompatibleSpeechProfile;

export type ProviderAdapterDefinition = {
  readonly adapter: ProviderAdapter;
  readonly roles: readonly ProviderRole[];
  readonly credentialPolicy: ProviderCredentialPolicy;
  readonly requiresBaseUrl: boolean;
  readonly defaultAuth?: ProviderAuth;
  readonly defaultModel?: string;
  readonly defaultRealtimeModel?: string;
  readonly defaultVoice?: string;
};

export const providerCatalog: Readonly<Record<ProviderAdapter, ProviderAdapterDefinition>> = Object.freeze({
  "openai-compatible-text": { adapter: "openai-compatible-text", roles: ["text"], credentialPolicy: "optional", requiresBaseUrl: true, defaultAuth: { headerName: "authorization", strategy: "bearer" } },
  "openai-realtime": { adapter: "openai-realtime", roles: ["text"], credentialPolicy: "required", requiresBaseUrl: true, defaultAuth: { headerName: "authorization", strategy: "bearer" }, defaultModel: "gpt-4o-mini", defaultRealtimeModel: "gpt-realtime-2.1" },
  "anthropic-text": { adapter: "anthropic-text", roles: ["text"], credentialPolicy: "required", requiresBaseUrl: true, defaultAuth: { headerName: "x-api-key", strategy: "raw" } },
  "openai-compatible-transcription": { adapter: "openai-compatible-transcription", roles: ["stt"], credentialPolicy: "optional", requiresBaseUrl: true, defaultAuth: { headerName: "authorization", strategy: "bearer" }, defaultModel: "whisper-1" },
  "elevenlabs-transcription": { adapter: "elevenlabs-transcription", roles: ["stt"], credentialPolicy: "required", requiresBaseUrl: true, defaultAuth: { headerName: "xi-api-key", strategy: "raw" }, defaultModel: "scribe_v2" },
  "system-tts": { adapter: "system-tts", roles: ["tts"], credentialPolicy: "none", requiresBaseUrl: false },
  "minimax-tts": { adapter: "minimax-tts", roles: ["tts"], credentialPolicy: "required", requiresBaseUrl: true, defaultAuth: { headerName: "authorization", strategy: "bearer" }, defaultModel: "speech-2.8-turbo", defaultVoice: "English_expressive_narrator" },
  "elevenlabs-tts": { adapter: "elevenlabs-tts", roles: ["tts"], credentialPolicy: "required", requiresBaseUrl: true, defaultAuth: { headerName: "xi-api-key", strategy: "raw" }, defaultModel: "eleven_flash_v2_5", defaultVoice: "od84OdVweqzO3t6kKlWT" },
  "openai-compatible-speech": { adapter: "openai-compatible-speech", roles: ["tts"], credentialPolicy: "optional", requiresBaseUrl: true, defaultAuth: { headerName: "authorization", strategy: "bearer" }, defaultModel: "tts-1", defaultVoice: "alloy" },
});

export type ProviderPresetCredentialMode = "required" | "none";
export type ProviderPreset = {
  readonly id: string;
  readonly label: string;
  readonly adapter: ProviderAdapter;
  readonly model: string;
  readonly baseUrl?: string;
  readonly realtimeModel?: string;
  readonly voice?: string;
  /** Setup hint; runtime readiness is controlled by providerCatalog. */
  readonly credentialMode: ProviderPresetCredentialMode;
  readonly suggestedHeaders?: readonly ProviderHeader[];
};

export const providerPresets: readonly ProviderPreset[] = Object.freeze([
  { id: "openrouter", label: "OpenRouter", adapter: "openai-compatible-text", model: "openai/gpt-4o-mini", baseUrl: "https://openrouter.ai/api/v1", credentialMode: "required", suggestedHeaders: [{ name: "HTTP-Referer", value: "https://openpets.dev" }, { name: "X-Title", value: "OpenPets Desktop" }] },
  { id: "openai", label: "OpenAI", adapter: "openai-realtime", model: "gpt-4o-mini", realtimeModel: "gpt-realtime-2.1", baseUrl: "https://api.openai.com/v1", credentialMode: "required" },
  { id: "anthropic", label: "Anthropic", adapter: "anthropic-text", model: "claude-haiku-4-5-20251001", baseUrl: "https://api.anthropic.com", credentialMode: "required" },
  { id: "ollama", label: "Ollama", adapter: "openai-compatible-text", model: "llama3.2", baseUrl: "http://127.0.0.1:11434/v1", credentialMode: "none" },
  { id: "lm-studio", label: "LM Studio", adapter: "openai-compatible-text", model: "local-model", baseUrl: "http://127.0.0.1:1234/v1", credentialMode: "none" },
  { id: "vllm", label: "vLLM", adapter: "openai-compatible-text", model: "local-model", baseUrl: "http://127.0.0.1:8000/v1", credentialMode: "none" },
  { id: "minimax-chat", label: "MiniMax chat", adapter: "openai-compatible-text", model: "MiniMax-M3", baseUrl: "https://api.minimax.io/v1", credentialMode: "required" },
  { id: "whisper", label: "Whisper-compatible STT", adapter: "openai-compatible-transcription", model: "whisper-1", baseUrl: "https://api.openai.com/v1", credentialMode: "required" },
  { id: "elevenlabs-scribe", label: "ElevenLabs Scribe STT", adapter: "elevenlabs-transcription", model: "scribe_v2", baseUrl: "https://api.elevenlabs.io/v1", credentialMode: "required" },
  { id: "elevenlabs", label: "ElevenLabs TTS", adapter: "elevenlabs-tts", model: "eleven_flash_v2_5", voice: "od84OdVweqzO3t6kKlWT", baseUrl: "https://api.elevenlabs.io/v1", credentialMode: "required" },
  { id: "system-tts", label: "System voice", adapter: "system-tts", model: "", credentialMode: "none" },
]);

export function providerDefinition(adapter: ProviderAdapter): ProviderAdapterDefinition {
  return providerCatalog[adapter];
}

export function defaultProviderAuth(adapter: ProviderAdapter): ProviderAuth {
  const auth = providerCatalog[adapter].defaultAuth;
  if (!auth) throw new Error(`Provider adapter ${adapter} does not use network authentication.`);
  return auth;
}

export function providerSupportsRole(adapter: ProviderAdapter, role: ProviderRole): boolean {
  return providerCatalog[adapter].roles.includes(role);
}
