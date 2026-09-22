import type {
  ManagerCheckInFeelingCode,
  ManagerCheckInScheduleSnapshot,
} from "../teams-types.js";

export const DEFAULT_FEELING_LABELS: Record<ManagerCheckInFeelingCode, string> = {
  good: "Good",
  steady: "Steady",
  stretched: "Stretched",
  struggling: "Struggling",
  need_support: "Need support",
};

export type FeelingConfig = {
  readonly code: ManagerCheckInFeelingCode;
  readonly defaultLabel: string;
  readonly badgeClass: string;
  readonly cardActiveClass: string;
  readonly cardHoverClass: string;
  readonly tone: "green" | "blue" | "amber" | "orange" | "rose";
};

export const FEELING_CONFIGS: Record<ManagerCheckInFeelingCode, FeelingConfig> = {
  good: {
    code: "good",
    defaultLabel: "Good",
    badgeClass:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
    cardActiveClass:
      "border-emerald-500 bg-emerald-50/80 text-emerald-900 ring-2 ring-emerald-300/60 dark:border-emerald-500 dark:bg-emerald-950/50 dark:text-emerald-100 dark:ring-emerald-800/80",
    cardHoverClass:
      "hover:border-emerald-400 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30",
    tone: "green",
  },
  steady: {
    code: "steady",
    defaultLabel: "Steady",
    badgeClass:
      "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800",
    cardActiveClass:
      "border-sky-500 bg-sky-50/80 text-sky-900 ring-2 ring-sky-300/60 dark:border-sky-500 dark:bg-sky-950/50 dark:text-sky-100 dark:ring-sky-800/80",
    cardHoverClass:
      "hover:border-sky-400 hover:bg-sky-50/40 dark:hover:bg-sky-950/30",
    tone: "blue",
  },
  stretched: {
    code: "stretched",
    defaultLabel: "Stretched",
    badgeClass:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
    cardActiveClass:
      "border-amber-500 bg-amber-50/80 text-amber-900 ring-2 ring-amber-300/60 dark:border-amber-500 dark:bg-amber-950/50 dark:text-amber-100 dark:ring-amber-800/80",
    cardHoverClass:
      "hover:border-amber-400 hover:bg-amber-50/40 dark:hover:bg-amber-950/30",
    tone: "amber",
  },
  struggling: {
    code: "struggling",
    defaultLabel: "Struggling",
    badgeClass:
      "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800",
    cardActiveClass:
      "border-orange-500 bg-orange-50/80 text-orange-900 ring-2 ring-orange-300/60 dark:border-orange-500 dark:bg-orange-950/50 dark:text-orange-100 dark:ring-orange-800/80",
    cardHoverClass:
      "hover:border-orange-400 hover:bg-orange-50/40 dark:hover:bg-orange-950/30",
    tone: "orange",
  },
  need_support: {
    code: "need_support",
    defaultLabel: "Need support",
    badgeClass:
      "bg-rose-50 text-rose-800 border-rose-300 font-bold dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-700",
    cardActiveClass:
      "border-rose-500 bg-rose-50/90 text-rose-950 ring-2 ring-rose-400/60 dark:border-rose-400 dark:bg-rose-950/60 dark:text-rose-100 dark:ring-rose-700/80",
    cardHoverClass:
      "hover:border-rose-300 hover:bg-rose-50/40 dark:hover:bg-rose-950/30",
    tone: "rose",
  },
};

export type TranslationFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Formats a submission timestamp into a human-readable localized date string.
 */
export function formatSubmissionDate(isoString?: string | null, locale?: string): string {
  if (!isoString) {
    return "—";
  }

  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return isoString;
    }

    return date.toLocaleString(locale || undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

/**
 * Formats a submission timestamp into a relative string (Today, Yesterday, N days ago) or date.
 */
export function formatRelativeDate(
  isoString?: string | null,
  t?: TranslationFn,
  locale?: string,
): string {
  if (!isoString) {
    return "—";
  }

  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return isoString;
    }

    const now = Date.now();
    const diffMs = now - date.getTime();
    const oneDayMs = 1000 * 60 * 60 * 24;
    const diffDays = Math.floor(diffMs / oneDayMs);

    if (diffDays === 0) {
      return t ? t("teams.checkIn.relativeDate.today") : "Today";
    }

    if (diffDays === 1) {
      return t ? t("teams.checkIn.relativeDate.yesterday") : "Yesterday";
    }

    if (diffDays > 1 && diffDays < 7) {
      return t
        ? t("teams.checkIn.relativeDate.daysAgo", { count: diffDays })
        : `${diffDays} days ago`;
    }

    return date.toLocaleDateString(locale || undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoString;
  }
}

/**
 * Resolves the display label for a feeling code:
 * Uses the immutable schedule snapshot carried by each submission.
 * 2. Falls back to the stable fixed default scale ("Good", "Steady", "Stretched", "Struggling", "Need support") in all locales.
 */
export function getFeelingLabel(
  feelingCode: ManagerCheckInFeelingCode,
  snapshotOrSettings?: ManagerCheckInScheduleSnapshot | null,
): string {
  const customLabel = snapshotOrSettings?.labels?.[feelingCode];
  if (typeof customLabel === "string" && customLabel.trim().length > 0) {
    return customLabel.trim();
  }

  return DEFAULT_FEELING_LABELS[feelingCode] ?? feelingCode;
}

export const MAX_NOTE_LENGTH = 500;
