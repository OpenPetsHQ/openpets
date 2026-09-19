import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  defaultProviderAuth,
  providerCatalog,
  providerDefinition,
  providerPresets,
  providerSupportsRole,
  type ProviderAdapter,
  type ProviderAuth,
  type ProviderCredentialPolicy,
  type ProviderHeader,
  type ProviderHeaderPatch,
  type ProviderPresetCredentialMode,
  type ProviderProfile,
  type ProviderRole,
} from "./provider-contract.js";

export {
  defaultProviderAuth,
  providerCatalog,
  providerPresets,
  type ProviderAdapter,
  type ProviderAuth,
  type ProviderCredentialPolicy,
  type ProviderHeader,
  type ProviderHeaderPatch,
  type ProviderPresetCredentialMode,
  type ProviderProfile,
  type ProviderRole,
} from "./provider-contract.js";

/** Host gates and provider-profile selections. Secret values never belong here. */

/** A host-applied edit against stored headers. Values from existing headers are never sent to the renderer. */
export type ProviderSelections = { readonly text: string | null; readonly stt: string | null; readonly tts: string | null };
export type ProviderQuarantine = { readonly reason: string; readonly value: unknown };
export type PluginPlatformSettings = {
  readonly version: typeof PROVIDER_SETTINGS_VERSION;
  readonly allowPluginAudio: boolean;
  readonly allowDynamicSpeech: boolean;
  readonly allowPluginVoice: boolean;
  readonly allowMicrophone: boolean;
  readonly quietHours: { readonly enabled: boolean; readonly start: string; readonly end: string };
  readonly profiles: Readonly<Record<string, ProviderProfile>>;
  readonly quarantinedProfiles: Readonly<Record<string, ProviderQuarantine>>;
  readonly selections: ProviderSelections;
};

export type ProviderProfileInput = ProviderProfile;
export type ProviderProfilePatch = {
  readonly id?: string;
  readonly label?: string;
  readonly adapter?: ProviderAdapter;
  readonly model?: string;
  readonly realtimeModel?: string | null;
  readonly voice?: string | null;
  readonly headers?: readonly ProviderHeader[];
  readonly baseUrl?: string | null;
  readonly secretRef?: string | null;
  readonly auth?: ProviderAuth | null;
  readonly headerPatch?: readonly ProviderHeaderPatch[];
};
export type ProviderConfigurationSaveInput = {
  readonly isEditing: boolean;
  readonly profileId: string;
  readonly payload: ProviderProfileInput | ProviderProfilePatch;
  readonly credentialValue?: string;
  readonly activatedRoles: readonly ProviderRole[];
  readonly deactivatedRoles: readonly ProviderRole[];
};
export interface ProviderCredentialStore {
  get(ref: string): Promise<string | undefined>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}
export type ProviderGatesPatch = Partial<Pick<PluginPlatformSettings, "allowPluginAudio" | "allowDynamicSpeech" | "allowPluginVoice" | "allowMicrophone">> & { readonly quietHours?: Partial<PluginPlatformSettings["quietHours"]> };
export type ProviderStatusState = "ready" | "disabled" | "invalid" | "missing-secret" | "unsupported";
export type ProviderStatus = {
  readonly role: ProviderRole | "realtime";
  readonly state: ProviderStatusState;
  readonly code: string;
  readonly message: string;
  readonly profileId?: string;
};
export type ProviderProfileSummary = Omit<ProviderProfile, "headers" | "secretRef"> & { readonly headerNames: readonly string[]; readonly hasCredential: boolean };
export type ProviderControlCenterSnapshot = {
  readonly gates: Pick<PluginPlatformSettings, "allowPluginAudio" | "allowDynamicSpeech" | "allowPluginVoice" | "allowMicrophone" | "quietHours">;
  readonly profiles: readonly ProviderProfileSummary[];
  readonly selections: ProviderSelections;
  readonly statuses: Readonly<Record<ProviderRole | "realtime", ProviderStatus>>;
  readonly presets: typeof providerPresets;
};

