import {
  validateTeamPack,
  type TeamPack,
} from "./team-protocol.js";
import type { ManagerCheckInRecurrence } from "./manager-check-in-schedule.js";

export const defaultTeamsApiBaseUrl = "https://openpets-teams-api.tokozedg793.workers.dev";
const maxResponseBytes = 512 * 1024;
const maxArtifactBytes = 50 * 1024 * 1024;
const enrollmentPollIntervalMs = 1_000;
export const teamDisplayNameMaxLength = 80;
export const managerCheckInFeelingCodes = [
  "good",
  "steady",
  "stretched",
  "struggling",
  "need_support",
] as const;
const managerCheckInVisibilityNotice = "Submitted check-ins are visible to your organization's Teams dashboard.";

export type ManagerCheckInFeelingCode = typeof managerCheckInFeelingCodes[number];
export type ManagerCheckInSchedule = {
  readonly id: string;
  readonly revision: number;
  readonly name: string;
  readonly enabled: boolean;
  readonly recurrence: ManagerCheckInRecurrence;
  readonly title: string;
  readonly introduction: string;
  readonly acknowledgement: string;
  readonly notePlaceholder: string;
  readonly labels: Record<ManagerCheckInFeelingCode, string>;
};
export type ManagerCheckInScheduleSnapshot = {
  readonly scheduleId: string;
  readonly scheduleName: string;
  readonly scheduleRevision: number;
  readonly recurrence: ManagerCheckInRecurrence;
  readonly title: string;
  readonly introduction: string;
  readonly acknowledgement: string;
  readonly notePlaceholder: string;
  readonly labels: Record<ManagerCheckInFeelingCode, string>;
  readonly visibilityNotice: { readonly version: 1; readonly text: string };
};
export type ManagerCheckInSubmission = {
  readonly id: string;
  readonly clientGeneratedId: string;
  readonly scheduleId: string;
  readonly scheduleRevision: number;
  readonly cycleId: string;
  readonly cycleLocalDate: string;
  readonly feelingCode: ManagerCheckInFeelingCode;
  readonly note: string | null;
  readonly submittedAt: string;
  readonly scheduleSnapshot: ManagerCheckInScheduleSnapshot;
};
export type ManagerCheckInSubmissionInput = {
  readonly clientGeneratedId: string;
  readonly scheduleId: string;
  readonly scheduleRevision: number;
  readonly cycleLocalDate: string;
  readonly timeZone: string;
  readonly feelingCode: ManagerCheckInFeelingCode;
  readonly note?: string | null;
  readonly receipt?: string;
};
export type ManagerCheckInSubmissionReceipt = {
  readonly receipt: string;
  readonly expiresAt: string;
};
export type ManagerCheckInSyncResponse = {
  readonly schedules: readonly ManagerCheckInSchedule[];
  readonly visibilityNotice: { readonly version: 1; readonly text: string };
  readonly employee: { readonly id: string; readonly displayName: string } | null;
  readonly history: readonly ManagerCheckInSubmission[];
  readonly nextCursor: string | null;
};

export class TeamApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "TeamApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type TeamApiClientOptions = {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly production?: boolean;
};
export type TeamEnrollmentResult = {
  readonly deviceId: string;
  readonly organization: {
    readonly id: string;
    readonly name: string;
  };
  readonly deviceCredential: string;
  readonly packRevision: number;
};
export type TeamEnrollmentPreview = {
  readonly intentId: string;
  readonly status: "started" | "accepted" | "completed";
  readonly organization: {
    readonly id: string;
    readonly name: string;
  };
  readonly displayName?: string;
  readonly expiresAt: string;
};

