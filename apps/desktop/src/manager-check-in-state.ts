import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  ManagerCheckInSchedule,
  ManagerCheckInScheduleSnapshot,
  ManagerCheckInSubmission,
  ManagerCheckInSubmissionInput,
  ManagerCheckInFeelingCode,
} from "./team-api-client.js";
import { managerCheckInFeelingCodes } from "./team-api-client.js";
import type { ManagerCheckInRecurrence } from "./manager-check-in-schedule.js";

export const managerCheckInStateFileName = "openpets-manager-check-in-state.json";
const maxSubmissions = 200;
const maxCycleIds = 512;
const maxStateBytes = 512 * 1024;

export type PendingManagerCheckIn = ManagerCheckInSubmissionInput & {
  readonly receipt?: string;
  readonly receiptExpiresAt?: string;
};

export type ManagerCheckInLocalState = {
  readonly version: 2;
  readonly organizationId: string;
  readonly deviceId?: string;
  readonly employeeIdentityId?: string;
  readonly schedules: readonly ManagerCheckInSchedule[];
  readonly visibilityNotice?: { readonly version: 1; readonly text: string };
  readonly submissions: readonly ManagerCheckInSubmission[];
  readonly nudgeCycleIds: readonly string[];
  readonly committedCycleIds: readonly string[];
  readonly devicePaused: boolean;
  readonly lastSyncAt?: string;
  readonly lastError?: string;
  readonly pendingSubmission?: PendingManagerCheckIn;
};

export type ManagerCheckInStateStoreOptions = {
  readonly userDataPath?: string;
  readonly statePath?: string;
};