export const PROVIDER_PROFILE_ID = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;
export const PROVIDER_MAX_HEADERS = 16;
export const PROVIDER_MAX_HEADER_NAME_BYTES = 128;
export const PROVIDER_MAX_HEADER_VALUE_BYTES = 2048;
export const PROVIDER_MAX_HEADER_BYTES = 8192;
const MAX_LABEL_BYTES = 160;
const MAX_MODEL_BYTES = 256;
const MAX_BASE_URL_BYTES = 512;
const MAX_SECRET_REF_BYTES = 160;
export const PROVIDER_SETTINGS_VERSION = 1;
/** Stable host-owned reference for credentials first saved without a legacy reference. */
export function providerSecretReference(profileId: string): string {
  assertProfileId(profileId);
  return `profile:${profileId}`;
}
const reservedHeaders = new Set(["authorization", "proxy-authorization", "content-type", "content-length", "host", "connection", "keep-alive", "proxy-authenticate", "te", "trailer", "transfer-encoding", "upgrade", "cookie", "set-cookie", "user-agent"]);

export const defaultPluginPlatformSettings: PluginPlatformSettings = {
  version: PROVIDER_SETTINGS_VERSION,
  allowPluginAudio: true,
  allowDynamicSpeech: false,
  allowPluginVoice: true,
  allowMicrophone: false,
  quietHours: { enabled: false, start: "22:00", end: "08:00" },
  profiles: {},
  quarantinedProfiles: {},
  selections: { text: null, stt: null, tts: null },
};

const settingsFileName = "openpets-plugin-platform.json";
let settingsPath: string | null = null;
let cached: PluginPlatformSettings = defaultPluginPlatformSettings;

export function initializePluginPlatformSettings(userDataPath: string): PluginPlatformSettings {
  const path = join(userDataPath, settingsFileName);
  settingsPath = path;
  try {
    cached = readSettingsFile(path);
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (!isRecord(raw) || raw.version !== PROVIDER_SETTINGS_VERSION) writeSettingsFile(path, cached);
    }
  } catch (error) {
    // A damaged document is moved aside before future saves. The original is
    // therefore recoverable and can never be silently overwritten.
    if (existsSync(path)) renameSync(path, `${path}.corrupt`);
    cached = defaultPluginPlatformSettings;
  }
  return cached;
}

export function getPluginPlatformSettings(): PluginPlatformSettings { return cached; }

export function updatePluginPlatformSettings(patch: ProviderGatesPatch): PluginPlatformSettings {
  const value = normalizeSettings({ ...cached, ...patch, quietHours: { ...cached.quietHours, ...(patch.quietHours ?? {}) } });
  cached = value;
  if (settingsPath) writeSettingsFile(settingsPath, cached);
  return cached;
}

export function validateProviderGatesPatch(value: unknown): ProviderGatesPatch {
  if (!isRecord(value)) throw new Error("Provider gate update must be an object.");
  for (const key of ["allowPluginAudio", "allowDynamicSpeech", "allowPluginVoice", "allowMicrophone"] as const) if (value[key] !== undefined && typeof value[key] !== "boolean") throw new Error("Provider gate update contains an invalid flag.");
  if (value.quietHours !== undefined) {
    if (!isRecord(value.quietHours)) throw new Error("Provider quiet hours update is invalid.");
    if (value.quietHours.enabled !== undefined && typeof value.quietHours.enabled !== "boolean") throw new Error("Provider quiet hours enabled flag is invalid.");
    if (value.quietHours.start !== undefined && !validTime(value.quietHours.start)) throw new Error("Provider quiet hours start is invalid.");
    if (value.quietHours.end !== undefined && !validTime(value.quietHours.end)) throw new Error("Provider quiet hours end is invalid.");
  }
  return value as ProviderGatesPatch;
}

export function createProviderProfile(input: ProviderProfileInput): PluginPlatformSettings {
  const profile = validateProviderProfile(input);
  if (cached.profiles[profile.id]) throw new Error("Provider profile id is already in use.");
  if (cached.quarantinedProfiles[profile.id]) throw new Error("Provider profile id is quarantined and must be recovered explicitly.");
  cached = persist({ ...cached, profiles: { ...cached.profiles, [profile.id]: profile } });
  return cached;
}

