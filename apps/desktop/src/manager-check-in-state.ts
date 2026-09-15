import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type {
  ManagerCheckInPromptSnapshot,
  ManagerCheckInSettings,
  ManagerCheckInSubmission,
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

export class ManagerCheckInStateStore {
  readonly statePath: string;
  #state: ManagerCheckInLocalState | null;

  constructor(options: ManagerCheckInStateStoreOptions) {
    this.statePath = options.statePath ?? join(options.userDataPath ?? "", managerCheckInStateFileName);
    this.#state = readState(this.statePath);
  }

  initialize(): ManagerCheckInLocalState | null {
    if (!this.#state && existsSync(this.statePath)) this.#state = readState(this.statePath);
    return this.snapshot();
  }

  snapshot(): ManagerCheckInLocalState | null {
    return this.#state ? structuredClone(this.#state) : null;
  }

  ensureOrganization(organizationId: string): ManagerCheckInLocalState {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(organizationId)) throw new Error("Manager check-in organization is invalid.");
    if (this.#state?.organizationId === organizationId) return this.snapshot()!;
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
        ...(input.deviceId ? { deviceId: input.deviceId } : {}),
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
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
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
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      submissions: [],
      scheduledOffersPaused: false,
    });
  }

  setPendingSubmission(pendingSubmission: PendingManagerCheckIn): ManagerCheckInLocalState {
    const current = this.require();
    return this.commit({ ...current, pendingSubmission, lastError: undefined });
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
    return this.commit({ ...current, scheduledOffersPaused: paused, lastError: undefined });
  }

  markWeeklyOfferPresented(localWeek: string): ManagerCheckInLocalState {
    const current = this.require();
    return this.commit({ ...current, lastWeeklyOfferWeek: localWeek, lastError: undefined });
  }

  setError(error: string): ManagerCheckInLocalState {
    const current = this.require();
    return this.commit({ ...current, lastError: error.slice(0, 128) });
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
  const selected = submissions.slice(0, maxSubmissions).map((submission) => structuredClone(submission));
  return selected;
}

function readState(path: string): ManagerCheckInLocalState | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (
      raw.version !== 1
      || typeof raw.organizationId !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(raw.organizationId)
      || !Array.isArray(raw.submissions)
      || raw.submissions.length > maxSubmissions
      || typeof raw.scheduledOffersPaused !== "boolean"
      || (raw.deviceId !== undefined && !boundedString(raw.deviceId, 160))
      || (raw.employeeIdentityId !== undefined && !boundedString(raw.employeeIdentityId, 160))
      || !allowedKeys(raw, ["version", "organizationId", "deviceId", "employeeIdentityId", "settings", "submissions", "scheduledOffersPaused", "lastWeeklyOfferWeek", "lastManualSubmissionWeek", "lastSyncAt", "lastError", "pendingSubmission"])
    ) return null;
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
    if (persistedByteLength(state) > maxStateBytes) return null;
    return state;
  } catch {
    return null;
  }
}

function readSettings(value: unknown): ManagerCheckInSettings {
  if (!isRecord(value) || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.weeklyEnabled !== "boolean" || typeof value.weeklyDay !== "number" || !Number.isInteger(value.weeklyDay) || value.weeklyDay < 0 || value.weeklyDay > 6 || !boundedString(value.title, 200) || !boundedString(value.introduction, 1000) || !boundedString(value.acknowledgement, 500) || !boundedString(value.notePlaceholder, 200) || !isRecord(value.labels) || !exactLabels(value.labels)) throw new Error("Invalid manager check-in settings.");
  const settings = value as Record<string, unknown>;
  return { revision: settings.revision as number, weeklyEnabled: settings.weeklyEnabled as boolean, weeklyDay: settings.weeklyDay as number, title: settings.title as string, introduction: settings.introduction as string, acknowledgement: settings.acknowledgement as string, notePlaceholder: settings.notePlaceholder as string, labels: settings.labels as ManagerCheckInSettings["labels"] };
}

