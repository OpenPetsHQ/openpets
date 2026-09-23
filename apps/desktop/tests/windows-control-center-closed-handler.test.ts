import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// windows.ts imports BrowserWindow/screen directly from "electron", which
// only resolves to the real API inside a running Electron process -- under
// this plain-node test runner "electron" resolves to a path string, so the
// module can't be imported here. Guard the fix as a static source check
// instead, matching this repo's own convention (see
// check-packaging-contract.ts) for invariants that can't be exercised
// through a real BrowserWindow lifecycle in these tests.
//
// The bug: window.on("closed", ...) fires after the window (and its
// webContents) are already destroyed. Reading window.webContents.id inside
// that handler throws "TypeError: Object has been destroyed" -- this is the
// same bug class already fixed once for Control Center (#179), and it
// recurred here at a different call site introduced by the v4 rewrite.
// Regression: assert the "closed" handler never re-reads window.webContents,
// and that it uses the id captured up front instead.

const desktopDir = process.env.OPENPETS_DESKTOP_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "../..");
const windowsSource = readFileSync(join(desktopDir, "src", "windows.ts"), "utf8");

const controlCenterStart = windowsSource.indexOf("export function openControlCenterWindowTarget");
assert.ok(controlCenterStart >= 0, "openControlCenterWindowTarget must exist in windows.ts");
const nextExportStart = windowsSource.indexOf("\nexport function", controlCenterStart + 1);
const functionBody = windowsSource.slice(controlCenterStart, nextExportStart > 0 ? nextExportStart : undefined);

const captureIndex = functionBody.indexOf("const webContentsId = window.webContents.id;");
assert.ok(captureIndex >= 0, "openControlCenterWindowTarget must capture webContents.id once, before the window can be destroyed.");

const closedHandlerStart = functionBody.indexOf('window.on("closed"');
assert.ok(closedHandlerStart >= 0, 'openControlCenterWindowTarget must register a window.on("closed", ...) handler.');
assert.ok(closedHandlerStart > captureIndex, "webContents.id must be captured before the \"closed\" handler is registered.");

const closedHandlerEnd = functionBody.indexOf("});", closedHandlerStart) + "});".length;
const closedHandlerBody = functionBody.slice(closedHandlerStart, closedHandlerEnd);

assert.doesNotMatch(
  closedHandlerBody,
  /window\.webContents/,
  'Control Center\'s "closed" handler must not read window.webContents -- it is already destroyed by the time "closed" fires, and doing so throws "Object has been destroyed".',
);
assert.match(
  closedHandlerBody,
  /\bwebContentsId\b/,
  'Control Center\'s "closed" handler must use the id captured before destruction (webContentsId), not re-read it from the destroyed window.',
);

const renderProcessGoneStart = functionBody.indexOf('window.webContents.on("render-process-gone"');
assert.ok(renderProcessGoneStart >= 0, 'openControlCenterWindowTarget must register a render-process-gone handler.');
const renderProcessGoneEnd = functionBody.indexOf("});", renderProcessGoneStart) + "});".length;
const renderProcessGoneBody = functionBody.slice(renderProcessGoneStart, renderProcessGoneEnd);
assert.match(
  renderProcessGoneBody,
  /cancelForSender\(webContentsId,/,
  "render-process-gone handler should also use the captured webContentsId for consistency, not re-read window.webContents.id.",
);

console.log("windows.ts Control Center closed-handler regression test passed.");