export function updateProviderProfile(id: string, patch: ProviderProfilePatch): PluginPlatformSettings {
  assertProfileId(id);
  const existing = cached.profiles[id];
  if (!existing) throw new Error("Provider profile was not found.");
  const validatedPatch = validateProviderProfilePatch(patch);
  if (validatedPatch.id !== undefined && validatedPatch.id !== id) throw new Error("Provider profile id cannot be changed.");
  const merged: Record<string, unknown> = { ...existing, id };
  if (validatedPatch.headerPatch !== undefined) {
    merged.headers = applyProviderHeaderPatches(existing.headers ?? [], validatedPatch.headerPatch);
  }
  for (const [key, value] of Object.entries(validatedPatch)) {
    if (key === "headerPatch") continue;
    if (value === undefined) continue;
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  const profile = validateProviderProfile(merged);
  cached = persist({ ...cached, profiles: { ...cached.profiles, [id]: profile } });
  return cached;
}

export function deleteProviderProfile(id: string): PluginPlatformSettings {
  assertProfileId(id);
  if (!cached.profiles[id]) throw new Error("Provider profile was not found.");
  const profiles = { ...cached.profiles };
  delete profiles[id];
  const selections: ProviderSelections = { text: cached.selections.text === id ? null : cached.selections.text, stt: cached.selections.stt === id ? null : cached.selections.stt, tts: cached.selections.tts === id ? null : cached.selections.tts };
  cached = persist({ ...cached, profiles, selections });
  return cached;
}

export function selectProviderProfile(role: ProviderRole, profileId: string | null): PluginPlatformSettings {
  if (!isRole(role)) throw new Error("Invalid provider role.");
  if (profileId !== null) {
    assertProfileId(profileId);
    const profile = cached.profiles[profileId];
    if (!profile) throw new Error("Provider profile was not found.");
    if (!profileSupportsRole(profile, role)) throw new Error(`Provider profile does not support ${role}.`);
  }
  cached = persist({ ...cached, selections: { ...cached.selections, [role]: profileId } });
  return cached;
}

export function validateProviderProfile(input: unknown): ProviderProfile {
  if (!isRecord(input)) throw new Error("Provider profile must be an object.");
  const id = input.id;
  assertProfileId(id);
  const label = boundedString(input.label, "Provider profile label", MAX_LABEL_BYTES);
  const adapter = input.adapter;
  if (!isAdapter(adapter)) throw new Error("Provider profile adapter is invalid.");
  const allowedFields = new Set(["id", "label", "adapter", "model", "baseUrl", "secretRef", "auth", "headers"]);
  if (adapter === "openai-realtime") allowedFields.add("realtimeModel");
  if (adapter === "system-tts" || adapter === "minimax-tts" || adapter === "elevenlabs-tts" || adapter === "openai-compatible-speech") allowedFields.add("voice");
  for (const key of Object.keys(input)) if (!allowedFields.has(key)) throw new Error(`Provider profile field ${key} is not supported for ${adapter}.`);
  const model = boundedString(input.model, "Provider profile model", MAX_MODEL_BYTES, adapter === "system-tts" || adapter === "openai-realtime");
  if (adapter !== "system-tts" && adapter !== "openai-realtime" && model.length === 0) throw new Error("Provider profile model is required.");
  if (adapter === "system-tts" && model !== "") throw new Error("System TTS profiles must not define a model.");
  const baseUrl = input.baseUrl === undefined || input.baseUrl === "" ? undefined : validateProviderBaseUrl(input.baseUrl);
  const secretRef = input.secretRef === undefined || input.secretRef === "" ? undefined : boundedString(input.secretRef, "Provider secret reference", MAX_SECRET_REF_BYTES);
  const headers = validateProviderHeaders(input.headers);
  const auth = validateProviderAuth(input.auth, adapter, secretRef);
  if (auth && headers.some((header) => header.name.toLowerCase() === auth.headerName.toLowerCase())) throw new Error("Provider auth header must not also be declared as a static header.");
  const definition = providerDefinition(adapter);
  if (definition.requiresBaseUrl && !baseUrl) throw new Error("This provider profile requires a base URL.");
  if (!definition.requiresBaseUrl && (baseUrl || secretRef || auth || headers.length > 0)) throw new Error("System TTS profiles cannot define a network endpoint or credential.");
  if (adapter === "system-tts") {
    const voice = input.voice === undefined || input.voice === ""
      ? undefined
      : boundedString(input.voice, "System TTS voice", MAX_MODEL_BYTES);
    return Object.freeze({ id, label, adapter, model: "", ...(voice ? { voice } : {}) });
  }
  if (adapter === "openai-realtime") {
    const realtimeModel = boundedString(input.realtimeModel, "Provider realtime model", MAX_MODEL_BYTES);
    return Object.freeze({ id, label, adapter, model, realtimeModel, baseUrl: baseUrl!, ...(secretRef ? { secretRef } : {}), ...(auth ? { auth } : {}), ...(headers.length > 0 ? { headers: Object.freeze(headers) } : {}) });
  }
  if (adapter === "minimax-tts" || adapter === "elevenlabs-tts" || adapter === "openai-compatible-speech") {
    const voice = boundedString(input.voice, "Provider voice", MAX_MODEL_BYTES);
    return Object.freeze({ id, label, adapter, model, voice, baseUrl: baseUrl!, ...(secretRef ? { secretRef } : {}), ...(auth ? { auth } : {}), ...(headers.length > 0 ? { headers: Object.freeze(headers) } : {}) }) as ProviderProfile;
  }
  return Object.freeze({ id, label, adapter, model, baseUrl: baseUrl!, ...(secretRef ? { secretRef } : {}), ...(auth ? { auth } : {}), ...(headers.length > 0 ? { headers: Object.freeze(headers) } : {}) }) as ProviderProfile;
}

export function validateProviderProfilePatch(value: unknown): ProviderProfilePatch {
  if (!isRecord(value)) throw new Error("Provider profile patch must be an object.");
  const allowed = new Set(["id", "label", "adapter", "model", "realtimeModel", "voice", "baseUrl", "secretRef", "auth", "headers", "headerPatch"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Provider profile patch field ${key} is not supported.`);
  if (value.id !== undefined) assertProfileId(value.id);
  if (value.label !== undefined) boundedString(value.label, "Provider profile label", MAX_LABEL_BYTES);
  if (value.adapter !== undefined && !isAdapter(value.adapter)) throw new Error("Provider profile adapter is invalid.");
  if (value.model !== undefined) boundedString(value.model, "Provider profile model", MAX_MODEL_BYTES, true);
  if (value.realtimeModel !== undefined && value.realtimeModel !== null) boundedString(value.realtimeModel, "Provider realtime model", MAX_MODEL_BYTES);
  if (value.voice !== undefined && value.voice !== null) boundedString(value.voice, "Provider voice", MAX_MODEL_BYTES);
  if (value.baseUrl !== undefined && value.baseUrl !== null) validateProviderBaseUrl(value.baseUrl);
  if (value.secretRef !== undefined && value.secretRef !== null) boundedString(value.secretRef, "Provider secret reference", MAX_SECRET_REF_BYTES);
  if (value.auth !== undefined && value.auth !== null) validateProviderAuth(value.auth, "openai-compatible-text", "patch-secret");
  if (value.headers !== undefined) validateProviderHeaders(value.headers);
  if (value.headers !== undefined && value.headerPatch !== undefined) throw new Error("Provider profile patch cannot replace and patch headers together.");
  if (value.headerPatch !== undefined) validateProviderHeaderPatches(value.headerPatch);
  return value as ProviderProfilePatch;
}

export function validateProviderHeaderPatches(value: unknown): readonly ProviderHeaderPatch[] {
  if (!Array.isArray(value)) throw new Error("Provider header patch must be an array.");
  return value.map((patch) => {
    if (!isRecord(patch) || (patch.op !== "add" && patch.op !== "replace" && patch.op !== "delete")) {
      throw new Error("Provider header patch operation is invalid.");
    }
    if (patch.op === "delete") {
      boundedString(patch.name, "Provider header name", PROVIDER_MAX_HEADER_NAME_BYTES);
      return patch as ProviderHeaderPatch;
    }
    boundedString(patch.name, "Provider header name", PROVIDER_MAX_HEADER_NAME_BYTES);
    boundedString(patch.value, "Provider header value", PROVIDER_MAX_HEADER_VALUE_BYTES);
    if (patch.op === "replace") boundedString(patch.oldName, "Provider header name", PROVIDER_MAX_HEADER_NAME_BYTES);
    return patch as ProviderHeaderPatch;
  });
}

export function applyProviderHeaderPatches(existing: readonly ProviderHeader[], patches: readonly ProviderHeaderPatch[]): readonly ProviderHeader[] {
  const next = existing.map((header) => ({ ...header }));
  for (const patch of patches) {
    if (patch.op === "add") {
      next.push({ name: patch.name, value: patch.value });
      continue;
    }
    const targetName = patch.op === "replace" ? patch.oldName : patch.name;
    const index = next.findIndex((header) => header.name.toLowerCase() === targetName.toLowerCase());
    if (index < 0) throw new Error(`Provider header ${targetName} was not found.`);
    if (patch.op === "delete") next.splice(index, 1);
    else next[index] = { name: patch.name, value: patch.value };
  }
  return validateProviderHeaders(next);
}

/**
 * Persist a profile, credential and role changes as one host-owned operation.
 * Settings are not committed until credential writes succeed; every touched
 * secret and the settings file are restored if a later durable write fails.
 */
export async function saveProviderConfiguration(input: ProviderConfigurationSaveInput, secrets: ProviderCredentialStore): Promise<PluginPlatformSettings> {
  const before = cached;
  const preparedInput = prepareProviderConfigurationInput(before, input);
  const candidate = prepareProviderConfiguration(before, preparedInput);
  const previousProfile = before.profiles[input.profileId];
  const nextProfile = candidate.profiles[input.profileId];
  const refs = new Set<string>();
  if (previousProfile?.secretRef) refs.add(previousProfile.secretRef);
  if (nextProfile?.secretRef) refs.add(nextProfile.secretRef);
  const previousSecrets = new Map<string, string | undefined>();
  for (const ref of refs) previousSecrets.set(ref, await secrets.get(ref));

  let settingsCommitted = false;
  try {
    if (input.credentialValue !== undefined) {
      if (!nextProfile?.secretRef) throw new Error("Provider profile has no credential reference.");
      await secrets.set(nextProfile.secretRef, input.credentialValue);
    }
    persist(candidate);
    settingsCommitted = true;
    if (previousProfile?.secretRef && !isProviderSecretRefReferenced(candidate, previousProfile.secretRef)) {
      await secrets.delete(previousProfile.secretRef);
    }
    return candidate;
  } catch (error) {
    if (settingsCommitted) {
      try { persist(before); } catch { cached = before; }
    } else {
      cached = before;
    }
    for (const [ref, value] of previousSecrets) {
      try {
        if (value === undefined) await secrets.delete(ref);
        else await secrets.set(ref, value);
      } catch {
        // Preserve the original failure; the host will report the operation as failed.
      }
    }
    throw error;
  }
}

/** Validates an unsaved profile draft against the current stored profile without persisting it. */
export function previewProviderConfiguration(input: ProviderConfigurationSaveInput): ProviderProfile {
  const candidate = prepareProviderConfiguration(
    cached,
    prepareProviderConfigurationInput(cached, input),
  );
  const profile = candidate.profiles[input.profileId];
  if (!profile) throw new Error("Provider profile was not found.");
  return profile;
}

export function profileSupportsRole(profile: ProviderProfile, role: ProviderRole): boolean {
  return providerSupportsRole(profile.adapter, role);
}

export function validateProviderBaseUrl(value: unknown): string {
  const text = boundedString(value, "Provider base URL", MAX_BASE_URL_BYTES);
  let parsed: URL;
  try { parsed = new URL(text); } catch { throw new Error("Provider base URL must be a valid HTTP or HTTPS URL."); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalHost(parsed.hostname))) throw new Error("Provider base URL must use HTTPS; HTTP is allowed only for local endpoints and URLs cannot contain credentials, query, or fragment.");
  return text.replace(/\/$/, "");
}

export function validateProviderHeaders(value: unknown): readonly ProviderHeader[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > PROVIDER_MAX_HEADERS) throw new Error(`Provider headers must contain at most ${PROVIDER_MAX_HEADERS} entries.`);
  const seen = new Set<string>();
  let total = 0;
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error("Provider header must be an object.");
    const name = boundedString(entry.name, "Provider header name", PROVIDER_MAX_HEADER_NAME_BYTES);
    const normalized = name.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || reservedHeaders.has(normalized)) throw new Error(`Provider header ${name} is reserved or invalid.`);
    if (seen.has(normalized)) throw new Error("Provider headers must not contain duplicate names.");
    seen.add(normalized);
    const headerValue = boundedString(entry.value, "Provider header value", PROVIDER_MAX_HEADER_VALUE_BYTES);
    if (/[\r\n\0]/.test(headerValue)) throw new Error("Provider header value contains an invalid control character.");
    total += Buffer.byteLength(name) + Buffer.byteLength(headerValue);
    if (total > PROVIDER_MAX_HEADER_BYTES) throw new Error("Provider headers are too large.");
    return Object.freeze({ name, value: headerValue });
  });
}

export function validateProviderAuth(value: unknown, adapter: ProviderAdapter, secretRef?: string): ProviderAuth | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Provider auth configuration must be an object.");
  if (!secretRef) throw new Error("Provider auth configuration requires a secret reference.");
  const headerName = boundedString(value.headerName, "Provider auth header name", PROVIDER_MAX_HEADER_NAME_BYTES);
  const normalized = headerName.toLowerCase();
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName) || reservedHeaders.has(normalized) && normalized !== "authorization") throw new Error(`Provider auth header ${headerName} is invalid.`);
  const strategy = value.strategy;
  if (strategy !== "bearer" && strategy !== "raw") throw new Error("Provider auth strategy is invalid.");
  if (adapter === "system-tts") throw new Error("System TTS profiles cannot define auth.");
  return Object.freeze({ headerName, strategy });
}

export function profileStatus(settings: PluginPlatformSettings, role: ProviderRole, hasCredential: (profile: ProviderProfile) => boolean): ProviderStatus {
  const id = settings.selections[role];
  if (!id) return { role, state: "disabled", code: "provider.role.disabled", message: `No ${role} provider profile is selected.` };
  const profile = settings.profiles[id];
  if (!profile) return { role, state: "invalid", code: "provider.profile.missing", message: "The selected provider profile no longer exists.", profileId: id };
  if (!profileSupportsRole(profile, role)) return { role, state: "unsupported", code: "provider.role.unsupported", message: `The selected provider profile does not support ${role}.`, profileId: id };
  if (!profileIsReadyForRole(profile, role)) return { role, state: "invalid", code: "provider.profile.incomplete", message: "The selected provider profile needs a model configuration before it can be used.", profileId: id };
  const credentialPolicy = providerDefinition(profile.adapter).credentialPolicy;
  if (credentialPolicy === "required" && (!profile.secretRef || !hasCredential(profile))) return { role, state: "missing-secret", code: "provider.credential.missing", message: "The selected provider profile requires a credential.", profileId: id };
  if (credentialPolicy === "optional" && profile.secretRef && !hasCredential(profile)) return { role, state: "missing-secret", code: "provider.credential.missing", message: "The selected provider profile has no credential.", profileId: id };
  return { role, state: "ready", code: "provider.ready", message: "Provider profile is ready.", profileId: id };
}

function getNormalizedProfileSummaries(settings: PluginPlatformSettings, hasCredential: (profile: ProviderProfile) => boolean): readonly ProviderProfileSummary[] {
  return Object.values(settings.profiles).map((profile) => {
    const { headers: _headers, secretRef: _secretRef, ...safeProfile } = profile;
    return Object.freeze({ ...safeProfile, headerNames: Object.freeze((profile.headers ?? []).map((header) => header.name)), hasCredential: Boolean(profile.secretRef && hasCredential(profile)) });
  });
}

export function buildProviderControlCenterSnapshot(settings: PluginPlatformSettings, hasCredential: (profile: ProviderProfile) => boolean): ProviderControlCenterSnapshot {
  const statuses = Object.fromEntries(([
    ["text", profileStatus(settings, "text", hasCredential)],
    ["stt", profileStatus(settings, "stt", hasCredential)],
    ["tts", profileStatus(settings, "tts", hasCredential)],
    ["realtime", realtimeStatus(settings, hasCredential)],
  ] as const)) as ProviderControlCenterSnapshot["statuses"];
  return { gates: { allowPluginAudio: settings.allowPluginAudio, allowDynamicSpeech: settings.allowDynamicSpeech, allowPluginVoice: settings.allowPluginVoice, allowMicrophone: settings.allowMicrophone, quietHours: settings.quietHours }, profiles: getNormalizedProfileSummaries(settings, hasCredential), selections: settings.selections, statuses, presets: providerPresets };
}

export function realtimeStatus(settings: PluginPlatformSettings, hasCredential: (profile: ProviderProfile) => boolean): ProviderStatus {
  const id = settings.selections.text;
  if (!id) return { role: "realtime", state: "disabled", code: "provider.realtime.disabled", message: "Realtime is unavailable because no text profile is selected." };
  const profile = settings.profiles[id];
  if (!profile || profile.adapter !== "openai-realtime") return { role: "realtime", state: "unsupported", code: "provider.realtime.unsupported", message: "Realtime requires an explicit native OpenAI realtime profile.", profileId: id };
  if (!profile.model || !profile.realtimeModel) return { role: "realtime", state: "invalid", code: "provider.profile.incomplete", message: "The realtime profile needs both a text model and a realtime model.", profileId: id };
  if (providerDefinition(profile.adapter).credentialPolicy === "required" && (!profile.secretRef || !hasCredential(profile))) return { role: "realtime", state: "missing-secret", code: "provider.credential.missing", message: "The selected realtime profile requires a credential.", profileId: id };
  return { role: "realtime", state: "ready", code: "provider.ready", message: "Realtime profile is ready.", profileId: id };
}

export function isProviderRole(value: unknown): value is ProviderRole { return isRole(value); }

export function isProviderSecretRefReferenced(settings: PluginPlatformSettings, ref: string): boolean {
  return Object.values(settings.profiles).some((profile) => profile.secretRef === ref);
}

function prepareProviderConfiguration(settings: PluginPlatformSettings, input: ProviderConfigurationSaveInput): PluginPlatformSettings {
  if (typeof input.profileId !== "string" || !input.isEditing && input.profileId !== (input.payload as { id?: unknown }).id) {
    throw new Error("Provider configuration profile id is invalid.");
  }
  if (!Array.isArray(input.activatedRoles) || !Array.isArray(input.deactivatedRoles)) {
    throw new Error("Provider configuration role changes are invalid.");
  }
  const profiles = { ...settings.profiles };
  if (input.isEditing) {
    const existing = profiles[input.profileId];
    if (!existing) throw new Error("Provider profile was not found.");
    const patch = validateProviderProfilePatch(input.payload);
    if (patch.id !== undefined && patch.id !== input.profileId) throw new Error("Provider profile id cannot be changed.");
    const merged: Record<string, unknown> = { ...existing, id: input.profileId };
    if (patch.headerPatch !== undefined) merged.headers = applyProviderHeaderPatches(existing.headers ?? [], patch.headerPatch);
    for (const [key, value] of Object.entries(patch)) {
      if (key === "headerPatch") continue;
      if (value === undefined) continue;
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    profiles[input.profileId] = validateProviderProfile(merged);
  } else {
    const profile = validateProviderProfile(input.payload);
    if (profiles[profile.id]) throw new Error("Provider profile id is already in use.");
    if (settings.quarantinedProfiles[profile.id]) throw new Error("Provider profile id is quarantined and must be recovered explicitly.");
    profiles[profile.id] = profile;
  }

  const selections: Record<ProviderRole, string | null> = { ...settings.selections };
  for (const role of ["text", "stt", "tts"] as const) {
    const profileId = selections[role];
    const profile = profileId ? profiles[profileId] : undefined;
    if (profileId && (!profile || !profileSupportsRole(profile, role))) selections[role] = null;
  }
  const changedRoles = new Set<ProviderRole>();
  for (const role of input.deactivatedRoles) {
    if (!isRole(role) || changedRoles.has(role)) throw new Error("Provider configuration role changes are invalid.");
    changedRoles.add(role);
    selections[role] = null;
  }
  for (const role of input.activatedRoles) {
    if (!isRole(role) || changedRoles.has(role)) throw new Error("Provider configuration role changes are invalid.");
    changedRoles.add(role);
    const profile = profiles[input.profileId];
    if (!profile || !profileSupportsRole(profile, role)) throw new Error(`Provider profile does not support ${role}.`);
    selections[role] = input.profileId;
  }
  return { ...settings, profiles, selections };
}

function prepareProviderConfigurationInput(
  settings: PluginPlatformSettings,
  input: ProviderConfigurationSaveInput,
): ProviderConfigurationSaveInput {
  const existingProfile = settings.profiles[input.profileId];
  const payload = isRecord(input.payload) ? input.payload : {};
  const requestedSecretRef = "secretRef" in payload ? payload.secretRef : existingProfile?.secretRef;
  if (input.credentialValue === undefined || requestedSecretRef) return input;
  return {
    ...input,
    payload: { ...input.payload, secretRef: providerSecretReference(input.profileId) },
  };
}

function normalizeSettings(value: unknown): PluginPlatformSettings {
  const raw = isRecord(value) ? value : {};
  const isLegacyDocument = raw.version === undefined;
  const quiet = isRecord(raw.quietHours) ? raw.quietHours : {};
  const profiles: Record<string, ProviderProfile> = {};
  const quarantinedProfiles: Record<string, ProviderQuarantine> = isRecord(raw.quarantinedProfiles) ? { ...raw.quarantinedProfiles } as Record<string, ProviderQuarantine> : {};
  if (isRecord(raw.profiles)) for (const [id, profile] of Object.entries(raw.profiles)) {
    try {
      const migrated = isLegacyDocument ? migrateProfile(profile) : profile;
      profiles[id] = validateProviderProfile({ ...(isRecord(migrated) ? migrated : {}), id });
    } catch (error) {
      quarantinedProfiles[id] = { reason: error instanceof Error ? error.message : "Provider profile is invalid.", value: profile };
    }
  }
  const selections = isRecord(raw.selections) ? { text: selection(raw.selections.text), stt: selection(raw.selections.stt), tts: selection(raw.selections.tts) } : defaultPluginPlatformSettings.selections;
  return { version: PROVIDER_SETTINGS_VERSION, allowPluginAudio: raw.allowPluginAudio !== false, allowDynamicSpeech: raw.allowDynamicSpeech === true, allowPluginVoice: raw.allowPluginVoice !== false, allowMicrophone: raw.allowMicrophone === true, quietHours: { enabled: quiet.enabled === true, start: validTime(quiet.start) ? quiet.start as string : "22:00", end: validTime(quiet.end) ? quiet.end as string : "08:00" }, profiles, quarantinedProfiles, selections };
}

function migrateProfile(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const migrated = { ...value };
  const adapter = migrated.adapter;
  if (adapter === "openai-realtime" && typeof migrated.model === "string" && typeof migrated.realtimeModel !== "string") {
    // The old document had only one model field and it was the realtime
    // model. Never pretend it was a normal text model.
    migrated.realtimeModel = migrated.model;
    migrated.model = "";
  }
  if ((adapter === "elevenlabs-tts" || adapter === "minimax-tts" || adapter === "openai-compatible-speech") && typeof migrated.voice !== "string") {
    migrated.voice = providerDefinition(adapter).defaultVoice;
  }
  return migrated;
}

function profileIsReadyForRole(profile: ProviderProfile, role: ProviderRole): boolean {
  if (role === "text") return profile.model.length > 0;
  if (role === "stt") return profile.model.length > 0;
  return profile.adapter === "system-tts" || (profile.adapter === "minimax-tts" || profile.adapter === "elevenlabs-tts" || profile.adapter === "openai-compatible-speech") && profile.voice.length > 0;
}

function persist(settings: PluginPlatformSettings): PluginPlatformSettings { if (settingsPath) writeSettingsFile(settingsPath, settings); cached = settings; return settings; }
function readSettingsFile(path: string): PluginPlatformSettings {
  if (!existsSync(path)) return defaultPluginPlatformSettings;
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return normalizeSettings(raw);
}
function writeSettingsFile(path: string, settings: PluginPlatformSettings): void { mkdirSync(dirname(path), { recursive: true }); const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8"); renameSync(tmp, path); }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function boundedString(value: unknown, label: string, maxBytes: number, allowEmpty = false): string { if (typeof value !== "string" || (!allowEmpty && value.trim() === "") || Buffer.byteLength(value, "utf8") > maxBytes || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`${label} is invalid.`); return value.trim(); }
function assertProfileId(value: unknown): asserts value is string { if (typeof value !== "string" || !PROVIDER_PROFILE_ID.test(value)) throw new Error("Provider profile id is invalid."); }
function isAdapter(value: unknown): value is ProviderAdapter { return ["openai-compatible-text", "openai-realtime", "anthropic-text", "openai-compatible-transcription", "elevenlabs-transcription", "system-tts", "minimax-tts", "elevenlabs-tts", "openai-compatible-speech"].includes(String(value)); }
function isRole(value: unknown): value is ProviderRole { return ["text", "stt", "tts"].includes(String(value)); }
function validTime(value: unknown): value is string { return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function selection(value: unknown): string | null { return typeof value === "string" && PROVIDER_PROFILE_ID.test(value) ? value : null; }
function isLocalHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1" || host.endsWith(".local")) return true;
  const octets = host.split(".").map(Number);
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) && (octets[0] === 10 || octets[0] === 192 && octets[1] === 168 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
}

export function isInQuietHours(now = new Date()): boolean { const { enabled, start, end } = cached.quietHours; if (!enabled) return false; const current = now.getHours() * 60 + now.getMinutes(); const from = timeMinutes(start); const to = timeMinutes(end); if (from === to) return false; return from < to ? current >= from && current < to : current >= from || current < to; }
function timeMinutes(value: string): number { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; }