export function isUsablePendingManagerCheckIn(value: unknown): value is PendingManagerCheckIn {
  return readPending(value) !== null;
}

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
    if (!isValidId(organizationId)) throw new Error("Manager check-in organization is invalid.");
    if (this.#state?.organizationId === organizationId) return this.snapshot()!;
    return this.commit({
      version: 2,
      organizationId,
      schedules: [],
      submissions: [],
      nudgeCycleIds: [],
      committedCycleIds: [],
      devicePaused: this.#state?.devicePaused ?? false,
    });
  }

  replaceFromSync(input: {
    readonly organizationId: string;
    readonly deviceId: string;
    readonly employeeIdentityId: string;
    readonly schedules: readonly ManagerCheckInSchedule[];
    readonly visibilityNotice: { readonly version: 1; readonly text: string };
    readonly submissions: readonly ManagerCheckInSubmission[];
    readonly syncedAt: string;
  }): ManagerCheckInLocalState {
    if (!input.schedules.every((value) => readSchedule(value) !== null)
      || !input.submissions.every((value) => readSubmission(value) !== null)) {
      throw new Error("Manager check-in sync state is invalid.");
    }
    const current = this.#state;
    const sameBinding = current?.organizationId === input.organizationId
      && current.deviceId === input.deviceId
      && current.employeeIdentityId === input.employeeIdentityId;
    const committed = new Set<string>(sameBinding ? current?.committedCycleIds ?? [] : []);
    for (const submission of input.submissions) committed.add(submission.cycleId);
    const retainedNudges = new Set<string>(sameBinding ? current?.nudgeCycleIds ?? [] : []);
    const pending = sameBinding && current?.pendingSubmission
      ? current.pendingSubmission
      : undefined;
    const validPending = pending && readPending(pending) ? pending : undefined;
    return this.commit({
      version: 2,
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      employeeIdentityId: input.employeeIdentityId,
      schedules: input.schedules,
      visibilityNotice: input.visibilityNotice,
      submissions: boundSubmissions(input.submissions),
      nudgeCycleIds: boundIds([...retainedNudges]),
      committedCycleIds: boundIds([...committed]),
      devicePaused: sameBinding ? current?.devicePaused ?? false : current?.devicePaused ?? false,
      lastSyncAt: input.syncedAt,
      ...(validPending ? { pendingSubmission: validPending } : {}),
    });
  }

  resetBinding(input: { readonly organizationId: string; readonly deviceId?: string }): ManagerCheckInLocalState {
    return this.commit({
      version: 2,
      organizationId: input.organizationId,
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      schedules: [],
      submissions: [],
      nudgeCycleIds: [],
      committedCycleIds: [],
      devicePaused: this.#state?.devicePaused ?? false,
    });
  }

  setPendingSubmission(pendingSubmission: PendingManagerCheckIn): ManagerCheckInLocalState {
    if (!readPending(pendingSubmission)) throw new Error("Manager check-in pending submission is invalid.");
    const current = this.require();
    return this.commit({ ...current, pendingSubmission, lastError: undefined });
  }

  clearPendingSubmission(): ManagerCheckInLocalState {
    const current = this.require();
    const { pendingSubmission: _, ...next } = current;
    return this.commit(next);
  }

  markNudgePresented(cycleId: string): ManagerCheckInLocalState {
    const current = this.require();
    return this.commit({ ...current, nudgeCycleIds: boundIds([...current.nudgeCycleIds, cycleId]), lastError: undefined });
  }

  commitSubmission(submission: ManagerCheckInSubmission): ManagerCheckInLocalState {
    if (!readSubmission(submission)) throw new Error("Manager check-in submission is invalid.");
    const current = this.require();
    const { pendingSubmission: _, ...withoutPending } = current;
    return this.commit({
      ...withoutPending,
      submissions: boundSubmissions([
        submission,
        ...current.submissions.filter((item) => item.clientGeneratedId !== submission.clientGeneratedId),
      ]),
      committedCycleIds: boundIds([...current.committedCycleIds, submission.cycleId]),
      lastError: undefined,
    });
  }

  setDevicePaused(paused: boolean): ManagerCheckInLocalState {
    const current = this.require();
    return this.commit({ ...current, devicePaused: paused, lastError: undefined });
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

function readState(path: string): ManagerCheckInLocalState | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (raw.version === 1) {
      const migrated = migrateV1(raw);
      if (migrated) writeAtomic(path, migrated);
      return migrated;
    }
    if (raw.version !== 2 || !hasOnlyKeys(raw, ["version", "organizationId", "deviceId", "employeeIdentityId", "schedules", "visibilityNotice", "submissions", "nudgeCycleIds", "committedCycleIds", "devicePaused", "lastSyncAt", "lastError", "pendingSubmission"]) || typeof raw.organizationId !== "string" || !isValidId(raw.organizationId)) return null;
    if (!Array.isArray(raw.schedules) || !Array.isArray(raw.submissions) || !Array.isArray(raw.nudgeCycleIds) || !Array.isArray(raw.committedCycleIds) || typeof raw.devicePaused !== "boolean") return null;
    const schedules = raw.schedules.map(readSchedule);
    const submissions = raw.submissions.map(readSubmission);
    const pending = readPending(raw.pendingSubmission);
    if (!schedules.every((value): value is ManagerCheckInSchedule => value !== null)
      || !submissions.every((value): value is ManagerCheckInSubmission => value !== null)
      || !raw.nudgeCycleIds.every(isCycleId)
      || !raw.committedCycleIds.every(isCycleId)) return null;
    const state: ManagerCheckInLocalState = {
      version: 2,
      organizationId: raw.organizationId,
      ...(boundedString(raw.deviceId, 160) ? { deviceId: raw.deviceId } : {}),
      ...(boundedString(raw.employeeIdentityId, 160) ? { employeeIdentityId: raw.employeeIdentityId } : {}),
      schedules,
      ...(isNotice(raw.visibilityNotice) ? { visibilityNotice: raw.visibilityNotice } : {}),
      submissions,
      nudgeCycleIds: raw.nudgeCycleIds,
      committedCycleIds: raw.committedCycleIds,
      devicePaused: raw.devicePaused,
      ...(boundedString(raw.lastSyncAt, 64) ? { lastSyncAt: raw.lastSyncAt } : {}),
      ...(typeof raw.lastError === "string" && raw.lastError.length > 0 ? { lastError: raw.lastError.slice(0, 128) } : {}),
      ...(pending ? { pendingSubmission: pending } : {}),
    };
    if (persistedByteLength(state) > maxStateBytes) return null;
    if (raw.pendingSubmission !== undefined && !pending) writeAtomic(path, state);
    return state;
  } catch {
    return null;
  }
}

function migrateV1(raw: Record<string, unknown>): ManagerCheckInLocalState | null {
  if (typeof raw.organizationId !== "string" || !isValidId(raw.organizationId) || typeof raw.scheduledOffersPaused !== "boolean") return null;
  const migrated: ManagerCheckInLocalState = {
    version: 2,
    organizationId: raw.organizationId,
    ...(boundedString(raw.deviceId, 160) ? { deviceId: raw.deviceId } : {}),
    ...(boundedString(raw.employeeIdentityId, 160) ? { employeeIdentityId: raw.employeeIdentityId } : {}),
    schedules: [],
    submissions: [],
    nudgeCycleIds: [],
    committedCycleIds: [],
    devicePaused: raw.scheduledOffersPaused,
  };
  return migrated;
}

