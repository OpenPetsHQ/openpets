/**
 * Pixel-accurate pet hit testing.
 *
 * Pet windows are transparent, frameless overlays. The element-level hit test
 * (`document.elementFromPoint` + `.pet-hitbox`/`.pet-shell` matching) treats
 * the whole rectangular sprite box as interactive, so fully transparent
 * corners and faint drop shadows still swallow clicks meant for windows
 * behind the pet. This module samples the sprite sheet's alpha channel at the
 * cursor position so only sufficiently opaque pixels count as interactive.
 *
 * Pure mapping/sampling helpers are exported for tests; the DOM-coupled
 * tester factory is used by `pet-preload.cjs`. The module must stay safe to
 * import in plain Node (no DOM access at module scope).
 */

/** Alpha (0-255) at or above which a sprite pixel counts as solid artwork. Faint shadows sit below this. */
export const PET_ALPHA_HIT_THRESHOLD = 64;

/** Sampling neighborhood: a 1px antialiased hole in an outline must not make a visible pet unclickable. */
export const PET_ALPHA_SAMPLE_RADIUS = 1;

/** Decoded sheets larger than this are rejected so a hostile/huge sheet cannot exhaust renderer memory. */
export const MAX_SPRITE_SHEET_PIXELS = 32 * 1024 * 1024;

/** Total decoded RGBA bytes one pet renderer may retain; least-recently-used sheets are evicted beyond it. */
export const MAX_SPRITE_PIXEL_CACHE_BYTES = 256 * 1024 * 1024;

export interface SpriteSheetPixels {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major, exactly `width * height * 4` bytes. */
  readonly data: Uint8ClampedArray;
}

/** Parses `url("…")`/`url('…')`/`url(…)` from a computed `background-image`; null for `none` or unparsable values. */
export function parseCssBackgroundImageUrl(value: string): string | null {
  const match = /^\s*url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?)\s*)\)\s*$/.exec(value);
  if (!match) return null;
  const url = match[1] ?? match[2] ?? match[3] ?? "";
  return url.length > 0 ? url : null;
}

/** Parses a single `<length>` in px; null for percentages, keywords, or unparsable values. */
export function parseCssPixelLength(value: string): number | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)px\s*$/.exec(value);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parses a two-component px `background-size`; null for `auto`/`cover`/`contain`/single values. */
export function parseCssBackgroundSize(value: string): { readonly width: number; readonly height: number } | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const width = parseCssPixelLength(parts[0]);
  const height = parseCssPixelLength(parts[1]);
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  return { width, height };
}

export interface SpriteHitMappingInput {
  readonly clientX: number;
  readonly clientY: number;
  /** Post-transform bounding box of the sprite element (includes scale and the shell's horizontal flip). */
  readonly rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  /** Pre-transform layout size of the sprite element (`offsetWidth`/`offsetHeight`). */
  readonly elementWidth: number;
  readonly elementHeight: number;
  /** Computed `background-position` in element-local px (negative as the sheet scrolls left/up). */
  readonly backgroundPositionX: number;
  readonly backgroundPositionY: number;
  /** Computed `background-size` in element-local px. */
  readonly backgroundWidth: number;
  readonly backgroundHeight: number;
  /** Decoded sprite sheet size in image pixels. */
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** Whether `.pet-shell` mirrors content with `scaleX(-1)`. */
  readonly flipped: boolean;
}

/**
 * Maps a client point over a sprite element to sprite-sheet pixel coordinates.
 * The result may fall outside the sheet when the cursor is over a
 * `no-repeat` area beyond the image — the sampler treats that as transparent.
 */
export function mapClientPointToSpritePixel(input: SpriteHitMappingInput): { readonly x: number; readonly y: number } {
  const { rect } = input;
  let fractionX = (input.clientX - rect.left) / rect.width;
  const fractionY = (input.clientY - rect.top) / rect.height;
  if (input.flipped) fractionX = 1 - fractionX;
  // A fraction of exactly 1 (the flipped sprite's left edge) would floor into
  // the first pixel of the adjacent sheet frame; clamp to the displayed frame's
  // last pixel instead.
  fractionX = Math.min(fractionX, 1 - 1e-9);

  const elementX = fractionX * input.elementWidth;
  const elementY = fractionY * input.elementHeight;
  const sourceX = (elementX - input.backgroundPositionX) * (input.imageWidth / input.backgroundWidth);
  const sourceY = (elementY - input.backgroundPositionY) * (input.imageHeight / input.backgroundHeight);
  return { x: Math.floor(sourceX), y: Math.floor(sourceY) };
}

/**
 * Whether the sprite sheet is opaque at a pixel, checking a small neighborhood
 * so antialiased outlines stay clickable. Out-of-range pixels are transparent.
 */
export function isSpritePixelOpaque(
  pixels: SpriteSheetPixels,
  x: number,
  y: number,
  threshold: number = PET_ALPHA_HIT_THRESHOLD,
): boolean {
  for (let dy = -PET_ALPHA_SAMPLE_RADIUS; dy <= PET_ALPHA_SAMPLE_RADIUS; dy += 1) {
    for (let dx = -PET_ALPHA_SAMPLE_RADIUS; dx <= PET_ALPHA_SAMPLE_RADIUS; dx += 1) {
      const sampleX = x + dx;
      const sampleY = y + dy;
      if (sampleX < 0 || sampleY < 0 || sampleX >= pixels.width || sampleY >= pixels.height) continue;
      if (pixels.data[(sampleY * pixels.width + sampleX) * 4 + 3] >= threshold) return true;
    }
  }
  return false;
}

