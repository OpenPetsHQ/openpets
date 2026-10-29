import { allowedReactions, type OpenPetsReaction } from "@open-pets/pet-format/reactions";
export { allowedReactions, type OpenPetsReaction } from "@open-pets/pet-format/reactions";
import { randomUUID } from "node:crypto";
import { extname, isAbsolute } from "node:path";

export const openPetsIpcProtocol = "openpets-ipc";
export const openPetsIpcVersion = 1;
export const maxIpcMessageBytes = 16 * 1024;
export const transientDisplayMs = 4_000;
export const maxMediaFileBytes = 10 * 1024 * 1024;
export const minMediaDurationMs = 1_000;
export const maxMediaDurationMs = 30_000;
export const defaultMediaDurationMs = 8_000;
export const allowedMediaExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif"] as const;

export type OpenPetsIpcMethod = "hello" | "status" | "pets.list" | "pets.install" | "lease.acquire" | "lease.heartbeat" | "lease.release" | "pet.react" | "pet.say" | "pet.showMedia" | "pets.install-local";

export interface OpenPetsIpcRequest {
  readonly id: string;
  readonly version: number;
  readonly token: string;
  readonly method: OpenPetsIpcMethod;
  readonly params?: unknown;
}

export interface OpenPetsIpcResponse {
  readonly id: string | null;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export function createRequestId(): string {
  return randomUUID();
}

export function parseIpcRequest(raw: string, expectedToken: string): OpenPetsIpcRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new IpcProtocolError("invalid_request", "IPC request must be valid JSON.");
  }
  if (!isRecord(parsed)) throw new IpcProtocolError("invalid_request", "IPC request must be an object.");
  if (typeof parsed.id !== "string" || parsed.id.length < 1 || parsed.id.length > 120) throw new IpcProtocolError("invalid_request", "IPC request id is invalid.");
  if (parsed.version !== openPetsIpcVersion) throw new IpcProtocolError("invalid_version", "Unsupported IPC protocol version.");
  if (parsed.token !== expectedToken) throw new IpcProtocolError("invalid_token", "Invalid IPC token.");
  if (parsed.method !== "hello" && parsed.method !== "status" && parsed.method !== "pets.list" && parsed.method !== "pets.install" && parsed.method !== "lease.acquire" && parsed.method !== "lease.heartbeat" && parsed.method !== "lease.release" && parsed.method !== "pet.react" && parsed.method !== "pet.say" && parsed.method !== "pet.showMedia" && parsed.method !== "pets.install-local") {
    throw new IpcProtocolError("unknown_method", "Unknown IPC method.");
  }

  return {
    id: parsed.id,
    version: parsed.version,
    token: parsed.token,
    method: parsed.method,
    params: parsed.params,
  };
}

export function validateInstallPetId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) || value === "builtin") {
    throw new IpcProtocolError("invalid_params", "Invalid pet id.");
  }
  return value;
}

export function validateReaction(value: unknown): OpenPetsReaction {
  if (typeof value !== "string" || !allowedReactions.includes(value as OpenPetsReaction)) {
    throw new IpcProtocolError("invalid_params", "Invalid pet reaction.");
  }
  return value as OpenPetsReaction;
}

