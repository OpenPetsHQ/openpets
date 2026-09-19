import type { ProviderAdapter, ProviderHeader, ProviderRole } from "./types.js";

export type PresetCategory = "cloud-text" | "cloud-realtime" | "local-text" | "cloud-stt" | "cloud-tts" | "local-tts" | "custom";

export type ProviderPresetItem = {
  readonly id: string;
  readonly label: string;
  readonly subtitle: string;
  readonly adapter: ProviderAdapter;
  readonly model: string;
  readonly baseUrl?: string;
  readonly credentialMode: "required" | "none";
  readonly category: PresetCategory;
  readonly badge?: string;
  readonly defaultRoles: readonly ProviderRole[];
  readonly suggestedHeaders?: readonly ProviderHeader[];
};

export const PROVIDER_PRESETS: readonly ProviderPresetItem[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    subtitle: "100+ top AI models (GPT-4o, Claude 3.7, Llama 3, DeepSeek) with low pricing",
    adapter: "openai-compatible-text",
    model: "openai/gpt-4o-mini",
    baseUrl: "https://openrouter.ai/api/v1",
    credentialMode: "required",
    category: "cloud-text",
    badge: "Recommended",
    defaultRoles: ["text"],
    suggestedHeaders: [
      { name: "HTTP-Referer", value: "https://openpets.dev" },
      { name: "X-Title", value: "OpenPets Desktop" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI Realtime & Text",
    subtitle: "Native Realtime WebRTC audio and standard text completions",
    adapter: "openai-realtime",
    model: "gpt-realtime-2.1",
    baseUrl: "https://api.openai.com/v1",
    credentialMode: "required",
    category: "cloud-realtime",
    defaultRoles: ["text"],
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    subtitle: "Direct Claude 3.5 & 3.7 models via native Messages API",
    adapter: "anthropic-text",
    model: "claude-haiku-4-5-20251001",
    baseUrl: "https://api.anthropic.com",
    credentialMode: "required",
    category: "cloud-text",
    defaultRoles: ["text"],
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    subtitle: "Private local models (Llama 3, Qwen, Mistral) running on your PC",
    adapter: "openai-compatible-text",
    model: "llama3.2",
    baseUrl: "http://127.0.0.1:11434/v1",
    credentialMode: "none",
    category: "local-text",
    badge: "Local / Free",
    defaultRoles: ["text"],
  },
  {
    id: "lm-studio",
    label: "LM Studio (Local)",
    subtitle: "Local model runner with OpenAI-compatible local server",
    adapter: "openai-compatible-text",
    model: "local-model",
    baseUrl: "http://127.0.0.1:1234/v1",
    credentialMode: "none",
    category: "local-text",
    badge: "Local / Free",
    defaultRoles: ["text"],
  },
  {
    id: "vllm",
    label: "vLLM (Local / Self-hosted)",
    subtitle: "High-performance inference engine for local and private GPUs",
    adapter: "openai-compatible-text",
    model: "local-model",
    baseUrl: "http://127.0.0.1:8000/v1",
    credentialMode: "none",
    category: "local-text",
    badge: "Local / Free",
    defaultRoles: ["text"],
  },
  {
    id: "minimax-chat",
    label: "MiniMax Chat",
    subtitle: "MiniMax M3 conversational intelligence model",
    adapter: "openai-compatible-text",
    model: "MiniMax-M3",
    baseUrl: "https://api.minimax.io/v1",
    credentialMode: "required",
    category: "cloud-text",
    defaultRoles: ["text"],
  },
  {
    id: "whisper",
    label: "Whisper STT",
    subtitle: "Accurate voice transcription for microphone input",
    adapter: "openai-compatible-transcription",
    model: "whisper-1",
    baseUrl: "https://api.openai.com/v1",
    credentialMode: "required",
    category: "cloud-stt",
    defaultRoles: ["stt"],
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs Voice",
    subtitle: "Ultra-expressive neural text-to-speech companion voices",
    adapter: "elevenlabs-tts",
    model: "eleven_multilingual_v2",
    baseUrl: "https://api.elevenlabs.io/v1",
    credentialMode: "required",
    category: "cloud-tts",
    defaultRoles: ["tts"],
  },
  {
    id: "system-tts",
    label: "System Voice (Local)",
    subtitle: "Built-in operating system speech engine. Zero setup and works offline.",
    adapter: "system-tts",
    model: "",
    baseUrl: undefined,
    credentialMode: "none",
    category: "local-tts",
    badge: "Built-in / Free",
    defaultRoles: ["tts"],
  },
  {
    id: "custom",
    label: "Custom Endpoint",
    subtitle: "Connect any compatible API gateway, proxy, or private server",
    adapter: "openai-compatible-text",
    model: "custom-model",
    baseUrl: "https://api.example.com/v1",
    credentialMode: "required",
    category: "custom",
    defaultRoles: ["text"],
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
