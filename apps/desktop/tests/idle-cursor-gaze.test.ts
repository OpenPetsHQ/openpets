import assert from "node:assert/strict";

import {
  defaultIdleCursorGazeEnabled,
  normalizeIdleCursorGazeEnabled,
} from "../src/app-state-core.js";
import { validatePreferencePatch } from "../src/preference-patch.js";
import { codexV2GazeIdleResetMs, isCodexV2GazeActive, shouldTrackCodexV2Gaze } from "../src/codex-pets-core.js";

assert.equal(defaultIdleCursorGazeEnabled, true, "idle cursor gaze is enabled by default");
assert.equal(normalizeIdleCursorGazeEnabled(true), true);
assert.equal(normalizeIdleCursorGazeEnabled(false), false);
assert.equal(normalizeIdleCursorGazeEnabled(undefined), true, "missing saved preference uses the enabled default");
assert.equal(normalizeIdleCursorGazeEnabled("true"), true, "malformed saved preference uses the enabled default");
assert.equal(normalizeIdleCursorGazeEnabled(undefined, false), false, "callers may provide an explicit fallback");

assert.equal(validatePreferencePatch({ idleCursorGazeEnabled: true }).idleCursorGazeEnabled, true);
assert.equal(validatePreferencePatch({ idleCursorGazeEnabled: false }).idleCursorGazeEnabled, false);
assert.throws(
  () => validatePreferencePatch({ idleCursorGazeEnabled: "false" }),
  /Invalid idle-cursor-gaze-enabled value\./,
);

const idleV2 = {
  spriteVersion: 2 as const,
  idleCursorGazeEnabled: true,
  paused: false,
  reactionState: "idle",
  motionState: "idle",
  pluginSpriteOverride: false,
};

assert.equal(shouldTrackCodexV2Gaze(idleV2), true, "enabled idle V2 pets may track the cursor");
assert.equal(shouldTrackCodexV2Gaze({ ...idleV2, idleCursorGazeEnabled: false }), false, "the setting gates V2 idle gaze");
assert.equal(shouldTrackCodexV2Gaze({ ...idleV2, spriteVersion: 1 }), false, "V1 pets never use V2 gaze");
assert.equal(shouldTrackCodexV2Gaze({ ...idleV2, reactionState: "running" }), false, "non-idle reactions retain their existing behavior");
assert.equal(shouldTrackCodexV2Gaze({ ...idleV2, motionState: "run-left" }), false, "moving pets retain their existing behavior");

assert.equal(isCodexV2GazeActive(10_000, 10_000), true, "a recent cursor movement keeps the glance active");
assert.equal(isCodexV2GazeActive(10_000, 10_000 + codexV2GazeIdleResetMs - 1), true, "the glance remains active until the idle timeout");
assert.equal(isCodexV2GazeActive(10_000, 10_000 + codexV2GazeIdleResetMs), false, "the glance resets at the idle timeout");
assert.equal(isCodexV2GazeActive(null, 10_000), false, "an unobserved cursor does not create an initial stare");

console.log("Idle cursor gaze preference and gate behavior passed.");
