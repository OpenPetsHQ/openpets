import assert from "node:assert/strict";

import { resolveDevControlCenterRoute } from "../src/control-center-route.js";

assert.deepEqual(resolveDevControlCenterRoute(undefined, false), null);
assert.deepEqual(resolveDevControlCenterRoute("teams", false), {
  kind: "route",
  route: "teams",
});
assert.deepEqual(resolveDevControlCenterRoute("providers", false), {
  kind: "target",
  target: { route: "settings", settingsTab: "providers" },
});
assert.deepEqual(resolveDevControlCenterRoute("", false), {
  kind: "invalid",
  rawValue: "",
});
assert.deepEqual(resolveDevControlCenterRoute("not-a-route", false), {
  kind: "invalid",
  rawValue: "not-a-route",
});
const unsafeValue = `bad\n${"x".repeat(100)}`;
const unsafeResult = resolveDevControlCenterRoute(unsafeValue, false);
assert.equal(unsafeResult?.kind, "invalid");
if (unsafeResult?.kind === "invalid") {
  assert.equal(unsafeResult.rawValue.length, 80);
  assert.equal(unsafeResult.rawValue.includes("\n"), false);
}
assert.deepEqual(resolveDevControlCenterRoute("teams", true), null);
assert.deepEqual(resolveDevControlCenterRoute("providers", true), null);
assert.deepEqual(resolveDevControlCenterRoute("not-a-route", true), null);

console.error("Control Center development route validation passed.");
