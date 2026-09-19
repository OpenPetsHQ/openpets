import type { ProviderProfile } from "./provider-contract.js";
import {
  createProviderOperationSnapshot,
  HostProviderService,
  type HostProviderOperations,
} from "./provider-service.js";
import { TextModelClient } from "./text-model-client.js";

const previewText = "This is an OpenPets provider configuration test.";

export type ProviderTestAudio = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
};

export type ProviderConfigurationTestResult =
  | { readonly kind: "text"; readonly detail: string }
  | { readonly kind: "stt"; readonly detail: string }
  | { readonly kind: "tts"; readonly bytes: Uint8Array; readonly mimeType: "audio/mpeg" }
  | { readonly kind: "realtime"; readonly detail: string }
  | { readonly kind: "system-tts" };

export async function testProviderConfiguration(
  profile: ProviderProfile,
  credential: string | undefined,
  audio?: ProviderTestAudio,
): Promise<ProviderConfigurationTestResult> {
  const service = new HostProviderService({ get: async () => undefined } as never, { timeoutMs: 20_000 });

  if (profile.adapter === "system-tts") {
    return { kind: "system-tts" };
  }

  if (profile.adapter === "openai-compatible-text" || profile.adapter === "anthropic-text") {
    const operation = createProviderOperationSnapshot(profile, "text", credential);
    const provider = operationFacade(service, operation);
    const response = await new TextModelClient(provider, { timeoutMs: 20_000 }).generate({
      messages: [{ role: "user", content: "Reply with the single word connected." }],
      tools: [],
    }, new AbortController().signal);
    const detail = response.type === "text" ? response.text : "Provider returned a tool request.";
    return { kind: "text", detail: detail.slice(0, 240) };
  }

  if (profile.adapter === "openai-realtime") {
    const operation = createProviderOperationSnapshot(profile, "realtime", credential);
    await service.json(operation, "/realtime/sessions", { model: operation.profile.model });
    return { kind: "realtime", detail: "Realtime session configuration accepted." };
  }

  if (profile.adapter === "openai-compatible-transcription" || profile.adapter === "elevenlabs-transcription") {
    if (!audio || audio.bytes.byteLength === 0) {
      throw new Error("Record a short sample before testing transcription.");
    }
    const operation = createProviderOperationSnapshot(profile, "stt", credential);
    const transcript = await service.transcribe(operation, audio.bytes, audio.mimeType);
    return { kind: "stt", detail: transcript || "Transcription completed (no speech detected)." };
  }

  const operation = createProviderOperationSnapshot(profile, "tts", credential);
  const speech = await service.synthesize(operation, previewText, {});
  if (!speech) {
    throw new Error("The selected provider did not return speech audio.");
  }
  return { kind: "tts", bytes: speech.bytes, mimeType: speech.mimeType };
}

function operationFacade(
  service: HostProviderService,
  operation: ReturnType<typeof createProviderOperationSnapshot>,
): HostProviderOperations {
  return {
    snapshot: async () => operation,
    json: service.json.bind(service),
    binary: service.binary.bind(service),
    stream: service.stream.bind(service),
    transcribe: service.transcribe.bind(service),
    synthesize: service.synthesize.bind(service),
    negotiateRealtime: service.negotiateRealtime.bind(service),
  };
}
