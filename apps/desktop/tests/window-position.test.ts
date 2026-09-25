/**
 * Unit tests for window-position.ts.
 *
 * Electron's setPosition throws on -0 and NaN; setWindowPosition must never
 * pass either through. No Electron process is required.
 */

import assert from "node:assert/strict";

import { setWindowPosition, toWindowCoordinate } from "../src/window-position.js";

function recorder() {
  const calls: unknown[][] = [];
  return { calls, window: { setPosition: (...args: unknown[]) => { calls.push(args); } } as any };
}

// Math.round(-0.3) is -0; the helper must hand Electron a plain 0.
assert.ok(Object.is(Math.round(-0.3), -0), "precondition: Math.round yields -0");
assert.ok(Object.is(toWindowCoordinate(-0.3), 0), "-0.3 -> +0");
assert.ok(Object.is(toWindowCoordinate(-0), 0), "-0 -> +0");
assert.equal(toWindowCoordinate(-480), -480);
assert.equal(toWindowCoordinate(12.6), 13);
assert.equal(toWindowCoordinate(Number.NaN), null);
assert.equal(toWindowCoordinate(Number.POSITIVE_INFINITY), null);

// Airmail flight: -480 -> 2064 over 15 s at 16 ms ticks. Tick 176 (2828 ms) rounds to -0.
{
  const { calls, window } = recorder();
  const x = Math.round(-480 + (2064 - -480) * (2828 / 15_000));
  assert.ok(Object.is(x, -0), "precondition: airmail tick lands on -0");
  assert.equal(setWindowPosition(window, x, 240), true);
  assert.ok(Object.is(calls[0]?.[0], 0), "airmail -0 passed through as +0");
  assert.deepEqual(calls[0], [0, 240]);
}

// animate flag is forwarded only when given.
{
  const { calls, window } = recorder();
  setWindowPosition(window, 10, 20, false);
  assert.deepEqual(calls[0], [10, 20, false]);
}

// Non-finite coordinates skip the move instead of throwing.
{
  const { calls, window } = recorder();
  assert.equal(setWindowPosition(window, Number.NaN, 0), false);
  assert.equal(calls.length, 0);
}

console.error("window-position.test.ts: all window position tests passed.");
