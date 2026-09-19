import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildProviderControlCenterSnapshot, createProviderProfile, getPluginPlatformSettings, initializePluginPlatformSettings, profileStatus, selectProviderProfile } from "../src/plugin-platform-settings.js";

const directory = mkdtempSync(join(tmpdir(), "openpets-provider-migration-"));
try {
  writeFileSync(join(directory, "openpets-plugin-platform.json"), JSON.stringify({
    profiles: {
      eleven: { id: "eleven", label: "Eleven", adapter: "elevenlabs-tts", model: "eleven_multilingual_v2", baseUrl: "https://api.elevenlabs.io/v1", secretRef: "eleven-key" },
      minimax: { id: "minimax", label: "MiniMax", adapter: "minimax-tts", model: "speech-2.8-turbo", baseUrl: "https://api.minimax.io/v1", secretRef: "minimax-key" },
      compatible: { id: "compatible", label: "Compatible", adapter: "openai-compatible-speech", model: "tts", baseUrl: "https://speech.example/v1" },
      realtime: { id: "realtime", label: "Realtime", adapter: "openai-realtime", model: "gpt-realtime-2.1", baseUrl: "https://api.openai.com/v1", secretRef: "openai-key" },
      corrupt: { id: "corrupt", label: "Corrupt", adapter: "elevenlabs-tts", model: "" },
    },
    selections: { text: "realtime", tts: "eleven" },
  }), "utf8");

  const settings = initializePluginPlatformSettings(directory);
  assert.equal(settings.profiles.eleven?.voice, "od84OdVweqzO3t6kKlWT");
  assert.equal(settings.profiles.minimax?.voice, "English_expressive_narrator");
  assert.equal(settings.profiles.compatible?.voice, "alloy");
  assert.equal(settings.profiles.realtime?.model, "");
  assert.equal(settings.profiles.realtime?.adapter === "openai-realtime" ? settings.profiles.realtime.realtimeModel : undefined, "gpt-realtime-2.1");
  assert.ok(settings.quarantinedProfiles.corrupt, "invalid persisted profiles remain recoverable in quarantine");
  assert.equal(JSON.parse(readFileSync(join(directory, "openpets-plugin-platform.json"), "utf8")).version, 1);
  assert.throws(() => createProviderProfile({ id: "corrupt", label: "Replacement", adapter: "system-tts", model: "" }), /quarantined/);

  selectProviderProfile("tts", "eleven");
  assert.equal(profileStatus(getPluginPlatformSettings(), "tts", () => false).state, "missing-secret");
  selectProviderProfile("text", "realtime");
  assert.equal(profileStatus(getPluginPlatformSettings(), "text", () => true).state, "invalid");

  const snapshot = buildProviderControlCenterSnapshot(getPluginPlatformSettings(), () => false);
  assert.equal(JSON.stringify(snapshot).includes("eleven-key"), false, "snapshots never expose secret-store references");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("Provider migration behavior verified.");
