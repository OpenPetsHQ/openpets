# apps/desktop/src/

## Responsibility

Core TypeScript source for the OpenPets desktop application. Organized into: lifecycle management, state persistence, Control Center and pet windows, IPC server, agent integrations, pet installation/management, and declarative plus JavaScript plugin runtimes.

## Design/Patterns

- **Modular Controllers**: Separate controllers for default pet vs agent pets (lease-based)
- **Protocol-First IPC**: Versioned JSON protocol over TCP/Unix sockets with token auth
- **Defensive I/O**: All file operations use temp+rename for atomicity, path traversal validation, symlink checks
- **Validation at Boundaries**: Catalog, ZIP entries, pet metadata, and IPC params all strictly validated
- **Lease Pattern**: Agent pets use expiring leases (15s TTL) with heartbeats; default pet is persistent
- **Sandboxed Renderers**: Control Center loads the Vite React/Tailwind bundle through a hardened BrowserWindow and narrow preload bridge; transparent pet windows and plugin SDK host windows stay separate
- **Structured Logging**: Scoped logging (app, ipc, lease, pet.*, state, tray, ui, voice, provider) with log rotation and redaction
- **Reaction Animation Mapping**: User-configurable mapping from reaction types to sprite animation states
- **Plugin Runtimes**: Plugins use validated manifests, approved permissions, persisted config, safe path checks, declarative timer-triggered actions, or sandboxed JavaScript entry modules through the SDK bridge.
- **Capability-Oriented SDK Surface**: The plugin bridge is split into focused SDK modules for audio, bus, config, events, quotas, routes, state, storage, types, and UI so permission checks and host effects stay localized.
- **Host-Rendered Plugin UI**: Plugins describe bubbles, alerts, commands, panels, assets, and pet behavior; the host validates descriptors and renders them through pet windows, Control Center IPC, or sandboxed panel windows.
- **Localized Runtime Content**: `i18n/` and plugin locale catalogs resolve host UI text, pet reaction messages, and plugin `$t:` strings through fallback-aware message catalogs.
- **Motion Engine Abstraction**: Advanced pet movement uses a small physics/interpolation engine rather than embedding movement math in window or SDK routing code.

## Data & Control Flow

**Main Process Flow**:
```
main.ts
├── lifecycle.ts (app events, cleanup)
├── logger.ts (structured logging init)
├── app-state.ts (state init)
├── pet-install-transaction.ts (startup recovery of interrupted pet commits)
├── codex-pet-migration.ts (safe legacy V2 marker repair)
├── plugin-service.ts (plugin state/runtime init, JS host wiring)
├── tray.ts (tray creation)
├── local-ipc.ts (IPC server start)
├── control-center-route.ts (canonical route/target validation and dev-only startup routing)
└── windows.ts (UI handlers)
```

**IPC Request Flow**:
```
local-ipc.ts → local-ipc-request-handler.ts → parseIpcRequest() → handleRequest()
├── hello/status/pets.list/pets.install
└── lease.acquire/heartbeat/release
    └── lease-manager.ts
        ├── resolveTarget() (default vs explicit pet)
        ├── onFirstExplicitLease → agent-pet-controller.showAgentPet()
        └── onLastExplicitLease → agent-pet-controller.closeAgentPetIfOpen()
    └── local-ipc-confinement.ts → confinement-poller.ts → window-tracker.ts
└── Logging via logger.ts (ipc, lease scopes)
```

**Pet Display Flow**:
```

**LAN visiting-pet flow**: with `OPENPETS_LAN_PETS=multi`, each client
registers its selected default pet through `lan-http-controller.ts`.
`lan-controller.ts` reports positions for every pet currently hosted locally
and reconciles coordinator snapshots through `lan-pet-controller.ts`.
Visiting windows are keyed by owner host, use `lan-pet-presence.ts` for pure
show/close and asset-availability decisions, and stay isolated from agent
leases. The bundled pet can render explicitly for fresh-profile LAN testing;
missing or broken catalog assets are skipped without stopping LAN polling.
`lan-pet-activity.ts` gates coarse work signals to active meetings and plans
single-use visitor departures. `lan-pet-controller.ts` renders the built-in
return line plus `running` animation before `lan-controller.ts` requests the
coordinator return the visitor to its owner.
Registration also issues a random per-host session credential:
`lan-controller.ts` presents it for later position, claim, activity, and return
mutations, while `lan-http-controller.ts` rejects shared-token peers that claim
another active host identity.
pet-window.ts
├── createDefaultPetWindow() / createAgentPetWindow()
├── loadDefaultPetContent() / loadExplicitPetContent()
│   ├── HTML generation with CSS sprite animation
│   ├── reaction-animation-mapping.ts (resolveReactionSpriteState)
│   ├── reaction-messages.ts (pickReactionMessage for bubbles)
│   ├── i18n/reactions (localized reaction speech pools)
│   └── Speech bubbles, alert indicators, pinned HUDs, status reactions, and Linux compact/expanded input shapes
├── pet-preload.cjs (source renderer IPC entry; Vite bundles it with pet-chat-markdown.ts and pet-chat-view-state.ts into dist/pet-preload.cjs)
├── pet-chat-markdown.ts (Electron-free chat escaping and supported markdown subset)
└── pet-chat-view-state.ts (Electron-free Talk, snapshot ordering, naming, and draft derivation)
pet-window-interaction.ts
└── mouse passthrough, drag, renderer lifecycle recovery/watchdog, IPC bridge, and speech completion subscriptions

Plugin motion APIs:
plugin-sdk-bridge.ts → plugin-sdk-routes.ts → plugin-pet-registry.ts
└── pet-motion-engine.ts tick() calculates interpolated target vectors for spawned/default pets
```

