---
description: Tour the OpenPets desktop app process model, startup path, pet windows, plugin subsystem, local IPC, security model, and packaging notes.
---

# Desktop app

The desktop app (`apps/desktop/`) is the heart of OpenPets: the only long-lived
process, owner of all state, windows, the tray, pet rendering, the plugin
runtime, and the local IPC server that agents talk to. This doc explains its
process model, the major subsystems, and the rules that keep it secure and
stable. For the pet rendering specifics see [Pets](/pets); for the IPC wire
contract see [IPC and remote control](/ipc); for plugins see [Plugin platform](/plugins).

Source map: `apps/desktop/codemap.md` and `apps/desktop/src/codemap.md` are the
authoritative file-by-file maps. This doc is the narrative on top of them.

## Process model

Electron gives us a **main process** and multiple **renderer processes**. In
OpenPets:

- The **main process** (`src/main.ts` and the modules it orchestrates) holds all
  authority: state, lifecycle, tray, windows, IPC, leases, catalog/install,
  plugins, i18n.
- **Renderers** are sandboxed and powerless by default. Each gets a *narrow*
  preload bridge exposing only the APIs it needs:
  - The **Control Center** renderer (the React/Tailwind UI) via
    `control-center-preload.cjs`.
  - **Pet windows** (transparent, frameless, always-on-top) via `pet-preload.cjs`.
  - **Plugin JS hosts** and **plugin panels** via `plugin-sdk-preload.cjs`.

There is **no default main window**. The app is tray-first: tray actions open
the singleton Control Center routed to a specific page. A single-instance lock
(`app.requestSingleInstanceLock()`) focuses the existing instance instead of
launching a second one.

## Startup sequence

`main.ts` runs a deterministic bootstrap (see `src/codemap.md` for the exact
order): install lifecycle handlers → initialize app state → initialize the
logger → register the configured Talk shortcut → create the tray → start the
`PetDisplayCoordinator` → start the local IPC server → start the persisted, opt-in remote-control service if enabled
→ initialize and start the plugin service (with the Electron JS host) → start
the optional Teams service and reconcile its Team Pack → start the bundled
Manager Check-ins service → construct the host Pet Assistant service → optionally
show the default pet. Shutdown stops the `PetDisplayCoordinator` before
unregistering the exact shortcut and stopping voice, then stops the bounded Pet
Assistant turns and Teams before plugin teardown,
remote-control listener, local IPC server, and pet windows.

Key files: `main.ts` (entry/bootstrap), `lifecycle.ts` (app events + cleanup),
`state.ts` (shell pause flag).

## Optional Teams desktop scope

Teams is an optional cloud lane. `openpets://teams/enroll?intent=...` is parsed
only by the main process; the singleton Control Center is focused and routed to
the Teams contract route. One stable installation ID and nonsecret enrollment
metadata are stored atomically in a dedicated state file. The device bearer
credential is stored only with Electron `safeStorage`. For enrollment, the
desktop generates an ephemeral proof, sends it with the intent ID, installation
ID, and display name, and uses that same proof for bounded completion retry as
part of the single Accept & Enroll action. The API returns the intent expiration
and the desktop retries lost completion responses with the same proof only until
that server-defined window ends. Neither the browser token nor the
proof is stored in desktop state or included in logs; the proof is cleared after
terminal completion/failure or app shutdown. The browser token authorizes
progress/status reads only; it cannot confirm or complete enrollment. The API
issues a deterministically derived 256-bit credential after the desktop
completion call. The Teams route keeps **Accept & Enroll** disabled until a
completed preview supplies the authoritative organization identity and future
expiry; when a deep link arrives while the Control Center is already running,
the main process reuses its route event to make the renderer refetch that
completed preview. Teams starts after the plugin service, polls with bounded
jitter, and stops before plugin shutdown. Snapshots expose separated Team
pets/plugins and status, never credentials, enrollment tokens, proofs, or full
server packs.

The Teams Control Center view presents a distinct empty-state when not joined:
a compact marketing CTA with feature highlights links externally to
`https://openpets.dev/organizations` via `openpets:open-organizations-page`,
accompanied by member deep-link enrollment guidance and the personal content
isolation guarantee.

Team synchronization, installation, and leave operations are serialized. Leaving
invalidates queued and in-flight Team work, so a late sync or install cannot
reapply organization state after departure. A Team Pack stays pending and is not
the current revision until its current artifact has received explicit first-install
permission approval in the Teams route. The approval view displays the artifact's
requested permissions and declared network hosts; organization configuration does
not bypass it, and approval is bound to the current artifact. Rejected staged or
activated Team installs roll back to the last approved state.

### Manager Check-ins

Manager Check-ins is a bundled desktop capability that shares Teams enrollment
and organization identity but does not use Team Pack configuration or transport.
The main-process `ManagerCheckInService` syncs the organization’s schedules and
the enrolled employee’s submitted history through the dedicated device API. Its
atomic local state lives at `userData/openpets-manager-check-in-state.json` and
is bounded to the newest 200 submissions and 512 KiB.

Managers create multiple named schedules in Teams. A schedule is independently
enabled and has its own prompt copy, feeling labels, start date, and structured
recurrence: every N days; every N weeks on selected weekdays; every N months on
selected dates or the last day; or selected months/dates within calendar
quarters. A numeric date that does not exist in a month is skipped. Scheduling
uses the enrolled desktop’s local calendar and is offered for the matching local
day only; it has no timed nudge, cron support, generic task surface, or
off-schedule submission.

