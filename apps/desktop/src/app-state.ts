import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";

import { app } from "electron";
import { isValidZedNodeCommand } from "@open-pets/zed";

import { defaultAppearanceTheme, defaultHudScale, defaultIdleCursorGazeEnabled, defaultPetButtonsPosition, defaultPetButtonsSize, defaultPetScale, defaultWaitingAnimationDurationMs, getHudScaleForPetScale, markOnboardingCompleted, normalizeAppearanceTheme, normalizeHudScale, normalizeIdleCursorGazeEnabled, normalizeOnboardingCompleted, normalizePetButtonsPosition, normalizePetButtonsSize, normalizePetConfinementEnabled, normalizePetCrossDisplayEnabled, normalizePetGravityEnabled, normalizePetHorizontalFlip, normalizePetScale, normalizeWaitingAnimationDurationMs, hudScaleOptions, petScaleOptions, togglePetHorizontalFlipMap, waitingAnimationDurationOptions, type AppearanceTheme, type HudScaleValue, type PetButtonsPosition, type PetButtonsSize, type PetScaleValue, type WaitingAnimationDurationMs } from "./app-state-core.js";
import { builtInPet } from "./built-in-pet.js";
import { normalizeDefaultPetPositionState, normalizePosition, recordDefaultPetPositionState, resetDefaultPetPositionState, type DefaultPetPositionState } from "./default-pet-position-state.js";
import { isSupportedLocale, type LocalePreference } from "./i18n/catalog.js";
import { allowedReactions, type OpenPetsReaction } from "./local-ipc-protocol.js";
import {
  assertSafePetId,
  getInstalledPetDir,
  getTeamPetDir,
} from "./pet-paths.js";
import { normalizePetPoolOrder } from "./pet-pool.js";
import { normalizeVoiceDeviceId } from "./voice-device-resolver.js";
import { publishPluginAgentActivity } from "./plugin-events-source.js";
import { normalizeReactionAnimationOverrides, type ReactionAnimationOverrides } from "./reaction-animation-mapping.js";
import { defaultPetAssistantPersonality, mergePetAssistantPersonality, normalizePetAssistantPersonality, type PetAssistantPersonality, type PetAssistantPersonalityPatch } from "./pet-assistant-personality.js";
import { DEFAULT_VOICE_ASSISTANT_SHORTCUT, isCanonicalVoiceAssistantShortcut } from "./voice-assistant-shortcut.js";

export { normalizePetPoolOrder } from "./pet-pool.js";

export interface InstalledPetState {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly builtIn: boolean;
  readonly protected: boolean;
  readonly installed: boolean;
  readonly source?: {
    readonly kind?: "catalog";
    readonly catalogVersion: 2;
    readonly zip: string;
    readonly preview: string;
  } | {
    readonly kind: "codex";
    readonly path: string;
  } | {
    readonly kind: "team";
    readonly organizationId: string;
    readonly itemId: string;
    readonly artifactVersionId: string;
    readonly releaseId: string;
  };
  readonly broken?: boolean;
  readonly brokenReason?: string;
}

