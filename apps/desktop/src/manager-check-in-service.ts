import { randomUUID } from "node:crypto";

import {
  managerCheckInFeelingCodes,
  TeamApiClient,
  TeamApiError,
  type ManagerCheckInSettings,
  type ManagerCheckInSubmission,
  type ManagerCheckInSyncResponse,
} from "./team-api-client.js";
import {
  ManagerCheckInStateStore,
  type ManagerCheckInStateStoreOptions,
  type PendingManagerCheckIn,
} from "./manager-check-in-state.js";
import type { SecureCredentialStore, TeamEnrollmentState, TeamStateStore } from "./team-state.js";

export type ManagerCheckInSnapshot = {
  readonly availability: "unavailable" | "unenrolled" | "available";
  readonly unavailableReason?: "secure_storage_unavailable" | "employee_identity_required";
  readonly organization: { readonly id: string; readonly name: string } | null;
  readonly visibilityNotice: { readonly version: 1; readonly text: string } | null;
  readonly settings: ManagerCheckInSettings | null;
  readonly submissions: readonly ManagerCheckInSubmission[];
  readonly scheduledOffersPaused: boolean;
  readonly dueScheduledOffer: boolean;
  readonly lastSyncAt?: string;
  readonly lastError?: string;
};
export type ManagerCheckInHistoryPage = {
  readonly submissions: readonly ManagerCheckInSubmission[];
  readonly nextCursor: string | null;
};
type ManagerCheckInBinding = { readonly organizationId: string; readonly employeeIdentityId: string | null; readonly deviceId?: string };

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
  readonly offerWeeklyCheckIn?: ExternalPetSay;
};

type ManagerCheckInApiClient = Pick<
  TeamApiClient,
  "getManagerCheckInSync" | "submitManagerCheckIn" | "setScheduledOffersPaused"
>;
type ExternalPetSay = (message: string) => { readonly shown: boolean; readonly reason?: string };

let appManagerCheckInService: ManagerCheckInService | null = null;

export class ManagerCheckInService {
  readonly stateStore: ManagerCheckInStateStore;
  readonly apiClient: ManagerCheckInApiClient;
  readonly #teamStateStore: Pick<TeamStateStore, "snapshot">;
  readonly #credentialStore: SecureCredentialStore;
  readonly #now: () => Date;
  readonly #pollMs: number;
  readonly #log: NonNullable<ManagerCheckInServiceOptions["log"]>;
  readonly #offerWeeklyCheckIn: ExternalPetSay | null;
  readonly #controllers = new Set<AbortController>();
  #timer: NodeJS.Timeout | null = null;
  #syncSession: AbortController | null = null;
  #syncing: Promise<ManagerCheckInSnapshot> | null = null;
  #operation: Promise<unknown> = Promise.resolve();
  #started = false;
  #employeeAvailable: boolean | null = null;
  #authoritativeBinding: ManagerCheckInBinding | null = null;

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
    if (!this.#teamStateStore.snapshot()?.organizationId) return;
    try {
      this.#credentialStore.load();
      await this.syncNow().catch(() => undefined);
    } catch (error) {
      this.#recordError(error);
    } finally {
      this.#schedule();
    }
  }

