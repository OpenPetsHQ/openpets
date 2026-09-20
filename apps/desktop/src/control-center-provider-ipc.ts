import type { ElectronPluginHostCapabilities } from "./plugin-host-capabilities.js";
import { getPluginHostCapabilitiesForUi } from "./plugin-host-capabilities.js";
import {
  deleteProviderCredentialForProfile,
  hostSecretsOwner,
  providerSecretKey,
} from "./provider-service.js";
import { beginProviderTranscriptionTest, testProviderConfiguration } from "./provider-configuration-test.js";
import type { ProviderTranscriptionTestSession } from "./provider-configuration-test-session.js";
import {
  buildProviderControlCenterSnapshot,
  createProviderProfile,
  deleteProviderProfile,
  getPluginPlatformSettings,
  isProviderSecretRefReferenced,
  isProviderRole,
  previewProviderConfiguration,
  selectProviderProfile,
  saveProviderConfiguration,
  updateProviderProfile,
  updatePluginPlatformSettings,
  validateProviderGatesPatch,
  validateProviderProfilePatch,
  validateProviderProfile,
  type ProviderProfileInput,
  type ProviderConfigurationSaveInput,
} from "./plugin-platform-settings.js";
import { getSharedVoiceMediaPlayer, type VoiceMediaPlayer } from "./voice-media-player.js";
import { cancelProviderTestsForSender, ProviderTestReplacementLanes, registerProviderTestRequest } from "./provider-test-lifecycle.js";

export type ControlCenterProviderIpcChannel =
  | "openpets:provider-profiles-get"
  | "openpets:provider-profile-create"
  | "openpets:provider-profile-update"
  | "openpets:provider-profile-save"
  | "openpets:provider-profile-test"
  | "openpets:provider-profile-test-begin"
  | "openpets:provider-profile-test-finish"
  | "openpets:provider-profile-test-cancel"
  | "openpets:provider-preview-play"
  | "openpets:provider-preview-stop"
  | "openpets:provider-profile-delete"
  | "openpets:provider-gates-update"
  | "openpets:provider-profile-select"
  | "openpets:provider-profile-credential-set"
  | "openpets:provider-profile-credential-status"
  | "openpets:provider-profile-credential-delete";

export type ControlCenterProviderIpcEvent = {
  readonly sender: { readonly id: number };
};

export type ControlCenterProviderIpcHandler = (event: ControlCenterProviderIpcEvent, ...args: unknown[]) => unknown | Promise<unknown>;
export type ControlCenterProviderIpcHandleRegistrar = (channel: ControlCenterProviderIpcChannel, handler: ControlCenterProviderIpcHandler) => void;

export type ControlCenterProviderIpcLogger = {
  readonly debug: (message: string, fields?: Record<string, unknown>) => void;
};

export type ControlCenterProviderIpcDependencies = {
  readonly registerHandle: ControlCenterProviderIpcHandleRegistrar;
  readonly authorizeSender: (event: ControlCenterProviderIpcEvent) => void;
  readonly registerBeforeQuit: (listener: () => void) => void;
  readonly logger: ControlCenterProviderIpcLogger;
  readonly getProviderCapabilities?: () => ElectronPluginHostCapabilities;
  readonly getMediaPlayer?: () => VoiceMediaPlayer;
};

export type ControlCenterProviderIpcLifecycle = {
  readonly cancelForSender: (senderId: number, reason: string) => Promise<void>;
};

