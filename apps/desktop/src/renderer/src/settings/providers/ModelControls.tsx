import { useI18n } from "../../i18n.js";
import type { ProviderAdapter } from "./types.js";

export type ModelControlsProps = {
  readonly adapter: ProviderAdapter;
  readonly model: string;
  readonly realtimeModel?: string;
  readonly onModelChange: (model: string) => void;
  readonly onRealtimeModelChange?: (realtimeModel: string) => void;
  readonly disabled?: boolean;
};

export function ModelControls({
  adapter,
  model,
  realtimeModel = "",
  onModelChange,
  onRealtimeModelChange,
  disabled = false,
}: ModelControlsProps) {
  const { t } = useI18n();

  if (adapter === "system-tts") {
    return null;
  }

  if (adapter === "openai-realtime") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div>
          <label
            htmlFor="modal-provider-model"
            className="block text-xs font-bold text-navy dark:text-slate-100 mb-1"
          >
            {t("settings.providers.field.textModel")}
          </label>
          <input
            id="modal-provider-model"
            type="text"
            className="settings-select w-full text-xs font-mono"
            placeholder={t("settings.providers.field.textModelPlaceholder")}
            value={model}
            maxLength={256}
            disabled={disabled}
            onChange={(e) => onModelChange(e.target.value)}
          />
        </div>

        <div>
          <label
            htmlFor="modal-provider-realtime-model"
            className="block text-xs font-bold text-navy dark:text-slate-100 mb-1"
          >
            {t("settings.providers.field.realtimeModel")}
          </label>
          <input
            id="modal-provider-realtime-model"
            type="text"
            className="settings-select w-full text-xs font-mono"
            placeholder={t("settings.providers.field.realtimeModelPlaceholder")}
            value={realtimeModel}
            maxLength={256}
            disabled={disabled}
            onChange={(e) => onRealtimeModelChange?.(e.target.value)}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor="modal-provider-model"
        className="block text-xs font-bold text-navy dark:text-slate-100 mb-1"
      >
        {t("settings.providers.modal.field.model")}
      </label>
      <input
        id="modal-provider-model"
        type="text"
        className="settings-select w-full text-xs font-mono"
        placeholder={t("settings.providers.modal.field.modelPlaceholder")}
        value={model}
        maxLength={256}
        disabled={disabled}
        onChange={(e) => onModelChange(e.target.value)}
      />
    </div>
  );
}
