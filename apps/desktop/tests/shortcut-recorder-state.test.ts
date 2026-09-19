import assert from "node:assert/strict";

import { acceleratorDisplayParts, acceleratorFromKeyboardEvent, isModifierOnlyKeyEvent } from "../src/renderer/src/settings-shortcut-state.js";
import { isCanonicalVoiceAssistantShortcut } from "../src/voice-assistant-shortcut.js";

type RecordedEvent = Parameters<typeof acceleratorFromKeyboardEvent>[0];
const press = (code: string, key: string, mods: Partial<Pick<RecordedEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">> = {}): RecordedEvent =>
  ({ code, key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

// Contract: every accelerator the recorder emits must be accepted by the main
// process's canonical-accelerator validator, with modifiers in canonical order.
const captured: ReadonlyArray<readonly [RecordedEvent, string]> = [
  [press("KeyP", "p", { metaKey: true }), "CommandOrControl+P"],
  [press("KeyP", "P", { ctrlKey: true, shiftKey: true }), "CommandOrControl+Shift+P"],
  [press("Digit5", "5", { altKey: true }), "Alt+5"],
  [press("Numpad7", "7", { ctrlKey: true }), "CommandOrControl+7"],
  [press("Space", " ", { metaKey: true, shiftKey: true }), "CommandOrControl+Shift+Space"],
  [press("ArrowUp", "ArrowUp", { ctrlKey: true }), "CommandOrControl+Up"],
  [press("F12", "F12", { altKey: true, shiftKey: true }), "Alt+Shift+F12"],
  [press("NumpadEnter", "Enter", { ctrlKey: true }), "CommandOrControl+Enter"],
  // Punctuation binds like in regular apps: cmd+; and friends.
  [press("Semicolon", ";", { metaKey: true }), "CommandOrControl+;"],
  [press("Slash", "/", { ctrlKey: true, shiftKey: true }), "CommandOrControl+Shift+/"],
  [press("Backquote", "`", { altKey: true }), "Alt+`"],
  [press("Minus", "-", { altKey: true }), "Alt+-"],
  // Keys with no physical-code mapping fall back to the produced character.
  [press("IntlBackslash", "<", { metaKey: true }), "CommandOrControl+<"],
  // F-keys and media keys are bindable without a modifier.
  [press("F5", "F5"), "F5"],
  [press("MediaPlayPause", "MediaPlayPause"), "MediaPlayPause"],
];
for (const [event, expected] of captured) {
  const accelerator = acceleratorFromKeyboardEvent(event);
  assert.equal(accelerator, expected);
  assert.equal(isCanonicalVoiceAssistantShortcut(accelerator), true, `recorder output ${accelerator} must pass main-process validation`);
}

// Printable keys without a modifier would swallow typing system-wide; rejected.
assert.equal(acceleratorFromKeyboardEvent(press("KeyA", "a")), null);
assert.equal(acceleratorFromKeyboardEvent(press("Semicolon", ";")), null);
assert.equal(acceleratorFromKeyboardEvent(press("Space", " ")), null);

// Modifier-only presses keep the recorder waiting instead of capturing.
assert.equal(isModifierOnlyKeyEvent({ code: "ShiftLeft" }), true);
assert.equal(isModifierOnlyKeyEvent({ code: "MetaRight" }), true);
assert.equal(isModifierOnlyKeyEvent({ code: "Control" }), true);
assert.equal(isModifierOnlyKeyEvent({ code: "KeyA" }), false);

// Keycap rendering: mac gets glyphs, other platforms get short names.
assert.deepEqual(acceleratorDisplayParts("CommandOrControl+Shift+Space", true), ["⌘", "⇧", "Space"]);
assert.deepEqual(acceleratorDisplayParts("CommandOrControl+Shift+Space", false), ["Ctrl", "Shift", "Space"]);
assert.deepEqual(acceleratorDisplayParts("Alt+Up", true), ["⌥", "↑"]);
assert.deepEqual(acceleratorDisplayParts("CommandOrControl+;", false), ["Ctrl", ";"]);
assert.deepEqual(acceleratorDisplayParts("", true), []);

console.log("Shortcut recorder accelerator mapping verified.");
