import { readFile, realpath, stat } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import sharp from "sharp";

import { app, BrowserWindow, dialog, ipcMain, protocol, screen, shell, type OpenDialogOptions } from "electron";

import { getAgentSetupSnapshot, runAgentSetupAction, updateAgentSetupCommandPaths } from "./agent-setup.js";
import { refreshAgentPetContent } from "./agent-pet-controller.js";
import { getAppStateSnapshot, hudScaleOptions, normalizePetPoolOrder, petScaleOptions, setPetPoolOrder, updatePreferences } from "./app-state.js";
import { applyRoamingToAllPets } from "./pet-roaming-controller.js";
import { createAppIcon } from "./assets.js";
import { getCatalogPageUiState, getCatalogSearchUiState, getCatalogUiState } from "./catalog.js";
import { getCodexPetsUiState, importCodexPet, readCodexPetSpritesheet } from "./codex-pets.js";
import { codexV2SpriteLayout, type CodexPetSpriteLayout } from "./codex-pets-core.js";
import { setConfinementEnabled } from "./confinement-manager.js";
import { setCrossDisplayRoamingEnabled } from "./display.js";
import { getActiveLocale, getActiveMessages, LOCALE_LABELS, SUPPORTED_LOCALES, setLocaleFromPreference, t, type Locale, type LocalePreference } from "./i18n/index.js";
import { recoverDefaultPetMouseInterop, refreshDefaultPetContent, resetDefaultPetToInitialPosition } from "./default-pet-controller.js";
import { refreshPetGazePreference } from "./pet-window.js";
import { readInstalledPetSpriteLayout } from "./installed-pet-layout.js";
import { getLanStatusSnapshot } from "./lan-controller.js";
import { validatePreferencePatch } from "./preference-patch.js";
import { installPet, installPetFromFolder, installPetFromZipFile, removePet, setDefaultInstalledPet } from "./pet-installation.js";
import { assertSafePetId, getPetDir } from "./pet-paths.js";
import { debug, error as logError, warn } from "./logger.js";
import {
  getPluginService,
  type PluginConfigSoundPickResult,
  type PluginServiceResult,
} from "./plugin-service.js";
import { defaultPetSprite, getConfiguredSpriteStates, reactionAnimationMetadata, selectableAnimationMetadata, waitingAnimationDurationOptions } from "./reaction-animation-mapping.js";
import { readSafePluginManifest } from "./plugin-manifest-reader.js";
import { registerPluginAssetProtocol } from "./plugin-asset-protocol.js";
import { installControlCenterPluginIpcHandlers } from "./control-center-plugin-ipc.js";
import { getPetAssistantConversationController } from "./pet-assistant-host.js";
import { clearConversationHistory, deleteConversationHistoryMessage, getConversationHistory } from "./pet-assistant-history-ipc.js";
import { checkForGitHubReleaseUpdate, getUpdateStatus, openUpdateReleasePage } from "./update-checker.js";
import { getRemoteControlService } from "./remote-control-service.js";
import { getPluginHostCapabilitiesForUi, type ElectronPluginHostCapabilities } from "./plugin-host-capabilities.js";
import { deleteProviderCredentialForProfile } from "./provider-service.js";
import { beginProviderTranscriptionTest, testProviderConfiguration } from "./provider-configuration-test.js";
import type { ProviderTranscriptionTestSession } from "./provider-configuration-test-session.js";
import { validateRemoteScopeList, type RemoteControlScope } from "./remote-control-protocol.js";
import { configureVoiceAssistantShortcut, getVoiceAssistantShortcutSnapshot, resolveVoiceAssistantShortcutPreference } from "./voice-assistant-shortcut.js";
import { configureChatShortcut, getChatShortcutSnapshot, resolveChatShortcutPreference } from "./chat-shortcut.js";
import { configurePetToggleShortcut, getPetToggleShortcutSnapshot, resolvePetToggleShortcutPreference } from "./pet-toggle-shortcut.js";
import { getTeamService } from "./team-service.js";
import { getManagerCheckInService } from "./manager-check-in-service.js";
import { managerCheckInFeelingCodes } from "./team-api-client.js";
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
import { normalizeControlCenterRoute, normalizeControlCenterRouteTarget, type ControlCenterRoute, type ControlCenterRouteTarget } from "./control-center-route.js";
import { getSharedVoiceDeviceService } from "./voice-device-service.js";
import { normalizeVoiceDeviceId } from "./voice-device-resolver.js";
import { getSharedVoiceMediaPlayer } from "./voice-media-player.js";
import { cancelProviderTranscriptionTestsForSender as cancelProviderTestsForSender, ProviderTestReplacementLanes, registerProviderTestInitialization } from "./provider-test-lifecycle.js";

type InternalUiWindowKind = "control-center";
export type { ControlCenterRoute } from "./control-center-route.js";
let controlCenterWindow: BrowserWindow | null = null;
let internalUiHandlersInstalled = false;
let pendingControlCenterRouteTarget: ControlCenterRouteTarget | null = null;
let pendingManagerCheckInFormRequest = false;
let pendingDockTimer: NodeJS.Timeout | null = null;
let lastDockHideAt = 0;
let nextProviderTestSessionId = 0;
const providerTestSessions = new Map<string, { readonly senderId: number; readonly session: ProviderTranscriptionTestSession }>();
const providerTestInitializations = new Map<number, Set<AbortController>>();
const providerTestReplacementLanes = new ProviderTestReplacementLanes();
let providerPreviewRequestId: string | null = null;
let nextProviderPreviewId = 0;
const dockHideShowCooldownMs = 1100;

function hasOpenInternalUiWindows(): boolean {
  if (controlCenterWindow && !controlCenterWindow.isDestroyed()) return true;
  return false;
}

function syncDockVisibilityForInternalUi(): void {
  if (process.platform !== "darwin") return;
  const dock = app.dock;
  if (!dock) return;

  if (pendingDockTimer) {
    clearTimeout(pendingDockTimer);
    pendingDockTimer = null;
  }

  if (hasOpenInternalUiWindows()) {
    const elapsedSinceHide = Date.now() - lastDockHideAt;
    const delayMs = elapsedSinceHide < dockHideShowCooldownMs ? dockHideShowCooldownMs - elapsedSinceHide : 0;
    pendingDockTimer = setTimeout(() => {
      pendingDockTimer = null;
      dock.setIcon(createAppIcon());
      dock.show();
    }, delayMs);
  } else {
    dock.hide();
    lastDockHideAt = Date.now();
  }
}

async function getPetsStateSnapshot(): Promise<{
  preferences: { defaultPetId: string };
  pets: { installed: ReadonlyArray<ReturnType<typeof getAppStateSnapshot>["pets"]["installed"][number] & { readonly spriteLayout?: CodexPetSpriteLayout }> };
}> {
  const state = getAppStateSnapshot();
  const installed = await Promise.all(state.pets.installed.map(async (pet) => {
    if (pet.builtIn) return { ...pet, spriteLayout: codexV2SpriteLayout };
    try {
      return {
        ...pet,
        spriteLayout: await readInstalledPetSpriteLayout(
          pet.id,
          pet.source?.kind === "team" ? "team" : "personal",
        ),
      };
    } catch {
      return pet;
    }
  }));
  return { preferences: { defaultPetId: state.preferences.defaultPetId }, pets: { installed } };
}

