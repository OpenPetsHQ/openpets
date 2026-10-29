import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ValidatedPetPackage } from "../src/host/package-validation.js";

const validActivity = "UklGRjwAAABXRUJQVlA4TC8AAAAv/8IzEA8wbgM1oAMY8CCTtqmD+Ve7dwZGI/ovIChywI42bP3sj/6n//TfBdF/AAA=";
const emptyFrameActivity = "UklGRjwAAABXRUJQVlA4TC8AAAAv/8IzEA8wbgM1oAMY8DDTtk0ZlD/avNX+KRH9nwBobkOzhWb7H+l//a//9f8PCgA=";

test("staged validation worker validates whole packages and terminates on every path", async () => {
  const temp = await mkdtemp(join(tmpdir(), "openpets-worker-"));
  try {
    // The staged copy runs with no repository-relative runtime resources.
    const dist = join(temp, "dist");
    await cp(resolve("dist"), dist, { recursive: true });
    const { validatePetPackage }: {
      validatePetPackage(root: string, id: string, signal?: AbortSignal): Promise<ValidatedPetPackage>;
    } = createRequire(join(dist, "package-validation.cjs"))(join(dist, "package-validation.cjs"));
    const root = join(temp, "pet");
    await mkdir(join(root, "outfits"), { recursive: true });
    await mkdir(join(root, "activities"));
    await cp(resolve("../desktop/assets/default-pet-spritesheet.webp"), join(root, "spritesheet.webp"));
    await cp(join(root, "spritesheet.webp"), join(root, "outfits", "hat.webp"));
    await writeFile(join(root, "activities", "wave.webp"), Buffer.from(validActivity, "base64"));
    await writeFile(join(root, "pet.json"), JSON.stringify({
      id: "pet", displayName: "Pet", description: "A pet", spritesheetPath: "spritesheet.webp", spriteVersionNumber: 2,
      wardrobe: { outfits: [{ id: "hat", displayName: "Hat", spritesheetPath: "outfits/hat.webp" }] },
      activities: [{ id: "wave", displayName: "Wave", outfitId: "default", spritesheetPath: "activities/wave.webp", frameCount: 4, fps: 4 }],
    }));

    const result = await validatePetPackage(root, "pet");
    assert.equal(result.metadata.id, "pet");
    assert.equal(result.layout.version, 2);
    assert.deepEqual(result.availableOutfitIds, ["hat"]);
    await assert.rejects(validatePetPackage(root, "other"));
    await writeFile(join(root, "activities", "wave.webp"), Buffer.from(emptyFrameActivity, "base64"));
    await assert.rejects(validatePetPackage(root, "pet"), /frame/i);
    await writeFile(join(root, "activities", "wave.webp"), Buffer.from(validActivity, "base64"));
    await writeFile(join(root, "outfits", "hat.webp"), Buffer.from("bad"));
    await assert.rejects(validatePetPackage(root, "pet"));

    const controller = new AbortController();
    const pending = validatePetPackage(root, "pet", controller.signal);
    controller.abort();
    await assert.rejects(pending, /cancelled/i);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    await assert.rejects(validatePetPackage(root, "pet", controller.signal), /cancelled/i);

    // Exercise a real worker timing out without waiting a full minute.
    const originalSetTimeout = globalThis.setTimeout;
    try {
      globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => originalSetTimeout(callback, 1)) as typeof setTimeout;
      await assert.rejects(validatePetPackage(root, "pet"), /timed out/i);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    await rm(join(dist, "decoder", "vips.wasm"));
    await assert.rejects(validatePetPackage(root, "pet"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
