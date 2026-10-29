import { defaultPetSprite, resolveReactionSpriteState, type SpriteStateDefinition } from "@open-pets/pet-format/animation";
import type { SceneSettings } from "../protocol.js";
import { clampSpritePosition, type Dimensions, type Point } from "./companion-core.js";

export interface ScenePetInput { readonly id: string; readonly spriteSize: Dimensions }
type Facing = "left" | "right";
type Animation = "idle" | "walk" | "reaction";
interface Pet {
  id: string;
  spriteSize: Dimensions;
  position: Point;
  placed: boolean;
  facing: Facing;
  animation: Animation;
  elapsed: number;
  wait: number;
  walkRemaining: number;
  dragging: boolean;
}
interface Ball { center: Point; velocity: Point; radius: number; age: number; chaser: string | null }
export interface SceneModel { readonly pets: readonly Pet[]; readonly bounds: Dimensions; readonly ball: Ball | null }
export interface SceneFrame {
  readonly pets: readonly { id: string; position: Point; facing: Facing; animation: Animation; animationElapsedMs: number }[];
  readonly ball: { center: Point; radius: number } | null;
}
export type SceneCommand =
  | { type: "click" | "dragStart" | "dragEnd" | "dragCancel"; id: string }
  | { type: "dragMove"; id: string; position: Point }
  | { type: "throwBall"; start: Point; velocity: Point }
  | { type: "cancelBall" };

const reactionState = resolveReactionSpriteState("success", undefined);
const reactionDefinition: SpriteStateDefinition = defaultPetSprite.states[reactionState];
const reactionDuration = reactionDefinition.durationMs * (typeof reactionDefinition.iterations === "number" ? reactionDefinition.iterations : 1);
const BALL_RADIUS = 8;
const BALL_LIFETIME = 12000;
const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const dimensions = (value: Dimensions): Dimensions => ({ width: finite(value.width), height: finite(value.height) });
const sample = (random: () => number) => Math.min(1, Math.max(0, finite(random())));
const pause = (random: () => number, playful = false) => (playful ? 900 : 2500) + sample(random) * (playful ? 1400 : 3500);
const floor = (bounds: Dimensions, size: Dimensions) => Math.max(0, bounds.height - size.height);
const active = (bounds: Dimensions) => bounds.width > 0 && bounds.height > 0;
const descent = (pet: Pet, bounds: Dimensions, dt: number) =>
  Math.min(floor(bounds, pet.spriteSize), pet.position.y + 110 * dt / 1000);

export function createScene(pets: readonly ScenePetInput[], bounds: Dimensions, random: () => number): SceneModel {
  return reconcileScene({ pets: [], bounds: dimensions(bounds), ball: null }, pets, bounds, random);
}

export function reconcileScene(model: SceneModel, inputs: readonly ScenePetInput[], bounds: Dimensions, random: () => number): SceneModel {
  const nextBounds = dimensions(bounds);
  const seen = new Set<string>();
  const pets: Pet[] = [];
  for (const input of inputs) {
    if (seen.has(input.id) || pets.length === 6) continue;
    seen.add(input.id);
    const size = dimensions(input.spriteSize);
    const old = model.pets.find((pet) => pet.id === input.id);
    const measurable = active(nextBounds);
    const initialPosition = { x: (pets.length + 1) * nextBounds.width / 7 - size.width / 2, y: floor(nextBounds, size) };
    const position = measurable
      ? clampSpritePosition(old?.placed ? old.position : initialPosition, nextBounds, size)
      : old?.position ?? { x: 0, y: 0 };
    pets.push(old ? { ...old, spriteSize: size, position, placed: old.placed || measurable } : {
      id: input.id, spriteSize: size, position, placed: measurable, facing: "right",
      animation: "idle", elapsed: 0, wait: pause(random), walkRemaining: 0, dragging: false,
    });
  }
  let ball = model.ball;
  if (ball && active(nextBounds)) {
    const radius = Math.min(BALL_RADIUS, nextBounds.width / 2, nextBounds.height / 2);
    ball = { ...ball, radius, center: { x: Math.max(radius, Math.min(nextBounds.width - radius, ball.center.x)), y: Math.max(radius, Math.min(nextBounds.height - radius, ball.center.y)) }, chaser: pets.some((pet) => pet.id === ball?.chaser && !pet.dragging) ? ball.chaser : null };
  }
  return { pets, bounds: nextBounds, ball };
}

