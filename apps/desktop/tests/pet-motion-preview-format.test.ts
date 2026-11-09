import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPetSprite } from "@open-pets/pet-format/animation";
import { validateMotionPreviewPack } from "../src/pet-motion-preview-format.js";

function fixture() {
  return {
    version: 1,
    width: 520,
    height: 600,
    pixelsPerUnit: 2.5,
    anchor: { x: 260, y: 570 },
    animations: Object.fromEntries(
      Object.keys(defaultPetSprite.states).map((state) => [
        state,
        {
          play: ["waving", "jumping", "failed"].includes(state)
            ? "once"
            : "loop",
          clip: { file: `${state}.webp`, frames: 96 },
        },
      ]),
    ),
  };
}

test("motion preview retains native resolution and long animation sequences", () => {
  const pack = validateMotionPreviewPack(fixture());
  assert.equal(pack.width, 520);
  assert.equal(pack.animations.waving.clip.frames, 96);
  assert.deepEqual(pack.anchor, { x: 260, y: 570 });
});

test("motion preview requires a complete pet and a looping neutral state", () => {
  const missing = fixture();
  delete missing.animations.review;
  assert.throws(() => validateMotionPreviewPack(missing));
  const finiteIdle = fixture();
  finiteIdle.animations.idle.play = "once";
  assert.throws(() => validateMotionPreviewPack(finiteIdle));
});

test("motion preview refuses paths outside the pack and excessive decoded memory", () => {
  const traversal = fixture();
  traversal.animations.idle.clip.file = "../private.webp";
  assert.throws(() => validateMotionPreviewPack(traversal));
  assert.throws(() =>
    validateMotionPreviewPack({ ...fixture(), width: 1280, height: 1280 }),
  );
});

test("motion preview validates transition clips with the same asset rules", () => {
  const value = fixture();
  const pack = validateMotionPreviewPack({
    ...value,
    animations: {
      ...value.animations,
      "running-right": {
        ...value.animations["running-right"],
        enter: { file: "turn-right.webp", frames: 24 },
        exit: { file: "return-right.webp", frames: 24 },
      },
    },
  });
  assert.equal(pack.animations["running-right"].enter?.frames, 24);
  assert.throws(() =>
    validateMotionPreviewPack({
      ...value,
      animations: {
        ...value.animations,
        waving: {
          ...value.animations.waving,
          exit: { file: "exit.webp", frames: 24 },
        },
      },
    }),
  );
});
