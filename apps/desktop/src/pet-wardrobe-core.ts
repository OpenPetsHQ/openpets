/**
 * Pure wardrobe contract: a pet's optional outfits (full alternate atlases with
 * the base layout), the creator schedule that picks one, the user's
 * per-pet wardrobe preferences, and the resolution of which outfit is worn at
 * a given local time. No Electron, filesystem, or clock access.
 */

/** The pet's base `spritesheetPath`, addressable in schedules and preferences. */
export const defaultOutfitId = "default";
/** Wardrobe update value meaning "follow the schedule"; reserved as an outfit id. */
export const automaticOutfitChoice = "auto";
export const maxPetOutfits = 16;
export const maxOutfitScheduleRules = 32;
const maxOutfitDisplayNameLength = 40;
const maxWardrobePreferencePets = 256;

export const outfitWeekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type OutfitWeekday = typeof outfitWeekdays[number];

export type PetOutfitSpritesheetPath = `outfits/${string}.webp` | `outfits/${string}.svg`;

export interface PetOutfit {
  readonly id: string;
  readonly displayName: string;
  readonly spritesheetPath: PetOutfitSpritesheetPath;
}

/** Local wall-clock range; `to` is exclusive and may be earlier than `from` to wrap midnight. */
export interface OutfitTimeRange {
  readonly from: string;
  readonly to: string;
}

/** Yearly `MM-DD` range, inclusive on both ends; wraps the new year when `to` is earlier. */
export interface OutfitDateRange {
  readonly from: string;
  readonly to: string;
}

/** Every present condition must match. At least one condition is required. */
export interface OutfitScheduleWhen {
  readonly time?: OutfitTimeRange;
  readonly days?: readonly OutfitWeekday[];
  readonly dates?: OutfitDateRange;
}

export interface OutfitScheduleRule {
  /** An outfit id from the same wardrobe, or {@link defaultOutfitId}. */
  readonly outfit: string;
  readonly when: OutfitScheduleWhen;
  /** Only persisted when false; a disabled rule is kept but never matches. */
  readonly enabled?: false;
}

export interface PetWardrobe {
  readonly outfits: readonly PetOutfit[];
  /** Ordered; the first matching enabled rule wins. */
  readonly schedule: readonly OutfitScheduleRule[];
}

/** The user's per-pet wardrobe choices. Absent fields fall back to the pet's own behavior. */
export interface PetWardrobePreference {
  /** "Always wear" choice. Absent means follow the schedule. */
  readonly outfit?: string;
  /** User-edited schedule replacing the creator schedule. Absent means use the creator schedule. */
  readonly schedule?: readonly OutfitScheduleRule[];
}

export type PetWardrobePreferences = Readonly<Record<string, PetWardrobePreference>>;

export function isSafeOutfitId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value);
}

/** Strictly validate the `wardrobe` field of pet.json. Throws with a creator-facing message. */
export function validatePetWardrobe(value: unknown): PetWardrobe {
  if (!isRecord(value)) throw new Error("Pet wardrobe must be an object.");
  if (!Array.isArray(value.outfits) || value.outfits.length === 0 || value.outfits.length > maxPetOutfits) {
    throw new Error(`Pet wardrobe must list between 1 and ${maxPetOutfits} outfits.`);
  }
  const outfits: PetOutfit[] = [];
  const ids = new Set<string>();
  for (const entry of value.outfits as unknown[]) {
    const outfit = validatePetOutfit(entry);
    if (ids.has(outfit.id)) throw new Error(`Pet wardrobe outfit id is duplicated: ${outfit.id}`);
    ids.add(outfit.id);
    outfits.push(outfit);
  }

  const schedule: OutfitScheduleRule[] = [];
  if (value.schedule !== undefined) {
    if (!Array.isArray(value.schedule) || value.schedule.length > maxOutfitScheduleRules) {
      throw new Error(`Pet wardrobe schedule must be an array of at most ${maxOutfitScheduleRules} rules.`);
    }
    for (const entry of value.schedule as unknown[]) {
      const rule = parseOutfitScheduleRule(entry);
      if (rule.outfit !== defaultOutfitId && !ids.has(rule.outfit)) {
        throw new Error(`Pet wardrobe schedule references an unknown outfit: ${rule.outfit}`);
      }
      schedule.push(rule);
    }
  }
  return { outfits, schedule };
}

function validatePetOutfit(value: unknown): PetOutfit {
  if (!isRecord(value)) throw new Error("Pet wardrobe outfit must be an object.");
  if (!isSafeOutfitId(value.id) || value.id === defaultOutfitId || value.id === automaticOutfitChoice) throw new Error("Pet wardrobe outfit id is invalid.");
  const displayName = typeof value.displayName === "string" ? value.displayName.trim() : "";
  if (displayName.length === 0 || displayName.length > maxOutfitDisplayNameLength) {
    throw new Error(`Pet wardrobe outfit displayName is invalid: ${value.id}`);
  }
  if (value.spritesheetPath !== `outfits/${value.id}.webp` && value.spritesheetPath !== `outfits/${value.id}.svg`) {
    throw new Error(`Pet wardrobe outfit spritesheetPath must be outfits/${value.id}.webp or outfits/${value.id}.svg.`);
  }
  return { id: value.id, displayName, spritesheetPath: value.spritesheetPath as PetOutfitSpritesheetPath };
}

