export type LocalDate = `${number}-${number}-${number}`;

export type ManagerCheckInRecurrence =
  | {
      readonly kind: "daily";
      readonly intervalDays: number;
      readonly startsOn: string;
    }
  | {
      readonly kind: "weekly";
      readonly intervalWeeks: number;
      readonly startsOn: string;
      readonly weekdays: readonly number[];
    }
  | {
      readonly kind: "monthly";
      readonly intervalMonths: number;
      readonly startsOn: string;
      readonly dates: readonly number[];
    }
  | {
      readonly kind: "monthly";
      readonly intervalMonths: number;
      readonly startsOn: string;
      readonly lastDay: true;
    }
  | {
      readonly kind: "quarterly";
      readonly startsOn: string;
      readonly quarterMonths: readonly number[];
      readonly dates: readonly number[];
    }
  | {
      readonly kind: "quarterly";
      readonly startsOn: string;
      readonly quarterMonths: readonly number[];
      readonly lastDay: true;
    };

export type ManagerCheckInScheduleLike = {
  readonly id: string;
  readonly revision: number;
  readonly enabled: boolean;
  readonly recurrence: ManagerCheckInRecurrence;
};

export function localDateFromDate(value: Date): string {
  return formatLocalDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function isRecurrenceDueOnDate(recurrence: ManagerCheckInRecurrence, date: string): boolean {
  assertLocalDate(date);
  if (date < recurrence.startsOn) return false;

  if (recurrence.kind === "daily") {
    return daysBetween(recurrence.startsOn, date) % recurrence.intervalDays === 0;
  }

  if (recurrence.kind === "weekly") {
    const startsWeek = mondayOf(recurrence.startsOn);
    const dateWeek = mondayOf(date);
    const weeks = Math.floor(daysBetween(startsWeek, dateWeek) / 7);
    return weeks % recurrence.intervalWeeks === 0 && recurrence.weekdays.includes(weekday(date));
  }

  if (recurrence.kind === "monthly") {
    const months = monthDistance(recurrence.startsOn, date);
    return months % recurrence.intervalMonths === 0 && monthSelectionMatches(recurrence, date);
  }

  const monthOffset = ((monthNumber(date) - 1) % 3) + 1;
  return recurrence.quarterMonths.includes(monthOffset) && monthSelectionMatches(recurrence, date);
}

export function cycleKey(scheduleId: string, date: string): string {
  assertLocalDate(date);
  return `${scheduleId}:${date}`;
}

function monthSelectionMatches(
  recurrence: { readonly dates: readonly number[] } | { readonly lastDay: true },
  date: string,
): boolean {
  const day = dayNumber(date);
  return "lastDay" in recurrence
    ? day === daysInMonth(date.slice(0, 7))
    : recurrence.dates.includes(day);
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function mondayOf(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const offset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function monthDistance(from: string, to: string): number {
  return (yearNumber(to) - yearNumber(from)) * 12 + monthNumber(to) - monthNumber(from);
}

function daysInMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatLocalDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function assertLocalDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Local date is invalid.");
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(value.slice(0, 7))) {
    throw new Error("Local date is invalid.");
  }
}

function yearNumber(date: string): number {
  return Number(date.slice(0, 4));
}

function monthNumber(date: string): number {
  return Number(date.slice(5, 7));
}

function dayNumber(date: string): number {
  return Number(date.slice(8, 10));
}
