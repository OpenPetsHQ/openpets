import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildProviderControlCenterSnapshot,
  createProviderProfile,
  getPluginPlatformSettings,
  initializePluginPlatformSettings,
  providerPresets,
  selectProviderProfile,
  validateProviderProfile,
  type ProviderProfile,
} from "../src/plugin-platform-settings.js";

const dir = mkdtempSync(join(tmpdir(), "openpets-provider-presets-"));

try {
  initializePluginPlatformSettings(dir);

  // 1. OpenRouter preset tests
  const openrouterPreset = providerPresets.find((p) => p.id === "openrouter");
  assert.ok(openrouterPreset, "OpenRouter preset must exist");
  assert.equal(openrouterPreset.label, "OpenRouter");
  assert.equal(openrouterPreset.adapter, "openai-compatible-text");
  assert.equal(openrouterPreset.model, "openai/gpt-4o-mini");
  assert.equal(openrouterPreset.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(openrouterPreset.credentialMode, "required");

  // Verify creating an OpenRouter profile with optional headers and validating it
  const openrouterProfile = validateProviderProfile({
    id: "openrouter-main",
    label: openrouterPreset.label,
    adapter: openrouterPreset.adapter,
    model: openrouterPreset.model,
    baseUrl: openrouterPreset.baseUrl,
    secretRef: "openrouter-key",
    headers: [
      { name: "HTTP-Referer", value: "https://openpets.app" },
      { name: "X-Title", value: "OpenPets" },
    ],
  });
  assert.equal(openrouterProfile.id, "openrouter-main");
  assert.equal(openrouterProfile.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(openrouterProfile.headers?.length, 2);

  // 2. All provider presets create valid profiles
  for (const preset of providerPresets) {
    const profileInput = {
      id: `test-${preset.id}`,
      label: preset.label,
      adapter: preset.adapter,
      model: preset.model,
      ...("baseUrl" in preset && typeof preset.baseUrl === "string" ? { baseUrl: preset.baseUrl } : {}),
      ...(preset.credentialMode === "required" ? { secretRef: `ref-${preset.id}` } : {}),
    };
    const validated = validateProviderProfile(profileInput);
    assert.equal(validated.id, profileInput.id);
    createProviderProfile(validated);
  }

  // 3. Save-and-activate role transitions
  // Select OpenRouter for text (Pet Brain)
  selectProviderProfile("text", "test-openrouter");
  assert.equal(getPluginPlatformSettings().selections.text, "test-openrouter");

  // Select Whisper for STT (Hearing)
  selectProviderProfile("stt", "test-whisper");
  assert.equal(getPluginPlatformSettings().selections.stt, "test-whisper");

  // Select System Voice for TTS (Speech)
  selectProviderProfile("tts", "test-system-tts");
  assert.equal(getPluginPlatformSettings().selections.tts, "test-system-tts");

  // Disable role by setting to null
  selectProviderProfile("stt", null);
  assert.equal(getPluginPlatformSettings().selections.stt, null);

  // 4. Credential requirement verification in snapshot
  const snapshot = buildProviderControlCenterSnapshot(
    getPluginPlatformSettings(),
    (profile: ProviderProfile) => profile.secretRef === "ref-openrouter", // only openrouter has credential stored
  );

  const textStatus = snapshot.statuses.text;
  assert.equal(textStatus.state, "ready", "OpenRouter with stored credential is ready");

  // ElevenLabs was created with secretRef "ref-elevenlabs" which is not stored
  selectProviderProfile("tts", "test-elevenlabs");
  const snapshot2 = buildProviderControlCenterSnapshot(
    getPluginPlatformSettings(),
    (profile: ProviderProfile) => profile.secretRef === "ref-openrouter",
  );
  assert.equal(snapshot2.statuses.tts.state, "missing-secret", "ElevenLabs without credential must report missing-secret");

  // System TTS has no credential required
  selectProviderProfile("tts", "test-system-tts");
  const snapshot3 = buildProviderControlCenterSnapshot(
    getPluginPlatformSettings(),
    () => false,
  );
  assert.equal(snapshot3.statuses.tts.state, "ready", "System TTS with no credential required must report ready");

  // Local Ollama has no credential required
  selectProviderProfile("text", "test-ollama");
  const snapshot4 = buildProviderControlCenterSnapshot(
    getPluginPlatformSettings(),
    () => false,
  );
  assert.equal(snapshot4.statuses.text.state, "ready", "Local Ollama with no credential required must report ready");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("provider presets and role activation tests passed.");