export interface OpenPetsStateV1 {
  readonly version: 1;
  readonly preferences: {
    readonly defaultPetId: string;
    readonly openDefaultPetOnLaunch: boolean;
    readonly locale: LocalePreference;
    readonly appearanceTheme: AppearanceTheme;
    readonly speechBubblesEnabled: boolean;
    readonly petScale: number;
    readonly hudScale: number;
    readonly waitingAnimationDurationMs: WaitingAnimationDurationMs;
    /** Whether idle V2 pets follow the global cursor. Defaults to true. */
    readonly idleCursorGazeEnabled: boolean;
    readonly reactionAnimationOverrides?: ReactionAnimationOverrides;
    readonly onboardingCompleted: boolean;
    readonly claudeCommandPath?: string;
    readonly nodeCommandPath?: string;
    readonly opencodeCommandPath?: string;
    readonly openclawCommandPath?: string;
    /** Ordered pool of pet IDs for sequential session assignment. Slot 0 is the primary pet.
     * When set (non-empty), no-pet sessions claim the next available slot before falling back to random.
     * Undefined / empty = legacy shared-default behaviour unchanged. */
    readonly petPoolOrder?: readonly string[];
    /** Master toggle for the ordered pet-pool assignment feature. When false,
     * the pool is ignored entirely and no-pet sessions use the legacy shared default pet,
     * even if petPoolOrder is configured. Defaults to true. Platform-independent
     * (works on macOS/Windows/Linux). */
    readonly petPoolEnabled: boolean;
    /** Global toggle for window-confinement. When true (default), session-bound pets are
     * confined to their terminal window. When false, all pets free-roam regardless of
     * whether a terminal window is tracked. Platform-independent. */
    readonly petConfinementEnabled: boolean;
    /** Global toggle for cross-display roaming. When true, pets may move
     * freely across all displays. When false, pets are confined to a single display.
     * Defaults to false.
     * Platform-independent kill-switch for the cross-display feature. */
    readonly petCrossDisplayEnabled: boolean;
    /** Host-level gravity toggle. When true, pets fall with physics on every registered
     * pet (default + agent). When false (default), no gravity is applied — the
     * Walkabout plugin's per-session physics path governs gravity instead. */
    readonly petGravityEnabled: boolean;
    /** Owner-authored communication preferences for the host Pet Assistant. */
    readonly personality: PetAssistantPersonality;
     /** Canonical Electron accelerator used to start the bounded Talk session. */
     readonly voiceAssistantShortcut: string;
     /** Opaque browser-scoped microphone device id used by future voice operations. */
     readonly preferredVoiceInputDeviceId: string | null;
     /** Opaque browser-scoped output device id reserved for future controllable audio paths. */
     readonly preferredVoiceOutputDeviceId: string | null;
    /** Canonical Electron accelerator that toggles the compact pet chat composer; empty disables it. */
    readonly chatShortcut: string;
    /** Canonical Electron accelerator that hides/shows the default pet; empty disables it. */
    readonly petToggleShortcut: string;
    /** Show the chat launcher button on the default pet. */
    readonly showChatButton: boolean;
    /** Show the talk (voice) button on the default pet. */
    readonly showTalkButton: boolean;
    /** Which top corner of the pet the assistant buttons sit in. */
    readonly petButtonsPosition: PetButtonsPosition;
    /** Render size of the assistant buttons. */
    readonly petButtonsSize: PetButtonsSize;
    /** Per-pet horizontal flip (mirroring) state. Persisted per pet ID. */
    readonly petHorizontalFlip?: Readonly<Record<string, boolean>>;
  };
  readonly pets: {
    readonly installed: readonly InstalledPetState[];
  };
  readonly defaultPet: DefaultPetPositionState;
  readonly activity: OpenPetsActivityState;
}

/** Local dashboard activity counters (not remote telemetry). */
export interface OpenPetsActivityState {
  readonly messagesSent: number;
  readonly reactionsSent: number;
  readonly reactionCounts: Record<OpenPetsReaction, number>;
  readonly perPetActivityCounts: Record<string, number>;
  readonly lastActivityAt?: number;
}

export type OpenPetsActivityRecord =
  | { readonly kind: "say"; readonly reaction?: OpenPetsReaction; readonly petId?: string; readonly surface?: "default" | "agent" }
  | { readonly kind: "react"; readonly reaction: OpenPetsReaction; readonly petId?: string; readonly surface?: "default" | "agent" };

export { defaultAppearanceTheme, defaultHudScale, defaultIdleCursorGazeEnabled, defaultPetButtonsPosition, defaultPetButtonsSize, defaultPetScale, defaultWaitingAnimationDurationMs, getHudScaleForPetScale, normalizeAppearanceTheme, normalizeHudScale, normalizeIdleCursorGazeEnabled, normalizePetButtonsPosition, normalizePetButtonsSize, normalizePetHorizontalFlip, normalizePetScale, normalizeWaitingAnimationDurationMs, hudScaleOptions, petScaleOptions, waitingAnimationDurationOptions, type AppearanceTheme, type HudScaleValue, type PetButtonsPosition, type PetButtonsSize, type PetScaleValue, type WaitingAnimationDurationMs };
export { defaultPetAssistantPersonality, normalizePetAssistantPersonality, resolveCompanionDisplayName, type PetAssistantPersonality, type PetAssistantPersonalityPatch } from "./pet-assistant-personality.js";

