# OpenPets calendar broker

This Cloudflare Worker is the server-side Composio boundary used by the
OpenPets SDK calendar capability. It is intentionally separate from plugin
source. The worker accepts a host-only, OS-encrypted local-profile bearer,
derives an opaque Composio user ID with HMAC, and proxies only allowlisted
read-only Google Calendar and Microsoft Graph operations. Each connection
attempt gets a distinct Composio owner scoped to its plugin and local profile.
The host also supplies a per-invocation cancellation nonce; only its SHA-256
digest is stored. A short-lived tombstone closes cancel-before-create races,
and the final ACTIVE transition is atomic with respect to cancellation.
Plugin code cannot call this worker through its general network API and never
receives provider tokens, Composio account IDs, or raw provider payloads.

Calendar activation is disabled unless the host-mediated verifier, encrypted
attempt store, and required Cloudflare rate-limit bindings are all configured.
The Composio callback receives only its deferred `session_uri`; it encrypts
that URI in D1 and redirects the desktop to a short-lived, one-time ticket. The
host redeems that ticket using its OS-encrypted local-profile identity. Only
then does the Worker call Composio `complete_auth` with the attempt-specific
owner and confirm the exact connected-account ID, owner, toolkit, auth config,
private ownership, and ACTIVE status before marking the attempt verified.
Browser return and upstream ACTIVE status alone never activate a connection.
There is one project-wide in-flight attempt because Composio's callback has no
OpenPets attempt identifier; the project must be dedicated to this callback.

## Before deployment

OpenPets maintainers need to:

1. Confirm and provision the first-party HTTPS host configured in
   `apps/desktop/src/plugin-calendar-broker-client.ts`. The current host name
   is a placeholder until OpenPets verifies and provisions its DNS/Worker
   route. Set the dedicated Composio project's callback to
   `https://calendar-broker.openpets.dev/v1/calendar/connect/callback`.
   Composio's callback is project-wide, so do not share this project with other
   products or callbacks.
2. Create read-only managed-auth configs in that Composio project for the `googlecalendar`
   and `outlook` toolkits. Configure the Google scopes
   `https://www.googleapis.com/auth/calendar.events.readonly` and
   `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, and the
   delegated Microsoft Graph scope `Calendars.ReadBasic`. Obtain both auth
   config IDs.
3. Create a Composio project API key restricted to connected-account link,
   complete-auth, exact-account read, revoke/delete, and proxy operations used
   here. Configure spending limits and abuse monitoring.
4. Provision the Cloudflare D1 database, replace the placeholder ID in
   `wrangler.jsonc`, and apply `migrations/0001_calendar_connect_attempts.sql`.
   The table contains local profile/plugin/provider ownership, attempt states,
   a SHA-256 ticket digest, and an AES-GCM encrypted, short-lived callback URI.
5. Set Worker-only secrets `COMPOSIO_API_KEY`,
   `COMPOSIO_IDENTITY_HMAC_KEY` (at least 32 random bytes), and
   `COMPOSIO_CALLBACK_ENCRYPTION_KEY` (32 random bytes encoded as unpadded
   base64url). Configure the two auth config IDs and set
   `COMPOSIO_CALLBACK_VERIFIER_ENABLED=1` only after all dependencies and the
   callback route are verified. Keep the HMAC and encryption keys stable and
   separate; rotating either requires an explicit migration/recovery plan.
6. Configure the three Cloudflare rate-limit namespaces in `wrangler.jsonc`
   for the target account, then test the configured quotas and alerts.
7. Keep Worker observability disabled and ensure any account-level request
   logs, proxy/CDN logs, traces, and error reports redact the callback query
   string. The Composio `session_uri` is necessarily delivered in the callback
   query; it must never be recorded. Do not enable the verifier or expose the
   Worker publicly until this is confirmed.

No credentials belong in Git, plugin code, manifests, renderer state, client
logs, or per-plugin storage. The project API key and HMAC key are Worker-only
secrets. Auth Config IDs are set as Worker secrets/config values, never shipped
in the desktop app.

## Local validation

From the OpenPets workspace root:

```sh
pnpm --filter @open-pets/calendar-broker test
pnpm --dir apps/calendar-broker exec wrangler deploy --dry-run --outdir /tmp/openpets-calendar-broker-dry-run
```

For local Worker development, set the API key, HMAC key, callback encryption
key, auth config IDs, and verifier flag in an ignored `.dev.vars` file; never
commit it. Apply the D1 migration locally. This implementation has only been
provider-mock tested. No broker deployment or live Google/Outlook OAuth has
been performed. Manual deadlines do not depend on calendar authentication and
remain available offline.

## Security boundaries and limits

- Fixed routes and provider origins; only GET provider endpoints are executed.
- Only connected accounts matching the derived local-profile/plugin owner,
  provider toolkit, configured auth ID, and private ownership are accepted.
- Connection callbacks are single-use and expire; one project-wide slot
  prevents concurrent callback mix-ups. Connect fails closed when its D1 store,
  verifier switch, key material, or rate limiters are absent.
- Host cancellation is bound to one request nonce instead of “the latest”
  profile/provider flow. A bounded tombstone prevents a late connect request
  from creating a link after cancellation; a cancellation racing verification
  prevents the account from crossing the atomic verified-state transition.
- A stale or rejected callback can restore a still-pending attempt, but only up
  to three callback candidates. This accommodates a late return from a
  cancelled flow without allowing that stale session to activate or poison the
  newer attempt indefinitely.
- A claimed browser ticket is not sufficient to recover an account. Recovery
  from ACTIVE status is available only after a Composio completion request was
  attempted; recovery reads the exact attempt account for a bounded grace
  period and never retries the single-use completion call.
- Disconnect touches only the selected plugin's attempt-owned account. Another
  plugin's separate Composio owner/account is left intact.
- The broker never supports arbitrary URLs, methods, tool names, or scopes.
- Event results are minimized to ID, calendar ID, title, status, timestamps,
  all-day dates, and timezone; descriptions and attendees are discarded.
- Request bodies are size-limited; event windows are capped at 92 days and
  pagination at 300 rows.
- Per-profile/plugin, per-IP, and connect-link rate-limit bindings fail closed
  when missing. Cloudflare documents these limits as approximate and local to
  a data-center location, so they are not a strict usage/billing ceiling.

See [Cloudflare Worker Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) for its current semantics, and check current [Composio pricing](https://composio.dev/pricing) before public rollout. Both services may change their plans or limits.

Composio documents deferred OAuth completion and exact connected-account
ownership in its [Connected Accounts API](https://docs.composio.dev/reference/v3/api-reference/connected-accounts).