function readSchedule(value: unknown): ManagerCheckInSchedule | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["id", "revision", "name", "enabled", "recurrence", "title", "introduction", "acknowledgement", "notePlaceholder", "labels"])
    || !isId(value.id)
    || !isNonNegativeInteger(value.revision)
    || !boundedString(value.name, 60)
    || typeof value.enabled !== "boolean"
    || !boundedString(value.title, 200)
    || !boundedString(value.introduction, 1000)
    || !boundedString(value.acknowledgement, 500)
    || !boundedString(value.notePlaceholder, 200)
    || !readLabels(value.labels)
  ) return null;
  const recurrence = readRecurrence(value.recurrence);
  const labels = readLabels(value.labels);
  if (!recurrence || !labels) return null;
  return {
    id: value.id,
    revision: value.revision,
    name: value.name,
    enabled: value.enabled,
    recurrence,
    title: value.title,
    introduction: value.introduction,
    acknowledgement: value.acknowledgement,
    notePlaceholder: value.notePlaceholder,
    labels,
  };
}

function readSubmission(value: unknown): ManagerCheckInSubmission | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["id", "clientGeneratedId", "scheduleId", "scheduleRevision", "cycleId", "cycleLocalDate", "feelingCode", "note", "submittedAt", "scheduleSnapshot"])
    || !boundedString(value.id, 160)
    || !isClientId(value.clientGeneratedId)
    || !isId(value.scheduleId)
    || !isNonNegativeInteger(value.scheduleRevision)
    || !isDate(value.cycleLocalDate)
    || value.cycleId !== `${value.scheduleId}:${value.cycleLocalDate}`
    || !isFeelingCode(value.feelingCode)
    || value.note !== null && !(typeof value.note === "string" && value.note.length <= 500)
    || !boundedString(value.submittedAt, 64)
    || !readScheduleSnapshot(value.scheduleSnapshot)
  ) return null;
  const scheduleSnapshot = readScheduleSnapshot(value.scheduleSnapshot);
  if (!scheduleSnapshot) return null;
  return {
    id: value.id,
    clientGeneratedId: value.clientGeneratedId,
    scheduleId: value.scheduleId,
    scheduleRevision: value.scheduleRevision,
    cycleId: value.cycleId,
    cycleLocalDate: value.cycleLocalDate,
    feelingCode: value.feelingCode,
    note: value.note === undefined ? null : value.note,
    submittedAt: value.submittedAt,
    scheduleSnapshot,
  };
}

function readScheduleSnapshot(value: unknown): ManagerCheckInScheduleSnapshot | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["scheduleId", "scheduleName", "scheduleRevision", "recurrence", "title", "introduction", "acknowledgement", "notePlaceholder", "labels", "visibilityNotice"])
    || !isId(value.scheduleId)
    || !boundedString(value.scheduleName, 60)
    || !isNonNegativeInteger(value.scheduleRevision)
    || !boundedString(value.title, 200)
    || !boundedString(value.introduction, 1000)
    || !boundedString(value.acknowledgement, 500)
    || !boundedString(value.notePlaceholder, 200)
    || !readLabels(value.labels)
    || !isNotice(value.visibilityNotice)
  ) return null;
  const recurrence = readRecurrence(value.recurrence);
  const labels = readLabels(value.labels);
  if (!recurrence || !labels) return null;
  return {
    scheduleId: value.scheduleId,
    scheduleName: value.scheduleName,
    scheduleRevision: value.scheduleRevision,
    recurrence,
    title: value.title,
    introduction: value.introduction,
    acknowledgement: value.acknowledgement,
    notePlaceholder: value.notePlaceholder,
    labels,
    visibilityNotice: value.visibilityNotice,
  };
}

function readPending(value: unknown): PendingManagerCheckIn | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["clientGeneratedId", "scheduleId", "scheduleRevision", "cycleLocalDate", "timeZone", "feelingCode", "note", "receipt", "receiptExpiresAt"])
    || !isClientId(value.clientGeneratedId)
    || !isId(value.scheduleId)
    || !isNonNegativeInteger(value.scheduleRevision)
    || !isDate(value.cycleLocalDate)
    || !isTimeZone(value.timeZone)
    || !isFeelingCode(value.feelingCode)
    || !isNote(value.note)
  ) return null;
  const hasReceipt = value.receipt !== undefined;
  const hasReceiptExpiry = value.receiptExpiresAt !== undefined;
  if (hasReceipt !== hasReceiptExpiry) return null;
  const base: PendingManagerCheckIn = {
    clientGeneratedId: value.clientGeneratedId,
    scheduleId: value.scheduleId,
    scheduleRevision: value.scheduleRevision,
    cycleLocalDate: value.cycleLocalDate,
    timeZone: value.timeZone,
    feelingCode: value.feelingCode,
    note: value.note === undefined ? null : value.note,
  };
  if (!hasReceipt) return base;
  if (!isReceipt(value.receipt) || !isFutureIsoDate(value.receiptExpiresAt)) return null;
  return { ...base, receipt: value.receipt, receiptExpiresAt: value.receiptExpiresAt };
}

