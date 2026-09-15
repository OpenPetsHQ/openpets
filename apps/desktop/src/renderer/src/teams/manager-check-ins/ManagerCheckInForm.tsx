import type React from "react";
import { useState } from "react";
import {
  FeelingGoodIcon,
  FeelingNeedSupportIcon,
  FeelingSteadyIcon,
  FeelingStretchedIcon,
  FeelingStrugglingIcon,
  InfoIcon,
  RefreshIcon,
  SparklesIcon,
} from "../teams-icons.js";
import {
  managerCheckInFeelingCodes,
  type ManagerCheckInFeelingCode,
  type ManagerCheckInSettings,
  type ManagerCheckInSubmitInput,
} from "../teams-types.js";
import {
  FEELING_CONFIGS,
  MAX_NOTE_LENGTH,
  getFeelingLabel,
} from "./manager-check-ins-state.js";

export type ManagerCheckInFormProps = {
  readonly settings: ManagerCheckInSettings;
  readonly visibilityNoticeText: string;
  readonly isBusy: boolean;
  readonly onSubmit: (input: ManagerCheckInSubmitInput) => Promise<void>;
  readonly onCancel?: () => void;
};

export function ManagerCheckInForm({
  settings,
  visibilityNoticeText,
  isBusy,
  onSubmit,
  onCancel,
}: ManagerCheckInFormProps) {
  const [selectedFeeling, setSelectedFeeling] = useState<ManagerCheckInFeelingCode | null>(null);
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");

  const handleFeelingSelect = (code: ManagerCheckInFeelingCode) => {
    setSelectedFeeling(code);
    setFormError("");
  };

  const handleNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= MAX_NOTE_LENGTH) {
      setNote(value);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFeeling) {
      setFormError("Please select how work is feeling for you.");
      return;
    }

    const hasValidRevision =
      typeof settings?.revision === "number" &&
      Number.isSafeInteger(settings.revision) &&
      settings.revision >= 0;

    const hasValidNotice =
      typeof visibilityNoticeText === "string" &&
      visibilityNoticeText.trim().length > 0;

    if (!hasValidRevision || !hasValidNotice) {
      setFormError("Authoritative organization settings are required before submitting.");
      return;
    }

    setFormError("");
    try {
      await onSubmit({
        feelingCode: selectedFeeling,
        note: note.trim() ? note.trim() : null,
        settingsRevision: settings.revision,
      });
      // Reset form on success
      setSelectedFeeling(null);
      setNote("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to submit reflection.");
    }
  };

  const getFeelingIcon = (code: ManagerCheckInFeelingCode) => {
    switch (code) {
      case "good":
        return <FeelingGoodIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />;
      case "steady":
        return <FeelingSteadyIcon className="w-5 h-5 text-sky-600 dark:text-sky-400" />;
      case "stretched":
        return <FeelingStretchedIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />;
      case "struggling":
        return <FeelingStrugglingIcon className="w-5 h-5 text-orange-600 dark:text-orange-400" />;
      case "need_support":
        return <FeelingNeedSupportIcon className="w-5 h-5 text-rose-700 dark:text-rose-300" />;
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5 rounded-[24px] border border-blue-200/80 bg-white/90 p-5 shadow-sm dark:bg-slate-900/80 dark:border-slate-800"
    >
      {/* Header & Prompt */}
      <div className="flex flex-col gap-1 border-b border-blue-50 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 text-brand px-2.5 py-0.5 font-monoDisplay text-[11px] font-black uppercase tracking-wider dark:bg-blue-900/40 dark:text-blue-300">
            <SparklesIcon className="w-3.5 h-3.5" />
            Check in now
          </span>
          <span className="text-[11px] text-slatecopy dark:text-slate-400 font-mono">
            Revision {settings.revision}
          </span>
        </div>

        <h3 className="m-0 font-monoDisplay text-lg font-black text-navy dark:text-slate-100">
          {settings.title}
        </h3>

        <p className="m-0 text-xs text-slatecopy leading-relaxed dark:text-slate-300">
          {settings.introduction}
        </p>
      </div>

      {/* Form Error Banner */}
      {formError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700 dark:bg-red-950/50 dark:border-red-800 dark:text-red-200">
          {formError}
        </div>
      )}

      {/* 5 Fixed Feelings Selection */}
      <div className="flex flex-col gap-2">
        <label className="font-monoDisplay text-xs font-black uppercase tracking-wider text-slatecopy dark:text-slate-300">
          How are you feeling? <span className="text-red-500">*</span>
        </label>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {managerCheckInFeelingCodes.map((code) => {
            const config = FEELING_CONFIGS[code];
            const isSelected = selectedFeeling === code;
            const label = getFeelingLabel(code, settings);

            return (
              <button
                key={code}
                type="button"
                onClick={() => handleFeelingSelect(code)}
                disabled={isBusy}
                className={`relative flex flex-col items-center justify-center gap-2 rounded-2xl border p-3 text-center transition-[transform,background-color,border-color,box-shadow] cursor-pointer select-none ${
                  isSelected
                    ? config.cardActiveClass
                    : `border-slate-200 bg-white/70 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 ${config.cardHoverClass}`
                } ${code === "need_support" && !isSelected ? "border-rose-200/70 bg-rose-50/20" : ""}`}
              >
                <div className="grid h-8 w-8 place-items-center rounded-xl bg-white/80 shadow-xs dark:bg-slate-800">
                  {getFeelingIcon(code)}
                </div>

                <span className="font-monoDisplay text-xs font-black leading-tight">
                  {label}
                </span>

                {code === "need_support" && (
                  <span className="text-[10px] text-rose-700 dark:text-rose-300 font-semibold leading-none">
                    Support
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Optional Note Textarea */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="manager-check-in-note"
            className="font-monoDisplay text-xs font-black uppercase tracking-wider text-slatecopy dark:text-slate-300"
          >
            Optional Reflection Note
          </label>
          <span className="text-[11px] font-mono text-slatecopy/70 dark:text-slate-400">
            {note.length} / {MAX_NOTE_LENGTH}
          </span>
        </div>

        <textarea
          id="manager-check-in-note"
          value={note}
          onChange={handleNoteChange}
          disabled={isBusy}
          rows={3}
          placeholder={settings.notePlaceholder}
          className="w-full rounded-xl border border-blue-200/80 bg-white/90 p-3 text-xs font-medium text-navy outline-none placeholder:text-slatecopy/60 focus:border-brand focus:ring-4 focus:ring-brand/15 disabled:opacity-60 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
      </div>

      {/* Mandatory Contractual Visibility Notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-blue-100/60 bg-blue-50/30 p-3 text-[11px] text-slatecopy leading-relaxed dark:bg-slate-950/40 dark:border-slate-800 dark:text-slate-400">
        <div className="pt-0.5 text-brand shrink-0 dark:text-blue-400">
          <InfoIcon className="w-3.5 h-3.5" />
        </div>
        <span>
          {visibilityNoticeText}
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-blue-50 dark:border-slate-800">
        {onCancel && (
          <button
            type="button"
            disabled={isBusy}
            onClick={onCancel}
            className="btn btn-compact btn-secondary text-xs"
          >
            Cancel
          </button>
        )}

        <button
          type="submit"
          disabled={isBusy || !selectedFeeling}
          className="btn btn-compact btn-primary text-xs"
        >
          {isBusy ? (
            <>
              <RefreshIcon className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <SparklesIcon className="w-3.5 h-3.5 mr-1.5" />
              Submit Reflection
            </>
          )}
        </button>
      </div>
    </form>
  );
}
