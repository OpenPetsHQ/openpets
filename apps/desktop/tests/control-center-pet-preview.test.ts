import assert from "node:assert/strict";

import { defaultPetSprite } from "@open-pets/pet-format/animation";
import { buildPetSpritePreviewModel, buildReactionPreviewModel, defaultPetSpriteLayout, getCatalogPetSpriteLayout, isAllowedPetActivityPreview } from "../src/renderer/src/pet-preview-state.js";

// The renderer must accept only the exact installed activity protocol shape;
// rejecting it turns valid outfit artwork into a placeholder.
assert.equal(isAllowedPetActivityPreview("openpets-installed://activity/activity-fixture/shared/default"), true);
assert.equal(isAllowedPetActivityPreview("openpets-installed://activity/activity-fixture/shared/pajamas"), true);
const activityBase = "openpets-installed://activity/activity-fixture/shared/default";
const motionQuery = new URLSearchParams({
  windowId: "24",
  snapshotId: "d65d51dc-97d8-4478-8f18-187b72e4b24a",
  presentationId: "4d8a8129-09b9-4c57-a231-bf4c393e3595",
});
assert.equal(isAllowedPetActivityPreview(`${activityBase}?${motionQuery}`), true);
assert.equal(isAllowedPetActivityPreview(`${activityBase}?windowId=24&snapshotId=opaque%3Aid&presentationId=other_id`), true);
for (const invalid of [
  "openpets-installed://activity/activity-fixture/shared",
  "openpets-installed://activity/activity-fixture/shared/pajamas/extra",
  "openpets-installed://activity/activity-fixture/../default",
  "openpets-installed://activity/activity-fixture/%2e%2e/default",
  "openpets-installed://activity/activity-fixture/shared/%2fdefault",
  "openpets-installed://activity/activity-fixture/shared/default?x=1",
  `${activityBase}?windowId=24&snapshotId=snapshot`,
  `${activityBase}?${motionQuery}&windowId=25`,
  `${activityBase}?${motionQuery}&extra=1`,
  `${activityBase}?windowId=0&snapshotId=a&presentationId=b`,
  `${activityBase}?windowId=9007199254740992&snapshotId=a&presentationId=b`,
  `${activityBase}?windowId=1.5&snapshotId=a&presentationId=b`,
  `${activityBase}?windowId=24&snapshotId=&presentationId=b`,
  `${activityBase}?windowId=24&snapshotId=%ZZ&presentationId=b`,
  `${activityBase}?${motionQuery}#fragment`,
  "openpets-installed://user@activity/activity-fixture/shared/default",
  "openpets-installed://activity:24/activity-fixture/shared/default",
  "https://activity/activity-fixture/shared/default",
]) {
  assert.equal(isAllowedPetActivityPreview(invalid), false, invalid);
}

assert.deepEqual(
  buildPetSpritePreviewModel(defaultPetSpriteLayout, { row: 0, frames: 6 }, true),
  {
    atlasColumns: 8,
    atlasRows: 9,
    row: 0,
    frameColumns: [0, 1, 2, 3, 4, 5],
    animated: true,
  },
  "V1 previews retain the existing six-frame idle animation on the 8x9 atlas",
);

const v2Layout = {
  version: 2,
  frameWidth: 192,
  frameHeight: 208,
  columns: 8,
  rows: 11,
  neutralPose: { row: 0, column: 6 },
} as const;

const reactionSettings = {
  previewSpriteUrl: "openpets-installed://spritesheet/test",
  sprite: { ...v2Layout, states: { idle: { row: 0, frames: 6, durationMs: 1650 }, waiting: { row: 7, frames: 4, durationMs: 2200 } } },
};
assert.deepEqual(buildReactionPreviewModel(reactionSettings, "waiting"), {
  format: "atlas", src: reactionSettings.previewSpriteUrl,
  frame: { width: 192, height: 208 }, x: -0, y: -1456,
  xValues: "0;-192;-384;-576", atlasWidth: 1536, atlasHeight: 2288,
  animated: true, durationMs: 2200,
}, "configured non-idle reaction uses its selected row, timing and V2 atlas");
assert.deepEqual(buildReactionPreviewModel({ ...reactionSettings, previewFormat: "image", previewWidth: 600, previewHeight: 641 }, "waiting"), {
  format: "image", src: reactionSettings.previewSpriteUrl, width: 600, height: 641,
}, "Motion reaction previews remain static images");

assert.deepEqual(getCatalogPetSpriteLayout(2), v2Layout, "catalog V2 entries resolve to the shared 8x11 preview layout");
assert.equal(getCatalogPetSpriteLayout(undefined), undefined, "legacy catalog entries retain implicit V1 layout behavior");

assert.deepEqual(
  buildPetSpritePreviewModel(defaultPetSprite, { row: 0, frames: 6 }, true),
  {
    atlasColumns: 8,
    atlasRows: 11,
    row: 0,
    frameColumns: [6],
    animated: false,
  },
  "the bundled Hoodie Cat preview uses the V2 neutral idle cell",
);

assert.deepEqual(
  buildPetSpritePreviewModel(v2Layout, { row: 0, frames: 6 }, true),
  {
    atlasColumns: 8,
    atlasRows: 11,
    row: 0,
    frameColumns: [6],
    animated: false,
  },
  "V2 idle previews show the static neutral frame at row 0, column 6",
);

assert.deepEqual(
  buildPetSpritePreviewModel(v2Layout, { row: 8, frames: 6 }, false),
  {
    atlasColumns: 8,
    atlasRows: 11,
    row: 8,
    frameColumns: [0, 1, 2, 3, 4, 5],
    animated: true,
  },
  "V2 reaction previews retain their normal animated frame range on the 8x11 atlas",
);

console.log("Control Center Codex V1/V2 preview behavior passed.");
