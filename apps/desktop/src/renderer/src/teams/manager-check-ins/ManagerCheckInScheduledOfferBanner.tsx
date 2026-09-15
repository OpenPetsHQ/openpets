import type React from "react";
import { useI18n } from "../../i18n.js";
import { CalendarIcon, CloseIcon, SparklesIcon } from "../teams-icons.js";
import type { ManagerCheckInSettings } from "../teams-types.js";
import { getWeekdayName } from "./manager-check-ins-state.js";

export type ManagerCheckInScheduledOfferBannerProps = {
  readonly settings: ManagerCheckInSettings;
  readonly onOpenCheckIn: () => void;
  readonly onDismiss: () => void;
};

export function ManagerCheckInScheduledOfferBanner({
  settings,
  onOpenCheckIn,
  onDismiss,
}: ManagerCheckInScheduledOfferBannerProps) {
  const { t } = useI18n();
  const weekdayName = getWeekdayName(settings.weeklyDay, t);

  return (
    <section
      aria-label={t("teams.checkIn.banner.subtitle")}
      className="relative overflow-hidden rounded-2xl border border-blue-200/80 bg-gradient-to-r from-blue-50/90 via-indigo-50/80 to-blue-50/90 p-4.5 shadow-sm dark:from-slate-900/90 dark:via-blue-950/40 dark:to-slate-900/90 dark:border-blue-800/60"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand dark:bg-blue-500/20 dark:text-blue-300">
            <SparklesIcon className="w-5 h-5" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100/70 px-2 py-0.5 font-sans text-[11px] font-bold text-brand dark:bg-blue-900/60 dark:text-blue-300">
                <CalendarIcon className="w-3 h-3" />
                <span>
                  {t("teams.checkIn.banner.weeklyReflection", { weekday: weekdayName })}
                </span>
              </span>
              <span className="text-[11px] text-slatecopy dark:text-slate-400">
                {t("teams.checkIn.banner.subtitle")}
              </span>
            </div>

            <h4 className="m-0 font-monoDisplay text-base font-black text-navy dark:text-slate-100">
              {settings.title}
            </h4>

            <p className="m-0 mt-1 text-xs leading-relaxed text-slatecopy dark:text-slate-300">
              {settings.introduction}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="text-slatecopy/60 hover:text-slatecopy dark:text-slate-400 dark:hover:text-slate-200 p-1 cursor-pointer transition-colors"
          aria-label={t("teams.checkIn.banner.dismissAria")}
          title={t("teams.checkIn.banner.dismissTitle")}
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-3.5 flex items-center justify-end gap-2 border-t border-blue-100/60 pt-3 dark:border-slate-800">
        <button
          type="button"
          onClick={onDismiss}
          className="btn btn-compact btn-secondary text-xs"
        >
          {t("teams.checkIn.banner.later")}
        </button>

        <button
          type="button"
          onClick={onOpenCheckIn}
          className="btn btn-compact btn-primary text-xs"
        >
          <SparklesIcon className="w-3.5 h-3.5 mr-1" />
          <span>{t("teams.checkIn.action.checkInNow")}</span>
        </button>
      </div>
    </section>
  );
}
