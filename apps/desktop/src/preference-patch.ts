/**
 * preference-patch.ts — pure preference-patch validation (no Electron).
 *
 * Extracted from windows.ts so the validation logic can be unit-tested
 * without an Electron process context.
 */

import { normalizeAppearanceTheme, normalizeHudScale, normalizePetButtonsPosition, normalizePetButtonsSize, normalizePetScale, normalizeWaitingAnimationDurationMs, type AppearanceTheme, type PetButtonsPosition, type PetButtonsSize, type WaitingAnimationDurationMs } from "./app-state-core.js";
import { isSupportedLocale, type LocalePreference } from "./i18n/index.js";
import { validateReactionAnimationOverrides } from "./reaction-animation-mapping.js";
import { validatePetAssistantPersonalityPatch, type PetAssistantPersonalityPatch } from "./pet-assistant-personality.js";
import { validateVoiceAssistantShortcut } from "./voice-assistant-shortcut.js";

export type PreferencePatch = {
  openDefaultPetOnLaunch?: boolean;
  locale?: LocalePreference;
  appearanceTheme?: AppearanceTheme;
  petScale?: number;
  hudScale?: number;
  waitingAnimationDurationMs?: WaitingAnimationDurationMs;
  reactionAnimationOverrides?: ReturnType<typeof validateReactionAnimationOverrides>;
  petPoolEnabled?: boolean;
  petConfinementEnabled?: boolean;
  petCrossDisplayEnabled?: boolean;
  petGravityEnabled?: boolean;
  personality?: PetAssistantPersonalityPatch;
  voiceAssistantShortcut?: string;
  /** Empty string disables the chat shortcut; otherwise a canonical accelerator. */
  chatShortcut?: string;
  /** Empty string disables the pet visibility shortcut; otherwise a canonical accelerator. */
  petToggleShortcut?: string;
  showChatButton?: boolean;
  showTalkButton?: boolean;
  petButtonsPosition?: PetButtonsPosition;
  petButtonsSize?: PetButtonsSize;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate and parse an arbitrary preferences patch from the renderer.
 * Only recognised keys are forwarded; unknown keys are silently ignored.
 * Throws on malformed values so the IPC handler can return a clean error.
 */
export function validatePreferencePatch(value: unknown): PreferencePatch {
  if (!isRecord(value)) {
    throw new Error("Invalid preferences patch.");
  }

  const patch: PreferencePatch = {};

  if ("openDefaultPetOnLaunch" in value) {
    if (typeof value.openDefaultPetOnLaunch !== "boolean") throw new Error("Invalid open-on-launch value.");
    patch.openDefaultPetOnLaunch = value.openDefaultPetOnLaunch;
  }

  if ("petPoolEnabled" in value) {
    if (typeof value.petPoolEnabled !== "boolean") throw new Error("Invalid pet-pool-enabled value.");
    patch.petPoolEnabled = value.petPoolEnabled;
  }

  if ("petConfinementEnabled" in value) {
    if (typeof value.petConfinementEnabled !== "boolean") throw new Error("Invalid pet-confinement-enabled value.");
    patch.petConfinementEnabled = value.petConfinementEnabled;
  }

  if ("petGravityEnabled" in value) {
    if (typeof value.petGravityEnabled !== "boolean") throw new Error("Invalid pet-gravity-enabled value.");
    patch.petGravityEnabled = value.petGravityEnabled;
  }

  if ("petCrossDisplayEnabled" in value) {
    if (typeof value.petCrossDisplayEnabled !== "boolean") throw new Error("Invalid pet-cross-display-enabled value.");
    patch.petCrossDisplayEnabled = value.petCrossDisplayEnabled;
  }

  if ("locale" in value) {
    if (value.locale !== "system" && !isSupportedLocale(value.locale)) throw new Error("Invalid locale value.");
    patch.locale = value.locale as LocalePreference;
  }

  if ("appearanceTheme" in value) {
    const theme = normalizeAppearanceTheme(value.appearanceTheme);
    if (theme !== value.appearanceTheme) throw new Error("Invalid appearance theme value.");
    patch.appearanceTheme = theme;
  }

  if ("petScale" in value) {
    const scale = normalizePetScale(value.petScale);
    if (scale !== value.petScale) throw new Error("Invalid pet scale value.");
    patch.petScale = scale;
  }

  if ("hudScale" in value) {
    const scale = normalizeHudScale(value.hudScale);
    if (scale !== value.hudScale) throw new Error("Invalid HUD scale value.");
    patch.hudScale = scale;
  }

  if ("waitingAnimationDurationMs" in value) {
    const durationMs = normalizeWaitingAnimationDurationMs(value.waitingAnimationDurationMs);
    if (durationMs !== value.waitingAnimationDurationMs) throw new Error("Invalid waiting animation duration value.");
    patch.waitingAnimationDurationMs = durationMs;
  }

  if ("reactionAnimationOverrides" in value) {
    patch.reactionAnimationOverrides = validateReactionAnimationOverrides(value.reactionAnimationOverrides);
  }

  if ("personality" in value) {
    patch.personality = validatePetAssistantPersonalityPatch(value.personality);
  }

  if ("voiceAssistantShortcut" in value) {
    // Clearable: an empty accelerator disables the Talk shortcut.
    patch.voiceAssistantShortcut = value.voiceAssistantShortcut === ""
      ? ""
      : validateVoiceAssistantShortcut(value.voiceAssistantShortcut);
  }

  if ("chatShortcut" in value) {
    // Unlike the Talk shortcut, the chat shortcut can be cleared entirely.
    patch.chatShortcut = value.chatShortcut === ""
      ? ""
      : validateVoiceAssistantShortcut(value.chatShortcut);
  }

  if ("petToggleShortcut" in value) {
    // Clearable like the chat shortcut.
    patch.petToggleShortcut = value.petToggleShortcut === ""
      ? ""
      : validateVoiceAssistantShortcut(value.petToggleShortcut);
  }

  if ("showChatButton" in value) {
    if (typeof value.showChatButton !== "boolean") throw new Error("Invalid chat button visibility value.");
    patch.showChatButton = value.showChatButton;
  }

  if ("showTalkButton" in value) {
    if (typeof value.showTalkButton !== "boolean") throw new Error("Invalid talk button visibility value.");
    patch.showTalkButton = value.showTalkButton;
  }

  if ("petButtonsPosition" in value) {
    const position = normalizePetButtonsPosition(value.petButtonsPosition);
    if (position !== value.petButtonsPosition) throw new Error("Invalid pet buttons position value.");
    patch.petButtonsPosition = position;
  }

  if ("petButtonsSize" in value) {
    const size = normalizePetButtonsSize(value.petButtonsSize);
    if (size !== value.petButtonsSize) throw new Error("Invalid pet buttons size value.");
    patch.petButtonsSize = size;
  }

  return patch;
}
