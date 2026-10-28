import assert from "node:assert/strict";

import { defaultMediaDurationMs } from "../src/local-ipc-protocol.js";
import { getTransientDisplayDurationMs } from "../src/pet-transient-duration.js";

// Contract: the speech bubble duration setting stretches or shortens the
// computed reading time, and leaves explicit and media durations alone.
{
  const display = { message: "x".repeat(100) };
  const normal = getTransientDisplayDurationMs(display);
  assert.equal(normal, 7_000, "reading time grows with message length");
  assert.equal(getTransientDisplayDurationMs(display, 1), normal, "the Normal setting keeps the default reading time");
  assert.equal(getTransientDisplayDurationMs(display, 2.5), 17_500, "Very long scales the reading time");
  assert.equal(getTransientDisplayDurationMs(display, 0.6), 4_200, "Short scales the reading time down");
  console.log("getTransientDisplayDurationMs: duration setting scales reading time — PASS");
}

{
  assert.equal(getTransientDisplayDurationMs({ message: "Hi", displayDurationMs: 3_000 }, 2.5), 3_000, "an explicit caller duration wins");
  assert.equal(getTransientDisplayDurationMs({ mediaPath: "/tmp/cat.gif" }, 2.5), defaultMediaDurationMs, "media keeps its own duration");
  console.log("getTransientDisplayDurationMs: explicit and media durations unchanged — PASS");
}

console.log("\nAll pet-transient-duration tests passed.");