function feedback(pet: Pet, random: () => number): Pet {
  return { ...pet, dragging: false, animation: "reaction", elapsed: 0, wait: pause(random), walkRemaining: 0 };
}

export function sceneCommand(model: SceneModel, command: SceneCommand, random: () => number): SceneModel {
  if (command.type === "cancelBall") return { ...model, ball: null };
  if (command.type === "throwBall") {
    if (!active(model.bounds)) return model;
    const radius = Math.min(BALL_RADIUS, model.bounds.width / 2, model.bounds.height / 2);
    const vx = Number.isFinite(command.velocity.x) ? command.velocity.x : 0;
    const vy = Number.isFinite(command.velocity.y) ? command.velocity.y : 0;
    const scale = Math.min(1, 900 / (Math.hypot(vx, vy) || 1));
    const point = (v: number, max: number) => Math.max(radius, Math.min(max - radius, Number.isFinite(v) ? v : radius));
    return { ...model, ball: { center: { x: point(command.start.x, model.bounds.width), y: point(command.start.y, model.bounds.height) }, velocity: { x: vx * scale, y: vy * scale }, radius, age: 0, chaser: null } };
  }
  const index = model.pets.findIndex((pet) => pet.id === command.id);
  if (index < 0) return model;
  const pets = [...model.pets];
  let pet = pets[index];
  if (command.type === "click") pet = feedback(pet, random);
  if (command.type === "dragStart") pet = { ...pet, dragging: true, animation: "idle", elapsed: 0, walkRemaining: 0 };
  if (command.type === "dragMove" && pet.dragging) {
    const position = clampSpritePosition({ x: Number.isFinite(command.position.x) ? command.position.x : pet.position.x, y: Number.isFinite(command.position.y) ? command.position.y : pet.position.y }, model.bounds, pet.spriteSize);
    const dx = position.x - pet.position.x;
    pet = { ...pet, position, facing: Math.abs(dx) >= 1 ? (dx < 0 ? "left" : "right") : pet.facing, animation: Math.abs(dx) >= 1 ? "walk" : "idle", elapsed: Math.abs(dx) >= 1 && pet.animation === "walk" ? pet.elapsed : 0 };
  }
  if (command.type === "dragEnd" && pet.dragging) pet = feedback(pet, random);
  if (command.type === "dragCancel" && pet.dragging) pet = { ...pet, dragging: false, animation: "idle", elapsed: 0, wait: pause(random) };
  pets[index] = pet;
  const ball = model.ball?.chaser === pet.id && pet.dragging ? { ...model.ball, chaser: null } : model.ball;
  return { ...model, pets, ball };
}

