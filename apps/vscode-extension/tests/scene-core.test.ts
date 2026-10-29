import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultPetSprite } from "@open-pets/pet-format/animation";
import { codexV1SpriteLayout, codexV2SpriteLayout, getPetSpritePosition } from "@open-pets/pet-format/sprite-layout";
import { getSpriteStateFrame } from "../src/webview/companion-core.js";
import type { SceneSettings } from "../src/protocol.js";
import { createScene, reconcileScene, sceneCommand, sceneFrame, stepScene, type SceneModel } from "../src/webview/scene-core.js";

const random = () => 0.5;
const bounds = { width: 400, height: 200 };
const pets = [{ id: "a", spriteSize: { width: 48, height: 52 } }, { id: "b", spriteSize: { width: 48, height: 52 } }];
const still = { motion: "still", paused: false } as const;
function advance(model: SceneModel, milliseconds: number, settings: Pick<SceneSettings, "motion" | "paused"> = still): SceneModel {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 50) model = stepScene(model, 50, settings, random);
  return model;
}

test("placement, reconciliation and invalid time stay bounded", () => {
  const scene = createScene(pets, bounds, random);
  assert.notEqual(sceneFrame(scene).pets[0].position.x, sceneFrame(scene).pets[1].position.x);
  assert.deepEqual(sceneFrame(stepScene(scene, NaN, still, random)), sceneFrame(scene));
  assert.deepEqual(sceneFrame(stepScene(scene, 5000, still, random)), sceneFrame(stepScene(scene, 50, still, random)));
  const resized = reconcileScene(scene, [pets[1], { id: "c", spriteSize: pets[0].spriteSize }], { width: 30, height: 30 }, random);
  assert.deepEqual(sceneFrame(resized).pets.map((pet) => pet.id), ["b", "c"]);
  assert.deepEqual(sceneFrame(resized).pets[0].position, { x: 0, y: 0 });
  const zero = reconcileScene(scene, pets, { width: 0, height: 0 }, random);
  assert.deepEqual(sceneFrame(stepScene(zero, 50, still, random)), sceneFrame(zero));
});

test("zero bounds preserve positions and defer new placements until measured", () => {
  const initial = createScene(pets, bounds, random);
  const positions = sceneFrame(initial).pets.map((pet) => pet.position);
  const added = [...pets, { id: "c", spriteSize: pets[0].spriteSize }];
  const hidden = reconcileScene(initial, added, { width: 0, height: 0 }, random);
  assert.deepEqual(sceneFrame(hidden).pets.slice(0, 2).map((pet) => pet.position), positions);
  const restored = reconcileScene(hidden, added, bounds, random);
  assert.deepEqual(sceneFrame(restored).pets.slice(0, 2).map((pet) => pet.position), positions);
  assert.notEqual(sceneFrame(restored).pets[2].position.x, 0);
  const smaller = reconcileScene(hidden, added, { width: 80, height: 80 }, random);
  for (const pet of sceneFrame(smaller).pets) {
    assert.ok(pet.position.x >= 0 && pet.position.x <= 32);
    assert.ok(pet.position.y >= 0 && pet.position.y <= 28);
  }
});

test("ambient walking descends continuously after drag cancellation or release", () => {
  const calm = { motion: "calm", paused: false } as const;
  for (const interrupted of [false, true]) {
    let scene = createScene([pets[0]], bounds, random);
    scene = sceneCommand(scene, { type: "dragStart", id: "a" }, random);
    scene = sceneCommand(scene, { type: "dragMove", id: "a", position: { x: 100, y: 0 } }, random);
    scene = sceneCommand(scene, { type: interrupted ? "dragCancel" : "dragEnd", id: "a" }, random);
    const initialY = sceneFrame(scene).pets[0].position.y;
    assert.equal(sceneFrame(advance(scene, 10000, still)).pets[0].position.y, initialY);
    assert.equal(sceneFrame(advance(scene, 10000, { motion: "calm", paused: true })).pets[0].position.y, initialY);
    for (let i = 0; i < 1200 && sceneFrame(scene).pets[0].position.y < 148; i++) {
      const previousY = sceneFrame(scene).pets[0].position.y;
      scene = stepScene(scene, 50, calm, random);
      const nextY = sceneFrame(scene).pets[0].position.y;
      assert.ok(nextY >= previousY && nextY - previousY <= 5.5);
    }
    assert.equal(sceneFrame(scene).pets[0].position.y, 148);
  }
});