export type OpenPetsPreferencePatch = Omit<Partial<OpenPetsStateV1["preferences"]>, "personality"> & {
  readonly personality?: PetAssistantPersonalityPatch;
};

const stateFileName = "openpets-state.json";
const directInstallLockName = ".install-pet.lock";
const directInstallLockStaleMs = 10 * 60 * 1000;
let statePath: string | null = null;
let currentState: OpenPetsStateV1 | null = null;
let startupInstallLockPath: string | null = null;

export function initializeAppState(): void {
  const userDataPath = app.getPath("userData");
  startupInstallLockPath = acquireStartupInstallLock(userDataPath);

  statePath = join(userDataPath, stateFileName);
  const nextState = normalizeState(readStateFile(statePath));
  writeStateToDisk(nextState);
  currentState = nextState;
  console.log(`OpenPets state initialized at ${statePath}.`);
}

export function releaseStartupInstallLock(): void {
  const lockPath = startupInstallLockPath;
  startupInstallLockPath = null;
  if (lockPath) rmSync(lockPath, { recursive: true, force: true });
}

export function getAppStateSnapshot(): OpenPetsStateV1 {
  return cloneState(getInitializedState());
}

export function updatePreferences(patch: OpenPetsPreferencePatch): OpenPetsStateV1 {
  const state = getInitializedState();
  const preferences = normalizePreferences({
    ...state.preferences,
    ...patch,
    personality: patch.personality === undefined
      ? state.preferences.personality
      : mergePetAssistantPersonality(state.preferences.personality, patch.personality),
  });

  const nextState = normalizeState({
    ...state,
    preferences,
  });

  commitState(nextState);
  return getAppStateSnapshot();
}

export function isOnboardingCompleted(): boolean {
  return getInitializedState().preferences.onboardingCompleted;
}

export function completeOnboarding(): OpenPetsStateV1 {
  const state = getInitializedState();
  const nextState = normalizeState(markOnboardingCompleted(state));
  commitState(nextState);
  return getAppStateSnapshot();
}

export function setDefaultPet(defaultPetId: string): OpenPetsStateV1 {
  const state = getInitializedState();
  const targetPet = state.pets.installed.find((pet) => pet.id === defaultPetId);

  if (!targetPet) {
    throw new Error(`Cannot set unknown pet as default: ${defaultPetId}`);
  }

  if (targetPet.broken) {
    throw new Error(`Cannot set broken pet as default: ${defaultPetId}`);
  }

  const nextState = normalizeState({
    ...state,
    preferences: {
      ...state.preferences,
      defaultPetId,
    },
  });

  commitState(nextState);
  return getAppStateSnapshot();
}

export function isPetFlippedHorizontally(petId: string): boolean {
  return Boolean(getInitializedState().preferences.petHorizontalFlip?.[petId]);
}

export function togglePetHorizontalFlip(petId: string): boolean {
  const state = getInitializedState();
  const nextFlip = togglePetHorizontalFlipMap(state.preferences.petHorizontalFlip, petId);
  commitState(normalizeState({
    ...state,
    preferences: normalizePreferences({
      ...state.preferences,
      petHorizontalFlip: nextFlip,
    }),
  }));
  return Boolean(nextFlip?.[petId]);
}

/**
 * Replace the entire pet-pool order with a new list.
 * Duplicate / unsafe IDs are removed during normalisation.
 * Pass an empty array (or undefined) to clear the pool and revert to legacy behaviour.
 */
export function setPetPoolOrder(ids: readonly string[]): OpenPetsStateV1 {
  const nextState = normalizeState({
    ...getInitializedState(),
    preferences: {
      ...getInitializedState().preferences,
      petPoolOrder: normalizePetPoolOrder(ids),
    },
  });
  commitState(nextState);
  return getAppStateSnapshot();
}

