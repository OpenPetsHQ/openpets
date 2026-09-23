import { createD1ConnectAttemptStore } from "./connect-attempt-store.mjs";

const COMPOSIO_API = "https://backend.composio.dev/api/v3.1";
const GOOGLE_ORIGIN = "https://www.googleapis.com";
const OUTLOOK_ORIGIN = "https://graph.microsoft.com";
const CONNECT_ORIGIN = "https://connect.composio.dev";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PROVIDER_PAGES = 3;
const PAGE_SIZE = 100;
const CONNECT_ATTEMPT_TTL_MS = 10 * 60_000;
const VERIFY_REQUEST_GRACE_MS = 60_000;
const MAX_SESSION_URI_LENGTH = 4_096;
const MAX_CALLBACK_ATTEMPTS = 3;
const CALENDAR_ROUTES_BLOCKED_WITHOUT_BROWSER_IDENTITY = new Set([
  "/v1/calendar/connect",
  "/v1/calendar/connect/callback",
  "/v1/calendar/connect/complete",
  "/v1/calendar/status",
  "/v1/calendar/calendars",
  "/v1/calendar/events",
  "/v1/calendar/event",
]);
const ALLOWED_PROVIDER = new Set(["google", "outlook"]);
const PROVIDERS = {
  google: { toolkit: "googlecalendar", authConfig: "COMPOSIO_GOOGLE_AUTH_CONFIG_ID" },
  outlook: { toolkit: "outlook", authConfig: "COMPOSIO_OUTLOOK_AUTH_CONFIG_ID" },
};

export default { fetch: (request, env) => handleRequest(request, env) };

export async function handleRequest(request, env, {
  fetchImpl = fetch,
  now = () => new Date(),
  allowCalendarProtocolForTests = false,
} = {}) {
  try {
    const url = new URL(request.url);
    if (!allowCalendarProtocolForTests && CALENDAR_ROUTES_BLOCKED_WITHOUT_BROWSER_IDENTITY.has(url.pathname)) {
      return json({ error: "calendar_identity_verification_unavailable" }, 503);
    }
    if (request.method === "GET" && url.pathname === "/v1/calendar/connect/callback") {
      return await receiveConnectCallback(request, env, { now });
    }
    if (request.method !== "POST") throw httpError(405, "method_not_allowed");
    const route = url.pathname;
    const supportedRoutes = new Set([
      "/v1/calendar/connect", "/v1/calendar/connect/complete", "/v1/calendar/connect/cancel", "/v1/calendar/status", "/v1/calendar/disconnect",
      "/v1/calendar/calendars", "/v1/calendar/events", "/v1/calendar/event",
    ]);
    if (!supportedRoutes.has(route)) throw httpError(404, "not_found");

    const token = parseBearer(request.headers.get("authorization"));
    const body = await readJsonBody(request);
    const profileId = await deriveProfileId(token, env.COMPOSIO_IDENTITY_HMAC_KEY);
    const store = getConnectAttemptStore(env);
    if (route === "/v1/calendar/connect/complete") {
      await enforceRateLimits(env, request, profileId, route);
      return json(await completeConnect({ env, fetchImpl, profileId, store, now }, body));
    }
    const provider = parseProvider(body.provider);
    const pluginId = parsePluginId(body.pluginId);
    const requestIdHash = route === "/v1/calendar/connect" || route === "/v1/calendar/connect/cancel"
      ? await hashConnectRequestId(body.requestId)
      : undefined;
    const rateKey = `${profileId}:${pluginId}`;
    await enforceRateLimits(env, request, rateKey, route);
    const context = { env, fetchImpl, provider, profileId, pluginId, token, store, now };

    switch (route) {
      case "/v1/calendar/connect": return json(await connect(context, requestIdHash));
      case "/v1/calendar/connect/cancel": return json(await cancelConnect(context, requestIdHash));
      case "/v1/calendar/status": return json(await status(context));
      case "/v1/calendar/disconnect": return json(await disconnect(context));
      case "/v1/calendar/calendars": return json(await listCalendars(context));
      case "/v1/calendar/events": return json(await listEvents(context, body));
      case "/v1/calendar/event": return json(await getEvent(context, body));
      default: throw httpError(404, "not_found");
    }
  } catch (error) {
    if (error instanceof BrokerError) return json({ error: error.code }, error.status);
    return json({ error: "calendar_service_unavailable" }, 502);
  }
}

