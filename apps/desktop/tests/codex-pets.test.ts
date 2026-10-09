import assert from "node:assert/strict";

import sharp from "sharp";

import { codexV2GazeDeadZonePx, codexV2SpriteLayout, getCodexPetSpriteLayout, getCodexPetSpritePosition, getCodexV2GazeAnchorPoint, getCodexV2GazeSpritePosition, maxCodexPets, maxCodexSpritesheetBytes, maxCodexThumbnailSourceBytes, mirrorCodexV2GazeIndex, quantizeCodexV2GazeDirection, validateCodexPetMetadata, validateCodexPetSpritesheet } from "../src/codex-pets-core.js";
import { getConfiguredSpriteStates } from "../src/reaction-animation-mapping.js";
import { codexV1Fixture, codexV2Fixture } from "./codex-pet-fixtures.js";

const valid = validateCodexPetMetadata(codexV1Fixture, "aiko");

assert.deepEqual(valid, {
  ...codexV1Fixture,
  spritesheetPath: "spritesheet.webp",
});
assert.equal(valid.gazeAnchor, undefined, "pets without a gaze anchor retain the legacy behavior");
const anchoredV2 = validateCodexPetMetadata({ ...codexV2Fixture, gazeAnchor: { x: 0.5, y: 0.25, ignored: true } }, "malou");
assert.deepEqual(anchoredV2.gazeAnchor, { x: 0.5, y: 0.25 }, "validated metadata preserves the normalized anchor and strips unknown fields");

assert.throws(() => validateCodexPetMetadata({ id: "other", displayName: "Other", description: "Nope", spritesheetPath: "spritesheet.webp" }, "fixer"));
assert.throws(() => validateCodexPetMetadata({ id: "builtin", displayName: "Built-in", description: "Reserved", spritesheetPath: "spritesheet.webp" }, "builtin"));
assert.throws(() => validateCodexPetMetadata({ id: "bad/id", displayName: "Bad", description: "Bad", spritesheetPath: "spritesheet.webp" }, "bad/id"));
assert.throws(() => validateCodexPetMetadata({ id: "fixer", displayName: "Fixer", description: "Nope", spritesheetPath: "../spritesheet.webp" }, "fixer"));
assert.throws(() => validateCodexPetMetadata({ id: "fixer", displayName: "", description: "Nope", spritesheetPath: "spritesheet.webp" }, "fixer"));
for (const gazeAnchor of [null, {}, { x: 0.5 }, { x: -0.1, y: 0.5 }, { x: 1.1, y: 0.5 }, { x: 0.5, y: Number.NaN }, { x: "0.5", y: 0.5 }]) {
  assert.throws(() => validateCodexPetMetadata({ ...codexV2Fixture, gazeAnchor }, "malou"), "malformed gaze anchors are rejected");
}

assert.equal(maxCodexSpritesheetBytes, 100 * 1024 * 1024);
assert.equal(maxCodexThumbnailSourceBytes, 24 * 1024 * 1024);
assert.equal(maxCodexPets, 100);

const v2 = validateCodexPetMetadata(codexV2Fixture, "malou");

assert.deepEqual(v2, {
  ...codexV2Fixture,
});
assert.equal(getCodexPetSpriteLayout(valid).rows, 9);
assert.deepEqual(getCodexPetSpriteLayout(v2), codexV2SpriteLayout);
assert.equal(codexV2SpriteLayout.rows, 11);
assert.deepEqual(codexV2SpriteLayout.neutralPose, { row: 0, column: 6 });
const configuredStates = getConfiguredSpriteStates();
assert.deepEqual(getCodexPetSpritePosition(codexV2SpriteLayout, configuredStates.idle, true), { row: 0, startColumn: 6, endColumn: 6, animated: false });
assert.deepEqual(getCodexPetSpritePosition(codexV2SpriteLayout, configuredStates["running-right"]), { row: 1, startColumn: 0, endColumn: 8, animated: true });
assert.deepEqual(getCodexPetSpritePosition(getCodexPetSpriteLayout(valid), configuredStates.idle), { row: 0, startColumn: 0, endColumn: 6, animated: true });