export class TeamApiClient {
  readonly baseUrl: URL;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  constructor(options: TeamApiClientOptions = {}) {
    const raw = options.baseUrl ?? process.env.OPENPETS_TEAMS_API_URL ?? defaultTeamsApiBaseUrl;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("Teams API URL is invalid.");
    }
    if (
      url.username
      || url.password
      || url.search
      || url.hash
      || (url.pathname !== "/" && url.pathname !== "")
    ) throw new Error("Teams API URL must be an origin.");
    if (
      options.production !== false
      && url.protocol !== "https:"
    ) throw new Error("Teams API must use HTTPS in production.");
    this.baseUrl = new URL(url.origin);
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 15_000, 60_000));
  }

  async getTeamPack(
    credential: string,
    etag?: string,
    signal?: AbortSignal,
  ): Promise<{
    readonly pack: TeamPack;
    readonly etag?: string;
    readonly notModified: boolean;
  }> {
    const response = await this.request("/v1/device/team-pack", {
      credential,
      headers: etag ? { "If-None-Match": etag } : undefined,
      allowNotModified: true,
      signal,
    });
    if (response.status === 304) {
      return {
        pack: validateTeamPack({ version: 1, revision: 0, items: [] }),
        etag,
        notModified: true,
      };
    }
    const pack = validateTeamPack(response.body);
    return {
      pack,
      etag: header(response.headers, "etag"),
      notModified: false,
    };
  }

  async downloadArtifact(
    credential: string,
    versionId: string,
    expectedSize: number,
    expectedSha256: string,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    if (
      !/^[A-Za-z0-9_-]{1,160}$/.test(versionId)
      || !Number.isSafeInteger(expectedSize)
      || expectedSize < 1
      || expectedSize > maxArtifactBytes
      || !/^[a-f0-9]{64}$/.test(expectedSha256)
    ) throw new Error("Team artifact request is invalid.");
    const capabilityResponse = await this.request(
      `/v1/device/artifacts/${encodeURIComponent(versionId)}/capability`,
      { credential, method: "POST", signal },
    );
    const capability = requireString(capabilityResponse.body, "capability", 512);
    const artifact = await this.request(
      `/v1/device/artifacts/${encodeURIComponent(versionId)}`
        + `?capability=${encodeURIComponent(capability)}`,
      {
        credential,
        maxBytes: Math.min(maxArtifactBytes, expectedSize + 1),
        signal,
      },
    );
    if (
      !(artifact.raw instanceof Uint8Array)
      || artifact.raw.byteLength !== expectedSize
    ) throw new Error("Team artifact size does not match the Team Pack.");
    const digest = await sha256(artifact.raw);
    if (digest !== expectedSha256) {
      throw new Error("Team artifact checksum does not match the Team Pack.");
    }
    return Buffer.from(artifact.raw);
  }

  async getEnrollmentPreview(
    intentId: string,
    signal?: AbortSignal,
  ): Promise<TeamEnrollmentPreview> {
    validateEnrollmentIntentId(intentId);
    const response = await this.request(
      `/v1/enrollment/intents/${encodeURIComponent(intentId)}/preview`,
      { signal },
    );
    return validateEnrollmentPreview(response.body, intentId);
  }
  async completeEnrollment(
    intentId: string,
    desktopProof: string,
    installationId: string,
    displayName: string,
    expiresAt: string,
    signal?: AbortSignal,
  ): Promise<TeamEnrollmentResult> {
    validateEnrollmentValues(intentId, desktopProof, installationId, displayName);
    const deadline = parseEnrollmentDeadline(expiresAt);
    for (;;) {
      try {
        const response = await this.request(
          `/v1/enrollment/intents/${encodeURIComponent(intentId)}/complete`,
          {
            method: "POST",
            body: {
              desktopProof,
              deviceInstallationId: installationId,
              displayName: displayName.trim(),
            },
            signal,
          },
        );
        return parseEnrollmentResult(response.body);
      } catch (error) {
        if (
          !isRetryableEnrollmentCompletionError(error)
          || Date.now() >= deadline
        ) throw enrollmentDeadlineError(error);
        await waitForEnrollmentRetry(deadline, signal);
        if (Date.now() >= deadline) throw new Error("Teams enrollment completion timed out.");
      }
    }
  }
  async reportDeployment(
    credential: string,
    revision: number,
    result: "current" | "out_of_date" | "error",
  ): Promise<void> {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error("Team deployment revision is invalid.");
    }
    await this.request(
      "/v1/device/deployment",
      {
        credential,
        method: "POST",
        body: { revision, result },
      },
    );
  }

  async getManagerCheckInSync(
    credential: string,
    cursor?: string,
    limit = 100,
    signal?: AbortSignal,
  ): Promise<ManagerCheckInSyncResponse> {
    if (cursor !== undefined && !isValidManagerCheckInCursor(cursor)) {
      throw new Error("Manager check-in cursor is invalid.");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Manager check-in limit is invalid.");
    }
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor !== undefined) query.set("cursor", cursor);
    const response = await this.request(
      `/v1/device/manager-check-ins/sync?${query.toString()}`,
      { credential, signal },
    );
    return validateManagerCheckInSync(response.body);
  }

  async submitManagerCheckIn(
    credential: string,
    input: ManagerCheckInSubmissionInput,
    signal?: AbortSignal,
  ): Promise<ManagerCheckInSubmission> {
    validateManagerCheckInSubmissionInput(input);
    const response = await this.request(
      "/v1/device/manager-check-ins/submissions",
      { credential, method: "POST", body: input, signal },
    );
    if (!isRecord(response.body) || !("submission" in response.body)) {
      throw new Error("Manager check-in submission response is invalid.");
    }
    return validateManagerCheckInSubmission(response.body.submission);
  }

  async createManagerCheckInSubmissionReceipt(
    credential: string,
    input: Omit<ManagerCheckInSubmissionInput, "receipt">,
    signal?: AbortSignal,
  ): Promise<ManagerCheckInSubmissionReceipt> {
    validateManagerCheckInSubmissionInput(input);
    const response = await this.request(
      "/v1/device/manager-check-ins/submission-receipts",
      { credential, method: "POST", body: input, signal },
    );
    if (
      !isRecord(response.body)
      || typeof response.body.receipt !== "string"
      || !/^[A-Za-z0-9_-]{20,128}$/.test(response.body.receipt)
      || typeof response.body.expiresAt !== "string"
    ) {
      throw new Error("Manager check-in submission receipt response is invalid.");
    }
    return {
      receipt: response.body.receipt,
      expiresAt: response.body.expiresAt,
    };
  }

  async leaveOrganization(credential: string): Promise<void> {
    await this.request("/v1/device", { credential, method: "DELETE" });
  }

  private async request(
    path: string,
    options: {
      readonly credential?: string;
      readonly method?: string;
      readonly body?: unknown;
      readonly headers?: Record<string, string>;
      readonly maxBytes?: number;
      readonly allowNotModified?: boolean;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<{
    readonly status: number;
    readonly headers: Headers;
    readonly body: unknown;
    readonly raw?: Uint8Array;
  }> {
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) {
      throw new Error("Teams API request escaped the configured origin.");
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) {
      controller.abort();
    } else {
      options.signal?.addEventListener("abort", abort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    timer.unref?.();
    try {
      const headers = new Headers(options.headers);
      if (options.credential) headers.set("Authorization", `Bearer ${options.credential}`);
      if (options.body !== undefined) {
        headers.set("Content-Type", "application/json");
      }
      const response = await this.#fetch(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
        redirect: "error",
        signal: controller.signal,
      });
      if (options.allowNotModified && response.status === 304) {
        return {
          status: response.status,
          headers: response.headers,
          body: null,
        };
      }
      if (!response.ok) {
        const errorBody = await readErrorBody(response);
        throw new TeamApiError(
          response.status,
          boundedApiErrorCode(errorBody?.error?.code) ?? `http_${response.status}`,
          `Teams API request failed with HTTP ${response.status}.`,
          errorBody?.error?.details,
        );
      }
      const bytes = await readBytes(response, options.maxBytes ?? maxResponseBytes);
      if (
        url.pathname.includes("/artifacts/")
        && !url.pathname.endsWith("/capability")
      ) {
        return {
          status: response.status,
          headers: response.headers,
          body: null,
          raw: bytes,
        };
      }
      let body: unknown;
      try {
        body = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        throw new Error("Teams API returned invalid JSON.");
      }
      return { status: response.status, headers: response.headers, body };
    } catch (error) {
      if (options.signal?.aborted) {
        throw new Error("Teams enrollment was cancelled.");
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Teams API request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}

function validateEnrollmentPreview(
  body: unknown,
  intentId: string,
): TeamEnrollmentPreview {
  if (
    !isRecord(body)
    || (body.status !== "started" && body.status !== "accepted" && body.status !== "completed")
    || body.intentId !== intentId
    || typeof body.intentId !== "string"
    || !/^[A-Za-z0-9_-]{1,128}$/.test(body.intentId)
    || !isRecord(body.organization)
    || typeof body.organization.id !== "string"
    || body.organization.id.length === 0
    || body.organization.id.length > 160
    || typeof body.organization.name !== "string"
    || body.organization.name.length === 0
    || body.organization.name.length > 200
    || body.status !== "started"
      && (
        typeof body.displayName !== "string"
        || body.displayName.length === 0
        || body.displayName.length > teamDisplayNameMaxLength
      )
    || body.status === "started"
      && body.displayName !== undefined
      && (
        typeof body.displayName !== "string"
        || body.displayName.length === 0
        || body.displayName.length > teamDisplayNameMaxLength
      )
    || typeof body.expiresAt !== "string"
  ) throw new Error("Teams enrollment response is invalid.");
  parseEnrollmentDeadline(body.expiresAt);
  return {
    intentId,
    status: body.status,
    organization: {
      id: body.organization.id,
      name: body.organization.name,
    },
    ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
    expiresAt: body.expiresAt,
  };
}

function parseEnrollmentResult(body: unknown): TeamEnrollmentResult {
  if (
    !isRecord(body)
    || typeof body.deviceId !== "string"
    || body.deviceId.length > 160
    || !isRecord(body.organization)
    || typeof body.organization.id !== "string"
    || body.organization.id.length > 160
    || typeof body.organization.name !== "string"
    || body.organization.name.length === 0
    || body.organization.name.length > 200
    || typeof body.deviceCredential !== "string"
    || !/^[A-Za-z0-9_-]{40,64}$/.test(body.deviceCredential)
    || !Number.isSafeInteger(body.packRevision)
    || (body.packRevision as number) < 0
  ) throw new Error("Teams enrollment response is invalid.");
  return {
    deviceId: body.deviceId,
    organization: {
      id: body.organization.id,
      name: body.organization.name,
    },
    deviceCredential: body.deviceCredential,
    packRevision: body.packRevision as number,
  };
}

function validateEnrollmentValues(
  intentId: string,
  desktopProof: string,
  installationId: string,
  displayName: string,
): void {
  validateEnrollmentIntentId(intentId);
  validateEnrollmentProofValue(desktopProof);
  if (
    !/^[A-Za-z0-9._:-]{1,160}$/.test(installationId)
    || displayName.trim().length === 0
    || displayName.length > teamDisplayNameMaxLength
  ) throw new Error("Teams enrollment input is invalid.");
}

function validateEnrollmentIntentId(intentId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(intentId)) {
    throw new Error("Teams enrollment intent is invalid.");
  }
}

function validateEnrollmentProofValue(desktopProof: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(desktopProof)) {
    throw new Error("Teams enrollment proof is invalid.");
  }
}

function requireString(body: unknown, key: string, max: number): string {
  if (
    !isRecord(body)
    || typeof body[key] !== "string"
    || body[key].length === 0
    || body[key].length > max
  ) throw new Error("Teams API response is invalid.");
  return body[key] as string;
}

function header(headers: Headers, name: string): string | undefined {
  const value = headers.get(name);
  return value && value.length <= 256 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEnrollmentDeadline(expiresAt: string): number {
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) {
    throw new Error("Teams enrollment window has expired.");
  }
  return deadline;
}

function isRetryableEnrollmentTransportError(error: unknown): boolean {
  return error instanceof TypeError || error instanceof Error && (
    /Teams API request timed out\./.test(error.message)
    || /HTTP 5\d\d\./.test(error.message)
    || /Teams API returned invalid JSON\./.test(error.message)
  );
}

function isRetryableEnrollmentCompletionError(error: unknown): boolean {
  return isRetryableEnrollmentTransportError(error)
    || error instanceof TeamApiError
      && error.status === 409
      && error.code === "enrollment_completion_in_progress";
}

async function waitForEnrollmentRetry(
  deadline: number,
  signal?: AbortSignal,
): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error("Teams enrollment completion timed out.");
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, Math.min(enrollmentPollIntervalMs, remaining));
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new Error("Teams enrollment was cancelled."));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function enrollmentDeadlineError(error: unknown): Error {
  if (
    error instanceof Error
    && /Teams enrollment was cancelled\./.test(error.message)
  ) return error;
  if (
    error instanceof Error
    && /HTTP (400|401|403|404)\./.test(error.message)
  ) return error;
  if (error instanceof TeamApiError) return error;
  return error instanceof Error
    && /Teams enrollment window has expired\./.test(error.message)
    ? error
    : new Error("Teams enrollment completion timed out.");
}

