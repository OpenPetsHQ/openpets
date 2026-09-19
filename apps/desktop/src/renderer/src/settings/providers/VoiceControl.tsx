import { useState, useEffect } from "react";
import { useI18n } from "../../i18n.js";
import {
  getCuratedVoicesForAdapter,
  getVoiceFieldLabelKey,
  getVoiceHintKey,
  getVoicePlaceholderKey,
  isKnownCuratedVoice,
  isTtsAdapter,
} from "./voice-options.js";
import type { ProviderAdapter } from "./types.js";

export type VoiceControlProps = {
  readonly adapter: ProviderAdapter;
  readonly voice: string;
  readonly onChange: (voice: string) => void;
  readonly disabled?: boolean;
};

export function VoiceControl({
  adapter,
  voice,
  onChange,
  disabled = false,
}: VoiceControlProps) {
  const { t } = useI18n();

  const isSystem = adapter === "system-tts";
  const [systemVoices, setSystemVoices] = useState<readonly SpeechSynthesisVoice[]>([]);
  const [isCustomSystemMode, setIsCustomSystemMode] = useState(false);

  // Populate system voices from window.speechSynthesis and handle voiceschanged
  useEffect(() => {
    if (!isSystem || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    const loadVoices = () => {
      try {
        const voices = window.speechSynthesis.getVoices();
        if (Array.isArray(voices) && voices.length > 0) {
          const sorted = [...voices].sort((a, b) => {
            const nameCompare = a.name.localeCompare(b.name);
            if (nameCompare !== 0) return nameCompare;
            return a.lang.localeCompare(b.lang);
          });
          setSystemVoices(sorted);
        }
      } catch {
        // Fallback gracefully if speechSynthesis fails in restricted environments
      }
    };

    loadVoices();

    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    };
  }, [isSystem]);

  if (!isTtsAdapter(adapter)) {
    return null;
  }

  // System TTS UI
  if (isSystem) {
    const isKnownSystemVoice = systemVoices.some(
      (candidate) => candidate.name === voice,
    );
    const showCustomInput =
      isCustomSystemMode || (voice.trim().length > 0 && !isKnownSystemVoice);

    const selectValue = showCustomInput
      ? "__custom__"
      : voice.trim().length > 0
        ? voice
        : "";

    const handleSystemSelectChange = (nextValue: string) => {
      if (nextValue === "__custom__") {
        setIsCustomSystemMode(true);
      } else {
        setIsCustomSystemMode(false);
        onChange(nextValue);
      }
    };

    return (
      <div className="flex flex-col gap-2">
        <div>
          <label
            htmlFor="modal-provider-system-voice"
            className="block text-xs font-bold text-navy dark:text-slate-100 mb-1"
          >
            {t("settings.providers.field.voice")}
          </label>
          <select
            id="modal-provider-system-voice"
            className="settings-select w-full text-xs"
            value={selectValue}
            disabled={disabled}
            onChange={(e) => handleSystemSelectChange(e.target.value)}
          >
            <option value="">{t("settings.providers.field.voiceSystemDefault")}</option>
            {systemVoices.map((sysVoice, idx) => (
              <option key={`${sysVoice.name}-${sysVoice.lang}-${idx}`} value={sysVoice.name}>
                {sysVoice.name} ({sysVoice.lang}){sysVoice.default ? " — default" : ""}
              </option>
            ))}
            <option value="__custom__">{t("settings.providers.field.voiceCustomSystem")}</option>
          </select>
        </div>

        {showCustomInput && (
          <div>
            <label
              htmlFor="modal-provider-custom-system-voice"
              className="block text-xs font-bold text-navy dark:text-slate-100 mb-1"
            >
              {t("settings.providers.field.voiceCustomSystemLabel")}
            </label>
            <input
              id="modal-provider-custom-system-voice"
              type="text"
              className="settings-select w-full text-xs font-mono"
              placeholder={t("settings.providers.field.voiceCustomSystemPlaceholder")}
              value={voice}
              disabled={disabled}
              maxLength={128}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        )}

        <p className="text-[11px] text-slatecopy m-0">
          {t("settings.providers.field.voiceSystemHint")}
        </p>
      </div>
    );
  }

  // Network TTS UI (ElevenLabs, MiniMax, OpenAI-compatible speech)
  const curatedVoices = getCuratedVoicesForAdapter(adapter);
  const isCurated = isKnownCuratedVoice(adapter, voice);
  const fieldLabelKey = getVoiceFieldLabelKey(adapter);
  const placeholderKey = getVoicePlaceholderKey(adapter);
  const hintKey = getVoiceHintKey(adapter);

  const handlePresetChange = (nextPresetValue: string) => {
    if (nextPresetValue !== "__custom__" && nextPresetValue.trim().length > 0) {
      onChange(nextPresetValue);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {/* Preset Selector Dropdown */}
        <div>
          <label
            htmlFor="modal-provider-voice-preset"
            className="block text-xs font-bold text-navy dark:text-slate-100 mb-1"
          >
            {t("settings.providers.field.voicePresets")}
          </label>
          <select
            id="modal-provider-voice-preset"
            className="settings-select w-full text-xs"
            value={isCurated ? voice : "__custom__"}
            disabled={disabled}
            onChange={(e) => handlePresetChange(e.target.value)}
          >
            <option value="__custom__">
              {isCurated
                ? t("settings.providers.field.voicePresetCustomOption")
                : t("settings.providers.field.voicePresetCustomActive")}
            </option>
            {curatedVoices.map((curatedVoice) => (
              <option key={curatedVoice.id} value={curatedVoice.id}>
                {curatedVoice.label}
                {curatedVoice.description ? ` (${curatedVoice.description})` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Explicit Editable Voice Identifier Field */}
        <div>
          <label
            htmlFor="modal-provider-voice"
            className="block text-xs font-bold text-navy dark:text-slate-100 mb-1"
          >
            {t(fieldLabelKey)}
          </label>
          <input
            id="modal-provider-voice"
            type="text"
            className="settings-select w-full text-xs font-mono"
            placeholder={t(placeholderKey)}
            value={voice}
            disabled={disabled}
            maxLength={128}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>

      {/* Provider-specific explanatory hint */}
      <p className="text-[11px] text-slatecopy m-0">
        {t(hintKey)}
      </p>
    </div>
  );
}
