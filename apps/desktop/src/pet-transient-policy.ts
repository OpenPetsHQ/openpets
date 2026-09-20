import { getAppStateSnapshot } from "./app-state.js";
import { getActiveLocale } from "./i18n/index.js";
import { defaultMediaDurationMs } from "./local-ipc-protocol.js";
import { getConfiguredSpriteStates } from "./reaction-animation-mapping.js";
import { pickReactionMessage } from "./reaction-messages.js";
import { getReactionSpriteState } from "./pet-window-render.js";
import type { PetTransientDisplay } from "./pet-window-types.js";

export function preparePetTransientDisplay(display: PetTransientDisplay): PetTransientDisplay {
  if (display.suppressReactionMessage) return display;
  if (!display.reaction || display.message || display.reactionMessage) return display;
  return { ...display, reactionMessage: pickReactionMessage(display.reaction, Math.random, getActiveLocale()) };
}

export function mergePetTransientDisplay(current: PetTransientDisplay | null, next: PetTransientDisplay): PetTransientDisplay {
  if (next.message || next.mediaPath || !next.reaction || !current?.message) return preparePetTransientDisplay(next);
  return { ...current, reaction: next.reaction, dismissToken: next.dismissToken ?? current.dismissToken };
}

export function getTransientReactionAnimationMs(display: PetTransientDisplay): number | null {
  if (!display.reaction) return null;
  const state = getReactionSpriteState(display.reaction);
  const row = getConfiguredSpriteStates(getAppStateSnapshot().preferences.waitingAnimationDurationMs)[state];
  const iterations = "iterations" in row ? row.iterations : "infinite";
  return typeof iterations === "number" ? row.durationMs * iterations : null;
}

export function getTransientDisplayDurationMs(display: PetTransientDisplay): number {
  if (display.displayDurationMs) return display.displayDurationMs;
  if (display.mediaPath) return defaultMediaDurationMs;
  const baseMs = display.reaction === "success" || display.reaction === "error" ? 5_000 : 4_000;
  const message = display.message ?? display.reactionMessage;
  if (!message) return baseMs;
  return Math.min(12_000, Math.max(baseMs, message.length * 70));
}

export function clearTransientReaction(display: PetTransientDisplay): PetTransientDisplay {
  if (!display.reaction) return display;
  return { ...display, reaction: undefined };
}