async function readBytes(
  response: Response,
  max: number,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Teams API response body is unavailable.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > max) throw new Error("Teams API response is too large.");
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Buffer.from(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validateManagerCheckInSubmissionInput(input: ManagerCheckInSubmissionInput): void {
  if (!isRecord(input)) {
    throw new Error("Manager check-in submission is invalid.");
  }
  if (typeof input.clientGeneratedId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input.clientGeneratedId)) {
    throw new Error("Manager check-in submission is invalid.");
  }
  if (typeof input.scheduleId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(input.scheduleId)) {
    throw new Error("Manager check-in submission is invalid.");
  }
  if (!Number.isSafeInteger(input.scheduleRevision) || input.scheduleRevision < 0) {
    throw new Error("Manager check-in submission is invalid.");
  }
  if (typeof input.cycleLocalDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.cycleLocalDate)) {
    throw new Error("Manager check-in submission is invalid.");
  }
  try {
    const [year, month, day] = input.cycleLocalDate.split("-").map(Number);
    const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > maxDay) throw new Error();
  } catch {
    throw new Error("Manager check-in submission is invalid.");
  }
  if (typeof input.timeZone !== "string" || input.timeZone.length === 0 || input.timeZone.length > 100) {
    throw new Error("Manager check-in submission is invalid.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone }).format();
  } catch {
    throw new Error("Manager check-in submission is invalid.");
  }
  if (typeof input.feelingCode !== "string" || !managerCheckInFeelingCodes.includes(input.feelingCode as ManagerCheckInFeelingCode)) {
    throw new Error("Manager check-in submission is invalid.");
  }
  if (input.note !== undefined && !isValidManagerCheckInNote(input.note)) {
    throw new Error("Manager check-in submission is invalid.");
  }
  if (input.receipt !== undefined && (typeof input.receipt !== "string" || !/^[A-Za-z0-9_-]{20,128}$/.test(input.receipt))) {
    throw new Error("Manager check-in submission is invalid.");
  }
}