export function installControlCenterProviderIpcHandlers({
  registerHandle,
  authorizeSender,
  registerBeforeQuit,
  logger,
  getProviderCapabilities: getProviderCapabilitiesDependency,
  getMediaPlayer: getMediaPlayerDependency,
}: ControlCenterProviderIpcDependencies): ControlCenterProviderIpcLifecycle {
  let nextProviderTestSessionId = 0;
  const providerTestSessions = new Map<string, { readonly senderId: number; readonly session: ProviderTranscriptionTestSession }>();
  const providerTestRequests = new Map<number, Set<AbortController>>();
  const providerTestReplacementLanes = new ProviderTestReplacementLanes();
  let providerPreviewRequestId: string | null = null;
  let nextProviderPreviewId = 0;

  const getProviderCapabilities = getProviderCapabilitiesDependency ?? defaultGetProviderCapabilities;
  const getMediaPlayer = getMediaPlayerDependency ?? getSharedVoiceMediaPlayer;

  registerBeforeQuit(() => { void cancelAllProviderTests("OpenPets is shutting down."); });

  registerHandle("openpets:provider-profiles-get", async (event) => {
    authorizeSender(event);
    return getProviderControlCenterSnapshot();
  });
  registerHandle("openpets:provider-profile-create", async (event, input: unknown) => {
    authorizeSender(event);
    const profile = validateProviderProfile(input) as ProviderProfileInput;
    createProviderProfile(profile);
    return getProviderControlCenterSnapshot();
  });
  registerHandle("openpets:provider-profile-update", async (event, id: unknown, patch: unknown) => {
    authorizeSender(event);
    if (typeof id !== "string" || !isPlainObject(patch)) throw new Error("Invalid provider profile update.");
    const previous = getPluginPlatformSettings().profiles[id];
    updateProviderProfile(id, validateProviderProfilePatch(patch));
    const next = getPluginPlatformSettings().profiles[id];
    if (previous?.secretRef && previous.secretRef !== next?.secretRef && !isProviderSecretRefReferenced(getPluginPlatformSettings(), previous.secretRef)) await getProviderCapabilities().secretsStore.delete(hostSecretsOwner, providerSecretKey(previous.secretRef));
    return getProviderControlCenterSnapshot();
  });
  registerHandle("openpets:provider-profile-save", async (event, input: unknown) => {
    authorizeSender(event);
    const save = validateProviderConfigurationSaveInput(input);
    await saveProviderConfiguration(save, createCredentialStore());
    return getProviderControlCenterSnapshot();
  });
  registerHandle("openpets:provider-profile-test", async (event, input: unknown) => {
    authorizeSender(event);
    const controller = new AbortController();
    const unregister = registerProviderTestRequest(providerTestRequests, event.sender.id, controller);
    const preemption = cancelProviderTestsForSender(event.sender.id, "Provider configuration test was preempted.", providerTestRequests, providerTestSessions, controller);
    try {
      return await providerTestReplacementLanes.enqueue(event.sender.id, async () => {
        await preemption;
        if (controller.signal.aborted) throw new Error("Provider configuration test was cancelled.");
        const save = validateProviderConfigurationSaveInput(input);
        const profile = previewProviderConfiguration(save);
        logger.debug("Testing unsaved provider configuration", {
          profileId: profile.id,
          adapter: profile.adapter,
        });
        const capabilities = getProviderCapabilities();
        const credential = save.credentialValue
          ?? (profile.secretRef
            ? await capabilities.secretsStore.get(hostSecretsOwner, providerSecretKey(profile.secretRef))
            : undefined);
        if (controller.signal.aborted) throw new Error("Provider configuration test was cancelled.");
        return testProviderConfiguration(profile, credential, controller.signal);
      });
    } finally {
      unregister();
    }
  });
  registerHandle("openpets:provider-profile-test-begin", async (event, input: unknown) => {
    authorizeSender(event);
    const initializationController = new AbortController();
    const unregisterInitialization = registerProviderTestRequest(providerTestRequests, event.sender.id, initializationController);
    const preemption = cancelProviderTestsForSender(event.sender.id, "Provider transcription test was preempted.", providerTestRequests, providerTestSessions, initializationController);
    try {
      return await providerTestReplacementLanes.enqueue(event.sender.id, async () => {
        await preemption;
        if (initializationController.signal.aborted) throw new Error("Provider transcription test was cancelled.");
        const save = validateProviderConfigurationSaveInput(input);
        const profile = previewProviderConfiguration(save);
        if (profile.adapter !== "openai-compatible-transcription" && profile.adapter !== "elevenlabs-transcription") {
          throw new Error("The selected provider does not support transcription tests.");
        }
        const capabilities = getProviderCapabilities();
        const credential = save.credentialValue
          ?? (profile.secretRef
            ? await capabilities.secretsStore.get(hostSecretsOwner, providerSecretKey(profile.secretRef))
            : undefined);
        if (initializationController.signal.aborted) throw new Error("Provider transcription test was cancelled.");
        const { session } = await beginProviderTranscriptionTest(profile, credential);
        if (initializationController.signal.aborted) {
          await session.cancel("Provider transcription test was cancelled.");
          throw new Error("Provider transcription test was cancelled.");
        }
        const id = `provider-test-${++nextProviderTestSessionId}`;
        const entry = { senderId: event.sender.id, session };
        providerTestSessions.set(id, entry);
        void session.result.finally(() => {
          if (providerTestSessions.get(id) === entry) providerTestSessions.delete(id);
        }).catch(() => undefined);
        return { sessionId: id };
      });
    } finally {
      unregisterInitialization();
    }
  });
  registerHandle("openpets:provider-profile-test-finish", async (event, sessionId: unknown) => {
    authorizeSender(event);
    const entry = getProviderTestSession(event.sender.id, sessionId);
    const result = await entry.session.finish();
    providerTestSessions.delete(sessionId as string);
    return { kind: "stt", detail: result.text || "Transcription completed (no speech detected)." } as const;
  });
  registerHandle("openpets:provider-profile-test-cancel", async (event, sessionId: unknown) => {
    authorizeSender(event);
    if (sessionId === undefined || sessionId === null) {
      await cancelProviderTestsForSender(event.sender.id, "Provider transcription test was cancelled.", providerTestRequests, providerTestSessions);
      return { cancelled: true } as const;
    }
    if (typeof sessionId !== "string") return { cancelled: false } as const;
    const entry = providerTestSessions.get(sessionId);
    if (!entry || entry.senderId !== event.sender.id) return { cancelled: false } as const;
    providerTestSessions.delete(sessionId);
    await entry.session.cancel("Provider transcription test was cancelled.");
    return { cancelled: true } as const;
  });
  registerHandle("openpets:provider-preview-play", async (event, bytes: unknown, mimeType: unknown) => {
    authorizeSender(event);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024 || typeof mimeType !== "string" || mimeType.length === 0) {
      throw new Error("Invalid provider preview audio.");
    }
    const requestId = `provider-preview-${++nextProviderPreviewId}`;
    providerPreviewRequestId = requestId;
    try {
      return await getMediaPlayer().play(requestId, bytes, mimeType);
    } finally {
      if (providerPreviewRequestId === requestId) providerPreviewRequestId = null;
    }
  });
  registerHandle("openpets:provider-preview-stop", (event) => {
    authorizeSender(event);
    const requestId = providerPreviewRequestId;
    providerPreviewRequestId = null;
    return requestId ? getMediaPlayer().stop(requestId) : undefined;
  });
  registerHandle("openpets:provider-profile-delete", async (event, id: unknown) => {
    authorizeSender(event);
    if (typeof id !== "string") throw new Error("Invalid provider profile id.");
    const existing = getPluginPlatformSettings().profiles[id];
    const settings = deleteProviderProfile(id);
    const capabilities = getProviderCapabilities();
    const ref = existing?.secretRef;
    if (ref && !isProviderSecretRefReferenced(settings, ref)) await capabilities.secretsStore.delete(hostSecretsOwner, providerSecretKey(ref));
    return getProviderControlCenterSnapshot();
  });
  registerHandle("openpets:provider-gates-update", async (event, patch: unknown) => {
    authorizeSender(event);
    updatePluginPlatformSettings(validateProviderGatesPatch(patch));
    return getProviderControlCenterSnapshot();
  });
  registerHandle("openpets:provider-profile-select", async (event, role: unknown, id: unknown) => {
    authorizeSender(event);
    if (!isProviderRole(role) || (id !== null && typeof id !== "string")) throw new Error("Invalid provider profile selection.");
    selectProviderProfile(role, id as string | null);
    return getProviderControlCenterSnapshot();
  });
  registerHandle("openpets:provider-profile-credential-set", async (event, id: unknown, value: unknown) => {
    authorizeSender(event);
    if (typeof id !== "string" || typeof value !== "string" || Buffer.byteLength(value, "utf8") > 16 * 1024 || value.length === 0) throw new Error("Invalid provider credential.");
    await saveProviderConfiguration({
      isEditing: true,
      profileId: id,
      payload: { id },
      credentialValue: value,
      activatedRoles: [],
      deactivatedRoles: [],
    }, createCredentialStore());
    return getProviderControlCenterSnapshot();
  });
  registerHandle("openpets:provider-profile-credential-status", async (event, id: unknown) => {
    authorizeSender(event);
    if (typeof id !== "string") throw new Error("Invalid provider profile id.");
    const profile = getPluginPlatformSettings().profiles[id];
    return { hasCredential: Boolean(profile?.secretRef && await getProviderCapabilities().secretsStore.has(hostSecretsOwner, providerSecretKey(profile.secretRef))) };
  });
  registerHandle("openpets:provider-profile-credential-delete", async (event, id: unknown) => {
    authorizeSender(event);
    if (typeof id !== "string") throw new Error("Invalid provider profile id.");
    const profile = getPluginPlatformSettings().profiles[id];
    if (profile) await deleteProviderCredentialForProfile(getProviderCapabilities().secretsStore, profile, Object.values(getPluginPlatformSettings().profiles));
    return getProviderControlCenterSnapshot();
  });

  return {
    cancelForSender: (senderId, reason) => cancelProviderTestsForSender(senderId, reason, providerTestRequests, providerTestSessions),
  };

  function createCredentialStore() {
    const capabilities = getProviderCapabilities();
    return {
      get: (ref: string) => capabilities.secretsStore.get(hostSecretsOwner, providerSecretKey(ref)),
      set: (ref: string, value: string) => capabilities.secretsStore.set(hostSecretsOwner, providerSecretKey(ref), value),
      delete: (ref: string) => capabilities.secretsStore.delete(hostSecretsOwner, providerSecretKey(ref)),
    };
  }

  async function getProviderControlCenterSnapshot(): Promise<import("./plugin-platform-settings.js").ProviderControlCenterSnapshot> {
    const capabilities = getProviderCapabilities();
    const settings = getPluginPlatformSettings();
    const credentialRefs = new Set<string>();
    for (const profile of Object.values(settings.profiles)) if (profile.secretRef && await capabilities.secretsStore.has(hostSecretsOwner, providerSecretKey(profile.secretRef))) credentialRefs.add(profile.secretRef);
    return buildProviderControlCenterSnapshot(settings, (profile) => Boolean(profile.secretRef && credentialRefs.has(profile.secretRef)));
  }

  function getProviderTestSession(senderId: number, value: unknown): { readonly senderId: number; readonly session: ProviderTranscriptionTestSession } {
    if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new Error("Invalid provider test session.");
    const entry = providerTestSessions.get(value);
    if (!entry || entry.senderId !== senderId) throw new Error("Provider test session is no longer active.");
    return entry;
  }

  async function cancelAllProviderTests(reason: string): Promise<void> {
    for (const controllers of providerTestRequests.values()) {
      for (const controller of controllers) controller.abort(reason);
    }
    const entries = [...providerTestSessions.entries()];
    providerTestSessions.clear();
    for (const [, entry] of entries) await entry.session.cancel(reason).catch(() => undefined);
    await providerTestReplacementLanes.waitForAll();
  }
}

