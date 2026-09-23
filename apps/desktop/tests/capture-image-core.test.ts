import assert from "node:assert/strict";
import test from "node:test";

import { frameVisibleContent, type CaptureBitmap } from "../src/capture-image-core.js";

function createBitmap(width: number, height: number, visible: ReadonlyArray<readonly [number, number, number]>): CaptureBitmap {
  const data = new Uint8Array(width * height * 4);
  for (const [x, y, alpha] of visible) {
    const offset = (y * width + x) * 4;
    data.set([10, 20, 30, alpha], offset);
  }
  return { data, width, height };
}

function alphaAt(bitmap: CaptureBitmap, x: number, y: number): number {
  return bitmap.data[(y * bitmap.width + x) * 4 + 3] ?? 0;
}

test("frames off-centre content with equal transparent padding and ignores near-invisible pixels", () => {
  // A 2x2 subject in the bottom-right of a 10x8 capture, plus faint noise
  // (alpha 5) in the top-left that must not widen the crop.
  const capture = createBitmap(10, 8, [
    [6, 5, 255],
    [7, 5, 255],
    [6, 6, 255],
    [7, 6, 128],
    [0, 0, 5],
  ]);

  const framed = frameVisibleContent(capture, { padding: 3, alphaThreshold: 8 });

  assert.ok(framed);
  assert.equal(framed.width, 2 + 3 * 2);
  assert.equal(framed.height, 2 + 3 * 2);
  assert.equal(alphaAt(framed, 3, 3), 255);
  assert.equal(alphaAt(framed, 4, 4), 128);
  assert.equal(alphaAt(framed, 2, 3), 0);
  assert.equal(alphaAt(framed, 5, 5), 0);
});

test("reports a fully transparent capture as nothing to frame", () => {
  const capture = createBitmap(4, 4, [[1, 1, 3]]);

  assert.equal(frameVisibleContent(capture, { padding: 2, alphaThreshold: 8 }), null);
});