function validateManagerCheckInSync(value: unknown): ManagerCheckInSyncResponse {
  if (!isRecord(value)) {
    throw new Error("Manager check-in sync response is invalid.");
  }
  if (!onlyKeys(value, ["schedules", "employee", "visibilityNotice", "history", "nextCursor"])) {
    throw new Error("Manager check-in sync response is invalid.");
  }
  if (!isValidManagerCheckInVisibilityNotice(value.visibilityNotice)) {
    throw new Error("Manager check-in sync response is invalid.");
  }
  if (!isValidManagerCheckInEmployee(value.employee)) {
    throw new Error("Manager check-in sync response is invalid.");
  }
  if (!Array.isArray(value.schedules) || value.schedules.length > 32) {
    throw new Error("Manager check-in sync response is invalid.");
  }
  if (!Array.isArray(value.history) || value.history.length > 100) {
    throw new Error("Manager check-in sync response is invalid.");
  }
  const hasValidNextCursor = value.nextCursor === null
    || isValidManagerCheckInCursor(value.nextCursor);
  if (!hasValidNextCursor) {
    throw new Error("Manager check-in sync response is invalid.");
  }

  const visibilityNotice = value.visibilityNotice as Record<string, unknown>;
  const employee = value.employee as Record<string, unknown> | null;

  return {
    schedules: value.schedules.map(validateManagerCheckInSchedule),
    visibilityNotice: {
      version: 1,
      text: visibilityNotice.text as string,
    },
    employee: value.employee === null
      ? null
      : {
        id: employee?.id as string,
        displayName: employee?.displayName as string,
      },
    history: value.history.map(validateManagerCheckInSubmission),
    nextCursor: value.nextCursor as string | null,
  };
}

