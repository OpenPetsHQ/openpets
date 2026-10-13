/**
 * pet-throw-core.ts — pure physics for flinging a pet window like a ball.
 *
 * No Electron, timers, or settings: callers feed in pointer samples while
 * dragging and step the simulation with explicit time deltas and bounds, so the
 * behavior is deterministic and unit-testable.
 */

export interface ThrowPoint {
  readonly x: number;
  readonly y: number;
}

export interface ThrowBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface ThrowState {
  readonly x: number;
  readonly y: number;
  /** Pixels per second. */
  readonly vx: number;
  readonly vy: number;
}

/** Only the most recent pointer motion defines the throw; older samples are a slow drag, not a flick. */
export const velocitySampleWindowMs = 100;
/** A pointer that was already still this long before release is a drop, not a throw. */
export const staleReleaseMs = 80;
/** Slower releases are treated as a plain drop. */
export const minLaunchSpeed = 400;
export const maxLaunchSpeed = 6000;
/** Velocity fraction kept after one second of free flight. */
export const frictionPerSecond = 0.35;
/** Fraction of the normal velocity kept after hitting an edge. */
export const restitution = 0.75;
/** The throw ends once the pet is slower than this. */
export const settleSpeed = 40;
/** Matches the motion engine's gravity (2.2 px/tick² at 16 ms ticks) so a thrown pet falls like a dropped one. */
export const gravityAcceleration = 8600;
export const maxFallSpeed = 3000;
/** With gravity the pet follows an arc, so air drag is gentle; without it, friction is the only thing that stops the pet. */
export const gravityAirDragPerSecond = 0.8;
/** Velocity fraction kept after one second of sliding along the floor. */
export const floorFrictionPerSecond = 0.02;
/** Fraction of the fall speed kept after hitting the floor under gravity; walls stay livelier than the floor. */
export const defaultFloorRestitution = 0.5;
/** Fraction of sideways speed kept each time the pet lands on the floor, so it skids to a stop instead of hopping along. */
export const defaultFloorImpactFriction = 0.7;
/** Floor/ceiling bounces slower than this stop instead of jittering. */
export const restingBounceSpeed = 350;

interface PointerSample extends ThrowPoint {
  readonly t: number;
}

export interface VelocityTracker {
  addSample(t: number, x: number, y: number): void;
  /** Returns the release velocity in px/s, or null when the release should be a plain drop. */
  release(now: number): ThrowPoint | null;
  reset(): void;
}

export function createVelocityTracker(): VelocityTracker {
  let samples: PointerSample[] = [];

  return {
    addSample(t, x, y) {
      samples.push({ t, x, y });
      const oldest = t - velocitySampleWindowMs;
      samples = samples.filter((sample) => sample.t >= oldest);
    },
    release(now) {
      if (samples.length < 2) return null;
      const first = samples[0];
      const last = samples[samples.length - 1];
      if (now - last.t > staleReleaseMs) return null;
      const elapsedSeconds = (last.t - first.t) / 1000;
      if (elapsedSeconds <= 0) return null;

      const vx = (last.x - first.x) / elapsedSeconds;
      const vy = (last.y - first.y) / elapsedSeconds;
      const speed = Math.hypot(vx, vy);
      if (!Number.isFinite(speed) || speed < minLaunchSpeed) return null;

      const scale = speed > maxLaunchSpeed ? maxLaunchSpeed / speed : 1;
      return { x: vx * scale, y: vy * scale };
    },
    reset() {
      samples = [];
    },
  };
}

export interface ThrowOptions {
  /** Downward acceleration in px/s²; 0 flies in a straight line until friction stops the pet. */
  readonly gravity: number;
  /** Fraction of fall speed kept after landing (0–1). Defaults to `defaultFloorRestitution`. */
  readonly floorRestitution?: number;
  /** Fraction of sideways speed kept after landing (0–1); lower skids to a stop sooner. Defaults to `defaultFloorImpactFriction`. */
  readonly floorImpactFriction?: number;
}

/** Advances the throw by `dtSeconds`, reflecting off the bounds. Returns the next state, or null once settled. */
export function stepThrow(state: ThrowState, dtSeconds: number, bounds: ThrowBounds, options: ThrowOptions = { gravity: 0 }): ThrowState | null {
  const hasGravity = options.gravity > 0;
  const floorRestitution = options.floorRestitution ?? defaultFloorRestitution;
  const floorImpactFriction = options.floorImpactFriction ?? defaultFloorImpactFriction;
  const drag = Math.pow(hasGravity ? gravityAirDragPerSecond : frictionPerSecond, dtSeconds);
  let vx = state.vx * drag;
  let vy = state.vy * drag;
  if (hasGravity) vy = Math.min(vy + options.gravity * dtSeconds, maxFallSpeed);

  const wasOnFloor = hasGravity && state.y >= bounds.maxY;
  if (wasOnFloor) vx *= Math.pow(floorFrictionPerSecond, dtSeconds);

  let x = state.x + vx * dtSeconds;
  let y = state.y + vy * dtSeconds;

  if (x < bounds.minX) {
    x = bounds.minX + (bounds.minX - x);
    vx = Math.abs(vx) * restitution;
  } else if (x > bounds.maxX) {
    x = bounds.maxX - (x - bounds.maxX);
    vx = -Math.abs(vx) * restitution;
  }

  if (y < bounds.minY) {
    y = bounds.minY + (bounds.minY - y);
    vy = Math.abs(vy) * restitution;
  } else if (y > bounds.maxY) {
    y = bounds.maxY - (y - bounds.maxY);
    if (hasGravity) {
      vy = -Math.abs(vy) * floorRestitution;
      // Only an airborne pet lands; one already on the floor is sliding and is slowed by floor drag instead.
      if (!wasOnFloor) vx *= floorImpactFriction;
    } else {
      vy = -Math.abs(vy) * restitution;
    }
    if (hasGravity && Math.abs(vy) < restingBounceSpeed) {
      // A bounce too small to see: rest on the floor instead of hovering at the reflected height.
      vy = 0;
      y = bounds.maxY;
    }
  }

  // A tiny window or a huge step could still overshoot after one reflection.
  x = Math.min(Math.max(x, bounds.minX), bounds.maxX);
  y = Math.min(Math.max(y, bounds.minY), bounds.maxY);

  if (hasGravity) {
    // Gravity keeps vy non-zero, and the apex of an arc is momentarily slow, so only rest on the floor ends the throw.
    const restingOnFloor = y >= bounds.maxY && vy === 0;
    if (restingOnFloor && Math.abs(vx) < settleSpeed) return null;
    return { x, y, vx, vy };
  }

  if (Math.hypot(vx, vy) < settleSpeed) return null;
  return { x, y, vx, vy };
}