export function getDefaultPetPositionState(): DefaultPetPositionState {
  const defaultPet = getInitializedState().defaultPet;
  const perMonitorPositions = defaultPet.perMonitorPositions
    ? Object.fromEntries(
      Object.entries(defaultPet.perMonitorPositions).map(([key, position]) => [key, { ...position }]),
    )
    : undefined;

  return {
    ...(defaultPet.position ? { position: { ...defaultPet.position } } : {}),
    ...(perMonitorPositions ? { perMonitorPositions } : {}),
  };
}

/** Persist the flat fallback and monitor-specific position as one state update. */
export function recordDefaultPetPosition(position: unknown, displayKey: unknown): OpenPetsStateV1 {
  const state = getInitializedState();
  const normalizedPosition = normalizePosition(position);
  if (!normalizedPosition) return getAppStateSnapshot();

  const nextState = normalizeState({
    ...state,
    defaultPet: recordDefaultPetPositionState(state.defaultPet, normalizedPosition, displayKey),
  });

  commitState(nextState);
  return getAppStateSnapshot();
}

/** Persist a replacement flat position while clearing monitor-specific history. */
export function resetDefaultPetPosition(position: unknown): OpenPetsStateV1 {
  const state = getInitializedState();
  const normalizedPosition = normalizePosition(position);
  if (!normalizedPosition) return getAppStateSnapshot();

  const nextState = normalizeState({
    ...state,
    defaultPet: resetDefaultPetPositionState(normalizedPosition),
  });

  commitState(nextState);
  return getAppStateSnapshot();
}

export function getPetGravityEnabled(): boolean {
  return getInitializedState().preferences.petGravityEnabled;
}

export function setPetGravityEnabled(value: boolean): OpenPetsStateV1 {
  return updatePreferences({ petGravityEnabled: value });
}

export function recordOpenPetsActivity(activity: OpenPetsActivityRecord, now: number = Date.now()): OpenPetsStateV1 {
  publishPluginAgentActivity({ kind: activity.kind, reaction: activity.reaction, petId: activity.petId, surface: activity.surface });
  const state = getInitializedState();
  const current = state.activity;
  const reaction = activity.kind === "react" ? activity.reaction : activity.reaction;
  const petId = activity.petId;
  const nextState = normalizeState({
    ...state,
    activity: {
      messagesSent: current.messagesSent + (activity.kind === "say" ? 1 : 0),
      reactionsSent: current.reactionsSent + (reaction ? 1 : 0),
      reactionCounts: reaction
        ? { ...current.reactionCounts, [reaction]: (current.reactionCounts[reaction] ?? 0) + 1 }
        : current.reactionCounts,
      perPetActivityCounts: petId
        ? { ...current.perPetActivityCounts, [petId]: (current.perPetActivityCounts[petId] ?? 0) + 1 }
        : current.perPetActivityCounts,
      lastActivityAt: normalizeTimestamp(now) ?? Date.now(),
    },
  });

  commitState(nextState);
  return getAppStateSnapshot();
}

export function installPetState(pet: Omit<InstalledPetState, "builtIn" | "protected" | "installed">): OpenPetsStateV1 {
  const state = getInitializedState();

  if (state.pets.installed.some((installedPet) => installedPet.id === pet.id)) {
    throw new Error(`Pet is already installed: ${pet.id}`);
  }

  const nextState = normalizeState({
    ...state,
    pets: {
      installed: [
        ...state.pets.installed,
        {
          ...pet,
          builtIn: false,
          protected: false,
          installed: true,
        },
      ],
    },
  });

  commitState(nextState);
  return getAppStateSnapshot();
}

export function upsertPetState(pet: Omit<InstalledPetState, "builtIn" | "protected" | "installed">): OpenPetsStateV1 {
  const state = getInitializedState();
  const nextPet: InstalledPetState = {
    ...pet,
    builtIn: false,
    protected: false,
    installed: true,
  };
  const exists = state.pets.installed.some((installedPet) => installedPet.id === pet.id);
  const nextState = normalizeState({
    ...state,
    pets: {
      installed: exists
        ? state.pets.installed.map((installedPet) => installedPet.id === pet.id ? nextPet : installedPet)
        : [...state.pets.installed, nextPet],
    },
  });

  commitState(nextState);
  return getAppStateSnapshot();
}