function readSubmission(value: unknown): ManagerCheckInSubmission {
  if (!isRecord(value) || !boundedString(value.id, 160) || !boundedString(value.clientGeneratedId, 128) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.clientGeneratedId) || !["good", "steady", "stretched", "struggling", "need_support"].includes(value.feelingCode as string) || (value.note !== null && !boundedString(value.note, 1000)) || !boundedString(value.submittedAt, 64) || typeof value.settingsRevision !== "number" || !Number.isSafeInteger(value.settingsRevision) || value.settingsRevision < 0 || !isRecord(value.promptSnapshot)) throw new Error("Invalid manager check-in submission.");
  const promptSnapshot = readPromptSnapshot(value.promptSnapshot);
  const submission = value as Record<string, unknown>;
  return { id: submission.id as string, clientGeneratedId: submission.clientGeneratedId as string, feelingCode: submission.feelingCode as ManagerCheckInSubmission["feelingCode"], note: submission.note as string | null, submittedAt: submission.submittedAt as string, settingsRevision: submission.settingsRevision as number, promptSnapshot };
}

function readPromptSnapshot(value: unknown): ManagerCheckInPromptSnapshot {
  if (!isRecord(value) || !boundedString(value.title, 200) || !boundedString(value.introduction, 1000) || !boundedString(value.acknowledgement, 500) || !boundedString(value.notePlaceholder, 200) || !isRecord(value.labels) || !exactLabels(value.labels) || !isRecord(value.visibilityNotice) || value.visibilityNotice.version !== 1 || !boundedString(value.visibilityNotice.text, 500)) throw new Error("Invalid manager check-in prompt snapshot.");
  const snapshot = value as Record<string, unknown>;
  const notice = snapshot.visibilityNotice as Record<string, unknown>;
  return { title: snapshot.title as string, introduction: snapshot.introduction as string, acknowledgement: snapshot.acknowledgement as string, notePlaceholder: snapshot.notePlaceholder as string, labels: snapshot.labels as ManagerCheckInPromptSnapshot["labels"], visibilityNotice: { version: 1, text: notice.text as string } };
}

function readPending(value: unknown): ManagerCheckInLocalState["pendingSubmission"] {
  if (!isRecord(value) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.clientGeneratedId as string) || !["good", "steady", "stretched", "struggling", "need_support"].includes(value.feelingCode as string) || (value.note !== null && typeof value.note !== "string") || (typeof value.note === "string" && value.note.length > 1000) || typeof value.settingsRevision !== "number" || !Number.isSafeInteger(value.settingsRevision) || value.settingsRevision < 0) throw new Error("Invalid pending manager check-in.");
  return { clientGeneratedId: value.clientGeneratedId as string, feelingCode: value.feelingCode as PendingManagerCheckIn["feelingCode"], note: value.note as string | null, settingsRevision: value.settingsRevision as number };
}

function exactLabels(value: Record<string, unknown>): boolean {
  const keys = ["good", "steady", "stretched", "struggling", "need_support"];
  return Object.keys(value).length === keys.length && keys.every((key) => boundedString(value[key], 80));
}
function boundedString(value: unknown, max: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= max; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function allowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function writeAtomic(path: string, value: unknown): void { mkdirSync(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.tmp`; writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); renameSync(temp, path); }

function fitState(state: ManagerCheckInLocalState): ManagerCheckInLocalState {
  const submissions = [...state.submissions];
  while (submissions.length > 0 && persistedByteLength({ ...state, submissions }) > maxStateBytes) submissions.pop();
  const bounded = { ...state, submissions };
  if (persistedByteLength(bounded) > maxStateBytes) throw new Error("Manager check-in state metadata exceeds its storage limit.");
  return bounded;
}

function persistedByteLength(value: unknown): number { return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