The Control Center provides sync, a read-only personal history, and a
device-private pause. It is not a schedule editor or check-in submission
surface. A due schedule appears only on the default pet: one private Check-in
circle beside Chat/Talk, with a count for concurrent due schedules. It opens one
in-pet card at a time. The card uses that schedule’s prompt copy and the five
fixed feelings, accepts an optional 500-character note, shows the organization
disclosure, and requires an explicit Share action. Successful sharing advances
to the next local due schedule or clears the circle.

Closing the card, letting an offer disappear, pausing, or leaving a schedule
unanswered produces no server event. The local pause hides all scheduled pet
actions and is never synchronized to Teams. The service persists only the
minimal private queue lifecycle needed for scheduled offers and retries; the pet
projection exposes its current item and count, never a manager-visible pending
or activity signal.

Each submission is immutable, schedule/cycle-specific, and includes the prompt
snapshot that was shown. The API derives the canonical cycle ID from schedule
and local date, enforces one submission per employee/schedule/cycle, and keeps
client-generated-ID retries idempotent. A short-lived, device- and
payload-bound receipt permits an explicit submission retry immediately after
midnight without admitting a fresh late submission. The desktop and dashboard
never expose replies, skips, missing-response/activity tracking, pet-usage
telemetry, or anonymous mode.

## Linux display backend (Ozone/Wayland)

On Linux, `main.ts` appends `--ozone-platform=x11` **before** `app` is ready, so
the app always runs under x11/XWayland. This is required because OpenPets pets
depend on programmatic top-level window positioning (`setPosition`/`setBounds`)
and z-order control (`setAlwaysOnTop`); native Wayland forbids clients from
positioning or restacking their own toplevels, which silently breaks motion,
gravity, walkabout, drag, and always-on-top stacking. The forcing is
unconditional (it overrides even an explicit `--ozone-platform=wayland`) so a
mistaken launch flag cannot disable pet movement.

The escape hatch is the environment variable `OPENPETS_ALLOW_WAYLAND=1`: when
set, the app honors the system default backend (or an explicit
`--ozone-platform`) and emits a one-time `warn("app", ...)` at startup (after the
startup-begin log) stating that positioning, gravity, walkabout, and drag are
unsupported under native Wayland and how to restore full functionality. The
pet-drag path keys off this same effective backend via
`isEffectiveWaylandBackend()` in `pet-window.ts`, which is evaluated at
window-creation time (after the switch is applied) and cached. The pure backend
decision (platform + `--ozone-platform` + `XDG_SESSION_TYPE`/`WAYLAND_DISPLAY`)
is factored into `computeEffectiveWaylandBackend()` in `wayland-backend.ts`;
`pet-window.ts` delegates to it and owns only the cache.

The x11-forcing branch and the `OPENPETS_ALLOW_WAYLAND` opt-out are asserted by
`check-packaging-contract.ts`, so this behavior cannot silently regress.

On Windows, the shell silently strips `HWND_TOPMOST` from other windows when an
app enters fullscreen (browser video, games) and never restores it - and no
Electron event fires when it happens, so the `show`/`restore` re-assertions
never run and the pet stays buried until manually toggled. Pet windows
therefore re-assert always-on-top on a 1s interval while visible (the
shell's demotion sweep re-strips the flag every ~2-4s while a fullscreen app
is foreground, so the cadence bounds the buried time to under a second),
dropping
Electron's cached always-on-top flag first - Electron short-circuits
`setAlwaysOnTop(true)` when its cached state already matches, so without the
cache-bust the re-assert never reaches the OS
(`createBasePetWindow` in `pet-window.ts`); the call is a cheap no-op while the
flag is intact, and keeping the pet above fullscreen content matches the
explicit macOS `visibleOnFullScreen: true` behavior.

Separately, Chromium's native window occlusion tracker considers every window
on a display occluded while a fullscreen app is active there and stops
painting it - a transparent pet window goes blank even with its z-order
intact. `main.ts` disables `CalculateNativeWinOcclusion` on Windows so the
pet keeps rendering during fullscreen video and games.

## Subsystems

### Tray & windows

- `tray.ts` builds the tray icon (`assets.ts` loads `assets/tray-icon.png`,
  keeps it as a full-color image, and falls back to a generated icon if the
  asset is missing) and the context menu,
  including update status and route-targeted Control Center entries and a "open
  logs" action.
- `windows.ts` is the Control Center coordinator: it creates the hardened
  `BrowserWindow`, loads the Vite renderer (dev) or packaged `dist/renderer`
  (prod), targets a route, registers all renderer-facing IPC handlers, builds
  the Dashboard snapshot, and defines the internal asset protocols.
- `display.ts` provides screen-geometry helpers for positioning pet windows,
  including the permissive `clampToNearestDisplayIfOffscreen` helper that allows
  pets to roam across display seams while only snapping when fully off-screen.

### Control Center (renderer)

