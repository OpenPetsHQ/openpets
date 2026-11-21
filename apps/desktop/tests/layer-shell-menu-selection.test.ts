import assert from "node:assert/strict";

import { isCurrentLayerShellMenuSelection } from "../src/layer-shell-menu-selection.js";

assert.equal(isCurrentLayerShellMenuSelection({ menuId: 3, index: 0 }, 3), true);
assert.equal(isCurrentLayerShellMenuSelection({ menuId: 2, index: 0 }, 3), false, "a previous menu cannot select from the current callback table");
assert.equal(isCurrentLayerShellMenuSelection({ menuId: 3, index: -1 }, 3), false);
assert.equal(isCurrentLayerShellMenuSelection({ menuId: "3", index: 0 }, 3), false);
assert.equal(isCurrentLayerShellMenuSelection(null, 3), false);

console.log("Layer-shell menu selection validation passed.");