async function connect(context, requestIdHash) {
  assertVerifierConfigured(context.env);
  const existing = await context.store.getLatest(context.profileId, context.pluginId, context.provider);
  if (existing && existing.expires_at <= context.now().getTime() && existing.state !== "verified") {
    await context.store.setState(existing.attempt_id, "expired", context.now().getTime());
    await removeAttemptAccount(context, existing).catch(() => undefined);
  } else if (existing?.state === "verified") {
    const account = await findAttemptAccount(context, existing);
    if (account?.status === "ACTIVE") return { state: "already_connected" };
    await context.store.setState(existing.attempt_id, "failed", context.now().getTime());
    await removeAttemptAccount(context, existing).catch(() => undefined);
  } else if (existing?.state === "verifying") {
    if (context.now().getTime() - existing.updated_at < VERIFY_REQUEST_GRACE_MS) return { state: "pending" };
    await context.store.setState(existing.attempt_id, "failed", context.now().getTime());
    await removeAttemptAccount(context, existing).catch(() => undefined);
  } else if (existing?.state === "completion_unknown") {
    const recovered = await recoverAttempt(context, existing);
    if (recovered) return { state: "already_connected" };
    const latest = await context.store.getLatest(context.profileId, context.pluginId, context.provider);
    if (latest && isActiveAttemptState(latest.state)) return { state: "pending" };
  } else if (existing && isActiveAttemptState(existing.state)) {
    const account = await findAttemptAccount(context, existing);
    if (account?.status === "ACTIVE") {
      await context.store.setState(existing.attempt_id, "failed", context.now().getTime());
      await removeAttemptAccount(context, existing).catch(() => undefined);
    } else {
      return { state: "pending" };
    }
  } else if (existing && ["cancelled", "expired", "failed"].includes(existing.state)) {
    await removeAttemptAccount(context, existing).catch(() => undefined);
  }

  const now = context.now().getTime();
  const attemptId = randomBase64Url(18);
  const userId = await deriveConnectUserId(context.token, context.pluginId, attemptId, context.env.COMPOSIO_IDENTITY_HMAC_KEY);
  const attempt = {
    attemptId,
    requestIdHash,
    profileId: context.profileId,
    pluginId: context.pluginId,
    provider: context.provider,
    userId,
    expiresAt: now + CONNECT_ATTEMPT_TTL_MS,
  };
  if (!await context.store.create(attempt, now)) {
    const cancelled = await context.store.isRequestCancelled(requestIdHash, context.profileId, context.pluginId, context.provider, context.now().getTime());
    return { state: cancelled ? "cancelled" : "busy" };
  }

  let connectedAccountId;
  try {
    // Hold the project callback slot before cleanup so a flow that loses a
    // race cannot delete legacy accounts and then report busy.
    await removeLegacyAccounts(context);
    const result = await composioRequest(context, "POST", "/connected_accounts/link", {
      auth_config_id: requiredConfig(context.env[PROVIDERS[context.provider].authConfig]),
      user_id: userId,
      alias: `openpets-${context.pluginId}-${context.provider}-${attemptId.slice(0, 8)}`,
      experimental: { account_type: "PRIVATE" },
    });
    const linkUrl = validateConnectUrl(result?.redirect_url);
    if (!safeAccountId(result?.connected_account_id)) throw httpError(502, "composio_invalid_response");
    connectedAccountId = result.connected_account_id;
    const apiExpiry = Date.parse(result?.expires_at);
    const expiresAt = Number.isFinite(apiExpiry) ? Math.min(attempt.expiresAt, apiExpiry) : attempt.expiresAt;
    if (expiresAt <= now || !await context.store.setLink(attemptId, result.connected_account_id, expiresAt, now)) {
      throw httpError(502, "connection_attempt_unavailable");
    }
    return { state: "link_opened", linkUrl };
  } catch (error) {
    await context.store.setState(attemptId, "failed", context.now().getTime()).catch(() => undefined);
    if (safeAccountId(connectedAccountId)) await removeAccountById(context, connectedAccountId, "INITIALIZING").catch(() => undefined);
    const orphanedAccounts = await listOwnedAccounts(context, userId).catch(() => []);
    for (const account of orphanedAccounts) await removeOwnedAccount(context, account).catch(() => undefined);
    throw error;
  }
}

async function status(context) {
  const now = context.now().getTime();
  let attempt = await context.store.getLatest(context.profileId, context.pluginId, context.provider);
  if (attempt && attempt.expires_at <= now && attempt.state !== "verified") {
    await context.store.setState(attempt.attempt_id, "expired", now);
    await removeAttemptAccount(context, attempt).catch(() => undefined);
    attempt = { ...attempt, state: "expired" };
  }
  let state = "not_connected";
  if (attempt?.state === "verified") {
    state = (await findAttemptAccount(context, attempt))?.status === "ACTIVE" ? "connected" : "reauth_required";
  } else if (attempt && isActiveAttemptState(attempt.state)) {
    if (attempt.state === "completion_unknown") {
      if (await recoverAttempt(context, attempt)) state = "connected";
      else {
        const latest = await context.store.getLatest(context.profileId, context.pluginId, context.provider);
        state = latest && isActiveAttemptState(latest.state) ? "pending" : "not_connected";
      }
    } else if (attempt.state === "verifying") {
      if (now - attempt.updated_at < VERIFY_REQUEST_GRACE_MS) state = "pending";
      else {
        await context.store.setState(attempt.attempt_id, "failed", now);
        await removeAttemptAccount(context, attempt).catch(() => undefined);
        state = "not_connected";
      }
    } else if (attempt.state === "link_opened" || attempt.state === "callback_ready") {
      const account = await findAttemptAccount(context, attempt);
      if (account?.status === "ACTIVE") {
        await context.store.setState(attempt.attempt_id, "failed", now);
        await removeAttemptAccount(context, attempt).catch(() => undefined);
        state = "not_connected";
      } else {
        state = "pending";
      }
    } else {
      state = "pending";
    }
  } else if ((await listLegacyAccounts(context)).length > 0) {
    state = "reauth_required";
  }
  return { provider: context.provider, state, checkedAt: context.now().toISOString() };
}

async function cancelConnect(context, requestIdHash) {
  const now = context.now().getTime();
  const request = {
    requestIdHash,
    profileId: context.profileId,
    pluginId: context.pluginId,
    provider: context.provider,
  };
  const cancelled = await context.store.cancelRequest(request, now, now + CONNECT_ATTEMPT_TTL_MS, now - VERIFY_REQUEST_GRACE_MS);
  if (cancelled) {
    const cancelledAttempt = await context.store.getByRequestIdHash(requestIdHash, context.profileId, context.pluginId, context.provider);
    if (cancelledAttempt?.state === "cancelled") await removeAttemptAccount(context, cancelledAttempt);
  }
  return { cancelled };
}

async function disconnect(context) {
  const now = context.now().getTime();
  const attempts = await context.store.listForProfile(context.profileId, context.pluginId, context.provider);
  if (attempts.some((attempt) => attempt.state === "verifying" && now - attempt.updated_at < VERIFY_REQUEST_GRACE_MS)) {
    throw httpError(409, "connection_verification_in_progress");
  }
  for (const attempt of attempts) {
    if (attempt.state !== "cancelled") await context.store.setState(attempt.attempt_id, "cancelled", now);
    await removeAttemptAccount(context, attempt);
  }
  for (const account of await listLegacyAccounts(context)) await removeOwnedAccount(context, account);
  return { disconnected: true };
}

