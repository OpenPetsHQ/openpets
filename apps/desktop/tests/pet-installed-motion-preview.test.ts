import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import * as moduleApi from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";

test("installed Motion preview uses the requested pet's idle loop first frame", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-motion-preview-"));
  const mock = `data:text/javascript,${encodeURIComponent(`
    import { join } from "node:path";
    export function getPetDir(id) { return join(${JSON.stringify(root)}, id); }
  `)}`;
  const hooks = typeof moduleApi.registerHooks === "function" ? moduleApi.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "./pet-paths.js" && context.parentURL?.includes("installed-pet-layout")) {
        return { url: mock, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  }) : undefined;
  if (!hooks) {
    moduleApi.register(`data:text/javascript,${encodeURIComponent(`
      export async function resolve(specifier, context, nextResolve) {
        if (specifier === "./pet-paths.js" && context.parentURL?.includes("installed-pet-layout")) {
          return { url: ${JSON.stringify(mock)}, shortCircuit: true };
        }
        return nextResolve(specifier, context);
      }
    `)}`, import.meta.url);
  }
  try {
    for (const [id, red] of [["first", 255], ["second", 0]] as const) {
      const directory = join(root, id);
      await mkdir(join(directory, "clips"), { recursive: true });
      const pixels = Buffer.alloc(8 * 16 * 4, 255);
      for (let index = 0; index < pixels.length; index += 4) pixels[index] = red;
      pixels[3] = 0;
      pixels[8 * 8 * 4 + 3] = 0;
      pixels[8 * 8 * 4] = 128;
      const clip = await sharp(pixels, { raw: { width: 8, height: 16, channels: 4, pageHeight: 8 } })
        .webp({ delay: [100, 120], loop: 0 }).toBuffer();
      await writeFile(join(directory, "clips", "idle.webp"), clip);
      await writeFile(join(directory, "pet.json"), JSON.stringify({
        format: "motion", version: 1, id, displayName: id, description: "Pet",
        geometry: { width: 8, height: 8, pixelsPerUnit: 1, footAnchor: { x: 4, y: 8 } },
        clips: { idle: { file: "clips/idle.webp", frames: 2 } },
        animations: { idle: { play: "loop", loop: "idle" } },
        bindings: { idle: [{ animation: "idle" }], movement: { left: "idle", right: "idle" } },
      }));
    }
    const { readInstalledPetPreview } = await import("../src/installed-pet-layout.js");
    const first = await readInstalledPetPreview("first");
    const second = await readInstalledPetPreview("second");
    assert.equal(first.mimeType, "image/png");
    const firstPixels = await sharp(first.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const secondPixels = await sharp(second.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(firstPixels.info.width, 8);
    assert.equal(firstPixels.info.height, 8);
    assert.equal(firstPixels.data[3], 0);
    assert.ok(firstPixels.data[4]! > 220);
    assert.ok(secondPixels.data[4]! < 30);
    await assert.rejects(() => readInstalledPetPreview("first", "personal", "other"));
  } finally {
    hooks?.deregister();
    await rm(root, { recursive: true, force: true });
  }
});