export type TeamPetOwnership = Extract<
  NonNullable<InstalledPetState["source"]>,
  { readonly kind: "team" }
>;

export function installTeamPetState(
  pet: Omit<InstalledPetState, "builtIn" | "protected" | "installed"> & {
    readonly source: TeamPetOwnership;
  },
): OpenPetsStateV1 {
  const state = getInitializedState();
  const existing = state.pets.installed.find((installedPet) => installedPet.id === pet.id);
  if (existing && existing.source?.kind !== "team") {
    throw new Error(`A personal pet already uses this id: ${pet.id}`);
  }
  return upsertPetState(pet);
}

export function removeTeamPetState(ownership: TeamPetOwnership): OpenPetsStateV1 {
  const state = getInitializedState();
  const existing = state.pets.installed.find(
    (pet) =>
      pet.source?.kind === "team"
      && pet.source.organizationId === ownership.organizationId
      && pet.source.itemId === ownership.itemId
      && pet.source.artifactVersionId === ownership.artifactVersionId,
  );
  if (!existing) return getAppStateSnapshot();
  return removePetState(existing.id, true);
}

export function removePetState(petId: string, allowTeam = false): OpenPetsStateV1 {
  if (petId === builtInPet.id) {
    throw new Error("Built-in pet cannot be removed.");
  }

  const state = getInitializedState();
  const existing = state.pets.installed.find((pet) => pet.id === petId);

  if (!existing) {
    throw new Error(`Pet is not installed: ${petId}`);
  }
  if (!allowTeam && existing.source?.kind === "team") {
    throw new Error(
      "Team pets can only be removed by leaving the organization or by organization policy.",
    );
  }

  const nextDefaultPetId = state.preferences.defaultPetId === petId ? builtInPet.id : state.preferences.defaultPetId;

  const nextState = normalizeState({
    ...state,
    preferences: {
      ...state.preferences,
      defaultPetId: nextDefaultPetId,
    },
    pets: {
      installed: state.pets.installed.filter((pet) => pet.id !== petId),
    },
  });

  commitState(nextState);
  return getAppStateSnapshot();
}

export function markPetBroken(petId: string, brokenReason: string): OpenPetsStateV1 {
  const state = getInitializedState();

  if (petId === builtInPet.id) {
    return getAppStateSnapshot();
  }

  const nextState = normalizeState({
    ...state,
    preferences: {
      ...state.preferences,
      defaultPetId: state.preferences.defaultPetId === petId ? builtInPet.id : state.preferences.defaultPetId,
    },
    pets: {
      installed: state.pets.installed.map((pet) => pet.id === petId ? { ...pet, broken: true, brokenReason } : pet),
    },
  });

  commitState(nextState);
  return getAppStateSnapshot();
}

export function getStateFilePath(): string {
  if (!statePath) {
    throw new Error("OpenPets app state has not been initialized.");
  }

  return statePath;
}

function getInitializedState(): OpenPetsStateV1 {
  if (!currentState) {
    throw new Error("OpenPets app state has not been initialized.");
  }

  return currentState;
}

function readStateFile(path: string): unknown {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    console.error(`Failed to read OpenPets state from ${path}; using defaults.`, error);
    return undefined;
  }
}

function normalizeState(value: unknown): OpenPetsStateV1 {
  const record = isRecord(value) ? value : {};
  const defaultPetRecord = isRecord(record.defaultPet) ? record.defaultPet : {};
  const preferencesRecord = isRecord(record.preferences) ? record.preferences : {};
  const defaultState = createDefaultState();
  const defaultPet = normalizeDefaultPetPositionState(defaultPetRecord);
  const installedPets = normalizeInstalledPets(record);
  const defaultPetId = typeof preferencesRecord.defaultPetId === "string"
    && installedPets.some((pet) => pet.id === preferencesRecord.defaultPetId && !pet.broken)
    ? preferencesRecord.defaultPetId
    : builtInPet.id;

  return {
    version: 1,
    preferences: normalizePreferences({
      ...defaultState.preferences,
      ...preferencesRecord,
      defaultPetId,
    }),
    pets: {
      installed: installedPets,
    },
    defaultPet,
    activity: normalizeActivity(record.activity),
  };
}