const gazeAnchor = { x: 100, y: 100 };
assert.deepEqual(
  getCodexV2GazeAnchorPoint({ x: 10, y: 20, width: 300, height: 400 }, { width: 192, height: 208 }, 0.5, null, undefined, false, 28),
  { x: 160, y: 420 },
  "an omitted custom anchor keeps the existing carrier bottom-center anchor",
);
assert.deepEqual(
  getCodexV2GazeAnchorPoint({ x: 10, y: 20, width: 300, height: 400 }, { width: 192, height: 208 }, 0.5, null, { x: 0.5, y: 0.25 }, false, 28),
  { x: 160, y: 314 },
  "custom anchor coordinates use the rendered frame's scaled geometry, excluding carrier padding",
);
assert.deepEqual(
  getCodexV2GazeAnchorPoint({ x: 10, y: 20, width: 300, height: 400 }, { width: 192, height: 208 }, 0.5, null, { x: 0.25, y: 0.25 }, true, 28),
  { x: 184, y: 314 },
  "horizontal flipping mirrors the normalized x coordinate within the sprite frame",
);
assert.deepEqual(
  getCodexV2GazeAnchorPoint({ x: 10, y: 20, width: 300, height: 400 }, { width: 192, height: 208 }, 0.75, 1.5, { x: 0.25, y: 0.25 }, false, 28),
  { x: 160, y: 314 },
  "a scale override changes the sprite anchor without moving the base-scale shell origin",
);
assert.deepEqual(
  getCodexV2GazeAnchorPoint({ x: 10, y: 20, width: 300, height: 400 }, { width: 192, height: 208 }, 0.75, 1.5, { x: 0.25, y: 0.25 }, true, 28),
  { x: 160, y: 314 },
  "flipped override geometry mirrors within the base-scale shell origin",
);
assert.deepEqual(
  getCodexV2GazeAnchorPoint({ x: 10, y: 20, width: 300, height: 400 }, { width: 192, height: 208 }, 0.75, 1.5, { x: 0.125, y: 0.25 }, true, 28),
  { x: 196, y: 314 },
  "flipped asymmetric anchors use the override transform around the base-scale layout",
);
assert.deepEqual(
  getCodexV2GazeAnchorPoint({ x: 10, y: 20, width: 300, height: 400 }, { width: 192, height: 208 }, 0.75, null, { x: 0.125, y: 0.25 }, false, 28),
  { x: 106, y: 275 },
  "clearing an override restores the current render scale as the sprite transform",
);
assert.deepEqual(
  getCodexV2GazeAnchorPoint({ x: 10, y: 20, width: 300, height: 400 }, { width: 192, height: 208 }, 0.5, 1.5, { x: 0.125, y: 0.25 }, false, 28),
  { x: 148, y: 366 },
  "a renderer reload can update layout origin while a window scale override remains active",
);
assert.equal(quantizeCodexV2GazeDirection({ x: 100, y: 50 }, gazeAnchor), 0);
assert.equal(quantizeCodexV2GazeDirection({ x: 150, y: 100 }, gazeAnchor), 4);
assert.equal(quantizeCodexV2GazeDirection({ x: 100, y: 150 }, gazeAnchor), 8);
assert.equal(quantizeCodexV2GazeDirection({ x: 50, y: 100 }, gazeAnchor), 12);
assert.equal(quantizeCodexV2GazeDirection({ x: 150, y: 50 }, gazeAnchor), 2);
assert.equal(quantizeCodexV2GazeDirection({ x: 50, y: 150 }, gazeAnchor), 10);
assert.equal(quantizeCodexV2GazeDirection({ x: 100 + codexV2GazeDeadZonePx, y: 100 }, gazeAnchor), null);
assert.equal(quantizeCodexV2GazeDirection({ x: 100 + codexV2GazeDeadZonePx + 1, y: 100 }, gazeAnchor), 4);
assert.equal(quantizeCodexV2GazeDirection({ x: 100 + 9, y: 100 - 50 }, gazeAnchor), 0);
assert.equal(quantizeCodexV2GazeDirection({ x: 100 + 11, y: 100 - 50 }, gazeAnchor), 1);
for (let index = 0; index < 16; index += 1) {
  assert.deepEqual(getCodexV2GazeSpritePosition(index), index < 8 ? { row: 9, column: index } : { row: 10, column: index - 8 });
}
assert.equal(mirrorCodexV2GazeIndex(0), 0);
assert.equal(mirrorCodexV2GazeIndex(1), 15);
assert.equal(mirrorCodexV2GazeIndex(15), 1);
assert.deepEqual(getCodexV2GazeSpritePosition(1, true), { row: 10, column: 7 });
assert.equal(getCodexV2GazeSpritePosition(16), null);

for (const marker of [1, 3, "2", null, undefined]) {
  const malformed = { ...codexV2Fixture, spriteVersionNumber: marker };
  assert.throws(() => validateCodexPetMetadata(malformed, "malou"), `marker ${String(marker)} must be rejected`);
}

const createAtlas = (width: number, height: number, format: "webp" | "png"): Promise<Buffer> => {
  const image = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
  return format === "webp" ? image.webp().toBuffer() : image.png().toBuffer();
};

async function runImageContracts(): Promise<void> {
  const validV2Atlas = await createAtlas(1536, 2288, "webp");
  await validateCodexPetSpritesheet(validV2Atlas, v2);
  await assert.rejects(() => createAtlas(1536, 2080, "webp").then((atlas) => validateCodexPetSpritesheet(atlas, v2)), /exactly 1536x2288/);
  await assert.rejects(() => createAtlas(1536, 2288, "png").then((atlas) => validateCodexPetSpritesheet(atlas, v2)), /must be WebP/);
  const opaqueWebp = await sharp({ create: { width: 1536, height: 2288, channels: 3, background: { r: 0, g: 0, b: 0 } } }).webp().toBuffer();
  await assert.rejects(() => validateCodexPetSpritesheet(opaqueWebp, v2), /must include transparency/);
  const secondV2Frame = await sharp({ create: { width: 1536, height: 2288, channels: 4, background: { r: 1, g: 0, b: 0, alpha: 0.5 } } }).webp().toBuffer();
  const animatedWebp = await sharp([validV2Atlas, secondV2Frame], { join: { animated: true } }).webp({ delay: [100, 100], loop: 0 }).toBuffer();
  await assert.rejects(() => validateCodexPetSpritesheet(animatedWebp, v2), /exactly one image/);
  await assert.rejects(() => validateCodexPetSpritesheet(Buffer.from("not an image"), v2), /metadata is invalid/);
  await validateCodexPetSpritesheet(Buffer.from("not an image"), valid);
  console.log("Codex pet validation and V2 layout contracts passed.");
}

runImageContracts().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
