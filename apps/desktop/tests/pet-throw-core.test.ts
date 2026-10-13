import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createVelocityTracker, gravityAcceleration, stepThrow, type ThrowBounds, type ThrowOptions, type ThrowState } from "../src/pet-throw-core.js";

const bounds: ThrowBounds = { minX: 0, minY: 0, maxX: 1000, maxY: 600 };

function simulate(start: ThrowState, maxSteps = 5000, gravity = 0, extra: Partial<ThrowOptions> = {}): { final: ThrowState; settled: boolean; positions: ThrowState[] } {
  let state = start;
  const positions: ThrowState[] = [];
  for (let step = 0; step < maxSteps; step += 1) {
    const next = stepThrow(state, 1 / 60, bounds, { gravity, ...extra });
    if (!next) return { final: state, settled: true, positions };
    state = next;
    positions.push(state);
  }
  return { final: state, settled: false, positions };
}

describe("release velocity", () => {
  it("turns a fast flick into a throw in the flick direction", () => {
    const tracker = createVelocityTracker();
    tracker.addSample(0, 100, 100);
    tracker.addSample(50, 200, 100);
    const velocity = tracker.release(55);
    assert.ok(velocity);
    assert.ok(velocity.x > 0);
    assert.equal(velocity.y, 0);
  });

  it("treats a slow drag as a plain drop", () => {
    const tracker = createVelocityTracker();
    tracker.addSample(0, 100, 100);
    tracker.addSample(100, 110, 100);
    assert.equal(tracker.release(105), null);
  });

  it("treats pausing before release as a plain drop", () => {
    const tracker = createVelocityTracker();
    tracker.addSample(0, 100, 100);
    tracker.addSample(50, 400, 100);
    assert.equal(tracker.release(400), null);
  });

  it("forgets samples after reset", () => {
    const tracker = createVelocityTracker();
    tracker.addSample(0, 100, 100);
    tracker.addSample(50, 400, 100);
    tracker.reset();
    assert.equal(tracker.release(55), null);
  });
});

describe("throw simulation", () => {
  it("bounces off the right edge and heads back", () => {
    const start: ThrowState = { x: 900, y: 300, vx: 2000, vy: 0 };
    const { positions } = simulate(start);
    const rightmost = Math.max(...positions.map((state) => state.x));
    assert.equal(rightmost <= bounds.maxX, true);
    assert.ok(positions.some((state) => state.vx < 0), "velocity reverses after the wall");
  });

  it("never leaves the bounds, whatever the throw", () => {
    const directions = [
      { vx: 6000, vy: 6000 },
      { vx: -6000, vy: 4000 },
      { vx: 300, vy: -6000 },
      { vx: -5000, vy: -5000 },
    ];
    for (const direction of directions) {
      const { positions } = simulate({ x: 500, y: 300, ...direction });
      for (const state of positions) {
        assert.ok(state.x >= bounds.minX && state.x <= bounds.maxX, `x ${state.x} in bounds`);
        assert.ok(state.y >= bounds.minY && state.y <= bounds.maxY, `y ${state.y} in bounds`);
      }
    }
  });

  it("settles instead of bouncing forever", () => {
    const { settled } = simulate({ x: 500, y: 300, vx: 3000, vy: -2500 });
    assert.equal(settled, true);
  });
});

describe("throw simulation with gravity", () => {
  it("curves downward instead of flying in a straight line", () => {
    const { positions } = simulate({ x: 100, y: 300, vx: 1500, vy: 0 }, 20, gravityAcceleration);
    assert.ok(positions[positions.length - 1].y > positions[0].y + 50, "pet falls while moving sideways");
    assert.ok(positions[positions.length - 1].x > positions[0].x, "pet keeps moving in the throw direction");
  });

  it("rises, then falls, when thrown upward", () => {
    const { positions } = simulate({ x: 500, y: 500, vx: 0, vy: -1800 }, 40, gravityAcceleration);
    const highest = Math.min(...positions.map((state) => state.y));
    assert.ok(highest < 500, "pet goes up first");
    assert.ok(positions[positions.length - 1].y > highest, "pet comes back down");
  });

  it("comes to rest on the floor, not in mid-air", () => {
    const { final, settled } = simulate({ x: 200, y: 100, vx: 1200, vy: -1500 }, 5000, gravityAcceleration);
    assert.equal(settled, true);
    assert.equal(final.y, bounds.maxY);
  });

  it("stays inside the bounds", () => {
    const { positions } = simulate({ x: 500, y: 300, vx: -6000, vy: -6000 }, 5000, gravityAcceleration);
    for (const state of positions) {
      assert.ok(state.x >= bounds.minX && state.x <= bounds.maxX);
      assert.ok(state.y >= bounds.minY && state.y <= bounds.maxY);
    }
  });

  it("loses most of its bounce within a few hops, not dozens", () => {
    const { positions, settled } = simulate({ x: 500, y: 0, vx: 800, vy: 0 }, 5000, gravityAcceleration);
    assert.equal(settled, true);
    let landings = 0;
    for (let index = 1; index < positions.length; index += 1) {
      if (positions[index - 1].vy > 0 && positions[index].vy < 0) landings += 1;
    }
    assert.ok(landings <= 5, `expected at most 5 landings, saw ${landings}`);
  });

  it("slides to a stop soon after landing", () => {
    const { positions } = simulate({ x: 100, y: 590, vx: 600, vy: 0 }, 5000, gravityAcceleration);
    const travelled = positions[positions.length - 1].x - 100;
    assert.ok(travelled < 400, `slid ${travelled}px, expected a short skid`);
  });

  it("bounces higher with more bounciness", () => {
    const peakAfterLanding = (floorRestitution: number): number => {
      const { positions } = simulate({ x: 500, y: 0, vx: 0, vy: 0 }, 400, gravityAcceleration, { floorRestitution });
      const landing = positions.findIndex((state) => state.vy < 0);
      return Math.min(...positions.slice(landing).map((state) => state.y));
    };
    assert.ok(peakAfterLanding(0.8) < peakAfterLanding(0.3), "a bouncier floor should rebound higher");
  });

  it("skids farther with less floor friction", () => {
    const skid = (floorImpactFriction: number): number => {
      const { final } = simulate({ x: 100, y: 590, vx: 600, vy: 0 }, 5000, gravityAcceleration, { floorImpactFriction });
      return final.x - 100;
    };
    assert.ok(skid(1) > skid(0.3), "less friction should travel farther");
  });
});
