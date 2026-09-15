import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  managerCheckInFeelingCodes,
  type ManagerCheckInPromptSnapshot,
  type ManagerCheckInSettings,
  type ManagerCheckInSubmission,
} from "./team-api-client.js";

export const managerCheckInStateFileName = "openpets-manager-check-in-state.json";
const maxSubmissions = 200;
const maxStateBytes = 512 * 1024;

export type PendingManagerCheckIn = {
  readonly clientGeneratedId: string;
  readonly feelingCode: ManagerCheckInSubmission["feelingCode"];
  readonly note: string | null;
  readonly settingsRevision: number;
};

export type ManagerCheckInLocalState = {
  readonly version: 1;
  readonly organizationId: string;
  readonly deviceId?: string;
  readonly employeeIdentityId?: string;
  readonly settings?: ManagerCheckInSettings;
  readonly submissions: readonly ManagerCheckInSubmission[];
  readonly scheduledOffersPaused: boolean;
  readonly lastWeeklyOfferWeek?: string;
  readonly lastManualSubmissionWeek?: string;
  readonly lastSyncAt?: string;
  readonly lastError?: string;
  readonly pendingSubmission?: PendingManagerCheckIn;
};

export type ManagerCheckInStateStoreOptions = {
  readonly userDataPath?: string;
  readonly statePath?: string;
};

type PersistedManagerCheckInState = Record<string, unknown> & {
  readonly organizationId: string;
  readonly submissions: readonly unknown[];
  readonly scheduledOffersPaused: boolean;
};

export class ManagerCheckInStateStore {
  readonly statePath: string;
  #state: ManagerCheckInLocalState | null;

  constructor(options: ManagerCheckInStateStoreOptions) {
    const userDataPath = options.userDataPath ?? "";
    this.statePath = options.statePath ?? join(userDataPath, managerCheckInStateFileName);
    this.#state = readState(this.statePath);
  }

  initialize(): ManagerCheckInLocalState | null {
    if (!this.#state && existsSync(this.statePath)) {
      this.#state = readState(this.statePath);
    }
    return this.snapshot();
  }

