import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildProviderControlCenterSnapshot, createProviderProfile, deleteProviderProfile, getPluginPlatformSettings, initializePluginPlatformSettings, isProviderSecretRefReferenced, providerPresets, providerSecretReference, saveProviderConfiguration, selectProviderProfile, updateProviderProfile, validateProviderBaseUrl, validateProviderHeaders, validateProviderProfile, validateProviderProfilePatch } from "../src/plugin-platform-settings.js";

const dir = mkdtempSync(join(tmpdir(), "openpets-provider-profiles-"));
try {
  initializePluginPlatformSettings(dir);
  const presetModes = Object.fromEntries(providerPresets.map((preset) => [preset.id, preset.credentialMode]));
   assert.deepEqual(presetModes, { openrouter: "required", openai: "required", anthropic: "required", ollama: "none", "lm-studio": "none", vllm: "none", "minimax-chat": "required", whisper: "required", "elevenlabs-scribe": "required", elevenlabs: "required", "system-tts": "none" });
  createProviderProfile({ id: "text-local", label: "Local text", adapter: "openai-compatible-text", model: "llama", baseUrl: "http://127.0.0.1:11434/v1", headers: [{ name: "X-Client", value: "openpets" }] });
  createProviderProfile({ id: "stt-cloud", label: "Whisper", adapter: "openai-compatible-transcription", model: "whisper-1", baseUrl: "https://stt.example/v1", secretRef: "stt" });
  createProviderProfile({ id: "system-voice", label: "System", adapter: "system-tts", model: "", voice: "Samantha" });
  assert.equal(getPluginPlatformSettings().profiles["system-voice"]?.voice, "Samantha", "an installed system voice persists with its profile");
  selectProviderProfile("text", "text-local"); selectProviderProfile("stt", "stt-cloud"); selectProviderProfile("tts", "system-voice");
  assert.deepEqual(getPluginPlatformSettings().selections, { text: "text-local", stt: "stt-cloud", tts: "system-voice" });
  const persisted = JSON.parse(readFileSync(join(dir, "openpets-plugin-platform.json"), "utf8")) as Record<string, unknown>;
  assert.equal("ai" in persisted, false, "legacy single-provider settings must not be persisted or read");
  const snapshot = buildProviderControlCenterSnapshot(getPluginPlatformSettings(), () => false);
  assert.deepEqual(Object.keys(snapshot.selections), ["text", "stt", "tts"]);
  assert.deepEqual(Object.keys(snapshot.statuses), ["text", "stt", "tts", "realtime"]);
   assert.equal(JSON.stringify(snapshot).includes("header-value"), false);
  assert.deepEqual(snapshot.profiles.find((profile) => profile.id === "text-local")?.headerNames, ["X-Client"]);
  updateProviderProfile("text-local", { label: "Local text renamed", headers: undefined });
  assert.deepEqual(getPluginPlatformSettings().profiles["text-local"]?.headers, [{ name: "X-Client", value: "openpets" }]);
  updateProviderProfile("text-local", { headers: [] });
  assert.deepEqual(getPluginPlatformSettings().profiles["text-local"]?.headers, undefined);
   assert.equal(snapshot.statuses.stt.state, "missing-secret");

   const providerCredentials = new Map<string, string>();
   const credentialStore = {
     get: async (ref: string) => providerCredentials.get(ref),
     set: async (ref: string, value: string) => { providerCredentials.set(ref, value); },
     delete: async (ref: string) => { providerCredentials.delete(ref); },
   };
   createProviderProfile({ id: "required-no-key", label: "Required cloud", adapter: "anthropic-text", model: "claude", baseUrl: "https://anthropic.example" });
   selectProviderProfile("text", "required-no-key");
   assert.equal(buildProviderControlCenterSnapshot(getPluginPlatformSettings(), (profile) => Boolean(profile.secretRef && providerCredentials.has(profile.secretRef))).statuses.text.state, "missing-secret");
   await saveProviderConfiguration({
     isEditing: true,
     profileId: "required-no-key",
     payload: { id: "required-no-key", label: "Required cloud", model: "claude" },
     credentialValue: "anthropic-key",
     activatedRoles: [],
     deactivatedRoles: [],
   }, credentialStore);
   assert.equal(getPluginPlatformSettings().profiles["required-no-key"]?.secretRef, providerSecretReference("required-no-key"));
   assert.equal(providerCredentials.get(providerSecretReference("required-no-key")), "anthropic-key");
   assert.equal(buildProviderControlCenterSnapshot(getPluginPlatformSettings(), (profile) => Boolean(profile.secretRef && providerCredentials.has(profile.secretRef))).statuses.text.state, "ready");

   createProviderProfile({ id: "optional-no-key", label: "Optional cloud", adapter: "openai-compatible-text", model: "model", baseUrl: "https://optional.example/v1" });
   selectProviderProfile("text", "optional-no-key");
   const optionalWithoutKey = buildProviderControlCenterSnapshot(getPluginPlatformSettings(), (profile) => Boolean(profile.secretRef && providerCredentials.has(profile.secretRef)));
   assert.equal(optionalWithoutKey.statuses.text.state, "ready");
   assert.equal(getPluginPlatformSettings().profiles["optional-no-key"]?.secretRef, undefined);
   await saveProviderConfiguration({
     isEditing: true,
     profileId: "optional-no-key",
     payload: { id: "optional-no-key", label: "Optional cloud", model: "model" },
     credentialValue: "optional-key",
     activatedRoles: [],
     deactivatedRoles: [],
   }, credentialStore);
   assert.equal(getPluginPlatformSettings().profiles["optional-no-key"]?.secretRef, providerSecretReference("optional-no-key"));
   assert.equal(buildProviderControlCenterSnapshot(getPluginPlatformSettings(), (profile) => Boolean(profile.secretRef && providerCredentials.has(profile.secretRef))).statuses.text.state, "ready");

   await saveProviderConfiguration({
     isEditing: false,
     profileId: "cloud-inline",
     payload: { id: "cloud-inline", label: "Inline cloud", adapter: "anthropic-text", model: "claude", baseUrl: "https://inline.example" },
     credentialValue: "inline-key",
     activatedRoles: ["text"],
     deactivatedRoles: [],
   }, credentialStore);
   assert.equal(getPluginPlatformSettings().profiles["cloud-inline"]?.secretRef, providerSecretReference("cloud-inline"));
   assert.equal(getPluginPlatformSettings().selections.text, "cloud-inline");
  assert.throws(() => validateProviderBaseUrl("http://cloud.example/v1"), /HTTPS/);
  assert.throws(() => validateProviderBaseUrl("https://user:pass@example/v1"), /credentials/);
  assert.throws(() => validateProviderBaseUrl("https://example/v1?key=secret"), /query/);
  assert.throws(() => validateProviderHeaders([{ name: "X-Test", value: "1" }, { name: "x-test", value: "2" }]), /duplicate/);
  assert.throws(() => validateProviderHeaders([{ name: "Connection", value: "keep-alive" }]), /reserved/);
  assert.throws(() => validateProviderHeaders(Array.from({ length: 17 }, (_, index) => ({ name: `X-${index}`, value: "x" }))), /at most/);
  assert.deepEqual(validateProviderProfile({ id: "raw-auth", label: "Raw auth", adapter: "openai-compatible-text", model: "model", baseUrl: "https://provider.example/v1", secretRef: "raw", auth: { headerName: "X-API-Key", strategy: "raw" } }).auth, { headerName: "X-API-Key", strategy: "raw" });
  assert.throws(() => validateProviderProfile({ id: "conflicting-auth", label: "Conflict", adapter: "openai-compatible-text", model: "model", baseUrl: "https://provider.example/v1", secretRef: "raw", auth: { headerName: "X-API-Key", strategy: "raw" }, headers: [{ name: "X-API-Key", value: "wrong" }] }), /static header/);
  createProviderProfile({ id: "clearable-network", label: "Clearable", adapter: "openai-compatible-text", model: "model", baseUrl: "https://provider.example/v1", secretRef: "clearable", auth: { headerName: "X-API-Key", strategy: "raw" }, headers: [{ name: "X-Route", value: "gateway" }] });
  const beforeLabelPatch = getPluginPlatformSettings().profiles["clearable-network"];
  updateProviderProfile("clearable-network", { label: "Renamed only" });
  assert.deepEqual(getPluginPlatformSettings().profiles["clearable-network"], { ...beforeLabelPatch, label: "Renamed only" }, "label-only patches preserve endpoint, credential, auth, and headers");
  updateProviderProfile("clearable-network", { adapter: "system-tts", model: "", baseUrl: null, secretRef: null, auth: null, headers: [] });
  assert.deepEqual(getPluginPlatformSettings().profiles["clearable-network"], { id: "clearable-network", label: "Renamed only", adapter: "system-tts", model: "" }, "nullable clears permit deliberate conversion to system TTS");
  assert.throws(() => validateProviderProfilePatch({ baseUrl: "" }), /base URL/);
  assert.throws(() => validateProviderProfilePatch({ unsupported: true }), /not supported/);
  assert.throws(() => selectProviderProfile("stt", "text-local"), /does not support/);
  createProviderProfile({ id: "shared-secret-a", label: "Shared A", adapter: "openai-compatible-text", model: "a", baseUrl: "https://shared.example/v1", secretRef: "shared" });
  createProviderProfile({ id: "shared-secret-b", label: "Shared B", adapter: "openai-compatible-text", model: "b", baseUrl: "https://shared.example/v1", secretRef: "shared" });
  deleteProviderProfile("shared-secret-a");
  assert.equal(getPluginPlatformSettings().profiles["shared-secret-b"]?.secretRef, "shared", "deleting a sibling profile must not remove its shared credential reference");
  assert.equal(isProviderSecretRefReferenced(getPluginPlatformSettings(), "shared"), true);

  // Header edits operate on the host-owned values, while the renderer only sees names.
  createProviderProfile({ id: "redacted-headers", label: "Headers", adapter: "openai-compatible-text", model: "headers", baseUrl: "https://headers.example/v1", headers: [{ name: "X-A", value: "secret-a" }, { name: "X-B", value: "secret-b" }] });
  const redactedSnapshot = buildProviderControlCenterSnapshot(getPluginPlatformSettings(), () => false);
  const redactedProfile = redactedSnapshot.profiles.find((profile) => profile.id === "redacted-headers");
  assert.deepEqual(redactedProfile?.headerNames, ["X-A", "X-B"]);
  assert.equal(JSON.stringify(redactedProfile).includes("secret-"), false);
  updateProviderProfile("redacted-headers", { headerPatch: [{ op: "add", name: "X-C", value: "secret-c" }, { op: "delete", name: "X-B" }] });
  assert.deepEqual(getPluginPlatformSettings().profiles["redacted-headers"]?.headers, [{ name: "X-A", value: "secret-a" }, { name: "X-C", value: "secret-c" }]);

  // A credential failure after candidate profile/role preparation must leave both durable stores untouched.
  createProviderProfile({ id: "atomic-before", label: "Before", adapter: "openai-compatible-text", model: "before", baseUrl: "https://atomic.example/v1", secretRef: "atomic-old" });
  selectProviderProfile("text", "atomic-before");
  const beforeAtomic = getPluginPlatformSettings();
  const credentials = new Map<string, string>([["atomic-old", "old-secret"]]);
  const failingCredentials = {
    get: async (ref: string) => credentials.get(ref),
    set: async () => { throw new Error("credential write failed"); },
    delete: async (ref: string) => { credentials.delete(ref); },
  };
  await assert.rejects(() => saveProviderConfiguration({
    isEditing: true,
    profileId: "atomic-before",
    payload: { id: "atomic-before", label: "After", model: "after" },
    credentialValue: "new-secret",
    activatedRoles: [],
    deactivatedRoles: ["text"],
  }, failingCredentials), /credential write failed/);
  assert.deepEqual(getPluginPlatformSettings(), beforeAtomic);
  assert.equal(credentials.get("atomic-old"), "old-secret");
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "openpets-plugin-platform.json"), "utf8")), JSON.parse(JSON.stringify(beforeAtomic)));

  // Editing an active text profile to System Voice clears the incompatible role durably,
  // even when the renderer sends no role directives.
  createProviderProfile({ id: "role-switch", label: "Role switch", adapter: "openai-compatible-text", model: "model", baseUrl: "https://role-switch.example/v1" });
  selectProviderProfile("text", "role-switch");
  await saveProviderConfiguration({
    isEditing: true,
    profileId: "role-switch",
    payload: { id: "role-switch", adapter: "system-tts", model: "", baseUrl: null, secretRef: null, auth: null, headers: [] },
    activatedRoles: [],
    deactivatedRoles: [],
  }, {
    get: async () => undefined,
    set: async () => undefined,
    delete: async () => undefined,
  });
  assert.equal(getPluginPlatformSettings().selections.text, null);
  const reloaded = initializePluginPlatformSettings(dir);
  assert.equal(reloaded.selections.text, null, "incompatible role selections must not survive reload");
  assert.equal(reloaded.profiles["role-switch"]?.adapter, "system-tts");
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log("provider profile validation tests passed.");