function normalizeActivity(value: unknown): OpenPetsActivityState {
  const record = isRecord(value) ? value : {};
  return {
    messagesSent: normalizeCount(record.messagesSent),
    reactionsSent: normalizeCount(record.reactionsSent),
    reactionCounts: normalizeReactionCounts(record.reactionCounts),
    perPetActivityCounts: normalizePerPetActivityCounts(record.perPetActivityCounts),
    lastActivityAt: normalizeTimestamp(record.lastActivityAt),
  };
}

function normalizeReactionCounts(value: unknown): Record<OpenPetsReaction, number> {
  const record = isRecord(value) ? value : {};
  const counts = {} as Record<OpenPetsReaction, number>;
  for (const reaction of allowedReactions) {
    counts[reaction] = normalizeCount(record[reaction]);
  }
  return counts;
}

function normalizePerPetActivityCounts(value: unknown): Record<string, number> {
  const record = isRecord(value) ? value : {};
  const counts: Record<string, number> = {};
  for (const [petId, rawCount] of Object.entries(record)) {
    if (petId !== builtInPet.id) {
      try {
        assertSafePetId(petId);
      } catch {
        continue;
      }
    }
    const count = normalizeCount(rawCount);
    if (count > 0) counts[petId] = count;
  }
  return counts;
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function normalizePreferences(value: Partial<OpenPetsStateV1["preferences"]>): OpenPetsStateV1["preferences"] {
  const defaultState = createDefaultState();

  return {
    defaultPetId: typeof value.defaultPetId === "string" ? value.defaultPetId : builtInPet.id,
    openDefaultPetOnLaunch: typeof value.openDefaultPetOnLaunch === "boolean"
      ? value.openDefaultPetOnLaunch
      : defaultState.preferences.openDefaultPetOnLaunch,
    locale: normalizeLocalePreference(value.locale),
    appearanceTheme: normalizeAppearanceTheme(value.appearanceTheme),
    speechBubblesEnabled: true,
    petScale: normalizePetScale(value.petScale),
    hudScale: normalizeHudScale(value.hudScale),
    waitingAnimationDurationMs: normalizeWaitingAnimationDurationMs(value.waitingAnimationDurationMs),
    idleCursorGazeEnabled: normalizeIdleCursorGazeEnabled(value.idleCursorGazeEnabled, defaultState.preferences.idleCursorGazeEnabled),
    reactionAnimationOverrides: normalizeReactionAnimationOverrides(value.reactionAnimationOverrides),
    onboardingCompleted: normalizeOnboardingCompleted(value),
    claudeCommandPath: normalizeCommandPath(value.claudeCommandPath),
    nodeCommandPath: normalizeCommandPath(value.nodeCommandPath, true),
    opencodeCommandPath: normalizeCommandPath(value.opencodeCommandPath),
    openclawCommandPath: normalizeCommandPath(value.openclawCommandPath),
    petPoolOrder: normalizePetPoolOrder(value.petPoolOrder),
    petPoolEnabled: typeof value.petPoolEnabled === "boolean"
      ? value.petPoolEnabled
      : defaultState.preferences.petPoolEnabled,
    petConfinementEnabled: normalizePetConfinementEnabled(value.petConfinementEnabled, defaultState.preferences.petConfinementEnabled),
    petCrossDisplayEnabled: normalizePetCrossDisplayEnabled(value.petCrossDisplayEnabled, defaultState.preferences.petCrossDisplayEnabled),
    petGravityEnabled: normalizePetGravityEnabled(value.petGravityEnabled, defaultState.preferences.petGravityEnabled),
    personality: normalizePetAssistantPersonality(value.personality),
     voiceAssistantShortcut: value.voiceAssistantShortcut === "" ? "" : isCanonicalVoiceAssistantShortcut(value.voiceAssistantShortcut) ? value.voiceAssistantShortcut : defaultState.preferences.voiceAssistantShortcut,
     preferredVoiceInputDeviceId: normalizeVoiceDeviceId(value.preferredVoiceInputDeviceId),
     preferredVoiceOutputDeviceId: normalizeVoiceDeviceId(value.preferredVoiceOutputDeviceId),
    chatShortcut: isCanonicalVoiceAssistantShortcut(value.chatShortcut) ? value.chatShortcut : "",
    petToggleShortcut: isCanonicalVoiceAssistantShortcut(value.petToggleShortcut) ? value.petToggleShortcut : "",
    showChatButton: typeof value.showChatButton === "boolean" ? value.showChatButton : true,
    showTalkButton: typeof value.showTalkButton === "boolean" ? value.showTalkButton : true,
    petButtonsPosition: normalizePetButtonsPosition(value.petButtonsPosition),
    petButtonsSize: normalizePetButtonsSize(value.petButtonsSize),
    petHorizontalFlip: normalizePetHorizontalFlip(value.petHorizontalFlip),
  };
}

function normalizeLocalePreference(value: unknown): LocalePreference {
  if (value === "system") return "system";
  return isSupportedLocale(value) ? value : "system";
}

function normalizeCommandPath(value: unknown, requireSafeNodeCommand = false): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096 || /[\r\n\0]/.test(trimmed) || !isAbsolute(trimmed)) return undefined;
  if (process.platform === "win32" && /[&|<>^%!]/.test(trimmed)) return undefined;
  let normalized = normalize(trimmed);
  if (requireSafeNodeCommand) {
    try {
      normalized = realpathSync(trimmed);
    } catch {
      return undefined;
    }
    if (!isValidZedNodeCommand(normalized)) return undefined;
  }
  if (process.platform === "win32" && /[&|<>^%!]/.test(normalized)) return undefined;
  try {
    if (!statSync(normalized).isFile()) return undefined;
  } catch {
    return undefined;
  }
  return requireSafeNodeCommand ? trimmed : normalized;
}

