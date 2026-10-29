import type { CodexPetGazeAnchor } from "@open-pets/pet-format/metadata";

export const maxCodexThumbnailSourceBytes = 24 * 1024 * 1024;
export const maxCodexPets = 100;

export const codexV2GazeSectorCount = 16;
export const codexV2GazeSectorAngle = (Math.PI * 2) / codexV2GazeSectorCount;
export const codexV2GazeDeadZonePx = 24;
export const codexV2GazeIdleResetMs = 1_200;

export interface CodexV2GazePoint {
  readonly x: number;
  readonly y: number;
}

export interface CodexV2GazeCarrierBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Resolve a normalized frame anchor against the base-scale card origin and the
 * sprite's effective transform scale. Omission preserves the legacy carrier
 * bottom-center anchor.
 */
export function getCodexV2GazeAnchorPoint(
  bounds: CodexV2GazeCarrierBounds,
  frame: { readonly width: number; readonly height: number },
  layoutScale: number,
  spriteScaleOverride: number | null,
  gazeAnchor: CodexPetGazeAnchor | undefined,
  flipped: boolean,
  spriteBottomInset: number,
): CodexV2GazePoint {
  if (!gazeAnchor) return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height };

  const layoutFrameWidth = Math.ceil(frame.width * layoutScale);
  const layoutFrameHeight = Math.ceil(frame.height * layoutScale);
  const spriteLeft = bounds.x + (bounds.width - layoutFrameWidth) / 2;
  const spriteTop = bounds.y + bounds.height - spriteBottomInset - layoutFrameHeight;
  const spriteScale = spriteScaleOverride ?? layoutScale;
  const frameAnchorX = gazeAnchor.x * frame.width * spriteScale;
  return {
    x: spriteLeft + (flipped ? layoutFrameWidth - frameAnchorX : frameAnchorX),
    y: spriteTop + gazeAnchor.y * frame.height * spriteScale,
  };
}

export function isCodexV2GazeActive(lastCursorMovedAt: number | null, now: number, idleResetMs = codexV2GazeIdleResetMs): boolean {
  return lastCursorMovedAt !== null
    && Number.isFinite(lastCursorMovedAt)
    && Number.isFinite(now)
    && Number.isFinite(idleResetMs)
    && idleResetMs > 0
    && now - lastCursorMovedAt < idleResetMs;
}

export interface CodexV2GazeSpritePosition {
  readonly row: 9 | 10;
  readonly column: number;
}

export interface CodexV2GazeEligibility {
  readonly spriteVersion: 1 | 2;
  readonly idleCursorGazeEnabled: boolean;
  readonly paused: boolean;
  readonly reactionState: string;
  readonly motionState: string;
  readonly pluginSpriteOverride: boolean;
}

export function shouldTrackCodexV2Gaze(state: CodexV2GazeEligibility): boolean {
  return state.spriteVersion === 2
    && state.idleCursorGazeEnabled
    && !state.paused
    && state.reactionState === "idle"
    && state.motionState === "idle"
    && !state.pluginSpriteOverride;
}

/**
 * Quantize a cursor point around the pet carrier's bottom-center anchor.
 * Index zero points up and indices increase clockwise in 22.5 degree steps.
 */
export function quantizeCodexV2GazeDirection(
  cursor: CodexV2GazePoint,
  anchor: CodexV2GazePoint,
  deadZonePx = codexV2GazeDeadZonePx,
): number | null {
  if (!isFinitePoint(cursor) || !isFinitePoint(anchor) || !Number.isFinite(deadZonePx) || deadZonePx < 0) return null;
  const dx = cursor.x - anchor.x;
  const dy = cursor.y - anchor.y;
  if (Math.hypot(dx, dy) <= deadZonePx) return null;

  const angle = Math.atan2(dx, -dy);
  const sector = Math.floor((angle + codexV2GazeSectorAngle / 2) / codexV2GazeSectorAngle);
  return (sector + codexV2GazeSectorCount) % codexV2GazeSectorCount;
}

/** Mirror a gaze index before the renderer applies its horizontal CSS flip. */
export function mirrorCodexV2GazeIndex(index: number): number | null {
  if (!isCodexV2GazeIndex(index)) return null;
  return (codexV2GazeSectorCount - index) % codexV2GazeSectorCount;
}

/** Return the static V2 atlas cell for a gaze index, optionally flip-compensated. */
export function getCodexV2GazeSpritePosition(index: number, flipped = false): CodexV2GazeSpritePosition | null {
  if (!isCodexV2GazeIndex(index)) return null;
  const selectedIndex = flipped ? mirrorCodexV2GazeIndex(index) : index;
  if (selectedIndex === null) return null;
  return selectedIndex < 8
    ? { row: 9, column: selectedIndex }
    : { row: 10, column: selectedIndex - 8 };
}

function isCodexV2GazeIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < codexV2GazeSectorCount;
}

function isFinitePoint(value: unknown): value is CodexV2GazePoint {
  return typeof value === "object"
    && value !== null
    && Number.isFinite((value as { readonly x?: unknown }).x)
    && Number.isFinite((value as { readonly y?: unknown }).y);
}
