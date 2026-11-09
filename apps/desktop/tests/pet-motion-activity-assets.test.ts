import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { it } from "node:test";
import sharp from "sharp";
import type { MotionAppearance, MotionBodyDescriptor } from "../src/pet-body-contract.js";
import { createPetBodyState } from "../src/pet-body-state.js";

const mock = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
register(mock(`
  export async function resolve(specifier, context, nextResolve) {
    if ((specifier === './pet-motion-snapshot.js' || specifier === './pet-motion-snapshot.ts') && /pet-motion-activity-assets\\.(js|ts)(\\?|$)/.test(context.parentURL)) {
      return { url: ${JSON.stringify(mock("export function isTrackedMotionSnapshotDescriptor(value) { return value === globalThis.motionTestDescriptor; }"))}, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
`), import.meta.url);

it("uses the exact outfit and first intro frame from the retained snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openpets-motion-activity-"));
  try {
    const introPath = join(directory, "intro.webp");
    const bodyPath = join(directory, "body.webp");
    await writeFile(introPath, await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).webp({ lossless: true }).toBuffer());
    await writeFile(bodyPath, await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.5 } } }).webp({ lossless: true }).toBuffer());
    const assets = {
      snapshotId: "snapshot",
      metadata: {
        geometry: { width: 2, height: 2, pixelsPerUnit: 1, footAnchor: { x: 1, y: 2 } },
        clips: { intro: { file: "clips/intro.webp", frames: 2, playbackRate: 2 }, body: { file: "clips/body.webp", frames: 2 } },
        animations: { dance: { play: "once", intro: "intro", clip: "body" } },
        activities: [{ id: "dance", displayName: "Dance", outfitId: "night", animation: "dance" }],
      },
      urls: { intro: pathToFileURL(introPath).toString(), body: pathToFileURL(bodyPath).toString() },
      verifiedClips: { intro: { durationMs: 200, frameDurationsMs: [100, 100] }, body: { durationMs: 300, frameDurationsMs: [150, 150] } },
    } as unknown as MotionBodyDescriptor;
    (globalThis as typeof globalThis & { motionTestDescriptor: MotionBodyDescriptor }).motionTestDescriptor = assets;
    const { getMotionActivityOptions, readMotionActivityPreview } = await import("../src/pet-motion-activity-assets.js");
    const appearance: MotionAppearance = { assets, outfitId: "night", presentationId: "p", reason: "initial" };
    assert.deepEqual(getMotionActivityOptions(appearance), [{ id: "dance", displayName: "Dance", durationMs: 400 }]);
    assert.deepEqual(getMotionActivityOptions({ ...appearance, outfitId: "default" }), []);
    let committed: MotionAppearance | null = null;
    let epoch = "";
    const state = createPetBodyState((snapshot) => { epoch = snapshot.input.epoch; }, () => {}, (body) => { committed = body?.committed ?? null; });
    const first = state.prepareMotionAppearance(assets, "night", "initial", false);
    state.publishMotionAppearance(first);
    state.result({ epoch, snapshotId: assets.snapshotId, presentationId: first.presentationId, outfitId: "night", playbackId: 1, outcome: "started" });
    const replacement = state.prepareMotionAppearance(assets, "default", "manual", false);
    state.publishMotionAppearance(replacement);
    state.result({ epoch, snapshotId: assets.snapshotId, presentationId: replacement.presentationId, outfitId: "default", playbackId: 2, outcome: "failed" });
    assert.equal(committed, first);
    assert.deepEqual(getMotionActivityOptions(first), [{ id: "dance", displayName: "Dance", durationMs: 400 }]);
    await assert.rejects(readMotionActivityPreview({ ...appearance, outfitId: "default" }, "dance"));
    const preview = await readMotionActivityPreview(appearance, "dance");
    assert.equal(preview.mimeType, "image/png");
    const image = await sharp(preview.bytes).raw().toBuffer({ resolveWithObject: true });
    assert.equal(image.info.width, 2);
    assert.equal(image.info.height, 2);
    assert.equal(image.info.channels, 4);
    assert.ok(image.data[0]! > 200 && image.data[2]! < 20 && image.data[3]! < 255);
    await assert.rejects(readMotionActivityPreview({ ...appearance, assets: { ...assets } }, "dance"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
