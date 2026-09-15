import type React from "react";
import { useI18n } from "../../i18n.js";
import {
  FeelingGoodIcon,
  FeelingNeedSupportIcon,
  FeelingSteadyIcon,
  FeelingStretchedIcon,
  FeelingStrugglingIcon,
  HeartHandshakeIcon,
  MessageSquareIcon,
  RefreshIcon,
} from "../teams-icons.js";
import type {
  ManagerCheckInFeelingCode,
  ManagerCheckInSubmission,
} from "../teams-types.js";
import {
  FEELING_CONFIGS,
  formatRelativeDate,
  formatSubmissionDate,
  getFeelingLabel,
} from "./manager-check-ins-state.js";

export type ManagerCheckInHistoryListProps = {
  readonly submissions: readonly ManagerCheckInSubmission[];
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
  readonly onLoadMore: () => void;
};

function renderFeelingIcon(code: ManagerCheckInFeelingCode) {
  switch (code) {
    case "good":
      return <FeelingGoodIcon className="w-3.5 h-3.5 shrink-0" />;
    case "steady":
      return <FeelingSteadyIcon className="w-3.5 h-3.5 shrink-0" />;
    case "stretched":
      return <FeelingStretchedIcon className="w-3.5 h-3.5 shrink-0" />;
    case "struggling":
      return <FeelingStrugglingIcon className="w-3.5 h-3.5 shrink-0" />;
    case "need_support":
      return <FeelingNeedSupportIcon className="w-3.5 h-3.5 shrink-0" />;
  }
}

function HistorySubmissionCard({
  submission,
}: {
  readonly submission: ManagerCheckInSubmission;
}) {
  const { t, locale } = useI18n();
  const config = FEELING_CONFIGS[submission.feelingCode];
  const label = getFeelingLabel(submission.feelingCode, submission.promptSnapshot);
  const relativeTime = formatRelativeDate(submission.submittedAt, t, locale);
  const formattedDate = formatSubmissionDate(submission.submittedAt, locale);
  const isNeedSupport = submission.feelingCode === "need_support";

  const cardBorderClass = isNeedSupport
    ? "border-rose-200/90 bg-rose-50/30 dark:border-rose-900/60 dark:bg-rose-950/20"
    : "border-blue-100/70 bg-white/80 dark:bg-slate-900/50";

  return (
    <article
      className={`rounded-2xl border p-4 shadow-xs transition-colors dark:border-slate-800 dark:bg-slate-900/60 ${cardBorderClass}`}
    >
      {/* Top line: Feeling badge, title snapshot, submission timestamp */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-monoDisplay font-black border ${config.badgeClass}`}
          >
            {renderFeelingIcon(submission.feelingCode)}
            <span>{label}</span>
          </span>

          {submission.promptSnapshot?.title && (
            <span className="text-xs font-bold text-navy dark:text-slate-200">
              {submission.promptSnapshot.title}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-slatecopy font-medium dark:text-slate-400">
          <span title={formattedDate}>{relativeTime}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-[10px]">{formattedDate}</span>
        </div>
      </div>

      {/* Reflection Note (if present) */}
      {submission.note ? (
        <div className="mt-2 rounded-xl bg-blue-50/40 p-3 text-xs text-navy leading-relaxed dark:bg-slate-950/50 dark:text-slate-200 border border-blue-100/50 dark:border-slate-800">
          <div className="flex items-start gap-2">
            <MessageSquareIcon className="w-3.5 h-3.5 text-slatecopy/60 shrink-0 mt-0.5 dark:text-slate-400" />
            <p className="m-0 whitespace-pre-wrap">{submission.note}</p>
          </div>
        </div>
      ) : (
        <div className="mt-1 text-[11px] italic text-slatecopy/70 dark:text-slate-500">
          {t("teams.checkIn.history.noNote")}
        </div>
      )}

      {/* Prompt snapshot acknowledgement footer */}
      {submission.promptSnapshot?.acknowledgement && (
        <div className="mt-2 pt-2 border-t border-blue-50/70 dark:border-slate-800/80 flex items-center justify-between text-[10px] text-slatecopy/70 dark:text-slate-400">
          <span className="truncate">
            ✓ {submission.promptSnapshot.acknowledgement}
          </span>
          <span className="font-mono shrink-0 ml-2">
            {t("teams.checkIn.history.revBadge", {
              revision: submission.settingsRevision,
            })}
          </span>
        </div>
      )}
    </article>
  );
}

export function ManagerCheckInHistoryList({
  submissions,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: ManagerCheckInHistoryListProps) {
  const { t } = useI18n();

  if (submissions.length === 0) {
    return (
      <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-blue-200/80 bg-blue-50/20 p-6 text-center dark:border-slate-800 dark:bg-slate-900/30">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-100/60 text-brand dark:bg-slate-800 dark:text-blue-300">
          <HeartHandshakeIcon className="w-5 h-5" />
        </div>
        <strong className="text-xs font-bold text-navy dark:text-slate-100">
          {t("teams.checkIn.history.emptyTitle")}
        </strong>
        <p className="m-0 max-w-sm text-[11px] text-slatecopy leading-relaxed dark:text-slate-400">
          {t("teams.checkIn.history.emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5">
        {submissions.map((submission) => (
          <HistorySubmissionCard
            key={submission.id || submission.clientGeneratedId}
            submission={submission}
          />
        ))}
      </div>

      {/* Pagination: Load older reflections */}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            disabled={isLoadingMore}
            onClick={onLoadMore}
            className="btn btn-compact btn-secondary text-xs"
          >
            {isLoadingMore ? (
              <>
                <RefreshIcon className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                <span>{t("teams.checkIn.history.loadingOlder")}</span>
              </>
            ) : (
              <span>{t("teams.checkIn.history.loadOlder")}</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
