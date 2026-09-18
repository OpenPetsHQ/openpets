import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OpenPetsReaction } from "../src/local-ipc-protocol.js";
import {
  defaultReactionToSpriteState,
  isLoopingSpriteState,
  resolveEffectiveSpriteState,
} from "../src/reaction-animation-mapping.js";

// Regression coverage for https://github.com/OpenPetsHQ/openpets/issues/91.
//
// The transient display (bubble) expires after a few seconds while a busy
// status badge (thinking/working/editing/running/testing/waiting) survives up
// to two minutes. The renderer used to derive the sprite from the display
// reaction only, so the pet snapped back to idle while the busy badge was
// still shown. The render decision must keep looping busy states animated
// while the badge survives and keep terminal one-shots bounded.

const busyReactions: OpenPetsReaction[] = ["thinking", "working", "editing", "running", "testing", "waiting"];
const terminalReactions: OpenPetsReaction[] = ["waving", "success", "error", "celebrating"];

describe("pet sprite persistence", () => {
  it("keeps looping busy states animated after the transient display expires", () => {
    for (const badge of busyReactions) {
      const expected = defaultReactionToSpriteState[badge];
      assert.notEqual(expected, "idle", `${badge} must map to a non-idle sprite`);
      assert.equal(
        resolveEffectiveSpriteState(undefined, badge),
        expected,
        `${badge} badge must keep the pet animated after its display expires`,
      );
    }
  });

  it("keeps terminal one-shot reactions bounded after the display expires", () => {
    for (const badge of terminalReactions) {
      assert.equal(
        resolveEffectiveSpriteState(undefined, badge),
        "idle",
        `${badge} badge must not keep the pet animated after its display expires`,
      );
    }
  });

  it("prefers a live display reaction over the surviving badge", () => {
    assert.equal(resolveEffectiveSpriteState("thinking", "waiting"), "review");
    assert.equal(
      resolveEffectiveSpriteState("success", "thinking"),
      "jumping",
      "a terminal flash must win while it is displayed",
    );
    assert.equal(resolveEffectiveSpriteState("idle", "thinking"), "idle");
  });

  it("returns idle with no display and no badge", () => {
    assert.equal(resolveEffectiveSpriteState(undefined, undefined), "idle");
  });

  it("honors user overrides when deciding persistence", () => {
    assert.equal(
      resolveEffectiveSpriteState(undefined, "thinking", { thinking: "jumping" }),
      "idle",
      "a busy reaction overridden to a finite animation must stay bounded",
    );
    assert.equal(
      resolveEffectiveSpriteState(undefined, "thinking", { thinking: "waiting" }),
      "waiting",
      "a busy reaction overridden to a looping animation must persist",
    );
  });

  it("classifies looping versus finite sprite states", () => {
    for (const state of ["idle", "review", "running", "waiting"] as const) {
      assert.equal(isLoopingSpriteState(state), true, `${state} must loop`);
    }
    for (const state of ["waving", "jumping", "failed"] as const) {
      assert.equal(isLoopingSpriteState(state), false, `${state} must be finite`);
    }
  });
});
