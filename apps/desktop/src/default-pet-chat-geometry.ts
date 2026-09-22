import { defaultPetWindowSize, type Point, type WindowSize } from "./display.js";

export const expandedPetWindowSize: WindowSize = {
  width: 420,
  height: 640,
};

/**
 * Practice session overlay geometry. The orb wraps the pet, so its radius —
 * and from it the whole carrier height — derives from the pet's scaled sprite
 * size. Width stays fixed: the session card needs room for the step track and
 * pattern chips regardless of pet scale. Tuned while dogfooding breathing.
 */
export const sessionPetWindowWidth = 460;
/** Clearance above the orb for its rim glow. */
export const sessionOrbTopGap = 16;

export function calculateSessionOrbRadius(scaledSpriteHeight: number): number {
  return Math.max(110, Math.min(240, Math.round(scaledSpriteHeight)));
}
/** Breathing card. The CSS fallback uses this so a breath session does not open tall. */
export const sessionBreathingCardEstimatedHeight = 268;
/** PMR card, including the fixed pose-illustration well and cues row. */
export const sessionPmrCardEstimatedHeight = 537;
export const sessionCardEstimatedHeight = sessionBreathingCardEstimatedHeight;
export const sessionCardBottomInset = 14;
export const sessionOrbCardGap = 10;


export function calculateSessionWindowSize(scaledSpriteHeight: number, cardEstimatedHeight = sessionCardEstimatedHeight): WindowSize {
  const orbRadius = calculateSessionOrbRadius(scaledSpriteHeight);
  const height = sessionOrbTopGap
    + orbRadius * 2
    + sessionOrbCardGap
    + cardEstimatedHeight
    + sessionCardBottomInset;
  return { width: sessionPetWindowWidth, height };
}

export const defaultPetChatPanelLayout = {
  width: 390,
  minHeight: 220,
  maxHeight: 500,
  /** Legacy contract ceiling for tests/consumers */
  height: 500,
  gap: 10,
  top: 14,
  insetX: Math.round((expandedPetWindowSize.width - 390) / 2),
};

/**
 * Calculates the distance from the bottom of the carrier window to the bottom edge
 * of the expanded chat panel, preserving a consistent gap above the scaled pet.
 */
export function calculateChatPanelBottom(
  scaledSpriteHeight: number,
  petBottom = 22,
  gap = defaultPetChatPanelLayout.gap,
  pinnedLift = 0,
): number {
  return Math.ceil(petBottom + scaledSpriteHeight + gap) + pinnedLift;
}

/**
 * Calculates the top-left y coordinate for the chat panel within carrier window bounds,
 * anchoring the panel directly above the pet so it grows upward toward maxHeight.
 */
export function calculateChatPanelY(
  windowHeight: number,
  panelHeight: number,
  panelBottom: number,
): number {
  return Math.max(0, windowHeight - panelBottom - panelHeight);
}

export interface CarrierGeometryTransformOptions {
  readonly position: Point;
  readonly fromSize?: WindowSize;
  readonly toSize?: WindowSize;
  readonly workArea?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/**
 * Transforms a carrier window's top-left position from collapsed coordinates
 * to expanded coordinates so that the pet's on-screen bottom-center anchor
 * point remains perfectly stationary.
 */
export function toExpandedPosition(
  collapsedPosition: Point,
  collapsedSize: WindowSize = defaultPetWindowSize,
  expandedSize: WindowSize = expandedPetWindowSize,
): Point {
  return {
    x: Math.round(collapsedPosition.x + (collapsedSize.width - expandedSize.width) / 2),
    y: Math.round(collapsedPosition.y + (collapsedSize.height - expandedSize.height)),
  };
}

/**
 * Transforms a carrier window's top-left position from expanded coordinates
 * back to collapsed coordinates, preserving the exact on-screen pet anchor.
 */
export function toCollapsedPosition(
  expandedPosition: Point,
  expandedSize: WindowSize = expandedPetWindowSize,
  collapsedSize: WindowSize = defaultPetWindowSize,
): Point {
  return {
    x: Math.round(expandedPosition.x + (expandedSize.width - collapsedSize.width) / 2),
    y: Math.round(expandedPosition.y + (expandedSize.height - collapsedSize.height)),
  };
}

/**
 * Computes the target bounds when expanding the carrier window, clamping to the
 * work area if necessary so the attached panel is not clipped off-screen.
 */
export function calculateExpandedCarrierBounds(
  collapsedPosition: Point,
  collapsedSize: WindowSize = defaultPetWindowSize,
  expandedSize: WindowSize = expandedPetWindowSize,
  workArea?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const raw = toExpandedPosition(collapsedPosition, collapsedSize, expandedSize);
  if (!workArea) {
    return { ...raw, width: expandedSize.width, height: expandedSize.height };
  }

  const minX = workArea.x;
  const minY = workArea.y;
  const maxX = workArea.x + Math.max(0, workArea.width - expandedSize.width);
  const maxY = workArea.y + Math.max(0, workArea.height - expandedSize.height);

  return {
    x: Math.min(maxX, Math.max(minX, raw.x)),
    y: Math.min(maxY, Math.max(minY, raw.y)),
    width: expandedSize.width,
    height: expandedSize.height,
  };
}

/**
 * Computes the target bounds when collapsing the carrier window back to normal size.
 */
export function calculateCollapsedCarrierBounds(
  expandedPosition: Point,
  expandedSize: WindowSize = expandedPetWindowSize,
  collapsedSize: WindowSize = defaultPetWindowSize,
  workArea?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const raw = toCollapsedPosition(expandedPosition, expandedSize, collapsedSize);
  if (!workArea) {
    return { ...raw, width: collapsedSize.width, height: collapsedSize.height };
  }

  const minX = workArea.x;
  const minY = workArea.y;
  const maxX = workArea.x + Math.max(0, workArea.width - collapsedSize.width);
  const maxY = workArea.y + Math.max(0, workArea.height - collapsedSize.height);

  return {
    x: Math.min(maxX, Math.max(minX, raw.x)),
    y: Math.min(maxY, Math.max(minY, raw.y)),
    width: collapsedSize.width,
    height: collapsedSize.height,
  };
}
