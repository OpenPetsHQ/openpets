import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateMotionLayout, type MotionLayoutInput } from "../src/pet-motion-layout.js";
import { calculatePetInteractiveShape } from "../src/pet-window-shape.js";
import { defaultPetSprite } from "@open-pets/pet-format/animation";

function input(width: number, height: number, x: number, y: number, requestedScale = 0.75): MotionLayoutInput {
  return { geometry: { width, height, pixelsPerUnit: 1, footAnchor: { x, y } }, requestedScale, windowWidth: 340, windowHeight: 420, hitboxBottomInset: 0, hitPadding: 8, flipped: false };
}
function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test("Motion fitting preserves the foot and contains extreme artwork in either direction", () => {
  for (const [base, expected] of [
    [input(1280, 1280, 640, 1280), 0.253125],
    [input(4096, 4096, 2048, 4096), 0.0791015625],
    [input(4096, 4096, 512, 4096), 0.04743303571428571],
    [input(1280, 1280, 640, 640), 0.0125],
  ] as const) {
    for (const flipped of [false, true]) {
      const layout = calculateMotionLayout({ ...base, flipped });
      close(layout.effectiveScale, expected);
      close(layout.foot.x, 170); close(layout.foot.y, 412);
      const body = layout.bodyBounds;
      assert.ok(body.x >= -1e-9 && body.y >= -1e-9 && body.x + body.width <= 340 + 1e-9 && body.y + body.height <= 420 + 1e-9);
      const anchor = flipped ? base.geometry.width - base.geometry.footAnchor.x : base.geometry.footAnchor.x;
      close(body.x + anchor * layout.effectiveScale, layout.foot.x);
      close(body.y + base.geometry.footAnchor.y * layout.effectiveScale, layout.foot.y);
    }
  }
  assert.ok(Number.isFinite(calculateMotionLayout(input(1280, 1280, 0, 0)).effectiveScale));
  assert.ok(Number.isFinite(calculateMotionLayout(input(1280, 1280, 1280, 1280)).effectiveScale));
  assert.ok(calculateMotionLayout({ ...input(640, 1280, 320, 1280), hitboxBottomInset: 35 }).effectiveScale < calculateMotionLayout(input(640, 1280, 320, 1280)).effectiveScale);
});

test("reference geometry retains fitting requested scales and caps larger scales", () => {
  const base = input(600, 641, 320, 617);
  const geometry = { ...base.geometry, pixelsPerUnit: 2.4639 };
  for (const requestedScale of [0.35, 0.5, 0.75]) close(calculateMotionLayout({ ...base, geometry, requestedScale }).effectiveScale, requestedScale);
  for (const requestedScale of [1, 1.25]) close(calculateMotionLayout({ ...base, geometry, requestedScale }).effectiveScale, 8 * 2.4639 / 24);
});

test("native input shape covers both fitted hitbox and shifted body after expansion", () => {
  const layout = calculateMotionLayout(input(4096, 4096, 512, 4096));
  const shape = calculatePetInteractiveShape({ windowWidth: 420, windowHeight: 640, spriteWidth: 4096, spriteHeight: 4096, scale: 0.75, hasBubble: false, isExpanded: true, motionLayout: layout });
  for (const [index, rect] of [layout.hitboxBounds, layout.bodyBounds].entries()) {
    const actual = shape.shape[index]!;
    assert.ok(actual.x <= rect.x + 40 && actual.y <= rect.y + 220);
    assert.ok(actual.x + actual.width >= rect.x + 40 + rect.width && actual.y + actual.height >= rect.y + 220 + rect.height);
  }
});

test("Motion bubble and compact composer masks follow the committed document scale", () => {
  const layout = calculateMotionLayout(input(1280, 1280, 640, 640));
  const common = {
    windowWidth: 340, windowHeight: 420, spriteWidth: 1280, spriteHeight: 1280,
    scale: 0.75, motionDocumentScale: 0.75, motionLayout: layout,
  };
  const overlayHeight = Math.ceil(defaultPetSprite.frameHeight * 0.75);
  const bubbleBottom = 22 + overlayHeight + 8;
  const bubble = calculatePetInteractiveShape({ ...common, hasBubble: true }).shape.at(-1)!;
  assert.equal(bubble.y, 420 - bubbleBottom - 156);
  assert.ok(bubble.y <= 80 && bubble.y + bubble.height >= 230);

  const composer = calculatePetInteractiveShape({ ...common, hasBubble: false, isCompactOpen: true }).compactComposer!;
  assert.equal(composer.y, 420 - (22 + overlayHeight + 18) - 152);
  assert.ok(composer.y <= 80 && composer.y + composer.height >= 200);
});

test("live Motion scale overrides change body bounds but not document overlay masks", () => {
  const base = input(600, 641, 320, 617, 0.35);
  const geometry = { ...base.geometry, pixelsPerUnit: 2.4639 };
  const committed = calculateMotionLayout({ ...base, geometry });
  const overridden = calculateMotionLayout({ ...base, geometry, requestedScale: 2 });
  const common = {
    windowWidth: 340, windowHeight: 420, spriteWidth: 600, spriteHeight: 641,
    scale: 0.35, motionDocumentScale: 0.35,
  };
  assert.notEqual(committed.bodyBounds.height, overridden.bodyBounds.height);
  for (const overlay of [{ hasBubble: true }, { hasBubble: false, isCompactOpen: true }, { hasBubble: false, isExpanded: true }]) {
    const before = calculatePetInteractiveShape({ ...common, ...overlay, motionLayout: committed });
    const after = calculatePetInteractiveShape({ ...common, ...overlay, motionLayout: overridden });
    assert.deepEqual(before.shape.at(-1), after.shape.at(-1));
  }
});
