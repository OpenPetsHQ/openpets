import {
  defaultPetSprite,
  resolveReactionSpriteState,
  type SpriteStateDefinition,
  type UniversalSpriteState,
} from "@open-pets/pet-format/animation";
import {
  getPetSpritePosition,
  type PetSpriteLayout,
} from "@open-pets/pet-format/sprite-layout";
import type { CompanionSize } from "../protocol.js";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

export interface SpriteFrame {
  readonly state: UniversalSpriteState;
  readonly row: number;
  readonly column: number;
}

/** Pass elapsed idle time, or elapsed time since the most recent click. */
export function getCompanionFrame(
  layout: PetSpriteLayout,
  elapsedMs: number,
  clicked = false,
): SpriteFrame {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const clickState = resolveReactionSpriteState("success", undefined);
  const clickDefinition: SpriteStateDefinition =
    defaultPetSprite.states[clickState];
  const clickDuration =
    clickDefinition.durationMs *
    (typeof clickDefinition.iterations === "number"
      ? clickDefinition.iterations
      : 1);
  const playingClick = clicked && elapsed < clickDuration;
  const state = playingClick ? clickState : "idle";
  const stateElapsed =
    clicked && !playingClick ? elapsed - clickDuration : elapsed;
  return getSpriteStateFrame(layout, state, stateElapsed);
}

export function getSpriteStateFrame(
  layout: PetSpriteLayout,
  state: UniversalSpriteState,
  elapsedMs: number,
): SpriteFrame {
  const stateElapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const definition: SpriteStateDefinition = defaultPetSprite.states[state];
  const position = getPetSpritePosition(layout, definition);
  const frameCount = position.endColumn - position.startColumn;
  const progress =
    (stateElapsed % definition.durationMs) / definition.durationMs;
  const column = position.animated
    ? position.startColumn + Math.floor(progress * frameCount)
    : position.startColumn;
  return { state, row: position.row, column };
}

export function getSpriteSize(
  layout: PetSpriteLayout,
  size: CompanionSize,
): Dimensions {
  const scale = size === "small" ? 0.25 : size === "medium" ? 0.375 : 0.5;
  return {
    width: layout.frameWidth * scale,
    height: layout.frameHeight * scale,
  };
}

/** Top-left containment; a sprite larger than its stage is anchored at zero. */
export function clampSpritePosition(
  point: Point,
  stage: Dimensions,
  sprite: Dimensions,
): Point {
  return {
    x: Math.min(Math.max(0, point.x), Math.max(0, stage.width - sprite.width)),
    y: Math.min(
      Math.max(0, point.y),
      Math.max(0, stage.height - sprite.height),
    ),
  };
}

/** The caller retains whether any prior pointer movement crossed the threshold. */
export function isDragMovement(
  start: Point,
  current: Point,
  threshold: number,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

/** Once moved, returning to the press point must not turn a drag into a click. */
export function getDragUpdate(
  gesture: { start: Point; origin: Point; crossedThreshold: boolean },
  current: Point,
  bounds: Dimensions,
  sprite: Dimensions,
): { crossedThreshold: boolean; position: Point } {
  const crossedThreshold =
    gesture.crossedThreshold || isDragMovement(gesture.start, current, 4);
  const position = crossedThreshold
    ? clampSpritePosition(
        {
          x: gesture.origin.x + current.x - gesture.start.x,
          y: gesture.origin.y + current.y - gesture.start.y,
        },
        bounds,
        sprite,
      )
    : gesture.origin;
  return { crossedThreshold, position };
}
