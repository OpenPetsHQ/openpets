# OpenPets calendar broker

This Cloudflare Worker is the server-side Composio boundary used by the
OpenPets SDK calendar capability. It is intentionally separate from plugin
source. The worker accepts a host-only, OS-encrypted local-profile bearer,
derives an opaque Composio user ID with HMAC, and proxies only allowlisted
read-only Google Calendar and Microsoft Graph operations. It derives a distinct
Composio owner for each local-profile/plugin pair, so one plugin cannot revoke
another plugin's calendar connection. Plugin code cannot
call this worker directly through its general network API and never receives
provider tokens, Composio account IDs, or raw provider payloads.

## Before deployment

OpenPets maintainers need to:

1. Confirm and provision the first-party HTTPS host configured in
   `apps/desktop/src/plugin-calendar-broker-client.ts`. The current host name
   is a placeholder until OpenPets verifies and provisions its DNS/Worker
   route.
2. Create read-only managed-auth configs in Composio for the `googlecalendar`
   and `outlook` toolkits. Configure the Google scopes
   `https://www.googleapis.com/auth/calendar.events.readonly` and
   `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, and the
   delegated Microsoft Graph scope `Calendars.ReadBasic`. Obtain both auth
   config IDs.
3. Create a Composio project API key restricted to the connected-account
   operations and proxy execution used here. Configure Composio spending
   alerts/limits and abuse monitoring.
4. Create a random HMAC key with at least 32 bytes of entropy. Keep it stable
   across deployments; rotating it changes all Composio user IDs and strands
   existing local-profile/plugin connections unless they are migrated.
5. Review the Cloudflare rate-limit namespace IDs and limits against the
   target account and configure deployment monitoring.
6. Approve the OAuth callback identity-verification strategy before public
   rollout. Composio's verifier requires the application to authenticate the
   returning user and call `complete_auth`; a local OpenPets profile has no
   browser sign-in identity to assert today. This broker does not enable that
   verifier yet. Until a host-mediated profile handoff is designed and tested,
   keep Connect Links private to the local machine and do not deploy this flow
   for untrusted/public use.

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

For local Worker development, set the four required values in a local ignored
`.dev.vars` file or Wrangler's secret store; never commit that file. Deploy
through the maintainers' Cloudflare account after the prerequisites above are
met. This implementation has only been provider-mock tested until that setup is
available.

## Security boundaries and limits

- Fixed routes and provider origins; only GET provider endpoints are executed.
- Only connected accounts matching the derived local-profile/plugin owner,
  provider toolkit, configured auth ID, and private ownership are accepted.
- The broker never supports arbitrary URLs, methods, tool names, or scopes.
- Event results are minimized to ID, calendar ID, title, status, timestamps,
  all-day dates, and timezone; descriptions and attendees are discarded.
- Request bodies are size-limited; event windows are capped at 92 days and
  pagination at 300 rows.
- Per-profile/plugin, per-IP, and connect-link rate-limit bindings fail closed
  when missing. Cloudflare documents these limits as approximate and local to
  a data-center location, so they are not a strict usage/billing ceiling.

See [Cloudflare Worker Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) for its current semantics, and check current [Composio pricing](https://composio.dev/pricing) before public rollout. Both services may change their plans or limits.

Composio documents this identity check in its [Connected Accounts API reference](https://docs.composio.dev/reference/api-reference/connected-accounts).