function validateManagerCheckInSchedule(value: unknown): ManagerCheckInSchedule {
  if (!isRecord(value)) {
    throw new Error("Manager check-in schedule response is invalid.");
  }
  if (!onlyKeys(value, ["id", "organizationId", "revision", "name", "enabled", "recurrence", "title", "introduction", "acknowledgement", "notePlaceholder", "labels", "createdAt", "updatedAt"])) {
    throw new Error("Manager check-in schedule response is invalid.");
  }
  if (typeof value.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value.id)
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || typeof value.name !== "string" || value.name.length === 0 || value.name.length > 60
    || typeof value.enabled !== "boolean") {
    throw new Error("Manager check-in schedule response is invalid.");
  }
  if (
    !boundedString(value.title, 200)
    || !boundedString(value.introduction, 1000)
    || !boundedString(value.acknowledgement, 500)
    || !boundedString(value.notePlaceholder, 200)
  ) {
    throw new Error("Manager check-in schedule response is invalid.");
  }
  if (!validManagerCheckInLabels(value.labels)) {
    throw new Error("Manager check-in schedule response is invalid.");
  }

  const schedule = value as Record<string, unknown>;
  return {
    id: schedule.id as string,
    revision: schedule.revision as number,
    name: schedule.name as string,
    enabled: schedule.enabled as boolean,
    recurrence: validateRecurrence(schedule.recurrence),
    title: schedule.title as string,
    introduction: schedule.introduction as string,
    acknowledgement: schedule.acknowledgement as string,
    notePlaceholder: schedule.notePlaceholder as string,
    labels: createManagerCheckInLabels(schedule.labels as Record<string, unknown>),
  };
}