function getSettingsStateSnapshot(): {
  preferences: Pick<ReturnType<typeof getAppStateSnapshot>["preferences"], "openDefaultPetOnLaunch" | "appearanceTheme" | "petScale" | "hudScale" | "waitingAnimationDurationMs" | "idleCursorGazeEnabled" | "reactionAnimationOverrides" | "petPoolOrder" | "petPoolEnabled" | "petConfinementEnabled" | "petCrossDisplayEnabled" | "petGravityEnabled" | "personality" | "voiceAssistantShortcut" | "chatShortcut" | "petToggleShortcut" | "showChatButton" | "showTalkButton" | "petButtonsPosition" | "petButtonsSize">;
  petScaleOptions: typeof petScaleOptions;
  hudScaleOptions: typeof hudScaleOptions;
  /** Non-broken, non-built-in installed pets available for pool selection. */
  petPoolCandidates: ReadonlyArray<{ readonly id: string; readonly displayName: string }>;
  voiceAssistantShortcutStatus: ReturnType<typeof getVoiceAssistantShortcutSnapshot>;
  chatShortcutStatus: ReturnType<typeof getChatShortcutSnapshot>;
  petToggleShortcutStatus: ReturnType<typeof getPetToggleShortcutSnapshot>;
} {
  const state = getAppStateSnapshot();
  return {
    preferences: {
      openDefaultPetOnLaunch: state.preferences.openDefaultPetOnLaunch,
      appearanceTheme: state.preferences.appearanceTheme,
      petScale: state.preferences.petScale,
      hudScale: state.preferences.hudScale,
      waitingAnimationDurationMs: state.preferences.waitingAnimationDurationMs,
      idleCursorGazeEnabled: state.preferences.idleCursorGazeEnabled,
      reactionAnimationOverrides: state.preferences.reactionAnimationOverrides,
      petPoolOrder: state.preferences.petPoolOrder,
      petPoolEnabled: state.preferences.petPoolEnabled,
      petConfinementEnabled: state.preferences.petConfinementEnabled,
      petCrossDisplayEnabled: state.preferences.petCrossDisplayEnabled,
      petGravityEnabled: state.preferences.petGravityEnabled,
      personality: state.preferences.personality,
      voiceAssistantShortcut: state.preferences.voiceAssistantShortcut,
      chatShortcut: state.preferences.chatShortcut,
      petToggleShortcut: state.preferences.petToggleShortcut,
      showChatButton: state.preferences.showChatButton,
      showTalkButton: state.preferences.showTalkButton,
      petButtonsPosition: state.preferences.petButtonsPosition,
      petButtonsSize: state.preferences.petButtonsSize,
    },
    petScaleOptions,
    hudScaleOptions,
    petPoolCandidates: state.pets.installed
      .filter((p) => !p.builtIn && !p.broken && p.id !== state.preferences.defaultPetId)
      .map(({ id, displayName }) => ({ id, displayName })),
    voiceAssistantShortcutStatus: getVoiceAssistantShortcutSnapshot(),
    chatShortcutStatus: getChatShortcutSnapshot(),
    petToggleShortcutStatus: getPetToggleShortcutSnapshot(),
  };
}

function getI18nSnapshot(): {
  locale: Locale;
  localePreference: LocalePreference;
  availableLocales: { value: Locale; label: string }[];
  messages: ReturnType<typeof getActiveMessages>;
} {
  return {
    locale: getActiveLocale(),
    localePreference: getAppStateSnapshot().preferences.locale,
    availableLocales: SUPPORTED_LOCALES.map((value) => ({ value, label: LOCALE_LABELS[value] })),
    messages: getActiveMessages(),
  };
}

async function getDashboardSnapshot(): Promise<{
  readonly defaultPet: { readonly id: string; readonly displayName: string; readonly previewSpriteUrl: string; readonly spriteLayout: CodexPetSpriteLayout };
  readonly installedPetCount: number;
  readonly catalog: { readonly source: string; readonly total?: number; readonly page?: number; readonly pageCount?: number; readonly error?: string };
  readonly plugins: { readonly installed: number; readonly enabled: number; readonly broken: number };
  readonly updateStatus: ReturnType<typeof getUpdateStatus>;
  readonly activity: Pick<ReturnType<typeof getAppStateSnapshot>["activity"], "messagesSent" | "reactionsSent" | "reactionCounts" | "perPetActivityCounts" | "lastActivityAt">;
}> {
  const state = getAppStateSnapshot();
  const defaultPet = state.pets.installed.find((pet) => pet.id === state.preferences.defaultPetId && !pet.broken) ?? state.pets.installed[0];
  const preview = await getDefaultPetPreviewSpriteInfo();
  const catalog = await getCatalogUiState().catch((error: unknown) => ({ source: "error" as const, pets: [], total: undefined, page: undefined, pageCount: undefined, error: error instanceof Error ? error.message : "Catalog unavailable." }));
  const pluginSnapshot = await getPluginService().getSnapshot().catch((error: unknown) => {
    warn("ui", "dashboard plugin snapshot unavailable", { error: error instanceof Error ? error.message : String(error) });
    return { plugins: [] } as const;
  });
  const installedPlugins = pluginSnapshot.plugins.length;
  const brokenPlugins = pluginSnapshot.plugins.filter((plugin) => Boolean(plugin.brokenReason)).length;
  const enabledPlugins = pluginSnapshot.plugins.filter((plugin) => plugin.enabled && !plugin.brokenReason).length;

  return {
    defaultPet: {
      id: defaultPet?.id ?? state.preferences.defaultPetId,
      displayName: defaultPet?.displayName ?? "OpenPets",
      previewSpriteUrl: `openpets-pet-preview://spritesheet/default?v=${encodeURIComponent(preview.version)}`,
      spriteLayout: preview.spriteLayout,
    },
    installedPetCount: state.pets.installed.length,
    catalog: {
      source: catalog.source,
      total: catalog.total,
      page: catalog.page,
      pageCount: catalog.pageCount,
      error: catalog.error,
    },
    plugins: {
      installed: installedPlugins,
      enabled: enabledPlugins,
      broken: brokenPlugins,
    },
    updateStatus: getUpdateStatus(),
    activity: {
      messagesSent: state.activity.messagesSent,
      reactionsSent: state.activity.reactionsSent,
      reactionCounts: state.activity.reactionCounts,
      perPetActivityCounts: state.activity.perPetActivityCounts,
      lastActivityAt: state.activity.lastActivityAt,
    },
  };
}