export function validateSayMessage(value: unknown): string {
  if (typeof value !== "string") throw new IpcProtocolError("invalid_params", "Message must be a string.");
  const message = value.trim();
  if (message.length < 1) throw new IpcProtocolError("invalid_params", "Message cannot be empty.");
  if (message.length > 140) throw new IpcProtocolError("invalid_params", "Message is too long.");
  if (/[\r\n]/.test(message)) throw new IpcProtocolError("invalid_params", "Message must be single-line.");
  if (/```|<script|function\s+\w+|=>|\b(class|import|export|const|let|var)\b/.test(message)) throw new IpcProtocolError("invalid_params", "Message looks like code.");
  if (/https?:\/\/|www\.|\/[\w.-]+\/[\w./-]+|[A-Za-z]:\\/.test(message)) throw new IpcProtocolError("invalid_params", "Message contains a URL or path-like content.");
  if (/(api[_-]?key|secret|token|password|passwd|BEGIN [A-Z ]+PRIVATE KEY)/i.test(message)) throw new IpcProtocolError("invalid_params", "Message looks secret-like.");
  return message;
}

export function validateOptionalLeaseId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length < 1 || value.length > 120 || /[\0\r\n]/.test(value)) {
    throw new IpcProtocolError("invalid_params", "Invalid lease id.");
  }
  return value;
}

export function validateRequestedPetId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new IpcProtocolError("invalid_params", "Requested pet id must be a string.");
  const trimmed = value.trim();
  if (trimmed.length < 1) return undefined;
  if (Buffer.byteLength(trimmed, "utf8") > 128 || /[\x00-\x1F\x7F/\\]/.test(trimmed)) {
    throw new IpcProtocolError("invalid_params", "Requested pet id is outside CLI bounds.");
  }
  return trimmed;
}

/**
 * Validate the optional sessionNonce from a lease.acquire request.
 * The nonce is a UUID generated once per MCP process (not per-call) and used
 * alongside clientPid to prevent OS PID-reuse session collisions.
 * Accepts any non-empty string ≤128 chars with no control characters.
 */
export function validateSessionNonce(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined; // tolerate missing/malformed — degrade gracefully
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 128 || /[\x00-\x1F\x7F]/.test(trimmed)) return undefined;
  return trimmed;
}

export function okResponse(id: string | null, result: unknown): OpenPetsIpcResponse {
  return { id, ok: true, result };
}

export function errorResponse(id: string | null, error: unknown): OpenPetsIpcResponse {
  if (error instanceof IpcProtocolError) {
    return { id, ok: false, error: { code: error.code, message: error.message } };
  }

  return {
    id,
    ok: false,
    error: {
      code: "internal_error",
      message: error instanceof Error ? error.message : "IPC request failed.",
    },
  };
}

export class IpcProtocolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateInstallLocalPath(value: unknown): string {
  if (typeof value !== "string") {
    throw new IpcProtocolError("invalid_params", "Path must be a string.");
  }
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    throw new IpcProtocolError("invalid_params", "Path cannot be empty.");
  }
  if (Buffer.byteLength(trimmed, "utf8") > 2048) {
    throw new IpcProtocolError("invalid_params", "Path is too long.");
  }
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    throw new IpcProtocolError("invalid_params", "Path contains invalid control characters.");
  }
  if (!isAbsolute(trimmed)) {
    throw new IpcProtocolError("invalid_params", "Path must be absolute.");
  }
  return trimmed;
}

export function validateMediaPath(value: unknown): string {
  const path = validateInstallLocalPath(value);
  const extension = extname(path).toLowerCase();
  if (!allowedMediaExtensions.includes(extension as typeof allowedMediaExtensions[number])) {
    throw new IpcProtocolError("invalid_params", `Media path extension must be one of: ${allowedMediaExtensions.join(", ")}.`);
  }
  return path;
}

/**
 * Schemes that must never reach shell.openExternal from IPC input: local
 * content and script execution (file/javascript/data/...), plain http (no
 * downgrade from https), and Windows shell handlers with side effects.
 * Everything else — https plus custom registered app protocols (the point of
 * this field: hand the click back to the tool that sent the media) — is
 * allowed; an unregistered custom scheme is a no-op at the OS level.
 */
const blockedClickUrlProtocols = new Set(["http:", "file:", "javascript:", "data:", "vbscript:", "blob:", "about:", "chrome:", "ms-appx:", "ms-appx-web:", "shell:", "search-ms:", "search:", "res:"]);

export function validateMediaClickUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new IpcProtocolError("invalid_params", "Click URL must be a string.");
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 2048 || /[\x00-\x1F\x7F\s]/.test(trimmed)) {
    throw new IpcProtocolError("invalid_params", "Click URL is invalid.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new IpcProtocolError("invalid_params", "Click URL must be an absolute URL.");
  }
  if (blockedClickUrlProtocols.has(parsed.protocol.toLowerCase())) {
    throw new IpcProtocolError("invalid_params", "Click URL scheme is not allowed.");
  }
  return trimmed;
}

export function validateMediaDurationMs(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minMediaDurationMs || value > maxMediaDurationMs) {
    throw new IpcProtocolError("invalid_params", `Media duration must be a number between ${minMediaDurationMs} and ${maxMediaDurationMs} milliseconds.`);
  }
  return Math.round(value);
}

export function validateInstallLocalKind(value: unknown): "zip" | "folder" {
  if (value !== "zip" && value !== "folder") {
    throw new IpcProtocolError("invalid_params", "Local install kind must be zip or folder.");
  }
  return value;
}
