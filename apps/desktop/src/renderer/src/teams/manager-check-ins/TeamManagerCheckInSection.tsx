import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  CheckIcon,
  CloseIcon,
  HeartHandshakeIcon,
  InfoIcon,
  RefreshIcon,
  SparklesIcon,
} from "../teams-icons.js";
import type {
  ManagerCheckInHistoryPage,
  ManagerCheckInSnapshot,
  ManagerCheckInSubmission,
  ManagerCheckInSubmitInput,
  TeamsApi,
} from "../teams-types.js";
import { ManagerCheckInForm } from "./ManagerCheckInForm.js";
import { ManagerCheckInHistoryList } from "./ManagerCheckInHistoryList.js";
import { ManagerCheckInPauseControls } from "./ManagerCheckInPauseControls.js";
import { ManagerCheckInScheduledOfferBanner } from "./ManagerCheckInScheduledOfferBanner.js";
import { getLocalMondayWeekKey } from "./manager-check-ins-state.js";

export type TeamManagerCheckInSectionProps = {
  readonly api: TeamsApi;
};

function deduplicateSubmissions(
  submissions: readonly ManagerCheckInSubmission[],
): readonly ManagerCheckInSubmission[] {
  const seen = new Set<string>();
  const result: ManagerCheckInSubmission[] = [];
  for (const item of submissions) {
    const key = item.id || item.clientGeneratedId;
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

export function TeamManagerCheckInSection({ api }: TeamManagerCheckInSectionProps) {
  const [snapshot, setSnapshot] = useState<ManagerCheckInSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [acknowledgementMessage, setAcknowledgementMessage] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Scheduled offer dismissal keyed to active desktop-local weekly cycle
  const [dismissedCycleKey, setDismissedCycleKey] = useState<string | null>(null);

  // Pagination state for history submissions
  const [historicalSubmissions, setHistoricalSubmissions] = useState<
    readonly ManagerCheckInSubmission[]
  >([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Request token/generation to prevent out-of-order / stale async history responses
  const historyRequestIdRef = useRef(0);
  const hasLoadedInitialSnapshotRef = useRef(false);

  // Active due cycle key derived from snapshot + desktop-local Monday week key (null if not currently due)
  const localWeekKey = getLocalMondayWeekKey();
  const activeDueCycleKey =
    snapshot?.dueScheduledOffer && snapshot?.settings
      ? `due_week_${localWeekKey}_day_${snapshot.settings.weeklyDay}_rev_${snapshot.settings.revision}`
      : null;

  const isOfferDismissed = Boolean(
    activeDueCycleKey && dismissedCycleKey === activeDueCycleKey,
  );

  // Retain reset behavior when no offer is due
  useEffect(() => {
    if (!snapshot?.dueScheduledOffer) {
      setDismissedCycleKey(null);
    }
  }, [snapshot?.dueScheduledOffer]);

  // Helper to fetch page zero of history, reread authoritative snapshot, and atomically commit
  const fetchPageZero = useCallback(
    async (fallbackSubmissions: readonly ManagerCheckInSubmission[]) => {
      const reqId = ++historyRequestIdRef.current;
      // When page zero supersedes load-more, clear pagination busy state for the latest generation
      setIsLoadingMore(false);
      setHistoryError("");

      if (api.getManagerCheckInsHistory) {
        try {
          const page: ManagerCheckInHistoryPage = await api.getManagerCheckInsHistory();

          // After a successful page-zero getManagerCheckInsHistory() call (which applies
          // authoritative service sync), reread getManagerCheckInsSnapshot() so settings/pause/due
          // state cannot remain stale.
          const freshSnapshot = api.getManagerCheckInsSnapshot
            ? await api.getManagerCheckInsSnapshot()
            : null;

          if (reqId !== historyRequestIdRef.current) return;

          // Atomically commit snapshot and history page result together
          if (freshSnapshot) {
            setSnapshot(freshSnapshot);
          }
          const rows = deduplicateSubmissions(page.submissions || []);
          setHistoricalSubmissions(rows);
          setNextCursor(page.nextCursor || null);
          setHistoryError("");
          return;
        } catch (err) {
          if (reqId !== historyRequestIdRef.current) return;
          // Retain fallback submissions if available, but clearly record visible retryable error
          setHistoricalSubmissions(deduplicateSubmissions(fallbackSubmissions || []));
          setNextCursor(null);
          setHistoryError(
            err instanceof Error ? err.message : "Failed to load reflection history.",
          );
          return;
        }
      }

      const rows = deduplicateSubmissions(fallbackSubmissions || []);
      setHistoricalSubmissions(rows);
      setNextCursor(null);
    },
    [api],
  );

  // Stable callback for loading snapshot
  const loadSnapshot = useCallback(
    async (isManualSync = false) => {
      if (!api.getManagerCheckInsSnapshot) {
        setLoading(false);
        return;
      }

      if (!hasLoadedInitialSnapshotRef.current) {
        setLoading(true);
      }
      if (isManualSync) setBusy(true);
      setErrorMessage("");

      try {
        const next = isManualSync && api.syncManagerCheckIns
          ? await api.syncManagerCheckIns()
          : await api.getManagerCheckInsSnapshot();

        hasLoadedInitialSnapshotRef.current = true;
        setSnapshot(next);

        const isReady = Boolean(
          next.availability === "available" &&
            next.settings &&
            typeof next.settings.revision === "number" &&
            Number.isSafeInteger(next.settings.revision) &&
            next.settings.revision >= 0 &&
            typeof next.visibilityNotice?.text === "string" &&
            next.visibilityNotice.text.trim().length > 0,
        );

        if (isReady) {
          await fetchPageZero(next.submissions || []);
        } else {
          setHistoricalSubmissions(deduplicateSubmissions(next.submissions || []));
          setNextCursor(null);
        }
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load check-ins.",
        );
      } finally {
        setLoading(false);
        if (isManualSync) setBusy(false);
      }
    },
    [api, fetchPageZero],
  );

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  // Auto-clear transient success messages
  useEffect(() => {
    if (!successMessage) return;
    const timer = window.setTimeout(() => setSuccessMessage(""), 4000);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  const handleSubmitCheckIn = async (input: ManagerCheckInSubmitInput) => {
    if (!api.submitManagerCheckIn) {
      throw new Error("Submit Check-in API is not available on this host.");
    }

    setBusy(true);
    setErrorMessage("");
    try {
      const next = await api.submitManagerCheckIn(input);
      setSnapshot(next);
      setIsFormOpen(false);

      // Dismiss the active due cycle if one was active
      if (activeDueCycleKey) {
        setDismissedCycleKey(activeDueCycleKey);
      }

      // Atomically refresh history entries with fresh page zero
      await fetchPageZero(next.submissions || []);

      const ackText =
        next.settings?.acknowledgement ||
        "Thank you for sharing. Your reflection is saved and visible in your timeline.";
      setAcknowledgementMessage(ackText);
      setSuccessMessage("Reflection submitted successfully.");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to submit reflection.",
      );
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePause = async (paused: boolean) => {
    if (!api.setManagerCheckInScheduledOffersPaused) {
      setErrorMessage("Scheduled offers pause API is not available.");
      return;
    }

    setBusy(true);
    setErrorMessage("");
    try {
      const next = await api.setManagerCheckInScheduledOffersPaused(paused);
      setSnapshot(next);
      setSuccessMessage(
        paused
          ? "Weekly scheduled offers paused on this device."
          : "Weekly scheduled offers resumed.",
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to update scheduled offers preference.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleLoadMoreHistory = async () => {
    if (!api.getManagerCheckInsHistory || !nextCursor || isLoadingMore) return;

    const reqId = ++historyRequestIdRef.current;
    setIsLoadingMore(true);
    setHistoryError("");
    try {
      const page: ManagerCheckInHistoryPage = await api.getManagerCheckInsHistory(nextCursor);
      if (reqId !== historyRequestIdRef.current) return;

      setHistoricalSubmissions((prev) =>
        deduplicateSubmissions([...prev, ...(page.submissions || [])]),
      );
      setNextCursor(page.nextCursor || null);
    } catch (err) {
      if (reqId === historyRequestIdRef.current) {
        setHistoryError(
          err instanceof Error ? err.message : "Failed to load older reflections.",
        );
      }
    } finally {
      if (reqId === historyRequestIdRef.current) {
        setIsLoadingMore(false);
      }
    }
  };

  const handleRetryPageZero = () => {
    void fetchPageZero(snapshot?.submissions || []);
  };

  // If the API method is not wired in this host environment
  if (!api.getManagerCheckInsSnapshot) {
    return null;
  }

  // Loading skeleton
  if (loading && !snapshot) {
    return (
      <section className="flex flex-col gap-3">
        <div className="flex min-h-28 items-center justify-center rounded-2xl border border-blue-100/70 bg-white/60 p-6 text-center text-xs text-slatecopy dark:bg-slate-900/40 dark:border-slate-800">
          <div className="flex items-center gap-2 font-semibold">
            <RefreshIcon className="w-4 h-4 animate-spin text-brand" />
            <span>Loading Check-ins...</span>
          </div>
        </div>
      </section>
    );
  }

  if (!snapshot) return null;

  // Unenrolled state
  if (snapshot.availability === "unenrolled") {
    return null;
  }

  // Unavailable state (e.g. secure storage not ready or employee identity required)
  if (snapshot.availability === "unavailable") {
    return (
      <section className="flex flex-col gap-3">
        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 p-4 shadow-sm dark:bg-amber-950/40 dark:border-amber-800/60 flex items-start gap-3.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
            <AlertCircleIcon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
            <strong className="block text-sm font-bold text-amber-950 dark:text-amber-100 mb-0.5">
              Check-ins Temporarily Unavailable
            </strong>
            {snapshot.unavailableReason === "secure_storage_unavailable"
              ? "Secure storage is not accessible on this device. Your reflections cannot be loaded or stored securely."
              : snapshot.unavailableReason === "employee_identity_required"
              ? "Employee identity enrollment is required to submit reflections to your organization’s Teams dashboard."
              : "Check-ins are currently not available on this device."}
          </div>
        </div>
      </section>
    );
  }

  // Unready state: available on device, but server settings (non-negative safe integer revision) or visibility notice not yet synchronized
  const isServerConfigReady = Boolean(
    snapshot.availability === "available" &&
      snapshot.settings &&
      typeof snapshot.settings.revision === "number" &&
      Number.isSafeInteger(snapshot.settings.revision) &&
      snapshot.settings.revision >= 0 &&
      typeof snapshot.visibilityNotice?.text === "string" &&
      snapshot.visibilityNotice.text.trim().length > 0,
  );

  if (!isServerConfigReady) {
    return (
      <section className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="m-0 font-monoDisplay text-lg font-black text-navy dark:text-slate-100 flex items-center gap-2">
              <HeartHandshakeIcon className="w-5 h-5 text-brand" />
              <span>Manager Check-ins</span>
            </h3>
            <p className="m-0 mt-0.5 text-xs text-slatecopy dark:text-slate-300">
              Optional, asynchronous reflections shared with your organization’s Teams dashboard.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadSnapshot(true)}
              className="btn btn-compact btn-secondary text-xs"
              title="Sync check-ins snapshot"
            >
              <RefreshIcon className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
              <span>Sync Now</span>
            </button>
          </div>
        </div>

        {/* Syncing / Unready notice */}
        <div className="rounded-2xl border border-blue-200/80 bg-blue-50/60 p-4 shadow-sm dark:bg-slate-900/60 dark:border-blue-800/60 flex items-start justify-between gap-3.5">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-100 text-brand dark:bg-blue-900/60 dark:text-blue-300">
              <InfoIcon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0 text-xs leading-relaxed text-slatecopy dark:text-slate-300">
              <strong className="block text-sm font-bold text-navy dark:text-slate-100 mb-0.5">
                Check-in Settings Synchronizing
              </strong>
              <span>
                Organization check-in configuration and visibility notice are currently synchronizing with your organization’s Teams dashboard. Check-in submission and scheduled offers will become active as soon as synchronization completes.
              </span>
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void loadSnapshot(true)}
            className="btn btn-compact btn-primary text-xs shrink-0"
          >
            <RefreshIcon className={`w-3.5 h-3.5 mr-1 ${busy ? "animate-spin" : ""}`} />
            <span>Retry</span>
          </button>
        </div>

        {/* Still render local historical timeline if available */}
        {historicalSubmissions.length > 0 && (
          <div className="flex flex-col gap-2 pt-2">
            <div className="flex items-center justify-between">
              <span className="font-monoDisplay text-xs font-black uppercase tracking-wider text-slatecopy dark:text-slate-300">
                Personal Reflection Timeline
              </span>
              <span className="text-[11px] text-slatecopy/80 dark:text-slate-400">
                Read-only & immutable
              </span>
            </div>

            <ManagerCheckInHistoryList
              submissions={historicalSubmissions}
              hasMore={Boolean(nextCursor)}
              isLoadingMore={isLoadingMore}
              onLoadMore={() => void handleLoadMoreHistory()}
            />
          </div>
        )}
      </section>
    );
  }

  const settings = snapshot.settings!;
  const visibilityNoticeText = snapshot.visibilityNotice!.text;

  const showScheduledBanner =
    snapshot.dueScheduledOffer &&
    !isOfferDismissed &&
    !snapshot.scheduledOffersPaused &&
    !isFormOpen;

  return (
    <section className="flex flex-col gap-4">
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 font-monoDisplay text-lg font-black text-navy dark:text-slate-100 flex items-center gap-2">
            <HeartHandshakeIcon className="w-5 h-5 text-brand" />
            <span>Manager Check-ins</span>
          </h3>
          <p className="m-0 mt-0.5 text-xs text-slatecopy dark:text-slate-300">
            Optional, asynchronous reflections shared with your organization’s Teams dashboard.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => void loadSnapshot(true)}
            className="btn btn-compact btn-secondary text-xs"
            title="Sync check-ins snapshot"
          >
            <RefreshIcon className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
            <span>Sync</span>
          </button>

          {!isFormOpen && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setIsFormOpen(true);
                setAcknowledgementMessage("");
              }}
              className="btn btn-compact btn-primary text-xs"
            >
              <SparklesIcon className="w-3.5 h-3.5 mr-1" />
              Check in now
            </button>
          )}
        </div>
      </div>

      {/* Success Toast */}
      {successMessage && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800 shadow-sm flex items-center justify-between dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckIcon className="w-4 h-4" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            className="text-emerald-700 hover:text-emerald-900 cursor-pointer p-1 dark:text-emerald-300 dark:hover:text-emerald-100"
            onClick={() => setSuccessMessage("")}
            aria-label="Dismiss message"
          >
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Acknowledgement Card (after submitting) */}
      {acknowledgementMessage && (
        <div className="rounded-2xl border border-blue-200/80 bg-blue-50/80 p-4 shadow-sm flex items-start gap-3.5 dark:bg-blue-950/40 dark:border-blue-800/60">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-100 text-brand dark:bg-blue-900/60 dark:text-blue-300">
            <CheckCircleIcon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0 text-xs leading-relaxed">
            <strong className="block text-xs font-bold text-navy dark:text-slate-100 mb-0.5">
              Reflection Saved
            </strong>
            <p className="m-0 text-slatecopy dark:text-slate-300">
              {acknowledgementMessage}
            </p>
          </div>
          <button
            type="button"
            className="text-slatecopy/60 hover:text-slatecopy cursor-pointer p-1 dark:text-slate-400"
            onClick={() => setAcknowledgementMessage("")}
            aria-label="Dismiss acknowledgement"
          >
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Error Banner */}
      {(errorMessage || snapshot.lastError) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 shadow-sm flex items-start justify-between gap-3 dark:bg-red-950/40 dark:border-red-800/60 dark:text-red-200">
          <div className="flex items-start gap-2.5">
            <AlertCircleIcon className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <strong className="block font-bold text-red-900 dark:text-red-100">
                Check-in Sync Error
              </strong>
              <p className="m-0 mt-0.5 leading-relaxed">
                {errorMessage || snapshot.lastError}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="text-red-700 hover:text-red-900 cursor-pointer p-1 shrink-0 dark:text-red-300"
            onClick={() => setErrorMessage("")}
            aria-label="Dismiss error"
          >
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Scheduled Weekly Offer Banner (if due) */}
      {showScheduledBanner && (
        <ManagerCheckInScheduledOfferBanner
          settings={settings}
          onOpenCheckIn={() => {
            setIsFormOpen(true);
            setAcknowledgementMessage("");
          }}
          onDismiss={() => {
            if (activeDueCycleKey) {
              setDismissedCycleKey(activeDueCycleKey);
            }
          }}
        />
      )}

      {/* Check In Form (when opened) */}
      {isFormOpen && (
        <ManagerCheckInForm
          settings={settings}
          visibilityNoticeText={visibilityNoticeText}
          isBusy={busy}
          onSubmit={handleSubmitCheckIn}
          onCancel={() => setIsFormOpen(false)}
        />
      )}

      {/* Scheduled Offer Pause Controls */}
      <ManagerCheckInPauseControls
        isPaused={snapshot.scheduledOffersPaused}
        isBusy={busy}
        onTogglePause={(paused) => void handleTogglePause(paused)}
      />

      {/* Reflection History Section */}
      <div className="flex flex-col gap-2 pt-2">
        <div className="flex items-center justify-between">
          <span className="font-monoDisplay text-xs font-black uppercase tracking-wider text-slatecopy dark:text-slate-300">
            Personal Reflection Timeline
          </span>
          <span className="text-[11px] text-slatecopy/80 dark:text-slate-400">
            Read-only & immutable
          </span>
        </div>

        {/* Visible retryable history error card */}
        {historyError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 shadow-sm flex items-start justify-between gap-3 dark:bg-red-950/40 dark:border-red-800/60 dark:text-red-200">
            <div className="flex items-start gap-2">
              <AlertCircleIcon className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold">Failed to load reflection history</strong>
                <p className="m-0 text-[11px] mt-0.5 leading-relaxed">{historyError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRetryPageZero}
              className="btn btn-compact btn-secondary text-xs shrink-0"
            >
              <RefreshIcon className="w-3.5 h-3.5 mr-1" />
              Retry History
            </button>
          </div>
        )}

        <ManagerCheckInHistoryList
          submissions={historicalSubmissions}
          hasMore={Boolean(nextCursor)}
          isLoadingMore={isLoadingMore}
          onLoadMore={() => void handleLoadMoreHistory()}
        />
      </div>
    </section>
  );
}