async function receiveConnectCallback(request, env, { now }) {
  const headers = {
    "cache-control": "no-store, max-age=0",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  try {
    assertVerifierConfigured(env);
    await enforceCallbackRateLimit(env, request);
    const url = new URL(request.url);
    const keys = [...url.searchParams.keys()];
    const sessionUri = url.searchParams.get("session_uri");
    if (keys.length !== 1 || keys[0] !== "session_uri" || !isSafeSessionUri(sessionUri)) {
      throw httpError(400, "invalid_callback");
    }
    const store = getConnectAttemptStore(env);
    const timestamp = now().getTime();
    const attempt = await store.getCurrent(timestamp);
    if (!attempt || attempt.state !== "link_opened") throw httpError(410, "connect_attempt_unavailable");
    const ticket = randomBase64Url(32);
    const ticketHash = await sha256Hex(ticket);
    const sessionCipher = await encryptSessionUri(sessionUri, env.COMPOSIO_CALLBACK_ENCRYPTION_KEY);
    if (!await store.storeCallback(attempt.attempt_id, sessionCipher, ticketHash, timestamp)) {
      throw httpError(410, "connect_attempt_unavailable");
    }
    const handoff = new URL("openpets://calendar/verify");
    handoff.searchParams.set("ticket", ticket);
    return new Response(null, { status: 303, headers: { ...headers, location: handoff.toString() } });
  } catch (error) {
    const status = error instanceof BrokerError ? error.status : 502;
    return new Response("Calendar verification could not be completed. Return to OpenPets and start a new connection if needed.", {
      status,
      headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
    });
  }
}

async function completeConnect(context, body) {
  assertVerifierConfigured(context.env);
  if (typeof body.ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.ticket)) throw httpError(400, "invalid_callback_ticket");
  const ticketHash = await sha256Hex(body.ticket);
  const timestamp = context.now().getTime();
  const attempt = await context.store.getByTicketHash(ticketHash);
  if (!attempt) throw httpError(409, "callback_ticket_replayed_or_unknown");
  if (attempt.profile_id !== context.profileId) throw httpError(403, "callback_profile_mismatch");
  if (attempt.expires_at <= timestamp) {
    await context.store.setState(attempt.attempt_id, "expired", timestamp);
    const expiredContext = { ...context, provider: attempt.provider, pluginId: attempt.plugin_id };
    await removeAttemptAccount(expiredContext, attempt).catch(() => undefined);
    throw httpError(410, "connect_attempt_expired");
  }
  if (!await context.store.claimTicket(attempt.attempt_id, context.profileId, ticketHash, timestamp)) {
    throw httpError(409, "callback_ticket_replayed_or_unknown");
  }

  const attemptContext = { ...context, provider: attempt.provider, pluginId: attempt.plugin_id };
  let sessionUri;
  let completionRequestDispatched = false;
  try {
    sessionUri = await decryptSessionUri(attempt.session_cipher, context.env.COMPOSIO_CALLBACK_ENCRYPTION_KEY);
    const completed = await composioRequest(attemptContext, "POST", "/connected_accounts/complete_auth", {
      session_uri: sessionUri,
      user_id: attempt.user_id,
    }, { onDispatch: () => { completionRequestDispatched = true; } });
    if (completed?.connected_account_id !== attempt.connected_account_id || completed?.toolkit_slug !== PROVIDERS[attempt.provider].toolkit) {
      if (safeAccountId(completed?.connected_account_id) && completed.connected_account_id !== attempt.connected_account_id) {
        await removeAccountIfAttemptOwned(attemptContext, attempt, completed.connected_account_id).catch(() => undefined);
      }
      const mismatchAt = context.now().getTime();
      await restoreOrFailRejectedCallback(attemptContext, attempt, mismatchAt);
      throw httpError(502, "connection_identity_mismatch");
    }
    const recordedCompletion = await context.store.setState(attempt.attempt_id, "completion_unknown", context.now().getTime());
    if (!recordedCompletion) throw httpError(502, "connection_verification_pending");
  } catch (error) {
    const timestampAfterFailure = context.now().getTime();
    if (error instanceof UpstreamError && [400, 404].includes(error.status)) {
      const recovery = await restoreOrFailRejectedCallback(attemptContext, attempt, timestampAfterFailure);
      if (recovery === "unknown") throw httpError(502, "connection_verification_pending");
      throw httpError(409, recovery === "retry" ? "connection_verification_retry" : "connection_verification_failed");
    }
    if (error instanceof BrokerError && error.code === "connection_identity_mismatch") throw error;
    if (completionRequestDispatched) {
      await context.store.setState(attempt.attempt_id, "completion_unknown", timestampAfterFailure);
    } else {
      await context.store.setState(attempt.attempt_id, "failed", timestampAfterFailure);
      await removeAttemptAccount(attemptContext, attempt).catch(() => undefined);
    }
    if (error instanceof BrokerError) throw error;
    throw httpError(502, completionRequestDispatched ? "connection_verification_pending" : "connection_verification_failed");
  } finally {
    sessionUri = undefined;
  }

  let account;
  try {
    account = await getConnectedAccount(attemptContext, attempt.connected_account_id, attempt.provider, attempt.user_id);
  } catch (error) {
    if (!(error instanceof UpstreamError && error.status === 404)) {
      await context.store.setState(attempt.attempt_id, "completion_unknown", context.now().getTime());
      throw httpError(502, "connection_verification_pending");
    }
  }
  if (!accountMatchesAttempt(attempt, account, context.env)) {
    if (accountBelongsToAttempt(attempt, account)) {
      await removeAccountById(attemptContext, attempt.connected_account_id, account.status).catch(() => undefined);
    }
    await context.store.setState(attempt.attempt_id, "failed", context.now().getTime());
    throw httpError(409, "connection_identity_mismatch");
  }
  const verifiedAt = context.now().getTime();
  if (!await context.store.verifyIfNotCancelled(attempt.attempt_id, verifiedAt)) {
    if (await context.store.isRequestCancelled(attempt.request_id_hash, attempt.profile_id, attempt.plugin_id, attempt.provider, verifiedAt)) {
      await context.store.setState(attempt.attempt_id, "cancelled", verifiedAt);
      await removeAttemptAccount(attemptContext, attempt).catch(() => undefined);
      throw httpError(409, "connection_verification_cancelled");
    }
    throw httpError(502, "connection_verification_pending");
  }
  return { completed: true };
}