function readRecurrence(value: unknown): ManagerCheckInRecurrence | null {
  if (!isRecord(value) || !isDate(value.startsOn) || typeof value.kind !== "string") return null;
  if (value.kind === "daily" && hasOnlyKeys(value, ["kind", "intervalDays", "startsOn"]) && isBoundedInteger(value.intervalDays, 1, 365)) return { kind: "daily", intervalDays: value.intervalDays, startsOn: value.startsOn };
  if (value.kind === "weekly" && hasOnlyKeys(value, ["kind", "intervalWeeks", "startsOn", "weekdays"]) && isBoundedInteger(value.intervalWeeks, 1, 52) && isIntegerSelection(value.weekdays, 0, 6)) return { kind: "weekly", intervalWeeks: value.intervalWeeks, startsOn: value.startsOn, weekdays: value.weekdays };
  if (value.kind === "monthly" && isBoundedInteger(value.intervalMonths, 1, 12)) {
    if (!hasOnlyKeys(value, ["kind", "intervalMonths", "startsOn", "dates", "lastDay"])) return null;
    const selection = readDateSelection(value);
    return selection ? { kind: "monthly", intervalMonths: value.intervalMonths, startsOn: value.startsOn, ...selection } : null;
  }
  if (value.kind === "quarterly" && isIntegerSelection(value.quarterMonths, 1, 3)) {
    if (!hasOnlyKeys(value, ["kind", "startsOn", "quarterMonths", "dates", "lastDay"])) return null;
    const selection = readDateSelection(value);
    return selection ? { kind: "quarterly", startsOn: value.startsOn, quarterMonths: value.quarterMonths, ...selection } : null;
  }
  return null;
}

function readDateSelection(value: Record<string, unknown>): { readonly dates: readonly number[] } | { readonly lastDay: true } | null {
  if (value.lastDay === true && value.dates === undefined) return { lastDay: true };
  return value.lastDay === undefined && isIntegerSelection(value.dates, 1, 31) ? { dates: value.dates } : null;
}

function readLabels(value: unknown): Record<typeof managerCheckInFeelingCodes[number], string> | null {
  if (!isRecord(value) || Object.keys(value).length !== managerCheckInFeelingCodes.length) return null;
  if (!boundedString(value.good, 80)
    || !boundedString(value.steady, 80)
    || !boundedString(value.stretched, 80)
    || !boundedString(value.struggling, 80)
    || !boundedString(value.need_support, 80)) return null;
  return {
    good: value.good,
    steady: value.steady,
    stretched: value.stretched,
    struggling: value.struggling,
    need_support: value.need_support,
  };
}

function isFeelingCode(value: unknown): value is ManagerCheckInFeelingCode {
  return typeof value === "string" && managerCheckInFeelingCodes.some((code) => code === value);
}

function isIntegerSelection(value: unknown, min: number, max: number): value is readonly number[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isBoundedInteger(item, min, max)) && new Set(value).size === value.length;
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isClientId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; } catch { return false; }
}

function isNote(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string" && value.length <= 500;
}

function isReceipt(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(value);
}

function isFutureIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
}

function isCycleId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}:\d{4}-\d{2}-\d{2}$/.test(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isNotice(value: unknown): value is { readonly version: 1; readonly text: string } {
  return isRecord(value) && value.version === 1 && boundedString(value.text, 500);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
}

function boundIds(values: readonly string[]): readonly string[] {
  return [...new Set(values)].slice(-maxCycleIds);
}

function boundSubmissions(values: readonly ManagerCheckInSubmission[]): readonly ManagerCheckInSubmission[] {
  return values.slice(0, maxSubmissions).map((value) => structuredClone(value));
}

function fitState(state: ManagerCheckInLocalState): ManagerCheckInLocalState {
  const submissions = [...state.submissions];
  while (submissions.length > 0 && persistedByteLength({ ...state, submissions }) > maxStateBytes) submissions.pop();
  const bounded = { ...state, submissions, nudgeCycleIds: boundIds(state.nudgeCycleIds), committedCycleIds: boundIds(state.committedCycleIds) };
  if (persistedByteLength(bounded) > maxStateBytes) throw new Error("Manager check-in state metadata exceeds its storage limit.");
  return bounded;
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, path);
}

function persistedByteLength(value: unknown): number {
  return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}
