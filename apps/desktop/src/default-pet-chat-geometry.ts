import { defaultPetWindowSize, type Point, type WindowSize } from "./display.js";

export const expandedPetWindowSize: WindowSize = {
  width: 420,
  height: 640,
};

export const defaultPetChatPanelLayout = {
  width: 390,
  height: 500,
  top: 14,
  insetX: Math.round((expandedPetWindowSize.width - 390) / 2),
};

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
