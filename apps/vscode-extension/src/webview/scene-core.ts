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
  dragExtreme: number | null;
}
export interface SceneModel { readonly pets: readonly Pet[]; readonly bounds: Dimensions }
export interface SceneFrame {
  readonly pets: readonly { id: string; position: Point; facing: Facing; animation: Animation; animationElapsedMs: number }[];
}
export type SceneCommand =
  | { type: "click" | "dragStart" | "dragEnd" | "dragCancel"; id: string }
  | { type: "dragMove"; id: string; position: Point };

const reactionState = resolveReactionSpriteState("success", undefined);
const reactionDefinition: SpriteStateDefinition = defaultPetSprite.states[reactionState];
const reactionDuration = reactionDefinition.durationMs * (typeof reactionDefinition.iterations === "number" ? reactionDefinition.iterations : 1);
const DRAG_FACING_DEADZONE = 6;
const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const dimensions = (value: Dimensions): Dimensions => ({ width: finite(value.width), height: finite(value.height) });
const sample = (random: () => number) => Math.min(1, Math.max(0, finite(random())));
const pause = (random: () => number, playful = false) => (playful ? 900 : 2500) + sample(random) * (playful ? 1400 : 3500);
const floor = (bounds: Dimensions, size: Dimensions) => Math.max(0, bounds.height - size.height);
const active = (bounds: Dimensions) => bounds.width > 0 && bounds.height > 0;
const descent = (pet: Pet, bounds: Dimensions, dt: number) =>
  Math.min(floor(bounds, pet.spriteSize), pet.position.y + 110 * dt / 1000);

export function createScene(pets: readonly ScenePetInput[], bounds: Dimensions, random: () => number): SceneModel {
  return reconcileScene({ pets: [], bounds: dimensions(bounds) }, pets, bounds, random);
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
      animation: "idle", elapsed: 0, wait: pause(random), walkRemaining: 0, dragging: false, dragExtreme: null,
    });
  }
  return { pets, bounds: nextBounds };
}

function feedback(pet: Pet, random: () => number): Pet {
  return {
    ...pet,
    dragging: false,
    dragExtreme: null,
    animation: "reaction",
    elapsed: 0,
    wait: pause(random),
    walkRemaining: 0,
  };
}

export function sceneCommand(model: SceneModel, command: SceneCommand, random: () => number): SceneModel {
  const index = model.pets.findIndex((pet) => pet.id === command.id);
  if (index < 0) return model;
  const pets = [...model.pets];
  let pet = pets[index];
  if (command.type === "click") pet = feedback(pet, random);
  if (command.type === "dragStart") {
    pet = {
      ...pet,
      dragging: true,
      dragExtreme: pet.position.x,
      animation: "walk",
      elapsed: 0,
      walkRemaining: 0,
    };
  }
  if (command.type === "dragMove" && pet.dragging) {
    const position = clampSpritePosition({ x: Number.isFinite(command.position.x) ? command.position.x : pet.position.x, y: Number.isFinite(command.position.y) ? command.position.y : pet.position.y }, model.bounds, pet.spriteSize);
    let facing = pet.facing;
    let extreme = pet.dragExtreme ?? pet.position.x;
    if (facing === "right") {
      extreme = Math.max(extreme, position.x);
      if (extreme - position.x >= DRAG_FACING_DEADZONE) {
        facing = "left";
        extreme = position.x;
      }
    } else {
      extreme = Math.min(extreme, position.x);
      if (position.x - extreme >= DRAG_FACING_DEADZONE) {
        facing = "right";
        extreme = position.x;
      }
    }
    pet = {
      ...pet,
      position,
      facing,
      dragExtreme: extreme,
    };
  }
  if (command.type === "dragEnd" && pet.dragging) pet = feedback(pet, random);
  if (command.type === "dragCancel" && pet.dragging) {
    pet = {
      ...pet,
      dragging: false,
      dragExtreme: null,
      animation: "idle",
      elapsed: 0,
      wait: pause(random),
    };
  }
  pets[index] = pet;
  return { ...model, pets };
}

export function stepScene(model: SceneModel, dtMs: number, settings: Pick<SceneSettings, "motion" | "paused">, random: () => number): SceneModel {
  const dt = Math.min(50, finite(dtMs));
  if (!dt || !active(model.bounds)) return model;
  const pets = model.pets.map((original) => {
    let pet = { ...original };
    if (pet.dragging) {
      pet.elapsed += dt;
      return pet;
    }
    if (pet.animation === "reaction") {
      pet.elapsed += dt;
      if (pet.elapsed >= reactionDuration) { pet.animation = "idle"; pet.elapsed = 0; }
      return pet;
    }
    if (settings.paused) return pet;
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
  return { ...model, pets };
}

export function sceneFrame(model: SceneModel): SceneFrame {
  return { pets: model.pets.map(({ id, position, facing, animation, elapsed }) => ({ id, position: { ...position }, facing, animation, animationElapsedMs: elapsed })) };
}
