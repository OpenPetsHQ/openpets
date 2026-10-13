/**
 * pet-throw.ts — owns the per-window "thrown ball" lifecycle.
 *
 * A released drag with enough velocity hands the window here. The throw bounces
 * off the work area of the display the pet was released on (so reaching another
 * monitor still requires an actual drag), and ends once friction settles it.
 * While a throw is active the motion engine yields to it, the same way it
 * yields to dragging, so there is one writer of the window position.
 */

import { screen, type BrowserWindow } from "electron";

import { debug } from "./logger.js";
import { gravityAcceleration, stepThrow, type ThrowBounds, type ThrowOptions, type ThrowPoint, type ThrowState } from "./pet-throw-core.js";

const tickIntervalMs = 16;
/** A stalled event loop must not teleport the pet across the screen. */
const maxStepSeconds = 0.05;

export interface PetThrowPhysics {
  readonly gravityEnabled: boolean;
  /** Fraction of fall speed kept after landing (0–1). */
  readonly bounciness: number;
  /** Fraction of sideways speed shed on each landing (0–1). */
  readonly floorFriction: number;
}

const activeThrows = new WeakMap<BrowserWindow, NodeJS.Timeout>();

export function isPetWindowThrown(window: BrowserWindow): boolean {
  return activeThrows.has(window);
}

/** Stops an in-flight throw, leaving the window where it is. */
export function cancelPetThrow(window: BrowserWindow): void {
  const timer = activeThrows.get(window);
  if (!timer) return;
  clearInterval(timer);
  activeThrows.delete(window);
}

export function startPetThrow(
  window: BrowserWindow,
  size: { readonly width: number; readonly height: number },
  velocity: ThrowPoint,
  physics: PetThrowPhysics,
): void {
  if (window.isDestroyed()) return;
  cancelPetThrow(window);

  const start = window.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: start.x + Math.round(size.width / 2),
    y: start.y + Math.round(size.height / 2),
  });
  const bounds: ThrowBounds = {
    minX: display.workArea.x,
    minY: display.workArea.y,
    maxX: display.workArea.x + display.workArea.width - size.width,
    maxY: display.workArea.y + display.workArea.height - size.height,
  };
  if (!(bounds.maxX > bounds.minX) || !(bounds.maxY > bounds.minY)) return;

  const options: ThrowOptions = {
    gravity: physics.gravityEnabled ? gravityAcceleration : 0,
    floorRestitution: physics.bounciness,
    floorImpactFriction: 1 - physics.floorFriction,
  };
  let state: ThrowState = { x: start.x, y: start.y, vx: velocity.x, vy: velocity.y };
  let lastTick = Date.now();
  debug("pet.window", "throw start", { windowId: window.id, velocity, bounds, physics });

  const tick = (): void => {
    if (window.isDestroyed()) {
      cancelPetThrow(window);
      return;
    }

    const now = Date.now();
    const dtSeconds = Math.min((now - lastTick) / 1000, maxStepSeconds);
    lastTick = now;

    const next = stepThrow(state, dtSeconds, bounds, options);
    if (!next) {
      debug("pet.window", "throw settled", { windowId: window.id });
      cancelPetThrow(window);
      return;
    }

    state = next;
    window.setBounds({ x: Math.round(next.x), y: Math.round(next.y), width: size.width, height: size.height }, false);
  };

  const timer = setInterval(tick, tickIntervalMs);
  timer.unref?.();
  activeThrows.set(window, timer);
}
