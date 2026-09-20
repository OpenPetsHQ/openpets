import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

const userDataPath = mkdtempSync(join(tmpdir(), "openpets-voice-device-state-"));

const electronMock = `data:text/javascript,${encodeURIComponent(`
  export const app = { getPath: (name) => name === "userData" ? ${JSON.stringify(userDataPath)} : ${JSON.stringify(userDataPath)}, isReady: () => true };
  export const net = {};
  export const powerMonitor = { on: () => {}, getSystemIdleTime: () => 0 };
  export const screen = { on: () => {}, getAllDisplays: () => [] };
  export const shell = { openPath: async () => "" };
  export default { app, net, powerMonitor, screen, shell };
`)}`;
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: ${JSON.stringify(electronMock)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

try {
  const { getAppStateSnapshot, initializeAppState, releaseStartupInstallLock, updatePreferences } = await import("../src/app-state.js");
  try {
    initializeAppState();
    assert.equal(getAppStateSnapshot().preferences.showChatButton, false, "fresh state hides the chat button by default");
    assert.equal(getAppStateSnapshot().preferences.showTalkButton, false, "fresh state hides the talk button by default");

    releaseStartupInstallLock();
    writeFileSync(join(userDataPath, "openpets-state.json"), JSON.stringify({
      version: 1,
      preferences: {
        preferredVoiceInputDeviceId: "  mic-id  ",
        preferredVoiceOutputDeviceId: "\u0001invalid",
      },
    }), "utf8");
    initializeAppState();
    assert.equal(getAppStateSnapshot().preferences.showChatButton, false, "absent saved chat preference uses the opt-in default");
    assert.equal(getAppStateSnapshot().preferences.showTalkButton, false, "absent saved talk preference uses the opt-in default");
    assert.equal(getAppStateSnapshot().preferences.preferredVoiceInputDeviceId, "  mic-id  ");
    assert.equal(getAppStateSnapshot().preferences.preferredVoiceOutputDeviceId, null);

    updatePreferences({ preferredVoiceOutputDeviceId: "speaker-id" });
    const persisted = JSON.parse(readFileSync(join(userDataPath, "openpets-state.json"), "utf8")) as { preferences?: Record<string, unknown> };
    assert.equal(persisted.preferences?.preferredVoiceInputDeviceId, "  mic-id  ");
    assert.equal(persisted.preferences?.preferredVoiceOutputDeviceId, "speaker-id");

    updatePreferences({ preferredVoiceInputDeviceId: "default" });
    assert.equal(getAppStateSnapshot().preferences.preferredVoiceInputDeviceId, null);
  } finally {
    releaseStartupInstallLock();
  }
} finally {
  rmSync(userDataPath, { recursive: true, force: true });
}

console.log("Voice device preference normalization and persistence verified.");