async function recoverAttempt(context, attempt) {
  const attemptContext = { ...context, provider: attempt.provider, pluginId: attempt.plugin_id };
  const now = context.now().getTime();
  if (await context.store.isRequestCancelled(attempt.request_id_hash, attempt.profile_id, attempt.plugin_id, attempt.provider, now)) {
    await context.store.setState(attempt.attempt_id, "cancelled", now);
    await removeAttemptAccount(attemptContext, attempt).catch(() => undefined);
    return false;
  }
  let account;
  try {
    account = await getConnectedAccount(attemptContext, attempt.connected_account_id, attempt.provider, attempt.user_id);
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 404) account = undefined;
    else return false;
  }
  if (accountMatchesAttempt(attempt, account, context.env)) {
    if (await context.store.verifyIfNotCancelled(attempt.attempt_id, now)) return true;
    if (await context.store.isRequestCancelled(attempt.request_id_hash, attempt.profile_id, attempt.plugin_id, attempt.provider, now)) {
      await context.store.setState(attempt.attempt_id, "cancelled", now);
      await removeAttemptAccount(attemptContext, attempt).catch(() => undefined);
    }
    return false;
  }
  if (now - attempt.updated_at >= VERIFY_REQUEST_GRACE_MS) {
    if (accountMatchesIdentity(attempt, account, context.env)) {
      await removeAccountById(attemptContext, attempt.connected_account_id, account.status).catch(() => undefined);
    }
    await context.store.setState(attempt.attempt_id, "failed", context.now().getTime());
  }
  return false;
}

async function restoreOrFailRejectedCallback(context, attempt, now) {
  let account;
  try {
    account = await getConnectedAccount(context, attempt.connected_account_id, attempt.provider, attempt.user_id);
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 404) account = undefined;
    else {
      await context.store.setState(attempt.attempt_id, "completion_unknown", now);
      return "unknown";
    }
  }
  const canRetry = accountMatchesIdentity(attempt, account, context.env)
    && ["INITIALIZING", "INITIATED"].includes(account.status)
    && attempt.callback_count < MAX_CALLBACK_ATTEMPTS;
  if (canRetry && await context.store.restoreLink(attempt.attempt_id, now)) return "retry";
  await context.store.setState(attempt.attempt_id, "failed", now);
  await removeAttemptAccount(context, attempt).catch(() => undefined);
  return "failed";
}

async function getConnectedAccount(context, accountId, provider, userId) {
  if (!safeAccountId(accountId)) return undefined;
  const result = await composioRequest(context, "GET", `/connected_accounts/${encodeURIComponent(accountId)}`);
  const account = result?.item ?? result;
  if (account?.id !== accountId || account?.user_id !== userId || account?.toolkit?.slug !== PROVIDERS[provider].toolkit) {
    return account;
  }
  return account;
}

function accountMatchesAttempt(attempt, account, env) {
  return Boolean(accountMatchesIdentity(attempt, account, env) && account.status === "ACTIVE");
}

function accountMatchesIdentity(attempt, account, env) {
  return Boolean(account && account.id === attempt.connected_account_id && account.user_id === attempt.user_id
    && account.toolkit?.slug === PROVIDERS[attempt.provider].toolkit
    && account.auth_config?.id === env[PROVIDERS[attempt.provider].authConfig]
    && account.experimental?.account_type === "PRIVATE");
}

function accountBelongsToAttempt(attempt, account) {
  // Attempt owners are unique, so cleanup may safely revoke a malformed
  // account from this owner without touching another profile/plugin account.
  return Boolean(account && account.id === attempt.connected_account_id && account.user_id === attempt.user_id);
}

async function removeLegacyAccounts(context) {
  for (const account of await listLegacyAccounts(context)) await removeOwnedAccount(context, account);
}

async function listCalendars(context) {
  const account = await requireActiveAccount(context);
  const url = context.provider === "google"
    ? googleUrl("/calendar/v3/users/me/calendarList", { maxResults: String(PAGE_SIZE), fields: "items(id,summary,timeZone,primary),nextPageToken" })
    : outlookUrl("/v1.0/me/calendars", { "$top": String(PAGE_SIZE), "$select": "id,name" });
  const { rows, truncated } = await listProviderPages(context, account, url, "calendars");
  const calendars = rows.flatMap((row) => {
    const id = row?.id;
    if (!safeId(id)) return [];
    const name = safeText(context.provider === "google" ? row?.summary : row?.name, 200);
    if (!name) return [];
    const timeZone = safeTimeZone(row?.timeZone);
    return [{ id, name, ...(timeZone ? { timeZone } : {}), ...(typeof row.primary === "boolean" ? { primary: row.primary } : {}) }];
  });
  return { calendars, truncated };
}

