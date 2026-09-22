import { randomUUID } from "node:crypto";

import {
  managerCheckInFeelingCodes,
  TeamApiClient,
  TeamApiError,
  type ManagerCheckInFeelingCode,
  type ManagerCheckInSchedule,
  type ManagerCheckInSubmission,
  type ManagerCheckInSubmissionInput,
  type ManagerCheckInSyncResponse,
} from "./team-api-client.js";
import { cycleKey, isRecurrenceDueOnDate, localDateFromDate, localTimeZone } from "./manager-check-in-schedule.js";
import {
  ManagerCheckInStateStore,
  isUsablePendingManagerCheckIn,
  type ManagerCheckInStateStoreOptions,
  type PendingManagerCheckIn,
} from "./manager-check-in-state.js";
import type { SecureCredentialStore, TeamEnrollmentState, TeamStateStore } from "./team-state.js";

export type ManagerCheckInSnapshot = {
  readonly availability: "unavailable" | "unenrolled" | "available";
  readonly unavailableReason?: "secure_storage_unavailable" | "employee_identity_required";
  readonly organization: { readonly id: string; readonly name: string } | null;
  readonly visibilityNotice: { readonly version: 1; readonly text: string } | null;
  readonly schedules: readonly ManagerCheckInSchedule[];
  readonly submissions: readonly ManagerCheckInSubmission[];
  readonly devicePaused: boolean;
  readonly lastSyncAt?: string;
  readonly lastError?: string;
};

export type ManagerCheckInPetItem = {
  readonly scheduleId: string;
  readonly scheduleRevision: number;
  readonly cycleId: string;
  readonly cycleLocalDate: string;
  readonly title: string;
  readonly introduction: string;
  readonly acknowledgement: string;
  readonly notePlaceholder: string;
  readonly labels: Readonly<Record<ManagerCheckInFeelingCode, string>>;
  readonly visibilityNotice: { readonly version: 1; readonly text: string };
};

export type ManagerCheckInPetSnapshot = {
  readonly pendingCount: number;
  readonly activeItem: ManagerCheckInPetItem | null;
};

export type ManagerCheckInHistoryPage = {
  readonly submissions: readonly ManagerCheckInSubmission[];
  readonly nextCursor: string | null;
};

export type ManagerCheckInOffer = ManagerCheckInPetItem;
type ManagerCheckInBinding = {
  readonly organizationId: string;
  readonly employeeIdentityId: string | null;
  readonly deviceId?: string;
};

export type ManagerCheckInServiceOptions = {
  readonly userDataPath?: string;
  readonly teamStateStore: Pick<TeamStateStore, "snapshot">;
  readonly credentialStore: SecureCredentialStore;
  readonly apiClient?: ManagerCheckInApiClient;
  readonly stateStore?: ManagerCheckInStateStore;
  readonly stateOptions?: ManagerCheckInStateStoreOptions;
  readonly now?: () => Date;
  readonly pollMs?: number;
  readonly log?: (level: "info" | "warn" | "error", message: string, fields?: Record<string, unknown>) => void;
  readonly offerWeeklyCheckIn?: ManagerCheckInOfferPresentation;
};

type ManagerCheckInApiClient = Pick<TeamApiClient, "getManagerCheckInSync" | "createManagerCheckInSubmissionReceipt" | "submitManagerCheckIn">;
export type ManagerCheckInOfferPresentation = (
  offer: ManagerCheckInOffer,
  onPresented: () => void,
) => { readonly shown: boolean; readonly reason?: string };

let appManagerCheckInService: ManagerCheckInService | null = null;

export class ManagerCheckInService {
  readonly stateStore: ManagerCheckInStateStore;
  readonly apiClient: ManagerCheckInApiClient;
  readonly #teamStateStore: Pick<TeamStateStore, "snapshot">;
  readonly #credentialStore: SecureCredentialStore;
  readonly #now: () => Date;
  readonly #pollMs: number;
  readonly #log: NonNullable<ManagerCheckInServiceOptions["log"]>;
  readonly #offerWeeklyCheckIn: ManagerCheckInOfferPresentation | null;
  readonly #controllers = new Set<AbortController>();
  readonly #petSnapshotListeners = new Set<(snapshot: ManagerCheckInPetSnapshot) => void>();
  #timer: NodeJS.Timeout | null = null;
  #syncing: Promise<ManagerCheckInSnapshot> | null = null;
  #operation: Promise<unknown> = Promise.resolve();
  #started = false;
  #employeeAvailable: boolean | null = null;
  #authoritativeBinding: ManagerCheckInBinding | null = null;
  #nudgePresentationCycleId: string | null = null;

