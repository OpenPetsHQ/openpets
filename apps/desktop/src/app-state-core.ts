export interface OnboardingPreferenceLike {
  readonly onboardingCompleted?: unknown;
}

export const petScaleOptions = [
  { label: "XS", value: 0.5 },
  { label: "Small", value: 0.75 },
  { label: "Medium", value: 1 },
  { label: "Large", value: 1.25 },
  { label: "Huge", value: 1.5 },
] as const;
export type PetScaleValue = typeof petScaleOptions[number]["value"];
export const defaultPetScale: PetScaleValue = 1;

// Scale for the pinned plugin bubble (the HUD under the pet). Deliberately a
// separate preference from petScale: pet size is aesthetic, HUD size is about
// readability.
export const hudScaleOptions = [
  { label: "XS", value: 0.85 },
  { label: "Small", value: 1.1 },
  { label: "Medium", value: 1.4 },
  { label: "Large", value: 1.7 },
  { label: "Huge", value: 2 },
] as const;
export type HudScaleValue = typeof hudScaleOptions[number]["value"];
export const defaultHudScale: HudScaleValue = 1.4;

export function getHudScaleForPetScale(petScale: PetScaleValue): HudScaleValue {
  switch (petScale) {
    case 0.5:
      return 0.85;
    case 0.75:
      return 1.1;
    case 1:
      return 1.4;
    case 1.25:
      return 1.7;
    case 1.5:
      return 2;
    default:
      return normalizeHudScale(petScale);
  }
}

// On-pet assistant buttons (chat launcher + talk button): which corner of the
// pet they sit in and how large they render. Labels live in the locale catalog
// (`settings.assistant.buttons.*`).
export type PetButtonsPosition = "right" | "left";
export const defaultPetButtonsPosition: PetButtonsPosition = "right";
export function normalizePetButtonsPosition(value: unknown): PetButtonsPosition {
  return value === "left" || value === "right" ? value : defaultPetButtonsPosition;
}

export type PetButtonsSize = "small" | "medium" | "large";
export const defaultPetButtonsSize: PetButtonsSize = "medium";
export function normalizePetButtonsSize(value: unknown): PetButtonsSize {
  return value === "small" || value === "medium" || value === "large" ? value : defaultPetButtonsSize;
}

export const waitingAnimationDurationOptions = [
  { value: 1010, label: "Normal" },
  { value: 2200, label: "Relaxed" },
] as const;
export type WaitingAnimationDurationMs = typeof waitingAnimationDurationOptions[number]["value"];
export const defaultWaitingAnimationDurationMs: WaitingAnimationDurationMs = waitingAnimationDurationOptions[0].value;

/** Whether idle V2 pets follow the global cursor by default. */
export const defaultIdleCursorGazeEnabled = true;

export function normalizeIdleCursorGazeEnabled(value: unknown, defaultValue = defaultIdleCursorGazeEnabled): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

export const appearanceThemeOptions = ["system", "light", "dark"] as const;
export type AppearanceTheme = typeof appearanceThemeOptions[number];
export const defaultAppearanceTheme: AppearanceTheme = "system";

export function normalizeAppearanceTheme(value: unknown): AppearanceTheme {
  return appearanceThemeOptions.find((option) => option === value) ?? defaultAppearanceTheme;
}

export function normalizeWaitingAnimationDurationMs(value: unknown): WaitingAnimationDurationMs {
  return waitingAnimationDurationOptions.find((option) => option.value === value)?.value ?? defaultWaitingAnimationDurationMs;
}

export function normalizePetScale(value: unknown): PetScaleValue {
  return petScaleOptions.find((option) => option.value === value)?.value ?? defaultPetScale;
}

export function normalizeHudScale(value: unknown): HudScaleValue {
  return hudScaleOptions.find((option) => option.value === value)?.value ?? defaultHudScale;
}

export function normalizeOnboardingCompleted(value: OnboardingPreferenceLike): boolean {
  return typeof value.onboardingCompleted === "boolean" ? value.onboardingCompleted : false;
}

export function markOnboardingCompleted<T extends { readonly preferences: Record<string, unknown> }>(state: T): T {
  return {
    ...state,
    preferences: {
      ...state.preferences,
      onboardingCompleted: true,
    },
  };
}

/**
 * Derive a stable string key for a display from its geometry.
 * Format: `"${x},${y},${width}x${height}"`.
 * Display IDs can change across reboots on some platforms, so we key on
 * physical bounds instead.
 */
export function deriveDisplayKey(bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): string {
  return `${bounds.x},${bounds.y},${bounds.width}x${bounds.height}`;
}

export function shouldShowDefaultPetForExternalEvent(_visible: boolean, _openOnLaunch: boolean, paused: boolean): boolean {
  // Agent activity is an explicit display trigger; open-on-launch only controls startup.
  return !paused;
}

/**
 * Normalize the petConfinementEnabled preference value.
 * Default is true (confinement on). Non-boolean values fall back to the default.
 */
export function normalizePetConfinementEnabled(value: unknown, defaultValue = true): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

/**
 * Normalize the petCrossDisplayEnabled preference value.
 * Default is false (cross-display roaming off). Non-boolean values fall back to the default.
 */
export function normalizePetCrossDisplayEnabled(value: unknown, defaultValue = false): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

/**
 * Normalize the petGravityEnabled preference value.
 * Default is false (gravity off). Non-boolean values fall back to the default.
 */
export function normalizePetGravityEnabled(value: unknown, defaultValue = false): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

const safePetIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function isSafeFlipPetId(petId: string): boolean {
  return safePetIdPattern.test(petId);
}

/**
 * Normalize per-pet horizontal flip preferences.
 * Only `true` values for valid pet IDs are retained; false is the default and is omitted.
 */
export function normalizePetHorizontalFlip(value: unknown): Readonly<Record<string, boolean>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const normalized: Record<string, boolean> = {};
  for (const [key, rawVal] of Object.entries(value)) {
    if (!isSafeFlipPetId(key) || rawVal !== true) continue;
    normalized[key] = true;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * Toggle one pet's horizontal flip without affecting other pets.
 * Returns the next persisted map, or undefined when no pets remain flipped.
 */
export function togglePetHorizontalFlipMap(current: unknown, petId: string): Readonly<Record<string, boolean>> | undefined {
  if (!isSafeFlipPetId(petId)) {
    throw new Error(`Invalid pet id for horizontal flip: ${petId}`);
  }
  const next: Record<string, boolean> = { ...(normalizePetHorizontalFlip(current) ?? {}) };
  if (next[petId]) delete next[petId];
  else next[petId] = true;
  return normalizePetHorizontalFlip(next);
}
