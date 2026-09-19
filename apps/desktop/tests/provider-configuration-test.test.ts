import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProviderProfile } from "../src/provider-contract.js";
import { testProviderConfiguration } from "../src/provider-configuration-test.js";
import {
  getPluginPlatformSettings,
  initializePluginPlatformSettings,
  previewProviderConfiguration,
} from "../src/plugin-platform-settings.js";

const originalFetch = globalThis.fetch;

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "openpets-provider-configuration-test-"));
  try {
    const requests: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/chat/completions")) {
        return Response.json({ choices: [{ message: { content: "connected" } }] });
      }
      if (url.endsWith("/audio/transcriptions")) {
        return Response.json({ text: "heard you" });
      }
      if (url.endsWith("/speech-to-text")) {
        return Response.json({ text: "heard you from ElevenLabs" });
      }
      if (url.endsWith("/realtime/sessions")) {
        return Response.json({ id: "session" });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    };

    const text = await testProviderConfiguration({
      id: "text-test",
      label: "Text test",
      adapter: "openai-compatible-text",
      model: "model",
      baseUrl: "https://provider.test/v1",
    }, undefined);
    assert.deepEqual(text, { kind: "text", detail: "connected" });

    const tts = await testProviderConfiguration({
      id: "tts-test",
      label: "TTS test",
      adapter: "elevenlabs-tts",
      model: "model",
      voice: "voice-id",
      baseUrl: "https://provider.test/v1",
    }, "test-key");
    assert.equal(tts.kind, "tts");
    assert.deepEqual(Array.from(tts.bytes), [1, 2, 3]);

    const stt = await testProviderConfiguration({
      id: "stt-test",
      label: "STT test",
      adapter: "openai-compatible-transcription",
      model: "whisper",
      baseUrl: "https://provider.test/v1",
    }, undefined, { bytes: new Uint8Array([1]), mimeType: "audio/webm" });
    assert.deepEqual(stt, { kind: "stt", detail: "heard you" });

    const elevenLabsRequestStart = requests.length;
    const elevenLabsStt = await testProviderConfiguration({
      id: "elevenlabs-stt-test",
      label: "ElevenLabs STT test",
      adapter: "elevenlabs-transcription",
      model: "scribe_v2",
      baseUrl: "https://provider.test/v1",
    }, "test-key", { bytes: new Uint8Array([1]), mimeType: "audio/webm" });
    assert.deepEqual(elevenLabsStt, { kind: "stt", detail: "heard you from ElevenLabs" });
    assert.deepEqual(requests.slice(elevenLabsRequestStart), [
      "https://provider.test/v1/speech-to-text",
    ]);

    const noAudioRequestStart = requests.length;
    await assert.rejects(
      () => testProviderConfiguration({
        id: "elevenlabs-stt-no-audio-test",
        label: "ElevenLabs STT no-audio test",
        adapter: "elevenlabs-transcription",
        model: "scribe_v2",
        baseUrl: "https://provider.test/v1",
      }, "test-key"),
      /Record a short sample before testing transcription\./,
    );
    assert.deepEqual(requests.slice(noAudioRequestStart), []);

    const realtime = await testProviderConfiguration({
      id: "realtime-test",
      label: "Realtime test",
      adapter: "openai-realtime",
      model: "text-model",
      realtimeModel: "realtime-model",
      baseUrl: "https://provider.test/v1",
    }, "test-key");
    assert.deepEqual(realtime, { kind: "realtime", detail: "Realtime session configuration accepted." });
    assert.deepEqual(requests, [
      "https://provider.test/v1/chat/completions",
      "https://provider.test/v1/text-to-speech/voice-id",
      "https://provider.test/v1/audio/transcriptions",
      "https://provider.test/v1/speech-to-text",
      "https://provider.test/v1/realtime/sessions",
    ]);

    const system = await testProviderConfiguration({
      id: "system-test",
      label: "System test",
      adapter: "system-tts",
      model: "",
    }, undefined);
    assert.deepEqual(system, { kind: "system-tts" });

    initializePluginPlatformSettings(directory);
    const before = getPluginPlatformSettings();
    const draft = previewProviderConfiguration({
      isEditing: false,
      profileId: "draft-text",
      payload: {
        id: "draft-text",
        label: "Draft text",
        adapter: "openai-compatible-text",
        model: "model",
        baseUrl: "https://provider.test/v1",
      },
      credentialValue: "temporary-key",
      activatedRoles: [],
      deactivatedRoles: [],
    });
    assert.equal(draft.secretRef, "profile:draft-text");
    assert.deepEqual(getPluginPlatformSettings(), before);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
}

main().then(
  () => console.log("provider configuration test behavior passed."),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
