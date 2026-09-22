/**
 * The persisted position state for the default pet.
 *
 * This module deliberately has no Electron or app-state dependencies.  It owns
 * the shape and rules for the flat fallback position and the bounded,
 * insertion-ordered per-monitor position map.
 */

export interface DefaultPetPosition {
  readonly x: number;
  readonly y: number;
}

export interface DefaultPetPositionState {
  readonly position?: DefaultPetPosition;
  readonly perMonitorPositions?: Readonly<Record<string, DefaultPetPosition>>;
}

export const maxPerMonitorPositions = 8;

/** Return true for the stable display key format used by persisted positions. */
export function isDisplayKey(value: unknown): value is string {
  return typeof value === "string" && /^-?\d+,-?\d+,\d+x\d+$/.test(value);
}

/** Normalize a coordinate pair, rejecting missing and non-finite coordinates. */
export function normalizePosition(value: unknown): DefaultPetPosition | undefined {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") {
    return undefined;
  }

  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    return undefined;
  }

  return {
    x: Math.round(value.x),
    y: Math.round(value.y),
  };
}

/** Normalize persisted state, including invalid-entry filtering and the LRU cap. */
export function normalizeDefaultPetPositionState(value: unknown): DefaultPetPositionState {
  const record = isRecord(value) ? value : {};
  const position = normalizePosition(record.position);
  const perMonitorPositions = normalizePerMonitorPositions(record.perMonitorPositions);

  return {
    ...(position ? { position } : {}),
    ...(perMonitorPositions ? { perMonitorPositions } : {}),
  };
}

/**
 * Record one position atomically in both persisted representations.
 *
 * An invalid display key is intentionally not an error: the flat position is
 * still updated while the valid monitor map is retained unchanged.  A bad
 * coordinate pair is rejected without changing either representation.
 */
export function recordDefaultPetPositionState(
  value: DefaultPetPositionState,
  position: unknown,
  displayKey: unknown,
): DefaultPetPositionState {
  const normalizedState = normalizeDefaultPetPositionState(value);
  const normalizedPosition = normalizePosition(position);
  if (!normalizedPosition) return normalizedState;

  if (!isDisplayKey(displayKey)) {
    return {
      ...normalizedState,
      position: normalizedPosition,
    };
  }

  const entries = Object.entries(normalizedState.perMonitorPositions ?? {})
    .filter(([key]) => key !== displayKey);
  entries.push([displayKey, normalizedPosition]);

  return {
    position: normalizedPosition,
    perMonitorPositions: Object.fromEntries(entries.slice(-maxPerMonitorPositions)),
  };
}

/** Replace the flat position and clear every per-monitor entry atomically. */
export function resetDefaultPetPositionState(position: unknown): DefaultPetPositionState {
  const normalizedPosition = normalizePosition(position);
  return normalizedPosition ? { position: normalizedPosition } : {};
}

function normalizePerMonitorPositions(value: unknown): Readonly<Record<string, DefaultPetPosition>> | undefined {
  if (!isRecord(value)) return undefined;

  const normalizedEntries: Array<readonly [string, DefaultPetPosition]> = [];
  for (const [key, rawPosition] of Object.entries(value)) {
    if (!isDisplayKey(key)) continue;
    const position = normalizePosition(rawPosition);
    if (position) normalizedEntries.push([key, position]);
  }

  const entries = normalizedEntries.slice(-maxPerMonitorPositions);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
