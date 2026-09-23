import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "../src/index.mjs";

const TOKEN = "a".repeat(43);
const CONFIG = {
  COMPOSIO_API_KEY: "server-only-key",
  COMPOSIO_IDENTITY_HMAC_KEY: "hmac-secret-that-is-at-least-32-bytes-long",
  COMPOSIO_GOOGLE_AUTH_CONFIG_ID: "ac_google_read_only",
  COMPOSIO_OUTLOOK_AUTH_CONFIG_ID: "ac_outlook_read_only",
  PROFILE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  IP_RATE_LIMITER: { limit: async () => ({ success: true }) },
  LINK_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

function request(path, body = {}, headers = {}) {
  return new Request(`https://broker.example.test${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "cf-connecting-ip": "203.0.113.4", ...headers },
    body: JSON.stringify({ pluginId: "openpets.deadline-buddy", ...body }),
  });
}

async function payload(response) { return response.json(); }

function fakeComposio(handler) {
  const calls = [];
  const failures = [];
  const fetchImpl = async (url, init) => {
    const call = { url: String(url), ...init, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    let result;
    try { result = await handler(String(url), call, calls); }
    catch (error) { failures.push(String(error)); throw error; }
    return Response.json(result.body ?? result, { status: result.status ?? 200 });
  };
  return { calls, failures, fetchImpl };
}

function connectedAccount(url, { status = "ACTIVE", userId = undefined, toolkit = "googlecalendar", authConfig = "ac_google_read_only" } = {}) {
  const requestedUserId = new URL(url).searchParams.get("user_ids");
  return {
    items: [{ id: "ca_abc12345", user_id: userId ?? requestedUserId, status, toolkit: { slug: toolkit }, auth_config: { id: authConfig }, experimental: { account_type: "PRIVATE" } }],
  };
}

test("Connect Link uses Composio managed auth and binds the link to a private local profile", async () => {
  const upstream = fakeComposio((url, init) => {
    if (url.includes("/connected_accounts?")) return { items: [] };
    assert.equal(url, "https://backend.composio.dev/api/v3.1/connected_accounts/link");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["x-api-key"], CONFIG.COMPOSIO_API_KEY);
    assert.equal(init.body.auth_config_id, CONFIG.COMPOSIO_GOOGLE_AUTH_CONFIG_ID);
    assert.match(init.body.user_id, /^openpets_local_[a-f0-9]{48}$/);
    assert.equal(init.body.alias, "openpets-deadline-buddy-google");
    assert.deepEqual(init.body.experimental, { account_type: "PRIVATE" });
    return { redirect_url: "https://connect.composio.dev/link/connect-token", connected_account_id: "ca_abc12345" };
  });
  const response = await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  const result = await payload(response);
  assert.equal(response.status, 200, JSON.stringify(upstream.failures));
  assert.deepEqual(result, { state: "link_opened", linkUrl: "https://connect.composio.dev/link/connect-token" });
  assert.equal(JSON.stringify(result).includes(CONFIG.COMPOSIO_API_KEY), false);
  assert.equal(JSON.stringify(result).includes("ca_abc12345"), false);
});

test("status only trusts a private account matching user, toolkit, and auth config", async () => {
  const upstream = fakeComposio((url) => ({
    items: [
      { id: "ca_wrong123", user_id: "someone_else", status: "ACTIVE", toolkit: { slug: "googlecalendar" }, auth_config: { id: "ac_google_read_only" } },
      { id: "ca_good123", user_id: new URL(url).searchParams.get("user_ids"), status: "ACTIVE", toolkit: { slug: "googlecalendar" }, auth_config: { id: "ac_google_read_only" }, experimental: { account_type: "PRIVATE" } },
    ],
  }));
  const response = await handleRequest(request("/v1/calendar/status", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => new Date("2026-09-23T12:00:00.000Z") });
  assert.deepEqual(await payload(response), { provider: "google", state: "connected", checkedAt: "2026-09-23T12:00:00.000Z" });
});

test("Google calendar/event reads are fixed GET proxy operations and only return normalized fields", async () => {
  const upstream = fakeComposio((url, init) => {
    if (url.includes("/connected_accounts?")) return connectedAccount(url);
    assert.equal(url, "https://backend.composio.dev/api/v3.1/tools/execute/proxy");
    assert.equal(init.method, "POST");
    assert.equal(init.body.connected_account_id, "ca_abc12345");
    assert.equal(init.body.method, "GET");
    assert.match(init.body.endpoint, /^https:\/\/www\.googleapis\.com\/calendar\/v3\//);
    const endpoint = new URL(init.body.endpoint);
    if (init.body.endpoint.includes("calendarList")) {
      return { status: 200, data: { items: [{ id: "primary", summary: "Work\u0000 Calendar", timeZone: "Europe/London", primary: true, hidden: true, accessRole: "owner" }] } };
    }
    if (endpoint.pathname.endsWith("/events/event-1")) {
      assert.equal(endpoint.searchParams.get("fields"), "id,summary,start,end,status,updated");
      return { status: 200, data: {
        id: "event-1", summary: "Planning\nmeeting", status: "confirmed", updated: "2026-09-20T10:00:00Z",
        start: { dateTime: "2026-09-24T10:00:00Z", timeZone: "Europe/London" }, end: { dateTime: "2026-09-24T11:00:00Z", timeZone: "Europe/London" }, description: "private",
      } };
    }
    return { status: 200, data: { items: [
      { id: "event-1", summary: "Planning\nmeeting", status: "confirmed", updated: "2026-09-20T10:00:00Z", start: { dateTime: "2026-09-24T10:00:00Z", timeZone: "Europe/London" }, end: { dateTime: "2026-09-24T11:00:00Z", timeZone: "Europe/London" }, description: "private" },
    ] } };
  });
  const calendars = await handleRequest(request("/v1/calendar/calendars", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  assert.deepEqual(await payload(calendars), { calendars: [{ id: "primary", name: "Work Calendar", timeZone: "Europe/London", primary: true }], truncated: false });
  const events = await handleRequest(request("/v1/calendar/events", { provider: "google", calendarId: "primary", from: "2026-09-23T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  const result = await payload(events);
  assert.deepEqual(result.events[0], {
    id: "event-1", calendarId: "primary", title: "Planning meeting", status: "confirmed", updatedAt: "2026-09-20T10:00:00.000Z",
    allDay: false, startAt: "2026-09-24T10:00:00.000Z", endAt: "2026-09-24T11:00:00.000Z", timeZone: "Europe/London",
  });
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.ok(upstream.calls.filter((call) => call.url.endsWith("/tools/execute/proxy")).every((call) => call.body.method === "GET"));
  const event = await handleRequest(request("/v1/calendar/event", { provider: "google", calendarId: "primary", eventId: "event-1", calendarTimeZone: "Europe/London" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  const eventResult = await payload(event);
  assert.equal(eventResult.title, "Planning meeting");
  assert.equal("description" in eventResult, false);
});

test("Google all-day deadline resolves the local end-of-day across a DST transition", async () => {
  const upstream = fakeComposio((url, init) => {
    if (url.includes("/connected_accounts?")) return connectedAccount(url);
    assert.equal(init.body.method, "GET");
    assert.equal(new URL(init.body.endpoint).searchParams.get("timeZone"), "America/Los_Angeles");
    return { status: 200, data: { items: [{
      id: "day-1", summary: "Workshop", status: "confirmed",
      start: { date: "2026-03-08" },
      end: { date: "2026-03-09" },
    }] } };
  });
  const response = await handleRequest(request("/v1/calendar/events", { provider: "google", calendarId: "primary", from: "2026-03-01T00:00:00Z", to: "2026-04-01T00:00:00Z", calendarTimeZone: "America/Los_Angeles" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  const result = await payload(response);
  assert.equal(result.events[0].startDate, "2026-03-08");
  assert.equal(result.events[0].endDateExclusive, "2026-03-09");
  assert.equal(result.events[0].dueAt, "2026-03-09T06:59:59.999Z");
});

test("Outlook all-day events preserve local dates while deadlines use the exact UTC instant", async () => {
  const upstream = fakeComposio((url, init) => {
    if (url.includes("/connected_accounts?")) return connectedAccount(url, { toolkit: "outlook", authConfig: "ac_outlook_read_only" });
    const requestBody = init.body;
    assert.equal(requestBody.method, "GET");
    assert.match(requestBody.endpoint, /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/calendars\//);
    if (requestBody.parameters?.some((parameter) => parameter.name === "Prefer")) {
      assert.match(requestBody.parameters[0].value, /outlook\.timezone="Pacific Standard Time"/);
      return { status: 200, data: { id: "all-day-1", isAllDay: true, start: { dateTime: "2026-03-08T00:00:00.0000000", timeZone: "Pacific Standard Time" }, end: { dateTime: "2026-03-09T00:00:00.0000000", timeZone: "Pacific Standard Time" }, originalStartTimeZone: "Pacific Standard Time" } };
    }
    return { status: 200, data: { value: [{
      id: "all-day-1", subject: "Conference", isAllDay: true, isCancelled: false,
      start: { dateTime: "2026-03-08T08:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-03-09T07:00:00.0000000", timeZone: "UTC" },
      originalStartTimeZone: "Pacific Standard Time",
    }] } };
  });
  const response = await handleRequest(request("/v1/calendar/events", { provider: "outlook", calendarId: "calendar-1", from: "2026-03-01T00:00:00Z", to: "2026-04-01T00:00:00Z" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  const result = await payload(response);
  assert.equal(response.status, 200);
  assert.equal(result.events[0].startDate, "2026-03-08");
  assert.equal(result.events[0].endDateExclusive, "2026-03-09");
  assert.equal(result.events[0].dueAt, "2026-03-09T06:59:59.999Z");
});

test("disconnect revokes upstream credentials before deleting only the owned account", async () => {
  const upstream = fakeComposio((url, init) => {
    if (url.includes("/connected_accounts?")) return connectedAccount(url, { toolkit: "outlook", authConfig: "ac_outlook_read_only" });
    if (url.endsWith("/ca_abc12345/revoke")) { assert.equal(init.method, "POST"); return { revoked_tokens: ["access_token", "refresh_token"] }; }
    if (url.includes("/ca_abc12345?revoke_on_delete=true")) { assert.equal(init.method, "DELETE"); return { deleted: true }; }
    throw new Error(`Unexpected Composio URL ${url}`);
  });
  const response = await handleRequest(request("/v1/calendar/disconnect", { provider: "outlook" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  assert.deepEqual(await payload(response), { disconnected: true }, JSON.stringify(upstream.failures));
  assert.deepEqual(upstream.calls.filter((call) => call.url.includes("/ca_abc12345")).map((call) => call.method), ["POST", "DELETE"]);
});

test("rejects arbitrary methods, operations, scopes, and excessive windows before provider proxy", async () => {
  const upstream = fakeComposio(() => { throw new Error("Must not call Composio"); });
  const invalidMethod = await handleRequest(new Request("https://broker.example.test/v1/calendar/status", { method: "GET" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  assert.equal(invalidMethod.status, 405);
  const arbitrary = await handleRequest(request("/v1/calendar/execute", { provider: "google", url: "https://attacker.test", method: "POST" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  assert.equal(arbitrary.status, 404);
  const unsupportedProvider = await handleRequest(request("/v1/calendar/events", { provider: "composio", calendarId: "x", from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  assert.equal(unsupportedProvider.status, 400);
  const excessiveRange = await handleRequest(request("/v1/calendar/events", { provider: "google", calendarId: "x", from: "2026-01-01T00:00:00Z", to: "2026-06-01T00:00:00Z" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  assert.equal(excessiveRange.status, 400);
  const invalidPlugin = await handleRequest(request("/v1/calendar/status", { provider: "google", pluginId: "../other-plugin" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  assert.equal(invalidPlugin.status, 400);
  const oversizedBody = await handleRequest(request("/v1/calendar/status", { provider: "google", padding: "x".repeat(20_000) }), CONFIG, { fetchImpl: upstream.fetchImpl });
  assert.equal(oversizedBody.status, 413);
  const invalidTimeZone = await handleRequest(request("/v1/calendar/events", { provider: "google", calendarId: "x", from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z", calendarTimeZone: "Not/A_Timezone" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  assert.equal(invalidTimeZone.status, 400);
  assert.equal(upstream.calls.length, 0);
});

test("rate limits fail closed when Cloudflare bindings are absent or exhausted", async () => {
  const noLimiters = { ...CONFIG, PROFILE_RATE_LIMITER: undefined };
  const missing = await handleRequest(request("/v1/calendar/status", { provider: "google" }), noLimiters, { fetchImpl: async () => { throw new Error("unexpected"); } });
  assert.equal(missing.status, 503);
  const limited = { ...CONFIG, PROFILE_RATE_LIMITER: { limit: async () => ({ success: false }) } };
  const blocked = await handleRequest(request("/v1/calendar/status", { provider: "google" }), limited, { fetchImpl: async () => { throw new Error("unexpected"); } });
  assert.equal(blocked.status, 429);
});

test("ignores connected accounts with mismatched ownership or configured auth", async () => {
  const upstream = fakeComposio((url) => ({ items: [
    { id: "ca_abc12345", user_id: new URL(url).searchParams.get("user_ids"), status: "ACTIVE", toolkit: { slug: "googlecalendar" }, auth_config: { id: "another_auth_config" } },
    { id: "ca_no_owner1", user_id: new URL(url).searchParams.get("user_ids"), status: "ACTIVE", toolkit: { slug: "googlecalendar" }, auth_config: { id: "ac_google_read_only" } },
  ] }));
  const response = await handleRequest(request("/v1/calendar/status", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  assert.equal((await payload(response)).state, "not_connected");
});

test("single Google all-day event fetch resolves the calendar timezone when the caller omits it", async () => {
  const upstream = fakeComposio((url, init) => {
    if (url.includes("/connected_accounts?")) return connectedAccount(url);
    const endpoint = new URL(init.body.endpoint);
    assert.equal(init.body.method, "GET");
    if (endpoint.pathname === "/calendar/v3/users/me/calendarList/primary") {
      assert.equal(endpoint.searchParams.get("fields"), "id,timeZone");
      return { status: 200, data: { id: "primary", timeZone: "America/Los_Angeles" } };
    }
    if (endpoint.pathname === "/calendar/v3/calendars/primary/events/event-all-day") {
      return { status: 200, data: {
        id: "event-all-day", summary: "Workshop", status: "confirmed",
        start: { date: "2026-03-08" }, end: { date: "2026-03-09" },
      } };
    }
    throw new Error(`Unexpected provider URL ${endpoint}`);
  });

  const response = await handleRequest(request("/v1/calendar/event", {
    provider: "google", calendarId: "primary", eventId: "event-all-day",
  }), CONFIG, { fetchImpl: upstream.fetchImpl });
  const result = await payload(response);

  assert.equal(response.status, 200);
  assert.equal(result.timeZone, "America/Los_Angeles");
  assert.equal(result.dueAt, "2026-03-09T06:59:59.999Z");
  assert.equal(upstream.calls.filter((call) => call.url.endsWith("/tools/execute/proxy")).length, 2);
});

test("calendar account ownership and disconnect are isolated by plugin", async () => {
  const accounts = [];
  const removed = [];
  const upstream = fakeComposio((url, init) => {
    if (url.includes("/connected_accounts?")) return { items: accounts };
    const accountId = /\/connected_accounts\/(ca_[^/?]+)/.exec(url)?.[1];
    if (url.endsWith(`/${accountId}/revoke`)) { removed.push(accountId); return { revoked_tokens: [] }; }
    if (url.includes(`/${accountId}?revoke_on_delete=true`)) { removed.push(accountId); return { deleted: true }; }
    throw new Error(`Unexpected Composio URL ${url}`);
  });

  for (const pluginId of ["openpets.deadline-buddy", "openpets.other-calendar"]) {
    const response = await handleRequest(request("/v1/calendar/status", { provider: "google", pluginId }), CONFIG, { fetchImpl: upstream.fetchImpl });
    assert.equal(response.status, 200);
  }
  const userIds = upstream.calls
    .filter((call) => call.url.includes("/connected_accounts?"))
    .map((call) => new URL(call.url).searchParams.get("user_ids"));
  assert.notEqual(userIds[0], userIds[1], "each plugin must have a distinct Composio owner id for one local profile");

  accounts.push(
    { id: "ca_plugin_a123", user_id: userIds[0], status: "ACTIVE", toolkit: { slug: "googlecalendar" }, auth_config: { id: "ac_google_read_only" }, experimental: { account_type: "PRIVATE" } },
    { id: "ca_plugin_b123", user_id: userIds[1], status: "ACTIVE", toolkit: { slug: "googlecalendar" }, auth_config: { id: "ac_google_read_only" }, experimental: { account_type: "PRIVATE" } },
  );
  const disconnect = await handleRequest(request("/v1/calendar/disconnect", {
    provider: "google", pluginId: "openpets.deadline-buddy",
  }), CONFIG, { fetchImpl: upstream.fetchImpl });

  assert.equal(disconnect.status, 200);
  assert.deepEqual(removed, ["ca_plugin_a123", "ca_plugin_a123"]);
});