**Agent Setup Flow**:
```
windows.ts (IPC handler adaptation)
└── control-center-agent-setup-ipc.ts
    └── agent-setup.ts
        ├── agent-setup-cursor.ts (Cursor global MCP lifecycle adapter)
        ├── agent-setup-claude.ts (Claude Code MCP, hooks, and memory lifecycle adapter; receives façade command, formatting, preflight, runner, and journal dependencies)
        ├── agent-setup-opencode.ts (OpenCode global config lifecycle adapter; receives façade-computed paths, versions, detection, and formatting inputs)
        ├── agent-setup-openclaw.ts (OpenClaw global management status/preview/mutation adapter; receives command and runner inputs)
        ├── agent-setup-zed.ts (Zed global MCP settings lifecycle adapter; receives façade paths, command inputs, preflight, and journal completion callbacks)
        ├── runAgentSetupAction() (global action lock, validation, and adapter dispatch)
        │   └── Claude lifecycle actions delegate to agent-setup-claude.ts
        ├── OpenCode global config façade orchestration (detection, bundled Node preflight, and action locking)
        ├── Cursor global MCP config management (@open-pets/cursor)
        ├── OpenClaw façade orchestration (command lookup, runner policy, and action locking)
        └── Zed global MCP façade orchestration (settings lookup, Node preflight, action locking, and journal completion)
```

**Pet Installation Flow**:
```
catalog/local ZIP/local folder/codex-pets.ts
├── fully validate and stage a private candidate as a direct child of pets/
└── pet-install-transaction.ts + pet-install-transaction-protocol.ts
    ├── protocol owns the durable journal/schema, managed names, topology classifiers, and recovery policy
    ├── transaction owns filesystem promotion, state mutation, rollback/recovery execution, and side effects
    ├── per-metadata.id lock (local parsing/staging stays parallel)
    ├── journal explicit prepared → backup-created → promoted → state-mutating → committed phases
    ├── preserve old final as a backup, atomically promote the candidate
    ├── mutate app-state.ts only after promotion; rollback ordinary rejection
    └── cleanup backup/marker only after successful mutation; startup recovery is conservative

pet-installation.ts
├── installPet() → getCatalogPet() → downloadPetZip() → extractPetZip()
├── installPetFromZipFile()/installPetFromFolder() → local validation/staging
└── all three paths → runPetInstallTransaction()
codex-pets.ts → validated Codex metadata/assets → runPetInstallTransaction()
```

**Control Center Flow**:
```
tray.ts → openControlCenterWindow(route) → windows.ts
├── hardened BrowserWindow loads Vite renderer or packaged dist/renderer/index.html
├── control-center-preload.cjs exposes page-specific APIs
├── Dashboard snapshot: default pet, catalog, plugin health, update status, activity
└── renderer/src/main.tsx routes Dashboard/Pets/Integrations/Plugins/Settings
```

Control Center pet-management IPC:
```
windows.ts → control-center-pet-management-ipc.ts
└── injected Electron-free catalog, pet-state, installation, import, pool, and
    default-position handlers with sender authorization supplied by the window host
```

