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

test("off-floor chaser descends continuously before catching", () => {
  let scene = createScene([pets[0]], bounds, random);
  scene = sceneCommand(scene, { type: "dragStart", id: "a" }, random);
  scene = sceneCommand(scene, { type: "dragMove", id: "a", position: { x: 100, y: 0 } }, random);
  scene = sceneCommand(scene, { type: "dragCancel", id: "a" }, random);
  scene = sceneCommand(scene, { type: "throwBall", start: { x: 124, y: 192 }, velocity: { x: 0, y: 0 } }, random);
  scene = stepScene(scene, 50, still, random);
  assert.notEqual(sceneFrame(scene).ball, null);
  assert.ok(sceneFrame(scene).pets[0].position.y > 0 && sceneFrame(scene).pets[0].position.y <= 5.5);
  for (let i = 0; i < 100 && sceneFrame(scene).ball; i++) {
    const previousY = sceneFrame(scene).pets[0].position.y;
    scene = stepScene(scene, 50, still, random);
    assert.ok(sceneFrame(scene).pets[0].position.y - previousY <= 5.5);
  }
  assert.equal(sceneFrame(scene).ball, null);
  assert.equal(sceneFrame(scene).pets[0].animation, "reaction");
});

test("ambient walking descends continuously after interrupted chase or high release", () => {
  const calm = { motion: "calm", paused: false } as const;
  for (const interrupted of [false, true]) {
    let scene = createScene([pets[0]], bounds, random);
    scene = sceneCommand(scene, { type: "dragStart", id: "a" }, random);
    scene = sceneCommand(scene, { type: "dragMove", id: "a", position: { x: 100, y: 0 } }, random);
    scene = sceneCommand(scene, { type: interrupted ? "dragCancel" : "dragEnd", id: "a" }, random);
    if (interrupted) {
      scene = sceneCommand(scene, { type: "throwBall", start: { x: 300, y: 192 }, velocity: { x: 0, y: 0 } }, random);
      scene = stepScene(scene, 50, calm, random);
      scene = sceneCommand(scene, { type: "cancelBall" }, random);
    }
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

test("ties select stable first pet and an uncatchable ball expires", () => {
  let scene = createScene(pets, bounds, random);
  for (const id of ["a", "b"]) {
    scene = sceneCommand(scene, { type: "dragStart", id }, random);
    scene = sceneCommand(scene, { type: "dragMove", id, position: { x: 100, y: 148 } }, random);
    scene = sceneCommand(scene, { type: "dragCancel", id }, random);
  }
  scene = sceneCommand(scene, { type: "throwBall", start: { x: 300, y: 20 }, velocity: { x: 0, y: 0 } }, random);
  scene = stepScene(scene, 50, still, random);
  assert.ok(sceneFrame(scene).pets[0].position.x > sceneFrame(scene).pets[1].position.x);
  let empty = createScene([], bounds, random);
  empty = sceneCommand(empty, { type: "throwBall", start: { x: 50, y: 50 }, velocity: { x: 0, y: 0 } }, random);
  assert.notEqual(sceneFrame(advance(empty, 1000)).ball, null);
  assert.equal(sceneFrame(advance(empty, 12000)).ball, null);
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

test("ball chooses one chaser, pauses, catches and times out", () => {
  let scene = createScene(pets, bounds, random);
  scene = sceneCommand(scene, { type: "throwBall", start: { x: 350, y: 10 }, velocity: { x: 0, y: 0 } }, random);
  const before = sceneFrame(scene);
  scene = stepScene(scene, 50, { motion: "still", paused: true }, random);
  assert.deepEqual(sceneFrame(scene), before);
  scene = advance(scene, 500);
  const after = sceneFrame(scene);
  assert.equal(after.pets.filter((pet, i) => pet.position.x !== before.pets[i].position.x).length, 1);
  scene = sceneCommand(scene, { type: "throwBall", start: { x: 0, y: 0 }, velocity: { x: 100000, y: -100000 } }, random);
  for (let i = 0; i < 240 && sceneFrame(scene).ball; i++) {
    scene = stepScene(scene, 50, still, random);
    const ball = sceneFrame(scene).ball;
    if (ball) assert.ok(ball.center.x >= ball.radius && ball.center.x <= bounds.width - ball.radius && ball.center.y >= ball.radius && ball.center.y <= bounds.height - ball.radius);
  }
  assert.equal(sceneFrame(scene).ball, null);
  const one = createScene([pets[0]], bounds, random);
  const x = sceneFrame(one).pets[0].position.x + 24;
  const caught = stepScene(sceneCommand(one, { type: "throwBall", start: { x, y: 192 }, velocity: { x: 0, y: 0 } }, random), 50, still, random);
  assert.equal(sceneFrame(caught).ball, null);
  assert.equal(sceneFrame(caught).pets[0].animation, "reaction");
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