The React/Tailwind UI under `src/renderer/`. Pages: **Dashboard,
Pets, Settings, Plugins, Integrations, Teams**. It is a pure consumer of main-process
snapshots and actions exposed over the preload bridge - it holds no privileged
capability of its own. The Control Center renderer is the only management
frontend in scope for these docs; the companion renderer is documented above
and the `web/` marketing site is out of scope. See
`src/renderer/src/codemap.md` for component structure.

The **Teams** route presents organization membership, applied/pending revisions,
sync timestamps, and separated lists of organization-managed team pets and team
plugins while preserving personal content in an isolated lane. It supports
pending deep-link enrollment with display-name input, explicit synchronization,
explicit leave with destructive-action confirmation, and clear presentation of
permission-block or synchronization failure states. Team-owned first installs
require an explicit approval here, not in the Plugins tab: the approval shows all
requested permissions and network hosts and is bound to the current artifact, so
organization membership or policy cannot silently approve it. Team Packs remain
pending/not current until that approval succeeds.

Provider-profile bridge operations are exposed by
`control-center-preload.cjs` without a generic renderer-side settings store:
list profiles, the canonical adapter/preset catalog, role status, and derived
realtime status; atomically save a typed profile, credential, and selected roles;
create/update/delete a profile; select a profile independently for each role;
 update platform gates; set/check/delete a profile credential; and test an
  unsaved profile draft. The Hearing role supports both generic
  OpenAI-compatible transcription and the native ElevenLabs Scribe STT preset;
  the latter sends bounded multipart audio to ElevenLabs with `model_id` and
  `xi-api-key` authentication. A setup test resolves its inline credential only for
 that one request: it never writes the profile, role selection, headers, or
 credential. Text sends a tiny completion, TTS returns a short configured-voice
  preview through the trusted host player, STT uses a host-owned bounded transcription
  session on the shared microphone arbiter (ownership is reserved before
  device enumeration, and renderer loss/modal close/replacement/shutdown
  cancel every in-flight setup request and recording; the renderer never owns
  `getUserMedia` or `MediaRecorder`), Realtime creates a minimal session
  configuration, and system TTS uses the selected local speech-synthesis voice.
  Network speech previews and Talk/realtime remote audio use the persistent
  trusted voice-media player with a serialized per-operation ownership claim and
   output snapshot. Initialization cancellation cannot start late audio. Output
   capability is reported only after a bounded probe of
   `HTMLAudioElement.setSinkId` in the trusted player document, with explicit
   unavailable/unsupported states. Unsupported
   or rejected sink routing is reported as OS-default fallback; System TTS stays
   on `speechSynthesis` and does not claim speaker routing. Control Center
   Settings → General exposes a cohesive Voice Devices routing section allowing
   the user to inspect discovered inputs/outputs, select preferred devices with
   truthful disconnected fallbacks, and refresh hardware lists; microphone changes apply
   to the next turn without mutating in-progress audio. Responses contain only credential
   presence and header names, never secret references or header values.
   Ending one Talk session disposes only that session's playback owner and stops
   its request; it does not shut down the shared media player. Permanent shared
   player shutdown is reserved for application voice shutdown, so later Talk,
   preview, and plugin-generated speech remain usable.

### Pet Assistant In-Pet Attached Chat & Compact Composer

The default pet carrier contains an in-place compact text composer and an attached expandable
in-pet chat panel managed by `default-pet-chat.ts` and `pet-preload.cjs`. In its default collapsed
state (200×200), the carrier displays speech bubbles. Chat and Talk quick action buttons are opt-in
in Settings; once enabled, tapping Chat or the launcher switches the compact frame into an in-place
text composer (input/textarea, Send, cancel, busy state) without resizing the window or opening full
history. Submitting a turn hands off response rendering directly to the pet speech bubble.

When full history is explicitly opened via the transcript affordance, the carrier window expands to
420×640 using bijective coordinate transforms from `default-pet-chat-geometry.ts` that
preserve the pet's on-screen anchor point. The attached chat panel is anchored directly above
the scaled pet sprite with a 10px gap, growing upward from 220px to 500px as content changes
while the pet remains stationary at the bottom. Non-pinned floating speech bubbles and quick
launcher buttons are suppressed while full chat is open; pinned HUD bubbles remain visible and
lift both chat surfaces with the pet, regardless of HUD scale.

Assistant turn feedback routes operational context (header state, tool cards, turn status) inside
the expanded chat. Duplicate speech bubbles are suppressed while chat is open, while pet reaction
and activity animations (`thinking`, `working`, `error`) continue to play on the sprite.
Closing the chat never replays closed conversation turns; normal ambient speech bubbles resume
cleanly for subsequent turns. Draft text is preserved across open/close lifecycles, whether
triggered by Escape, the close button, launcher toggles, or carrier collapse.

On Linux, `pet-window-shape.ts` computes exact input masks (`setShape`) for collapsed,
compact-composer, and expanded carrier states, keeping mouse passthrough and focus
semantics correct under X11 and Wayland. For expanded chat, the mask aligns with the
bottom-anchored panel bounds, tracking dynamic panel height reported from the renderer via
`ResizeObserver`. Compact open/close is owned by the main
process alongside expansion: opening makes the carrier focusable and adds the
composer rectangle to the input shape; closing restores the passive pet shape and
focus policy. The compact composer is anchored above the pet with a 12px visual gap
below its 6px tail. It has one shared maximum geometry contract: its
multiline textarea is capped at 68px and error feedback at 34px, producing a
152px maximum envelope used by both CSS and the Linux mask.