test("seeded ambient movement respects still, calm and pause", () => {
  const initial = createScene(pets, bounds, random);
  const calm = { motion: "calm", paused: false } as const;
  assert.deepEqual(sceneFrame(advance(initial, 6000, still)).pets.map(p => p.position), sceneFrame(initial).pets.map(p => p.position));
  const first = advance(initial, 6000, calm);
  assert.deepEqual(sceneFrame(first), sceneFrame(advance(initial, 6000, calm)));
  assert.notEqual(sceneFrame(first).pets[0].position.x, sceneFrame(initial).pets[0].position.x);
  const paused = advance(initial, 6000, { motion: "playful", paused: true });
  assert.deepEqual(sceneFrame(paused), sceneFrame(initial));
});

test("drag direction and authored release feedback, including paused feedback and cancellation", () => {
  let scene = createScene(pets, bounds, random);
  scene = sceneCommand(scene, { type: "dragStart", id: "a" }, random);
  scene = sceneCommand(scene, { type: "dragMove", id: "a", position: { x: 0, y: 80 } }, random);
  assert.equal(sceneFrame(scene).pets[0].facing, "left");
  scene = sceneCommand(scene, { type: "dragEnd", id: "a" }, random);
  assert.equal(sceneFrame(scene).pets[0].animation, "reaction");
  const duration = defaultPetSprite.states.jumping.durationMs * defaultPetSprite.states.jumping.iterations;
  scene = advance(scene, duration - 50, { motion: "still", paused: true });
  assert.equal(sceneFrame(scene).pets[0].animation, "reaction");
  scene = advance(scene, 50, { motion: "still", paused: true });
  assert.equal(sceneFrame(scene).pets[0].animation, "idle");
  scene = sceneCommand(scene, { type: "dragStart", id: "a" }, random);
  scene = sceneCommand(scene, { type: "dragCancel", id: "a" }, random);
  assert.equal(sceneFrame(scene).pets[0].animation, "idle");
});

test("drag facing resists jitter and follows accumulated reversals without moving lag", () => {
  let scene = createScene(pets, bounds, random);
  scene = sceneCommand(scene, { type: "dragStart", id: "a" }, random);
  const move = (x: number, y = 80) => {
    scene = sceneCommand(scene, { type: "dragMove", id: "a", position: { x, y } }, random);
    return sceneFrame(scene).pets[0];
  };
  assert.equal(move(150).facing, "right");
  for (const x of [149, 150, 148, 150, 149]) {
    const pet = move(x);
    assert.equal(pet.facing, "right");
    assert.equal(pet.animation, "walk");
    assert.equal(pet.position.x, x);
  }
  for (let x = 149.5; x > 144; x -= 0.5) assert.equal(move(x).facing, "right");
  assert.equal(move(144).facing, "left");
  for (let x = 144.5; x < 150; x += 0.5) assert.equal(move(x).facing, "left");
  assert.equal(move(150).facing, "right");
  assert.equal(sceneFrame(scene).pets[1].facing, "right");
});