async function listEvents(context, body) {
  const calendarId = parseOpaqueId(body.calendarId, "calendar");
  const range = parseRange(body.from, body.to);
  const requestedTimeZone = parseOptionalTimeZone(body.calendarTimeZone);
  const account = await requireActiveAccount(context);
  const calendarSegment = encodeURIComponent(calendarId);
  const url = context.provider === "google"
    ? googleUrl(`/calendar/v3/calendars/${calendarSegment}/events`, {
      timeMin: range.from,
      timeMax: range.to,
      ...(requestedTimeZone ? { timeZone: requestedTimeZone } : {}),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(PAGE_SIZE),
      fields: "timeZone,items(id,summary,start,end,status,updated),nextPageToken",
    })
    : outlookUrl(`/v1.0/me/calendars/${calendarSegment}/calendarView`, {
      startDateTime: range.from,
      endDateTime: range.to,
      "$top": String(PAGE_SIZE),
      "$select": "id,subject,start,end,isAllDay,isCancelled,originalStartTimeZone,originalEndTimeZone",
    });
  const { rows, truncated, calendarTimeZone } = await listProviderPages(context, account, url, "events", calendarId);
  let effectiveTimeZone = requestedTimeZone ?? calendarTimeZone;
  if (context.provider === "google" && !effectiveTimeZone && rows.some(isGoogleAllDayEvent)) {
    effectiveTimeZone = await fetchGoogleCalendarTimeZone(context, account, calendarId);
  }
  const events = [];
  for (const row of rows) {
    const event = await normalizeEvent(context, account, calendarId, row, effectiveTimeZone);
    if (event) events.push(event);
  }
  events.sort((left, right) => Date.parse(left.dueAt ?? left.startAt) - Date.parse(right.dueAt ?? right.startAt));
  return { events, truncated };
}

async function getEvent(context, body) {
  const account = await requireActiveAccount(context);
  const calendarId = parseOpaqueId(body.calendarId, "calendar");
  const eventId = parseOpaqueId(body.eventId, "event");
  const calendarTimeZone = parseOptionalTimeZone(body.calendarTimeZone);
  const row = await fetchProviderEvent(context, account, calendarId, eventId, calendarTimeZone);
  if (!row || row.status === "cancelled" || row.isCancelled === true) return null;
  const effectiveTimeZone = context.provider === "google" && !calendarTimeZone && isGoogleAllDayEvent(row)
    ? await fetchGoogleCalendarTimeZone(context, account, calendarId)
    : calendarTimeZone;
  return normalizeEvent(context, account, calendarId, row, effectiveTimeZone);
}

function isGoogleAllDayEvent(row) {
  return typeof row?.start?.date === "string" && typeof row?.end?.date === "string";
}

async function fetchGoogleCalendarTimeZone(context, account, calendarId) {
  const endpoint = googleUrl(`/calendar/v3/users/me/calendarList/${encodeURIComponent(calendarId)}`, { fields: "id,timeZone" });
  const response = await proxyGet(context, account, endpoint);
  if (response.status === 401 || response.status === 403) throw httpError(409, "reauth_required");
  if (response.status < 200 || response.status >= 300) throw httpError(502, "calendar_provider_unavailable");
  const returnedCalendarId = response.data?.id;
  if (!safeId(returnedCalendarId) || (returnedCalendarId !== calendarId && calendarId !== "primary")) {
    throw httpError(502, "calendar_provider_invalid_response");
  }
  const timeZone = safeTimeZone(response.data?.timeZone);
  if (!timeZone) throw httpError(502, "calendar_timezone_unavailable");
  return timeZone;
}

async function fetchProviderEvent(context, account, calendarId, eventId, preferTimeZone) {
  const segment = encodeURIComponent(calendarId);
  const eventSegment = encodeURIComponent(eventId);
  const url = context.provider === "google"
    ? googleUrl(`/calendar/v3/calendars/${segment}/events/${eventSegment}`, {
      ...(preferTimeZone ? { timeZone: preferTimeZone } : {}),
      fields: "id,summary,start,end,status,updated",
    })
    : outlookUrl(`/v1.0/me/calendars/${segment}/events/${eventSegment}`, {
      "$select": "id,subject,start,end,isAllDay,isCancelled,originalStartTimeZone,originalEndTimeZone",
    });
  const response = await proxyGet(context, account, url, preferTimeZone ? [{ name: "Prefer", value: `outlook.timezone=\"${preferTimeZone}\"`, in: "header" }] : []);
  if (response.status === 404 || response.status === 410) return null;
  if (response.status < 200 || response.status >= 300) throw httpError(response.status === 401 || response.status === 403 ? 409 : 502, response.status === 401 || response.status === 403 ? "reauth_required" : "calendar_provider_unavailable");
  return response.data;
}

async function normalizeEvent(context, account, calendarId, row, calendarTimeZone) {
  const id = row?.id;
  if (!safeId(id)) return null;
  const title = safeText(context.provider === "google" ? row?.summary : row?.subject, 200) ?? "Untitled event";
  const updatedAt = validProviderTimestamp(row?.updated);
  if (context.provider === "google") {
    const start = row.start ?? {};
    const end = row.end ?? {};
    if (typeof start.date === "string" && typeof end.date === "string") {
      const startDate = parseDateOnly(start.date);
      const endDateExclusive = parseDateOnly(end.date);
      if (!startDate || !endDateExclusive || endDateExclusive <= startDate) return null;
      // Google all-day dates are interpreted in the calendar's timezone; event-level
      // timezone fields have no significance for all-day events.
      const timeZone = calendarTimeZone ?? safeTimeZone(start.timeZone) ?? safeTimeZone(end.timeZone);
      if (!timeZone) throw httpError(502, "calendar_timezone_unavailable");
      return {
        id, calendarId, title, status: row.status === "cancelled" ? "cancelled" : "confirmed",
        allDay: true, startDate, endDateExclusive,
      dueAt: allDayDueAt(end.date, timeZone), ...(timeZone ? { timeZone } : {}), ...(updatedAt ? { updatedAt } : {}),
      };
    }
    const startAt = parseProviderInstant(start.dateTime);
    const endAt = parseProviderInstant(end.dateTime);
    if (!startAt || !endAt) return null;
    const timeZone = safeTimeZone(start.timeZone) ?? safeTimeZone(end.timeZone);
    return { id, calendarId, title, status: row.status === "cancelled" ? "cancelled" : "confirmed", allDay: false, startAt, endAt, ...(timeZone ? { timeZone } : {}), ...(updatedAt ? { updatedAt } : {}) };
  }

  const start = row.start ?? {};
  const end = row.end ?? {};
  const startAt = parseGraphUtc(start.dateTime);
  const endAt = parseGraphUtc(end.dateTime);
  if (!startAt || !endAt) return null;
  const isAllDay = row.isAllDay === true;
  const timeZone = safeTimeZone(row.originalStartTimeZone) ?? safeTimeZone(start.timeZone);
  if (isAllDay) {
    const originalZone = safeWindowsTimeZone(row.originalStartTimeZone ?? start.timeZone);
    let startDate = parseDateTimeDate(start.dateTime);
    let endDateExclusive = parseDateTimeDate(end.dateTime);
    if (originalZone) {
      const localRow = await fetchProviderEvent(context, account, calendarId, id, originalZone);
      if (localRow?.start?.dateTime && localRow?.end?.dateTime) {
        startDate = parseDateTimeDate(localRow.start.dateTime) ?? startDate;
        endDateExclusive = parseDateTimeDate(localRow.end.dateTime) ?? endDateExclusive;
      }
    }
    if (!startDate || !endDateExclusive) return null;
    return {
      id, calendarId, title, status: row.isCancelled === true ? "cancelled" : "confirmed",
      allDay: true, startDate, endDateExclusive,
      // Graph returns the actual UTC instant for local midnight when no Prefer header is set.
      dueAt: new Date(Date.parse(endAt) - 1).toISOString(),
      ...(timeZone ? { timeZone } : {}), ...(updatedAt ? { updatedAt } : {}),
    };
  }
  return { id, calendarId, title, status: row.isCancelled === true ? "cancelled" : "confirmed", allDay: false, startAt, endAt, ...(timeZone ? { timeZone } : {}), ...(updatedAt ? { updatedAt } : {}) };
}

