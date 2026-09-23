---
description: Understand the OpenPets plugin manifest, permissions, runtime sandbox, install paths, authoring workflow, and catalog release validation.
---

# Plugin platform

OpenPets plugins are small companion programs that extend the pet: reminders,
focus timers, a Tamagotchi-style virtual pet, GitHub notifications, and so on.
This doc is the platform architecture - the manifest contract, the permission
model, the runtime and sandbox, install paths, and packaging/publishing. For the
*author-facing* API see [Plugin SDK v3](/sdk); for the reviewed catalog lineup,
bundling defaults, and companion behavior rules see
[Official plugins](/official-plugins).

This doc is required reading before changing plugin platform code, official
plugins, catalog generation, packaging, runtime behavior, or plugin-facing UI
(per `AGENTS.md`). When you change behavior, update this doc in the same change.

Source maps: `apps/desktop/src/codemap.md` (the `plugin-*.ts` modules),
`plugins/codemap.md`, `plugins/official/codemap.md`, `packages/sdk/codemap.md`.

## Source lanes

Plugin source is split by publishing intent:

- `plugins/official/` - first-party, reviewed OpenPets plugins. Only these can be
  bundled or enabled by default.
- `plugins/community/` - public catalog plugins that are reviewed and shipped
  through the same ZIP/SHA/catalog pipeline, but are labeled `publisherType:
  "community"` and cannot be bundled.
- `plugins/dev/` - local experiments only. The catalog generator ignores this
  lane; move a plugin to `community/` or `official/` before publishing.

Plugin source folders under `plugins/official/` or `plugins/community/` may be
pinned Git submodules. Clone this repository with `--recurse-submodules`, or run
`git submodule update --init --recursive` before development, testing, or a
release. An upstream change does not enter OpenPets automatically: review it,
intentionally advance the pinned submodule commit, update community provenance
when applicable, then run the normal release validation.

## Mental model

A plugin is a **package** validated by a **manifest**, run inside a **sandbox**,
talking to the host only through a **permission-checked SDK bridge**. The host
owns every side effect - the plugin only *describes* what it wants (a bubble, an
alert, a scheduled job, a stored value), and the host validates and renders it.
This is the "companion-first" stance: plugins never inject UI into pet windows
directly; they hand the host descriptors and the host owns layout and lifecycle.

```
openpets.plugin.json ──validate──▶ plugin-service ──▶ plugin-runtime
                                                          │
                              ┌───────────────────────────┤
                              ▼                            ▼
                    declarative timers           plugin-js-host (sandbox)
                              │                            │  SDK calls (IPC, tokened)
                              └────────────┬───────────────┘
                                           ▼
                                  plugin-sdk-bridge
                          (permission + quota checks, then dispatch)
                                           ▼
              pet · schedule · storage · ui · audio · events · bus · ai · …
```

## The manifest - `openpets.plugin.json`

The manifest is the contract the host validates before *any* plugin code runs
(`plugin-manifest.ts`, schema versions v1/v2/v3). Current plugins are
`manifestVersion: 3` / `sdkVersion: 3.x`. Key fields:

- `manifestVersion`, `id` (e.g. `openpets.reminders`), `name`, `description`,
  `version`, `sdkVersion`.
- `runtime`: `javascript` for SDK plugins (declarative timer-only plugins also
  exist for the simplest cases).
- `entry`: the JS entry file (e.g. `index.js`).
- `permissions`: the capabilities the plugin requests (see below).
- `configSchema`: typed config fields rendered as a no-JSON settings form.
  Fields include text, number, boolean, select, time, date, secret, and sound;
  a select can opt into the host's `sprite-grid` presentation when every option
  references a declared sprite preview.
- `assets`: declared icon/image/svg/sprite/sound refs (validated, see below).
- `commands`, `status`, `panels`, `network` hosts, and timer triggers as
  applicable.
- Localization: `name`/`description`/labels can be `$t:` keys resolved from
  `locales/en.json` (see [Internationalization](/i18n)).

`name`/`description`/labels in the manifest use `$t:` references; the catalog
generator and release validator fail if those don't resolve.

Catalog card icons can use bundled SVG assets. A plugin declares the SVG under
`assets.icons` (for example `"assets": { "icons": { "spotify":
"assets/spotify.svg" } }`); the packaging flow sanitizes the SVG and embeds it
as catalog `iconDataUrl`. Do **not** use external SVG URLs for plugin icons - the
icon must be part of the reviewed, hash-pinned package.