**Plugin Flow**:
```
main.ts → initializePluginService(userData, defaultPluginPetApi, appVersion, ElectronPluginJsHost).start()
├── plugin-state.ts reads/writes userData/openpets-plugin-state.json
├── provider-contract.ts provides the pure canonical adapter and preset catalogs, typed profile union, role support, and credential policy
├── plugin-platform-settings.ts gates audio/voice/microphone/quiet hours and persists versioned, validated provider profiles/selections with migration quarantine
├── provider-service.ts resolves redacted role operation snapshots and compatible/native text, STT, TTS, and private realtime codecs
├── provider-configuration-test.ts validates and probes unsaved provider drafts without changing durable settings or credentials; network probes honor caller cancellation; STT uses the host session controller
├── provider-test-lifecycle.ts cancels all provider-test requests for a sender and serializes replacements across modal, renderer, and shutdown teardown
├── plugin-assets.ts validates/resolves declared plugin assets for SDK refs and rendered UI
├── plugin-user-sound-store.ts stores imported user sounds as plugin-scoped opaque refs
├── plugin-diagnostics.ts records plugin errors/quota/settings blocks for inspector/health UI
├── plugin-runtime.ts reloads enabled manifests
│   ├── declarative runtime schedules timer triggers
│   ├── plugin-js-host.ts starts hidden sandboxed BrowserWindow hosts for JavaScript plugins
│   └── plugin-sdk-bridge.ts dispatches namespaced SDK routes
│       ├── plugin-sdk-audio.ts/plugin-voice.ts → renderer/OS playback, MiniMax speech synthesis, and one-shot voice surfaces
│       │   ├── voice-capture.ts/voice-capture-electron.ts → bounded microphone ownership, cleanup, and lifecycle diagnostics
│       │   ├── voice-capture-cancellation.ts → idempotent renderer-cancel/window-destroy ordering
│       │   ├── voice-listening-service.ts → transcription timeout, cancellation, empty-text guard, and boundary diagnostics
│       │   ├── voice-operation-state.ts → internal tray cancellation state and phase tracking
│       │   └── voice-privacy-indicator*.ts → shared live-track accounting and the transient Electron privacy surface
│       ├── plugin-sdk-bus.ts/plugin-sdk-events.ts → curated pub/sub and host event streams
│       ├── plugin-sdk-config.ts/plugin-sdk-storage.ts/plugin-sdk-state.ts → config, persistent plugin data, and subscriptions
│       ├── plugin-sdk-ui.ts/plugin-panels.ts/plugin-toast.ts → bubbles, alerts, commands, panels, and toasts
│       ├── plugin-oauth.ts/plugin-secrets.ts/plugin-ai-gateway.ts → host-mediated auth, encrypted secrets, and AI gateway
│       └── plugin-pet-api.ts/plugin-pet-registry.ts/default-pet-controller → default/spawned pet actions
├── plugin-service.ts orchestrates UI actions, permission confirmation, config validation, install/update/uninstall/load-local, and runtime reloads
└── lifecycle.ts → stopPluginService() on quit

Control Center plugins route:
tray.ts → openControlCenterWindow("plugins") → windows.ts → renderer React app
└── control-center-plugin-ipc.ts (installed once by windows.ts) → injected sender authorization and PluginService access
    └── fixed openpets:plugins-* IPC handlers call PluginService methods

Catalog install/update:
plugin-catalog.ts → plugin-catalog-validation.ts
└── plugin-package.ts downloads HTTPS ZIP, validates SHA-256, extracts root manifest only, and installs to userData/plugins/{id}

Local development load:
plugin-local-loader.ts validates selected folder manifest and snapshots only openpets.plugin.json to userData/plugins-dev/{id}
```

**Localization Flow**:
```
main.ts/settings → i18n.setLocaleFromPreference(system/user locale)
├── i18n/catalog.ts resolves host message dictionaries with English fallback
├── reaction-messages.ts reads localized reaction pools for pet speech
├── windows.ts exposes active messages to the Control Center renderer
└── plugin-i18n.ts resolves plugin locales, manifest $t: fields, and ctx.t(...) runtime strings
```

## Integration Points

