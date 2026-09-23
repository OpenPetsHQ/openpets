/**
 * Pure bitmap math for capture-session screenshots: find the visible content
 * of a transparent capture and re-frame it with even padding.
 *
 * Bitmaps are tightly packed 4-byte pixels with alpha as the fourth byte
 * (Electron's `nativeImage.toBitmap()` BGRA layout). Channel order of the
 * first three bytes is irrelevant here; only alpha is inspected.
 */

export interface CaptureBitmap {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface CaptureBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CaptureFrameOptions {
  /** Transparent margin added on every side, in bitmap pixels. */
  readonly padding: number;
  /** Pixels with alpha at or below this value count as background. */
  readonly alphaThreshold: number;
}

const bytesPerPixel = 4;

export function findVisibleBounds(bitmap: CaptureBitmap, alphaThreshold: number): CaptureBounds | null {
  assertBitmapShape(bitmap);
  let minX = bitmap.width;
  let minY = bitmap.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < bitmap.height; y += 1) {
    const rowStart = y * bitmap.width * bytesPerPixel;
    for (let x = 0; x < bitmap.width; x += 1) {
      const alpha = bitmap.data[rowStart + x * bytesPerPixel + 3] ?? 0;
      if (alpha <= alphaThreshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Crops a capture to its visible content and surrounds it with a fully
 * transparent margin, so the subject ends up centred with equal padding.
 * Returns null when nothing in the capture is visible.
 */
export function frameVisibleContent(bitmap: CaptureBitmap, options: CaptureFrameOptions): CaptureBitmap | null {
  const bounds = findVisibleBounds(bitmap, options.alphaThreshold);
  if (!bounds) return null;

  const padding = Math.max(0, Math.round(options.padding));
  const width = bounds.width + padding * 2;
  const height = bounds.height + padding * 2;
  const data = new Uint8Array(width * height * bytesPerPixel);
  const sourceRowBytes = bitmap.width * bytesPerPixel;
  const copyRowBytes = bounds.width * bytesPerPixel;

  for (let row = 0; row < bounds.height; row += 1) {
    const sourceStart = (bounds.y + row) * sourceRowBytes + bounds.x * bytesPerPixel;
    const targetStart = ((padding + row) * width + padding) * bytesPerPixel;
    data.set(bitmap.data.subarray(sourceStart, sourceStart + copyRowBytes), targetStart);
  }

  return { data, width, height };
}

function assertBitmapShape(bitmap: CaptureBitmap): void {
  const expectedBytes = bitmap.width * bitmap.height * bytesPerPixel;
  if (bitmap.data.length !== expectedBytes) {
    throw new Error(`Capture bitmap is ${bitmap.data.length} bytes; expected ${expectedBytes} for ${bitmap.width}x${bitmap.height}.`);
  }
}