/** Parse one schedule rule; throws on any malformed field. Outfit existence is the caller's concern. */
export function parseOutfitScheduleRule(value: unknown): OutfitScheduleRule {
  if (!isRecord(value)) throw new Error("Outfit schedule rule must be an object.");
  if (!isSafeOutfitId(value.outfit)) throw new Error("Outfit schedule rule outfit is invalid.");
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") throw new Error("Outfit schedule rule enabled must be a boolean.");
  if (!isRecord(value.when)) throw new Error("Outfit schedule rule needs a when object.");

  const when: { time?: OutfitTimeRange; days?: readonly OutfitWeekday[]; dates?: OutfitDateRange } = {};
  if (value.when.time !== undefined) {
    const time = value.when.time;
    if (!isRecord(time) || parseClockMinutes(time.from) === null || parseClockMinutes(time.to) === null || time.from === time.to) {
      throw new Error("Outfit schedule time must have different from/to values in HH:MM.");
    }
    when.time = { from: time.from as string, to: time.to as string };
  }
  if (value.when.days !== undefined) {
    const days = value.when.days;
    if (!Array.isArray(days) || days.length === 0 || days.some((day) => !outfitWeekdays.includes(day as OutfitWeekday))) {
      throw new Error("Outfit schedule days must be a non-empty list of sun..sat.");
    }
    when.days = outfitWeekdays.filter((day) => days.includes(day));
  }
  if (value.when.dates !== undefined) {
    const dates = value.when.dates;
    if (!isRecord(dates) || parseMonthDay(dates.from) === null || parseMonthDay(dates.to) === null) {
      throw new Error("Outfit schedule dates must have from/to values in MM-DD.");
    }
    when.dates = { from: dates.from as string, to: dates.to as string };
  }
  if (!when.time && !when.days && !when.dates) throw new Error("Outfit schedule rule needs at least one condition.");
  return { outfit: value.outfit, when, ...(value.enabled === false ? { enabled: false as const } : {}) };
}

/** Lenient schedule normalization for persisted user preferences: invalid rules are dropped. */
export function normalizeOutfitSchedule(value: unknown): readonly OutfitScheduleRule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rules: OutfitScheduleRule[] = [];
  for (const entry of value.slice(0, maxOutfitScheduleRules)) {
    try {
      rules.push(parseOutfitScheduleRule(entry));
    } catch {
      // A malformed persisted rule is dropped; the remaining order is preserved.
    }
  }
  return rules;
}

export function normalizePetWardrobePreferences(value: unknown): PetWardrobePreferences | undefined {
  if (!isRecord(value) || Array.isArray(value)) return undefined;
  const normalized: Record<string, PetWardrobePreference> = {};
  for (const [petId, raw] of Object.entries(value).slice(0, maxWardrobePreferencePets)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(petId) || !isRecord(raw)) continue;
    const preference = normalizePetWardrobePreference(raw);
    if (preference) normalized[petId] = preference;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizePetWardrobePreference(value: unknown): PetWardrobePreference | undefined {
  if (!isRecord(value)) return undefined;
  const outfit = isSafeOutfitId(value.outfit) ? value.outfit : undefined;
  const schedule = normalizeOutfitSchedule(value.schedule);
  if (outfit === undefined && schedule === undefined) return undefined;
  return { ...(outfit !== undefined ? { outfit } : {}), ...(schedule !== undefined ? { schedule } : {}) };
}

/** The schedule in effect for a pet: the user's edited copy, else the creator's. */
export function getEffectiveOutfitSchedule(wardrobe: PetWardrobe, preference: PetWardrobePreference | undefined): readonly OutfitScheduleRule[] {
  return preference?.schedule ?? wardrobe.schedule;
}

/**
 * Resolve the outfit a pet wears at `now` (local time). Unknown outfit ids in
 * preferences or rules are ignored, so a pet update that drops an outfit falls
 * back gracefully instead of breaking the pet.
 */
export function resolveWornOutfitId(wardrobe: PetWardrobe | undefined, preference: PetWardrobePreference | undefined, now: Date): string {
  if (!wardrobe) return defaultOutfitId;
  if (preference?.outfit !== undefined && isWardrobeOutfit(wardrobe, preference.outfit)) return preference.outfit;
  const schedule = getEffectiveOutfitSchedule(wardrobe, preference);
  return schedule[findActiveOutfitRuleIndex(wardrobe, schedule, now)]?.outfit ?? defaultOutfitId;
}

/** Index of the first enabled rule that matches `now` and names a known outfit, or -1. */
export function findActiveOutfitRuleIndex(wardrobe: PetWardrobe, schedule: readonly OutfitScheduleRule[], now: Date): number {
  return schedule.findIndex((rule) => rule.enabled !== false && isWardrobeOutfit(wardrobe, rule.outfit) && matchesOutfitScheduleWhen(rule.when, now));
}

/** Whether `id` is the default outfit or one declared by this wardrobe. */
export function isWardrobeOutfit(wardrobe: PetWardrobe, id: unknown): id is string {
  return id === defaultOutfitId || wardrobe.outfits.some((outfit) => outfit.id === id);
}

export function matchesOutfitScheduleWhen(when: OutfitScheduleWhen, now: Date): boolean {
  if (when.days && !when.days.includes(outfitWeekdays[now.getDay()])) return false;
  if (when.time) {
    const minutes = now.getHours() * 60 + now.getMinutes();
    const from = parseClockMinutes(when.time.from);
    const to = parseClockMinutes(when.time.to);
    if (from === null || to === null) return false;
    const inside = from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
    if (!inside) return false;
  }
  if (when.dates) {
    const today = (now.getMonth() + 1) * 100 + now.getDate();
    const from = parseMonthDay(when.dates.from);
    const to = parseMonthDay(when.dates.to);
    if (from === null || to === null) return false;
    const inside = from <= to ? today >= from && today <= to : today >= from || today <= to;
    if (!inside) return false;
  }
  return true;
}

function parseClockMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function parseMonthDay(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return null;
  return month * 100 + day;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