The in-pet chat interface exposes the current conversation snapshot, typed turn
actions, tool invocation cards, prompt suggestions, and Talk actions/events. The
renderer consumes the authoritative Talk snapshot (`status`, `activity`, and
`muted`) and snapshot events only; it does not maintain a parallel voice state.
Initial and streamed conversation/Talk snapshots are applied by sequence/revision
ordering so a late initial IPC response cannot replace newer streamed state.
Archive list/delete/clear operations remain host-owned Control Center IPC for Settings presentation
and are never exposed to the pet carrier. The local-only atomic archive at
`userData/openpets-conversation-history.json` remains the persistence/context seam.
Normalized voice transcript events remain an
integration seam for #147: their adapter must provide a process-lifetime
monotonic sequence within the voice source; voice ordering is deliberately
independent from the canonical assistant event sequence.
The provider UI is role-first: each of Text, STT, and TTS has its own selected
profile and readiness state, while Realtime is shown as a derived status from
the selected text profile. The guided modal renders adapter-specific controls,
including separate normal-text/realtime models for OpenAI Realtime and a
persistent voice control for network TTS. Credential changes use dedicated
host actions; opaque secret references are host-managed and are not editable in
Control Center. Existing static headers are redacted to names in snapshots and
edited through host-applied `add`/`replace`/`delete` operations, so their values
never need to cross into the renderer. The host commits profile, credential,
and role changes atomically.

Talk controls are exposed through narrow preload methods (`getVoiceAssistantSnapshot`,
`startVoiceAssistant`, `retryVoiceAssistant`, `muteVoiceAssistant`, `unmuteVoiceAssistant`,
`interruptVoiceAssistant`, `endVoiceAssistant`, and `onVoiceAssistantEvent`).
The stable generic and Realtime voice-session type contracts are owned by
`src/voice-assistant-session-contract.ts`; `src/voice-assistant-session.ts`
retains the mutable generic session stages and lifecycle implementation.
The shortcut accelerator is persisted in Settings and its runtime status and
reason are part of the authoritative Talk snapshot/event contract. Runtime
status is `registered`, `conflict`, `unavailable`, or `invalid`; registration and
unregistration failures are never presented as active, and a failed unregister
retains ownership so a replacement cannot create an untracked shortcut. The
default is the canonical `CommandOrControl+Shift+Space`. Replacing a preference
unregisters the exact previous accelerator before attempting the new one. Pet,
Pet, tray, and shortcut entry points all use one host-owned toggle (start when
inactive, submit the active generic recording when one is available, and become
an idempotent no-op once processing has begun). Ending is explicit through the
End Talk control or terminal one-shot completion; the native Realtime lane
likewise never ends from its primary toggle while active. A second, independent
global shortcut
(`chat-shortcut.ts`, preference `chatShortcut`, disabled by default via an
empty accelerator) toggles the compact pet chat composer using the same
manager/rollback semantics. Both shortcuts, plus the on-pet chat and talk
buttons (visibility, corner, and size — `showChatButton`, `showTalkButton`,
`petButtonsPosition`, `petButtonsSize`), are configured in the Settings →
Chat & Voice tab. Chat and Talk button visibility defaults to off for new or
unconfigured preferences. The talk button uses the same host-owned voice toggle; the
buttons hide during transient bubbles but stay visible alongside pinned plugin
HUDs. The contract reports only host-observed session
state, not fabricated microphone device metadata. Ending voice releases
voice-only state while preserving the shared assistant conversation.
Snapshots may include the optional `canSubmitRecording` capability flag for
the separate Talk UI lane; native Realtime leaves it unavailable.
The generic recording submit atomically clears `canSubmitRecording` and moves the
canonical snapshot out of `listening` before capture `stop()` settles. While STT,
the assistant, synthesis, or playback owns that one turn, primary Talk clicks do
not cancel, end, or start another turn. The collapsed response bubble is applied
once the final assistant transcript is available, before TTS starts or while it
plays; playback settlement only performs terminal cleanup/status handling. Late
activity snapshots cannot overwrite the settled result. The tray subscribes to
the same authoritative Talk snapshots so its Talk/End Talk label follows session
transitions without duplicating lifecycle state.
Typed chat and Talk share one host-owned modality lease for the current
conversation. A competing turn is rejected before capture or model work with
an actionable busy error; leases release on terminal settlement, end, or
shutdown. Terminal feedback is the only failure/missing-information trigger;
the latter is shown only when the structured capability boundary explicitly
declares `missingInformation: true`, including a missing required field at the
host-owned capability input validator.

### Pet windows

Pet rendering and lifecycle setup live in `pet-window.ts` plus the two controllers
(`default-pet-controller.ts`, `agent-pet-controller.ts`) and the motion/mapping
helpers. `pet-display-coordinator.ts` owns display/power listener lifecycle and
cross-controller topology/recovery fanout. `pet-window-interaction.ts` owns the per-window mouse/drag and renderer
IPC lifecycle, recovery/watchdog, and speech-completion bridge. This is covered
in depth in [Pets](/pets).

### Local IPC server

`local-ipc.ts` runs a `net.Server` over a Unix socket / Windows named pipe /
TCP, routes a versioned JSON protocol, and writes a discovery file so clients
can find it. The lease manager (`lease-manager.ts`) sits behind it. Full
contract in [IPC and remote control](/ipc).