function validateManagerCheckInSubmission(value: unknown): ManagerCheckInSubmission {
  if (!isRecord(value)) {
    throw new Error("Manager check-in submission response is invalid.");
  }
  validateManagerCheckInSubmissionInput({
    clientGeneratedId: value.clientGeneratedId as string,
    scheduleId: value.scheduleId as string,
    scheduleRevision: value.scheduleRevision as number,
    cycleLocalDate: value.cycleLocalDate as string,
    timeZone: "UTC",
    feelingCode: value.feelingCode as ManagerCheckInFeelingCode,
    note: value.note as string | null,
  });
  if (!onlyKeys(value, ["id", "clientGeneratedId", "scheduleId", "scheduleRevision", "cycleId", "cycleLocalDate", "feelingCode", "note", "submittedAt", "scheduleSnapshot"])) {
    throw new Error("Manager check-in submission response is invalid.");
  }
  if (!boundedString(value.id, 160) || !boundedString(value.submittedAt, 64)) {
    throw new Error("Manager check-in submission response is invalid.");
  }
  if (!isValidManagerCheckInNote(value.note)) {
    throw new Error("Manager check-in submission response is invalid.");
  }
  if (typeof value.cycleId !== "string" || value.cycleId !== `${value.scheduleId}:${value.cycleLocalDate}` || !isRecord(value.scheduleSnapshot)) {
    throw new Error("Manager check-in submission response is invalid.");
  }

  const scheduleSnapshot = validateScheduleSnapshot(value.scheduleSnapshot);
  const submission = value as Record<string, unknown>;
  return {
    id: submission.id as string,
    clientGeneratedId: submission.clientGeneratedId as string,
    scheduleId: submission.scheduleId as string,
    scheduleRevision: submission.scheduleRevision as number,
    cycleId: submission.cycleId as string,
    cycleLocalDate: submission.cycleLocalDate as string,
    feelingCode: submission.feelingCode as ManagerCheckInFeelingCode,
    note: submission.note as string | null,
    submittedAt: submission.submittedAt as string,
    scheduleSnapshot,
  };
}

