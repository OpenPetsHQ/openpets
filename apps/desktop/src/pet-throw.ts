/**
 * pet-throw.ts — owns the "thrown ball" lifecycle for pet windows.
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

interface ActiveThrow {
  readonly size: { readonly width: number; readonly height: number };
  readonly options: ThrowOptions;
  /** The display the pet was released on; its work area is re-read every tick so topology changes apply. */
  readonly displayId: number;
  state: ThrowState;
  lastTick: number;
}

const activeThrows = new Map<BrowserWindow, ActiveThrow>();

/** One timer drives every active throw, started with the first throw and stopped with the last. */
let sharedTimer: NodeJS.Timeout | null = null;

export interface PetThrowPhysics {
  readonly gravityEnabled: boolean;
  /** Fraction of fall speed kept after landing (0–1). */
  readonly bounciness: number;
  /** Fraction of sideways speed shed on each landing (0–1). */
  readonly floorFriction: number;
}

export function isPetWindowThrown(window: BrowserWindow): boolean {
  return activeThrows.has(window);
}

/** Stops an in-flight throw, leaving the window where it is. */
export function cancelPetThrow(window: BrowserWindow): void {
  activeThrows.delete(window);
  if (activeThrows.size === 0 && sharedTimer) {
    clearInterval(sharedTimer);
    sharedTimer = null;
  }
}

function boundsForThrow(active: ActiveThrow): ThrowBounds {
  const center = {
    x: Math.round(active.state.x + active.size.width / 2),
    y: Math.round(active.state.y + active.size.height / 2),
  };
  const display = screen.getAllDisplays().find((candidate) => candidate.id === active.displayId)
    ?? screen.getDisplayNearestPoint(center);
  return {
    minX: display.workArea.x,
    minY: display.workArea.y,
    maxX: display.workArea.x + display.workArea.width - active.size.width,
    maxY: display.workArea.y + display.workArea.height - active.size.height,
  };
}

function tickThrows(): void {
  const now = Date.now();
  for (const [window, active] of [...activeThrows]) {
    if (window.isDestroyed()) {
      cancelPetThrow(window);
      continue;
    }

    const dtSeconds = Math.min((now - active.lastTick) / 1000, maxStepSeconds);
    active.lastTick = now;

    const next = stepThrow(active.state, dtSeconds, boundsForThrow(active), active.options);
    if (!next) {
      debug("pet.window", "throw settled", { windowId: window.id });
      cancelPetThrow(window);
      continue;
    }

    active.state = next;
    window.setBounds({ x: Math.round(next.x), y: Math.round(next.y), width: active.size.width, height: active.size.height }, false);
  }
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
  const active: ActiveThrow = {
    size,
    displayId: display.id,
    options: {
      gravity: physics.gravityEnabled ? gravityAcceleration : 0,
      floorRestitution: physics.bounciness,
      floorImpactFriction: 1 - physics.floorFriction,
    },
    state: { x: start.x, y: start.y, vx: velocity.x, vy: velocity.y },
    lastTick: Date.now(),
  };
  const bounds = boundsForThrow(active);
  if (!(bounds.maxX > bounds.minX) || !(bounds.maxY > bounds.minY)) return;

  debug("pet.window", "throw start", { windowId: window.id, velocity, bounds, physics });
  activeThrows.set(window, active);
  if (!sharedTimer) {
    sharedTimer = setInterval(tickThrows, tickIntervalMs);
    sharedTimer.unref?.();
  }
}
