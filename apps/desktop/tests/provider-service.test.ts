import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildProviderControlCenterSnapshot, initializePluginPlatformSettings, createProviderProfile, getPluginPlatformSettings, selectProviderProfile } from "../src/plugin-platform-settings.js";
import { HostProviderService } from "../src/provider-service.js";
import type { PluginSecretsStore } from "../src/plugin-secrets.js";

const dir = mkdtempSync(join(tmpdir(), "openpets-provider-service-"));
const secrets = { get: async () => "test-key" } as unknown as PluginSecretsStore;

function responseStream(chunks: Uint8Array[], onCancel: () => void, close = true): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (close) controller.close();
    },
    cancel() { onCancel(); },
  });
}

async function main(): Promise<void> {
try {
  initializePluginPlatformSettings(dir);
  createProviderProfile({ id: "text", label: "Text", adapter: "openai-compatible-text", model: "model", baseUrl: "https://provider.example/v1", secretRef: "text" });
  createProviderProfile({ id: "stt", label: "STT", adapter: "openai-compatible-transcription", model: "whisper", baseUrl: "https://provider.example/v1", secretRef: "stt" });
  createProviderProfile({ id: "elevenlabs-stt", label: "ElevenLabs Scribe", adapter: "elevenlabs-transcription", model: "scribe_v2", baseUrl: "https://api.elevenlabs.io/v1", secretRef: "elevenlabs-stt" });
  createProviderProfile({ id: "tts", label: "TTS", adapter: "openai-compatible-speech", model: "speech", voice: "alloy", baseUrl: "https://provider.example/v1", secretRef: "tts" });
  createProviderProfile({ id: "elevenlabs", label: "ElevenLabs", adapter: "elevenlabs-tts", model: "eleven_multilingual_v2", voice: "voice", baseUrl: "https://api.elevenlabs.io/v1", secretRef: "elevenlabs" });
  createProviderProfile({ id: "minimax", label: "MiniMax", adapter: "minimax-tts", model: "speech-2.8-turbo", voice: "English_expressive_narrator", baseUrl: "https://provider.example/v1", secretRef: "minimax" });
  selectProviderProfile("text", "text");
  selectProviderProfile("stt", "stt");
  selectProviderProfile("tts", "tts");

  const service = new HostProviderService(secrets, {
    timeoutMs: 20,
    fetchImpl: async (input) => {
      const url = String(input);
      const errorBody = JSON.stringify({ detail: { status: "quota_exceeded", message: "Your account has no remaining billing quota." }, headers: { authorization: "test-key" } });
      if (url.includes("text-to-speech")) return new Response(errorBody, { status: 402 });
      if (url.includes("audio/speech")) return new Response(errorBody, { status: 500 });
      if (url.includes("audio/transcriptions")) return new Response(errorBody, { status: 500 });
      return new Response(errorBody, { status: 500 });
    },
  });

  const ttsSnapshot = await service.snapshot("tts");
  const sttSnapshot = await service.snapshot("stt");
  const textSnapshot = await service.snapshot("text");
  await assert.rejects(() => service.binary(ttsSnapshot, "/audio/speech", {}), /HTTP 500/);
  selectProviderProfile("tts", "elevenlabs");
  const elevenLabsSnapshot = await service.snapshot("tts");
  await assert.rejects(() => service.synthesize(elevenLabsSnapshot, "quota test", {}), (error: unknown) => {
    assert(error instanceof Error);
    assert.match(error.message, /HTTP 402.*quota_exceeded.*no remaining billing quota/);
    assert.doesNotMatch(error.message, /test-key|headers/i);
    return true;
  });
  const speechBodies: Array<Record<string, unknown>> = [];
  let completedSpeechRequestWasAborted = false;
  const voiceService = new HostProviderService(secrets, {
    fetchImpl: async (_input, init) => {
      init?.signal?.addEventListener("abort", () => { completedSpeechRequestWasAborted = true; }, { once: true });
      speechBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    },
  });
  await voiceService.synthesize(ttsSnapshot, "profile voice", {});
  await voiceService.synthesize(ttsSnapshot, "request voice", { voice: "request-voice" });
  assert.equal(speechBodies[0]?.voice, "alloy", "normal synthesis uses the persisted profile voice");
  assert.equal(speechBodies[1]?.voice, "request-voice", "request-scoped voice overrides the profile voice");
  assert.equal(completedSpeechRequestWasAborted, false, "completed provider requests must not be aborted during cleanup");
  const synthesisAbort = new AbortController();
  const pendingSynthesis = new HostProviderService(secrets, {
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("fetch aborted")), { once: true });
    }),
  });
  const synthesis = pendingSynthesis.synthesize(ttsSnapshot, "cancel me", {}, synthesisAbort.signal);
  synthesisAbort.abort();
  await assert.rejects(() => synthesis, /cancelled/);
  await assert.rejects(() => service.transcribe(sttSnapshot, new Uint8Array([1]), "audio/webm"), /HTTP 500/);

  selectProviderProfile("stt", "elevenlabs-stt");
  const elevenLabsSttSnapshot = await service.snapshot("stt");
  let elevenLabsSttUrl = "";
  let elevenLabsSttHeaders: Headers | undefined;
  let elevenLabsSttForm: FormData | undefined;
  const elevenLabsSttService = new HostProviderService(secrets, {
    fetchImpl: async (input, init) => {
      elevenLabsSttUrl = String(input);
      elevenLabsSttHeaders = new Headers(init?.headers);
      elevenLabsSttForm = init?.body instanceof FormData ? init.body : undefined;
      return new Response(JSON.stringify({ text: "native transcript" }), { status: 200 });
    },
  });
  assert.equal(await elevenLabsSttService.transcribe(elevenLabsSttSnapshot, new Uint8Array([1, 2]), "audio/webm"), "native transcript");
  assert.equal(elevenLabsSttUrl, "https://api.elevenlabs.io/v1/speech-to-text");
  assert.equal(elevenLabsSttHeaders?.get("xi-api-key"), "test-key");
  assert.equal(elevenLabsSttHeaders?.get("authorization"), null);
  assert.equal(elevenLabsSttForm?.get("model_id"), "scribe_v2");
  assert.equal(elevenLabsSttForm?.get("model"), null);
  assert.equal((elevenLabsSttForm?.get("file") as File | undefined)?.name, "speech.webm");
  await assert.rejects(() => service.stream(textSnapshot, "/chat/completions", {}, () => undefined), /HTTP 500/);

  let timeoutCancelled = false;
  const timeoutService = new HostProviderService(secrets, {
    timeoutMs: 10,
    fetchImpl: async () => new Response(new ReadableStream({ cancel() { timeoutCancelled = true; } }), { status: 200 }),
  });
  const timeoutSnapshot = await timeoutService.snapshot("text");
  await assert.rejects(() => timeoutService.json(timeoutSnapshot, "/chat/completions", {}), /timed out/);
  assert.equal(timeoutCancelled, true, "a timeout after headers must cancel the unread response body");

  let oversizedCancelled = false;
  const oversizedService = new HostProviderService(secrets, {
    fetchImpl: async () => new Response(responseStream([new Uint8Array(2 * 1024 * 1024 + 1)], () => { oversizedCancelled = true; }, false), { status: 200 }),
  });
  const oversizedSnapshot = await oversizedService.snapshot("text");
  await assert.rejects(() => oversizedService.json(oversizedSnapshot, "/chat/completions", {}), /too large/);
  assert.equal(oversizedCancelled, true, "chunked oversized responses must cancel their body");

  selectProviderProfile("tts", "minimax");
  const minimaxSnapshot = await service.snapshot("tts");
  const largeJson = JSON.stringify({ data: { audio: "494433", status: 2 }, padding: "x".repeat(2 * 1024 * 1024) });
  const minimaxService = new HostProviderService(secrets, { fetchImpl: async () => new Response(largeJson, { status: 200 }) });
  const audio = await minimaxService.synthesize(minimaxSnapshot, "hello", {});
  assert.deepEqual(Array.from(audio?.bytes ?? []), [0x49, 0x44, 0x33], "MiniMax JSON responses above the generic limit must remain readable");

  const invalidMinimaxService = new HostProviderService(secrets, { fetchImpl: async () => new Response(JSON.stringify({ data: { audio: "not-hex", status: 2 }, base_resp: { status_code: 0 } }), { status: 200 }) });
  await assert.rejects(() => invalidMinimaxService.synthesize(minimaxSnapshot, "hello", {}), /invalid speech audio/);

} finally {
  rmSync(dir, { recursive: true, force: true });
}
}

main().then(() => console.log("provider service lifecycle tests passed."), (error) => { console.error(error); process.exitCode = 1; });
