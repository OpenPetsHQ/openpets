import assert from "node:assert/strict";

import { CalendarBrokerClient, CalendarBrokerError } from "../src/plugin-calendar-broker-client.js";

const profileIdentity = "A".repeat(43);
const pluginId = "openpets.deadline-buddy";
const checkedAt = "2026-09-23T12:00:00.000Z";
const calendarEvent = {
  id: "event-1",
  calendarId: "primary",
  title: "Planning\nmeeting",
  status: "confirmed",
  allDay: false,
  startAt: "2026-09-24T10:00:00.000Z",
  endAt: "2026-09-24T11:00:00.000Z",
  description: "private provider payload must not cross the host boundary",
};

const calls: Array<{ url: URL; init?: RequestInit; body?: Record<string, unknown> }> = [];
const opened: string[] = [];
const fetchImpl: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const parsedBody: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  const body = isRecord(parsedBody) ? parsedBody : undefined;
  calls.push({ url, init, ...(isRecord(body) ? { body } : {}) });
  switch (url.pathname) {
    case "/v1/calendar/connect":
      return Response.json({ state: "link_opened", linkUrl: "https://connect.composio.dev/link/session-1" });
    case "/v1/calendar/connect/complete":
      return Response.json({ completed: true });
    case "/v1/calendar/status":
      return Response.json({ provider: "google", state: "connected", checkedAt });
    case "/v1/calendar/disconnect":
      return Response.json({ disconnected: true });
    case "/v1/calendar/calendars":
      return Response.json({ calendars: [{ id: "primary", name: "Work\u0000 Calendar", timeZone: "Europe/London", primary: true }], truncated: false });
    case "/v1/calendar/events":
      return Response.json({ events: [calendarEvent], truncated: false });
    case "/v1/calendar/event":
      return Response.json(calendarEvent);
    default:
      return Response.json({ error: "not_found" }, { status: 404 });
  }
};

const client = new CalendarBrokerClient({
  brokerOrigin: "https://broker.example.test",
  getCredential: async () => profileIdentity,
  openExternal: async (url) => { opened.push(url); },
  fetchImpl,
});

assert.deepEqual(await client.connect(pluginId, "google"), { state: "link_opened" });
assert.deepEqual(opened, ["https://connect.composio.dev/link/session-1"]);
assert.deepEqual(await client.status(pluginId, "google"), { provider: "google", state: "connected", checkedAt });
assert.deepEqual(await client.listCalendars(pluginId, "google"), {
  calendars: [{ id: "primary", name: "Work Calendar", timeZone: "Europe/London", primary: true }],
  truncated: false,
});
const events = await client.listEvents(pluginId, "google", "primary", { from: checkedAt, to: "2026-09-25T12:00:00.000Z" });
assert.equal(events.events[0]?.title, "Planning meeting");
assert.equal("description" in (events.events[0] ?? {}), false);
assert.deepEqual(await client.getEvent(pluginId, "google", "primary", "event-1"), {
  id: "event-1", calendarId: "primary", title: "Planning meeting", status: "confirmed",
  allDay: false, startAt: "2026-09-24T10:00:00.000Z", endAt: "2026-09-24T11:00:00.000Z",
});
await client.disconnect(pluginId, "google");
await client.completeConnectTicket("T".repeat(43));
await assert.rejects(() => client.completeConnectTicket("bad-ticket"), /ticket is invalid/);
assert.ok(calls.every(({ url, init }) => url.origin === "https://broker.example.test" && init?.method === "POST"));
assert.ok(calls.every(({ init }) => new Headers(init?.headers).get("authorization") === `Bearer ${profileIdentity}`));
assert.ok(calls.filter(({ url }) => url.pathname !== "/v1/calendar/connect/complete").every(({ body }) => body?.pluginId === pluginId), "plugin broker calls are scoped to the calling plugin");
assert.equal(calls.find(({ url }) => url.pathname === "/v1/calendar/connect/complete")?.body?.ticket, "T".repeat(43));
assert.ok(calls.every(({ body }) => !body || !("token" in body) && !("apiKey" in body) && !("connected_account_id" in body)));
assert.ok(calls.every(({ url }) => [
  "/v1/calendar/connect", "/v1/calendar/connect/complete", "/v1/calendar/connect/cancel", "/v1/calendar/status", "/v1/calendar/disconnect", "/v1/calendar/calendars", "/v1/calendar/events", "/v1/calendar/event",
].includes(url.pathname)));

await assert.rejects(
  () => new CalendarBrokerClient({
    brokerOrigin: "https://broker.example.test",
    getCredential: async () => profileIdentity,
    openExternal: async (url) => { opened.push(url); },
    fetchImpl: async () => Response.json({ state: "link_opened", linkUrl: "https://attacker.example/link/session" }),
  }).connect(pluginId, "google"),
  /outside the approved Composio origin/,
);
assert.equal(opened.length, 1, "untrusted Connect Link origins never open in the system browser");