async function listProviderPages(context, account, firstUrl, collectionKey, calendarId) {
  let nextUrl = firstUrl;
  const expectedPath = new URL(firstUrl).pathname;
  const rows = [];
  let truncated = false;
  let calendarTimeZone;
  for (let page = 0; page < MAX_PROVIDER_PAGES; page += 1) {
    const response = await proxyGet(context, account, nextUrl);
    if (response.status === 401 || response.status === 403) throw httpError(409, "reauth_required");
    if (response.status < 200 || response.status >= 300) throw httpError(502, "calendar_provider_unavailable");
    const data = response.data;
    if (context.provider === "google") calendarTimeZone = safeTimeZone(data?.timeZone) ?? calendarTimeZone;
    const pageRows = context.provider === "google" ? data?.items : data?.value;
    if (!Array.isArray(pageRows)) throw httpError(502, "calendar_provider_invalid_response");
    rows.push(...pageRows.slice(0, PAGE_SIZE));
    if (context.provider === "google") {
      const token = typeof data.nextPageToken === "string" ? data.nextPageToken : "";
      if (!token) return { rows, truncated: false, calendarTimeZone };
      if (page === MAX_PROVIDER_PAGES - 1) { truncated = true; break; }
      const next = new URL(firstUrl);
      next.searchParams.set("pageToken", token);
      nextUrl = assertAllowedProviderUrl(context.provider, next.toString(), calendarId);
      continue;
    }
    const nextLink = typeof data["@odata.nextLink"] === "string" ? data["@odata.nextLink"] : "";
    if (!nextLink) return { rows, truncated: false, calendarTimeZone };
    if (page === MAX_PROVIDER_PAGES - 1) { truncated = true; break; }
    nextUrl = assertAllowedProviderUrl(context.provider, nextLink, calendarId, expectedPath);
  }
  return { rows, truncated, calendarTimeZone };
}

async function proxyGet(context, account, url, parameters = []) {
  const endpoint = assertAllowedProviderUrl(context.provider, url, undefined);
  const result = await composioRequest(context, "POST", "/tools/execute/proxy", {
    connected_account_id: account.id,
    endpoint,
    method: "GET",
    ...(parameters.length ? { parameters } : {}),
  });
  const status = Number(result?.status);
  if (!Number.isInteger(status)) throw httpError(502, "calendar_provider_invalid_response");
  return { status, data: result?.data };
}

async function requireActiveAccount(context) {
  const attempt = await context.store.getLatest(context.profileId, context.pluginId, context.provider);
  if (!attempt || attempt.state !== "verified") {
    if (attempt && isActiveAttemptState(attempt.state)) throw httpError(409, "connection_pending");
    throw httpError(409, attempt?.state === "failed" ? "reauth_required" : "calendar_not_connected");
  }
  const account = await findAttemptAccount(context, attempt);
  if (account?.status !== "ACTIVE") throw httpError(409, "reauth_required");
  return account;
}

async function listOwnedAccounts(context, userId) {
  const provider = PROVIDERS[context.provider];
  const params = new URLSearchParams();
  params.append("user_ids", userId);
  params.append("toolkit_slugs", provider.toolkit);
  params.append("auth_config_ids", requiredConfig(context.env[provider.authConfig]));
  params.set("account_type", "PRIVATE");
  params.set("limit", "100");
  const result = await composioRequest(context, "GET", `/connected_accounts?${params.toString()}`);
  if (!Array.isArray(result?.items)) throw httpError(502, "composio_invalid_response");
  return result.items.filter((account) =>
    account?.user_id === userId &&
    account?.toolkit?.slug === provider.toolkit &&
    account?.auth_config?.id === requiredConfig(context.env[provider.authConfig]) &&
    account?.experimental?.account_type === "PRIVATE" &&
    safeAccountId(account?.id),
  );
}

async function listLegacyAccounts(context) {
  const userId = await deriveComposioUserId(context.token, context.pluginId, context.env.COMPOSIO_IDENTITY_HMAC_KEY);
  return listOwnedAccounts(context, userId);
}

async function findAttemptAccount(context, attempt) {
  if (!safeAccountId(attempt.connected_account_id)) return undefined;
  const accounts = await listOwnedAccounts(context, attempt.user_id);
  return accounts.find((account) => account.id === attempt.connected_account_id);
}

