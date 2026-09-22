import type { PluginSecretsStore } from "./plugin-secrets.js";
import { defaultProviderAuth, getPluginPlatformSettings, profileSupportsRole, type ProviderProfile, type ProviderRole } from "./plugin-platform-settings.js";
import { providerDefinition } from "./provider-contract.js";
import { info, warn } from "./logger.js";
import { ProviderTransport, providerError } from "./provider-transport.js";
import type { ProviderTransportLease } from "./provider-transport.js";

export { providerError } from "./provider-transport.js";

export const hostSecretsOwner = "__openpets-host";
export const providerSecretKey = (ref: string): string => `provider:${ref}`;
export const MINIMAX_MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MINIMAX_MAX_RESPONSE_BYTES = MINIMAX_MAX_AUDIO_BYTES * 2 + 16 * 1024;

type ProviderTerminalFields = {
  readonly outcome?: "succeeded" | "failed" | "cancelled";
  readonly outputBytes?: number;
  readonly transcriptChars?: number;
  readonly replyChars?: number;
  readonly errorCode?: string;
};

export type ProviderOperationSnapshot = {
  readonly role: ProviderRole | "realtime";
  readonly profile: ProviderProfile;
  readonly secret?: string;
};
export type ProviderFetch = typeof fetch;
export type ProviderServiceOptions = { readonly fetchImpl?: ProviderFetch; readonly timeoutMs?: number };

/**
 * Builds a validated operation from an already-resolved profile. This lets the
 * Control Center test an unsaved draft without changing the active selections
 * or writing a credential to the secret store.
 */
export function createProviderOperationSnapshot(
  profile: ProviderProfile,
  role: ProviderRole | "realtime",
  secret?: string,
): ProviderOperationSnapshot {
  if (role !== "realtime" && !profileSupportsRole(profile, role)) {
    throw providerError(`Selected provider does not support ${role}.`, "provider.role.unsupported");
  }
  if (role === "realtime" && profile.adapter !== "openai-realtime") {
    throw providerError("Realtime requires an explicit native OpenAI realtime profile.", "provider.realtime.unsupported");
  }
  if (role === "text" && !profile.model) {
    throw providerError("Selected text provider has no normal text model.", "provider.profile.incomplete");
  }
  if (role === "realtime" && profile.adapter === "openai-realtime" && !profile.realtimeModel) {
    throw providerError("Selected realtime provider has no realtime model.", "provider.profile.incomplete");
  }

  const credentialPolicy = providerDefinition(profile.adapter).credentialPolicy;
  if (credentialPolicy === "required" && !secret) {
    throw providerError("Selected provider profile requires a credential.", "provider.credential.missing");
  }
  if (credentialPolicy === "optional" && profile.secretRef && !secret) {
    throw providerError("Selected provider profile has no credential.", "provider.credential.missing");
  }

  const operationProfile = role === "realtime" && profile.adapter === "openai-realtime"
    ? Object.freeze({ ...profile, model: profile.realtimeModel })
    : profile;
  return Object.freeze({ role, profile: operationProfile, ...(secret === undefined ? {} : { secret }) });
}