### Sprite-grid configuration

`sprite-grid` is a presentation for a `select` config field, not a general
renderer surface. Each option names a manifest-declared sprite as its preview;
manifest validation rejects undeclared previews. The Control Center renders
those choices as accessible radio cards, with animation only for the selected,
hovered, or keyboard-focused card. `prefers-reduced-motion` keeps the first frame
static.

Calendar Airmail uses this for its courier choice. The couriers are bundled
plugin assets, not installed pets: changing the selection never reads the pet
catalog, changes the default pet, or depends on a user-installed companion.

### Manifest reading is hardened

`plugin-manifest-reader.ts` enforces realpath/allowed-root checks, requires the
manifest to be the root file, caps size, and matches the expected id/version.
The manifest is never trusted blindly.

## Permission model

Permissions are declared in the manifest, **approved** by the user at install,
persisted in plugin state, and **re-checked on every SDK call** by the bridge.
The permission surface (from `plugin-manifest.ts`):

`timer`/`schedule`, `pet:*`, `pets:*`, `audio`, `events`, `ui:*`, `notify`,
`bus`, `ai`, `secrets`, `voice:*`, `auth`, `files`, `system:*`, `clipboard`,
`network:*`, `calendar:connect`.

A plugin that calls a namespace it didn't declare (or wasn't approved for) is
denied and the block is recorded in diagnostics. `network:*` is further
constrained to declared hosts. This is defense in depth: manifest validation,
user approval, runtime permission check, and quotas all apply.

### Assistant capabilities

Assistant capabilities are a separate plugin contract, not a manifest
permission. A plugin explicitly opts in with
`ctx.assistant.registerCapability(...)`; an unregistered command or SDK method
is not implicitly callable by the host assistant. Registration grants no new
authority. The handler's effects remain limited by the plugin's existing
manifest-declared and user-approved permissions and continue through the normal
bridge checks.

