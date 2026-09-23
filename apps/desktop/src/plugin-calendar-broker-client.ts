import { randomBytes } from "node:crypto";

import type {
  OpenPetsCalendar,
  OpenPetsCalendarConnectionStatus,
  OpenPetsCalendarEvent,
  OpenPetsCalendarEventListResult,
  OpenPetsCalendarListResult,
  OpenPetsCalendarProvider,
} from "@open-pets/plugin-sdk";

const BROKER_ORIGIN = "https://calendar-broker.openpets.dev";
const CONNECT_ORIGIN = "https://connect.composio.dev";
const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

export interface CalendarBrokerClientOptions {
  getCredential(): Promise<string>;
  openExternal(url: string): Promise<void>;
  fetchImpl?: typeof fetch;
  brokerOrigin?: string;
}

/** Fixed-route client for the first-party broker. It has no arbitrary URL or HTTP method surface. */
export class CalendarBrokerClient {
  readonly #getCredential: () => Promise<string>;
  readonly #openExternal: (url: string) => Promise<void>;
  readonly #fetch: typeof fetch;
  readonly #origin: string;

  constructor(options: CalendarBrokerClientOptions) {
    this.#getCredential = options.getCredential;
    this.#openExternal = options.openExternal;
    this.#fetch = options.fetchImpl ?? fetch;
    const origin = new URL(options.brokerOrigin ?? BROKER_ORIGIN);
    if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) {
      throw new Error("Calendar broker origin must be a fixed HTTPS origin.");
    }
    this.#origin = origin.origin;
  }

  async connect(pluginId: string, provider: OpenPetsCalendarProvider, signal?: AbortSignal): Promise<{ state: "link_opened" | "already_connected" | "pending" | "busy" | "cancelled" }> {
    const requestId = randomBytes(32).toString("base64url");
    let result: unknown;
    try {
      result = await this.#post(pluginId, "/v1/calendar/connect", { provider, requestId }, signal);
    } catch (error) {
      if (signal?.aborted) {
        await this.#cancelConnect(pluginId, provider, requestId);
        throw new Error("Calendar connection was cancelled.");
      }
      throw error;
    }
    if (!isRecord(result)) {
      throw new Error("Calendar broker returned an invalid connection result.");
    }
    switch (result.state) {
      case "already_connected": return { state: "already_connected" };
      case "pending": return { state: "pending" };
      case "busy": return { state: "busy" };
      case "cancelled": return { state: "cancelled" };
      case "link_opened": {
        const link = validateConnectLink(result.linkUrl);
        if (signal?.aborted) {
          await this.#cancelConnect(pluginId, provider, requestId);
          throw new Error("Calendar connection was cancelled.");
        }
        try {
          await this.#openExternal(link);
        } catch (error) {
          await this.#cancelConnect(pluginId, provider, requestId);
          throw error;
        }
        if (signal?.aborted) {
          await this.#cancelConnect(pluginId, provider, requestId);
          throw new Error("Calendar connection was cancelled.");
        }
        return { state: "link_opened" };
      }
      default: throw new Error("Calendar broker returned an invalid connection result.");
    }
  }

  /** Completes the one-time local-profile handoff; this API is host-only. */
  async completeConnectTicket(ticket: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error("Calendar verification ticket is invalid.");
    const result = await this.#postAuthenticated("/v1/calendar/connect/complete", { ticket });
    if (!isRecord(result) || result.completed !== true) throw new Error("Calendar broker did not confirm connection verification.");
  }

  async #cancelConnect(pluginId: string, provider: OpenPetsCalendarProvider, requestId: string): Promise<void> {
    await this.#post(pluginId, "/v1/calendar/connect/cancel", { provider, requestId }).catch(() => undefined);
  }

  async status(pluginId: string, provider: OpenPetsCalendarProvider, signal?: AbortSignal): Promise<OpenPetsCalendarConnectionStatus> {
    try {
      return validateStatus(await this.#post(pluginId, "/v1/calendar/status", { provider }, signal), provider);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (isTransportError(error)) return { provider, state: "offline", checkedAt: new Date().toISOString() };
      throw error;
    }
  }

  async disconnect(pluginId: string, provider: OpenPetsCalendarProvider, signal?: AbortSignal): Promise<void> {
    await this.#post(pluginId, "/v1/calendar/disconnect", { provider }, signal);
  }

  async listCalendars(pluginId: string, provider: OpenPetsCalendarProvider, signal?: AbortSignal): Promise<OpenPetsCalendarListResult> {
    return validateCalendarList(await this.#post(pluginId, "/v1/calendar/calendars", { provider }, signal));
  }

  async listEvents(pluginId: string, provider: OpenPetsCalendarProvider, calendarId: string, range: { from: string; to: string; calendarTimeZone?: string }, signal?: AbortSignal): Promise<OpenPetsCalendarEventListResult> {
    return validateEventList(await this.#post(pluginId, "/v1/calendar/events", { provider, calendarId, ...range }, signal));
  }

  async getEvent(pluginId: string, provider: OpenPetsCalendarProvider, calendarId: string, eventId: string, calendarTimeZone?: string, signal?: AbortSignal): Promise<OpenPetsCalendarEvent | null> {
    const result = await this.#post(pluginId, "/v1/calendar/event", { provider, calendarId, eventId, ...(calendarTimeZone ? { calendarTimeZone } : {}) }, signal);
    return result === null ? null : validateEvent(result);
  }

  async #post(pluginId: string, path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (!/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(pluginId)) throw new Error("Calendar plugin id is invalid.");
    return this.#postAuthenticated(path, { ...body, pluginId }, signal);
  }

  async #postAuthenticated(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const credential = await this.#getCredential();
    if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) throw new Error("Local calendar profile identity is invalid.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.#fetch(`${this.#origin}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${credential}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
      });
      if (!response.ok) throw new CalendarBrokerError(`Calendar broker returned HTTP ${response.status}.`, response.status);
      const text = await readBoundedResponseText(response);
      try {
        const result: unknown = JSON.parse(text);
        return result;
      }
      catch { throw new Error("Calendar broker returned invalid JSON."); }
    } catch (error) {
      if (signal?.aborted) throw new Error("Calendar request was cancelled.");
      if (controller.signal.aborted) throw new CalendarBrokerError("Calendar broker request timed out.", 0);
      if (error instanceof CalendarBrokerError) throw error;
      throw new CalendarBrokerError("Calendar broker is unavailable.", 0);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (totalBytes + value.byteLength > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* The stream may already have failed. */ }
        throw new CalendarBrokerError("Calendar broker response is too large.", 502);
      }
      totalBytes += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CalendarBrokerError("Calendar broker returned invalid JSON.", 502);
  }
}

