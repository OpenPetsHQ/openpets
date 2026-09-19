export type VoiceAssistantShortcutStatus = "registered" | "conflict" | "unavailable" | "invalid";

export type ShortcutSaveResponse = {
  readonly preferences: { readonly voiceAssistantShortcut?: string };
  readonly voiceAssistantShortcutStatus?: {
    readonly accelerator: string;
    readonly status: VoiceAssistantShortcutStatus;
    readonly reason?: string;
  };
};

export type ShortcutSaveOutcome = {
  readonly accepted: boolean;
  readonly savedAccelerator: string;
  readonly reason?: string;
};

import { isCanonicalVoiceAssistantShortcut } from "../../voice-assistant-shortcut.js";

export type RecordedKeyboardEvent = {
  readonly code: string;
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
};

const RECORDER_SPECIAL_CODES: Readonly<Record<string, string>> = {
  Space: "Space",
  Tab: "Tab",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  NumpadAdd: "Plus",
  NumpadSubtract: "-",
  NumpadDecimal: ".",
  NumpadDivide: "/",
  // Physical punctuation keys, recorded as the literal characters Electron accepts.
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  NumpadMultiply: "*",
  PrintScreen: "PrintScreen",
  CapsLock: "Capslock",
  NumLock: "Numlock",
  ScrollLock: "Scrolllock",
  AudioVolumeUp: "VolumeUp",
  AudioVolumeDown: "VolumeDown",
  AudioVolumeMute: "VolumeMute",
  MediaTrackNext: "MediaNextTrack",
  MediaTrackPrevious: "MediaPreviousTrack",
  MediaStop: "MediaStop",
  MediaPlayPause: "MediaPlayPause",
};

function recorderKeyFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit) return digit[1];
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return RECORDER_SPECIAL_CODES[code] ?? null;
}

/** Layout fallback for keys with no physical-code mapping: any printable character. */
function recorderKeyFromChar(key: string): string | null {
  if (key.length !== 1 || key === "+" || /\s/.test(key)) return null;
  return key.toUpperCase();
}

/**
 * Map a recorded keydown to a canonical Electron accelerator, or null when
 * the combination is not recordable. The canonical validator is the single
 * source of truth for what is bindable — including that printable keys need
 * a modifier while F-keys and media keys may be bound bare.
 */
export function acceleratorFromKeyboardEvent(event: RecordedKeyboardEvent): string | null {
  const key = recorderKeyFromCode(event.code) ?? recorderKeyFromChar(event.key);
  if (!key) return null;
  const modifiers = [
    ...(event.metaKey || event.ctrlKey ? ["CommandOrControl"] : []),
    ...(event.altKey ? ["Alt"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
  ];
  const candidate = [...modifiers, key].join("+");
  return isCanonicalVoiceAssistantShortcut(candidate) ? candidate : null;
}

/** True when the keydown is a modifier key alone (still waiting for the main key). */
export function isModifierOnlyKeyEvent(event: Pick<RecordedKeyboardEvent, "code">): boolean {
  return /^(?:Control|Shift|Alt|Meta)(?:Left|Right)?$/.test(event.code);
}

const MAC_DISPLAY_PARTS: Readonly<Record<string, string>> = {
  CommandOrControl: "⌘",
  Command: "⌘",
  Control: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
  Super: "⌘",
  Meta: "⌘",
  Enter: "⏎",
  Backspace: "⌫",
  Delete: "⌦",
  Escape: "⎋",
  Tab: "⇥",
};

const GENERIC_DISPLAY_PARTS: Readonly<Record<string, string>> = {
  CommandOrControl: "Ctrl",
  Command: "Cmd",
  Control: "Ctrl",
  Alt: "Alt",
  Option: "Alt",
  Shift: "Shift",
  Super: "Win",
  Meta: "Win",
  Escape: "Esc",
  Delete: "Del",
  Insert: "Ins",
};

const SHARED_DISPLAY_PARTS: Readonly<Record<string, string>> = {
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Plus: "+",
  Minus: "-",
  PageUp: "Page ↑",
  PageDown: "Page ↓",
  MediaPlayPause: "⏯",
  MediaNextTrack: "⏭",
  MediaPreviousTrack: "⏮",
  MediaStop: "⏹",
  VolumeUp: "Vol +",
  VolumeDown: "Vol −",
  VolumeMute: "Mute",
};

/**
 * Human-readable keycap labels for an accelerator, the way regular apps
 * render shortcuts: mac gets the standard modifier glyphs (⌘⇧Space),
 * other platforms get short names (Ctrl, Shift, Space).
 */
export function acceleratorDisplayParts(accelerator: string, isMac: boolean): readonly string[] {
  if (!accelerator) return [];
  const platformParts = isMac ? MAC_DISPLAY_PARTS : GENERIC_DISPLAY_PARTS;
  return accelerator.split("+").map((part) => SHARED_DISPLAY_PARTS[part] ?? platformParts[part] ?? part);
}

export function resolveShortcutSaveOutcome(requested: string, response: ShortcutSaveResponse): ShortcutSaveOutcome {
  const savedAccelerator = response.preferences.voiceAssistantShortcut ?? "";
  // Clearing succeeds when the empty value round-trips, whatever the (disabled) status says.
  if (requested === "" && savedAccelerator === "") return { accepted: true, savedAccelerator };
  const status = response.voiceAssistantShortcutStatus;
  const accepted = savedAccelerator === requested
    && (!status || (status.status === "registered" && status.accelerator === requested && !status.reason));
  if (accepted) return { accepted: true, savedAccelerator };
  return {
    accepted: false,
    savedAccelerator,
    reason: status?.reason ?? `Pet Talk shortcut was not activated (${status?.status ?? "unknown"}).`,
  };
}
