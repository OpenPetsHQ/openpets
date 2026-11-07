import assert from "node:assert/strict";

import { getPetWindowScaleOverride, rememberPetWindowScaleOverride, restorePetWindowScaleOverride } from "../src/pet-window-scale-override.js";

const firstWindow = {};
const secondWindow = {};

rememberPetWindowScaleOverride(firstWindow, 1.4);

assert.equal(getPetWindowScaleOverride(firstWindow), 1.4, "a content refresh can restore the explicit scale for its window");
assert.equal(getPetWindowScaleOverride(secondWindow), undefined, "one pet's scale does not leak to another window");
let restoredScale: number | undefined;
restorePetWindowScaleOverride(firstWindow, (scale) => { restoredScale = scale; });
assert.equal(restoredScale, 1.4, "renderer reload restores the explicit scale to that window");

rememberPetWindowScaleOverride(firstWindow, 0);
assert.equal(getPetWindowScaleOverride(firstWindow), 1.4, "invalid scales do not replace the last valid override");

console.log("Pet window scale override tests passed.");