function validateScheduleSnapshot(value: unknown): ManagerCheckInScheduleSnapshot {
  if (!isRecord(value)) {
    throw new Error("Manager check-in prompt snapshot is invalid.");
  }
  if (!onlyKeys(value, ["scheduleId", "scheduleName", "scheduleRevision", "recurrence", "title", "introduction", "acknowledgement", "notePlaceholder", "labels", "visibilityNotice"])) {
    throw new Error("Manager check-in prompt snapshot is invalid.");
  }
  if (
    typeof value.scheduleId !== "string"
    || typeof value.scheduleName !== "string"
    || !Number.isSafeInteger(value.scheduleRevision)
    || !value.recurrence
    || !boundedString(value.title, 200)
    || !boundedString(value.introduction, 1000)
    || !boundedString(value.acknowledgement, 500)
    || !boundedString(value.notePlaceholder, 200)
  ) {
    throw new Error("Manager check-in prompt snapshot is invalid.");
  }
  if (!validManagerCheckInLabels(value.labels)) {
    throw new Error("Manager check-in prompt snapshot is invalid.");
  }
  if (!isValidManagerCheckInVisibilityNotice(value.visibilityNotice)) {
    throw new Error("Manager check-in prompt snapshot is invalid.");
  }

  const snapshot = value as Record<string, unknown>;
  const labels = snapshot.labels as Record<string, unknown>;
  const notice = snapshot.visibilityNotice as Record<string, unknown>;
  return {
    scheduleId: snapshot.scheduleId as string,
    scheduleName: snapshot.scheduleName as string,
    scheduleRevision: snapshot.scheduleRevision as number,
    recurrence: validateRecurrence(snapshot.recurrence),
    title: snapshot.title as string,
    introduction: snapshot.introduction as string,
    acknowledgement: snapshot.acknowledgement as string,
    notePlaceholder: snapshot.notePlaceholder as string,
    labels: createManagerCheckInLabels(labels),
    visibilityNotice: {
      version: 1,
      text: notice.text as string,
    },
  };
}

