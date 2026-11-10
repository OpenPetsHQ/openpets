export const motionPetHitPadding = 8;

export interface MotionLayoutInput {
  readonly geometry: {
    readonly width: number;
    readonly height: number;
    readonly pixelsPerUnit: number;
    readonly footAnchor: { readonly x: number; readonly y: number };
  };
  readonly requestedScale: number;
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly hitboxBottomInset: number;
  readonly hitPadding: number;
  readonly flipped: boolean;
}

export interface MotionLayout {
  readonly input: MotionLayoutInput;
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly effectiveScale: number;
  readonly foot: { readonly x: number; readonly y: number };
  readonly bodyBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly hitboxBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly shellOffset: { readonly x: number; readonly y: number };
  readonly shellTransformOrigin: { readonly x: number; readonly y: number };
}

function ratio(capacity: number, extent: number): number {
  return extent === 0 ? Infinity : capacity / extent;
}

export function calculateMotionLayout(input: MotionLayoutInput): MotionLayout {
  const { geometry, requestedScale, windowWidth, windowHeight, hitboxBottomInset, hitPadding, flipped } = input;
  const values = [
    geometry.width,
    geometry.height,
    geometry.pixelsPerUnit,
    geometry.footAnchor.x,
    geometry.footAnchor.y,
    requestedScale,
    windowWidth,
    windowHeight,
    hitboxBottomInset,
    hitPadding,
  ];
  if (
    values.some((value) => !Number.isFinite(value))
    || geometry.width <= 0
    || geometry.height <= 0
    || geometry.pixelsPerUnit <= 0
    || requestedScale <= 0
    || windowWidth <= 0
    || windowHeight <= 0
    || hitboxBottomInset < 0
    || hitPadding < 0
    || geometry.footAnchor.x < 0
    || geometry.footAnchor.x > geometry.width
    || geometry.footAnchor.y < 0
    || geometry.footAnchor.y > geometry.height
  ) {
    throw new Error("Invalid Motion layout input.");
  }
  const logicalWidth = geometry.width / geometry.pixelsPerUnit;
  const logicalHeight = geometry.height / geometry.pixelsPerUnit;
  const anchorX = geometry.footAnchor.x / geometry.pixelsPerUnit;
  const anchorY = geometry.footAnchor.y / geometry.pixelsPerUnit;
  const hitboxBottom = windowHeight - hitboxBottomInset;
  const footX = windowWidth / 2;
  const footY = hitboxBottom - hitPadding;
  const maxFit = Math.min(
    ratio(footX, anchorX),
    ratio(windowWidth - footX, logicalWidth - anchorX),
    ratio(footY, anchorY),
    ratio(hitboxBottom - footY, logicalHeight - anchorY),
    ratio(windowWidth - 2 * hitPadding, logicalWidth),
    ratio(hitboxBottom - 2 * hitPadding, logicalHeight),
  );
  if (!Number.isFinite(maxFit) || maxFit <= 0) {
    throw new Error("Motion carrier has no usable envelope.");
  }
  const effectiveScale = Math.min(requestedScale, maxFit);
  return {
    input,
    logicalWidth,
    logicalHeight,
    effectiveScale,
    foot: { x: footX, y: footY },
    bodyBounds: {
      x: flipped ? footX - (logicalWidth - anchorX) * effectiveScale : footX - anchorX * effectiveScale,
      y: footY - anchorY * effectiveScale,
      width: logicalWidth * effectiveScale,
      height: logicalHeight * effectiveScale,
    },
    hitboxBounds: {
      x: (windowWidth - logicalWidth * effectiveScale - 2 * hitPadding) / 2,
      y: hitboxBottom - logicalHeight * effectiveScale - 2 * hitPadding,
      width: logicalWidth * effectiveScale + 2 * hitPadding,
      height: logicalHeight * effectiveScale + 2 * hitPadding,
    },
    shellOffset: {
      x: (logicalWidth / 2 - anchorX) * effectiveScale,
      y: (logicalHeight - anchorY) * effectiveScale,
    },
    shellTransformOrigin: {
      x: anchorX * effectiveScale,
      y: anchorY * effectiveScale,
    },
  };
}

export function motionLayoutCssVariables(layout: MotionLayout): Record<string, string> {
  return {
    "--motion-hitbox-width": `${layout.hitboxBounds.width}px`,
    "--motion-hitbox-height": `${layout.hitboxBounds.height}px`,
    "--motion-shell-width": `${layout.bodyBounds.width}px`,
    "--motion-shell-height": `${layout.bodyBounds.height}px`,
    "--motion-shell-left": `${layout.shellOffset.x}px`,
    "--motion-shell-top": `${layout.shellOffset.y}px`,
    "--motion-foot-origin-x": `${layout.shellTransformOrigin.x}px`,
    "--motion-foot-origin-y": `${layout.shellTransformOrigin.y}px`,
    "--motion-logical-width": `${layout.logicalWidth}px`,
    "--motion-logical-height": `${layout.logicalHeight}px`,
    "--motion-fit-scale": String(layout.effectiveScale),
  };
}