### Remote control service

`remote-control-service.ts` is deliberately not a mode of `local-ipc.ts`. It is
disabled unless a local caller explicitly configures a concrete private,
loopback, link-local, or CGNAT-range IPv4 address and port. Wildcards, public
addresses, hostnames, IPv6, non-canonical IPv4 text, and port zero are rejected.
Its own versioned protocol has a 4 KiB payload cap, bounded socket lifetime,
concurrent-socket cap, and per-remote-address rate limit. The absolute deadline
remains through response shutdown so half-open peers are reclaimed without
truncating a complete response.

Pairing creates a named client and a high-entropy token. The plaintext token is
returned only by the local pairing/rotation API; persistence stores only its
SHA-256 verifier plus client metadata and activity timestamps. The main-process
IPC interface (`openpets:remote-*`) supports Control Center management: configuration,
pairing, listing, rotation, and revocation. Control Center (Settings → Remote)
provides a dedicated UI with listener configuration, explicit IPv4 bind validation,
a prominent unencrypted TCP transport warning with explicit acknowledgement before
enabling, paired client listing with scope badges, pairing with `say` unchecked by default,
a one-time token handoff panel with environment/CLI setup guidance (`OPENPETS_REMOTE_ENDPOINT="tcp://<address>:<port>"` derived from active listener state), and confirmation
modals for token rotation and client revocation.

Remote requests can only read a sanitized status snapshot, react to the default pet,
or say a short validated message with the `say` scope. Leases, installation, discovery,
files, media, paths, prompts, tool output, and arbitrary pet targets are not part of the
remote capability. Explanatory copy in Control Center highlights these default-pet-only
and no-files/media constraints. LAN ownership is initialized before the remote service
singleton and Control Center handlers; the persisted listener starts only after the normal
UI/local-IPC startup steps. While LAN ownership is unknown or belongs to another host,
remote reactions and speech return `shown: false` instead of waking or forwarding the
local default pet. With LAN mode off, local default-pet behavior is unchanged.

**Pet fallback notification:** when an agent requests a specific pet via
`--pet <id>` and that pet is not installed (or is invalid/broken), the lease
manager silently falls back to the default pet and window confinement does not
activate. `pet-fallback-notify.ts` detects this condition and fires a native
macOS notification (once per unique pet ID) so the user knows why confinement
is inactive. The notification includes the command to use once the pet is
installed.

### App state

`app-state.ts` persists a versioned JSON document under
`userData/openpets-state.json` using atomic temp-write + rename. It holds
installed pets, the default-pet config, reaction→animation overrides, onboarding
state, locale preference, the pet pool preference (ordered pet list +
`petPoolEnabled` toggle), the host Pet Assistant personality profile, and display-roaming preferences (`petConfinementEnabled`,
`petCrossDisplayEnabled`), plus the global `waitingAnimationDurationMs`
preference, the `idleCursorGazeEnabled` V2 idle-gaze toggle, and canonical
`voiceAssistantShortcut` accelerator. Idle cursor gaze defaults to enabled and
is configurable in Control Center → Settings → General. Eligible V2 pets treat
cursor movement as a short glance: they follow direction changes and return to
neutral after about 1.2 seconds without movement. Disabling it promptly returns
eligible V2 pets to their neutral idle pose and stops the shared gaze ticker;
enabling it resumes tracking. Reactions, motion, dragging, pausing, explicit
presentation overrides, and V1 pets are unaffected. That duration is normalized to `1010` ms (Normal) or `2200` ms
(Relaxed), with `1010` ms as the default. `app-state-core.ts` and
`pet-assistant-personality.ts` hold pure normalization helpers that are testable
without Electron.

Installed pet records persist their source ownership. That ownership selects the
Team or personal pet root; the app never infers ownership from whichever directory
currently contains an artifact. Team reconciliation and rejected installs restore
the prior Team state without overwriting or removing personal catalog or Codex
pets.

#### Pet pool preference

The **pet pool** is an ordered list of installed pets plus a master enable/disable
toggle (`petPoolEnabled`, default `true`), both configurable in Control Center →
Settings → General. When enabled, the lease manager uses the ordered list to
assign a distinct pet to each concurrent agent session that does not explicitly
request one via `--pet <id>`. Slot 1 is the primary/default pet; slot 2 onwards
are assigned to additional sessions in order. When all pool slots are taken,
further sessions receive a random eligible pet (installed, non-broken, not the
built-in default). Slots free up when their session ends. `--pet <id>` bypasses
the pool entirely. When disabled, all sessions without `--pet` share the single
default pet (legacy behavior). Pool assignment is pure lease logic and works on
all platforms.

**Toggle side-effects:** disabling the pool immediately despawns all active pool
pets (releases their leases, which closes their windows). Re-enabling respawns a
pool pet for every session whose client PID is still alive - those sessions
acquire new leases and their windows reopen. Sessions whose processes have already
terminated are skipped. This is handled by `dispatchPoolToggle` in `local-ipc.ts`,
wired from the `update-preferences` IPC handler in `windows.ts`.

