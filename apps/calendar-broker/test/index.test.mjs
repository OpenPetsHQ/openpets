import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createHmac } from "node:crypto";

import worker, { handleRequest as workerHandleRequest } from "../src/index.mjs";

const TOKEN = "a".repeat(43);
const OTHER_TOKEN = "b".repeat(43);
const FIXED_NOW = new Date("2026-09-23T12:00:00.000Z");
let requestSequence = 0;
let lastConnectRequestId = null;
const CONFIG = {
  COMPOSIO_API_KEY: "server-only-key",
  COMPOSIO_IDENTITY_HMAC_KEY: "hmac-secret-that-is-at-least-32-bytes-long",
  COMPOSIO_CALLBACK_ENCRYPTION_KEY: "A".repeat(43),
  COMPOSIO_CALLBACK_VERIFIER_ENABLED: "1",
  COMPOSIO_GOOGLE_AUTH_CONFIG_ID: "ac_google_read_only",
  COMPOSIO_OUTLOOK_AUTH_CONFIG_ID: "ac_outlook_read_only",
  CONNECT_ATTEMPT_STORE: memoryStore(),
  PROFILE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  IP_RATE_LIMITER: { limit: async () => ({ success: true }) },
  LINK_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

beforeEach(() => {
  CONFIG.CONNECT_ATTEMPT_STORE = memoryStore();
  requestSequence = 0;
  lastConnectRequestId = null;
});

// Provider and lifecycle tests exercise the broker's internal protocol through
// the named handler. The deployed Worker entrypoint never supplies this option;
// security tests below call it without the test seam to prove production fails closed.
function handleRequest(request, env, options = {}) {
  return workerHandleRequest(request, env, { allowCalendarProtocolForTests: true, ...options });
}

function request(path, body = {}, headers = {}) {
  const requestBody = { pluginId: "openpets.deadline-buddy", ...body };
  if (path === "/v1/calendar/connect") {
    requestBody.requestId ??= (++requestSequence).toString(36).padStart(43, "0");
    lastConnectRequestId = requestBody.requestId;
  }
  if (path === "/v1/calendar/connect/cancel") requestBody.requestId ??= lastConnectRequestId ?? "C".repeat(43);
  return new Request(`https://broker.example.test${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "cf-connecting-ip": "203.0.113.4", ...headers },
    body: JSON.stringify(requestBody),
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

function connectionFlowUpstream({ failComplete = undefined, completeAccountId = undefined, preservePendingOnFailure = false, onComplete = undefined, accountOverrides = {} } = {}) {
  let userId;
  let accountId = "ca_abc12345";
  let status = "INITIALIZING";
  let completionFailure = failComplete;
  const accountDetails = (id, accountStatus) => ({
    id,
    user_id: userId,
    status: accountStatus,
    toolkit: { slug: "googlecalendar" },
    auth_config: { id: "ac_google_read_only" },
    experimental: { account_type: "PRIVATE" },
    ...accountOverrides,
  });
  const mocked = fakeComposio(async (url, init) => {
    if (url.includes("/connected_accounts?")) {
      return new URL(url).searchParams.get("user_ids") === userId
        ? { items: [accountDetails(accountId, status)] }
        : { items: [] };
    }
    if (url.endsWith("/connected_accounts/link")) {
      userId = init.body.user_id;
      return { redirect_url: "https://connect.composio.dev/link/connect-token", connected_account_id: accountId, expires_at: new Date(FIXED_NOW.getTime() + 5 * 60_000).toISOString() };
    }
    if (url.endsWith("/connected_accounts/complete_auth")) {
      if (completionFailure !== undefined) {
        if (completionFailure === 400 && !preservePendingOnFailure) status = "FAILED";
        if (completionFailure === 500) status = "ACTIVE";
        return { status: completionFailure, body: { error: "not verified" } };
      }
      status = "ACTIVE";
      await onComplete?.();
      return { connected_account_id: completeAccountId ?? accountId, toolkit_slug: "googlecalendar" };
    }
    const accountPath = init.method === "GET" ? url.match(/\/connected_accounts\/(ca_[A-Za-z0-9_-]+)/) : null;
    if (accountPath) {
      const requestedAccountId = accountPath[1];
      const accountStatus = requestedAccountId === accountId ? status : "ACTIVE";
      if (requestedAccountId !== accountId && requestedAccountId !== completeAccountId) {
        return { status: 404, body: { error: "not found" } };
      }
      return { status: 200, body: accountDetails(requestedAccountId, accountStatus) };
    }
    if (/\/connected_accounts\/ca_[A-Za-z0-9_-]+\/revoke$/.test(url)) return { revoked_tokens: [] };
    if (/\/connected_accounts\/ca_[A-Za-z0-9_-]+\?revoke_on_delete=true/.test(url)) return { deleted: true };
    throw new Error(`Unexpected Composio URL ${url}`);
  });
  return { ...mocked, activateAccount: () => { status = "ACTIVE"; }, allowComplete: () => { completionFailure = undefined; } };
}

function callbackRequest(sessionUri) {
  const url = new URL("https://broker.example.test/v1/calendar/connect/callback");
  url.searchParams.set("session_uri", sessionUri);
  return new Request(url, { method: "GET", headers: { "cf-connecting-ip": "203.0.113.4" } });
}

function connectedAccount(url, { status = "ACTIVE", userId = undefined, toolkit = "googlecalendar", authConfig = "ac_google_read_only" } = {}) {
  const requestedUserId = new URL(url).searchParams.get("user_ids");
  return {
    items: [{ id: "ca_abc12345", user_id: userId ?? requestedUserId, status, toolkit: { slug: toolkit }, auth_config: { id: authConfig }, experimental: { account_type: "PRIVATE" } }],
  };
}

function memoryStore() {
  const attempts = new Map();
  const cancelledRequests = new Map();
  let lockId = null;
  return {
    attempts,
    async create(attempt, now) {
      if (lockId && attempts.get(lockId)?.expires_at > now) return false;
      const cancellation = cancelledRequests.get(attempt.requestIdHash);
      if (cancellation?.expires_at > now && cancellation.profile_id === attempt.profileId
        && cancellation.plugin_id === attempt.pluginId && cancellation.provider === attempt.provider) return false;
      attempts.set(attempt.attemptId, {
        attempt_id: attempt.attemptId, request_id_hash: attempt.requestIdHash, profile_id: attempt.profileId, plugin_id: attempt.pluginId,
        provider: attempt.provider, user_id: attempt.userId, connected_account_id: null,
        state: "creating", callback_count: 0, expires_at: attempt.expiresAt, created_at: now, updated_at: now,
      });
      lockId = attempt.attemptId;
      return true;
    },
    async setLink(id, accountId, expiresAt, now) {
      const row = attempts.get(id);
      if (!row || row.state !== "creating" || lockId !== id) return false;
      Object.assign(row, { connected_account_id: accountId, expires_at: expiresAt, state: "link_opened", updated_at: now });
      return true;
    },
    async getCurrent(now) {
      const row = attempts.get(lockId);
      return row && row.expires_at > now ? row : null;
    },
    async getLatest(profileId, pluginId, provider) {
      return [...attempts.values()].reverse().find((row) => row.profile_id === profileId && row.plugin_id === pluginId && row.provider === provider) ?? null;
    },
    async getByRequestIdHash(requestIdHash, profileId, pluginId, provider) {
      return [...attempts.values()].find((row) => row.request_id_hash === requestIdHash && row.profile_id === profileId && row.plugin_id === pluginId && row.provider === provider) ?? null;
    },
    async isRequestCancelled(requestIdHash, profileId, pluginId, provider, now) {
      const cancellation = cancelledRequests.get(requestIdHash);
      return Boolean(cancellation && cancellation.expires_at > now && cancellation.profile_id === profileId
        && cancellation.plugin_id === pluginId && cancellation.provider === provider);
    },
    async cancelRequest(request, now, expiresAt, verifyingBefore) {
      const previous = cancelledRequests.get(request.requestIdHash);
      if (!previous || (previous.profile_id === request.profileId && previous.plugin_id === request.pluginId && previous.provider === request.provider)) {
        cancelledRequests.set(request.requestIdHash, {
          profile_id: request.profileId, plugin_id: request.pluginId, provider: request.provider, expires_at: expiresAt,
        });
      }
      const row = await this.getByRequestIdHash(request.requestIdHash, request.profileId, request.pluginId, request.provider);
      if (!row) return false;
      if (row.state === "verifying" && row.updated_at > verifyingBefore) return true;
      if (!(row.state === "creating" || row.state === "link_opened" || row.state === "callback_ready"
        || row.state === "completion_unknown" || row.state === "verifying")) return false;
      Object.assign(row, { state: "cancelled", session_cipher: null, ticket_hash: null, updated_at: now });
      if (lockId === row.attempt_id) lockId = null;
      return true;
    },
    async verifyIfNotCancelled(id, now) {
      const row = attempts.get(id);
      if (!row || row.state !== "completion_unknown" || await this.isRequestCancelled(row.request_id_hash, row.profile_id, row.plugin_id, row.provider, now)) return false;
      Object.assign(row, { state: "verified", session_cipher: null, ticket_hash: null, updated_at: now });
      if (lockId === id) lockId = null;
      return true;
    },
    async listForProfile(profileId, pluginId, provider) {
      return [...attempts.values()].filter((row) => row.profile_id === profileId && row.plugin_id === pluginId && row.provider === provider);
    },
    async storeCallback(id, cipher, ticketHash, now) {
      const row = attempts.get(id);
      if (!row || row.state !== "link_opened" || row.expires_at <= now || row.ticket_hash || row.callback_count >= 3) return false;
      Object.assign(row, { state: "callback_ready", session_cipher: cipher, ticket_hash: ticketHash, callback_count: row.callback_count + 1, updated_at: now });
      return true;
    },
    async getByTicketHash(hash) { return [...attempts.values()].find((row) => row.ticket_hash === hash) ?? null; },
    async claimTicket(id, profileId, hash, now) {
      const row = attempts.get(id);
      if (!row || row.state !== "callback_ready" || row.profile_id !== profileId || row.ticket_hash !== hash || row.expires_at <= now) return false;
      Object.assign(row, { state: "verifying", ticket_hash: null, updated_at: now });
      return true;
    },
    async restoreLink(id, now) {
      const row = attempts.get(id);
      if (!row || row.state !== "verifying" || row.expires_at <= now || row.callback_count >= 3 || lockId !== id) return false;
      Object.assign(row, { state: "link_opened", session_cipher: null, ticket_hash: null, updated_at: now });
      return true;
    },
    async setState(id, state, now) {
      const row = attempts.get(id);
      if (!row) return false;
      Object.assign(row, { state, updated_at: now });
      if (["verified", "cancelled", "expired", "failed", "completion_unknown"].includes(state)) {
        row.session_cipher = null;
        row.ticket_hash = null;
      }
      if (["verified", "cancelled", "expired", "failed"].includes(state) && lockId === id) lockId = null;
      return true;
    },
  };
}

function seedVerifiedAttempt(provider = "google", accountId = "ca_abc12345", userId = "openpets_local_test_owner") {
  const profileId = `openpets_profile_${createHmac("sha256", CONFIG.COMPOSIO_IDENTITY_HMAC_KEY).update(`profile:${TOKEN}`).digest("hex").slice(0, 48)}`;
  const attempt = {
    attempt_id: `attempt-${provider}`, profile_id: profileId, plugin_id: "openpets.deadline-buddy", provider,
    user_id: userId, connected_account_id: accountId, state: "verified", expires_at: Date.now() + 600_000,
    created_at: Date.now(), updated_at: Date.now(),
  };
  CONFIG.CONNECT_ATTEMPT_STORE.attempts.set(attempt.attempt_id, attempt);
  return attempt;
}

test("Connect Link uses Composio managed auth and binds the link to a private local profile", async () => {
  const upstream = fakeComposio((url, init) => {
    if (url.includes("/connected_accounts?")) return { items: [] };
    assert.equal(url, "https://backend.composio.dev/api/v3.1/connected_accounts/link");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["x-api-key"], CONFIG.COMPOSIO_API_KEY);
    assert.equal(init.body.auth_config_id, CONFIG.COMPOSIO_GOOGLE_AUTH_CONFIG_ID);
    assert.match(init.body.user_id, /^openpets_local_[a-f0-9]{48}$/);
    assert.deepEqual(init.body.experimental, { account_type: "PRIVATE" });
    assert.match(init.body.alias, /^openpets-openpets\.deadline-buddy-google-[A-Za-z0-9_-]{8}$/);
    return { redirect_url: "https://connect.composio.dev/link/connect-token", connected_account_id: "ca_abc12345", expires_at: new Date(Date.now() + 5 * 60_000).toISOString() };
  });
  const response = await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  const result = await payload(response);
  assert.equal(response.status, 200, JSON.stringify(upstream.failures));
  assert.deepEqual(result, { state: "link_opened", linkUrl: "https://connect.composio.dev/link/connect-token" });
  assert.equal(JSON.stringify(result).includes(CONFIG.COMPOSIO_API_KEY), false);
  assert.equal(JSON.stringify(result).includes("ca_abc12345"), false);
});

test("callback requires a local-profile one-time ticket before Composio activates the connection", async () => {
  const upstream = connectionFlowUpstream();
  const link = await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal(link.status, 200);
  const attempt = [...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0];
  const callback = await handleRequest(callbackRequest("https://session.composio.dev/deferred/opaque"), CONFIG, { now: () => FIXED_NOW });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(callback.headers.get("referrer-policy"), "no-referrer");
  const handoff = callback.headers.get("location");
  const ticket = new URL(handoff).searchParams.get("ticket");
  assert.match(ticket, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(handoff.includes("session.composio.dev"), false);
  assert.equal(JSON.stringify(await payload(link)).includes(attempt.connected_account_id), false);
  assert.equal(attempt.state, "callback_ready");
  assert.equal(attempt.session_cipher.includes("opaque"), false, "deferred auth URI is encrypted at rest");

  const completed = await handleRequest(request("/v1/calendar/connect/complete", { ticket }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  const completedBody = await payload(completed);
  assert.equal(completed.status, 200, JSON.stringify(completedBody));
  assert.deepEqual(completedBody, { completed: true });
  assert.equal(attempt.state, "verified");
  const completeCall = upstream.calls.find((call) => call.url.endsWith("/connected_accounts/complete_auth"));
  assert.equal(completeCall.body.session_uri, "https://session.composio.dev/deferred/opaque");
  assert.equal(completeCall.body.user_id, attempt.user_id, "Composio verifies the attempt-scoped owner before activation");
  assert.equal(completeCall.headers["x-api-key"], CONFIG.COMPOSIO_API_KEY);
  assert.equal(JSON.stringify(completedBody).includes(CONFIG.COMPOSIO_API_KEY), false);

  const status = await handleRequest(request("/v1/calendar/status", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal((await payload(status)).state, "connected");
});

test("a reused Composio return cannot mint another local-profile handoff ticket", async () => {
  const upstream = connectionFlowUpstream();
  await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  await handleRequest(callbackRequest("https://session.composio.dev/deferred/opaque"), CONFIG, { now: () => FIXED_NOW });
  const ticket = new URL((await handleRequest(callbackRequest("https://session.composio.dev/duplicate"), CONFIG, { now: () => FIXED_NOW })).headers.get("location") ?? "https://invalid").searchParams.get("ticket");
  assert.equal(ticket, null, "a second callback cannot mint a second handoff ticket");
});

test("a profile mismatch is rejected without burning the ticket; the initiating profile can recover", async () => {
  const upstream = connectionFlowUpstream();
  await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  const callback = await handleRequest(callbackRequest("https://session.composio.dev/deferred/opaque"), CONFIG, { now: () => FIXED_NOW });
  const ticket = new URL(callback.headers.get("location")).searchParams.get("ticket");
  const wrongProfile = await handleRequest(request("/v1/calendar/connect/complete", { ticket }, { authorization: `Bearer ${OTHER_TOKEN}` }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal(wrongProfile.status, 403);
  assert.equal(upstream.calls.some((call) => call.url.endsWith("/connected_accounts/complete_auth")), false);
  const originalProfile = await handleRequest(request("/v1/calendar/connect/complete", { ticket }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal(originalProfile.status, 200);
  assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "verified");
});

test("callback, ticket, and Composio completion are single-use; replay does not fire twice", async () => {
  const upstream = connectionFlowUpstream();
  await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  const callback = await handleRequest(callbackRequest("https://session.composio.dev/deferred/opaque"), CONFIG, { now: () => FIXED_NOW });
  const ticket = new URL(callback.headers.get("location")).searchParams.get("ticket");
  const first = await handleRequest(request("/v1/calendar/connect/complete", { ticket }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  const second = await handleRequest(request("/v1/calendar/connect/complete", { ticket }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(upstream.calls.filter((call) => call.url.endsWith("/connected_accounts/complete_auth")).length, 1);
  const replayedCallback = await handleRequest(callbackRequest("https://session.composio.dev/deferred/opaque"), CONFIG, { now: () => FIXED_NOW });
  assert.equal(replayedCallback.status, 410);
});

test("an intercepted return for a different account cannot activate either account", async () => {
  const upstream = connectionFlowUpstream({ completeAccountId: "ca_intercepted9" });
  await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  const callback = await handleRequest(callbackRequest("https://session.composio.dev/deferred/intercepted"), CONFIG, { now: () => FIXED_NOW });
  const ticket = new URL(callback.headers.get("location")).searchParams.get("ticket");
  const result = await handleRequest(request("/v1/calendar/connect/complete", { ticket }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal(result.status, 502);
  assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "failed");
  assert.equal(upstream.calls.some((call) => call.method === "DELETE" && call.url.includes("ca_intercepted9")), true, "unexpected same-owner account is cleaned up");
  const status = await handleRequest(request("/v1/calendar/status", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.notEqual((await payload(status)).state, "connected");
});

test("a malformed account owned by this attempt is rejected and revoked without touching another owner", async () => {
  const upstream = connectionFlowUpstream({ accountOverrides: { auth_config: { id: "ac_unexpected" } } });
  await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  const callback = await handleRequest(callbackRequest("https://session.composio.dev/deferred/wrong-auth-config"), CONFIG, { now: () => FIXED_NOW });
  const ticket = new URL(callback.headers.get("location")).searchParams.get("ticket");
  const result = await handleRequest(request("/v1/calendar/connect/complete", { ticket }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal(result.status, 409);
  assert.equal((await payload(result)).error, "connection_identity_mismatch");
  assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "failed");
  assert.equal(upstream.calls.filter((call) => call.url.endsWith("/revoke")).length, 1, "only the rejected attempt-owned account is revoked");
  assert.equal(upstream.calls.filter((call) => call.method === "DELETE").length, 1);
  const status = await handleRequest(request("/v1/calendar/status", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal((await payload(status)).state, "not_connected");
});

test("an upstream ACTIVE status cannot bypass the verified callback handoff", async () => {
  const upstream = connectionFlowUpstream();
  await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  upstream.activateAccount();
  const response = await handleRequest(request("/v1/calendar/status", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal((await payload(response)).state, "not_connected");
  assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "failed");
  assert.equal(upstream.calls.filter((call) => call.url.endsWith("/revoke")).length, 1);
  assert.equal(upstream.calls.filter((call) => call.method === "DELETE").length, 1);
});

test("a claimed ticket plus ACTIVE status cannot recover before complete_auth was recorded", async () => {
  const upstream = connectionFlowUpstream();
  await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  const callback = await handleRequest(callbackRequest("https://session.composio.dev/deferred/not-yet-completed"), CONFIG, { now: () => FIXED_NOW });
  const ticket = new URL(callback.headers.get("location")).searchParams.get("ticket");
  const attempt = [...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0];
  assert.equal(await CONFIG.CONNECT_ATTEMPT_STORE.claimTicket(attempt.attempt_id, attempt.profile_id, attempt.ticket_hash, FIXED_NOW.getTime()), true);
  upstream.activateAccount();
  const status = await handleRequest(request("/v1/calendar/status", { provider: "google" }), CONFIG, {
    fetchImpl: upstream.fetchImpl,
    now: () => new Date(FIXED_NOW.getTime() + 61_000),
  });
  assert.equal((await payload(status)).state, "not_connected");
  assert.equal(attempt.state, "failed");
  assert.equal(upstream.calls.some((call) => call.url.endsWith("/complete_auth")), false);
  assert.equal(upstream.calls.filter((call) => call.method === "DELETE").length, 1);
});

test("expired and cancelled attempts reject later browser returns", async () => {
  {
    const upstream = connectionFlowUpstream();
    await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
    const response = await handleRequest(callbackRequest("https://session.composio.dev/deferred/expired"), CONFIG, { now: () => new Date(FIXED_NOW.getTime() + 10 * 60_000) });
    assert.equal(response.status, 410);
    assert.equal(upstream.calls.some((call) => call.url.endsWith("/complete_auth")), false);
  }
  {
    CONFIG.CONNECT_ATTEMPT_STORE = memoryStore();
    const upstream = connectionFlowUpstream();
    await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
    const cancelled = await handleRequest(request("/v1/calendar/disconnect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
    assert.equal(cancelled.status, 200);
    assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "cancelled");
    const response = await handleRequest(callbackRequest("https://session.composio.dev/deferred/cancelled"), CONFIG, { now: () => FIXED_NOW });
    assert.equal(response.status, 410);
    assert.equal(upstream.calls.filter((call) => call.method === "DELETE").length, 1);
  }
});

test("a late cancelled-flow callback cannot poison a newer attempt and callback retries are bounded", async () => {
  const upstream = connectionFlowUpstream({ failComplete: 400, preservePendingOnFailure: true });
  await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  await handleRequest(request("/v1/calendar/connect/cancel", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  const nextLink = await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal((await payload(nextLink)).state, "link_opened");

  const staleCallback = await handleRequest(callbackRequest("https://session.composio.dev/deferred/from-cancelled-flow"), CONFIG, { now: () => FIXED_NOW });
  const staleTicket = new URL(staleCallback.headers.get("location")).searchParams.get("ticket");
  const staleResult = await handleRequest(request("/v1/calendar/connect/complete", { ticket: staleTicket }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal(staleResult.status, 409);
  const attempt = [...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()].at(-1);
  assert.equal(attempt.state, "link_opened", "the new attempt remains available after a stale callback");

  upstream.allowComplete();
  const currentCallback = await handleRequest(callbackRequest("https://session.composio.dev/deferred/from-current-flow"), CONFIG, { now: () => FIXED_NOW });
  const currentTicket = new URL(currentCallback.headers.get("location")).searchParams.get("ticket");
  const currentResult = await handleRequest(request("/v1/calendar/connect/complete", { ticket: currentTicket }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal(currentResult.status, 200);
  assert.equal(attempt.state, "verified");

  CONFIG.CONNECT_ATTEMPT_STORE = memoryStore();
  const bounded = connectionFlowUpstream({ failComplete: 400, preservePendingOnFailure: true });
  await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: bounded.fetchImpl, now: () => FIXED_NOW });
  for (let attemptNumber = 0; attemptNumber < 3; attemptNumber += 1) {
    const callback = await handleRequest(callbackRequest(`https://session.composio.dev/deferred/rejected-${attemptNumber}`), CONFIG, { now: () => FIXED_NOW });
    const ticket = new URL(callback.headers.get("location")).searchParams.get("ticket");
    const completion = await handleRequest(request("/v1/calendar/connect/complete", { ticket }), CONFIG, { fetchImpl: bounded.fetchImpl, now: () => FIXED_NOW });
    assert.equal(completion.status, 409);
  }
  assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "failed", "rejected callback recovery has a finite retry bound");
});