export class CalendarBrokerError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.name = "CalendarBrokerError"; this.status = status; }
}

function validateConnectLink(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) throw new Error("Calendar broker returned an invalid connect link.");
  const url = new URL(value);
  if (url.origin !== CONNECT_ORIGIN || !url.pathname.startsWith("/link/") || url.username || url.password || url.hash) {
    throw new Error("Calendar broker returned a connect link outside the approved Composio origin.");
  }
  return url.toString();
}

function validateStatus(value: unknown, provider: OpenPetsCalendarProvider): OpenPetsCalendarConnectionStatus {
  if (!isRecord(value) || value.provider !== provider || !isConnectionState(value.state) || !isIso(value.checkedAt)) {
    throw new Error("Calendar broker returned an invalid connection status.");
  }
  return { provider, state: value.state, checkedAt: value.checkedAt };
}

function validateCalendarList(value: unknown): OpenPetsCalendarListResult {
  if (!isRecord(value) || !Array.isArray(value.calendars) || value.calendars.length > 300 || typeof value.truncated !== "boolean") throw new Error("Calendar broker returned an invalid calendar list.");
  const calendars: OpenPetsCalendar[] = value.calendars.map((item) => {
    if (!isRecord(item) || !validIdentifier(item.id) || typeof item.name !== "string" || item.name.length > 200) throw new Error("Calendar broker returned an invalid calendar.");
    if (item.timeZone !== undefined && (typeof item.timeZone !== "string" || item.timeZone.length > 100)) throw new Error("Calendar broker returned an invalid time zone.");
    return { id: item.id, name: cleanText(item.name, 200), ...(typeof item.timeZone === "string" ? { timeZone: item.timeZone } : {}), ...(typeof item.primary === "boolean" ? { primary: item.primary } : {}) };
  });
  return { calendars, truncated: value.truncated };
}

function validateEventList(value: unknown): OpenPetsCalendarEventListResult {
  if (!isRecord(value) || !Array.isArray(value.events) || value.events.length > 300 || typeof value.truncated !== "boolean") throw new Error("Calendar broker returned an invalid event list.");
  return { events: value.events.map(validateEvent), truncated: value.truncated };
}

function validateEvent(value: unknown): OpenPetsCalendarEvent {
  if (!isRecord(value)) {
    throw new Error("Calendar broker returned an invalid event.");
  }
  const id = value.id;
  const calendarId = value.calendarId;
  const title = value.title;
  const status = value.status;
  if (!validIdentifier(id) || !validIdentifier(calendarId) || typeof title !== "string" || title.length > 200 || !isEventStatus(status)) throw new Error("Calendar broker returned an invalid event.");
  if (value.updatedAt !== undefined && !isIso(value.updatedAt)) throw new Error("Calendar broker returned an invalid event timestamp.");
  if (value.timeZone !== undefined && (typeof value.timeZone !== "string" || value.timeZone.length > 100)) throw new Error("Calendar broker returned an invalid event time zone.");
  const base = { id, calendarId, title: cleanText(title, 200), status, ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}), ...(typeof value.timeZone === "string" ? { timeZone: value.timeZone } : {}) };
  if (value.allDay === true) {
    const startDate = value.startDate;
    const endDateExclusive = value.endDateExclusive;
    const dueAt = value.dueAt;
    if (!isDate(startDate) || !isDate(endDateExclusive) || !isIso(dueAt)) throw new Error("Calendar broker returned an invalid all-day event.");
    return { ...base, allDay: true, startDate, endDateExclusive, dueAt };
  }
  const startAt = value.startAt;
  const endAt = value.endAt;
  if (value.allDay !== false || !isIso(startAt) || !isIso(endAt) || Date.parse(endAt) < Date.parse(startAt)) throw new Error("Calendar broker returned an invalid timed event.");
  return { ...base, allDay: false, startAt, endAt };
}

function validIdentifier(value: unknown): value is string { return typeof value === "string" && value.length >= 1 && value.length <= 512 && !/[\0-\x1f\x7f]/.test(value); }
function isIso(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)); }
function isDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)); }
function cleanText(value: string, max: number): string { return value.replace(/[\0-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || "Untitled"; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isConnectionState(value: unknown): value is OpenPetsCalendarConnectionStatus["state"] { return value === "not_connected" || value === "pending" || value === "connected" || value === "reauth_required" || value === "offline"; }
function isEventStatus(value: unknown): value is OpenPetsCalendarEvent["status"] { return value === "confirmed" || value === "cancelled"; }
function isTransportError(error: unknown): boolean { return error instanceof CalendarBrokerError && error.status === 0; }