  async stop(): Promise<void> {
    this.#started = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#syncSession?.abort();
    for (const controller of this.#controllers) controller.abort();
    await this.#operation.catch(() => undefined);
  }

  getSnapshot(): ManagerCheckInSnapshot {
    const teamState = this.#teamStateStore.snapshot();
    const local = this.stateStore.snapshot();
    if (!teamState?.organizationId) return this.snapshotForUnavailable("unenrolled", undefined, null, local);
    let credentialAvailable = true;
    try {
      credentialAvailable = Boolean(this.#credentialStore.load());
    } catch {
      credentialAvailable = false;
    }
    if (!credentialAvailable) {
      return this.snapshotForUnavailable("unavailable", "secure_storage_unavailable", teamState, local);
    }
    if (this.#employeeAvailable === false) {
      return this.snapshotForUnavailable("unavailable", "employee_identity_required", teamState, local);
    }
    const organization = { id: teamState.organizationId, name: teamState.organizationName ?? "" };
    if (!this.#authoritativeBinding || !bindingMatches(this.#authoritativeBinding, teamState, local)) {
      return { availability: "available", organization, visibilityNotice: null, settings: null, submissions: [], scheduledOffersPaused: false, dueScheduledOffer: false };
    }
    const settings = local?.organizationId === teamState.organizationId ? local.settings ?? null : null;
    const submissions = local?.organizationId === teamState.organizationId ? local.submissions : [];
    const paused = local?.organizationId === teamState.organizationId ? local.scheduledOffersPaused : false;
    const now = this.#now();
    return {
      availability: "available",
      organization,
      visibilityNotice: { version: 1, text: "Submitted check-ins are visible to your organization's Teams dashboard." },
      settings,
      submissions,
      scheduledOffersPaused: paused,
      dueScheduledOffer: Boolean(settings && settings.weeklyEnabled && !paused && settings.weeklyDay === now.getDay() && local?.lastWeeklyOfferWeek !== localWeekKey(now) && local?.lastManualSubmissionWeek !== localWeekKey(now)),
      lastSyncAt: local?.lastSyncAt,
      lastError: local?.lastError,
    };
  }

  async syncNow(): Promise<ManagerCheckInSnapshot> {
    if (this.#syncing) return this.#syncing;
    const operation = this.#enqueue(async () => this.#syncNow());
    const tracked = operation.finally(() => {
      if (this.#syncing === tracked) this.#syncing = null;
    });
    this.#syncing = tracked;
    return tracked;
  }

  async submit(input: {
    readonly feelingCode: unknown;
    readonly note?: unknown;
    readonly settingsRevision: unknown;
  }): Promise<ManagerCheckInSnapshot> {
    return this.#enqueue(async () => {
      if (!this.#started) return this.getSnapshot();
      const context = this.requireContext();
      const normalized = validateSubmissionInput(input);
      let current = this.stateStore.ensureOrganization(context.teamState.organizationId);
      if (current.deviceId !== context.teamState.deviceId) {
        this.stateStore.resetBinding({ organizationId: context.teamState.organizationId, deviceId: context.teamState.deviceId });
        throw new Error("Manager check-in binding is unavailable.");
      }
      if (!this.#authoritativeBinding || !bindingMatches(this.#authoritativeBinding, context.teamState, current)) throw new Error("Manager check-in binding is unavailable.");
      const pending = current.pendingSubmission;
      if (pending && !samePending(pending, normalized)) throw new Error("A manager check-in submission is already pending.");
      const submission = await this.#submitPending(context.credential, pending ?? {
        clientGeneratedId: randomUUID(),
        ...normalized,
      });
      this.stateStore.commitSubmission(submission, localWeekKey(this.#now()));
      await this.#syncNow().catch(() => undefined);
      return this.getSnapshot();
    });
  }

  async setScheduledOffersPaused(paused: unknown): Promise<ManagerCheckInSnapshot> {
    if (typeof paused !== "boolean") throw new Error("Scheduled offers pause is invalid.");
    return this.#enqueue(async () => {
      if (!this.#started) return this.getSnapshot();
      const context = this.requireContext();
      this.stateStore.ensureOrganization(context.teamState.organizationId);
      const controller = this.trackController();
      try {
        const result = await this.apiClient.setScheduledOffersPaused(context.credential, paused, controller.signal);
        this.stateStore.setScheduledOffersPaused(result);
      } catch (error) {
        this.#recordError(error);
        throw error;
      } finally {
        this.releaseController(controller);
      }
      return this.getSnapshot();
    });
  }

  async getHistory(cursor?: unknown): Promise<ManagerCheckInHistoryPage> {
    if (cursor !== undefined && (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(cursor))) throw new Error("Manager check-in cursor is invalid.");
    return this.#enqueue(async () => {
      if (!this.#started) return { submissions: [], nextCursor: null };
      const context = this.requireContext();
      const controller = this.trackController();
      try {
        const response = await this.apiClient.getManagerCheckInSync(context.credential, cursor as string | undefined, 100, controller.signal);
        this.#applyAuthoritativeResponse(response, context.teamState);
        await this.#offerDueWeeklyCheckIn();
        if (!response.employee) return { submissions: [], nextCursor: null };
        return { submissions: response.submissions, nextCursor: response.nextCursor };
      } finally {
        this.releaseController(controller);
      }
    });
  }

  async #syncNow(): Promise<ManagerCheckInSnapshot> {
    if (!this.#started) return this.getSnapshot();
    const context = this.requireContext();
    if (!context.teamState.deviceId) throw new Error("Teams device binding is unavailable.");
    this.stateStore.ensureOrganization(context.teamState.organizationId);
    const controller = this.trackController();
    this.#syncSession = controller;
    try {
      const pages: ManagerCheckInSubmission[] = [];
      let cursor: string | undefined;
      let first: ManagerCheckInSyncResponse | null = null;
      for (let page = 0; page < 2; page += 1) {
        const response = await this.apiClient.getManagerCheckInSync(context.credential, cursor, 100, controller.signal);
        first ??= response;
        pages.push(...response.submissions);
        if (!response.nextCursor || pages.length >= 200) break;
        cursor = response.nextCursor;
      }
      if (!first) throw new Error("Manager check-in sync returned no page.");
      this.#applyAuthoritativeResponse({ ...first, submissions: pages }, context.teamState);
      if (first.employee) await this.#retryPendingDirect(context.credential).catch(() => undefined);
      await this.#offerDueWeeklyCheckIn();
      return this.getSnapshot();
    } catch (error) {
      if (!controller.signal.aborted) this.#recordError(error);
      throw error;
    } finally {
      if (this.#syncSession === controller) this.#syncSession = null;
      this.releaseController(controller);
      this.#schedule();
    }
  }

  async #retryPendingDirect(credential: string): Promise<void> {
    const teamState = this.#teamStateStore.snapshot();
    const local = this.stateStore.snapshot();
    const pending = teamState?.organizationId
      && local?.organizationId === teamState.organizationId
      && this.#authoritativeBinding
      && bindingMatches(this.#authoritativeBinding, teamState, local)
      ? local.pendingSubmission
      : undefined;
    if (!pending) return;
    const submission = await this.#submitPending(credential, pending, false);
    this.stateStore.commitSubmission(submission, localWeekKey(this.#now()));
  }

  async #offerDueWeeklyCheckIn(): Promise<void> {
    const snapshot = this.getSnapshot();
    if (!snapshot.dueScheduledOffer) return;

    const localWeek = localWeekKey(this.#now());
    let result: { readonly shown: boolean; readonly reason?: string };
    try {
      const say = this.#offerWeeklyCheckIn ?? (await import("./default-pet-controller.js")).applyExternalPetSay;
      result = say("How are you feeling this week? You can check in whenever you're ready.");
    } catch {
      // Presentation is optional and must not turn a successful sync into a failure.
      return;
    }
    if (result.shown) this.stateStore.markWeeklyOfferPresented(localWeek);
  }

  async #submitPending(credential: string, pending: PendingManagerCheckIn, refreshOnConflict = true): Promise<ManagerCheckInSubmission> {
    this.stateStore.setPendingSubmission(pending);
    const controller = this.trackController();
    try {
      return await this.apiClient.submitManagerCheckIn(credential, pending, controller.signal);
    } catch (error) {
      if (isSettingsRevisionConflict(error)) {
        this.stateStore.clearPendingSubmission();
        if (refreshOnConflict) await this.#syncNow().catch(() => undefined);
      } else if (!isAmbiguousSubmissionFailure(error)) {
        this.stateStore.clearPendingSubmission();
      }
      this.#recordError(error);
      throw error;
    } finally {
      this.releaseController(controller);
    }
  }

  #applyAuthoritativeResponse(response: ManagerCheckInSyncResponse, teamState: TeamEnrollmentState): void {
    if (response.organization.id !== teamState.organizationId || !teamState.deviceId) {
      this.#authoritativeBinding = null;
      this.#employeeAvailable = false;
      this.stateStore.resetBinding({ organizationId: teamState.organizationId, deviceId: teamState.deviceId });
      throw new Error("Manager check-in organization binding changed.");
    }
    this.#employeeAvailable = response.employee !== null;
    if (!response.employee) {
      this.#authoritativeBinding = { organizationId: teamState.organizationId, employeeIdentityId: null, ...(teamState.deviceId ? { deviceId: teamState.deviceId } : {}) };
      this.stateStore.resetBinding({ organizationId: teamState.organizationId, deviceId: teamState.deviceId });
      return;
    }
    this.#authoritativeBinding = { organizationId: teamState.organizationId, employeeIdentityId: response.employee.id, ...(teamState.deviceId ? { deviceId: teamState.deviceId } : {}) };
    const local = this.stateStore.snapshot();
    const sameBinding = local?.organizationId === teamState.organizationId
      && local.employeeIdentityId === response.employee.id
      && local.deviceId === teamState.deviceId;
    this.stateStore.replaceFromSync({ organizationId: teamState.organizationId, deviceId: teamState.deviceId, employeeIdentityId: response.employee.id, settings: response.settings, submissions: sameBinding ? mergeSubmissions(response.submissions, local.submissions) : response.submissions, scheduledOffersPaused: response.scheduledOffersPaused, syncedAt: this.#now().toISOString() });
  }

  requireContext(): { readonly teamState: TeamEnrollmentState; readonly credential: string } {
    const teamState = this.#teamStateStore.snapshot();
    if (!teamState?.organizationId) throw new Error("This desktop is not enrolled in Teams.");
    if (!teamState.deviceId) throw new Error("Teams device binding is unavailable.");
    let credential: string | null;
    try {
      credential = this.#credentialStore.load();
    } catch {
      throw new Error("Teams secure credential storage is unavailable.");
    }
    if (!credential) throw new Error("Teams secure credential is unavailable.");
    return { teamState, credential };
  }

  snapshotForUnavailable(
    availability: "unavailable" | "unenrolled",
    unavailableReason: "secure_storage_unavailable" | "employee_identity_required" | undefined,
    teamState: TeamEnrollmentState | null,
    local: ReturnType<ManagerCheckInStateStore["snapshot"]>,
  ): ManagerCheckInSnapshot {
    const sameOrganization = Boolean(teamState?.organizationId && local?.organizationId === teamState.organizationId);
    return {
      availability,
      ...(unavailableReason ? { unavailableReason } : {}),
      organization: teamState?.organizationId ? { id: teamState.organizationId, name: teamState.organizationName ?? "" } : null,
      visibilityNotice: null,
      settings: null,
      submissions: [],
      scheduledOffersPaused: false,
      dueScheduledOffer: false,
    };
  }

  #recordError(error: unknown): void {
    const reason = error instanceof TeamApiError ? error.code : error instanceof Error ? error.message : "sync_failed";
    const local = this.stateStore.snapshot();
    if (local) this.stateStore.setError(reason);
    this.#log("warn", "Manager check-in sync failed", { reason });
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

function validateSubmissionInput(input: { readonly feelingCode: unknown; readonly note?: unknown; readonly settingsRevision: unknown }): Omit<PendingManagerCheckIn, "clientGeneratedId"> {
  if (!managerCheckInFeelingCodes.includes(input.feelingCode as typeof managerCheckInFeelingCodes[number]) || (input.note !== undefined && input.note !== null && typeof input.note !== "string") || (typeof input.note === "string" && input.note.length > 1000) || !Number.isSafeInteger(input.settingsRevision) || (input.settingsRevision as number) < 0) throw new Error("Invalid manager check-in submission.");
  return { feelingCode: input.feelingCode as PendingManagerCheckIn["feelingCode"], note: input.note === undefined || input.note === "" ? null : input.note as string, settingsRevision: input.settingsRevision as number };
}
function samePending(left: PendingManagerCheckIn, right: Omit<PendingManagerCheckIn, "clientGeneratedId">): boolean { return left.feelingCode === right.feelingCode && left.note === right.note && left.settingsRevision === right.settingsRevision; }
function mergeSubmissions(remote: readonly ManagerCheckInSubmission[], local: readonly ManagerCheckInSubmission[]): readonly ManagerCheckInSubmission[] {
  const byClientId = new Map<string, ManagerCheckInSubmission>();
  for (const submission of [...local, ...remote]) byClientId.set(submission.clientGeneratedId, submission);
  return [...byClientId.values()].sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
}
function bindingMatches(binding: ManagerCheckInBinding, teamState: TeamEnrollmentState, local: ReturnType<ManagerCheckInStateStore["snapshot"]>): boolean {
  return Boolean(local && teamState.deviceId && binding.employeeIdentityId && binding.deviceId && binding.organizationId === teamState.organizationId && binding.deviceId === teamState.deviceId && local.organizationId === binding.organizationId && local.employeeIdentityId === binding.employeeIdentityId && local.deviceId === binding.deviceId);
}
function isSettingsRevisionConflict(error: unknown): boolean { return error instanceof TeamApiError && error.code === "settings_revision_conflict"; }
function isAmbiguousSubmissionFailure(error: unknown): boolean {
  if (error instanceof TeamApiError) return error.status === 408 || error.status === 429 || error.status >= 500;
  return true;
}
function localWeekKey(date: Date): string { const local = new Date(date.getFullYear(), date.getMonth(), date.getDate()); const day = local.getDay() || 7; local.setDate(local.getDate() - day + 1); return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`; }
export function initializeManagerCheckInService(options: ManagerCheckInServiceOptions): ManagerCheckInService { appManagerCheckInService = new ManagerCheckInService(options); return appManagerCheckInService; }
export function getManagerCheckInService(): ManagerCheckInService { if (!appManagerCheckInService) throw new Error("Manager check-in service has not been initialized."); return appManagerCheckInService; }
export function stopManagerCheckInService(): Promise<void> { return appManagerCheckInService?.stop() ?? Promise.resolve(); }
export { localWeekKey };
