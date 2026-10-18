// Renderer-side wardrobe shapes and pure helpers for the rule editor. The
// authoritative contract and validation live in the main process
// (`src/pet-wardrobe-core.ts`); these mirror the snapshot it sends.

export const defaultOutfitId = "default";
export const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = typeof weekdays[number];

export type WardrobeRule = {
  readonly outfit: string;
  readonly when: {
    readonly time?: { readonly from: string; readonly to: string };
    readonly days?: readonly Weekday[];
    readonly dates?: { readonly from: string; readonly to: string };
  };
  readonly enabled?: false;
};

export type PetWardrobeSnapshot = {
  readonly petId: string;
  readonly outfits: ReadonlyArray<{ readonly id: string; readonly displayName: string }>;
  readonly creatorSchedule: readonly WardrobeRule[];
  readonly schedule: readonly WardrobeRule[];
  readonly scheduleCustomized: boolean;
  readonly choice: string;
  readonly wearing: string;
  readonly scheduled: string;
  readonly activeRuleIndex: number;
};

/** `outfit: "auto"` follows the schedule; `schedule: null` restores the creator schedule. */
export type PetWardrobeUpdate = {
  readonly outfit?: string;
  readonly schedule?: readonly WardrobeRule[] | null;
};

export type OutfitRuleDraft = {
  readonly outfit: string;
  readonly useTime: boolean;
  readonly timeFrom: string;
  readonly timeTo: string;
  readonly useDays: boolean;
  readonly days: readonly Weekday[];
  readonly useDates: boolean;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly enabled: boolean;
};

export function emptyRuleDraft(outfit: string): OutfitRuleDraft {
  return { outfit, useTime: true, timeFrom: "22:00", timeTo: "07:00", useDays: false, days: ["sat", "sun"], useDates: false, dateFrom: "12-20", dateTo: "12-26", enabled: true };
}

export function ruleDraftFromRule(rule: WardrobeRule): OutfitRuleDraft {
  const base = emptyRuleDraft(rule.outfit);
  return {
    ...base,
    useTime: Boolean(rule.when.time),
    timeFrom: rule.when.time?.from ?? base.timeFrom,
    timeTo: rule.when.time?.to ?? base.timeTo,
    useDays: Boolean(rule.when.days),
    days: rule.when.days ?? base.days,
    useDates: Boolean(rule.when.dates),
    dateFrom: rule.when.dates?.from ?? base.dateFrom,
    dateTo: rule.when.dates?.to ?? base.dateTo,
    enabled: rule.enabled !== false,
  };
}

/** Build a rule from the editor draft, or the i18n key explaining why it is not valid yet. */
export function ruleFromDraft(draft: OutfitRuleDraft): { readonly ok: true; readonly rule: WardrobeRule } | { readonly ok: false; readonly reason: string } {
  if (!draft.useTime && !draft.useDays && !draft.useDates) return { ok: false, reason: "pets.wardrobe.error.noCondition" };
  if (draft.useTime && (!draft.timeFrom || !draft.timeTo || draft.timeFrom === draft.timeTo)) return { ok: false, reason: "pets.wardrobe.error.time" };
  if (draft.useDays && draft.days.length === 0) return { ok: false, reason: "pets.wardrobe.error.days" };
  return {
    ok: true,
    rule: {
      outfit: draft.outfit,
      when: {
        ...(draft.useTime ? { time: { from: draft.timeFrom, to: draft.timeTo } } : {}),
        ...(draft.useDays ? { days: weekdays.filter((day) => draft.days.includes(day)) } : {}),
        ...(draft.useDates ? { dates: { from: draft.dateFrom, to: draft.dateTo } } : {}),
      },
      ...(draft.enabled ? {} : { enabled: false as const }),
    },
  };
}

/** Human summary such as "Sat, Sun · 22:00–07:00" in the viewer's locale. */
export function describeOutfitRule(rule: WardrobeRule, locale: string, t: (key: string) => string): string {
  const parts: string[] = [];
  if (rule.when.dates) parts.push(`${formatMonthDay(rule.when.dates.from, locale)} – ${formatMonthDay(rule.when.dates.to, locale)}`);
  if (rule.when.days) parts.push(describeDays(rule.when.days, locale, t));
  if (rule.when.time) parts.push(`${rule.when.time.from}–${rule.when.time.to}`);
  return parts.join(" · ");
}

function describeDays(days: readonly Weekday[], locale: string, t: (key: string) => string): string {
  const key = [...days].sort((a, b) => weekdays.indexOf(a) - weekdays.indexOf(b)).join(",");
  if (key === weekdays.join(",")) return t("pets.wardrobe.days.everyDay");
  if (key === "mon,tue,wed,thu,fri") return t("pets.wardrobe.days.weekdays");
  if (key === "sun,sat") return t("pets.wardrobe.days.weekends");
  const format = new Intl.DateTimeFormat(locale, { weekday: "short" });
  // 2023-01-01 was a Sunday, so day offsets line up with `weekdays`.
  return days.map((day) => format.format(new Date(2023, 0, 1 + weekdays.indexOf(day)))).join(", ");
}

function formatMonthDay(value: string, locale: string): string {
  const [month, day] = value.split("-").map(Number);
  // A leap year keeps Feb 29 representable.
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(2000, month - 1, day));
}
