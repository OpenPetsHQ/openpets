import type { ProviderAdapter } from "./types.js";

export type CuratedVoice = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

export const ELEVENLABS_VOICES: readonly CuratedVoice[] = Object.freeze([
  { id: "od84OdVweqzO3t6kKlWT", label: "Pete" },
  { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel", description: "Calm & friendly" },
  { id: "AZnzlk1XvdvUeBnXmlld", label: "Domi", description: "Strong & expressive" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Bella", description: "Warm & natural" },
  { id: "ErXwobaYiN019PkySvjV", label: "Antoni", description: "Soft & pleasant" },
  { id: "MF3mGyEYCl7XYWbV9V6O", label: "Elli", description: "Youthful & lively" },
  { id: "TxGEqnHWrfWFTfGW9XjX", label: "Josh", description: "Deep & resonant" },
  { id: "VR6AewLTigWG4xSOukaG", label: "Arnold", description: "Crisp & clear" },
  { id: "pNInz6obpgDQGcFmaJgB", label: "Adam", description: "Warm narration" },
]);

export const OPENAI_SPEECH_VOICES: readonly CuratedVoice[] = Object.freeze([
  { id: "alloy", label: "Alloy", description: "Neutral & balanced" },
  { id: "echo", label: "Echo", description: "Warm & rounded" },
  { id: "fable", label: "Fable", description: "Expressive & dynamic" },
  { id: "onyx", label: "Onyx", description: "Deep & authoritative" },
  { id: "nova", label: "Nova", description: "Bright & energetic" },
  { id: "shimmer", label: "Shimmer", description: "Clear & melodic" },
  { id: "ash", label: "Ash", description: "Subtle & gentle" },
  { id: "coral", label: "Coral", description: "Warm & conversational" },
  { id: "sage", label: "Sage", description: "Calm & thoughtful" },
]);

export const MINIMAX_VOICES: readonly CuratedVoice[] = Object.freeze([
  { id: "English_expressive_narrator", label: "Expressive Narrator", description: "Expressive English" },
  { id: "English_gentle_storyteller", label: "Gentle Storyteller", description: "Gentle narration" },
  { id: "English_lively_youth", label: "Lively Youth", description: "Young & energetic" },
  { id: "English_warm_companion", label: "Warm Companion", description: "Warm companion" },
  { id: "Japanese_sweet_companion", label: "Sweet Companion (JA)", description: "Japanese conversational" },
  { id: "Chinese_expressive_narrator", label: "Expressive Narrator (ZH)", description: "Chinese expressive" },
]);

export function isTtsAdapter(adapter: ProviderAdapter): boolean {
  return (
    adapter === "system-tts" ||
    adapter === "elevenlabs-tts" ||
    adapter === "openai-compatible-speech" ||
    adapter === "minimax-tts"
  );
}

export function getCuratedVoicesForAdapter(adapter: ProviderAdapter): readonly CuratedVoice[] {
  switch (adapter) {
    case "elevenlabs-tts":
      return ELEVENLABS_VOICES;
    case "openai-compatible-speech":
      return OPENAI_SPEECH_VOICES;
    case "minimax-tts":
      return MINIMAX_VOICES;
    case "system-tts":
    default:
      return [];
  }
}

export function getDefaultVoiceForAdapter(adapter: ProviderAdapter): string {
  switch (adapter) {
    case "elevenlabs-tts":
      return ELEVENLABS_VOICES[0]?.id ?? "od84OdVweqzO3t6kKlWT";
    case "openai-compatible-speech":
      return OPENAI_SPEECH_VOICES[0]?.id ?? "alloy";
    case "minimax-tts":
      return MINIMAX_VOICES[0]?.id ?? "English_expressive_narrator";
    case "system-tts":
    default:
      return "";
  }
}

export function isKnownCuratedVoice(adapter: ProviderAdapter, voiceId?: string): boolean {
  if (!voiceId) return false;
  const curated = getCuratedVoicesForAdapter(adapter);
  return curated.some((voice) => voice.id === voiceId);
}

export function getVoiceDisplayLabel(adapter: ProviderAdapter, voiceId?: string): string {
  if (!voiceId || voiceId.trim() === "") {
    return adapter === "system-tts" ? "System Default" : "Default Voice";
  }
  const curated = getCuratedVoicesForAdapter(adapter);
  const found = curated.find((voice) => voice.id === voiceId);
  if (found) {
    return found.label;
  }
  return voiceId;
}

export function getVoiceFieldLabelKey(adapter: ProviderAdapter): string {
  switch (adapter) {
    case "elevenlabs-tts":
    case "minimax-tts":
      return "settings.providers.field.voiceId";
    case "openai-compatible-speech":
      return "settings.providers.field.voiceName";
    case "system-tts":
    default:
      return "settings.providers.field.voice";
  }
}

export function getVoicePlaceholderKey(adapter: ProviderAdapter): string {
  switch (adapter) {
    case "elevenlabs-tts":
      return "settings.providers.field.voiceElevenLabsPlaceholder";
    case "minimax-tts":
      return "settings.providers.field.voiceMiniMaxPlaceholder";
    case "openai-compatible-speech":
      return "settings.providers.field.voiceOpenAiPlaceholder";
    case "system-tts":
    default:
      return "settings.providers.field.voiceCustomSystemPlaceholder";
  }
}

export function getVoiceHintKey(adapter: ProviderAdapter): string {
  switch (adapter) {
    case "elevenlabs-tts":
      return "settings.providers.field.voiceElevenLabsHint";
    case "minimax-tts":
      return "settings.providers.field.voiceMiniMaxHint";
    case "openai-compatible-speech":
      return "settings.providers.field.voiceOpenAiHint";
    case "system-tts":
    default:
      return "settings.providers.field.voiceSystemHint";
  }
}
