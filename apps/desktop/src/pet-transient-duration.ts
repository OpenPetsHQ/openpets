/**
 * pet-transient-duration.ts — pure timing for transient pet displays (speech
 * bubbles and reactions). No Electron or app-state access, so it can be
 * unit-tested directly.
 */

import { defaultMediaDurationMs } from "./local-ipc-protocol.js";
import type { PetTransientDisplay } from "./pet-window-types.js";

/**
 * How long a transient display stays up. `durationScale` is the user's speech
 * bubble duration preference; it stretches the computed reading time but never
 * overrides an explicit caller duration or media duration.
 */
export function getTransientDisplayDurationMs(display: PetTransientDisplay, durationScale = 1): number {
  if (display.displayDurationMs) return display.displayDurationMs;
  if (display.mediaPath) return defaultMediaDurationMs;
  const baseMs = display.reaction === "success" || display.reaction === "error" ? 5_000 : 4_000;
  const message = display.message ?? display.reactionMessage;
  const readingMs = message ? Math.min(12_000, Math.max(baseMs, message.length * 70)) : baseMs;
  return Math.round(readingMs * durationScale);
}
