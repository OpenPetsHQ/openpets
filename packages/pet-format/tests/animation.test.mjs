import assert from "node:assert/strict";
import { test } from "node:test";
import { getPetSpriteLayout, getPetSpritePosition } from "../dist/sprite-layout.js";
import { defaultPetSprite, getConfiguredSpriteStates, resolveEffectiveSpriteState, resolveReactionSpriteState } from "../dist/animation.js";

test("V1 and V2 retain their atlas and neutral preview behavior", () => {
  const v1 = getPetSpriteLayout({});
  const v2 = getPetSpriteLayout({ spriteVersionNumber: 2 });
  assert.equal(v1.rows, 9);
  assert.equal(v2.rows, 11);
  assert.deepEqual(getPetSpritePosition(v2, defaultPetSprite.states.idle, true), {
    row: 0, startColumn: 6, endColumn: 6, animated: false,
  });
  assert.equal(getPetSpritePosition(v1, defaultPetSprite.states.idle, true).animated, true);
  assert.throws(() => getPetSpriteLayout({ spriteVersionNumber: 1 }));
});

test("reaction overrides and finite badges preserve their playback behavior", () => {
  assert.equal(resolveReactionSpriteState("thinking", { thinking: "waving" }), "waving");
  assert.equal(resolveEffectiveSpriteState(undefined, "success"), "idle");
  assert.equal(resolveEffectiveSpriteState(undefined, "thinking"), "review");
  assert.equal(getConfiguredSpriteStates(2200).waiting.durationMs, 2200);
  assert.equal(defaultPetSprite.states.waiting.durationMs, 1010);
});