test("held drag plays authored directional frames through jitter and reversal", () => {
  let scene = createScene([pets[0]], bounds, random);
  scene = sceneCommand(scene, { type: "dragStart", id: "a" }, random);
  const move = (x: number) => {
    scene = sceneCommand(scene, { type: "dragMove", id: "a", position: { x, y: 80 } }, random);
  };
  move(150);
  for (const layout of [codexV1SpriteLayout, codexV2SpriteLayout]) {
    const state = "running-right";
    const definition = defaultPetSprite.states[state];
    const position = getPetSpritePosition(layout, definition);
    const columns = new Set<number>();
    for (let i = 0; i < Math.ceil(definition.durationMs / 50); i++) {
      scene = stepScene(scene, 50, still, random);
      move(i % 2 ? 149 : 150);
      const pet = sceneFrame(scene).pets[0];
      assert.equal(pet.animation, "walk");
      assert.equal(pet.facing, "right");
      const frame = getSpriteStateFrame(layout, state, pet.animationElapsedMs);
      assert.equal(frame.row, position.row);
      columns.add(frame.column);
    }
    assert.ok(columns.size > 1);
    const elapsed = sceneFrame(scene).pets[0].animationElapsedMs;
    move(144);
    const reversed = sceneFrame(scene).pets[0];
    assert.equal(reversed.facing, "left");
    assert.equal(reversed.animationElapsedMs, elapsed);
    assert.equal(
      getSpriteStateFrame(layout, "running-left", elapsed).row,
      getPetSpritePosition(layout, defaultPetSprite.states["running-left"]).row,
    );
    move(150);
  }
});

test("vertical dragging animates while paused without advancing other pets", () => {
  let scene = createScene(pets, bounds, random);
  const origin = sceneFrame(scene).pets[0].position;
  scene = sceneCommand(scene, { type: "dragStart", id: "a" }, random);
  scene = sceneCommand(scene, { type: "dragMove", id: "a", position: { x: origin.x, y: 40 } }, random);
  const before = sceneFrame(scene);
  const definition = defaultPetSprite.states["running-right"];
  const columns = new Set<number>();
  for (let i = 0; i < Math.ceil(definition.durationMs / 50); i++) {
    scene = stepScene(scene, 50, { motion: "playful", paused: true }, random);
    const frame = sceneFrame(scene);
    assert.equal(frame.pets[0].animation, "walk");
    assert.deepEqual(frame.pets[0].position, { x: origin.x, y: 40 });
    assert.deepEqual(frame.pets[1], before.pets[1]);
    columns.add(getSpriteStateFrame(codexV2SpriteLayout, "running-right", frame.pets[0].animationElapsedMs).column);
  }
  assert.ok(columns.size > 1);
  scene = sceneCommand(scene, { type: "dragCancel", id: "a" }, random);
  assert.equal(sceneFrame(scene).pets[0].animation, "idle");
  assert.equal(sceneFrame(scene).pets[0].animationElapsedMs, 0);
});

test("vertical and clamped drag noise retain facing and each gesture resets its anchor", () => {
  let scene = createScene([pets[0]], bounds, random);
  scene = sceneCommand(scene, { type: "dragStart", id: "a" }, random);
  for (const position of [{ x: 500, y: 80 }, { x: 499, y: 20 }, { x: 501, y: 100 }]) {
    scene = sceneCommand(scene, { type: "dragMove", id: "a", position }, random);
    assert.equal(sceneFrame(scene).pets[0].facing, "right");
    assert.equal(sceneFrame(scene).pets[0].position.x, 352);
  }
  scene = sceneCommand(scene, { type: "dragMove", id: "a", position: { x: 348, y: 20 } }, random);
  scene = sceneCommand(scene, { type: "dragCancel", id: "a" }, random);
  scene = sceneCommand(scene, { type: "dragStart", id: "a" }, random);
  scene = sceneCommand(scene, { type: "dragMove", id: "a", position: { x: 346, y: 0 } }, random);
  assert.equal(sceneFrame(scene).pets[0].facing, "right");
  scene = sceneCommand(scene, { type: "dragEnd", id: "a" }, random);
  assert.equal(sceneFrame(scene).pets[0].animation, "reaction");
});

test("canonical frame mapping uses each layout and authored timing", () => {
  for (const layout of [codexV1SpriteLayout, codexV2SpriteLayout]) {
    const definition = defaultPetSprite.states.jumping;
    const position = getPetSpritePosition(layout, definition);
    const frame = getSpriteStateFrame(layout, "jumping", definition.durationMs / 2);
    assert.equal(frame.row, position.row);
    assert.equal(frame.column, position.animated
      ? position.startColumn + Math.floor((position.endColumn - position.startColumn) / 2)
      : position.startColumn);
  }
});