/** Narrow host-owned operation boundary. Callers never receive settings or secret-store internals. */
export interface HostProviderOperations {
  snapshot(role: ProviderRole | "realtime"): Promise<ProviderOperationSnapshot>;
  json(snapshot: ProviderOperationSnapshot, path: string, body: Record<string, unknown>, signal?: AbortSignal, maxBytes?: number): Promise<unknown>;
  binary(snapshot: ProviderOperationSnapshot, path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Uint8Array>;
  stream(snapshot: ProviderOperationSnapshot, path: string, body: Record<string, unknown>, onData: (data: string) => void, signal?: AbortSignal): Promise<void>;
  transcribe(snapshot: ProviderOperationSnapshot, audio: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<string>;
  synthesize(snapshot: ProviderOperationSnapshot, text: string, opts: { voice?: string; rate?: number }, signal?: AbortSignal): Promise<{ readonly bytes: Uint8Array; readonly mimeType: "audio/mpeg" } | null>;
  negotiateRealtime(snapshot: ProviderOperationSnapshot, sdp: string, session: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<string>;
}

export class HostProviderService implements HostProviderOperations {
  readonly #secrets: PluginSecretsStore;
  readonly #transport: ProviderTransport;

  constructor(secrets: PluginSecretsStore, options: ProviderServiceOptions = {}) {
    this.#secrets = secrets;
    const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.#transport = new ProviderTransport(fetchImpl, options.timeoutMs);
  }

  async snapshot(role: ProviderRole | "realtime"): Promise<ProviderOperationSnapshot> {
    const settings = getPluginPlatformSettings();
    const id = role === "realtime" ? settings.selections.text : settings.selections[role];
    if (!id) throw providerError(`${role === "realtime" ? "Realtime" : role} provider is disabled.`, "provider.disabled");
    const profile = settings.profiles[id];
    if (!profile) throw providerError("Selected provider profile is invalid.", "provider.profile.invalid");
    const secret = profile.secretRef ? await this.#secrets.get(hostSecretsOwner, providerSecretKey(profile.secretRef)) : undefined;
    return createProviderOperationSnapshot(profile, role, secret);
  }

  async json(snapshot: ProviderOperationSnapshot, path: string, body: Record<string, unknown>, signal?: AbortSignal, maxBytes = 2 * 1024 * 1024): Promise<unknown> {
    const request = await this.#request(snapshot, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, signal);
    try {
      if (!request.response.ok) throw await request.requestError("Provider request failed");
      const result = await request.readJson(maxBytes);
      request.finish({ outputBytes: result.bytes, replyChars: providerReplyCharacterCount(result.value) });
      return result.value;
    } catch (error) {
      request.finish({ outcome: providerOutcome(error), errorCode: providerErrorCode(error) });
      throw error;
    } finally { await request.release(); }
  }

  async binary(snapshot: ProviderOperationSnapshot, path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Uint8Array> {
    const request = await this.#request(snapshot, path, { method: "POST", headers: { "content-type": "application/json", accept: "audio/mpeg" }, body: JSON.stringify(body) }, signal);
    try {
      if (!request.response.ok) throw await request.requestError("Provider request failed");
      const bytes = await request.readBytes(64 * 1024 * 1024, "Provider audio response is too large.");
      request.finish({ outputBytes: bytes.byteLength });
      return bytes;
    } catch (error) {
      request.finish({ outcome: providerOutcome(error), errorCode: providerErrorCode(error) });
      throw error;
    } finally { await request.release(); }
  }

  async stream(snapshot: ProviderOperationSnapshot, path: string, body: Record<string, unknown>, onData: (data: string) => void, signal?: AbortSignal): Promise<void> {
    const request = await this.#request(snapshot, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, stream: true }) }, signal);
    try {
      if (!request.response.ok) throw await request.requestError("Provider request failed");
      if (!request.response.body) throw providerError(`Provider request failed with HTTP ${request.response.status}.`, "provider.request.failed");
      let replyChars = 0;
      const streamResult = await request.readSse((data) => {
        replyChars += providerStreamReplyCharacterCount(data);
        onData(data);
      });
      request.finish({ outputBytes: streamResult.bytes, replyChars });
    } catch (error) {
      request.finish({ outcome: providerOutcome(error), errorCode: providerErrorCode(error) });
      throw error;
    } finally { await request.release(); }
  }

  async transcribe(snapshot: ProviderOperationSnapshot, audio: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<string> {
    const isElevenLabs = snapshot.profile.adapter === "elevenlabs-transcription";
    if (snapshot.profile.adapter !== "openai-compatible-transcription" && !isElevenLabs) throw providerError("Selected provider is not a transcription profile.", "provider.role.unsupported");
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(audio)], { type: mimeType }), `speech.${extension(mimeType)}`);
    form.append(isElevenLabs ? "model_id" : "model", snapshot.profile.model);
    const request = await this.#request(snapshot, isElevenLabs ? "/speech-to-text" : "/audio/transcriptions", { method: "POST", body: form }, signal);
    try {
      if (!request.response.ok) throw await request.requestError("Transcription failed");
      const parsed = JSON.parse(await request.readText(2 * 1024 * 1024)) as { text?: unknown };
      const transcript = typeof parsed.text === "string" ? parsed.text : "";
      request.finish({ transcriptChars: transcript.length });
      return transcript;
    } catch (error) {
      request.finish({ outcome: providerOutcome(error), errorCode: providerErrorCode(error) });
      throw error;
    } finally { await request.release(); }
  }

  async synthesize(snapshot: ProviderOperationSnapshot, text: string, opts: { voice?: string; rate?: number }, signal?: AbortSignal): Promise<{ readonly bytes: Uint8Array; readonly mimeType: "audio/mpeg" } | null> {
    const profile = snapshot.profile;
    if (profile.adapter === "system-tts") return null;
    if (profile.adapter === "minimax-tts") {
      const parsed = await this.json(snapshot, "/t2a_v2", { model: profile.model, text, stream: false, output_format: "hex", audio_setting: { format: "mp3" }, voice_setting: { voice_id: opts.voice ?? profile.voice, ...(opts.rate === undefined ? {} : { speed: opts.rate }) } }, signal, MINIMAX_MAX_RESPONSE_BYTES) as { data?: { audio?: string; status?: number }; base_resp?: { status_code?: number; status_msg?: string } };
      if (parsed.base_resp?.status_code !== undefined && parsed.base_resp.status_code !== 0) throw providerError("MiniMax speech synthesis failed.", "provider.response.invalid");
      const hex = parsed.data?.audio;
      if (parsed.data?.status !== 2 || typeof hex !== "string" || hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) throw providerError("MiniMax returned invalid speech audio.", "provider.response.invalid");
      if (hex.length > MINIMAX_MAX_AUDIO_BYTES * 2) throw providerError("MiniMax speech audio is too large.", "provider.response.too_large");
      return { bytes: Buffer.from(hex, "hex"), mimeType: "audio/mpeg" };
    }
    if (profile.adapter === "elevenlabs-tts") {
      const voice = opts.voice ?? profile.voice;
      return { bytes: await this.binary(snapshot, `/text-to-speech/${encodeURIComponent(voice)}`, { text, model_id: profile.model, ...(opts.rate === undefined ? {} : { voice_settings: { speed: opts.rate } }) }, signal), mimeType: "audio/mpeg" };
    }
    if (profile.adapter === "openai-compatible-speech") {
      return { bytes: await this.binary(snapshot, "/audio/speech", { model: profile.model, input: text, voice: opts.voice ?? profile.voice, response_format: "mp3", ...(opts.rate === undefined ? {} : { speed: opts.rate }) }, signal), mimeType: "audio/mpeg" };
    }
    throw providerError("Selected provider is not a TTS profile.", "provider.role.unsupported");
  }

  async negotiateRealtime(snapshot: ProviderOperationSnapshot, sdp: string, session: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<string> {
    const body = new FormData();
    body.set("sdp", sdp);
    body.set("session", JSON.stringify(session));
    const request = await this.#request(snapshot, "/realtime/calls", { method: "POST", body }, signal);
    try {
      if (!request.response.ok) throw await request.requestError("Realtime negotiation failed");
      const answer = await request.readText(2 * 1024 * 1024);
      request.finish({ outputBytes: byteLength(answer) });
      return answer;
    } catch (error) {
      request.finish({ outcome: providerOutcome(error), errorCode: providerErrorCode(error) });
      throw error;
    } finally { await request.release(); }
  }

  async #request(snapshot: ProviderOperationSnapshot, path: string, init: RequestInit, signal?: AbortSignal): Promise<ProviderRequestLease> {
    let terminalLogged = false;
    const startedAt = Date.now();
    let responseStatus: number | undefined;
    const operation = providerOperation(snapshot);
    const safePath = safeProviderPath(path);
    info("provider", "provider operation requested", providerLogFields(snapshot, operation, safePath));
    const finish = (fields: ProviderTerminalFields = {}): void => {
      if (terminalLogged) return;
      terminalLogged = true;
      const terminalFields = { ...providerLogFields(snapshot, operation, safePath), status: responseStatus, elapsedMs: Date.now() - startedAt, outcome: fields.outcome ?? "succeeded", ...fields };
      (terminalFields.outcome === "succeeded" ? info : warn)("provider", "provider operation finished", terminalFields);
    };
    const headers = new Headers(snapshot.profile.headers?.map((header) => [header.name, header.value]));
    if (snapshot.secret) {
      const auth = snapshot.profile.auth ?? defaultProviderAuth(snapshot.profile.adapter);
      headers.set(auth.headerName, auth.strategy === "bearer" ? `Bearer ${snapshot.secret}` : snapshot.secret);
    }
    if (snapshot.profile.adapter === "anthropic-text") headers.set("anthropic-version", "2023-06-01");
    for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
    const url = endpoint(snapshot.profile, path);

    try {
      const transportLease = await this.#transport.request(url, { ...init, headers }, signal);
      responseStatus = transportLease.response.status;
      let released = false;
      return {
        ...transportLease,
        finish,
        release: async () => {
          if (released) return;
          released = true;
          finish({});
          await transportLease.release();
        },
      };
    } catch (error) {
      finish({ outcome: providerOutcome(error), errorCode: providerErrorCode(error) });
      throw error;
    }
  }
}

type ProviderRequestLease = ProviderTransportLease & {
  readonly finish: (fields?: ProviderTerminalFields) => void;
};

function endpoint(profile: ProviderProfile, path: string): string { const base = profile.baseUrl?.replace(/\/$/, "") ?? ""; return `${base}${path.startsWith("/") ? path : `/${path}`}`; }

function extension(mime: string): string {
  const base = mime.toLowerCase().split(";", 1)[0] ?? "";
  return base.includes("ogg") ? "ogg" : base.includes("wav") ? "wav" : base.includes("mp4") ? "mp4" : "webm";
}

function providerOperation(snapshot: ProviderOperationSnapshot): "text" | "stt" | "tts" | "realtime" {
  return snapshot.role === "realtime" ? "realtime" : snapshot.role;
}

function providerLogFields(snapshot: ProviderOperationSnapshot, operation: ReturnType<typeof providerOperation>, path: string): Record<string, unknown> {
  return { operation, role: snapshot.role, adapter: snapshot.profile.adapter, profileId: snapshot.profile.id, path };
}

function safeProviderPath(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? path;
  if (/^\/text-to-speech\/[^/]+$/.test(withoutQuery)) return "/text-to-speech/:voice";
  return /^\/[A-Za-z0-9._:/-]+$/.test(withoutQuery) ? withoutQuery : "/unknown";
}

function providerOutcome(error: unknown): "failed" | "cancelled" {
  return providerErrorCode(error) === "provider.cancelled" ? "cancelled" : "failed";
}

function providerErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function providerReplyCharacterCount(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.choices)) {
    let count = 0;
    let found = false;
    for (const choice of value.choices) {
      if (!isRecord(choice)) continue;
      const message = isRecord(choice.message) ? choice.message : isRecord(choice.delta) ? choice.delta : choice;
      for (const key of ["content", "text"]) {
        if (typeof message[key] === "string") { count += message[key].length; found = true; }
      }
    }
    return found ? count : undefined;
  }
  if (Array.isArray(value.content)) {
    const texts = value.content.filter(isRecord).map((item) => item.text).filter((text): text is string => typeof text === "string");
    return texts.length > 0 ? texts.reduce((total, text) => total + text.length, 0) : undefined;
  }
  return undefined;
}

function providerStreamReplyCharacterCount(data: string): number {
  if (data === "[DONE]") return 0;
  try { return providerReplyCharacterCount(JSON.parse(data) as unknown) ?? 0; } catch { return 0; }
}

function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export async function deleteProviderCredentialForProfile(
  secretsStore: { delete(owner: string, key: string): Promise<void> },
  profile: { readonly id?: string; readonly secretRef?: string },
  profiles: readonly { readonly id?: string; readonly secretRef?: string }[],
): Promise<void> {
  if (!profile.secretRef) return;
  const otherProfile = profiles.find((candidate) => candidate !== profile && candidate.secretRef === profile.secretRef);
  if (otherProfile) throw new Error(`Cannot remove this credential because profile "${otherProfile.id ?? "another profile"}" still references it. Replace or remove the other profile's secret reference first.`);
  await secretsStore.delete(hostSecretsOwner, providerSecretKey(profile.secretRef));
}