  constructor(options: ManagerCheckInServiceOptions) {
    this.#teamStateStore = options.teamStateStore;
    this.#credentialStore = options.credentialStore;
    this.apiClient = options.apiClient ?? new TeamApiClient();
    this.stateStore = options.stateStore ?? new ManagerCheckInStateStore(options.stateOptions ?? { userDataPath: options.userDataPath });
    this.#now = options.now ?? (() => new Date());
    this.#pollMs = Math.max(60_000, Math.min(options.pollMs ?? 15 * 60_000, 24 * 60 * 60_000));
    this.#log = options.log ?? (() => undefined);
    this.#offerWeeklyCheckIn = options.offerWeeklyCheckIn ?? null;
  }

  async start(): Promise<void> {
    this.#started = true;
    this.#authoritativeBinding = null;
    this.#employeeAvailable = null;
    this.stateStore.initialize();
    if (!this.#teamStateStore.snapshot()?.organizationId) {
      this.#notifyPetSnapshotListeners();
      return;
    }
    try {
      this.#credentialStore.load();
      await this.syncNow().catch(() => undefined);
    } catch (error) {
      this.#recordError(error);
    } finally {
      this.#schedule();
      this.#notifyPetSnapshotListeners();
    }
  }

  async stop(): Promise<void> {
    this.#started = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    for (const controller of this.#controllers) controller.abort();
    await this.#operation.catch(() => undefined);
  }

