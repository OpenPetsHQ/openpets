import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type Vips from "wasm-vips";
import type { ImageDecoder, ImageMetadata } from "@open-pets/pet-format/node/atlas-validation";

type VipsModule = Awaited<ReturnType<typeof Vips>>;

/** Load the unbundled Node ESM entry and sibling WASM files from the extension. */
export async function loadWebpDecoder(resourceDirectory: string): Promise<ImageDecoder> {
  const moduleUrl = pathToFileURL(join(resourceDirectory, "vips-node.mjs")).href;
  const entry: { default: typeof Vips } = await import(moduleUrl);
  const vips = await entry.default();
  return createWebpDecoder(vips);
}

/**
 * Image handles are scoped to a single method because the shared interface has
 * no close operation and policy can stop after metadata. The bounded bytes must
 * remain unchanged between calls. The caller owns encoded-file size limits.
 */
export function createWebpDecoder(vips: VipsModule): ImageDecoder {
  return {
    open(bytes, limitInputPixels) {
      if (!Number.isSafeInteger(limitInputPixels) || limitInputPixels <= 0) {
        throw new Error("Invalid image pixel limit.");
      }

      function withImage<T>(operation: (image: Vips.Image, metadata: ImageMetadata) => T): T {
        if (bytes.byteLength === 0) throw new Error("Empty WebP input.");
        // Only open the first page: metadata still exposes page and animation
        // markers without expanding every frame into a tall image.
        let image: Vips.Image;
        try {
          image = vips.Image.webploadBuffer(bytes, { n: 1, fail_on: "error" });
        } catch {
          throw new Error("Invalid WebP image.");
        }
        try {
          const pages = image.getTypeof("n-pages") ? image.getInt("n-pages") : 1;
          const loop = image.getTypeof("loop") ? image.getInt("loop") : undefined;
          const delay = image.getTypeof("delay") ? image.getArrayInt("delay") : undefined;
          const width = image.width;
          const height = image.height * pages;
          if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
            || width <= 0 || height <= 0 || !Number.isSafeInteger(pages) || pages <= 0
            || width * height > limitInputPixels) {
            throw new Error("WebP pixel limit exceeded.");
          }
          return operation(image, {
            format: "webp", width, height, pages, loop, delay, hasAlpha: image.hasAlpha(),
          });
        } finally {
          image.delete();
        }
      }

      function pixels(): Uint8Array {
        return withImage((image, metadata) => {
          // The shared atlas/activity policies reject multipage input before
          // decoding; never silently decode just the first animation page.
          if (metadata.pages !== 1) throw new Error("Cannot decode animated WebP as a static atlas.");
          const rgba = metadata.hasAlpha ? image : image.bandjoin(255);
          try {
            const memory = rgba.writeToMemory();
            if (!(memory instanceof Uint8Array) || memory.length !== image.width * image.height * 4) {
              throw new Error("Unexpected WebP pixel layout.");
            }
            // writeToMemory is WASM-owned: copy before disposing image handles.
            return Uint8Array.from(memory);
          } catch {
            throw new Error("WebP pixel decoding failed.");
          } finally {
            if (rgba !== image) rgba.delete();
          }
        });
      }

      return {
        async metadata() { return withImage((_image, metadata) => metadata); },
        async decode() { pixels(); },
        async decodeWithAlpha() { return { data: pixels(), channels: 4 }; },
      };
    },
  };
}