async function removeAttemptAccount(context, attempt) {
  if (!safeAccountId(attempt.connected_account_id)) return;
  const account = await findAttemptAccount(context, attempt);
  if (account) await removeOwnedAccount(context, account);
  else {
    const details = await getConnectedAccount(context, attempt.connected_account_id, attempt.provider, attempt.user_id).catch((error) => {
      if (error instanceof UpstreamError && error.status === 404) return undefined;
      throw error;
    });
    if (accountBelongsToAttempt(attempt, details)) {
      await removeAccountById(context, attempt.connected_account_id, details.status);
    }
  }
}

async function removeAccountIfAttemptOwned(context, attempt, accountId) {
  const account = await getConnectedAccount(context, accountId, attempt.provider, attempt.user_id).catch((error) => {
    if (error instanceof UpstreamError && error.status === 404) return undefined;
    throw error;
  });
  if (account?.id === accountId && account.user_id === attempt.user_id) {
    await removeAccountById(context, accountId, account.status);
  }
}

async function removeAccountById(context, accountId, status) {
  if (!safeAccountId(accountId)) throw httpError(502, "composio_invalid_response");
  if (status === "ACTIVE" || status === "EXPIRED" || status === "FAILED") {
    try {
      await composioRequest(context, "POST", `/connected_accounts/${encodeURIComponent(accountId)}/revoke`);
    } catch (error) {
      if (!(error instanceof UpstreamError) || ![400, 409].includes(error.status)) throw error;
    }
  }
  try {
    await composioRequest(context, "DELETE", `/connected_accounts/${encodeURIComponent(accountId)}?revoke_on_delete=true`);
  } catch (error) {
    if (!(error instanceof UpstreamError) || error.status !== 404) throw error;
  }
}

async function removeOwnedAccount(context, account) {
  await removeAccountById(context, account.id, account.status);
}