test("host cancellation retires the exact pending attempt and releases the global callback slot", async () => {
  const upstream = connectionFlowUpstream();
  await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  const cancelled = await handleRequest(request("/v1/calendar/connect/cancel", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.deepEqual(await payload(cancelled), { cancelled: true });
  assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "cancelled");
  assert.equal(upstream.calls.filter((call) => call.method === "DELETE").length, 1);
  assert.equal(upstream.calls.some((call) => call.url.endsWith("/connected_accounts/complete_auth")), false);
});

test("connect cancellation is request-scoped and also closes the cancel-before-create race", async () => {
  const firstRequestId = "A".repeat(43);
  const otherRequestId = "B".repeat(43);
  const earlyCancelledRequestId = "C".repeat(43);
  let links = 0;
  let userId;
  let accountId;
  const upstream = fakeComposio((url, init) => {
    if (url.includes("/connected_accounts?")) {
      const requestedUserId = new URL(url).searchParams.get("user_ids");
      return requestedUserId === userId && accountId ? { items: [{
        id: accountId, user_id: userId, status: "INITIALIZING", toolkit: { slug: "googlecalendar" },
        auth_config: { id: "ac_google_read_only" }, experimental: { account_type: "PRIVATE" },
      }] } : { items: [] };
    }
    if (url.endsWith("/connected_accounts/link")) {
      links += 1;
      userId = init.body.user_id;
      accountId = `ca_reqscope${links}`;
      return { redirect_url: "https://connect.composio.dev/link/request-scope", connected_account_id: accountId, expires_at: new Date(FIXED_NOW.getTime() + 5 * 60_000).toISOString() };
    }
    if (url.endsWith(`/connected_accounts/${accountId}`)) return {
      id: accountId, user_id: userId, status: "INITIALIZING", toolkit: { slug: "googlecalendar" },
      auth_config: { id: "ac_google_read_only" }, experimental: { account_type: "PRIVATE" },
    };
    if (/\/connected_accounts\/ca_[A-Za-z0-9_-]+\?revoke_on_delete=true/.test(url)) return { deleted: true };
    throw new Error(`Unexpected Composio URL ${url}`);
  });
  const started = await handleRequest(request("/v1/calendar/connect", { provider: "google", requestId: firstRequestId }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal((await payload(started)).state, "link_opened");
  const mismatchedCancel = await handleRequest(request("/v1/calendar/connect/cancel", { provider: "google", requestId: otherRequestId }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.deepEqual(await payload(mismatchedCancel), { cancelled: false });
  assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "link_opened");

  const cancelled = await handleRequest(request("/v1/calendar/connect/cancel", { provider: "google", requestId: firstRequestId }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.deepEqual(await payload(cancelled), { cancelled: true });
  assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "cancelled");

  const earlyCancel = await handleRequest(request("/v1/calendar/connect/cancel", { provider: "google", requestId: earlyCancelledRequestId }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.deepEqual(await payload(earlyCancel), { cancelled: false });
  const lateConnect = await handleRequest(request("/v1/calendar/connect", { provider: "google", requestId: earlyCancelledRequestId }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.deepEqual(await payload(lateConnect), { state: "cancelled" });
  assert.equal(links, 1, "a cancelled request that arrives late never creates a Composio link");
});

test("a cancellation racing complete_auth prevents the ACTIVE account from being verified", async () => {
  const requestId = "D".repeat(43);
  const upstream = connectionFlowUpstream({ onComplete: async () => {
    const attempt = [...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0];
    assert.equal(attempt.state, "verifying");
    assert.equal(await CONFIG.CONNECT_ATTEMPT_STORE.cancelRequest({
      requestIdHash: attempt.request_id_hash,
      profileId: attempt.profile_id,
      pluginId: attempt.plugin_id,
      provider: attempt.provider,
    }, FIXED_NOW.getTime(), FIXED_NOW.getTime() + 10 * 60_000, FIXED_NOW.getTime() - 60_000), true);
  } });
  await handleRequest(request("/v1/calendar/connect", { provider: "google", requestId }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  const callback = await handleRequest(callbackRequest("https://session.composio.dev/deferred/cancel-race"), CONFIG, { now: () => FIXED_NOW });
  const ticket = new URL(callback.headers.get("location")).searchParams.get("ticket");
  const response = await handleRequest(request("/v1/calendar/connect/complete", { ticket }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });

  assert.equal(response.status, 409);
  assert.equal((await payload(response)).error, "connection_verification_cancelled");
  assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "cancelled");
  assert.equal(upstream.calls.filter((call) => call.method === "DELETE").length, 1);
  const status = await handleRequest(request("/v1/calendar/status", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal((await payload(status)).state, "not_connected");
});

test("concurrent profile/provider flows serialize globally to prevent callback mix-ups", async () => {
  let links = 0;
  const upstream = fakeComposio((url, init) => {
    if (url.includes("/connected_accounts?")) return { items: [] };
    if (url.endsWith("/connected_accounts/link")) {
      links += 1;
      return { redirect_url: `https://connect.composio.dev/link/link-${links}`, connected_account_id: `ca_concurrent${links}`, expires_at: new Date(FIXED_NOW.getTime() + 5 * 60_000).toISOString() };
    }
    throw new Error(`Unexpected Composio URL ${url}`);
  });
  const [google, outlook] = await Promise.all([
    handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW }),
    handleRequest(request("/v1/calendar/connect", { provider: "outlook" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW }),
  ]);
  const states = [await payload(google), await payload(outlook)].map((item) => item.state).sort();
  assert.deepEqual(states, ["busy", "link_opened"]);
  assert.equal(links, 1);
});

test("failed identity verification never activates; transient completion recovers by exact account ownership", async () => {
  {
    const upstream = connectionFlowUpstream({ failComplete: 400 });
    await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
    const callback = await handleRequest(callbackRequest("https://session.composio.dev/deferred/wrong-owner"), CONFIG, { now: () => FIXED_NOW });
    const ticket = new URL(callback.headers.get("location")).searchParams.get("ticket");
    const result = await handleRequest(request("/v1/calendar/connect/complete", { ticket }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
    assert.equal(result.status, 409);
    assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "failed");
    assert.equal(upstream.calls.some((call) => call.url.endsWith("/connected_accounts/complete_auth")), true);
    assert.equal(upstream.calls.some((call) => call.method === "DELETE"), true);
  }
  {
    CONFIG.CONNECT_ATTEMPT_STORE = memoryStore();
    const upstream = connectionFlowUpstream({ failComplete: 500 });
    await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
    const callback = await handleRequest(callbackRequest("https://session.composio.dev/deferred/transient"), CONFIG, { now: () => FIXED_NOW });
    const ticket = new URL(callback.headers.get("location")).searchParams.get("ticket");
    const result = await handleRequest(request("/v1/calendar/connect/complete", { ticket }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
    assert.equal(result.status, 502);
    assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "completion_unknown");
    const recovered = await handleRequest(request("/v1/calendar/status", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
    assert.equal((await payload(recovered)).state, "connected");
    assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "verified");
  }
  {
    CONFIG.CONNECT_ATTEMPT_STORE = memoryStore();
    const upstream = connectionFlowUpstream({ failComplete: 502 });
    await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
    const callback = await handleRequest(callbackRequest("https://session.composio.dev/deferred/recoverable"), CONFIG, { now: () => FIXED_NOW });
    const ticket = new URL(callback.headers.get("location")).searchParams.get("ticket");
    const result = await handleRequest(request("/v1/calendar/connect/complete", { ticket }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
    assert.equal(result.status, 502);
    const shortlyAfter = await handleRequest(request("/v1/calendar/status", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => new Date(FIXED_NOW.getTime() + 30_000) });
    assert.equal((await payload(shortlyAfter)).state, "pending", "transient absence is recoverable during the bounded grace period");
    assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "completion_unknown");
    const afterGrace = await handleRequest(request("/v1/calendar/status", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => new Date(FIXED_NOW.getTime() + 61_000) });
    assert.equal((await payload(afterGrace)).state, "not_connected");
    assert.equal([...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0].state, "failed");
    assert.equal(upstream.calls.filter((call) => call.url.endsWith("/connected_accounts/complete_auth")).length, 1, "the one-shot Composio verifier is never retried");
  }
});

test("callback decryption failure cannot recover an ACTIVE account without dispatching complete_auth", async () => {
  const upstream = connectionFlowUpstream();
  const connected = await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal((await payload(connected)).state, "link_opened");
  const callback = await handleRequest(callbackRequest("https://session.composio.dev/deferred/corrupted"), CONFIG, { now: () => FIXED_NOW });
  const ticket = new URL(callback.headers.get("location")).searchParams.get("ticket");
  const attempt = [...CONFIG.CONNECT_ATTEMPT_STORE.attempts.values()][0];
  attempt.session_cipher = "tampered.ciphertext";
  upstream.activateAccount();

  const response = await handleRequest(request("/v1/calendar/connect/complete", { ticket }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });

  assert.equal(response.status, 409);
  assert.equal((await payload(response)).error, "connection_verification_failed");
  assert.equal(attempt.state, "failed");
  assert.equal(upstream.calls.some((call) => call.url.endsWith("/complete_auth")), false);
  assert.equal(upstream.calls.filter((call) => call.method === "DELETE").length, 1);
  const retry = await handleRequest(request("/v1/calendar/connect", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => FIXED_NOW });
  assert.equal((await payload(retry)).state, "link_opened", "a clean connection attempt can recover after the corrupt attempt is retired");
});

test("legacy active account status is never accepted without a verified attempt", async () => {
  const upstream = fakeComposio((url) => ({
    items: [
      { id: "ca_wrong123", user_id: "someone_else", status: "ACTIVE", toolkit: { slug: "googlecalendar" }, auth_config: { id: "ac_google_read_only" } },
      { id: "ca_good123", user_id: new URL(url).searchParams.get("user_ids"), status: "ACTIVE", toolkit: { slug: "googlecalendar" }, auth_config: { id: "ac_google_read_only" }, experimental: { account_type: "PRIVATE" } },
    ],
  }));
  const response = await handleRequest(request("/v1/calendar/status", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl, now: () => new Date("2026-09-23T12:00:00.000Z") });
  assert.deepEqual(await payload(response), { provider: "google", state: "reauth_required", checkedAt: "2026-09-23T12:00:00.000Z" });
});

test("Google calendar/event reads are fixed GET proxy operations and only return normalized fields", async () => {
  seedVerifiedAttempt();
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
  seedVerifiedAttempt();
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
  seedVerifiedAttempt("outlook");
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
  const verifiedAttempt = seedVerifiedAttempt("outlook");
  const upstream = fakeComposio((url, init) => {
    if (url.includes("/connected_accounts?")) return new URL(url).searchParams.get("user_ids") === verifiedAttempt.user_id
      ? connectedAccount(url, { toolkit: "outlook", authConfig: "ac_outlook_read_only" })
      : { items: [] };
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

test("calendar Connect fails closed until verifier and encrypted attempt storage are explicitly configured", async () => {
  const upstream = fakeComposio(() => { throw new Error("Composio must not be contacted while verification is disabled"); });
  const disabled = await handleRequest(request("/v1/calendar/connect", { provider: "google" }), { ...CONFIG, COMPOSIO_CALLBACK_VERIFIER_ENABLED: "0" }, { fetchImpl: upstream.fetchImpl });
  assert.equal(disabled.status, 503);
  assert.deepEqual(await payload(disabled), { error: "connection_verification_not_configured" });
  assert.equal(upstream.calls.length, 0);
});

test("deployed Worker rejects connection, callback, status, and calendar reads without independent browser identity", async () => {
  const upstream = fakeComposio(() => { throw new Error("Composio must not be contacted"); });
  const storeBefore = CONFIG.CONNECT_ATTEMPT_STORE.attempts.size;
  const connect = await worker.fetch(request("/v1/calendar/connect", { provider: "google" }), CONFIG);
  assert.equal(connect.status, 503);
  assert.deepEqual(await payload(connect), { error: "calendar_identity_verification_unavailable" });

  const callback = await worker.fetch(callbackRequest("https://session.composio.dev/deferred/intercepted"), CONFIG);
  assert.equal(callback.status, 503);
  assert.equal(callback.headers.get("location"), null);

  for (const route of ["/v1/calendar/connect/complete", "/v1/calendar/status", "/v1/calendar/calendars", "/v1/calendar/events", "/v1/calendar/event"]) {
    const response = await worker.fetch(request(route, { provider: "google", ticket: "A".repeat(43) }), CONFIG);
    assert.equal(response.status, 503, route);
    assert.deepEqual(await payload(response), { error: "calendar_identity_verification_unavailable" }, route);
  }

  assert.equal(CONFIG.CONNECT_ATTEMPT_STORE.attempts.size, storeBefore, "blocked calls cannot create or verify an attempt");
  assert.equal(upstream.calls.length, 0, "owner-ID equality and upstream ACTIVE status are not independent browser identity");
});

test("ignores connected accounts with mismatched ownership or configured auth", async () => {
  seedVerifiedAttempt();
  const upstream = fakeComposio((url) => ({ items: [
    { id: "ca_abc12345", user_id: new URL(url).searchParams.get("user_ids"), status: "ACTIVE", toolkit: { slug: "googlecalendar" }, auth_config: { id: "another_auth_config" } },
    { id: "ca_no_owner1", user_id: new URL(url).searchParams.get("user_ids"), status: "ACTIVE", toolkit: { slug: "googlecalendar" }, auth_config: { id: "ac_google_read_only" } },
  ] }));
  const response = await handleRequest(request("/v1/calendar/status", { provider: "google" }), CONFIG, { fetchImpl: upstream.fetchImpl });
  assert.equal((await payload(response)).state, "reauth_required");
});

test("Google primary alias accepts its canonical calendar ID when resolving all-day timezones", async () => {
  seedVerifiedAttempt();
  const upstream = fakeComposio((url, init) => {
    if (url.includes("/connected_accounts?")) return connectedAccount(url);
    const endpoint = new URL(init.body.endpoint);
    assert.equal(init.body.method, "GET");
    if (endpoint.pathname === "/calendar/v3/users/me/calendarList/primary") {
      assert.equal(endpoint.searchParams.get("fields"), "id,timeZone");
      return { status: 200, data: { id: "calendar-owner@example.com", timeZone: "America/Los_Angeles" } };
    }
    if (endpoint.pathname === "/calendar/v3/calendars/primary/events/event-all-day") {
      return { status: 200, data: {
        id: "event-all-day", summary: "Workshop", status: "confirmed",
        start: { date: "2026-03-08" }, end: { date: "2026-03-09" },
      } };
    }
    if (endpoint.pathname === "/calendar/v3/calendars/primary/events") {
      return { status: 200, data: { items: [{
        id: "event-all-day-list", summary: "Workshop", status: "confirmed",
        start: { date: "2026-03-08" }, end: { date: "2026-03-09" },
      }] } };
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

  const events = await handleRequest(request("/v1/calendar/events", {
    provider: "google", calendarId: "primary", from: "2026-03-01T00:00:00Z", to: "2026-04-01T00:00:00Z",
  }), CONFIG, { fetchImpl: upstream.fetchImpl });
  const listResult = await payload(events);
  assert.equal(events.status, 200);
  assert.equal(listResult.events[0].dueAt, "2026-03-09T06:59:59.999Z");
});

test("Google timezone lookup rejects a canonical-ID mismatch for non-primary calendars", async () => {
  seedVerifiedAttempt();
  const upstream = fakeComposio((url, init) => {
    if (url.includes("/connected_accounts?")) return connectedAccount(url);
    const endpoint = new URL(init.body.endpoint);
    if (endpoint.pathname === "/calendar/v3/calendars/secondary/events/event-all-day") {
      return { status: 200, data: {
        id: "event-all-day", summary: "Workshop", status: "confirmed",
        start: { date: "2026-03-08" }, end: { date: "2026-03-09" },
      } };
    }
    if (endpoint.pathname === "/calendar/v3/users/me/calendarList/secondary") {
      return { status: 200, data: { id: "canonical-secondary@example.com", timeZone: "America/Los_Angeles" } };
    }
    throw new Error(`Unexpected provider URL ${endpoint}`);
  });
  const response = await handleRequest(request("/v1/calendar/event", {
    provider: "google", calendarId: "secondary", eventId: "event-all-day",
  }), CONFIG, { fetchImpl: upstream.fetchImpl });
  assert.equal(response.status, 502);
  assert.deepEqual(await payload(response), { error: "calendar_provider_invalid_response" });
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