export function stepScene(model: SceneModel, dtMs: number, settings: Pick<SceneSettings, "motion" | "paused">, random: () => number): SceneModel {
  const dt = Math.min(50, finite(dtMs));
  if (!dt || !active(model.bounds)) return model;
  let ball = model.ball;
  if (ball && !settings.paused) {
    const seconds = dt / 1000;
    let vx = ball.velocity.x;
    let vy = ball.velocity.y + 900 * seconds;
    let x = ball.center.x + vx * seconds;
    let y = ball.center.y + vy * seconds;
    const r = ball.radius;
    if (x < r || x > model.bounds.width - r) { x = Math.max(r, Math.min(model.bounds.width - r, x)); vx *= -0.65; }
    if (y > model.bounds.height - r) { y = model.bounds.height - r; vy = vy > 45 ? -vy * 0.55 : 0; vx *= Math.pow(0.94, dt / 50); }
    if (y < r) { y = r; vy = Math.abs(vy) * 0.65; }
    ball = { ...ball, center: { x, y }, velocity: { x: vx, y: vy }, age: ball.age + dt };
    if (ball.age >= BALL_LIFETIME) ball = null;
  }
  if (ball && !settings.paused && !model.pets.some((pet) => pet.id === ball?.chaser && !pet.dragging && pet.animation !== "reaction")) {
    let distance = Infinity;
    let chaser: string | null = null;
    for (const pet of model.pets) {
      if (pet.dragging || pet.animation === "reaction") continue;
      const d = Math.abs(pet.position.x + pet.spriteSize.width / 2 - ball.center.x);
      if (d < distance) { distance = d; chaser = pet.id; }
    }
    ball = { ...ball, chaser };
  }
  const pets = model.pets.map((original) => {
    let pet = { ...original };
    if (pet.dragging) return pet;
    if (pet.animation === "reaction") {
      pet.elapsed += dt;
      if (pet.elapsed >= reactionDuration) { pet.animation = "idle"; pet.elapsed = 0; }
      return pet;
    }
    if (settings.paused) return pet;
    if (ball?.chaser === pet.id) {
      const center = pet.position.x + pet.spriteSize.width / 2;
      const delta = ball.center.x - center;
      const feet = pet.position.y + pet.spriteSize.height;
      if (ball.center.y >= model.bounds.height - ball.radius - 20 && Math.abs(delta) <= pet.spriteSize.width / 2 + ball.radius && Math.abs(feet - ball.center.y) <= ball.radius + 20) {
        ball = null;
        return feedback(pet, random);
      }
      const move = Math.sign(delta) * Math.min(Math.abs(delta), 110 * dt / 1000);
      const y = descent(pet, model.bounds, dt);
      pet.position = clampSpritePosition({ x: pet.position.x + move, y }, model.bounds, pet.spriteSize);
      if (Math.abs(move) > 0.01) { pet.facing = move < 0 ? "left" : "right"; pet.elapsed = pet.animation === "walk" ? pet.elapsed + dt : 0; pet.animation = "walk"; }
      else { pet.animation = "idle"; pet.elapsed += dt; }
      return pet;
    }
    if (settings.motion === "still") { pet.animation = "idle"; pet.walkRemaining = 0; pet.elapsed += dt; return pet; }
    if (pet.walkRemaining > 0) {
      const direction = pet.facing === "left" ? -1 : 1;
      const x = pet.position.x + direction * (settings.motion === "playful" ? 48 : 32) * dt / 1000;
      const position = clampSpritePosition({ x, y: descent(pet, model.bounds, dt) }, model.bounds, pet.spriteSize);
      pet.walkRemaining -= dt;
      pet.elapsed += dt;
      if (position.x === pet.position.x || pet.walkRemaining <= 0) { pet.animation = "idle"; pet.elapsed = 0; pet.walkRemaining = 0; pet.wait = pause(random, settings.motion === "playful"); }
      pet.position = position;
    } else {
      pet.animation = "idle"; pet.elapsed += dt; pet.wait -= dt;
      if (pet.wait <= 0) { pet.facing = sample(random) < 0.5 ? "left" : "right"; pet.walkRemaining = 600 + sample(random) * 1200; pet.animation = "walk"; pet.elapsed = 0; }
    }
    return pet;
  });
  return { ...model, pets, ball };
}

export function sceneFrame(model: SceneModel): SceneFrame {
  return { pets: model.pets.map(({ id, position, facing, animation, elapsed }) => ({ id, position: { ...position }, facing, animation, animationElapsedMs: elapsed })), ball: model.ball ? { center: { ...model.ball.center }, radius: model.ball.radius } : null };
}
