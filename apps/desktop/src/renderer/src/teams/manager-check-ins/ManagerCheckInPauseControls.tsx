import type React from "react";
import { useI18n } from "../../i18n.js";
import { InfoIcon, PauseIcon, PlayIcon } from "../teams-icons.js";

export type ManagerCheckInPauseControlsProps = {
  readonly isPaused: boolean;
  readonly isBusy: boolean;
  readonly onTogglePause: (paused: boolean) => void;
};

export function ManagerCheckInPauseControls({
  isPaused,
  isBusy,
  onTogglePause,
}: ManagerCheckInPauseControlsProps) {
  const { t } = useI18n();

  const handleToggleClick = () => {
    onTogglePause(!isPaused);
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3.5 rounded-2xl border border-blue-100/70 bg-white/60 p-4 shadow-sm dark:bg-slate-900/40 dark:border-slate-800">
      <div className="flex items-start gap-3">
        <div className="pt-0.5 text-slatecopy/80 dark:text-slate-400">
          <InfoIcon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0 text-xs leading-relaxed text-slatecopy dark:text-slate-300">
          <strong className="block font-bold text-navy dark:text-slate-100 mb-0.5">
            {t("teams.checkIn.pause.title")}
          </strong>
          <p className="m-0 leading-relaxed">
            {isPaused
              ? t("teams.checkIn.pause.pausedDescription")
              : t("teams.checkIn.pause.activeDescription")}
          </p>
        </div>
      </div>

      <button
        type="button"
        disabled={isBusy}
        onClick={handleToggleClick}
        className="btn btn-compact btn-secondary text-xs shrink-0"
      >
        {isPaused ? (
          <>
            <PlayIcon className="w-3.5 h-3.5 mr-1" />
            <span>{t("teams.checkIn.pause.resume")}</span>
          </>
        ) : (
          <>
            <PauseIcon className="w-3.5 h-3.5 mr-1" />
            <span>{t("teams.checkIn.pause.pause")}</span>
          </>
        )}
      </button>
    </div>
  );
}