  getSnapshot(): ManagerCheckInSnapshot {
    const teamState = this.#teamStateStore.snapshot();
    const local = this.stateStore.snapshot();
    if (!teamState?.organizationId) return this.snapshotForUnavailable("unenrolled", undefined, null);
    let credentialAvailable = true;
    try {
      credentialAvailable = Boolean(this.#credentialStore.load());
    } catch {
      credentialAvailable = false;
    }
    if (!credentialAvailable) return this.snapshotForUnavailable("unavailable", "secure_storage_unavailable", teamState);
    if (this.#employeeAvailable === false) return this.snapshotForUnavailable("unavailable", "employee_identity_required", teamState);
    const organization = { id: teamState.organizationId, name: teamState.organizationName ?? "" };
    if (!this.#authoritativeBinding || !bindingMatches(this.#authoritativeBinding, teamState, local)) {
      return { availability: "available", organization, visibilityNotice: null, schedules: [], submissions: [], devicePaused: local?.devicePaused ?? false };
    }
    return {
      availability: "available",
      organization,
      visibilityNotice: local?.visibilityNotice ?? null,
      schedules: local?.schedules ?? [],
      submissions: local?.submissions ?? [],
      devicePaused: local?.devicePaused ?? false,
      lastSyncAt: local?.lastSyncAt,
      lastError: local?.lastError,
    };
  }

  subscribe(listener: (snapshot: ManagerCheckInPetSnapshot) => void): () => void {
    this.#petSnapshotListeners.add(listener);
    try { listener(this.getPetSnapshot()); } catch (error) { this.#log("warn", "Manager check-in pet listener failed", { error: String(error) }); }
    return () => this.#petSnapshotListeners.delete(listener);
  }

  getPetSnapshot(): ManagerCheckInPetSnapshot {
    const local = this.stateStore.snapshot();
    const snapshot = this.getSnapshot();
    if (snapshot.devicePaused || snapshot.availability !== "available" || !snapshot.visibilityNotice || !local) return { pendingCount: 0, activeItem: null };
    const items = this.deriveDueItems(local, localDateFromDate(this.#now()));
    return { pendingCount: items.length, activeItem: items[0] ?? null };
  }

  async syncNow(): Promise<ManagerCheckInSnapshot> {
    if (this.#syncing) return this.#syncing;
    const operation = this.#enqueue(() => this.#syncNow());
    const tracked = operation.finally(() => { if (this.#syncing === tracked) this.#syncing = null; });
    this.#syncing = tracked;
    return tracked;
  }

  async setDevicePaused(paused: unknown): Promise<ManagerCheckInSnapshot> {
    if (typeof paused !== "boolean") throw new Error("Manager check-in pause is invalid.");
    return this.#enqueue(async () => {
      this.stateStore.setDevicePaused(paused);
      if (!paused) await this.#offerDueCheckIn();
      this.#notifyPetSnapshotListeners();
      return this.getSnapshot();
    });
  }

  async submit(input: {
    readonly scheduleId: unknown;
    readonly scheduleRevision: unknown;
    readonly cycleId: unknown;
    readonly feelingCode: unknown;
    readonly note?: unknown;
  }): Promise<ManagerCheckInSnapshot> {
    return this.#enqueue(async () => {
      if (!this.#started) return this.getSnapshot();
      const context = this.requireContext();
      const normalized = normalizeSubmissionInput(input);
      const { cycleId: requestedCycleId, ...submissionValues } = normalized;
      const local = this.stateStore.ensureOrganization(context.teamState.organizationId);
      if (!this.#authoritativeBinding || !bindingMatches(this.#authoritativeBinding, context.teamState, local)) throw new Error("Manager check-in binding is unavailable.");
      const existing = local.pendingSubmission;
      if (existing && (!samePending(existing, submissionValues)
        || cycleKey(existing.scheduleId, existing.cycleLocalDate) !== requestedCycleId)) throw new Error("A manager check-in submission is already pending.");
      const currentDate = localDateFromDate(this.#now());
      const queueHead = this.deriveDueItems(local, currentDate)[0] ?? null;
      if (!queueHead
        || input.scheduleId !== queueHead.scheduleId
        || input.scheduleRevision !== queueHead.scheduleRevision
        || requestedCycleId !== queueHead.cycleId) {
        throw new Error("Manager check-in cycle is no longer the active queue item.");
      }
      const pending: PendingManagerCheckIn = existing ?? {
        clientGeneratedId: randomUUID(),
        ...submissionValues,
        cycleLocalDate: currentDate,
        timeZone: localTimeZone(),
      };
      if (existing && (!isUsablePendingManagerCheckIn(existing)
        || existing.scheduleId !== input.scheduleId
        || existing.scheduleRevision !== input.scheduleRevision
        || cycleKey(existing.scheduleId, existing.cycleLocalDate) !== requestedCycleId)) {
        throw new Error("Manager check-in pending submission binding is invalid.");
      }
      const submission = await this.#submitPending(context.credential, pending);
      this.stateStore.commitSubmission(submission);
      await this.#syncNow().catch(() => undefined);
      await this.#offerDueCheckIn();
      this.#notifyPetSnapshotListeners();
      return this.getSnapshot();
    });
  }

  async getHistory(cursor?: unknown): Promise<ManagerCheckInHistoryPage> {
    if (cursor !== undefined && (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(cursor))) throw new Error("Manager check-in cursor is invalid.");
    return this.#enqueue(async () => {
      const context = this.requireContext();
      const controller = this.trackController();
      try {
        const response = await this.apiClient.getManagerCheckInSync(context.credential, cursor as string | undefined, 100, controller.signal);
        this.#applyAuthoritativeResponse(response, context.teamState, cursor as string | undefined);
        return { submissions: response.history, nextCursor: response.nextCursor };
      } catch (error) {
        throw error;
      } finally { this.releaseController(controller); }
    });
  }

  #deriveDueItemsFromState(local: ReturnType<ManagerCheckInStateStore["snapshot"]>, date: string): ManagerCheckInPetItem[] {
    if (!local || local.devicePaused || !local.visibilityNotice) return [];
    const committed = new Set(local.committedCycleIds);
    return local.schedules
      .filter((schedule) => schedule.enabled && isRecurrenceDueOnDate(schedule.recurrence, date))
      .map((schedule) => this.#toPetItem(schedule, date, local.visibilityNotice!))
      .filter((item) => !committed.has(item.cycleId));
  }

  private deriveDueItems(local: ReturnType<ManagerCheckInStateStore["snapshot"]>, date: string): ManagerCheckInPetItem[] {
    return this.#deriveDueItemsFromState(local, date);
  }

  #toPetItem(schedule: ManagerCheckInSchedule, date: string, notice: { readonly version: 1; readonly text: string }): ManagerCheckInPetItem {
    return {
      scheduleId: schedule.id,
      scheduleRevision: schedule.revision,
      cycleId: cycleKey(schedule.id, date),
      cycleLocalDate: date,
      title: schedule.title,
      introduction: schedule.introduction,
      acknowledgement: schedule.acknowledgement,
      notePlaceholder: schedule.notePlaceholder,
      labels: schedule.labels,
      visibilityNotice: notice,
    };
  }

  async #syncNow(): Promise<ManagerCheckInSnapshot> {
    if (!this.#started) return this.getSnapshot();
    const context = this.requireContext();
    this.stateStore.ensureOrganization(context.teamState.organizationId);
    const controller = this.trackController();
    try {
      let cursor: string | undefined;
      let first: ManagerCheckInSyncResponse | null = null;
      const history: ManagerCheckInSubmission[] = [];
      for (let page = 0; page < 2; page += 1) {
        const response = await this.apiClient.getManagerCheckInSync(context.credential, cursor, 100, controller.signal);
        first ??= response;
        history.push(...response.history);
        if (!response.nextCursor || history.length >= 200) break;
        cursor = response.nextCursor;
      }
      if (!first) throw new Error("Manager check-in sync returned no page.");
      this.#applyAuthoritativeResponse({ ...first, history }, context.teamState);
      await this.#retryPendingDirect(context.credential);
      await this.#offerDueCheckIn();
      this.#notifyPetSnapshotListeners();
      return this.getSnapshot();
    } catch (error) {
      if (!controller.signal.aborted) this.#recordError(error);
      throw error;
    } finally { this.releaseController(controller); this.#schedule(); }
  }

  async #retryPendingDirect(credential: string): Promise<void> {
    const local = this.stateStore.snapshot();
    const teamState = this.#teamStateStore.snapshot();
    const pending = local?.pendingSubmission;
    if (!pending || !teamState || !this.#authoritativeBinding || !bindingMatches(this.#authoritativeBinding, teamState, local)) return;
    if (!isUsablePendingManagerCheckIn(pending)) {
      this.stateStore.clearPendingSubmission();
      return;
    }
    const schedule = local.schedules.find((item) => item.id === pending.scheduleId);
    if (!schedule || !schedule.enabled || schedule.revision !== pending.scheduleRevision || local.committedCycleIds.includes(cycleKey(pending.scheduleId, pending.cycleLocalDate))) {
      this.stateStore.clearPendingSubmission();
      return;
    }
    try {
      const submission = await this.#submitPending(credential, pending, false);
      this.stateStore.commitSubmission(submission);
    } catch { /* ambiguous state remains persisted for the next authoritative retry */ }
  }

  async #offerDueCheckIn(): Promise<void> {
    const local = this.stateStore.snapshot();
    const item = this.deriveDueItems(local, localDateFromDate(this.#now()))[0] ?? null;
    if (!item || !this.#offerWeeklyCheckIn || local?.nudgeCycleIds.includes(item.cycleId) || this.#nudgePresentationCycleId === item.cycleId) return;
    this.#nudgePresentationCycleId = item.cycleId;
    let presented = false;
    const markPresented = () => {
      if (presented) return;
      presented = true;
      this.stateStore.markNudgePresented(item.cycleId);
      this.#notifyPetSnapshotListeners();
    };
    try {
      const result = this.#offerWeeklyCheckIn(item, markPresented);
      if (result.shown) markPresented();
      else this.#nudgePresentationCycleId = null;
    } catch (error) {
      this.#nudgePresentationCycleId = null;
      throw error;
    }
  }

  async #submitPending(credential: string, pending: PendingManagerCheckIn, refreshOnConflict = true): Promise<ManagerCheckInSubmission> {
    this.stateStore.setPendingSubmission(pending);
    const controller = this.trackController();
    try {
      let current = this.stateStore.snapshot()?.pendingSubmission ?? pending;
      if (!isUsablePendingManagerCheckIn(current)) {
        this.stateStore.clearPendingSubmission();
        throw new Error("Manager check-in pending submission is invalid.");
      }
      if (!current.receipt) {
        const receipt = await this.apiClient.createManagerCheckInSubmissionReceipt(credential, withoutReceipt(current), controller.signal);
        if (!isReceiptValue(receipt.receipt) || !isFutureExpiry(receipt.expiresAt)) throw new Error("Manager check-in submission receipt is invalid.");
        current = { ...current, receipt: receipt.receipt, receiptExpiresAt: receipt.expiresAt };
        this.stateStore.setPendingSubmission(current);
      }
      return await this.apiClient.submitManagerCheckIn(credential, submissionRequest(current), controller.signal);
    } catch (error) {
      if (!isAmbiguousSubmissionFailure(error)) this.stateStore.clearPendingSubmission();
      if (refreshOnConflict && error instanceof TeamApiError && error.code === "schedule_revision_conflict") await this.#syncNow().catch(() => undefined);
      this.#recordError(error);
      throw error;
    } finally { this.releaseController(controller); }
  }

  #applyAuthoritativeResponse(response: ManagerCheckInSyncResponse, teamState: TeamEnrollmentState, cursor?: string): void {
    if (!teamState.deviceId) throw new Error("Teams device binding is unavailable.");
    this.#employeeAvailable = response.employee !== null;
    if (!response.employee) {
      this.#authoritativeBinding = { organizationId: teamState.organizationId, employeeIdentityId: null, deviceId: teamState.deviceId };
      this.stateStore.resetBinding({ organizationId: teamState.organizationId, deviceId: teamState.deviceId });
      return;
    }
    this.#authoritativeBinding = { organizationId: teamState.organizationId, employeeIdentityId: response.employee.id, deviceId: teamState.deviceId };
    const old = this.stateStore.snapshot();
    const history = cursor && old ? mergeSubmissions(old.submissions, response.history) : response.history;
    this.stateStore.replaceFromSync({ organizationId: teamState.organizationId, deviceId: teamState.deviceId, employeeIdentityId: response.employee.id, schedules: response.schedules, visibilityNotice: response.visibilityNotice, submissions: history, syncedAt: this.#now().toISOString() });
  }

  requireContext(): { readonly teamState: TeamEnrollmentState; readonly credential: string } {
    const teamState = this.#teamStateStore.snapshot();
    if (!teamState?.organizationId || !teamState.deviceId) throw new Error("Teams device binding is unavailable.");
    let credential: string | null;
    try { credential = this.#credentialStore.load(); } catch { throw new Error("Teams secure credential storage is unavailable."); }
    if (!credential) throw new Error("Teams secure credential is unavailable.");
    return { teamState, credential };
  }

  snapshotForUnavailable(availability: "unavailable" | "unenrolled", unavailableReason: "secure_storage_unavailable" | "employee_identity_required" | undefined, teamState: TeamEnrollmentState | null): ManagerCheckInSnapshot {
    return { availability, ...(unavailableReason ? { unavailableReason } : {}), organization: teamState?.organizationId ? { id: teamState.organizationId, name: teamState.organizationName ?? "" } : null, visibilityNotice: null, schedules: [], submissions: [], devicePaused: this.stateStore.snapshot()?.devicePaused ?? false };
  }

  #recordError(error: unknown): void {
    const reason = error instanceof TeamApiError ? error.code : error instanceof Error ? error.message : String(error);
    if (this.stateStore.snapshot()) this.stateStore.setError(reason);
    this.#log("warn", "Manager check-in sync failed", { reason });
    this.#notifyPetSnapshotListeners();
  }

  #notifyPetSnapshotListeners(): void {
    const snapshot = this.getPetSnapshot();
    for (const listener of this.#petSnapshotListeners) {
      try { listener(snapshot); } catch (error) { this.#log("warn", "Manager check-in pet listener failed", { error: String(error) }); }
    }
  }

  #schedule(): void {
    if (!this.#started || !this.#teamStateStore.snapshot()?.organizationId) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.syncNow().catch(() => undefined), this.#pollMs);
    this.#timer.unref?.();
  }

  #enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#operation.then(task, task);
    this.#operation = next.then(() => undefined, () => undefined);
    return next;
  }

  trackController(): AbortController { const controller = new AbortController(); this.#controllers.add(controller); return controller; }
  releaseController(controller: AbortController): void { this.#controllers.delete(controller); }
}

function normalizeSubmissionInput(input: { readonly scheduleId: unknown; readonly scheduleRevision: unknown; readonly cycleId: unknown; readonly feelingCode: unknown; readonly note?: unknown }): { readonly scheduleId: string; readonly scheduleRevision: number; readonly cycleId: string; readonly feelingCode: ManagerCheckInFeelingCode; readonly note: string | null } {
  if (typeof input.scheduleId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(input.scheduleId) || !Number.isSafeInteger(input.scheduleRevision) || (input.scheduleRevision as number) < 0 || typeof input.cycleId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}:\d{4}-\d{2}-\d{2}$/.test(input.cycleId) || typeof input.feelingCode !== "string" || !managerCheckInFeelingCodes.includes(input.feelingCode as ManagerCheckInFeelingCode)) throw new Error("Invalid manager check-in submission.");
  const note = input.note === undefined || input.note === null || input.note === "" ? null : input.note;
  if (note !== null && (typeof note !== "string" || note.length > 500)) throw new Error("Invalid manager check-in submission.");
  return { scheduleId: input.scheduleId, scheduleRevision: input.scheduleRevision as number, cycleId: input.cycleId, feelingCode: input.feelingCode as ManagerCheckInFeelingCode, note };
}

function submissionRequest(input: PendingManagerCheckIn): ManagerCheckInSubmissionInput {
  const { receiptExpiresAt: _, ...request } = input;
  return request;
}

function withoutReceipt(input: PendingManagerCheckIn): Omit<ManagerCheckInSubmissionInput, "receipt"> {
  const { receipt: _, ...request } = submissionRequest(input);
  return request;
}

function samePending(left: PendingManagerCheckIn, right: { readonly scheduleId: string; readonly scheduleRevision: number; readonly feelingCode: ManagerCheckInFeelingCode; readonly note: string | null }): boolean {
  return left.scheduleId === right.scheduleId && left.scheduleRevision === right.scheduleRevision && left.feelingCode === right.feelingCode && left.note === right.note;
}

function mergeSubmissions(left: readonly ManagerCheckInSubmission[], right: readonly ManagerCheckInSubmission[]): readonly ManagerCheckInSubmission[] {
  const byCycle = new Map<string, ManagerCheckInSubmission>();
  for (const submission of [...left, ...right]) byCycle.set(submission.cycleId, submission);
  return [...byCycle.values()].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

function bindingMatches(binding: ManagerCheckInBinding, teamState: TeamEnrollmentState, local: ReturnType<ManagerCheckInStateStore["snapshot"]>): boolean {
  return Boolean(local && binding.organizationId === teamState.organizationId && binding.deviceId === teamState.deviceId && local.organizationId === binding.organizationId && local.deviceId === binding.deviceId && local.employeeIdentityId === binding.employeeIdentityId);
}

function isAmbiguousSubmissionFailure(error: unknown): boolean {
  if (error instanceof TeamApiError) return error.status === 408 || error.status === 429 || error.status >= 500;
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  return /timed out|timeout|network|fetch failed|connection reset|socket|aborted/i.test(error.message);
}

function isReceiptValue(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(value);
}

function isFutureExpiry(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
}

export function initializeManagerCheckInService(options: ManagerCheckInServiceOptions): ManagerCheckInService {
  appManagerCheckInService = new ManagerCheckInService(options);
  return appManagerCheckInService;
}

export function getManagerCheckInService(): ManagerCheckInService {
  if (!appManagerCheckInService) throw new Error("Manager check-in service has not been initialized.");
  return appManagerCheckInService;
}

export function stopManagerCheckInService(): Promise<void> { return appManagerCheckInService?.stop() ?? Promise.resolve(); }