export function installInternalUiHandlers(): void {
  if (internalUiHandlersInstalled) {
    return;
  }

  internalUiHandlersInstalled = true;
  app.on("before-quit", () => { void cancelAllProviderTranscriptionTests("OpenPets is shutting down."); });

  // Apply the persisted petConfinementEnabled preference as the initial value
  // for the confinement-manager flag. This runs once after app-state is loaded.
  setConfinementEnabled(getAppStateSnapshot().preferences.petConfinementEnabled);
  setCrossDisplayRoamingEnabled(getAppStateSnapshot().preferences.petCrossDisplayEnabled);
  // Apply the persisted petGravityEnabled preference on startup.
  applyRoamingToAllPets();

  ipcMain.handle("openpets:get-pets-state", (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getPetsStateSnapshot();
  });

  ipcMain.handle("openpets:get-settings-state", (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getSettingsStateSnapshot();
  });

  ipcMain.handle("openpets:voice-devices-get", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getSharedVoiceDeviceService().refresh();
  });

  ipcMain.handle("openpets:voice-devices-refresh", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getSharedVoiceDeviceService().refresh();
  });

  ipcMain.handle("openpets:voice-devices-save-preferences", (event, input: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Voice device preferences must be an object.");
    const value = input as { readonly preferredInputDeviceId?: unknown; readonly preferredOutputDeviceId?: unknown };
    if (value.preferredInputDeviceId !== undefined && value.preferredInputDeviceId !== null && typeof value.preferredInputDeviceId !== "string") throw new Error("Preferred input device id is invalid.");
    if (value.preferredOutputDeviceId !== undefined && value.preferredOutputDeviceId !== null && typeof value.preferredOutputDeviceId !== "string") throw new Error("Preferred output device id is invalid.");
    if (typeof value.preferredInputDeviceId === "string" && normalizeVoiceDeviceId(value.preferredInputDeviceId) === null) throw new Error("Preferred input device id is invalid.");
    if (typeof value.preferredOutputDeviceId === "string" && normalizeVoiceDeviceId(value.preferredOutputDeviceId) === null) throw new Error("Preferred output device id is invalid.");
    return getSharedVoiceDeviceService().savePreferences({
      ...(value.preferredInputDeviceId === undefined ? {} : { preferredInputDeviceId: value.preferredInputDeviceId === null ? null : normalizeVoiceDeviceId(value.preferredInputDeviceId) }),
      ...(value.preferredOutputDeviceId === undefined ? {} : { preferredOutputDeviceId: value.preferredOutputDeviceId === null ? null : normalizeVoiceDeviceId(value.preferredOutputDeviceId) }),
    });
  });

  ipcMain.handle("openpets:get-lan-status", (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getLanStatusSnapshot();
  });

  ipcMain.handle("openpets:get-i18n", (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getI18nSnapshot();
  });

  // Archive management remains a host-owned Control Center capability. It is
  // intentionally not part of the companion chat bridge; Settings can own the
  // presentation in a later phase without giving the pet renderer authority.
  ipcMain.handle("openpets:get-conversation-history", (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getConversationHistory(getPetAssistantConversationController());
  });
  ipcMain.handle("openpets:delete-conversation-history-message", (event, id: unknown): { deleted: boolean } => {
    assertAllowedSender(event, ["control-center"]);
    return deleteConversationHistoryMessage(getPetAssistantConversationController(), id);
  });
  ipcMain.handle("openpets:clear-conversation-history", (event): { cleared: true } => {
    assertAllowedSender(event, ["control-center"]);
    return clearConversationHistory(getPetAssistantConversationController());
  });

  ipcMain.handle("openpets:get-dashboard-snapshot", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getDashboardSnapshot();
  });

  ipcMain.handle("openpets:teams-snapshot", (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getTeamService().getSnapshot();
  });
  ipcMain.handle("openpets:teams-enroll", async (event, displayName: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (
      typeof displayName !== "string"
      || displayName.length > 120
      || displayName.trim().length === 0
    ) {
      throw new Error("Invalid Teams display name.");
    }
    const result = await getTeamService().submitEnrollment(displayName.trim());
    await getManagerCheckInService().syncNow().catch(() => undefined);
    return result;
  });
  ipcMain.handle("openpets:teams-sync", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getTeamService().syncNow();
  });
  ipcMain.handle("openpets:teams-approve-plugin-permissions", async (event, id: unknown, approvalToken: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (
      typeof id !== "string"
      || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id)
      || typeof approvalToken !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(approvalToken)
    ) throw new Error("Invalid Team plugin approval request.");
    return getTeamService().approveTeamPluginPermissions(id, approvalToken);
  });
  ipcMain.handle("openpets:teams-set-plugin-enabled", async (event, id: unknown, enabled: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (
      typeof id !== "string"
      || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id)
      || typeof enabled !== "boolean"
    ) {
      throw new Error("Invalid Team plugin enabled state request.");
    }
    return getTeamService().setTeamPluginEnabled(id, enabled);
  });
  ipcMain.handle("openpets:teams-leave", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    await getManagerCheckInService().stop();
    try {
      return await getTeamService().leave();
    } finally {
      await getManagerCheckInService().start();
    }
  });

  ipcMain.handle("openpets:manager-check-ins-snapshot", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getManagerCheckInService().getSnapshot();
  });
  ipcMain.handle("openpets:manager-check-ins-sync", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getManagerCheckInService().syncNow();
  });
  ipcMain.handle("openpets:manager-check-ins-history", async (event, cursor: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (!isValidManagerCheckInHistoryCursor(cursor)) {
      throw new Error("Invalid manager check-in history cursor.");
    }
    return getManagerCheckInService().getHistory(cursor);
  });
  ipcMain.handle("openpets:manager-check-ins-submit", async (event, input: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    return getManagerCheckInService().submit(validateManagerCheckInSubmitInput(input));
  });
  ipcMain.handle("openpets:manager-check-ins-set-scheduled-offers-paused", async (event, paused: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (typeof paused !== "boolean") {
      throw new Error("Invalid scheduled offers pause request.");
    }
    return getManagerCheckInService().setScheduledOffersPaused(paused);
  });

  ipcMain.handle("openpets:get-reaction-animation-settings", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getReactionAnimationSettingsSnapshot();
  });

  installControlCenterPluginIpcHandlers({
    registerHandle: (channel, handler) => ipcMain.handle(channel, handler),
    authorizeSender: (event) => assertAllowedSender(event, ["control-center"]),
    getPluginService,
    logger: {
      debug: (message, fields) => debug("ui", message, fields),
      warn: (message, fields) => warn("ui", message, fields),
      error: (message, fields) => logError("ui", message, fields),
    },
  });

  ipcMain.handle("openpets:provider-profiles-get", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getProviderControlCenterSnapshot();
  });
  ipcMain.handle("openpets:provider-profile-create", async (event, input: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    const profile = validateProviderProfile(input) as ProviderProfileInput;
    createProviderProfile(profile);
    return getProviderControlCenterSnapshot();
  });
  ipcMain.handle("openpets:provider-profile-update", async (event, id: unknown, patch: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (typeof id !== "string" || !isPlainObject(patch)) throw new Error("Invalid provider profile update.");
    const previous = getPluginPlatformSettings().profiles[id];
    updateProviderProfile(id, validateProviderProfilePatch(patch));
    const next = getPluginPlatformSettings().profiles[id];
    if (previous?.secretRef && previous.secretRef !== next?.secretRef && !isProviderSecretRefReferenced(getPluginPlatformSettings(), previous.secretRef)) await getProviderCapabilities().secretsStore.delete("__openpets-host", `provider:${previous.secretRef}`);
    return getProviderControlCenterSnapshot();
  });
  ipcMain.handle("openpets:provider-profile-save", async (event, input: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    const save = validateProviderConfigurationSaveInput(input);
    const capabilities = getProviderCapabilities();
    await saveProviderConfiguration(save, {
      get: (ref) => capabilities.secretsStore.get("__openpets-host", `provider:${ref}`),
      set: (ref, value) => capabilities.secretsStore.set("__openpets-host", `provider:${ref}`, value),
      delete: (ref) => capabilities.secretsStore.delete("__openpets-host", `provider:${ref}`),
    });
    return getProviderControlCenterSnapshot();
  });
  ipcMain.handle("openpets:provider-profile-test", async (event, input: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    const save = validateProviderConfigurationSaveInput(input);
    const profile = previewProviderConfiguration(save);
    debug("plugin", "Testing unsaved provider configuration", {
      profileId: profile.id,
      adapter: profile.adapter,
    });
    const capabilities = getProviderCapabilities();
    const credential = save.credentialValue
      ?? (profile.secretRef
        ? await capabilities.secretsStore.get("__openpets-host", `provider:${profile.secretRef}`)
        : undefined);
    return testProviderConfiguration(profile, credential);
  });
  ipcMain.handle("openpets:provider-profile-test-begin", async (event, input: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    const initializationController = new AbortController();
    const unregisterInitialization = registerProviderTestInitialization(providerTestInitializations, event.sender.id, initializationController);
    const preemption = cancelProviderTranscriptionTestsForSender(event.sender.id, "Provider transcription test was preempted.", initializationController);
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
            ? await capabilities.secretsStore.get("__openpets-host", `provider:${profile.secretRef}`)
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
  ipcMain.handle("openpets:provider-profile-test-finish", async (event, sessionId: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    const entry = getProviderTestSession(event.sender.id, sessionId);
    const result = await entry.session.finish();
    providerTestSessions.delete(sessionId as string);
    return { kind: "stt", detail: result.text || "Transcription completed (no speech detected)." } as const;
  });
  ipcMain.handle("openpets:provider-profile-test-cancel", async (event, sessionId: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (sessionId === undefined || sessionId === null) {
      await cancelProviderTranscriptionTestsForSender(event.sender.id, "Provider transcription test was cancelled.");
      return { cancelled: true } as const;
    }
    if (typeof sessionId !== "string") return { cancelled: false } as const;
    const entry = providerTestSessions.get(sessionId);
    if (!entry || entry.senderId !== event.sender.id) return { cancelled: false } as const;
    providerTestSessions.delete(sessionId);
    await entry.session.cancel("Provider transcription test was cancelled.");
    return { cancelled: true } as const;
  });
  ipcMain.handle("openpets:provider-preview-play", async (event, bytes: unknown, mimeType: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024 || typeof mimeType !== "string" || mimeType.length === 0) {
      throw new Error("Invalid provider preview audio.");
    }
    const requestId = `provider-preview-${++nextProviderPreviewId}`;
    providerPreviewRequestId = requestId;
    try {
      return await getSharedVoiceMediaPlayer().play(requestId, bytes, mimeType);
    } finally {
      if (providerPreviewRequestId === requestId) providerPreviewRequestId = null;
    }
  });
  ipcMain.handle("openpets:provider-preview-stop", (event) => {
    assertAllowedSender(event, ["control-center"]);
    const requestId = providerPreviewRequestId;
    providerPreviewRequestId = null;
    return requestId ? getSharedVoiceMediaPlayer().stop(requestId) : undefined;
  });
  ipcMain.handle("openpets:provider-profile-delete", async (event, id: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (typeof id !== "string") throw new Error("Invalid provider profile id.");
    const existing = getPluginPlatformSettings().profiles[id];
    const settings = deleteProviderProfile(id);
    const capabilities = getProviderCapabilities();
    const ref = existing?.secretRef;
    if (ref && !isProviderSecretRefReferenced(settings, ref)) await capabilities.secretsStore.delete("__openpets-host", `provider:${ref}`);
    return getProviderControlCenterSnapshot();
  });
  ipcMain.handle("openpets:provider-gates-update", async (event, patch: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    updatePluginPlatformSettings(validateProviderGatesPatch(patch));
    return getProviderControlCenterSnapshot();
  });
  ipcMain.handle("openpets:provider-profile-select", async (event, role: unknown, id: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (!isProviderRole(role) || (id !== null && typeof id !== "string")) throw new Error("Invalid provider profile selection.");
    selectProviderProfile(role, id as string | null);
    return getProviderControlCenterSnapshot();
  });
  ipcMain.handle("openpets:provider-profile-credential-set", async (event, id: unknown, value: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (typeof id !== "string" || typeof value !== "string" || Buffer.byteLength(value, "utf8") > 16 * 1024 || value.length === 0) throw new Error("Invalid provider credential.");
    const capabilities = getProviderCapabilities();
    await saveProviderConfiguration({
      isEditing: true,
      profileId: id,
      payload: { id },
      credentialValue: value,
      activatedRoles: [],
      deactivatedRoles: [],
    }, {
      get: (ref) => capabilities.secretsStore.get("__openpets-host", `provider:${ref}`),
      set: (ref, credential) => capabilities.secretsStore.set("__openpets-host", `provider:${ref}`, credential),
      delete: (ref) => capabilities.secretsStore.delete("__openpets-host", `provider:${ref}`),
    });
    return getProviderControlCenterSnapshot();
  });
  ipcMain.handle("openpets:provider-profile-credential-status", async (event, id: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (typeof id !== "string") throw new Error("Invalid provider profile id.");
    const profile = getPluginPlatformSettings().profiles[id];
    return { hasCredential: Boolean(profile?.secretRef && await getProviderCapabilities().secretsStore.has("__openpets-host", `provider:${profile.secretRef}`)) };
  });
  ipcMain.handle("openpets:provider-profile-credential-delete", async (event, id: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (typeof id !== "string") throw new Error("Invalid provider profile id.");
    const profile = getPluginPlatformSettings().profiles[id];
    if (profile) await deleteProviderCredentialForProfile(getProviderCapabilities().secretsStore, profile, Object.values(getPluginPlatformSettings().profiles));
    return getProviderControlCenterSnapshot();
  });

  ipcMain.handle("openpets:get-catalog", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getCatalogUiState();
  });

  ipcMain.handle("openpets:get-catalog-page", async (event, page: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (typeof page !== "number" || !Number.isInteger(page) || page < 0) throw new Error("Invalid catalog page.");
    return getCatalogPageUiState(page);
  });

  ipcMain.handle("openpets:get-catalog-search", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getCatalogSearchUiState();
  });

  ipcMain.handle("openpets:get-codex-pets", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getCodexPetsUiState();
  });

  ipcMain.handle("openpets:update-preferences", (event, patch: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    const previousScale = getAppStateSnapshot().preferences.petScale;
    const previousHudScale = getAppStateSnapshot().preferences.hudScale;
    const previousWaitingAnimationDurationMs = getAppStateSnapshot().preferences.waitingAnimationDurationMs;
    const previousIdleCursorGazeEnabled = getAppStateSnapshot().preferences.idleCursorGazeEnabled;
    const previousOverrides = JSON.stringify(getAppStateSnapshot().preferences.reactionAnimationOverrides ?? {});
    const previousLocale = getActiveLocale();
    const previousPoolEnabled = getAppStateSnapshot().preferences.petPoolEnabled;
    const validatedPatch = validatePreferencePatch(patch);
    const currentShortcut = getAppStateSnapshot().preferences.voiceAssistantShortcut;
    const shortcutSnapshot = validatedPatch.voiceAssistantShortcut !== undefined
      ? configureVoiceAssistantShortcut(validatedPatch.voiceAssistantShortcut)
      : null;
    let effectivePatch = shortcutSnapshot && validatedPatch.voiceAssistantShortcut !== undefined
      ? { ...validatedPatch, voiceAssistantShortcut: resolveVoiceAssistantShortcutPreference(currentShortcut, validatedPatch.voiceAssistantShortcut, shortcutSnapshot) }
      : validatedPatch;
    if (validatedPatch.chatShortcut !== undefined) {
      const currentChatShortcut = getAppStateSnapshot().preferences.chatShortcut;
      const chatSnapshot = configureChatShortcut(validatedPatch.chatShortcut);
      effectivePatch = { ...effectivePatch, chatShortcut: resolveChatShortcutPreference(currentChatShortcut, validatedPatch.chatShortcut, chatSnapshot) };
    }
    if (validatedPatch.petToggleShortcut !== undefined) {
      const currentPetToggleShortcut = getAppStateSnapshot().preferences.petToggleShortcut;
      const petToggleSnapshot = configurePetToggleShortcut(validatedPatch.petToggleShortcut);
      effectivePatch = { ...effectivePatch, petToggleShortcut: resolvePetToggleShortcutPreference(currentPetToggleShortcut, validatedPatch.petToggleShortcut, petToggleSnapshot) };
    }
    const state = updatePreferences(effectivePatch);
    if (validatedPatch.personality) debug("ui", "Pet Assistant personality preferences updated", { fields: Object.keys(validatedPatch.personality) });
    const nextOverrides = JSON.stringify(state.preferences.reactionAnimationOverrides ?? {});
    const petButtonPrefsChanged = validatedPatch.showChatButton !== undefined
      || validatedPatch.showTalkButton !== undefined
      || validatedPatch.petButtonsPosition !== undefined
      || validatedPatch.petButtonsSize !== undefined;
    if (state.preferences.petScale !== previousScale || state.preferences.hudScale !== previousHudScale || state.preferences.waitingAnimationDurationMs !== previousWaitingAnimationDurationMs || nextOverrides !== previousOverrides || petButtonPrefsChanged) {
      refreshDefaultPetContent();
      refreshAgentPetContent();
    }
    if (state.preferences.idleCursorGazeEnabled !== previousIdleCursorGazeEnabled) {
      refreshPetGazePreference();
    }
    if (setLocaleFromPreference(state.preferences.locale) !== previousLocale) {
      // Tray labels are rendered eagerly, so rebuild the menu in the new language.
      void import("./tray.js").then(({ refreshTrayMenu }) => refreshTrayMenu());
      // Control Center plugin labels are resolved at display time; nudge it to re-fetch the
      // SafePluginRecords so manifest/config labels re-render in the new language.
      broadcastPluginRecordsRefresh();
    }
    // Propagate petConfinementEnabled into the confinement-manager flag on every pref update.
    setConfinementEnabled(state.preferences.petConfinementEnabled);
    // Propagate petCrossDisplayEnabled into the display-module flag on every pref update.
    setCrossDisplayRoamingEnabled(state.preferences.petCrossDisplayEnabled);
    // Propagate petGravityEnabled to all live pets on every pref update.
    applyRoamingToAllPets();
    // Propagate petPoolEnabled — despawn on disable, respawn on enable.
    if (state.preferences.petPoolEnabled !== previousPoolEnabled) {
      void import("./local-ipc.js").then(({ dispatchPoolToggle }) => dispatchPoolToggle(state.preferences.petPoolEnabled));
    }
    return getInternalUiWindowKindForWebContents(event.sender.id) === "control-center" ? getSettingsStateSnapshot() : state;
  });

  ipcMain.handle("openpets:get-launch-at-login", (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getLaunchAtLoginState();
  });

  ipcMain.handle("openpets:set-launch-at-login", (event, enabled: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (typeof enabled !== "boolean") throw new Error("Invalid launch-at-login value.");
    if (!isLaunchAtLoginSupported()) return getLaunchAtLoginState();
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
    return getLaunchAtLoginState();
  });

  ipcMain.handle("openpets:get-update-status", (event) => {
    assertAllowedSender(event, ["control-center"]);
    return getUpdateStatus();
  });

  ipcMain.handle("openpets:check-for-updates", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    const status = await checkForGitHubReleaseUpdate();
    const { refreshTrayMenu } = await import("./tray.js");
    refreshTrayMenu();
    return status;
  });

  ipcMain.handle("openpets:open-update-release-page", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    await openUpdateReleasePage();
  });

  ipcMain.handle("openpets:remote-get-snapshot", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    const service = getRemoteControlService();
    return {
      config: service.getConfiguration(),
      clients: service.listClients(),
    };
  });

  ipcMain.handle("openpets:remote-configure", async (event, input: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (!isPlainObject(input) || typeof input.enabled !== "boolean") {
      throw new Error("Invalid remote control configuration request.");
    }
    const { enabled, address, port } = input as { enabled: boolean; address?: unknown; port?: unknown };
    if (address !== undefined && typeof address !== "string") {
      throw new Error("Invalid remote control configuration request.");
    }
    if (port !== undefined && typeof port !== "number") {
      throw new Error("Invalid remote control configuration request.");
    }
    const service = getRemoteControlService();
    const config = await service.configure({
      enabled,
      ...(typeof address === "string" ? { address } : {}),
      ...(typeof port === "number" ? { port } : {}),
    });
    return {
      config,
      clients: service.listClients(),
    };
  });

  ipcMain.handle("openpets:remote-pair-client", async (event, input: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (!isPlainObject(input) || typeof input.name !== "string" || !Array.isArray(input.scopes)) {
      throw new Error("Invalid remote client pair request.");
    }
    const { name, scopes } = input as { name: string; scopes: unknown[] };
    let normalizedScopes: RemoteControlScope[];
    try {
      normalizedScopes = validateRemoteScopeList(scopes);
    } catch {
      throw new Error("Invalid remote client pair request.");
    }
    const service = getRemoteControlService();
    return service.pairClient({ name, scopes: normalizedScopes });
  });

  ipcMain.handle("openpets:remote-rotate-client", async (event, clientId: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (typeof clientId !== "string" || !clientId) {
      throw new Error("Invalid remote client rotate request.");
    }
    const service = getRemoteControlService();
    return service.rotateClient(clientId);
  });

  ipcMain.handle("openpets:remote-revoke-client", async (event, clientId: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (typeof clientId !== "string" || !clientId) {
      throw new Error("Invalid remote client revoke request.");
    }
    const service = getRemoteControlService();
    return service.revokeClient(clientId);
  });

  ipcMain.handle("openpets:set-default-pet", async (event, petId: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (typeof petId !== "string") {
      throw new Error("Invalid pet id.");
    }

    const state = await setDefaultInstalledPet(petId);
    refreshDefaultPetContent();
    recoverDefaultPetMouseInterop("default-pet-changed");
    setTimeout(() => recoverDefaultPetMouseInterop("default-pet-changed+500ms"), 500).unref?.();
    return getInternalUiWindowKindForWebContents(event.sender.id) === "control-center" ? getPetsStateSnapshot() : state;
  });

  ipcMain.handle("openpets:set-pet-pool-order", (event, ids: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (!Array.isArray(ids)) throw new Error("Invalid pet pool order: expected an array.");
    const normalized = normalizePetPoolOrder(ids);
    setPetPoolOrder(normalized ?? []);
    return getSettingsStateSnapshot();
  });

  ipcMain.handle("openpets:install-pet", async (event, petId: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (typeof petId !== "string") {
      throw new Error("Invalid pet id.");
    }

    const state = await installPet(petId);
    return getInternalUiWindowKindForWebContents(event.sender.id) === "control-center" ? getPetsStateSnapshot() : state;
  });

  ipcMain.handle("openpets:install-local-pet", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const importKind = await chooseLocalPetImportKind(owner);
    if (!importKind) return getPetsStateSnapshot();
    const options: OpenDialogOptions = importKind === "zip" ? {
      title: "Install pet from ZIP",
      buttonLabel: "Install Pet",
      properties: ["openFile"],
      filters: [{ name: "OpenPets ZIP", extensions: ["zip"] }],
    } : {
      title: "Install pet from folder",
      buttonLabel: "Install Pet",
      properties: ["openDirectory"],
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return getPetsStateSnapshot();
    const selectedPath = result.filePaths[0];
    try {
      const selectedStats = await stat(selectedPath);
      const state = selectedStats.isDirectory() ? await installPetFromFolder(selectedPath) : await installPetFromZipFile(selectedPath);
      debug("ui", "local pet import succeeded", { kind: selectedStats.isDirectory() ? "folder" : "zip" });
      refreshDefaultPetContent();
      return getInternalUiWindowKindForWebContents(event.sender.id) === "control-center" ? getPetsStateSnapshot() : state;
    } catch (error) {
      logError("ui", "local pet import failed", { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  });

  ipcMain.handle("openpets:open-gallery", async (event) => {
    assertAllowedSender(event, ["control-center"]);
    await shell.openExternal("https://openpets.dev/gallery");
  });

  ipcMain.handle("openpets:import-codex-pet", async (event, petId: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (typeof petId !== "string") {
      throw new Error("Invalid pet id.");
    }

    const state = await importCodexPet(petId);
    return getInternalUiWindowKindForWebContents(event.sender.id) === "control-center" ? getPetsStateSnapshot() : state;
  });

  ipcMain.handle("openpets:remove-pet", async (event, petId: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (typeof petId !== "string") {
      throw new Error("Invalid pet id.");
    }

    const state = await removePet(petId);
    refreshDefaultPetContent();
    return getInternalUiWindowKindForWebContents(event.sender.id) === "control-center" ? getPetsStateSnapshot() : state;
  });

  ipcMain.handle("openpets:reset-default-pet-position", (event) => {
    assertAllowedSender(event, ["control-center"]);
    resetDefaultPetToInitialPosition();
    return getInternalUiWindowKindForWebContents(event.sender.id) === "control-center" ? getSettingsStateSnapshot() : getAppStateSnapshot();
  });

  ipcMain.handle("openpets:agent-setup-snapshot", async (event, selectedPetId: unknown, commandMode: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    return getAgentSetupSnapshot(selectedPetId, commandMode);
  });

  ipcMain.handle("openpets:agent-setup-action", async (event, action: unknown, selectedPetId: unknown, commandMode: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    if (action !== "configure" && action !== "replace" && action !== "remove" && action !== "install-memory" && action !== "doctor-hooks" && action !== "install-hooks" && action !== "uninstall-hooks" && action !== "opencode-install" && action !== "opencode-remove" && action !== "cursor-install" && action !== "cursor-replace" && action !== "cursor-remove" && action !== "openclaw-install" && action !== "openclaw-update" && action !== "openclaw-remove" && action !== "zed-install" && action !== "zed-replace" && action !== "zed-remove") {
      throw new Error("Invalid agent setup action.");
    }

    return runAgentSetupAction(action, selectedPetId, commandMode);
  });

  ipcMain.handle("openpets:agent-setup-command-paths", (event, patch: unknown) => {
    assertAllowedSender(event, ["control-center"]);
    return updateAgentSetupCommandPaths(patch);
  });
}

async function chooseLocalPetImportKind(owner: BrowserWindow | undefined): Promise<"zip" | "folder" | null> {
  const options = {
    type: "question" as const,
    title: "Install pet",
    message: "Install pet from ZIP or folder?",
    detail: "Choose the source type before selecting the pet package.",
    buttons: ["ZIP", "Folder", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  };
  const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
  if (result.response === 0) return "zip";
  if (result.response === 1) return "folder";
  return null;
}

export function installInternalUiProtocol(): void {
  registerPluginAssetProtocol(protocol, getPluginService);
  protocol.handle("openpets-codex", async (request) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
      const url = new URL(request.url);
      if (url.hostname !== "spritesheet" || url.search || url.hash) return new Response(null, { status: 404 });
      const petId = decodeURIComponent(url.pathname.replace(/^\//, ""));
      const spritesheet = await readCodexPetSpritesheet(petId);
      return new Response(spritesheet, {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "private, max-age=60",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });

  protocol.handle("openpets-installed", async (request) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
      const url = new URL(request.url);
      if (url.hostname !== "spritesheet" || url.search || url.hash) return new Response(null, { status: 404 });
      const petId = decodeURIComponent(url.pathname.replace(/^\//, ""));
      assertSafePetId(petId);
      const pet = getAppStateSnapshot().pets.installed.find((candidate) => candidate.id === petId && !candidate.broken);
      if (!pet) return new Response(null, { status: 404 });
      const spritesheetPath = join(
        getPetDir(petId, pet.source?.kind === "team" ? "team" : "personal"),
        "spritesheet.webp",
      );
      const spritesheet = await stat(spritesheetPath);
      if (!spritesheet.isFile() || spritesheet.size <= 0 || spritesheet.size > 100 * 1024 * 1024) return new Response(null, { status: 404 });
      return new Response(await readFile(spritesheetPath), {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "private, max-age=60",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });

  protocol.handle("openpets-pet-preview", async (request) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
      const url = new URL(request.url);
      if (url.hostname !== "spritesheet" || url.pathname !== "/default" || url.hash) return new Response(null, { status: 404 });
      const version = url.searchParams.get("v");
      if ([...url.searchParams.keys()].some((key) => key !== "v") || (version !== null && !/^[a-z0-9_-]+-\d+-\d+$/.test(version))) return new Response(null, { status: 404 });
      const { path } = await getDefaultPetPreviewSpriteInfo();
      const spritesheet = await stat(path);
      if (!spritesheet.isFile() || spritesheet.size <= 0 || spritesheet.size > 100 * 1024 * 1024) return new Response(null, { status: 404 });
      return new Response(await readFile(path), {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

// The renderer layout reads slightly oversized at native scale; zoom the whole
// control center out a notch so more content fits without restyling every view.
const controlCenterZoomFactor = 0.9;

export function openControlCenterWindow(route: ControlCenterRoute = "dashboard"): void {
  openControlCenterWindowTarget({ route: normalizeControlCenterRoute(route) });
}

export function openControlCenterWindowTarget(target: ControlCenterRouteTarget): void {
  const safeTarget = normalizeControlCenterRouteTarget(target);
  if (controlCenterWindow && !controlCenterWindow.isDestroyed()) {
    syncDockVisibilityForInternalUi();
    if (controlCenterWindow.isMinimized()) controlCenterWindow.restore();
    controlCenterWindow.show();
    controlCenterWindow.focus();
    routeControlCenterWindow(controlCenterWindow, safeTarget);
    return;
  }

  // Near-square shape reads best for the control center; clamp to the work
  // area so the window never spawns larger than small laptop screens.
  const { workAreaSize } = screen.getPrimaryDisplay();
  const window = new BrowserWindow({
    title: "OpenPets — Control Center",
    width: Math.min(1020, Math.floor(workAreaSize.width * 0.9)),
    height: Math.min(1000, Math.floor(workAreaSize.height * 0.9)),
    minWidth: 820,
    minHeight: 620,
    show: false,
    icon: createAppIcon(),
    backgroundColor: "#f8fbff",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: getControlCenterPreloadPath(),
      zoomFactor: controlCenterZoomFactor,
    },
  });

  controlCenterWindow = window;
  syncDockVisibilityForInternalUi();
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error("Failed to load Control Center renderer.", { errorCode, errorDescription });
    logError("ui", "control center load failed", { errorCode, errorDescription });
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const fields = { level, line, sourceId, message };
    if (level >= 3) logError("ui", "control center console", fields);
    else if (level === 2) warn("ui", "control center console", fields);
    else debug("ui", "control center console", fields);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("Control Center renderer process gone.", details);
    logError("ui", "control center renderer gone", details);
    void cancelProviderTranscriptionTestsForSender(window.webContents.id, "Control Center renderer was lost.");
  });
  window.on("closed", () => {
    void cancelProviderTranscriptionTestsForSender(window.webContents.id, "Control Center window was closed.");
    controlCenterWindow = null;
    syncDockVisibilityForInternalUi();
  });
  window.once("ready-to-show", () => { window.show(); window.focus(); });
  pendingControlCenterRouteTarget = safeTarget;
  window.webContents.on("did-finish-load", () => {
    // Chromium remembers per-host zoom, which can override the initial
    // webPreferences value after reloads; pin it on every load.
    window.webContents.setZoomFactor(controlCenterZoomFactor);
    flushPendingControlCenterRoute(window);
  });

  const devUrl = getSafeControlCenterDevUrl();
  const load = devUrl ? window.loadURL(withControlCenterRoute(devUrl, safeTarget)) : window.loadFile(join(app.getAppPath(), "dist", "renderer", "index.html"), { query: controlCenterRouteQuery(safeTarget) });
  load.catch((error: unknown) => {
    console.error("Failed to load Control Center.", error);
  });
}

export function openControlCenterManagerCheckInForm(): void {
  pendingManagerCheckInFormRequest = true;
  openControlCenterWindow("teams");
}

export function focusOpenTaskWindows(): void {
  syncDockVisibilityForInternalUi();
  if (controlCenterWindow && !controlCenterWindow.isDestroyed()) {
    if (controlCenterWindow.isMinimized()) controlCenterWindow.restore();
    controlCenterWindow.show();
    controlCenterWindow.focus();
  }
}

function sendControlCenterRoute(window: BrowserWindow, target: ControlCenterRouteTarget): void {
  if (window.isDestroyed()) return;
  window.webContents.send("openpets:control-center-route", target);
}

function sendManagerCheckInFormRequest(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  window.webContents.send("openpets:manager-check-in-open-form");
}

/** Tell the open Control Center to re-fetch the plugin snapshot (e.g. after a locale change). */
function broadcastPluginRecordsRefresh(): void {
  if (controlCenterWindow && !controlCenterWindow.isDestroyed()) {
    controlCenterWindow.webContents.send("openpets:plugins-refresh");
  }
}

function routeControlCenterWindow(window: BrowserWindow, target: ControlCenterRouteTarget): void {
  pendingControlCenterRouteTarget = target;
  if (window.webContents.isLoading()) return;
  flushPendingControlCenterRoute(window);
}

function flushPendingControlCenterRoute(window: BrowserWindow): void {
  if (window.isDestroyed() || !pendingControlCenterRouteTarget) return;
  const target = pendingControlCenterRouteTarget;
  const openManagerCheckInForm = pendingManagerCheckInFormRequest;
  pendingControlCenterRouteTarget = null;
  pendingManagerCheckInFormRequest = false;
  sendControlCenterRoute(window, target);
  if (openManagerCheckInForm) sendManagerCheckInFormRequest(window);
}

function controlCenterRouteQuery(target: ControlCenterRouteTarget): { route: string; assistantTab?: string } {
  return target.assistantTab ? { route: target.route, assistantTab: target.assistantTab } : { route: target.route };
}

function withControlCenterRoute(rawUrl: string, target: ControlCenterRouteTarget): string {
  const url = new URL(rawUrl);
  url.searchParams.set("route", target.route);
  if (target.assistantTab) url.searchParams.set("assistantTab", target.assistantTab);
  return url.toString();
}

function pluginUiError(error: string): PluginServiceResult {
  return { ok: false, error, snapshot: { plugins: [] } };
}

function pluginUiSoundError(error: string): PluginConfigSoundPickResult {
  return { ok: false, error, snapshot: { plugins: [] } };
}

function validateManagerCheckInSubmitInput(value: unknown): {
  readonly feelingCode: string;
  readonly note?: string | null;
  readonly settingsRevision: number;
} {
  if (!isPlainObject(value)) {
    throw new Error("Invalid manager check-in submission request.");
  }
  if (Object.keys(value).some((key) => !["feelingCode", "note", "settingsRevision"].includes(key))) {
    throw new Error("Invalid manager check-in submission request.");
  }

  if (
    typeof value.feelingCode !== "string"
    || !managerCheckInFeelingCodes.includes(value.feelingCode as typeof managerCheckInFeelingCodes[number])
  ) {
    throw new Error("Invalid manager check-in submission request.");
  }
  if (value.note !== undefined && value.note !== null && typeof value.note !== "string") {
    throw new Error("Invalid manager check-in submission request.");
  }
  if (typeof value.note === "string" && value.note.length > 1000) {
    throw new Error("Invalid manager check-in submission request.");
  }
  if (typeof value.settingsRevision !== "number" || !Number.isSafeInteger(value.settingsRevision) || value.settingsRevision < 0) {
    throw new Error("Invalid manager check-in submission request.");
  }

  const settingsRevision = value.settingsRevision as number;
  const result: {
    readonly feelingCode: string;
    readonly note?: string | null;
    readonly settingsRevision: number;
  } = {
    feelingCode: value.feelingCode,
    settingsRevision,
  };
  if (value.note !== undefined) {
    return {
      ...result,
      note: value.note as string | null,
    };
  }
  return result;
}

function isValidManagerCheckInHistoryCursor(value: unknown): boolean {
  return value === undefined
    || (typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
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

function getProviderTestSession(senderId: number, value: unknown): { readonly senderId: number; readonly session: ProviderTranscriptionTestSession } {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new Error("Invalid provider test session.");
  const entry = providerTestSessions.get(value);
  if (!entry || entry.senderId !== senderId) throw new Error("Provider test session is no longer active.");
  return entry;
}

async function cancelProviderTranscriptionTestsForSender(senderId: number, reason: string, exceptController?: AbortController): Promise<void> {
  await cancelProviderTestsForSender(senderId, reason, providerTestInitializations, providerTestSessions, exceptController);
}

async function cancelAllProviderTranscriptionTests(reason: string): Promise<void> {
  for (const controllers of providerTestInitializations.values()) {
    for (const controller of controllers) controller.abort(reason);
  }
  const entries = [...providerTestSessions.entries()];
  providerTestSessions.clear();
  for (const [, entry] of entries) await entry.session.cancel(reason).catch(() => undefined);
  await providerTestReplacementLanes.waitForAll();
}

function getControlCenterPreloadPath(): string {
  return join(app.getAppPath(), "control-center-preload.cjs");
}

function getSafeControlCenterDevUrl(): string | null {
  if (app.isPackaged) return null;
  const raw = process.env.OPENPETS_RENDERER_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol === "http:" || url.protocol === "https:") && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function getProviderCapabilities(): ElectronPluginHostCapabilities {
  const capabilities = getPluginHostCapabilitiesForUi();
  if (capabilities) return capabilities;
  throw new Error("Plugin host capabilities are unavailable.");
}

async function getProviderControlCenterSnapshot(): Promise<import("./plugin-platform-settings.js").ProviderControlCenterSnapshot> {
  const capabilities = getProviderCapabilities();
  const settings = getPluginPlatformSettings();
  const credentialRefs = new Set<string>();
  for (const profile of Object.values(settings.profiles)) if (profile.secretRef && await capabilities.secretsStore.has("__openpets-host", `provider:${profile.secretRef}`)) credentialRefs.add(profile.secretRef);
  return buildProviderControlCenterSnapshot(settings, (profile) => Boolean(profile.secretRef && credentialRefs.has(profile.secretRef)));
}

function assertAllowedSender(event: { readonly sender: { readonly id: number } }, allowedKinds: readonly InternalUiWindowKind[]): void {
  const actualKind = getInternalUiWindowKindForWebContents(event.sender.id);

  if (!actualKind || !allowedKinds.includes(actualKind)) {
    throw new Error("OpenPets internal UI request came from an unexpected window.");
  }
}

function getInternalUiWindowKindForWebContents(webContentsId: number): InternalUiWindowKind | null {
  if (controlCenterWindow && !controlCenterWindow.isDestroyed() && controlCenterWindow.webContents.id === webContentsId) {
    return "control-center";
  }
  return null;
}

async function getReactionAnimationSettingsSnapshot(): Promise<unknown> {
  const state = getAppStateSnapshot();
  const preview = await getDefaultPetPreviewSpriteInfo();
  return {
    reactions: reactionAnimationMetadata.map((reaction) => ({
      ...reaction,
      label: t(`settings.reaction.${reaction.id}.label`),
      description: t(`settings.reaction.${reaction.id}.description`),
    })),
    animations: selectableAnimationMetadata.map((animation) => ({
      ...animation,
      label: t(`settings.animation.${animation.id}.label`),
      description: t(`settings.animation.${animation.id}.description`),
    })),
    sprite: { ...defaultPetSprite, ...preview.spriteLayout, states: getConfiguredSpriteStates(state.preferences.waitingAnimationDurationMs) },
    waitingAnimationDurationMs: state.preferences.waitingAnimationDurationMs,
    waitingAnimationDurationOptions: waitingAnimationDurationOptions.map((option) => ({
      value: option.value,
      label: option.value === 1010
        ? t("settings.waitingAnimationDuration.normal")
        : t("settings.waitingAnimationDuration.relaxed"),
    })),
    overrides: state.preferences.reactionAnimationOverrides ?? {},
    previewSpriteUrl: `openpets-pet-preview://spritesheet/default?v=${encodeURIComponent(preview.version)}`,
  };
}

async function getDefaultPetPreviewSpriteInfo(): Promise<{ readonly path: string; readonly version: string; readonly spriteLayout: CodexPetSpriteLayout }> {
  const state = getAppStateSnapshot();
  const selected = state.pets.installed.find((pet) => pet.id === state.preferences.defaultPetId);
  const builtInPath = join(app.getAppPath(), "assets", defaultPetSprite.fileName);
  const usesInstalledCandidate = Boolean(selected && !selected.broken && !selected.builtIn);
  const candidatePath = usesInstalledCandidate && selected
    ? join(
        getPetDir(selected.id, selected.source?.kind === "team" ? "team" : "personal"),
        "spritesheet.webp",
      )
    : builtInPath;
  try {
    const spritesheet = await stat(candidatePath);
    if (spritesheet.isFile() && spritesheet.size > 0 && spritesheet.size <= 100 * 1024 * 1024) {
      const spriteLayout = usesInstalledCandidate && selected
        ? await readInstalledPetSpriteLayout(
            selected.id,
            selected.source?.kind === "team" ? "team" : "personal",
          )
        : codexV2SpriteLayout;
      return { path: candidatePath, version: `${usesInstalledCandidate && selected ? selected.id : "builtin"}-${Math.round(spritesheet.mtimeMs)}-${spritesheet.size}`, spriteLayout };
    }
  } catch {
    // Fall back to the bundled pet if an installed default disappears while Settings is open.
  }
  const fallback = await stat(builtInPath);
  return { path: builtInPath, version: `builtin-${Math.round(fallback.mtimeMs)}-${fallback.size}`, spriteLayout: codexV2SpriteLayout };
}

function getLaunchAtLoginState(): { supported: boolean; enabled: boolean } {
  if (!isLaunchAtLoginSupported()) return { supported: false, enabled: false };
  return { supported: true, enabled: app.getLoginItemSettings().openAtLogin };
}

function isLaunchAtLoginSupported(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}