**Session teardown:** a periodic liveness sweep (the `local-ipc.ts` cleanup timer
calling `lease-manager.ts`'s `checkPidLiveness`) releases an agent pet's lease - and so closes its window - once the owning session is gone. It probes the
**terminal owner PID** (when known) as well as the client PID, so an orphaned but
still-running client can't keep a pet alive indefinitely. Expiring the 15s TTL is
the backstop; liveness is the prompt path.

See [Agent integrations](/agent-integrations) for the
full behavioral description.

### Plugin subsystem

A large, self-contained subsystem (`plugin-*.ts`) covering manifests, state,
runtime, the sandboxed JS host, the permission-checked SDK bridge, catalog/local
install, assets, panels, diagnostics, and platform settings. Fully documented in
[Plugin platform](/plugins) and [Plugin SDK v3](/sdk).

The plugin voice foundation is deliberately smaller than a conversation platform.
  `voice-device-service.ts` owns durable opaque input/output preferences, capability
snapshots, and immutable per-operation input resolution. Its Electron companion
enumerates devices in one trusted, persistent `openpets-voice-media` partition and
  limits `media` permission to the capture and realtime documents; the media
  player receives only `speaker-selection`. `voice-capture-electron.ts`
owns a hidden, sandboxed microphone window and shared session; `voice-capture.ts` owns exactly-once cleanup and cancellation; and
`voice-privacy-indicator.ts` tracks live microphone ownership after
`getUserMedia()` succeeds and drives the transient Electron privacy surface. The
surface is reference-counted across one-shot and Realtime owners, appears only
while at least one microphone track is live, and is destroyed during shared
voice shutdown. A capture is one-shot and one-at-a-
time, with a 15-second acquisition timeout, a separate 30-second transcription
timeout, and an explicit host cancellation path. Plugin teardown and app shutdown
cancel the active capture, abort transcription, stop tracks, destroy the capture
window and clear the live-track accounting. No ambient or
wake-word listening is implemented. While active, the existing tray menu exposes
**Stop microphone listening** during acquisition/recording and **Cancel
transcription** while provider transcription is pending; the control disappears
when the operation settles.

The private `VoiceConversationService` and hidden, sandboxed realtime renderer
remain host infrastructure. When the explicitly selected text profile uses the
native `openai-realtime` adapter and the derived realtime status is ready, the
Talk surface creates the optional
`OpenAIRealtimeVoiceAssistantSession`; other text profiles keep the generic
STT -> Pet Assistant -> TTS path. The realtime lane shares the microphone and
modality leases, tracks interruptions and mute state, rejects stale events, and
releases only its own resources on close. It never resets shared live-track
accounting; `voice-resource-owner.ts` performs final teardown after every lane
stops. The renderer owns `getUserMedia`, WebRTC, the data channel, and remote
audio. It emits only bounded normalized transcripts and tool-call requests; the
host keeps credentials, builds canonical tools, executes capabilities through
the Pet Assistant service, and encodes provider-specific results back to
Realtime. Response IDs and input item IDs remain attached through the normalized
event boundary so delayed events from an interrupted response cannot mutate the
replacement canonical turn. No plugin SDK route or plugin permission exposes
this adapter.

#### Generic host voice session and Talk controls (#147, #150)

`voice-assistant-host.ts` exposes a host controller/factory, not an app-lifetime
terminal session. Each activation creates one `VoiceAssistantSession`; ending it
releases the microphone reservation and the next activation creates a fresh
session. The composition is bounded final-only capture/transcription → canonical
Pet Assistant → authoritative TTS. Text, STT, and TTS provider profiles are
independent, with the STT profile snapshotted before capture begins. #150 adds
bounded host controls and a pet-owned Talk entry. Generic session transcript
events and the optional Realtime adapter are normalized
into the #148 current-session Conversation projection; terminal text is also
eligible for the #149 host archive, while voice lifecycle itself remains
host-owned. A single app-lifetime feedback reducer consumes typed and
voice canonical events plus listening and actual playback transitions. Canonical
`responding` remains thinking, speaking is emitted only after playback starts,
cancellation is not failure, and missing-information is shown only when the
canonical outcome explicitly marks it. Talk is one-shot: after the submitted
recording reaches terminal synthesis/playback completion or failure, the voice
session ends, releases its resources, and does not reopen capture. A fresh
explicit Talk activation is required for the next recording. Native Realtime
uses `response-completed` as its safe terminal boundary and closes its transport
after that response; its primary toggle remains non-destructive while active.

Pet-window playback is request-scoped by `{ requestId, kind }`. Renderer audio and
system speech settle replacement, matching/unscoped stop, error, close, renderer
loss, navigation, and timeout paths exactly once. Deadlines are bounded but
duration-aware: system speech accounts for the complete chunked text and speech
rate, while provider audio receives a generous allowance under the hard maximum.
System speech reports one completion only after the last chunk, preserving the
authoritative assistant text. Voice activity uses its own composable pet slot, so
voice animation/status cleanup cannot erase an unrelated plugin message, media
bubble, or status badge. It maps listening/thinking/acting/speaking to
waiting/thinking/working/running and clears the voice slot on mute, pause, end,
and shutdown.

#### Pet Assistant host integration (#138, #146)

Once `PluginService.start()` resolves, `pet-assistant-host.ts` constructs the
single host-owned `PetAssistantService`. `text-model-client.ts` uses a stable
operation snapshot from `provider-service.ts` for the selected text profile;
secret credential values are resolved from `PluginSecretsStore` and never enter
settings or snapshots; optional static provider header values remain in the
local provider-profile settings and snapshots expose only their names. The adapter never uses the
plugin `ctx.ai` gateway. Capability discovery and execution call the
generation-pinned `PluginService` APIs; pre-invocation lifecycle rejection is
unavailable, while a disable/reload after invocation is indeterminate.

`PetAssistantMemory` is the Electron-/filesystem-free owner of completed-turn
active context and the optional archive seam. It bounds active turns, selects
archive context before active context with archive-turn deduplication, appends
only canonical terminal user/assistant text for the default conversation, and
delegates archive list/delete/clear operations. The service keeps model,
capability, cancellation, terminal-reduction, and realtime lifecycle ownership;
it hands memory the outcome only after canonical terminal text replacement.
The service validates whole tool batches before side effects, bounds
context/tool/final payloads, and cancels active model/capability waits during idempotent shutdown. Missing model
configuration fails a turn clearly and does not prevent desktop startup. The
host injects a synchronous composition provider backed by `app-state.ts`.
`PetAssistantService` captures the returned profile at the beginning of each
turn, so Settings edits are visible to the next turn while an active turn keeps
one stable composition snapshot. The profile contains bounded `petName`, `tone`,
`style`, `ownerAddress`, and `responseLength` fields with neutral defaults.

The system prompt order is immutable host rules, optional curated context, a
fixed-order JSON personality data block with escaped prompt markers, and a
current-time section (local ISO timestamp with UTC offset plus the IANA
timezone) so absolute-time capabilities such as `reminders.create` receive
future timestamps. Realtime voice sessions compose it once when the session
opens. The
most-recent local archive window follows the system message and is bounded to
24 entries/128 KiB; active in-memory context remains a separate bounded layer.
The archive contains only terminal user/assistant text from the canonical shared
conversation. Tool definitions/results, provider payloads, and personality data
never enter it. The current structured capability definitions and authoritative
results remain provider-neutral tool data. Personality is explicitly
communication-only and cannot grant capabilities, change permissions, or
rewrite failed, rejected, unavailable, or indeterminate outcomes. When any
such non-completed outcome exists, the terminal response is a deterministic
host-generated status summary rather than model prose; all-completed turns
preserve the model response. The archive is local-only and atomic, with 200
messages/30 days/512 KiB retention and a 64 KiB per-entry cap; corrupt data is
quarantined/replaced. A narrow Control Center bridge permits only listing,
deleting one archived message, or clearing the archive; its local-history panel
is separate from the active session and updates after a terminal turn or owner
deletion. There is no semantic retrieval, summary, preference, network
synchronization, or provider call for archive reads. Provider-profile management
is implemented in the Control Center
through the host-owned bridge.

Capability tools use readable lowercase provider names derived from plugin and
capability ids. The host adds a deterministic suffix only when normalization
collides or a provider length limit requires truncation. The in-pet action row
shows the capability description as a friendly label while retaining the exact
provider name separately for dispatch and event correlation.
The attached chat header and Dashboard hero title use the companion's personal
display name from the saved personality `petName` (falling back to the active
pet asset name if the personal name is unusable, and `Assistant` if neither is
available). Pet manager cards, the pet catalog, and system tray continue to display
the pet asset name. Personality preference updates broadcast to the Control Center
and pet carrier to refresh the hero title and chat header live.

The plugin subsystem also owns **display deliveries**: a lazy, transparent,
host-owned surface used by `ctx.ui.delivery`. A delivery is rendered as a single
courier-and-banner surface on the cursor display, rather than as a spawned pet
or a plugin-controlled overlay. Each display advances a bounded FIFO queue;
expiry, dismissal, display removal, plugin reload/disable/uninstall, and app
shutdown are host lifecycle events. The host animates the declared courier strip
and owns its layout; plugins only supply a trusted sprite reference and text.

Calendar Airmail's configuration is a plugin-exclusive courier picker. It is an
accessible animated sprite grid whose selected/hovered/focused cards animate,
while reduced-motion users see a static first frame. It does not select, preview,
or validate installed pets; its bundled courier sprites remain available wherever
the plugin is installed.

### Agent setup

`agent-setup.ts` detects installed agents and runs configuration actions (MCP
add/replace/remove, hooks install/uninstall/doctor, memory file install),
delegating to the integration packages. It also owns the OpenClaw setup
boundary: the configured `openclaw` executable is used for version, list, and
inspect discovery, while install/update/enable/remove actions are run only for
the owned npm package and are verified by a post-action refresh. Nix mode,
unsupported hosts/versions, nonstandard plugin ownership, invalid metadata, and
failed refreshes remain explicit status states rather than being auto-mutated.
`claude-memory.ts` manages the Claude instructions file. The Control Center
consumes the setup snapshot and actions through `windows.ts`; the CLI's global
`configure --agent openclaw` flow uses the same OpenClaw management contract but
does not use a project path or pet selection. See [Agent integrations](/agent-integrations).

### Catalog & installation

`catalog.ts` fetches the pet catalog (v3 paginated, with v2/fixture fallback);
`pet-installation.ts` downloads + validates + extracts pet ZIPs; `codex-pets.ts`
imports locally-developed pets. See [Catalogs](/catalog) and [Pets](/pets).

### i18n

`src/i18n/` resolves the active locale and serves localized host UI text and pet
reaction speech, with English fallback. See [Internationalization](/i18n).

### Updates

`update-checker.ts` polls GitHub releases and surfaces update status to the tray
and Dashboard; `update-version.ts` does version parsing/comparison.

### Logging

`logger.ts` provides scoped, structured logging (scopes include `app`, `ipc`, `lease`,
`pet.*`, `state`, `tray`, `ui`, `voice`, `provider`, and the dev-only `capture`) with log rotation (~2MB) and redaction of
sensitive data, written to `userData/logs/openpets.log`. Renderer diagnostics
should be routed here so failures are visible in the log file, not only DevTools
(see the logging guidance in `AGENTS.md`).

Talk diagnostics make the one-shot path readable in production logs: session start;
capture requested/acquired/finished, cancelled, or failed; STT requested/succeeded,
cancelled, or failed; brain turn requested/completed, cancelled, or failed; speech
synthesis requested/returned or failed; and playback started/completed, cancelled,
or failed, followed by session end. Provider diagnostics independently record the
outbound and terminal lifecycle of text, STT, TTS, and realtime requests, including
role, adapter, profile ID, safe API path, status/elapsed time, and bounded output
size or transcript/reply character counts.

Diagnostics deliberately exclude credentials and auth headers, base URLs, request
payloads, raw user or assistant text, audio bytes, and full provider responses.
Cancellation records include the available reason (`user`, `session`, or `capture`)
so a user stop, teardown, and capture failure are not conflated.

## Security model

This is non-negotiable surface area. The app handles remote content (catalogs,
ZIPs) and runs third-party plugin code, so it is defensive by construction:

- **Sandboxed renderers** with `contextIsolation`; capabilities reach them only
  through narrow `contextBridge` preload APIs.
- **Strict CSP**: `default-src 'none'`, inline styles only. Any new
  renderer-visible URL scheme, image source, dev endpoint, or internal protocol
  **must** be added to the CSP in *both* `apps/desktop/vite.config.ts` and
  `apps/desktop/src/renderer/index.html`. Common pet image protocols:
  `openpets-codex:`, `openpets-installed:`, `openpets-pet-preview:`, and
  `openpets-plugin-asset:`. Forgetting the CSP makes images fall back to the
  default pet even when install/render logic is correct. (This is a documented,
  easy-to-hit footgun in `AGENTS.md`.)
- **Pet-window media CSP**: both HTML documents generated by
  `createBuiltInPetRender` and `createInstalledPetRender` allow imported and
  synthesized audio data URLs through the sole media exemption, `media-src
  data:`. They do not allow file or network media sources.
- **Mock keychain** to avoid OS credential prompts.
- **IPC network security**: local TCP mode is restricted to loopback/private
  addresses; public IPs and hostnames are rejected. Remote control is separate,
  opt-in, explicitly bound, authenticated per client, and scope limited; it
  never writes a discovery file. See [IPC and remote control](/ipc).
- **Defensive I/O**: atomic writes everywhere; path-traversal and symlink checks
  on every filesystem boundary; strict ZIP entry validation (`zip-safety.ts`).
- **Plugin sandbox**: plugins run in hidden, session-partitioned BrowserWindows
  with navigation/window-open hardening and permission-gated SDK calls. See
  [Plugin platform](/plugins).

- **Trusted plugin assets**: `openpets-plugin-asset:` serves only an enabled,
  exact-version JavaScript plugin's declared sprite. The protocol accepts only a
  narrow sprite route, resolves it beneath the real install root, rechecks WebP
  dimensions against manifest frame metadata, and returns no filesystem paths to
  a renderer. Delivery documents have their own restrictive CSP and can load
  only this protocol (or data URLs).

## Packaging

`electron-builder.yml` configures cross-platform packaging (macOS/Windows/Linux)
with ASAR. Bundled mode unpacks the integration runtimes from ASAR so hooks, MCP,
editor setup, and the native OpenClaw plugin can spawn them.
`scripts/release-local.mjs` builds an isolated unpacked package for every
platform/architecture target and then extracts the actual DMG, ZIP, AppImage,
DEB, RPM, and tar.gz payloads for target-aware `check-packaging-contract --output`
validation before copy/tag/publication. See [Development](/development) for the
release flow.

## Where to look first

| If you're touching… | Start in |
|---------------------|----------|
| Tray menu / Control Center routing | `tray.ts`, `windows.ts` |
| Pet appearance / animation | `pet-window.ts`, `reaction-animation-mapping.ts` ([Pets](/pets)) |
| Pet drag / click-through / interaction lifecycle | `pet-window-interaction.ts`, `pet-preload.cjs` ([Pets](/pets)) |
| Agent → pet command path | `local-ipc.ts`, `lease-manager.ts` ([IPC and remote control](/ipc)) |
| Persisted settings | `app-state.ts` |
| Plugin behavior | `plugin-service.ts` + `plugin-*.ts` ([Plugin platform](/plugins)) |
| Agent configuration | `agent-setup.ts` ([Agent integrations](/agent-integrations)) |
| Install / catalog | `catalog.ts`, `pet-installation.ts` ([Catalogs](/catalog)) |
| Anything renderer-visible with a URL | also update the CSP (both files) |