  snapshot(): ManagerCheckInLocalState | null {
    if (!this.#state) {
      return null;
    }
    return structuredClone(this.#state);
  }

  ensureOrganization(organizationId: string): ManagerCheckInLocalState {
    if (!isValidOrganizationId(organizationId)) {
      throw new Error("Manager check-in organization is invalid.");
    }
    if (this.#state?.organizationId === organizationId) {
      return this.snapshot()!;
    }

    return this.commit({
      version: 1,
      organizationId,
      submissions: [],
      scheduledOffersPaused: false,
    });
  }

  replaceFromSync(input: {
    readonly organizationId: string;
    readonly deviceId?: string;
    readonly employeeIdentityId: string;
    readonly settings: ManagerCheckInSettings;
    readonly submissions: readonly ManagerCheckInSubmission[];
    readonly scheduledOffersPaused: boolean;
    readonly syncedAt: string;
  }): ManagerCheckInLocalState {
    const current = this.#state;
    const identityChanged = current?.organizationId !== input.organizationId
      || current?.deviceId !== input.deviceId
      || current?.employeeIdentityId !== input.employeeIdentityId;
    if (identityChanged) {
      return this.commit({
        version: 1,
        organizationId: input.organizationId,
        ...optionalDeviceId(input.deviceId),
        employeeIdentityId: input.employeeIdentityId,
        settings: input.settings,
        submissions: boundSubmissions(input.submissions),
        scheduledOffersPaused: input.scheduledOffersPaused,
        lastSyncAt: input.syncedAt,
      });
    }
    return this.commit({
      ...current,
      version: 1,
      ...optionalDeviceId(input.deviceId),
      employeeIdentityId: input.employeeIdentityId,
      settings: input.settings,
      submissions: boundSubmissions(input.submissions),
      scheduledOffersPaused: input.scheduledOffersPaused,
      lastSyncAt: input.syncedAt,
      lastError: undefined,
    });
  }

  clearPendingSubmission(): ManagerCheckInLocalState {
    const current = this.require();
    const { pendingSubmission: _, ...next } = current;
    return this.commit(next);
  }

  resetBinding(input: { readonly organizationId: string; readonly deviceId?: string }): ManagerCheckInLocalState {
    return this.commit({
      version: 1,
      organizationId: input.organizationId,
      ...optionalDeviceId(input.deviceId),
      submissions: [],
      scheduledOffersPaused: false,
    });
  }

  setPendingSubmission(pendingSubmission: PendingManagerCheckIn): ManagerCheckInLocalState {
    const current = this.require();
    return this.commit({
      ...current,
      pendingSubmission,
      lastError: undefined,
    });
  }

  commitSubmission(
    submission: ManagerCheckInSubmission,
    localWeek: string,
  ): ManagerCheckInLocalState {
    const current = this.require();
    const submissions = boundSubmissions([
      submission,
      ...current.submissions.filter((item) => item.clientGeneratedId !== submission.clientGeneratedId),
    ]);
    return this.commit({
      ...current,
      submissions,
      lastManualSubmissionWeek: localWeek,
      pendingSubmission: undefined,
      lastError: undefined,
    });
  }

  setScheduledOffersPaused(paused: boolean): ManagerCheckInLocalState {
    const current = this.require();
    return this.commit({
      ...current,
      scheduledOffersPaused: paused,
      lastError: undefined,
    });
  }

  markWeeklyOfferPresented(localWeek: string): ManagerCheckInLocalState {
    const current = this.require();
    return this.commit({
      ...current,
      lastWeeklyOfferWeek: localWeek,
      lastError: undefined,
    });
  }

  setError(error: string): ManagerCheckInLocalState {
    const current = this.require();
    return this.commit({
      ...current,
      lastError: error.slice(0, 128),
    });
  }

  require(): ManagerCheckInLocalState {
    if (!this.#state) throw new Error("Manager check-in state is unavailable.");
    return this.#state;
  }

  private commit(state: ManagerCheckInLocalState): ManagerCheckInLocalState {
    const bounded = fitState(state);
    writeAtomic(this.statePath, bounded);
    this.#state = bounded;
    return this.snapshot()!;
  }
}

function boundSubmissions(submissions: readonly ManagerCheckInSubmission[]): readonly ManagerCheckInSubmission[] {
  return submissions
    .slice(0, maxSubmissions)
    .map((submission) => structuredClone(submission));
}

function hasValidStateShape(raw: Record<string, unknown>): raw is PersistedManagerCheckInState {
  if (raw.version !== 1) {
    return false;
  }
  if (typeof raw.organizationId !== "string" || !isValidOrganizationId(raw.organizationId)) {
    return false;
  }
  if (!Array.isArray(raw.submissions) || raw.submissions.length > maxSubmissions) {
    return false;
  }
  if (typeof raw.scheduledOffersPaused !== "boolean") {
    return false;
  }
  if (raw.deviceId !== undefined && !boundedString(raw.deviceId, 160)) {
    return false;
  }
  if (raw.employeeIdentityId !== undefined && !boundedString(raw.employeeIdentityId, 160)) {
    return false;
  }

  return allowedKeys(raw, [
    "version",
    "organizationId",
    "deviceId",
    "employeeIdentityId",
    "settings",
    "submissions",
    "scheduledOffersPaused",
    "lastWeeklyOfferWeek",
    "lastManualSubmissionWeek",
    "lastSyncAt",
    "lastError",
    "pendingSubmission",
  ]);
}

function readState(path: string): ManagerCheckInLocalState | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

    if (!hasValidStateShape(raw)) {
      return null;
    }

    const submissions = raw.submissions.map(readSubmission);
    const settings = raw.settings === undefined ? undefined : readSettings(raw.settings);
    const pendingSubmission = raw.pendingSubmission === undefined ? undefined : readPending(raw.pendingSubmission);
    const state: ManagerCheckInLocalState = {
      version: 1,
      organizationId: raw.organizationId,
      ...(typeof raw.deviceId === "string" ? { deviceId: raw.deviceId } : {}),
      ...(typeof raw.employeeIdentityId === "string" ? { employeeIdentityId: raw.employeeIdentityId } : {}),
      ...(settings ? { settings } : {}),
      submissions,
      scheduledOffersPaused: raw.scheduledOffersPaused,
      ...(typeof raw.lastWeeklyOfferWeek === "string" ? { lastWeeklyOfferWeek: raw.lastWeeklyOfferWeek } : {}),
      ...(typeof raw.lastManualSubmissionWeek === "string" ? { lastManualSubmissionWeek: raw.lastManualSubmissionWeek } : {}),
      ...(typeof raw.lastSyncAt === "string" ? { lastSyncAt: raw.lastSyncAt } : {}),
      ...(typeof raw.lastError === "string" ? { lastError: raw.lastError.slice(0, 128) } : {}),
      ...(pendingSubmission ? { pendingSubmission } : {}),
    };
    if (persistedByteLength(state) > maxStateBytes) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

function readSettings(value: unknown): ManagerCheckInSettings {
  if (!isRecord(value)) {
    throw new Error("Invalid manager check-in settings.");
  }
  if (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new Error("Invalid manager check-in settings.");
  }
  if (typeof value.weeklyEnabled !== "boolean") {
    throw new Error("Invalid manager check-in settings.");
  }
  if (
    typeof value.weeklyDay !== "number"
    || !Number.isInteger(value.weeklyDay)
    || value.weeklyDay < 0
    || value.weeklyDay > 6
  ) {
    throw new Error("Invalid manager check-in settings.");
  }
  if (
    !boundedString(value.title, 200)
    || !boundedString(value.introduction, 1000)
    || !boundedString(value.acknowledgement, 500)
    || !boundedString(value.notePlaceholder, 200)
  ) {
    throw new Error("Invalid manager check-in settings.");
  }
  if (!isRecord(value.labels) || !exactLabels(value.labels)) {
    throw new Error("Invalid manager check-in settings.");
  }

  const settings = value as Record<string, unknown>;
  return {
    revision: settings.revision as number,
    weeklyEnabled: settings.weeklyEnabled as boolean,
    weeklyDay: settings.weeklyDay as number,
    title: settings.title as string,
    introduction: settings.introduction as string,
    acknowledgement: settings.acknowledgement as string,
    notePlaceholder: settings.notePlaceholder as string,
    labels: settings.labels as ManagerCheckInSettings["labels"],
  };
}

function readSubmission(value: unknown): ManagerCheckInSubmission {
  if (!isRecord(value)) {
    throw new Error("Invalid manager check-in submission.");
  }
  if (!boundedString(value.id, 160) || !boundedString(value.clientGeneratedId, 128)) {
    throw new Error("Invalid manager check-in submission.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.clientGeneratedId)) {
    throw new Error("Invalid manager check-in submission.");
  }
  if (!managerCheckInFeelingCodes.includes(value.feelingCode as ManagerCheckInSubmission["feelingCode"])) {
    throw new Error("Invalid manager check-in submission.");
  }
  if (value.note !== null && typeof value.note !== "string") {
    throw new Error("Invalid manager check-in submission.");
  }
  if (typeof value.note === "string" && value.note.length > 1000) {
    throw new Error("Invalid manager check-in submission.");
  }
  if (
    !boundedString(value.submittedAt, 64)
    || typeof value.settingsRevision !== "number"
    || !Number.isSafeInteger(value.settingsRevision)
    || value.settingsRevision < 0
  ) {
    throw new Error("Invalid manager check-in submission.");
  }
  if (!isRecord(value.promptSnapshot)) {
    throw new Error("Invalid manager check-in submission.");
  }

  const promptSnapshot = readPromptSnapshot(value.promptSnapshot);
  const submission = value as Record<string, unknown>;
  return {
    id: submission.id as string,
    clientGeneratedId: submission.clientGeneratedId as string,
    feelingCode: submission.feelingCode as ManagerCheckInSubmission["feelingCode"],
    note: submission.note as string | null,
    submittedAt: submission.submittedAt as string,
    settingsRevision: submission.settingsRevision as number,
    promptSnapshot,
  };
}

function readPromptSnapshot(value: unknown): ManagerCheckInPromptSnapshot {
  if (!isRecord(value)) {
    throw new Error("Invalid manager check-in prompt snapshot.");
  }
  if (
    !boundedString(value.title, 200)
    || !boundedString(value.introduction, 1000)
    || !boundedString(value.acknowledgement, 500)
    || !boundedString(value.notePlaceholder, 200)
  ) {
    throw new Error("Invalid manager check-in prompt snapshot.");
  }
  if (!isRecord(value.labels) || !exactLabels(value.labels)) {
    throw new Error("Invalid manager check-in prompt snapshot.");
  }
  if (
    !isRecord(value.visibilityNotice)
    || value.visibilityNotice.version !== 1
    || !boundedString(value.visibilityNotice.text, 500)
  ) {
    throw new Error("Invalid manager check-in prompt snapshot.");
  }

  const snapshot = value as Record<string, unknown>;
  const notice = snapshot.visibilityNotice as Record<string, unknown>;
  return {
    title: snapshot.title as string,
    introduction: snapshot.introduction as string,
    acknowledgement: snapshot.acknowledgement as string,
    notePlaceholder: snapshot.notePlaceholder as string,
    labels: snapshot.labels as ManagerCheckInPromptSnapshot["labels"],
    visibilityNotice: {
      version: 1,
      text: notice.text as string,
    },
  };
}

function readPending(value: unknown): ManagerCheckInLocalState["pendingSubmission"] {
  if (!isRecord(value)) {
    throw new Error("Invalid pending manager check-in.");
  }
  if (
    typeof value.clientGeneratedId !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.clientGeneratedId)
  ) {
    throw new Error("Invalid pending manager check-in.");
  }
  if (!managerCheckInFeelingCodes.includes(value.feelingCode as PendingManagerCheckIn["feelingCode"])) {
    throw new Error("Invalid pending manager check-in.");
  }
  if (value.note !== null && typeof value.note !== "string") {
    throw new Error("Invalid pending manager check-in.");
  }
  if (typeof value.note === "string" && value.note.length > 1000) {
    throw new Error("Invalid pending manager check-in.");
  }
  if (
    typeof value.settingsRevision !== "number"
    || !Number.isSafeInteger(value.settingsRevision)
    || value.settingsRevision < 0
  ) {
    throw new Error("Invalid pending manager check-in.");
  }

  return {
    clientGeneratedId: value.clientGeneratedId,
    feelingCode: value.feelingCode as PendingManagerCheckIn["feelingCode"],
    note: value.note as string | null,
    settingsRevision: value.settingsRevision,
  };
}

function exactLabels(value: Record<string, unknown>): boolean {
  const keys = ["good", "steady", "stretched", "struggling", "need_support"];
  if (Object.keys(value).length !== keys.length) {
    return false;
  }
  return keys.every((key) => boundedString(value[key], 80));
}

function isValidOrganizationId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
}

function optionalDeviceId(deviceId: string | undefined): { readonly deviceId?: string } {
  if (deviceId === undefined) {
    return {};
  }
  return { deviceId };
}

function boundedString(value: unknown, max: number): value is string {
  if (typeof value !== "string") {
    return false;
  }
  return value.length > 0 && value.length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return !Array.isArray(value);
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.every((key) => keys.includes(key));
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(tempPath, serialized, { mode: 0o600 });
  renameSync(tempPath, path);
}

function fitState(state: ManagerCheckInLocalState): ManagerCheckInLocalState {
  const submissions = [...state.submissions];
  while (submissions.length > 0 && persistedByteLength({ ...state, submissions }) > maxStateBytes) {
    submissions.pop();
  }
  const bounded = { ...state, submissions };
  if (persistedByteLength(bounded) > maxStateBytes) {
    throw new Error("Manager check-in state metadata exceeds its storage limit.");
  }
  return bounded;
}

function persistedByteLength(value: unknown): number {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  return Buffer.byteLength(serialized, "utf8");
}
