import {
  validateTeamPack,
  type TeamPack,
} from "./team-protocol.js";

export const defaultTeamsApiBaseUrl = "https://openpets-teams-api.tokozedg793.workers.dev";
const maxResponseBytes = 512 * 1024;
const maxArtifactBytes = 50 * 1024 * 1024;
const enrollmentRequestWindowMs = 15 * 60 * 1000;
const enrollmentPollIntervalMs = 1_000;

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
export type TeamEnrollmentRequest = {
  readonly intentId: string;
  readonly status: "awaiting_confirmation" | "confirmed";
  readonly organization: {
    readonly id: string;
    readonly name: string;
  };
  readonly displayName: string;
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
      { credential, signal },
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

  async requestEnrollment(
    intentId: string,
    desktopProof: string,
    installationId: string,
    displayName: string,
    signal?: AbortSignal,
  ): Promise<TeamEnrollmentRequest> {
    validateEnrollmentValues(intentId, desktopProof, installationId, displayName);
    const deadline = Date.now() + enrollmentRequestWindowMs;
    for (;;) {
      try {
        const response = await this.request(
          `/v1/enrollment/intents/${encodeURIComponent(intentId)}/request`,
          {
            method: "POST",
            body: {
              desktopProof,
              deviceInstallationId: installationId,
              displayName,
            },
            signal,
          },
        );
        return validateEnrollmentStatus(response.body, intentId);
      } catch (error) {
        if (!isRetryableEnrollmentTransportError(error) || Date.now() >= deadline) throw error;
        await waitForEnrollmentRetry(deadline, signal);
      }
    }
  }
  async completeEnrollment(
    intentId: string,
    desktopProof: string,
    expiresAt: string,
    signal?: AbortSignal,
  ): Promise<TeamEnrollmentResult> {
    validateEnrollmentProof(intentId, desktopProof);
    const deadline = parseEnrollmentDeadline(expiresAt);
    for (;;) {
      try {
        const response = await this.request(
          `/v1/enrollment/intents/${encodeURIComponent(intentId)}/complete`,
          {
            method: "POST",
            body: { desktopProof },
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
        if (Date.now() >= deadline) throw new Error("Teams enrollment confirmation timed out.");
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
        throw new Error(`Teams API request failed with HTTP ${response.status}.`);
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

function validateEnrollmentStatus(
  body: unknown,
  intentId: string,
): TeamEnrollmentRequest {
  if (
    !isRecord(body)
    || (body.status !== "awaiting_confirmation" && body.status !== "confirmed")
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
    || typeof body.displayName !== "string"
    || body.displayName.length === 0
    || body.displayName.length > 120
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
    displayName: body.displayName,
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
  validateEnrollmentProof(intentId, desktopProof);
  if (
    !/^[A-Za-z0-9._:-]{1,160}$/.test(installationId)
    || displayName.trim().length === 0
    || displayName.length > 120
  ) throw new Error("Teams enrollment input is invalid.");
}

function validateEnrollmentProof(intentId: string, desktopProof: string): void {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(intentId)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(desktopProof)
  ) throw new Error("Teams enrollment proof is invalid.");
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
    || error instanceof Error && /HTTP 409\./.test(error.message);
}

async function waitForEnrollmentRetry(
  deadline: number,
  signal?: AbortSignal,
): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error("Teams enrollment confirmation timed out.");
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
  return error instanceof Error
    && /Teams enrollment window has expired\./.test(error.message)
    ? error
    : new Error("Teams enrollment confirmation timed out.");
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