function normalizeInstalledPets(value: Record<string, unknown>): InstalledPetState[] {
  const installed = isRecord(value.pets) && Array.isArray(value.pets.installed)
    ? value.pets.installed
    : [];

  const normalized = installed
    .map((pet) => normalizeInstalledPet(pet))
    .filter((pet): pet is InstalledPetState => Boolean(pet && pet.id !== builtInPet.id));

  return [builtInPet, ...normalized];
}

function normalizeInstalledPet(value: unknown): InstalledPetState | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.displayName !== "string") {
    return null;
  }

  try {
    assertSafePetId(value.id);
  } catch {
    return null;
  }

  const source = normalizeSource(value.source);
  const brokenReason = validateInstalledPetFiles(value.id, source);

  return {
    id: value.id,
    displayName: value.displayName,
    description: typeof value.description === "string" ? value.description : undefined,
    builtIn: value.id === builtInPet.id ? true : value.builtIn === true,
    protected: value.id === builtInPet.id ? true : value.protected === true,
    installed: true,
    source,
    broken: brokenReason ? true : typeof value.broken === "boolean" ? value.broken : undefined,
    brokenReason: brokenReason ?? (typeof value.brokenReason === "string" ? value.brokenReason : undefined),
  };
}

function createDefaultState(): OpenPetsStateV1 {
  return {
    version: 1,
    preferences: {
      defaultPetId: builtInPet.id,
      openDefaultPetOnLaunch: true,
      locale: "system",
      appearanceTheme: defaultAppearanceTheme,
      speechBubblesEnabled: true,
      petScale: defaultPetScale,
      hudScale: defaultHudScale,
      waitingAnimationDurationMs: defaultWaitingAnimationDurationMs,
      idleCursorGazeEnabled: defaultIdleCursorGazeEnabled,
      reactionAnimationOverrides: undefined,
      onboardingCompleted: false,
      claudeCommandPath: undefined,
      nodeCommandPath: undefined,
      opencodeCommandPath: undefined,
      openclawCommandPath: undefined,
      petPoolOrder: undefined,
      petPoolEnabled: true,
      petConfinementEnabled: true,
      petCrossDisplayEnabled: false,
      petGravityEnabled: false,
      personality: defaultPetAssistantPersonality,
      voiceAssistantShortcut: DEFAULT_VOICE_ASSISTANT_SHORTCUT,
      preferredVoiceInputDeviceId: null,
      preferredVoiceOutputDeviceId: null,
      chatShortcut: "",
      petToggleShortcut: "",
      showChatButton: true,
      showTalkButton: true,
      petButtonsPosition: defaultPetButtonsPosition,
      petButtonsSize: defaultPetButtonsSize,
      petHorizontalFlip: undefined,
    },
    pets: {
      installed: [builtInPet],
    },
    defaultPet: {},
    activity: {
      messagesSent: 0,
      reactionsSent: 0,
      reactionCounts: normalizeReactionCounts(undefined),
      perPetActivityCounts: {},
      lastActivityAt: undefined,
    },
  };
}

