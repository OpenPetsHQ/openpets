import type {
  ManagerCheckInFeelingCode,
  ManagerCheckInPromptSnapshot,
  ManagerCheckInSettings,
} from "../teams-types.js";

export const DEFAULT_FEELING_LABELS: Record<ManagerCheckInFeelingCode, string> = {
  good: "Good",
  steady: "Steady",
  stretched: "Stretched",
  struggling: "Struggling",
  need_support: "Need support",
};

export type FeelingConfig = {
  code: ManagerCheckInFeelingCode;
  defaultLabel: string;
  badgeClass: string;
  cardActiveClass: string;
  cardHoverClass: string;
  tone: "green" | "blue" | "amber" | "orange" | "rose";
};

export const FEELING_CONFIGS: Record<ManagerCheckInFeelingCode, FeelingConfig> = {
  good: {
    code: "good",
    defaultLabel: "Good",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
    cardActiveClass: "border-emerald-500 bg-emerald-50/80 text-emerald-900 ring-2 ring-emerald-300/60 dark:border-emerald-500 dark:bg-emerald-950/50 dark:text-emerald-100 dark:ring-emerald-800/80",
    cardHoverClass: "hover:border-emerald-400 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30",
    tone: "green",
  },
  steady: {
    code: "steady",
    defaultLabel: "Steady",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800",
    cardActiveClass: "border-sky-500 bg-sky-50/80 text-sky-900 ring-2 ring-sky-300/60 dark:border-sky-500 dark:bg-sky-950/50 dark:text-sky-100 dark:ring-sky-800/80",
    cardHoverClass: "hover:border-sky-400 hover:bg-sky-50/40 dark:hover:bg-sky-950/30",
    tone: "blue",
  },
  stretched: {
    code: "stretched",
    defaultLabel: "Stretched",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
    cardActiveClass: "border-amber-500 bg-amber-50/80 text-amber-900 ring-2 ring-amber-300/60 dark:border-amber-500 dark:bg-amber-950/50 dark:text-amber-100 dark:ring-amber-800/80",
    cardHoverClass: "hover:border-amber-400 hover:bg-amber-50/40 dark:hover:bg-amber-950/30",
    tone: "amber",
  },
  struggling: {
    code: "struggling",
    defaultLabel: "Struggling",
    badgeClass: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800",
    cardActiveClass: "border-orange-500 bg-orange-50/80 text-orange-900 ring-2 ring-orange-300/60 dark:border-orange-500 dark:bg-orange-950/50 dark:text-orange-100 dark:ring-orange-800/80",
    cardHoverClass: "hover:border-orange-400 hover:bg-orange-50/40 dark:hover:bg-orange-950/30",
    tone: "orange",
  },
  need_support: {
    code: "need_support",
    defaultLabel: "Need support",
    badgeClass: "bg-rose-50 text-rose-800 border-rose-300 font-bold dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-700",
    cardActiveClass: "border-rose-500 bg-rose-50/90 text-rose-950 ring-2 ring-rose-400/60 dark:border-rose-400 dark:bg-rose-950/60 dark:text-rose-100 dark:ring-rose-700/80",
    cardHoverClass: "hover:border-rose-300 hover:bg-rose-50/40 dark:hover:bg-rose-950/30",
    tone: "rose",
  },
};

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function getWeekdayName(dayIndex: number): string {
  return WEEKDAYS[dayIndex % 7] ?? "Monday";
}

/**
 * Calculates the local Monday week key (YYYY-MM-DD) for a given date in local time.
 * Monday is day 1, Sunday is day 7.
 */
export function getLocalMondayWeekKey(date: Date = new Date()): string {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = local.getDay() || 7;
  local.setDate(local.getDate() - day + 1);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(local.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
}

export function formatSubmissionDate(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return date.toLocaleString(undefined, {
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

export function formatRelativeDate(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
      return "Today";
    }
    if (diffDays === 1) {
      return "Yesterday";
    }
    if (diffDays < 7) {
      return `${diffDays} days ago`;
    }
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoString;
  }
}

export function getFeelingLabel(
  feelingCode: ManagerCheckInFeelingCode,
  snapshotOrSettings?: ManagerCheckInPromptSnapshot | ManagerCheckInSettings | null,
): string {
  if (snapshotOrSettings?.labels?.[feelingCode]) {
    return snapshotOrSettings.labels[feelingCode];
  }
  return DEFAULT_FEELING_LABELS[feelingCode] ?? feelingCode;
}

export const MAX_NOTE_LENGTH = 500;
