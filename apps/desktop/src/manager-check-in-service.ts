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
  readonly offerWeeklyCheckIn?: ExternalPetSay;
};

type ManagerCheckInApiClient = Pick<
  TeamApiClient,
  "getManagerCheckInSync" | "submitManagerCheckIn" | "setScheduledOffersPaused"
>;
type ExternalPetSay = (message: string) => {
  readonly shown: boolean;
  readonly reason?: string;
};

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
    this.stateStore = options.stateStore
      ?? new ManagerCheckInStateStore(
        options.stateOptions ?? { userDataPath: options.userDataPath },
      );
    this.#now = options.now ?? (() => new Date());
    const requestedPollMs = options.pollMs ?? 15 * 60_000;
    this.#pollMs = Math.max(60_000, Math.min(requestedPollMs, 24 * 60 * 60_000));
    this.#log = options.log ?? (() => undefined);
    this.#offerWeeklyCheckIn = options.offerWeeklyCheckIn ?? null;
  }

  async start(): Promise<void> {
    this.#started = true;
    this.#authoritativeBinding = null;
    this.#employeeAvailable = null;
    this.stateStore.initialize();
    if (!this.#teamStateStore.snapshot()?.organizationId) {
      return;
    }
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
    if (this.#timer) {
      clearTimeout(this.#timer);
    }
    this.#timer = null;
    this.#syncSession?.abort();
    for (const controller of this.#controllers) {
      controller.abort();
    }
    await this.#operation.catch(() => undefined);
  }

  getSnapshot(): ManagerCheckInSnapshot {
    const teamState = this.#teamStateStore.snapshot();
    const local = this.stateStore.snapshot();
    if (!teamState?.organizationId) {
      return this.snapshotForUnavailable("unenrolled", undefined, null);
    }
    let credentialAvailable = true;
    try {
      credentialAvailable = Boolean(this.#credentialStore.load());
    } catch {
      credentialAvailable = false;
    }
    if (!credentialAvailable) {
      return this.snapshotForUnavailable("unavailable", "secure_storage_unavailable", teamState);
    }
    if (this.#employeeAvailable === false) {
      return this.snapshotForUnavailable("unavailable", "employee_identity_required", teamState);
    }
    const organization = { id: teamState.organizationId, name: teamState.organizationName ?? "" };
    if (!this.#authoritativeBinding || !bindingMatches(this.#authoritativeBinding, teamState, local)) {
      return {
        availability: "available",
        organization,
        visibilityNotice: null,
        settings: null,
        submissions: [],
        scheduledOffersPaused: false,
        dueScheduledOffer: false,
      };
    }
    const isLocalOrganization = local?.organizationId === teamState.organizationId;
    const settings = isLocalOrganization ? local.settings ?? null : null;
    const submissions = isLocalOrganization ? local.submissions : [];
    const paused = isLocalOrganization ? local.scheduledOffersPaused : false;
    const now = this.#now();
    const currentWeek = localWeekKey(now);
    const isOfferDay = settings?.weeklyDay === now.getDay();
    const hasOfferedThisWeek = local?.lastWeeklyOfferWeek === currentWeek;
    const hasSubmittedThisWeek = local?.lastManualSubmissionWeek === currentWeek;
    return {
      availability: "available",
      organization,
      visibilityNotice: { version: 1, text: "Submitted check-ins are visible to your organization's Teams dashboard." },
      settings,
      submissions,
      scheduledOffersPaused: paused,
      dueScheduledOffer: Boolean(
        settings
        && settings.weeklyEnabled
        && !paused
        && isOfferDay
        && !hasOfferedThisWeek
        && !hasSubmittedThisWeek,
      ),
      lastSyncAt: local?.lastSyncAt,
      lastError: local?.lastError,
    };
  }

  async syncNow(): Promise<ManagerCheckInSnapshot> {
    if (this.#syncing) {
      return this.#syncing;
    }

    const operation = this.#enqueue(async () => this.#syncNow());
    const tracked = operation.finally(() => {
      if (this.#syncing === tracked) {
        this.#syncing = null;
      }
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
      if (!this.#started) {
        return this.getSnapshot();
      }

      const context = this.requireContext();
      const normalized = validateSubmissionInput(input);
      let current = this.stateStore.ensureOrganization(context.teamState.organizationId);
      if (current.deviceId !== context.teamState.deviceId) {
        this.stateStore.resetBinding({
          organizationId: context.teamState.organizationId,
          deviceId: context.teamState.deviceId,
        });
        throw new Error("Manager check-in binding is unavailable.");
      }

      const hasAuthoritativeBinding = this.#authoritativeBinding
        && bindingMatches(this.#authoritativeBinding, context.teamState, current);
      if (!hasAuthoritativeBinding) {
        throw new Error("Manager check-in binding is unavailable.");
      }

      const pending = current.pendingSubmission;
      if (pending && !samePending(pending, normalized)) {
        throw new Error("A manager check-in submission is already pending.");
      }

      const pendingSubmission = pending ?? {
        clientGeneratedId: randomUUID(),
        ...normalized,
      };
      const submission = await this.#submitPending(context.credential, pendingSubmission);
      this.stateStore.commitSubmission(submission, localWeekKey(this.#now()));
      await this.#syncNow().catch(() => undefined);
      return this.getSnapshot();
    });
  }

  async setScheduledOffersPaused(paused: unknown): Promise<ManagerCheckInSnapshot> {
    if (typeof paused !== "boolean") {
      throw new Error("Scheduled offers pause is invalid.");
    }

    return this.#enqueue(async () => {
      if (!this.#started) {
        return this.getSnapshot();
      }

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
    if (!isValidHistoryCursor(cursor)) {
      throw new Error("Manager check-in cursor is invalid.");
    }

    return this.#enqueue(async () => {
      if (!this.#started) {
        return { submissions: [], nextCursor: null };
      }

      const context = this.requireContext();
      const controller = this.trackController();
      try {
        const response = await this.apiClient.getManagerCheckInSync(
          context.credential,
          cursor as string | undefined,
          100,
          controller.signal,
        );
        this.#applyAuthoritativeResponse(response, context.teamState);
        await this.#offerDueWeeklyCheckIn();
        if (!response.employee) {
          return { submissions: [], nextCursor: null };
        }
        return {
          submissions: response.submissions,
          nextCursor: response.nextCursor,
        };
      } finally {
        this.releaseController(controller);
      }
    });
  }

  async #syncNow(): Promise<ManagerCheckInSnapshot> {
    if (!this.#started) {
      return this.getSnapshot();
    }

    const context = this.requireContext();
    if (!context.teamState.deviceId) {
      throw new Error("Teams device binding is unavailable.");
    }

    this.stateStore.ensureOrganization(context.teamState.organizationId);
    const controller = this.trackController();
    this.#syncSession = controller;
    try {
      const pages: ManagerCheckInSubmission[] = [];
      let cursor: string | undefined;
      let first: ManagerCheckInSyncResponse | null = null;
      for (let page = 0; page < 2; page += 1) {
        const response = await this.apiClient.getManagerCheckInSync(
          context.credential,
          cursor,
          100,
          controller.signal,
        );
        first ??= response;
        pages.push(...response.submissions);
        if (!response.nextCursor || pages.length >= 200) {
          break;
        }
        cursor = response.nextCursor;
      }
      if (!first) {
        throw new Error("Manager check-in sync returned no page.");
      }
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
    const canRetryPending = Boolean(
      teamState?.organizationId
      && local?.organizationId === teamState.organizationId
      && this.#authoritativeBinding
      && bindingMatches(this.#authoritativeBinding, teamState, local),
    );
    if (!canRetryPending || !local?.pendingSubmission) {
      return;
    }

    const pending = local.pendingSubmission;
    const submission = await this.#submitPending(credential, pending, false);
    this.stateStore.commitSubmission(submission, localWeekKey(this.#now()));
  }

  async #offerDueWeeklyCheckIn(): Promise<void> {
    const snapshot = this.getSnapshot();
    if (!snapshot.dueScheduledOffer) {
      return;
    }

    const localWeek = localWeekKey(this.#now());
    try {
      const say = this.#offerWeeklyCheckIn ?? (await import("./default-pet-controller.js")).applyExternalPetSay;
      const result = say("How are you feeling this week? You can check in whenever you're ready.");
      if (result.shown) {
        this.stateStore.markWeeklyOfferPresented(localWeek);
      }
    } catch {
      // Presentation is optional and must not turn a successful sync into a failure.
    }
  }

  async #submitPending(
    credential: string,
    pending: PendingManagerCheckIn,
    refreshOnConflict = true,
  ): Promise<ManagerCheckInSubmission> {
    this.stateStore.setPendingSubmission(pending);
    const controller = this.trackController();
    try {
      return await this.apiClient.submitManagerCheckIn(credential, pending, controller.signal);
    } catch (error) {
      if (isSettingsRevisionConflict(error)) {
        this.stateStore.clearPendingSubmission();
        if (refreshOnConflict) {
          await this.#syncNow().catch(() => undefined);
        }
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
    const organizationMatches = response.organization.id === teamState.organizationId;
    if (!organizationMatches || !teamState.deviceId) {
      this.#authoritativeBinding = null;
      this.#employeeAvailable = false;
      this.stateStore.resetBinding({
        organizationId: teamState.organizationId,
        deviceId: teamState.deviceId,
      });
      throw new Error("Manager check-in organization binding changed.");
    }
    this.#employeeAvailable = response.employee !== null;
    if (!response.employee) {
      this.#authoritativeBinding = {
        organizationId: teamState.organizationId,
        employeeIdentityId: null,
        deviceId: teamState.deviceId,
      };
      this.stateStore.resetBinding({
        organizationId: teamState.organizationId,
        deviceId: teamState.deviceId,
      });
      return;
    }
    this.#authoritativeBinding = {
      organizationId: teamState.organizationId,
      employeeIdentityId: response.employee.id,
      deviceId: teamState.deviceId,
    };
    const local = this.stateStore.snapshot();
    const sameBinding = local?.organizationId === teamState.organizationId
      && local.employeeIdentityId === response.employee.id
      && local.deviceId === teamState.deviceId;
    const submissions = sameBinding && local
      ? mergeSubmissions(response.submissions, local.submissions)
      : response.submissions;
    this.stateStore.replaceFromSync({
      organizationId: teamState.organizationId,
      deviceId: teamState.deviceId,
      employeeIdentityId: response.employee.id,
      settings: response.settings,
      submissions,
      scheduledOffersPaused: response.scheduledOffersPaused,
      syncedAt: this.#now().toISOString(),
    });
  }

  requireContext(): { readonly teamState: TeamEnrollmentState; readonly credential: string } {
    const teamState = this.#teamStateStore.snapshot();
    if (!teamState?.organizationId) {
      throw new Error("This desktop is not enrolled in Teams.");
    }
    if (!teamState.deviceId) {
      throw new Error("Teams device binding is unavailable.");
    }

    let credential: string | null;
    try {
      credential = this.#credentialStore.load();
    } catch {
      throw new Error("Teams secure credential storage is unavailable.");
    }
    if (!credential) {
      throw new Error("Teams secure credential is unavailable.");
    }
    return {
      teamState,
      credential,
    };
  }

  snapshotForUnavailable(
    availability: "unavailable" | "unenrolled",
    unavailableReason: "secure_storage_unavailable" | "employee_identity_required" | undefined,
    teamState: TeamEnrollmentState | null,
  ): ManagerCheckInSnapshot {
    const organization = teamState?.organizationId
      ? {
        id: teamState.organizationId,
        name: teamState.organizationName ?? "",
      }
      : null;
    return {
      availability,
      ...(unavailableReason ? { unavailableReason } : {}),
      organization,
      visibilityNotice: null,
      settings: null,
      submissions: [],
      scheduledOffersPaused: false,
      dueScheduledOffer: false,
    };
  }

  #recordError(error: unknown): void {
    let reason = "sync_failed";
    if (error instanceof TeamApiError) {
      reason = error.code;
    } else if (error instanceof Error) {
      reason = error.message;
    }

    const local = this.stateStore.snapshot();
    if (local) {
      this.stateStore.setError(reason);
    }
    this.#log("warn", "Manager check-in sync failed", { reason });
  }

  #schedule(): void {
    const hasOrganization = Boolean(this.#teamStateStore.snapshot()?.organizationId);
    if (!this.#started || !hasOrganization) {
      return;
    }
    if (this.#timer) {
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(
      () => void this.syncNow().catch(() => undefined),
      this.#pollMs,
    );
    this.#timer.unref?.();
  }

  #enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#operation.then(task, task);
    this.#operation = next.then(() => undefined, () => undefined);
    return next;
  }

  trackController(): AbortController {
    const controller = new AbortController();
    this.#controllers.add(controller);
    return controller;
  }

  releaseController(controller: AbortController): void {
    this.#controllers.delete(controller);
  }
}

function validateSubmissionInput(input: {
  readonly feelingCode: unknown;
  readonly note?: unknown;
  readonly settingsRevision: unknown;
}): Omit<PendingManagerCheckIn, "clientGeneratedId"> {
  if (!managerCheckInFeelingCodes.includes(input.feelingCode as typeof managerCheckInFeelingCodes[number])) {
    throw new Error("Invalid manager check-in submission.");
  }
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    throw new Error("Invalid manager check-in submission.");
  }
  if (typeof input.note === "string" && input.note.length > 1000) {
    throw new Error("Invalid manager check-in submission.");
  }
  if (!Number.isSafeInteger(input.settingsRevision) || (input.settingsRevision as number) < 0) {
    throw new Error("Invalid manager check-in submission.");
  }

  const note = input.note === undefined || input.note === "" ? null : input.note as string;
  return {
    feelingCode: input.feelingCode as PendingManagerCheckIn["feelingCode"],
    note,
    settingsRevision: input.settingsRevision as number,
  };
}

function samePending(
  left: PendingManagerCheckIn,
  right: Omit<PendingManagerCheckIn, "clientGeneratedId">,
): boolean {
  return left.feelingCode === right.feelingCode
    && left.note === right.note
    && left.settingsRevision === right.settingsRevision;
}

function mergeSubmissions(
  remote: readonly ManagerCheckInSubmission[],
  local: readonly ManagerCheckInSubmission[],
): readonly ManagerCheckInSubmission[] {
  const byClientId = new Map<string, ManagerCheckInSubmission>();
  for (const submission of [...local, ...remote]) {
    byClientId.set(submission.clientGeneratedId, submission);
  }
  return [...byClientId.values()].sort((left, right) => (
    right.submittedAt.localeCompare(left.submittedAt)
  ));
}

function bindingMatches(
  binding: ManagerCheckInBinding,
  teamState: TeamEnrollmentState,
  local: ReturnType<ManagerCheckInStateStore["snapshot"]>,
): boolean {
  return Boolean(
    local
      && teamState.deviceId
      && binding.employeeIdentityId
      && binding.deviceId
      && binding.organizationId === teamState.organizationId
      && binding.deviceId === teamState.deviceId
      && local.organizationId === binding.organizationId
      && local.employeeIdentityId === binding.employeeIdentityId
      && local.deviceId === binding.deviceId,
  );
}

function isSettingsRevisionConflict(error: unknown): boolean {
  return error instanceof TeamApiError && error.code === "settings_revision_conflict";
}

function isAmbiguousSubmissionFailure(error: unknown): boolean {
  if (error instanceof TeamApiError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
}

function isValidHistoryCursor(cursor: unknown): boolean {
  return cursor === undefined
    || (typeof cursor === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(cursor));
}

function localWeekKey(date: Date): string {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = local.getDay() || 7;
  local.setDate(local.getDate() - day + 1);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const dateOfMonth = String(local.getDate()).padStart(2, "0");
  return `${year}-${month}-${dateOfMonth}`;
}

export function initializeManagerCheckInService(
  options: ManagerCheckInServiceOptions,
): ManagerCheckInService {
  appManagerCheckInService = new ManagerCheckInService(options);
  return appManagerCheckInService;
}

export function getManagerCheckInService(): ManagerCheckInService {
  if (!appManagerCheckInService) {
    throw new Error("Manager check-in service has not been initialized.");
  }
  return appManagerCheckInService;
}

export function stopManagerCheckInService(): Promise<void> {
  return appManagerCheckInService?.stop() ?? Promise.resolve();
}
export { localWeekKey };
