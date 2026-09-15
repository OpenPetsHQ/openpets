import type React from "react";
import { PauseIcon, PlayIcon, InfoIcon } from "../teams-icons.js";

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
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3.5 rounded-2xl border border-blue-100/70 bg-white/60 p-4 shadow-sm dark:bg-slate-900/40 dark:border-slate-800">
      <div className="flex items-start gap-3">
        <div className="pt-0.5 text-slatecopy/80 dark:text-slate-400">
          <InfoIcon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0 text-xs leading-relaxed text-slatecopy dark:text-slate-300">
          <strong className="block font-bold text-navy dark:text-slate-100 mb-0.5">
            Scheduled Offer Cadence
          </strong>
          {isPaused ? (
            <span>
              Weekly offers are currently <strong>paused</strong> on this device. You can still
              use <em>Check in now</em> whenever you want. Pausing creates no report or signal in
              your organization’s Teams dashboard.
            </span>
          ) : (
            <span>
              The mascot offers your organization’s weekly check-in when OpenPets is open on your
              team’s designated day. Pausing suppresses only the weekly prompt.
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        disabled={isBusy}
        onClick={() => onTogglePause(!isPaused)}
        className="btn btn-compact btn-secondary text-xs shrink-0"
      >
        {isPaused ? (
          <>
            <PlayIcon className="w-3.5 h-3.5 mr-1" />
            Resume Weekly Offers
          </>
        ) : (
          <>
            <PauseIcon className="w-3.5 h-3.5 mr-1" />
            Pause Weekly Offers
          </>
        )}
      </button>
    </div>
  );
}