async function composioRequest(context, method, path, body, { onDispatch } = {}) {
  const apiKey = requiredConfig(context.env.COMPOSIO_API_KEY);
  let response;
  try {
    onDispatch?.();
    response = await context.fetchImpl(`${COMPOSIO_API}${path}`, {
      method,
      headers: { "x-api-key": apiKey, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
  } catch {
    throw httpError(502, "composio_unavailable");
  }
  if (response.status < 200 || response.status >= 300) throw new UpstreamError(response.status);
  if (method === "DELETE" && response.status === 204) return {};
  let payload;
  try { payload = await response.json(); }
  catch { throw httpError(502, "composio_invalid_response"); }
  return payload;
}

function assertAllowedProviderUrl(provider, endpoint, calendarId, expectedPath) {
  const url = new URL(endpoint);
  const origin = provider === "google" ? GOOGLE_ORIGIN : OUTLOOK_ORIGIN;
  if (url.origin !== origin || url.username || url.password || url.hash) throw httpError(400, "invalid_provider_endpoint");
  const pathAllowed = provider === "google"
    ? /^\/calendar\/v3\/(?:users\/me\/calendarList(?:\/[^/]+)?|calendars\/[^/]+\/events(?:\/[^/]+)?)$/.test(url.pathname)
    : /^\/v1\.0\/me\/(?:calendars|calendars\/[^/]+\/(?:calendarView|events\/[^/]+))$/.test(url.pathname);
  if (!pathAllowed || (expectedPath && url.pathname !== expectedPath)) throw httpError(400, "invalid_provider_endpoint");
  if (calendarId) {
    const segment = encodeURIComponent(calendarId);
    if (!url.pathname.includes(`/calendars/${segment}/`)) throw httpError(400, "invalid_provider_endpoint");
  }
  return url.toString();
}

function googleUrl(path, params = {}) {
  const url = new URL(path, GOOGLE_ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function outlookUrl(path, params = {}) {
  const url = new URL(path, OUTLOOK_ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function parseBearer(value) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(value ?? "");
  if (!match) throw httpError(401, "invalid_profile_identity");
  return match[1];
}

async function deriveComposioUserId(token, pluginId, secret) {
  return deriveHmacIdentity(`legacy:${pluginId}:${token}`, secret, "openpets_local_");
}

async function deriveProfileId(token, secret) {
  return deriveHmacIdentity(`profile:${token}`, secret, "openpets_profile_");
}

async function deriveConnectUserId(token, pluginId, attemptId, secret) {
  return deriveHmacIdentity(`connect:${pluginId}:${attemptId}:${token}`, secret, "openpets_local_");
}

async function deriveHmacIdentity(value, secret, prefix) {
  if (typeof secret !== "string" || new TextEncoder().encode(secret).byteLength < 32) throw httpError(503, "broker_not_configured");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return `${prefix}${toHex(digest).slice(0, 48)}`;
}

async function hashConnectRequestId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw httpError(400, "invalid_connection_request");
  return sha256Hex(value);
}

function getConnectAttemptStore(env) {
  if (env.CONNECT_ATTEMPT_STORE) return env.CONNECT_ATTEMPT_STORE;
  try { return createD1ConnectAttemptStore(env.CALENDAR_CONNECT_DB); }
  catch { throw httpError(503, "connection_verification_not_configured"); }
}

function assertVerifierConfigured(env) {
  if (env.COMPOSIO_CALLBACK_VERIFIER_ENABLED !== "1") throw httpError(503, "connection_verification_not_configured");
  getConnectAttemptStore(env);
  if (!isAesKey(env.COMPOSIO_CALLBACK_ENCRYPTION_KEY)) throw httpError(503, "connection_verification_not_configured");
}

async function enforceCallbackRateLimit(env, request) {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip || !env.IP_RATE_LIMITER || !env.LINK_RATE_LIMITER) throw httpError(503, "rate_limit_not_configured");
  const [ipResult, callbackResult] = await Promise.all([
    env.IP_RATE_LIMITER.limit({ key: ip }),
    env.LINK_RATE_LIMITER.limit({ key: `callback:${ip}` }),
  ]);
  if (!ipResult.success || !callbackResult.success) throw httpError(429, "rate_limited");
}

function isAesKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  try { return base64UrlToBytes(value).byteLength === 32; }
  catch { return false; }
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return bytesToBase64Url(bytes);
}

async function sha256Hex(value) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

async function encryptSessionUri(value, encodedKey) {
  const key = await crypto.subtle.importKey("raw", base64UrlToBytes(encodedKey), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)));
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`;
}

async function decryptSessionUri(value, encodedKey) {
  if (typeof value !== "string") throw httpError(409, "connection_verification_failed");
  const [ivText, cipherText, extra] = value.split(".");
  if (!ivText || !cipherText || extra !== undefined) throw httpError(409, "connection_verification_failed");
  try {
    const key = await crypto.subtle.importKey("raw", base64UrlToBytes(encodedKey), "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(ivText) }, key, base64UrlToBytes(cipherText));
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch { throw httpError(409, "connection_verification_failed"); }
}

function isSafeSessionUri(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SESSION_URI_LENGTH && !/[\0-\x1f\x7f]/.test(value);
}

function isActiveAttemptState(state) {
  return ["creating", "link_opened", "callback_ready", "verifying", "completion_unknown"].includes(state);
}

async function enforceRateLimits(env, request, userId, route) {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip || !env.PROFILE_RATE_LIMITER || !env.IP_RATE_LIMITER || !env.LINK_RATE_LIMITER) throw httpError(503, "rate_limit_not_configured");
  const profile = await env.PROFILE_RATE_LIMITER.limit({ key: userId });
  const ipResult = await env.IP_RATE_LIMITER.limit({ key: ip });
  if (!profile.success || !ipResult.success) throw httpError(429, "rate_limited");
  if (route === "/v1/calendar/connect") {
    const link = await env.LINK_RATE_LIMITER.limit({ key: userId });
    if (!link.success) throw httpError(429, "rate_limited");
  }
}

async function readJsonBody(request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw httpError(413, "request_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw httpError(400, "invalid_json");
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        try { await reader.cancel(); } catch {}
        throw httpError(413, "request_too_large");
      }
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
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw httpError(400, "invalid_json"); }
  try {
    const body = JSON.parse(text);
    if (!isRecord(body)) throw new Error();
    return body;
  } catch { throw httpError(400, "invalid_json"); }
}

function parseProvider(value) {
  if (typeof value !== "string" || !ALLOWED_PROVIDER.has(value)) throw httpError(400, "unsupported_provider");
  return value;
}

function parsePluginId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(value)) throw httpError(400, "invalid_plugin_id");
  return value;
}

function parseOpaqueId(value, label) {
  if (!safeId(value)) throw httpError(400, `invalid_${label}_id`);
  return value;
}

function parseRange(from, to) {
  if (!isIsoUtc(from) || !isIsoUtc(to)) throw httpError(400, "invalid_calendar_range");
  const span = Date.parse(to) - Date.parse(from);
  if (span <= 0 || span > 92 * 24 * 60 * 60_000) throw httpError(400, "invalid_calendar_range");
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

function parseOptionalTimeZone(value) {
  if (value === undefined) return undefined;
  const timeZone = safeTimeZone(value);
  if (!timeZone) throw httpError(400, "invalid_calendar_timezone");
  return timeZone;
}

function validateConnectUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) throw httpError(502, "invalid_connect_link");
  const url = new URL(value);
  if (url.origin !== CONNECT_ORIGIN || !url.pathname.startsWith("/link/") || url.username || url.password || url.hash) throw httpError(502, "invalid_connect_link");
  return url.toString();
}

function requiredConfig(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048) throw httpError(503, "broker_not_configured");
  return value;
}

function safeAccountId(value) { return typeof value === "string" && /^ca_[A-Za-z0-9_-]{4,128}$/.test(value); }
function safeId(value) { return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\0-\x1f\x7f]/.test(value); }
function safeText(value, max) { return typeof value === "string" ? value.replace(/[\0-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || null : null; }
function safeTimeZone(value) { if (typeof value !== "string" || value.length > 100) return undefined; try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return value; } catch { return undefined; } }
function safeWindowsTimeZone(value) { return typeof value === "string" && !value.startsWith("tzone:") && /^[A-Za-z0-9 _+./-]{1,64}$/.test(value) ? value : undefined; }
function validProviderTimestamp(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined; }
function parseProviderInstant(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined; }
function parseGraphUtc(value) {
  if (typeof value !== "string") return undefined;
  const iso = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}
function parseDateOnly(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined; }
function parseDateTimeDate(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : undefined; }

function allDayDueAt(endDateExclusive, timeZone) {
  const parsed = parseDateOnly(endDateExclusive);
  if (!parsed) return new Date(`${endDateExclusive}T23:59:59.999Z`).toISOString();
  const [year, month, day] = parsed.split("-").map(Number);
  const endDate = new Date(Date.UTC(year, month - 1, day));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const target = { year: endDate.getUTCFullYear(), month: endDate.getUTCMonth() + 1, day: endDate.getUTCDate(), hour: 23, minute: 59, second: 59, millisecond: 999 };
  return new Date(wallTimeToEpoch(target, timeZone ?? "UTC")).toISOString();
}

function wallTimeToEpoch(target, timeZone) {
  const wallAsUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second, target.millisecond);
  let guess = wallAsUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let index = 0; index < 4; index += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second), target.millisecond);
    const delta = wallAsUtc - represented;
    guess += delta;
    if (delta === 0) return guess;
  }
  return guess;
}

function isIsoUtc(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)); }
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function toHex(bytes) { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
function httpError(status, code) { return new BrokerError(status, code); }

class BrokerError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
class UpstreamError extends Error { constructor(status) { super("Composio request failed."); this.status = status; } }