function defaultGetProviderCapabilities(): ElectronPluginHostCapabilities {
  const capabilities = getPluginHostCapabilitiesForUi();
  if (capabilities) return capabilities;
  throw new Error("Plugin host capabilities are unavailable.");
}

function validateProviderConfigurationSaveInput(value: unknown): ProviderConfigurationSaveInput {
  if (!isPlainObject(value)
    || typeof value.isEditing !== "boolean"
    || typeof value.profileId !== "string"
    || !isPlainObject(value.payload)
    || !Array.isArray(value.activatedRoles)
    || !Array.isArray(value.deactivatedRoles)) {
    throw new Error("Invalid provider configuration save.");
  }
  if (value.credentialValue !== undefined
    && (typeof value.credentialValue !== "string"
      || value.credentialValue.length === 0
      || Buffer.byteLength(value.credentialValue, "utf8") > 16 * 1024)) {
    throw new Error("Invalid provider credential.");
  }
  return {
    isEditing: value.isEditing,
    profileId: value.profileId,
    payload: value.payload as ProviderConfigurationSaveInput["payload"],
    ...(value.credentialValue === undefined ? {} : { credentialValue: value.credentialValue }),
    activatedRoles: value.activatedRoles as ProviderConfigurationSaveInput["activatedRoles"],
    deactivatedRoles: value.deactivatedRoles as ProviderConfigurationSaveInput["deactivatedRoles"],
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