- **Within src/**:
  - `main.ts` → all modules (orchestrator), including `ElectronPluginJsHost` for JavaScript plugins
  - `local-ipc.ts` ↔ `lease-manager.ts` ↔ `agent-pet-controller.ts`
  - `windows.ts` ↔ `app-state.ts`, `agent-setup.ts`, `catalog.ts`, `codex-pets.ts`, `update-checker.ts` for Control Center route snapshots/actions
  - `windows.ts` ↔ `plugin-service.ts` for Control Center plugin UI IPC, plugin commands, and Dashboard plugin health
  - `pet-window.ts` ↔ `pet-window-interaction.ts`, `default-pet-controller.ts`, `agent-pet-controller.ts`
  - `default-pet-chat.ts` ↔ `pet-window.ts` for main-owned compact/expanded carrier focus and Linux input-shape transitions
  - `pet-window.ts` ↔ `plugin-bubble-arbiter.ts`, `plugin-pet-registry.ts`, `pet-motion-engine.ts` for plugin-driven bubbles, spawned pets, and movement updates
  - `pet-installation.ts` ↔ `app-state.ts`, `catalog.ts`, `zip-safety.ts`
  - `pet-install-transaction-protocol.ts` ↔ `pet-install-transaction.ts`; owns the stable durable journal/schema, managed naming, topology classifiers, and recovery policy
  - `pet-install-transaction.ts` ↔ `pet-installation.ts`, `codex-pets.ts`, `main.ts`; owns filesystem/side-effect orchestration, private staged promotion, per-ID serialization, journal cleanup, and conservative startup recovery
  - `plugin-service.ts` ↔ `plugin-state.ts`, `plugin-runtime.ts`, `plugin-catalog.ts`, `plugin-package.ts`, `plugin-local-loader.ts`, `plugin-js-host.ts`, `plugin-sdk-bridge.ts`, plugin SDK namespace modules, diagnostics, assets, settings, panels, voice, OAuth, secrets, and user sounds
  - `i18n/` ↔ `tray.ts`, `windows.ts`, `pet-window.ts`, `reaction-messages.ts`, `plugin-i18n.ts`

- **To packages/**:
  - `@open-pets/claude`: `buildClaudeMcpPreview`, `installClaudeHooks`, `doctorClaudeHooks`, etc.
  - `@open-pets/opencode`: `prepareOpenCodeGlobalSetup`, `doctorOpenCodeGlobalSetup`
  - `@open-pets/cursor`: `planCursorMcpInstall`, `executeCursorMcpWrite`, `buildCursorRulesPreview`, etc.
  - `@open-pets/openclaw`: `buildOpenClawCommand`, `classifyOpenClawStatus`, and `planOpenClawMutation` for native plugin management
  - `@open-pets/zed`: `getZedSetup`, `planZedMcpInstall`, `planZedMcpReplace`, `planZedMcpRemove`, etc.
  - `@open-pets/cli`: Version lookup for bundled mode
  - `@open-pets/plugin-sdk`: Published SDK contract mirrored by the desktop bridge and conformance checks

- **To System**:
  - File system: `app.getPath("userData")`, `userData/plugins/`, `userData/plugins-dev/`, plugin storage JSON, `~/.codex/pets/`, `~/.claude/`, `~/.opencode/`, platform-specific Zed settings
  - Network: `fetch()` to openpets.dev, GitHub API, plugin catalog at `https://openpets.dev/plugins/catalog.v1.json`, plugin ZIPs restricted to `https://zip.openpets.dev/plugins/`
  - Processes: `spawn()` for `claude`, `opencode`, `openclaw`, `node`

## Key Modules

**Core**:
- `main.ts`: Entry, single-instance lock, bootstrap sequence, JavaScript plugin host construction, and dev-only Control Center route opening
- `lifecycle.ts`: App event handlers (quit, window-all-closed, second-instance) with logging; stops plugin service, IPC, and pet windows on quit
- `state.ts`: Simple shell pause state
- `app-state.ts`: Persistent JSON state with V1 schema, atomic writes, reaction animation overrides, validated waiting animation duration, persisted idle cursor-gaze preference, and host Pet Assistant personality preferences
- `default-pet-position-state.ts`: Electron-free default-pet position shape, coordinate/display-key normalization, and bounded per-monitor LRU updates
- `app-state-core.ts`: Pet scale options, waiting-duration options/normalization, idle cursor-gaze default/normalization, onboarding normalization
- `pet-assistant-host.ts` / `pet-assistant-service.ts`: Host-owned provider-neutral assistant lifecycle, per-turn prompt composition, terminal outcome reduction, and generation-pinned capability routing
- `pet-assistant-memory.ts`: Electron-/filesystem-free completed-turn memory owner with bounded active context, archive deduplication/context selection, canonical terminal-text appends, and archive list/delete/clear delegation
- `pet-assistant-archive.ts`: Host-owned local terminal-text archive with atomic writes, retention/quarantine, and bounded prompt-window support
- `pet-assistant-history-ipc.ts`: Pure narrow history list/delete/clear handler helpers, including startup and identifier validation
- `pet-assistant-conversation.ts`: Host-owned current-session presentation projection, stable typed-chat controller, cancellation seam, and normalized voice-transcript seam
- `pet-assistant-personality.ts`: Pure personality defaults, bounds, patch validation, and safe deterministic serialization
- `pet-assistant-feedback.ts`: Reducer mapping assistant activity and terminal events to pet reactions, suppressing duplicate text during expanded chat while preserving sprite activity/reaction animations
- `team-service.ts`: Teams enrollment preview lifecycle, authoritative identity/expiry snapshots, serialized enrollment/sync/leave operations, and preview-change subscriptions used to refresh an already-running Control Center route
- `logger.ts`: Structured logging with scopes (app, ipc, lease, pet.default, pet.agent, pet.window, state, tray, ui, voice, provider), log rotation, redaction
- `bundled-plugins.ts`: Canonical official plugin IDs shared by plugin seeding and packaged-output validation
- `packaging-contract.ts`: Packaged bundled-plugin manifest/asset/locale and unpacked integration-runtime contract helpers
- `artifact-payload.ts`: Cross-platform distributable extraction for target-aware packaged payload validation

**UI**:
- `tray.ts`: Tray icon (nativeImage), context menu builder, update status integration, route-targeted Control Center entries, logs folder
  - `windows.ts`: Control Center BrowserWindow factory, Dashboard snapshot, IPC handler registration, route targeting, reaction animation settings, plugin/integration/pet/settings UI IPC endpoints, atomic provider configuration saves, and scoped internal protocols
  - `control-center-route.ts`: Canonical `ControlCenterRoute` and typed startup-target validation shared by window routing and the unpackaged development startup route
- `control-center-plugin-ipc.ts`: Injected fixed Control Center plugin IPC registrations, sender authorization, boundary validation, PluginService delegation, catalog refresh normalization, inspector access, and picker diagnostics
- `control-center-agent-setup-ipc.ts`: Injected fixed Control Center agent-setup IPC registrations, sender authorization, action validation, and agent-setup delegation
- `control-center-remote-ipc.ts`: Injected fixed Control Center remote-control IPC registrations, sender authorization, request validation, snapshot composition, and RemoteControlService delegation
- `control-center-pet-management-ipc.ts`: Injected Electron-free Control Center pet/catalog management IPC registrations, state/layout snapshots, installation/import mutations, pool ordering, and position reset
- `preference-patch.ts`: Pure validation of Control Center preference patches (`validatePreferencePatch`/`PreferencePatch`) for the `update-preferences` IPC path, including waiting animation duration, idle cursor gaze, `petCrossDisplayEnabled`, and Pet Assistant personality fields; consumed by `windows.ts`
- `assets.ts`: Tray icon loading with generated fallback
- `display.ts`: Screen geometry helpers, pet window positioning
- `pet-window-shape.ts`: Pure Linux pet hit-shape calculation, including input masks for the compact carrier and the bottom-anchored expanded attached chat panel
- `default-pet-chat.ts`: Host-side in-pet chat coordinator, handling attached chat expansion, dynamic panel height synchronization, IPC dispatch, conversation transcript streams, talk status, and prompt suggestions
- `default-pet-chat-geometry.ts`: Bijective coordinate mappings and anchor-preserving window bounds for collapsed (200x200) and expanded (420x640) carrier states, plus bottom-relative panel positioning calculations
- `window-tracker-latch.ts`: Re-entrancy latch helper (`createLatchedTick`) that prevents overlapping async ticks from stacking; used by the window-tracking poller
- `renderer/`: Vite React/Tailwind Control Center shell for Dashboard, Pets, Integrations, Plugins, and Settings.

**Pets**:
- `pet-window.ts`: Public pet-window lifecycle facade: transparent frameless window creation, HTML/CSS composition, sprite and transient presentation updates, companion launcher, attached chat styling, bubble suppression, status badges, validated atlas layout selection, and context-menu installation delegation
- `pet-window-interaction.ts`: Per-window interaction controller owning mouse passthrough, drag and renderer lifecycle IPC, recovery/watchdog timers, dragging state, and process-wide speech-completion subscriptions
- `pet-window-context-menu.ts`: Native/layer-shell pet context-menu lifecycle, scale/flip actions, and plugin command form handling
- `pet-window-gaze.ts`: Shared preference-gated, movement-driven V2 idle cursor-gaze controller, including renderer/window lifecycle, cursor tracking, gaze eligibility, and gaze IPC updates
- `default-pet-chat.ts`: Host-side in-pet chat coordinator managing expanded/collapsed carrier window states, IPC authorization, conversation transcript streams, and talk control subscriptions
- `pet-transient-presentation.ts`: Reusable per-pet owner for transient display/badge state, transition-unique opaque render-composition tokens, independent display/badge timer guards, timer cleanup, and deterministic transition callbacks; default/agent controllers retain window/voice/lease role ownership
- `default-pet-controller.ts`: Default pet visibility, position persistence, transient reactions, status badges, logging
- `agent-pet-controller.ts`: Lease-triggered pet windows, dismissal tracking, transient displays, status badges, logging
- `pet-motion-engine.ts`: Interpolated movement vector/tick engine for plugin-driven pet motion and target-following behavior
- `built-in-pet.ts`: Built-in pet constant
- `reaction-messages.ts`: Message pools for each reaction type
- `reaction-animation-mapping.ts`: Reaction-to-animation state mapping, user-configurable overrides, bundled V2 Hoodie Cat atlas metadata, canonical sprite state definitions, and derived waiting-duration state tables
- `i18n/`: Host message catalogs and localized reaction pools; see [i18n/codemap.md](i18n/codemap.md)

**IPC**:
- `local-ipc.ts`: net.Server implementation, socket transport facade, discovery file management, network security (loopback/private address filtering), logging, and request-handler/confinement composition
- `local-ipc-request-handler.ts`: Electron-free injected local IPC parsing, validation, request routing, side-effect ordering, and protocol response handling
- `local-ipc-confinement.ts`: Electron-free module-lifetime coordination between explicit leases, terminal tracking, confinement state updates, and tracker cancellation
- `local-ipc-protocol.ts`: Protocol constants, request/response types, validation functions
- `local-ipc-paths.ts`: Platform-specific socket paths and discovery file locations
- `lease-manager.ts`: Lease lifecycle (acquire, heartbeat, release, cleanup), target resolution

**Installation**:
- `pet-installation.ts`: ZIP download, yauzl extraction with safety limits, pet validation
- `pet-install-transaction-protocol.ts`: Electron-free stable pet-install journal/schema, managed naming, topology classifiers, and recovery decision policy
- `pet-install-transaction.ts`: Electron-free staged pet commit filesystem/side-effect orchestrator, canonical private-root/marker validation, per-ID lock, rollback execution, bounded cleanup warnings, and idempotent startup recovery
- `pet-paths.ts`: Safe path resolution for pet directories
- `pet-file-safety.ts`: Bounded, no-follow regular-file reads shared by pet import and installed-pet rendering
- `codex-pets.ts`: Import from `~/.codex/pets/` with validation
- `codex-pets-core.ts`: Codex V1/V2 metadata, exact V2 atlas, and neutral-pose layout validation
- `codex-pet-migration.ts`: Idempotent startup repair for legacy Codex V2 imports gated by canonical source, exact local atlas validation, and byte hash equality
- `installed-pet-layout.ts`: Bounded installed-manifest reader shared by pet windows and Control Center sprite previews
- `catalog.ts`: Remote catalog fetch with V3 pagination support, search, fixture fallback, and V1/V2 sprite metadata conversion
- `catalog-validation.ts`: CatalogV2/V3 schema validation, including optional exact V2 sprite-version metadata
- `zip-safety.ts`: ZIP entry path validation (traversal prevention, case collision detection)

**Plugins**:
- `plugin-manifest.ts`: Manifest V1/V2/V3 schema/types and validation for declarative and JavaScript runtimes, permissions (`timer`/`schedule`, `pet:*`, `pets:*`, `audio`, `events`, `ui:*`, `notify`, `bus`, `ai`, `secrets`, `voice:*`, `auth`, `files`, `system:*`, `clipboard`, `network:*`), config schema, timer triggers, assets, panels, entry files, and pet actions.
- `plugin-manifest-reader.ts`: Safe manifest reader with realpath/allowed-root checks, root filename enforcement, size limit, and expected id/version matching.
- `plugin-config.ts`: Config defaulting, replacement validation, and runtime resolution for string/number config references.
- `plugin-state.ts`: Persistent plugin state store (`openpets-plugin-state.json`) with atomic temp+rename writes, normalized records, approved permissions, config, source, and broken reason.
- `plugin-runtime.ts`: Runtime that compiles enabled declarative timer triggers, starts/stops JavaScript plugin hosts, verifies approved permissions, exposes public command/status state, validates actions, schedules cancellable timers, and marks broken plugins on validation/action failure.
- `plugin-pet-api.ts`: Narrow adapter from plugin actions to default pet external `say`/`react` controller calls.
- `plugin-service.ts`: Application-facing plugin orchestrator for safe snapshots, enable/disable, config save, command execution, reload, catalog install/update, local load, uninstall, permission prompts, compatibility checks, JavaScript host/SDK bridge integration, and runtime reloads.
- `plugin-catalog.ts`: Remote plugin catalog fetch with timeout, redirect rejection, response size cap, cache, and refresh support.
- `plugin-catalog-validation.ts`: Catalog V1 schema validation, duplicate id checks, semver/SHA fields, permissions canonicalization, and optional minimum OpenPets version.
- `plugin-package.ts`: Catalog plugin package download/install with HTTPS host/path allowlist, SHA-256 verification, ZIP size/entry restrictions, manifest/catalog consistency checks, and safe uninstall path resolution.
- `plugin-local-loader.ts`: Developer loader that validates a selected local folder and snapshots only the manifest into `plugins-dev` with symlink/path/size protections.
- `plugin-js-host.ts`: Sandboxed hidden BrowserWindow host for JavaScript plugin entry modules with per-plugin session partitioning, navigation/window-open hardening, SDK IPC tokening, registration handshake, config listener cleanup, and teardown.
- `plugin-sdk-bridge.ts`: Permission-checked JavaScript plugin SDK bridge that validates routes, creates plugin contexts, enforces approved permissions/quotas, and delegates namespace behavior to focused SDK modules.
- `plugin-sdk-network.ts`: Guarded DNS and agent transport, bounded dispatch/response limits, and bounded agent cleanup; the bridge tracks, aborts, and drains requests by API generation.
- `plugin-sdk-audio.ts`: Audio SDK facade that checks global audio settings, resolves plugin/user sound refs, and reports blocked playback through diagnostics.
- `plugin-sdk-bus.ts`: Inter-plugin publish/subscribe namespace with clone-safe payload routing and plugin-scoped topic handling.
- `plugin-sdk-config.ts`: Runtime config read/change namespace backed by validated plugin config state.
- `plugin-sdk-events.ts`: Curated host event subscription namespace for pet clicks, drag/drop, display, power, idle, and config change signals.
- `plugin-sdk-quotas.ts`: Shared quota counters and limits for SDK namespaces.
- `plugin-sdk-routes.ts`: Route table and dispatch contract between preload IPC calls and host SDK handlers.
- `plugin-sdk-state.ts`: Shared plugin context state, listener cleanup, and lifecycle bookkeeping used by route handlers.
- `plugin-sdk-storage.ts`: Quota-bound plugin storage namespace with key enumeration and subscriptions.
- `plugin-sdk-types.ts`: Internal host-side SDK interfaces mirroring the published `@open-pets/plugin-sdk` contract.
- `plugin-sdk-ui.ts`: Host-rendered UI namespace for bubbles, alerts, menu items, panels, and dynamic interaction callbacks.
- `plugin-assets.ts`: Declared asset resolution and validation for icon/image/svg/sprite/sound references used by plugin SDK calls and catalog cards.
- `plugin-bubble-arbiter.ts`: Priority/coalescing arbiter for transient and pinned plugin bubble slots.
- `system-metrics.ts`: Best-effort OS metric collectors and stale-while-revalidate cache for GPU, disk, battery, and aggregate network throughput derived from per-interface samples; optional fields carry extended-sample freshness metadata.
- `plugin-diagnostics.ts`: Per-plugin error/quota/settings-block collector surfaced to inspector and plugin health views.
- `plugin-events-source.ts`: Host event source adapter for pet/window/system events consumed by `plugin-sdk-events.ts`.
- `plugin-host-capabilities.ts`: Main-process capability bundle injected into the bridge for Electron side effects.
- `plugin-i18n.ts`: Plugin locale catalog loader and `$t:`/`ctx.t()` resolver with English fallback.
- `plugin-oauth.ts`: Host-mediated OAuth/PKCE flow and token session lifecycle for plugins.
- `plugin-panels.ts`: Sandboxed plugin panel BrowserWindow coordinator and message bridge.
- `plugin-pet-registry.ts`: Registry for default and plugin-spawned pets, including lifecycle and SDK targeting.
- `plugin-platform-settings.ts`: Global plugin-platform settings for audio, voice, speech, microphone, quiet hours, and independent provider profiles/selections; versioned migration/quarantine; host-owned atomic profile/credential/role saves and redacted-header add/replace/delete patches; no legacy `ai` object is read.
- `provider-contract.ts`: Pure canonical provider adapter definitions, typed adapter-specific profiles (including native ElevenLabs Scribe STT), role support, credential policies, default auth, and preset catalog owned by the host and exposed through the renderer contract.
- `provider-service.ts`: Host-owned provider operation boundary; credentials come from `PluginSecretsStore`, status is redacted, provider failures remain operation errors rather than plugin health failures, and text/STT/TTS/realtime requests emit bounded outbound and terminal diagnostics. Transcription preserves the generic OpenAI-compatible multipart route and uses the typed ElevenLabs `/speech-to-text` `model_id` route for Scribe.
- `plugin-secrets.ts`: Plugin-scoped encrypted secret storage backed by Electron safe storage primitives.
- `plugin-toast.ts`: Host toast/notification routing for plugin UI events.
- `plugin-user-sound-store.ts`: Plugin-scoped imported user sound registry that stores opaque sound refs instead of raw filesystem paths.
 - `plugin-voice.ts`: Voice/TTS and one-shot listen facade gated by settings and permissions; owns host cancellation hooks, shared operation reservations, and the private realtime conversation entry points.
- `provider-configuration-test-session.ts` / `voice-media-player.ts`: Bounded provider transcription session with ownership reserved before initialization, and a serialized trusted persistent-partition player for generated audio, with explicit sink-routing fallback and trusted output capability probing.
- `provider-test-lifecycle.ts`: Shared per-sender cancellation and replacement-lane helpers ensuring rapid provider tests serialize teardown, renderer loss reaches queued/initializing work, and only the latest replacement starts capture.
- `voice-assistant-session-contract.ts`: Pure exported generic/Realtime voice-session contracts shared by the host, Realtime adapter, feedback reducer, tray, and session implementation.
- `voice-assistant-host-core.ts` / `voice-assistant-session.ts`: Host-owned one-shot Talk toggle and generic recording state machine; the implementation retains mutable stage/lifecycle ownership while consuming the pure session contracts. Submission clears its capability before capture stop settles, terminal output ends the session without automatic re-listen, and primary toggles are non-destructive during processing and native Realtime activity.
- `voice-device-service.ts` / `voice-device-resolver.ts` / `voice-device-electron.ts` / `voice-device-permissions.ts`: Host-owned durable voice input/output preferences, capability-safe snapshots, immutable per-operation input resolution, trusted `setSinkId` probing, shared trusted media partition, and restricted audio permission boundary.
- `voice-capture.ts` / `voice-capture-electron.ts`: One-active-at-a-time microphone capture with separate acquisition timeout, media-track cleanup, temporary-session teardown, and bounded lifecycle diagnostics.
- `voice-microphone-arbiter.ts`: Shared lease boundary preventing one-shot and realtime microphone ownership from overlapping.
- `voice-conversation.ts` / `voice-realtime-electron.ts`: Generation-safe host conversation lifecycle and thin hidden renderer/WebRTC adapter; intentionally not exposed through the plugin SDK.
- `voice-capture-cancellation.ts`: Idempotent renderer-cancel/window-destroy ordering for Electron capture teardown.
- `voice-listening-service.ts`: Transcription timeout, abort handling, whitespace-only rejection, late-event suppression, capture stop/submit forwarding, and capture/transcription boundary diagnostics.
- `voice-operation-state.ts`: Internal acquisition/recording/transcription state surfaced to host tray controls, including reservations held during asynchronous listen initialization.
- `voice-privacy-indicator.ts`: Host-owned live microphone-track accounting shared by one-shot capture and realtime conversation; it creates no detached UI surface.

**Agent Integration**:
- `agent-setup.ts`: Claude/OpenCode/Cursor detection, OpenClaw native plugin discovery/mutation, MCP configuration, hooks management, action journaling
- `claude-memory.ts`: Claude instructions file management (`~/.claude/openpets.md`)
- `update-checker.ts`: GitHub release polling, update status
- `update-version.ts`: Version parsing and comparison

**Tests** (excluded from detailed codemap coverage per repository conventions):
- Behavior tests live in `tests/*.test.ts` (compiled to `.test-dist/tests/`); provider foundation persistence, migration, credential ownership, preset/role behavior, routing, TTS voice precedence, and realtime boundaries are covered by `provider-profiles.test.ts`, `provider-presets-and-roles.test.ts`, `provider-migration.test.ts`, `provider-credential-deletion.test.ts`, `provider-service.test.ts`, `voice-assistant-host-core.test.ts`, `voice-realtime-assistant.test.ts`, `voice-device-state.test.ts`, `voice-device-selection.test.ts`, `pet-assistant-feedback.test.ts`, `text-model-client.test.ts`, and `plugin-ai-gateway.test.ts`; Talk tests cover atomic recording submission, non-destructive repeated toggles, immediate response feedback, one-shot terminal cleanup, explicit next-turn activation, and Realtime response completion; voice device tests cover durable preference normalization, device resolution, operation snapshots, and selected-input propagation without OS hardware; `codex-pets.test.ts` asserts released V1/V2 metadata fixtures and strict V2 atlas contracts; `pet-install-transaction.test.ts` covers staged promotion, rollback, conservative recovery, and path/marker safety
- Contract tests live in `contracts/*.contract.ts` (compiled to `.test-dist/contracts/`)
- Runtime checks (`check-*.ts`) remain in `src/` for packaging/validation (compiled to `dist/`)

## Data Flow Summary

| Source | Destination | Data |
|--------|-------------|------|
| Catalog API | `catalog.ts` | `CatalogV2/V3` JSON with pagination |
| ZIP/local/Codex staging | `pet-installation.ts` / `codex-pets.ts` | Fully validated private candidate under `userData/pets/` |
| Pet promotion/recovery | `pet-install-transaction-protocol.ts` + `pet-install-transaction.ts` | Stable journal/schema/naming/recovery policy plus filesystem/side-effect orchestration for journaled atomic promotion to `userData/pets/{id}/`, rollback, and startup recovery |
| `app-state.ts` | `userData/openpets-state.json` | Atomic JSON writes with reaction animation overrides |
| `pet-assistant-service.ts` | `pet-assistant-memory.ts` | Completed-turn outcome and message handoff; lifecycle remains responsible for model/capability work and terminal events |
| `pet-assistant-memory.ts` | `pet-assistant-archive.ts` | Canonical terminal user/assistant text; bounded recent archive prompt window; owner query/delete-one/delete-all seam |
| CLI via IPC | `local-ipc.ts` | `pet.react`, `pet.say`, `lease.*` |
| `lease-manager.ts` | `agent-pet-controller.ts` | Show/close agent pets |
| `windows.ts` | Renderer | State snapshots via IPC invoke |
| `agent-setup.ts` | Claude/OpenCode/Cursor CLI | MCP add/remove, config writes |
| All modules | `logger.ts` | Structured logs to `userData/logs/openpets.log` |
| Plugin catalog | `plugin-catalog.ts`/`plugin-service.ts` | Discoverable plugin metadata filtered by app version and install state |
| Plugin ZIP/local folder | `plugin-package.ts`/`plugin-local-loader.ts` | Validated manifest snapshot installed under `userData/plugins*` |
| `plugin-state.ts` | `userData/openpets-plugin-state.json` | Installed plugins, enabled flag, approved permissions, config, broken status |
| Control Center renderer | `control-center-preload.cjs`/`windows.ts` | Narrow Dashboard/Pets/Integrations/Plugins/Settings snapshots and route-targeted actions |
| `plugin-runtime.ts` | `plugin-pet-api.ts`/`plugin-js-host.ts`/`plugin-sdk-bridge.ts` | Declarative timers and JavaScript SDK actions on default/spawned pets, schedules, storage, commands, status, logs, network, UI, audio, events, bus, AI, OAuth, secrets, voice, and panels |
| Plugins renderer | `windows.ts`/`plugin-service.ts` | Snapshot, enable, config, command, reload, install/update/uninstall, local-load operations |
| Locale preference | `i18n/`/`plugin-i18n.ts` | Host UI dictionaries, localized reaction pools, manifest `$t:` values, and runtime `ctx.t()` strings |
| Plugin SDK asset refs | `plugin-assets.ts`/`plugin-package.ts`/`plugin-sdk-ui.ts` | Validated icons, images, SVGs, sprites, panels, and sounds rendered by host surfaces |