function commitState(nextState: OpenPetsStateV1): void {
  writeStateToDisk(nextState);
  currentState = nextState;
}

function writeStateToDisk(state: OpenPetsStateV1): void {
  const path = getStateFilePath();

  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

function validateInstalledPetFiles(petId: string, source: InstalledPetState["source"]): string | undefined {
  try {
    const dir = source?.kind === "team"
      ? getTeamPetDir(petId)
      : getInstalledPetDir(petId);
    const petJsonPath = join(dir, "pet.json");
    const spritesheetPath = join(dir, "spritesheet.webp");
    JSON.parse(readFileSync(petJsonPath, "utf8")) as unknown;
    const spritesheet = statSync(spritesheetPath);
    if (!spritesheet.isFile()) return "spritesheet.webp is not a file.";
    if (spritesheet.size <= 0) return "spritesheet.webp is empty.";
    if (spritesheet.size > 100 * 1024 * 1024) return "spritesheet.webp is too large.";
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Installed pet files are invalid.";
  }
}

function normalizeSource(value: unknown): InstalledPetState["source"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.kind === "codex" && typeof value.path === "string") {
    return { kind: "codex", path: value.path };
  }

  if (
    value.kind === "team"
    && typeof value.organizationId === "string"
    && typeof value.itemId === "string"
    && typeof value.artifactVersionId === "string"
    && typeof value.releaseId === "string"
    && [
      value.organizationId,
      value.itemId,
      value.artifactVersionId,
      value.releaseId,
    ].every((part) => /^[A-Za-z0-9._:-]{1,160}$/.test(part))
  ) {
    return {
      kind: "team",
      organizationId: value.organizationId,
      itemId: value.itemId,
      artifactVersionId: value.artifactVersionId,
      releaseId: value.releaseId,
    };
  }

  if (value.catalogVersion !== 2 || typeof value.zip !== "string" || typeof value.preview !== "string") return undefined;

  return {
    kind: "catalog",
    catalogVersion: 2,
    zip: value.zip,
    preview: value.preview,
  };
}

function cloneState(state: OpenPetsStateV1): OpenPetsStateV1 {
  return structuredClone(state) as OpenPetsStateV1;
}

function acquireStartupInstallLock(userDataPath: string): string {
  mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
  const lockPath = join(userDataPath, directInstallLockName);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      writeFileSync(join(lockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, createdAt: Date.now(), command: "openpets-startup" })}\n`, "utf8");
      return lockPath;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "EEXIST") throw error;
      if (isStaleInstallLock(lockPath)) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      throw new Error("OpenPets cannot start while a direct pet install is in progress. Wait for install-pet to finish, then reopen OpenPets.");
    }
  }
  throw new Error("Could not acquire OpenPets startup lock.");
}

function isStaleInstallLock(lockPath: string): boolean {
  try {
    const owner = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8")) as { readonly pid?: unknown; readonly createdAt?: unknown };
    if (typeof owner.createdAt === "number" && Date.now() - owner.createdAt > directInstallLockStaleMs) return true;
    if (typeof owner.pid === "number" && owner.pid > 0) return !isProcessAlive(owner.pid);
  } catch {
    // Fall back to mtime for old/partial locks.
  }
  try {
    return Date.now() - statSync(lockPath).mtimeMs > directInstallLockStaleMs;
  } catch {
    return true;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    return code === "EPERM";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
