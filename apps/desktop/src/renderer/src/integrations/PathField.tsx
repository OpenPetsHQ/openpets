import { useEffect, useState } from "react";
import { useI18n } from "../i18n.js";
import { SaveIcon } from "./icons.js";
import type { PathFieldProps } from "./types.js";

export function PathField({ label, value, placeholder, onSave, disabled }: PathFieldProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-bold text-slatecopy uppercase tracking-wider">{label}</label>
      <div className="flex gap-2">
        <input
          className="plugin-input flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
        <button
          type="button"
          className="btn btn-secondary btn-compact has-icon"
          disabled={disabled || draft === value}
          onClick={() => onSave(draft)}
        >
          <span className="btn-icon-wrapper mr-1.5 inline-flex items-center justify-center">
            <SaveIcon />
          </span>
          <span className="btn-text">{t("common.save")}</span>
        </button>
      </div>
    </div>
  );
}