function validateRecurrence(value: unknown): ManagerCheckInRecurrence {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.startsOn !== "string" || !isValidDateString(value.startsOn)) {
    throw new Error("Manager check-in recurrence is invalid.");
  }
  const kind = value.kind;
  if (kind === "daily" && Number.isSafeInteger(value.intervalDays) && (value.intervalDays as number) > 0 && (value.intervalDays as number) <= 365) {
    return { kind, intervalDays: value.intervalDays as number, startsOn: value.startsOn };
  }
  if (kind === "weekly" && Number.isSafeInteger(value.intervalWeeks) && (value.intervalWeeks as number) > 0 && (value.intervalWeeks as number) <= 52 && Array.isArray(value.weekdays)) {
    return { kind, intervalWeeks: value.intervalWeeks as number, startsOn: value.startsOn, weekdays: validateIntegers(value.weekdays, 0, 6) };
  }
  if (kind === "monthly" && Number.isSafeInteger(value.intervalMonths) && (value.intervalMonths as number) > 0 && (value.intervalMonths as number) <= 12) {
    return { kind, intervalMonths: value.intervalMonths as number, startsOn: value.startsOn, ...validateDateSelection(value) };
  }
  if (kind === "quarterly" && Array.isArray(value.quarterMonths)) {
    return { kind, startsOn: value.startsOn, quarterMonths: validateIntegers(value.quarterMonths, 1, 3), ...validateDateSelection(value) };
  }
  throw new Error("Manager check-in recurrence is invalid.");
}

function validateDateSelection(value: Record<string, unknown>): { readonly dates: readonly number[] } | { readonly lastDay: true } {
  if (value.lastDay === true && value.dates === undefined) return { lastDay: true };
  if (value.lastDay === undefined && Array.isArray(value.dates)) return { dates: validateIntegers(value.dates, 1, 31) };
  throw new Error("Manager check-in recurrence is invalid.");
}

function validateIntegers(value: readonly unknown[], min: number, max: number): readonly number[] {
  if (value.length === 0 || value.some((item) => !Number.isSafeInteger(item) || (item as number) < min || (item as number) > max)) {
    throw new Error("Manager check-in recurrence is invalid.");
  }
  const result = [...value] as number[];
  if (new Set(result).size !== result.length) throw new Error("Manager check-in recurrence is invalid.");
  return result.sort((left, right) => left - right);
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function boundedApiErrorCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9_.-]{1,64}$/.test(value) ? value : undefined;
}

function validManagerCheckInLabels(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  if (Object.keys(value).length !== managerCheckInFeelingCodes.length) {
    return false;
  }
  return managerCheckInFeelingCodes.every((code) => boundedString(value[code], 80));
}

function isValidManagerCheckInNote(value: unknown): value is string | null {
  return value === null
    || (typeof value === "string" && value.length <= 1000);
}

function isValidManagerCheckInOrganization(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && onlyKeys(value, ["id", "name"])
    && boundedString(value.id, 160)
    && boundedString(value.name, 200);
}

function isValidManagerCheckInVisibilityNotice(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && onlyKeys(value, ["version", "text"])
    && value.version === 1
    && value.text === managerCheckInVisibilityNotice;
}

function isValidManagerCheckInEmployee(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  return isRecord(value)
    && onlyKeys(value, ["id", "displayName"])
    && boundedString(value.id, 160)
    && boundedString(value.displayName, 120);
}

function isValidManagerCheckInCursor(value: unknown): boolean {
  return typeof value === "string" && value.length <= 256;
}

function createManagerCheckInLabels(
  labels: Record<string, unknown>,
): Record<ManagerCheckInFeelingCode, string> {
  return Object.fromEntries(
    managerCheckInFeelingCodes.map((code) => [code, labels[code] as string]),
  ) as Record<ManagerCheckInFeelingCode, string>;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

async function readErrorBody(response: Response): Promise<{
  readonly error?: { readonly code?: string; readonly details?: unknown };
}> {
  try {
    const bytes = await readBytes(response, maxResponseBytes);
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isRecord(parsed) || !isRecord(parsed.error)) return {};
    return {
      error: {
        ...(typeof parsed.error.code === "string" && parsed.error.code.length <= 128 ? { code: parsed.error.code } : {}),
        ...(parsed.error.details !== undefined ? { details: parsed.error.details } : {}),
      },
    };
  } catch {
    return {};
  }
}
