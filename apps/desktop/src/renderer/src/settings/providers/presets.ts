import type { ProviderAdapter, ProviderHeader } from "./types.js";

export type PresetCategory = "cloud-text" | "cloud-realtime" | "local-text" | "cloud-stt" | "cloud-tts" | "local-tts" | "custom";

export type ProviderPresetItem = {
  readonly id: string;
  readonly label: string;
  readonly adapter: ProviderAdapter;
  readonly model: string;
  readonly baseUrl?: string;
  readonly credentialMode: "required" | "none";
  readonly category: PresetCategory;
  readonly suggestedHeaders?: readonly ProviderHeader[];
};

export const PROVIDER_PRESETS: readonly ProviderPresetItem[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    adapter: "openai-compatible-text",
    model: "openai/gpt-4o-mini",
    baseUrl: "https://openrouter.ai/api/v1",
    credentialMode: "required",
    category: "cloud-text",
    suggestedHeaders: [
      { name: "HTTP-Referer", value: "https://openpets.dev" },
      { name: "X-Title", value: "OpenPets Desktop" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI Realtime & Text",
    adapter: "openai-realtime",
    model: "gpt-realtime-2.1",
    baseUrl: "https://api.openai.com/v1",
    credentialMode: "required",
    category: "cloud-realtime",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    adapter: "anthropic-text",
    model: "claude-haiku-4-5-20251001",
    baseUrl: "https://api.anthropic.com",
    credentialMode: "required",
    category: "cloud-text",
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    adapter: "openai-compatible-text",
    model: "llama3.2",
    baseUrl: "http://127.0.0.1:11434/v1",
    credentialMode: "none",
    category: "local-text",
  },
  {
    id: "lm-studio",
    label: "LM Studio (Local)",
    adapter: "openai-compatible-text",
    model: "local-model",
    baseUrl: "http://127.0.0.1:1234/v1",
    credentialMode: "none",
    category: "local-text",
  },
  {
    id: "vllm",
    label: "vLLM (Local / Self-hosted)",
    adapter: "openai-compatible-text",
    model: "local-model",
    baseUrl: "http://127.0.0.1:8000/v1",
    credentialMode: "none",
    category: "local-text",
  },
  {
    id: "minimax-chat",
    label: "MiniMax Chat",
    adapter: "openai-compatible-text",
    model: "MiniMax-M3",
    baseUrl: "https://api.minimax.io/v1",
    credentialMode: "required",
    category: "cloud-text",
  },
  {
    id: "whisper",
    label: "Whisper STT",
    adapter: "openai-compatible-transcription",
    model: "whisper-1",
    baseUrl: "https://api.openai.com/v1",
    credentialMode: "required",
    category: "cloud-stt",
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs Voice",
    adapter: "elevenlabs-tts",
    model: "eleven_multilingual_v2",
    baseUrl: "https://api.elevenlabs.io/v1",
    credentialMode: "required",
    category: "cloud-tts",
  },
  {
    id: "system-tts",
    label: "System Voice (Local)",
    adapter: "system-tts",
    model: "",
    baseUrl: undefined,
    credentialMode: "none",
    category: "local-tts",
  },
  {
    id: "custom",
    label: "Custom Endpoint",
    adapter: "openai-compatible-text",
    model: "custom-model",
    baseUrl: "https://api.example.com/v1",
    credentialMode: "required",
    category: "custom",
  },
] as const;

export function getPresetById(id: string): ProviderPresetItem | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}

export function generateRandomProfileId(prefix = "provider"): string {
  const cleanPrefix = prefix.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 16);
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `${cleanPrefix}-${randomSuffix}`;
}
