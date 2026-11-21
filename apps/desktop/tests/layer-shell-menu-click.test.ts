import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { dispatchTrustedLayerShellMenuClick } = require(resolve(root, "layer-shell-menu-click.cjs")) as {
  dispatchTrustedLayerShellMenuClick: (
    event: { readonly isTrusted: boolean; stopPropagation(): void },
    menuId: number,
    index: number,
    closeMenu: () => void,
    sendSelection: (selection: { readonly menuId: number; readonly index: number }) => void,
  ) => boolean;
};

let stopped = false;
let closed = false;
let selection: { readonly menuId: number; readonly index: number } | undefined;
const click = (isTrusted: boolean) => ({
  isTrusted,
  stopPropagation: () => { stopped = true; },
});

assert.equal(dispatchTrustedLayerShellMenuClick(click(false), 4, 1, () => { closed = true; }, (value) => { selection = value; }), false);
assert.equal(closed, false, "synthetic input must not close the menu or dispatch a selection");
assert.equal(selection, undefined);

assert.equal(dispatchTrustedLayerShellMenuClick(click(true), 4, 1, () => { closed = true; }, (value) => { selection = value; }), true);
assert.equal(stopped, true);
assert.equal(closed, true);
assert.deepEqual(selection, { menuId: 4, index: 1 });

console.log("Trusted layer-shell menu click dispatch passed.");