// Structural DOM types: this module is bundled into the pet preload (full DOM
// available) but typechecked under the main-process tsconfig, which has no DOM
// lib. Declare only the surface the hit tester uses.
interface SpriteElementLike {
  getBoundingClientRect(): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly width: number; readonly height: number };
  readonly offsetWidth: number;
  readonly offsetHeight: number;
}

interface SpriteComputedStyleLike {
  readonly backgroundImage: string;
  readonly backgroundPositionX: string;
  readonly backgroundPositionY: string;
  readonly backgroundSize: string;
}

interface SpriteCanvasLike {
  width: number;
  height: number;
  getContext(kind: "2d", options?: { willReadFrequently?: boolean }): {
    drawImage(image: unknown, dx: number, dy: number): void;
    getImageData(sx: number, sy: number, sw: number, sh: number): { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray };
  } | null;
}

export interface PetAlphaHitTestDocument {
  querySelector(selector: string): SpriteElementLike | null;
  readonly defaultView: { getComputedStyle(element: SpriteElementLike): SpriteComputedStyleLike } | null;
  readonly documentElement: { readonly dataset: Record<string, string | undefined> };
  createElement(tagName: "canvas"): SpriteCanvasLike;
}

declare function createImageBitmap(blob: Blob): Promise<{ readonly width: number; readonly height: number; close(): void }>;

/** Decodes sprite sheet bytes into sampled RGBA pixels via an origin-clean canvas. */
export async function decodeSpriteSheetPixels(bytes: Uint8Array, document: PetAlphaHitTestDocument): Promise<SpriteSheetPixels> {
  const copy = new Uint8Array(bytes);
  const bitmap = await createImageBitmap(new Blob([copy]));
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0 || bitmap.width * bitmap.height > MAX_SPRITE_SHEET_PIXELS) {
      throw new Error(`Sprite sheet dimensions rejected: ${bitmap.width}x${bitmap.height}`);
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("2d canvas context unavailable");
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: imageData.width, height: imageData.height, data: imageData.data };
  } finally {
    bitmap.close();
  }
}

export interface PetAlphaHitTester {
  /**
   * Whether the point lands on sufficiently opaque pet artwork. Fails open
   * (returns true) whenever the sprite, its geometry, or its pixels are
   * unavailable — a broken hit test must never make the pet ungrabbable.
   */
  isOpaqueAt(clientX: number, clientY: number): boolean;
}

type SpriteCacheEntry =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly pixels: SpriteSheetPixels }
  | { readonly status: "error" };

export function createPetAlphaHitTester(options: {
  readonly document: PetAlphaHitTestDocument;
  readonly loadSpritePixels: (url: string) => Promise<SpriteSheetPixels>;
  readonly threshold?: number;
}): PetAlphaHitTester {
  const { document } = options;
  const threshold = options.threshold ?? PET_ALPHA_HIT_THRESHOLD;
  // LRU by insertion order: hits re-insert their entry at the tail, eviction
  // drops from the head. Decoded sheets are several MB each and plugins can
  // cycle sprite overrides, so the cache must stay bounded.
  const cache = new Map<string, SpriteCacheEntry>();
  let cacheBytes = 0;

  const evictOverflow = (): void => {
    for (const [url, entry] of cache) {
      if (cacheBytes <= MAX_SPRITE_PIXEL_CACHE_BYTES) return;
      if (entry.status !== "ready") continue;
      cache.delete(url);
      cacheBytes -= entry.pixels.data.byteLength;
    }
  };

  const getPixels = (url: string): SpriteSheetPixels | null => {
    const existing = cache.get(url);
    if (existing) {
      if (existing.status !== "ready") return null;
      cache.delete(url);
      cache.set(url, existing);
      return existing.pixels;
    }
    cache.set(url, { status: "loading" });
    options.loadSpritePixels(url).then((pixels) => {
      if (!cache.has(url)) return;
      cache.delete(url);
      cache.set(url, { status: "ready", pixels });
      cacheBytes += pixels.data.byteLength;
      evictOverflow();
    }).catch(() => {
      if (!cache.has(url)) return;
      cache.delete(url);
      cache.set(url, { status: "error" });
    });
    return null;
  };

  const pickSpriteElement = (): SpriteElementLike | null => {
    // A plugin sprite override visually replaces the base sprite, which is
    // hidden while the override is active — sample whichever is displayed.
    return document.querySelector(".pet-shell .plugin-sprite-override")
      ?? document.querySelector(".pet-shell .installed-sprite")
      ?? document.querySelector(".pet-shell .sprite");
  };

  const isOpaqueAt = (clientX: number, clientY: number): boolean => {
    const element = pickSpriteElement();
    if (!element) return true;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return true;
    // Outside the artwork box (e.g. the hitbox padding ring) is transparent.
    if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return false;

    const view = document.defaultView;
    if (!view) return true;
    const computed = view.getComputedStyle(element);
    const url = parseCssBackgroundImageUrl(computed.backgroundImage);
    const positionX = parseCssPixelLength(computed.backgroundPositionX);
    const positionY = parseCssPixelLength(computed.backgroundPositionY);
    const size = parseCssBackgroundSize(computed.backgroundSize);
    if (!url || positionX === null || positionY === null || !size) return true;

    const pixels = getPixels(url);
    if (!pixels) return true;

    const point = mapClientPointToSpritePixel({
      clientX,
      clientY,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      elementWidth: element.offsetWidth,
      elementHeight: element.offsetHeight,
      backgroundPositionX: positionX,
      backgroundPositionY: positionY,
      backgroundWidth: size.width,
      backgroundHeight: size.height,
      imageWidth: pixels.width,
      imageHeight: pixels.height,
      flipped: document.documentElement.dataset.flipX === "true",
    });
    return isSpritePixelOpaque(pixels, point.x, point.y, threshold);
  };

  return { isOpaqueAt };
}
