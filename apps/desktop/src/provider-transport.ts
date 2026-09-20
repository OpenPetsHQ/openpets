const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_JSON_MAX_BYTES = 2 * 1024 * 1024;
const BINARY_MAX_BYTES = 64 * 1024 * 1024;
const SSE_MAX_BYTES = 32 * 1024 * 1024;
const ERROR_MAX_BYTES = 16 * 1024;
const ERROR_MAX_LENGTH = 1_024;

export type ProviderError = Error & { readonly code: string };

export type ProviderJsonResult = {
  readonly value: unknown;
  readonly bytes: number;
};

export type ProviderSseResult = {
  readonly bytes: number;
};

export type ProviderTransportLease = {
  readonly response: Response;
  readonly readText: (maxBytes: number) => Promise<string>;
  readonly readJson: (maxBytes?: number) => Promise<ProviderJsonResult>;
  readonly readBytes: (maxBytes?: number, message?: string) => Promise<Uint8Array>;
  readonly readSse: (onData: (data: string) => void) => Promise<ProviderSseResult>;
  readonly requestError: (operation: string) => Promise<ProviderError>;
  readonly release: () => Promise<void>;
};

/**
 * Provider-neutral HTTP lifetime and bounded-body boundary. Provider services
 * decide URLs, headers, payloads, and how decoded values are interpreted.
 */
export class ProviderTransport {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(fetchImpl: typeof fetch = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async request(url: string, init: RequestInit, signal?: AbortSignal): Promise<ProviderTransportLease> {
    const controller = new AbortController();
    let rejectLifecycle!: (error: ProviderError) => void;
    const lifecyclePromise = new Promise<never>((_resolve, reject) => {
      rejectLifecycle = reject;
    });
    let timedOut = false;
    let handedOff = false;
    const abort = (): void => {
      controller.abort();
      rejectLifecycle(providerError("Provider request was cancelled.", "provider.cancelled"));
    };

    if (signal?.aborted) {
      throw providerError("Provider request was cancelled.", "provider.cancelled");
    }

    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      rejectLifecycle(providerError("Provider request timed out.", "provider.timeout"));
    }, this.#timeoutMs);

    try {
      const response = await Promise.race([
        this.#fetch(url, { ...init, redirect: "error", signal: controller.signal }),
        lifecyclePromise,
      ]);
      handedOff = true;

      let released = false;
      const release = async (): Promise<void> => {
        if (released) return;
        released = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        await response.body?.cancel().catch(() => undefined);
      };

      return {
        response,
        readText: (maxBytes: number) => readBoundedText(response, maxBytes, lifecyclePromise),
        readJson: (maxBytes = DEFAULT_JSON_MAX_BYTES) => readJson(response, maxBytes, lifecyclePromise),
        readBytes: (maxBytes = BINARY_MAX_BYTES, message = "Provider response is too large.") =>
          readBoundedBytes(response, maxBytes, lifecyclePromise, message),
        readSse: (onData: (data: string) => void) => readSseStream(response, onData, lifecyclePromise),
        requestError: (operation: string) => buildRequestError(response, operation, lifecyclePromise),
        release,
      };
    } catch (error) {
      if (signal?.aborted) {
        throw providerError("Provider request was cancelled.", "provider.cancelled");
      }
      if (timedOut) {
        throw providerError("Provider request timed out.", "provider.timeout");
      }
      throw error;
    } finally {
      if (!handedOff) {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
    }
  }
}

export function providerError(message: string, code: string): ProviderError {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

async function readJson(response: Response, maxBytes: number, lifecyclePromise: Promise<never>): Promise<ProviderJsonResult> {
  const text = await readBoundedText(response, maxBytes, lifecyclePromise);
  try {
    return { value: JSON.parse(text) as unknown, bytes: byteLength(text) };
  } catch {
    throw providerError("Provider returned malformed JSON.", "provider.response.invalid");
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function buildRequestError(response: Response, operation: string, lifecyclePromise: Promise<never>): Promise<ProviderError> {
  let detail = "";
  try {
    detail = providerErrorDetail(await readBoundedText(response, ERROR_MAX_BYTES, lifecyclePromise));
  } catch (error) {
    if (isProviderLifecycleError(error)) throw error;
  }
  const suffix = detail ? `: ${detail}` : "";
  return providerError(`${operation} with HTTP ${response.status}${suffix}.`, "provider.request.failed");
}

function providerErrorDetail(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    return formatProviderErrorValue(JSON.parse(trimmed) as unknown);
  } catch {
    return sanitizeProviderErrorText(trimmed);
  }
}

function formatProviderErrorValue(value: unknown): string {
  if (typeof value === "string") return sanitizeProviderErrorText(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";

  const record = value as Record<string, unknown>;
  const nested = record.detail ?? record.error;
  if (nested !== undefined) {
    const nestedDetail = formatProviderErrorValue(nested);
    if (nestedDetail) return nestedDetail;
  }

  const reason = [record.status, record.code, record.type].find(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  const message = [record.message, record.title].find(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  if (reason && message) return sanitizeProviderErrorText(`${reason}: ${message}`);
  return sanitizeProviderErrorText(message ?? reason ?? "");
}

function sanitizeProviderErrorText(value: string): string {
  return value
    .replace(/\b(?:authorization|x-api-key|xi-api-key|api-key|cookie|set-cookie)\s*:\s*(?:Bearer\s+)?\S+/gi, (match) => match.replace(/:.*/, ": [redacted]"))
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ERROR_MAX_LENGTH);
}

function isProviderLifecycleError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { readonly code?: unknown }).code;
  return code === "provider.cancelled" || code === "provider.timeout";
}

async function readBoundedText(response: Response, maxBytes: number, lifecyclePromise: Promise<never>): Promise<string> {
  const bytes = await readBoundedBytes(response, maxBytes, lifecyclePromise, "Provider response is too large.");
  return new TextDecoder().decode(bytes);
}

async function readBoundedBytes(
  response: Response,
  maxBytes: number,
  lifecyclePromise: Promise<never>,
  message: string,
): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    throw providerError(message, "provider.response.too_large");
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const result = await Promise.race([reader.read(), lifecyclePromise]);
      if (result.done) break;
      const value = result.value;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw providerError(message, "provider.response.too_large");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function readSseStream(
  response: Response,
  onData: (data: string) => void,
  lifecyclePromise: Promise<never>,
): Promise<ProviderSseResult> {
  if (!response.body) return { bytes: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;

  try {
    for (;;) {
      const result = await Promise.race([reader.read(), lifecyclePromise]);
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > SSE_MAX_BYTES) {
        throw providerError("Provider stream is too large.", "provider.response.too_large");
      }

      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const item = line.trim();
        if (!item.startsWith("data:")) continue;
        onData(item.slice(5).trim());
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  return { bytes };
}