`calendar:connect` also requires a separate user grant for that plugin and
provider in Command Center → Integrations → Connected Apps. The host enforces
that local-profile grant on every calendar SDK call; account disconnection and
plugin permission revocation are independent. Calendar OAuth/status remain
fail-closed until the host can independently verify the person completing the
Composio browser flow. See [Desktop architecture](/desktop#security-model).

The descriptor is bounded and object-rooted: it contains only an id,
description, and input JSON Schema subset. The host validates supported schema
keywords, input types, required fields, enum/const values, string and numeric
bounds, array limits, nested object depth, property counts, and payload size.
Handlers receive a validated clone and must return an object-shaped,
JSON-compatible, size-bounded result. Unsupported or malformed schemas,
circular/non-JSON data, and oversized values are rejected.

The host derives each provider tool name from the plugin id and capability id:
punctuation is normalized to lowercase underscores and ordinary names remain
readable (for example, `system_resources_summary`). Names are bounded to the
shared provider limit; normalization collisions and truncation receive a
short deterministic suffix, while duplicate capability identities and any
unresolvable name collision are rejected. The generation-pinned target map is
keyed by that exact provider name, so no opaque-name aliases are retained.
Conversation action rows show the capability description as a concise label;
the actual provider name is retained separately for dispatch and transcript
correlation rather than rendered as the label.

When a capability cannot proceed because the validated input is missing a
required field, its structured failure may include `missingInformation: true`.
This explicit assistant-capability outcome asks for the missing value; it is
not provider-specific and does not mean that the plugin, capability, or host is
generally rejected or unavailable. Generic validation failures, inactive or
stale plugin generations, handler failures, timeouts, and unavailable or
indeterminate execution remain ordinary structured rejected/unavailable
outcomes without that discriminator.

Bundled official plugins are the primary examples. Focus Buddy registers
`focus.start`, `focus.status`, `focus.pause`, `focus.resume`, `focus.end`, and
`focus.skipBreak`; its start capability accepts an explicit duration in minutes.
Quick Reminders registers `reminders.create`, `reminders.list`,
`reminders.complete`, `reminders.snooze`, and `reminders.remove`.
`reminders.create` accepts an absolute ISO due time with a `Z` suffix or numeric
UTC offset, never a guessed local or natural-language date. Launch Buddy exposes
`launch.greet`; Virtual Pet exposes `virtual-pet.status`, `virtual-pet.feed`,
`virtual-pet.play`, `virtual-pet.pet`, and `virtual-pet.nap`; System Resources
exposes `resources.get`, `resources.show`, and `resources.hide`. These
capabilities reuse direct-control domain operations but keep assistant calls free
of command-specific speech and bubble confirmations, except Launch Buddy's
explicit greeting, whose purpose is to present the configured greeting. A
pinned state HUD is not a confirmation: Focus Buddy's start, pause, resume, and
skip-to-break show (or update) its timer HUD exactly like the pet-menu
controls, so a timer started from chat is visibly running; `focus.status`
stays read-only and `focus.end` dismisses the HUD.

The current v1 quotas are 32 registrations per plugin, 16 KiB per schema,
schema depth six, 32 properties per object, 128 total schema properties, 32
array items, 4,096 characters per string, 64 KiB per input or result, and a
five-second host execution wait.

Registrations belong to the owning `PluginSdkBridge` runtime state. Discovery
and execution are host-internal `PluginRuntime`/`PluginService` operations; no
global capability registry or plugin-callable discovery route is added. The
active plugin generation is checked before execution and again after awaiting
the handler. Disable, reload, stop, and broken-plugin teardown revoke
registrations, prevent stale APIs from mutating replacement state, and reject
late results from an old generation.

Existing right-click commands remain direct menu controls. They are not
implicitly AI-callable and are not a substitute for a capability descriptor.
Issue #137 owns only the plugin capability contract and generation-pinned
runtime boundary. Issue #138 owns the canonical host-internal in-memory
conversation/tool loop, provider adapter, generation-pinned routing adapter,
and bounded lifecycle. Issue #146 adds a host-owned persisted personality
profile, but it does not move personality or authority into plugins. Assistant
requests do not route through `ctx.ai` or gain unrestricted plugin authority.
The current integration has shared chat/voice Conversation projection and
host-owned local history, while sensitive-action confirmation remains separate.
Provider-profile management is implemented in the Control Center and uses the
host-owned bridge described below.

Network access is gated per call by the **intersection** of manifest-declared
permissions and the user's persisted approvals. A stale approval never grants a
capability the current manifest no longer declares.

- Canonical v3 API is `ctx.net.fetch` / `ctx.net.stream`. Hosts must appear in
  both `manifest.network.hosts` and the approved host list. Exact `host:port`
  entries match only that port. A bare hostname approval covers **only** the
  scheme default port (443 for HTTPS, 80 for HTTP) - never an explicit
  non-default port, and never a later `host:port` addition without fresh approval.
- `network` covers HTTPS GET to approved **public** hosts (public-host / private-IP
  checks still apply). Public destinations are filtered against IANA special-purpose
  ranges, with explicit current more-specific exceptions resolved before broader
  denials. Non-GET methods require `network:write` on `ctx.net` only.
- `network:local` is **additive**: it also allows declared actual local/private,
  link-local, or CGNAT HTTP endpoints on `ctx.net` while public HTTPS hosts in
  the same manifest keep the normal public-host path. It does not allow arbitrary
  non-public special-purpose addresses. Local targets require explicit local
  IPs/`localhost` (DNS-rebinding defense); cloud-metadata addresses stay blocked.
- Legacy `ctx.http.fetch` remains GET-only, public HTTPS only - it never gains
  local or mutating access.

### Host provider profiles (#145, backend/bridge status)

The host no longer reads the legacy single `PluginPlatformSettings.ai` object.
The pure `provider-contract.ts` module is the one canonical source for adapter
definitions and presets: supported roles, credential policy, default auth, and
adapter defaults are not duplicated between the main process and renderer.
`plugin-platform-settings.ts` persists typed adapter-specific profiles plus
exactly three independent selections: one `text`, one `stt`, and one `tts`
profile, while retaining audio, dynamic speech, microphone, voice, and
quiet-hour gates.

Profiles use an exhaustive adapter-specific shape. Text adapters carry their
normal model; an `openai-realtime` profile carries both its normal text model
and its separate realtime model; network TTS adapters carry a persisted voice;
system TTS has no network configuration. Profiles may also carry a validated
endpoint, auth placement/strategy, and bounded static headers. Secret values
are stored only through `PluginSecretsStore`; the opaque secret reference is a
host-owned implementation detail. Static header names and credential presence
are safe to expose, but header values, credential values, and secret references
never appear in Control Center snapshots.

The Control Center uses one host-owned configuration transaction for profile
fields, an optional credential value, and role activation. Credential changes
also have dedicated set/delete actions. Existing static headers are never sent
to the renderer: the host applies explicit `add`/`replace`/`delete` edits keyed
by header name, preserving untouched values without making them editable through
a redacted snapshot. The renderer is not a generic secret-reference or sparse
settings editor.

The configuration modal also has a non-persisting **Test setup** action. The
main process first validates an ephemeral candidate profile using the same
profile rules as save, then resolves either the inline draft credential or the
already stored credential for that profile. It does not update settings,
selections, or the secret store. Tests are adapter-specific: a minimal text
completion; a configured-voice TTS preview; a recorded STT sample; or a
minimal Realtime session configuration. System TTS plays through renderer-local
speech synthesis with the selected installed voice. Text, Realtime, and
  network TTS probes use the caller's cancellation signal; modal replacement,
  renderer loss, and shutdown abort them before a stale request can overlap a
  replacement test.

The persisted provider document is explicitly versioned. Startup migrates the
legacy unversioned shape, assigns defaults for newly required TTS voices, and
preserves the old Realtime model as the realtime model rather than inventing a
normal text model. Profiles that fail the current typed validation are retained
in a quarantine record with their reason and original value; a damaged document
is moved aside before defaults are used. Quarantined IDs cannot be silently
reused by a new profile.

Readiness is evaluated per selected role and separately for derived Realtime:
disabled, invalid, unsupported, missing-secret, and ready are distinct states.
Required adapters need a stored credential, optional adapters may operate
without one (but a dangling configured credential is not ready), and adapters
with no credential policy never require a secret. Realtime additionally needs
the selected text profile to be native OpenAI Realtime with both model fields
present.

Before that transaction commits, the host validates every existing role selection
against the complete candidate profile map. Editing a selected profile to an
adapter that does not support its current role clears that selection atomically,
even when the renderer supplies no role directive; an incompatible selection is
never reported as a successful persisted configuration.

The host voice lanes consume these profiles independently: text reasoning,
final-only STT, and TTS each take their own operation snapshot. A system TTS
profile may retain an installed operating-system voice name; no name means the
system default voice. The generic voice
session pins STT before capture starts and passes the same snapshot through
transcription; changing provider settings affects a later activation, not an
in-flight capture. TTS playback is host-owned and request-scoped, including
bounded system-utterance chunking, duration-aware deadlines, renderer-loss and
navigation handling, and completion/error/stop handling. Voice activity uses a
separate host-owned pet slot and does not clear plugin-owned display or status
state. Plugins do not own the microphone, microphone lifecycle accounting,
renderer playback lifecycle, or generic assistant session.

`voice-resource-owner.ts` is the sole owner of the shared microphone arbiter,
capture service, and live-track accounting. Plugin one-shot listening, the native
Realtime lane, and the generic assistant lane release only their own tracks and
leases. The shared owner resets the accounting once, after every lane has stopped
during app teardown; the transient privacy surface is not created until a track is
acquired and is destroyed during shutdown. The optional Realtime adapter remains host-private;
it does not add a public voice conversation API or make Realtime part of the
plugin contract.

Generic `openai-compatible-text` is the codec for OpenAI, Ollama, LM Studio,
vLLM, MiniMax chat, and cloud gateways. Anthropic remains native because its
messages/tool wire format differs. Generic STT is an explicit
`openai-compatible-transcription` profile; Ollama is never inferred to support
audio. ElevenLabs Scribe STT is a separate typed
`elevenlabs-transcription` profile using bounded multipart upload to
`/speech-to-text` with the required `model_id` field and `xi-api-key`
credential. TTS is explicit system voice, MiniMax hex audio, ElevenLabs audio,
or a bounded OpenAI-compatible speech profile. Each network TTS profile uses
its persisted voice unless a request supplies an override; the request voice
wins. An external TTS error is surfaced and does not silently fall back to
system speech.

Realtime is an optional host-private optimized adapter and derives only from
the selected text profile. It requires an explicitly native
`openai-realtime` profile with both a normal text model and a separate realtime
model. It reuses that profile's endpoint, credential, and allowed headers, but
the operation snapshot substitutes the realtime model for negotiation. It fails
with `provider.realtime.unsupported` without fetching for other profiles, and
reports incomplete readiness when either model is missing. The selected profile
is pinned for the active session; generic STT -> Pet Assistant -> TTS remains
the path for other text profiles.

The public plugin-facing `voice.listen` capability remains one-shot push-to-talk,
never ambient. The host captures in a hidden, isolated microphone window and records
live microphone ownership only after acquisition succeeds; it does not create a
detached privacy indicator window. It accepts only one active capture, clamps the
recording duration to 1-30 seconds, times microphone acquisition out after 15
seconds, and bounds transcription separately at 30 seconds. The host can cancel
during acquisition, recording, or transcription; cancellation stops media tracks,
aborts transcription, closes the capture window, clears temporary session data,
and prevents late renderer events from reviving the request. Whitespace-only
transcripts fail with `Voice transcription returned no text.`
The host-owned tray menu provides **Stop microphone listening** during
acquisition/recording and **Cancel transcription** while transcription is
pending; cancellation is not a public plugin SDK method.

Separately, the desktop provides the optional host-private OpenAI Realtime
adapter through the existing Talk surface. It is not exposed through Plugin SDK
v3, has no plugin permission, and plugins cannot start it. A dedicated hidden
sandboxed Electron WebRTC renderer performs provider-wire decoding and emits
only normalized transcripts and completed tool-call requests. The main process
validates those events again, while the host Pet Assistant service owns current
capability discovery, canonical provider-safe tool names, generation-pinned
execution, structured results, and Conversation projection. One-shot capture,
generic voice, and Realtime share exclusive microphone/modality ownership and
the host live-track accounting. Realtime cleanup participates in the shared
shutdown path; provider failures and stale generations cannot become successful
capability outcomes. There is no public SDK Realtime API, unrestricted machine
access, semantic memory, or wake-word behavior.

### Display deliveries

`ui:delivery` is a dedicated permission for the generic, host-owned delivery
surface. It lets a plugin request a short, plain-text delivery with one of its
own declared courier sprites; it is not permission to position windows, inject
markup, select arbitrary files, or control animation. The host chooses the cursor
display, renders the courier and banner together, queues competing deliveries,
enforces expiry and quotas, and owns the window lifecycle. The returned handle
can be dismissed and can observe `click`, `manual`, `expired`, or
`plugin-stopped` dismissal. Plugin teardown
removes that plugin's pending and active deliveries without calling handlers in
the stopped host. See [Plugin SDK v3](/sdk) for the author contract.

This surface is intended for time-sensitive companion messages such as Calendar
Airmail, not as a general custom-overlay API.

## Runtime & sandbox

`plugin-runtime.ts` is the engine:

- Compiles **declarative timer triggers** for enabled manifests and schedules
  cancellable timers.
- Starts/stops a **JavaScript host** per JS plugin and verifies approved
  permissions before dispatching actions.
- Exposes public **command/status** state to the UI, validates actions, and
  **marks a plugin broken** on validation/action failure (surfaced in the
  inspector/health UI).

`plugin-js-host.ts` is the sandbox: a hidden `BrowserWindow` with a per-plugin
session partition, navigation/window-open hardening, an SDK IPC **token**, a
registration handshake at startup, config-listener cleanup, and teardown. The
plugin's `index.js` runs here, isolated from the renderer and the main process.

`plugin-sdk-bridge.ts` is the gate between the sandbox and the host. It
validates routes, builds the per-plugin context, enforces permissions + quotas,
and delegates to focused namespace modules (`plugin-sdk-audio`, `plugin-sdk-network`, `-bus`,
`-config`, `-events`, `-quotas`, `-routes`, `-state`, `-storage`, `-ui`, plus
`plugin-voice`, `plugin-oauth`, `plugin-secrets`, `plugin-ai-gateway`,
`plugin-panels`, `plugin-pet-api`/`plugin-pet-registry`). The split keeps each
capability's permission check and host effect localized. The author-facing
mirror of all this is the SDK in [Plugin SDK v3](/sdk).

The bridge tracks active network requests by API generation, aborts the retired
generation during teardown, and drains those requests before host cleanup.

`plugin-sdk-network.ts` owns guarded DNS, dispatch, response limits, and
agent transport, and bounded cleanup. Plugin teardown awaits agent destruction
with a bounded one-second cleanup deadline and never waits indefinitely;
successful results from a retired generation are rejected rather than delivered
to its replacement.

Runtime host teardown uses the plugin-slot generation predicate before voice
cancellation and again after its await, so stale teardown cannot remove a
replacement generation's deliveries, pets, or motion.

### Supporting modules

- `plugin-state.ts` - atomic JSON store (`userData/openpets-plugin-state.json`):
  installed plugins, enabled flag, approved permissions, config, source, broken
  reason, update metadata.
- `plugin-config.ts` - default/effective config validation and reference
  resolution.
- `plugin-assets.ts` - validates/resolves declared assets (formats + size caps)
  for SDK refs and catalog cards. Courier sprites are WebP strips with bounded,
  declared frame metadata; their dimensions are checked at package/install time.
- `plugin-bubble-arbiter.ts` - priority/coalescing of transient vs pinned bubble
  slots.
- `plugin-diagnostics.ts` - per-plugin error/quota/settings-block collector for
  the inspector and health UI.
- `plugin-platform-settings.ts` - global gates for audio, voice, speech,
  microphone, quiet hours, and validated provider profiles/selections. The
  provider service resolves opaque credentials from `PluginSecretsStore` only
  at operation start and exposes redacted role/realtime diagnostics.
- `provider-service.ts` - narrow host-owned text, transcription, speech, and
  private realtime operation boundary. It owns role snapshots and credential
  selection, adapter URLs/headers/payloads and response validation, provider
  diagnostics, and reply-character accounting.
- `provider-transport.ts` - provider-neutral fetch lifetime and bounded body
  transport. It composes timeout/caller cancellation through body reads,
  rejects redirects, decodes JSON and line-oriented SSE, extracts sanitized
  bounded HTTP error detail, and performs idempotent response cleanup.
- `plugin-voice.ts` + `voice-listening-service.ts` - the plugin-facing one-shot
  `voice.listen` facade and host-owned transcription/cancellation lifecycle,
  plus private realtime entry points and shared shutdown wiring; realtime is not
  an SDK capability.
- `voice-capture.ts` + `voice-capture-electron.ts` - bounded capture state and
  the temporary Electron microphone session.
- `voice-conversation.ts` - host-private one-conversation realtime state,
  interruption/mute tracking, stale-session guards, and cleanup orchestration.
- `voice-realtime-electron.ts` - the dedicated hidden sandboxed Electron WebRTC
  transport, audio-only permission boundary, and host negotiation handoff.
- `voice-microphone-arbiter.ts` - exclusive microphone leases shared by one-shot
  capture and realtime conversation.
- `voice-capture-cancellation.ts` - idempotent renderer-cancel/window-destroy
  ordering.
- `voice-operation-state.ts` - internal tray cancellation state and phase tracking.
- `voice-privacy-indicator.ts` and `voice-privacy-indicator-electron.ts` - shared
  host-owned live microphone-track accounting and the transient Electron privacy
  surface used by one-shot capture and realtime conversation. The surface is
  reference-counted, appears only after microphone acquisition, hides after the
  final track stops, and is destroyed during voice shutdown.
- `plugin-user-sound-store.ts` - stores imported user sounds as opaque refs, not
  raw filesystem paths.
- `plugin-i18n.ts` - resolves plugin locales, manifest `$t:`, and `ctx.t()`.

## Install paths

### Catalog install

`plugin-catalog.ts` fetches the active plugin catalog (v2; see
[Catalogs](/catalog)) with timeout, redirect rejection, size cap, and cache.
`plugin-catalog-validation.ts` validates the catalog strictly. `plugin-package.ts`
downloads the ZIP from `zip.openpets.dev/plugins/`, **verifies SHA-256**,
restricts ZIP size/entries, extracts the **root manifest only**, checks
manifest↔catalog consistency, and installs to `userData/plugins/{id}`. It also
owns safe uninstall path resolution.

### Local development

`plugin-local-loader.ts` validates a selected local folder and snapshots the
manifest, entry file, and declared assets into `userData/plugins-dev/{id}`, with
symlink/path/size protections. In the installed desktop app, authors use
**Plugins → Developer Mode → Load unpacked plugin folder**; OpenPets persists the
original source folder, watches it, and re-snapshots/reloads after edits. The
repo dev build still supports maintainer-only env paths with
`OPENPETS_DEV_PLUGIN_ROOTS` / `OPENPETS_DEV_PLUGIN_PATHS` and
`pnpm dev:desktop:plugins`. See [Development](/development).

## Pet menu rules

Plugin commands (`ctx.commands`) appear in the default pet's right-click menu.
The host rebuilds that menu from the current registrations on every
right-click, so the menu is exactly what the plugin has registered at that
moment. Every plugin, official or community, should follow these rules:

1. **Show only what applies now.** Register a command while it makes sense and
   unregister it when it stops making sense. There should be no "Pause timer"
   when no timer is running, and no "Clear reminders" when none are pending.
   Re-register on every state change, from the one place the plugin already
   updates its status or storage, and on startup after reconciling
   persisted state.
2. **Toggles show the action that will happen.** Register one command whose
   title matches the current state ("Pause timer" while running, "Resume timer"
   while paused), not a generic "Pause or resume". Re-registering the same `id`
   replaces its title and handler.
3. **Live controls go at the root; everything else goes in the submenu.**
   Controls for something running right now (pause/resume, +5 min, cancel,
   end session, snooze/dismiss a finished timer) use `placement: "top"`.
   Starting something new, presets, status readouts, and settings-like
   commands stay in the plugin's submenu (the default placement). Don't put
   a command at the root just to make it more visible.
4. **Root titles must read on their own.** Root items have no plugin name next
   to them, so name the thing being acted on: "End focus session",
   "Add 5 minutes to timer", not "End session" or "Add 5 minutes".
5. **Order with `priority`.** Higher comes first within the plugin's own group.
   Registration order is not a reliable order once commands come and go.

Layout the host renders:

```
<plugin A root commands>        ← placement: "top", grouped per plugin
──────────────
<plugin B root commands>
──────────────
Plugin A  >                     ← submenu commands + ctx.ui.menu items
Plugin B  >
──────────────
Plugins / Open Control Center / Size / Flip
──────────────
Hide pet
```

Keep it bounded: the menu shows at most eight commands per plugin. A command
removed while the menu is open does nothing if clicked and is logged, so
handlers should still tolerate being called in a state where they no longer
apply. Grouping and dividers live in `apps/desktop/src/pet-window-context-menu.ts`.
[Official plugins](/official-plugins) lists what each bundled plugin shows in
each state.

## Authoring workflow (end to end)

1. **Scaffold**: `openpets plugin new <name> --template <blank|reminder|ambient|ai-chat|tamagotchi|calendar>`
   generates a `manifestVersion: 3` package with `index.js`, `test.js`, README,
   and `locales/en.json`. (`packages/cli/src/plugin-templates.ts`.)
2. **Develop**: write against the SDK ([Plugin SDK v3](/sdk)); hot-load via dev mode.
3. **Test**: `test.js` uses `@open-pets/plugin-sdk/testing` to fake time/events
   and assert descriptor-level effects - no Electron. See [Plugin SDK v3](/sdk).
4. **Validate**: `openpets plugin validate <dir>` checks manifest, permissions,
   SDK compatibility, config field types, network hosts, asset formats/size
   caps, entry files, and HTML panels. (`packages/cli/src/plugin-validate.ts`.)
5. **Package & publish**: see below.

Official plugins are the best worked examples for this workflow. Calendar
Airmail demonstrates OAuth, network allowlists, scheduled work, durable plugin
storage, status rows, and the host-owned `ui:delivery` surface; Quick Reminders
demonstrates reminder state, snooze/done actions, optional notifications, and
sound assets. See [Official plugins](/official-plugins) for the current
reviewed lineup.

## Packaging, catalog & release validation

The release path is gated by the validators in
[Testing and validation](/testing-and-validation), with maintainer release
steps in [Release guide](/release). The command surface (run from repo root):

| Command | Purpose |
|---------|---------|
| `pnpm plugins:check` | Validate the package plan (dry-run, no writes) |
| `pnpm plugins:package` | Write local catalog files + ZIP staging (no R2 upload) |
| `pnpm plugins:validate-release` | **Release gate** - catch production-breaking mistakes before shipping |
| `pnpm plugins:publish` | Generate + upload ZIPs to R2 |
| `pnpm plugins:validate-live` | Post-deploy validation against the live catalog |
| `pnpm plugins:deploy` | Deploy the web catalog |
| `pnpm plugins:release` | Full package → validate → publish → deploy → live-validate sequence |
| `pnpm plugins:test` | Run plugin locale checks + official/community plugin harness tests |

The release validator exists to catch exactly the production-breakers
`plugins:check` alone misses: unresolved `$t:` names/descriptions in catalog
cards, missing ZIPs, SHA mismatches, missing `locales/en.json`, missing declared
assets/entry files, and catalog/package drift. **Always run it before shipping a
plugin release.**

`plugins:package` and `plugins:publish` read both `plugins/official/` and
`plugins/community/`. Catalog v2 entries include `publisherType` so the app and
site can distinguish reviewed first-party plugins from community submissions.
Community plugins follow the same release validation but cannot set `bundled`.
When a plugin has a root `LICENSE`, `LICENSE.md`, or `LICENSE.txt`, the release
ZIP preserves it alongside the manifest and declared runtime files.

### Community plugin provenance, pending submissions, and owner safe updates

To lock down the integrity and security of community-submitted plugins without
modifying the app-facing `catalog.v2.json` schema, OpenPets uses website-only
sidecars:

- `web/public/plugins/provenance.json` - reviewed provenance for installable
  community plugins.
- `web/public/plugins/submissions.json` - pending external GitHub submissions
  shown on the website but not installable yet.

`provenance.json` maps plugin IDs to their verified upstream metadata:
- `publisher`: The GitHub username or organization owning the plugin.
- `sourceUrl`: The canonical upstream GitHub repository URL.
- `sourceSubdirectory`: Subdirectory in the repository containing the plugin manifest and files (if applicable).
- `sourceCommit`: The specific git commit SHA that was reviewed and approved.
- `reviewedAt`: ISO date when the current version/commit was reviewed.
- `updatePolicy`: Can be `safe-auto` (safe for automated publishing of owner updates) or `manual-review` (always requires manual PR review).

Pending entries in `submissions.json` are candidates only. They must not appear
in the installable catalog until promoted into `plugins/community/`, packaged,
uploaded to R2, and release-validated.

Plugin owners can publish updates to their plugins without needing a manual PR to the main OpenPets repository. They do this by tag-publishing new releases on their immutable GitHub repository. OpenPets automation periodically validates updates against the following safety rules:
1. **Repository & Publisher Match**: The release must originate from the same owner, repository, and plugin ID registered in `provenance.json`.
2. **Version Increase**: The release version must be a clean semver increase.
3. **No New Permissions/Capabilities**: The update must not request any new `permissions`, new `network.hosts`, new private local API/privileged capabilities, or changes to publisher configuration.
4. **All Tests Pass**: The package must pass all validation gates (manifest, SDK compatibility, locales check, ZIP and SHA matches).

If an update is determined to be **safe**, OpenPets CI/CD automation automatically updates the catalog entry version and re-packages the plugin. If any safety boundary is crossed, the update triggers a `manual-review` block and requires a maintainer to inspect and merge the change.

## Teams-owned plugins

The `team` source is a separate organization-owned lane installed under
`userData/team-plugins/{id}`. Team plugins carry immutable organization/item/
artifact/release references and generic personal actions cannot remove, toggle,
or reconfigure them. A Team-owned first install requires explicit approval in
the Teams route of Control Center, not in the Plugins tab. The approval displays
the current manifest permissions and declared network hosts; organization
configuration cannot bypass it, and the approval is bound to the current
organization/item/artifact/release identity. A Team Pack remains pending and not
current until that approval succeeds. Required plugins enable only when the
approved permissions cover the manifest; permission escalation blocks and reports
the item. Optional plugins install disabled and preserve the employee toggle
across updates. Team operations are serialized, and leave invalidates queued or
in-flight work. A rejected staged or activated Team install rolls back to the
last approved artifact and its state. Organization configuration is read-only
locally, removal clears only Team-scoped runtime, storage, and user-sound data,
and personal plugin state remains isolated.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Plugin marked "broken" | Manifest/action validation failed - check `plugin-diagnostics` / the inspector |
| SDK call silently does nothing | Permission not declared or not approved; or blocked by a global platform setting (audio/voice/quiet hours) |
| Network call rejected | Host not in declared `network` hosts |
| Catalog card shows raw `$t:...` | Missing locale key - `validate-release` should have caught it |
| ZIP install fails | SHA mismatch, non-HTTPS/disallowed host, or oversized/invalid ZIP entries |
| Local plugin won't load | Local loader rejected the folder (symlink/path/size) or manifest isn't at root |
| Icon/image missing | Asset not declared in `assets`, wrong format, or over size cap |

## Where to look first

| Concern | File |
|---------|------|
| Manifest schema/validation | `plugin-manifest.ts`, `plugin-manifest-reader.ts` |
| Orchestration / UI actions | `plugin-service.ts` |
| Runtime / scheduling / broken-state | `plugin-runtime.ts` |
| Sandbox host | `plugin-js-host.ts` |
| Permission + dispatch | `plugin-sdk-bridge.ts` + `plugin-sdk-*.ts` |
| Catalog install/verify | `plugin-catalog.ts`, `plugin-package.ts` |
| Local dev load | `plugin-local-loader.ts` |
| Official plugin examples | `plugins/official/*` |