const cancelledConnectController = new AbortController();
const cancellationPaths: string[] = [];
let cancelledRequestId: string | undefined;
let cancellationRequestId: string | undefined;
const cancelledConnectClient = new CalendarBrokerClient({
  brokerOrigin: "https://broker.example.test",
  getCredential: async () => profileIdentity,
  openExternal: async () => { throw new Error("the cancelled browser should not open"); },
  fetchImpl: async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const body = JSON.parse(String(init?.body ?? "{}")) as { requestId?: string };
    cancellationPaths.push(path);
    if (path === "/v1/calendar/connect") {
      cancelledRequestId = body.requestId;
      cancelledConnectController.abort();
      return Response.json({ state: "link_opened", linkUrl: "https://connect.composio.dev/link/cancel-me" });
    }
    cancellationRequestId = body.requestId;
    return Response.json({ cancelled: true });
  },
});
await assert.rejects(
  () => cancelledConnectClient.connect(pluginId, "google", cancelledConnectController.signal),
  /connection was cancelled/,
);
assert.deepEqual(cancellationPaths, ["/v1/calendar/connect", "/v1/calendar/connect/cancel"]);
assert.match(cancelledRequestId ?? "", /^[A-Za-z0-9_-]{43}$/);
assert.equal(cancellationRequestId, cancelledRequestId, "host cancellation is bound to the exact connect request");

const abortedBeforeLinkController = new AbortController();
const abortedBeforeLinkPaths: string[] = [];
let abortedRequestId: string | undefined;
let abortCancellationRequestId: string | undefined;
const abortedBeforeLinkClient = new CalendarBrokerClient({
  brokerOrigin: "https://broker.example.test",
  getCredential: async () => profileIdentity,
  openExternal: async () => { throw new Error("no browser should open"); },
  fetchImpl: async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const body = JSON.parse(String(init?.body ?? "{}")) as { requestId?: string };
    abortedBeforeLinkPaths.push(path);
    if (path === "/v1/calendar/connect") {
      abortedRequestId = body.requestId;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
      });
    }
    abortCancellationRequestId = body.requestId;
    return Response.json({ cancelled: true });
  },
});
const pendingAbortedConnect = abortedBeforeLinkClient.connect(pluginId, "google", abortedBeforeLinkController.signal);
setTimeout(() => abortedBeforeLinkController.abort(), 0);
await assert.rejects(() => pendingAbortedConnect, /connection was cancelled/);
assert.deepEqual(abortedBeforeLinkPaths, ["/v1/calendar/connect", "/v1/calendar/connect/cancel"]);
assert.equal(abortCancellationRequestId, abortedRequestId, "aborted in-flight requests leave a tombstone for that exact attempt only");

const busyClient = new CalendarBrokerClient({
  brokerOrigin: "https://broker.example.test",
  getCredential: async () => profileIdentity,
  openExternal: async () => { throw new Error("a busy response must not open a browser"); },
  fetchImpl: async () => Response.json({ state: "busy" }),
});
assert.deepEqual(await busyClient.connect(pluginId, "google"), { state: "busy" });

const cancelledClient = new CalendarBrokerClient({
  brokerOrigin: "https://broker.example.test",
  getCredential: async () => profileIdentity,
  openExternal: async () => { throw new Error("a cancelled response must not open a browser"); },
  fetchImpl: async () => Response.json({ state: "cancelled" }),
});
assert.deepEqual(await cancelledClient.connect(pluginId, "google"), { state: "cancelled" });

const offlineClient = new CalendarBrokerClient({
  brokerOrigin: "https://broker.example.test",
  getCredential: async () => profileIdentity,
  openExternal: async () => undefined,
  fetchImpl: async () => { throw new Error("offline"); },
});
const offline = await offlineClient.status(pluginId, "outlook");
assert.equal(offline.state, "offline");
assert.equal(offline.provider, "outlook");

const failedClient = new CalendarBrokerClient({
  brokerOrigin: "https://broker.example.test",
  getCredential: async () => profileIdentity,
  openExternal: async () => undefined,
  fetchImpl: async () => Response.json({ error: "not_authorized" }, { status: 403 }),
});
await assert.rejects(() => failedClient.listCalendars(pluginId, "google"), (error: unknown) => error instanceof CalendarBrokerError && error.status === 403);

assert.throws(
  () => new CalendarBrokerClient({
    brokerOrigin: "http://broker.example.test",
    getCredential: async () => profileIdentity,
    openExternal: async () => undefined,
  }),
  /fixed HTTPS origin/,
);

const multibyteText = JSON.stringify({
  state: "already_connected",
  padding: "€".repeat(180_000),
});
const multibyteBody = new TextEncoder().encode(multibyteText);
assert.ok(multibyteBody.byteLength > 512 * 1024);
assert.ok(multibyteText.length < 512 * 1024, "fixture must fit under the old character-count limit");
let oversizedBodyCancelled = false;
let oversizedChunkIndex = 0;
const splitAt = 400 * 1024;
const oversizedResponse = new Response(new ReadableStream<Uint8Array>({
  pull(controller) {
    if (oversizedChunkIndex === 0) {
      controller.enqueue(multibyteBody.subarray(0, splitAt));
    } else if (oversizedChunkIndex === 1) {
      controller.enqueue(multibyteBody.subarray(splitAt));
    } else {
      controller.close();
    }
    oversizedChunkIndex += 1;
  },
  cancel() { oversizedBodyCancelled = true; },
}, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } });
const oversizedClient = new CalendarBrokerClient({
  brokerOrigin: "https://broker.example.test",
  getCredential: async () => profileIdentity,
  openExternal: async () => undefined,
  fetchImpl: async () => oversizedResponse,
});
await assert.rejects(
  () => oversizedClient.connect(pluginId, "google"),
  (error: unknown) => error instanceof CalendarBrokerError && /response is too large/.test(error.message),
);
assert.equal(oversizedBodyCancelled, true, "rejecting an oversized broker body must cancel its stream");

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

console.log("plugin-calendar-broker-client: all checks passed.");
