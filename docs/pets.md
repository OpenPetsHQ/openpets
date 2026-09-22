---
description: Learn how OpenPets pet packages describe sprites, reactions, speech, motion, install paths, ZIP safety, and local authoring.
---

# Pets

A "pet" is an animated character that lives in a transparent desktop window and
reacts to agent activity. This doc covers the whole pet lifecycle: what a pet is
made of, how it gets onto disk, how reactions become animations, and how the
windows behave. For the catalog that ships pets see [Catalogs](/catalog);
for the command path that triggers reactions see [IPC and remote control](/ipc).

Source maps: `apps/desktop/src/codemap.md` (pet windows, controllers,
installation), `packages/install-pet/codemap.md` (standalone installer).

## What a pet is

A pet package is small and asset-driven:

- **`pet.json`** - metadata: `id`, `displayName`, `description`,
  `spritesheetPath`, and optional `category` / `subcategory` / `sourceUrl` /
  `xHandle`. (Catalog entries carry the same identity plus hosting URLs - see
  [Catalogs](/catalog).)
- **`spritesheet.webp`** - a grid of animation frames. Frames are at least
  `192x208`; thumbnails are derived from the spritesheet.

There are three sources a pet can come from at runtime:

1. **Built-in pet** (`built-in-pet.ts`) - the bundled V2 Hoodie Cat spritesheet
   that always works as a fallback, even offline with nothing installed. It uses
   the exact 8×11 atlas and row 0, column 6 neutral pose, including V2 idle gaze.
2. **Catalog pets** - downloaded from the public catalog and extracted into
   `userData/pets/{id}/`.
3. **Codex pets** - locally-developed pets imported from `~/.codex/pets/`
   (`codex-pets.ts`), the dev workflow for authoring a new pet before
   publishing it.

## Teams-owned pets

Teams adds a fourth explicit source kind, `team`. Persisted source ownership
selects the dedicated Team pet root versus the personal catalog/Codex roots; the
app never infers ownership from a directory. Team pets appear separately in
snapshots while remaining selectable. Team Packs remain pending and not current
until the current artifact's explicit first-install approval in the Teams route
succeeds; the approval displays requested permissions and network hosts and
cannot be bypassed by organization configuration. Immutable
organization/item/artifact/release references ensure reconciliation removes only
matching Team records. Rejected staged or activated Team installs roll back to
the last approved Team state, while personal catalog and Codex pets remain
isolated and are never overwritten or removed on ID collision. Removing the Team
default falls back to the built-in pet.

## Default pet vs agent pets

Two distinct window roles, two controllers:

- **Default pet** (`default-pet-controller.ts`) - the always-on companion shown
  when enabled. Persistent. Remembers its position per connected monitor and
  clamps it back into the visible work area after display changes. Shows
  transient reactions and status badges, and hosts the expandable in-pet attached
  Pet Assistant chat panel (`default-pet-chat.ts`).
  Not lease-bound.

The default carrier's compact composer and expanded chat are main-process-owned
states. In expanded chat, the panel anchors 10px directly above the pet sprite and
grows upward as content changes while the pet remains stationary at the bottom.
Unpinned floating bubbles are suppressed during full chat, while assistant activity
and reaction animations continue on the pet sprite without duplicating speech text.
On Linux, opening the compact composer makes the carrier focusable and
adds its composer rectangle to the input shape; closing it restores the passive
pet-only focus and shape. Its shared maximum geometry contract bounds multiline
input and error feedback so the Linux mask covers every compact control. The
expanded panel uses the same transition seam, with dynamic height tracking for
precise Linux hit-mask shapes.
- **Agent pets** (`agent-pet-controller.ts`) - shown on explicit agent request,
  routed by a **lease**. The first lease opens the window; the last lease
  released closes it. This lets several agents each get their own pet without
  colliding with the default pet. Agent pets roam with the same physics as
  the default pet (gravity + bounce, driven by `pet-roaming-controller.ts`).
  Session lifetime is tracked via PID liveness: when a client process
  terminates, the lease is released within ~5 s and the pet window closes.
  See the lease model in [IPC and remote control](/ipc).

Both are created by the `pet-window.ts` lifecycle facade as transparent, frameless,
always-on-top windows. `pet-window-interaction.ts` owns the per-window mouse
passthrough, drag, renderer lifecycle, recovery/watchdog, and IPC bridge driven
through `pet-preload.cjs`.

Experimental multi-pet LAN mode adds a third, isolated controller for visiting
pets. Windows are keyed by LAN owner host rather than pet ID, so they do not
collide with lease-managed agent pets or with another visitor using the same
pet package. Unavailable remote assets are logged and skipped safely.
Fresh coarse work activity can temporarily render a built-in return-to-work
line with the visitor's `running` animation; after the dash delay, coordinator
state returns that visitor to its owner.

While a pet is click-through it only learns that the cursor is over it through
*forwarded* mouse events (`setIgnoreMouseEvents(true, { forward: true })`), which
Electron delivers on macOS and Windows but not on Linux (Linux pet windows are
kept interactive instead). Both compositors can silently stop forwarding - macOS
across Space switches, display sleep, and fullscreen transitions; Windows after
rapid pet reloads and fullscreen sweeps - which would leave the pet stuck
click-through and impossible to grab. A cursor-probe watchdog in
`pet-window-interaction.ts` re-arms forwarding from the main process
(`screen.getCursorScreenPoint()`), which keeps working even when forwarding is
dead. The platform predicates live in `mouse-forwarding.ts`.

Right-clicking any pet offers a **Size** submenu with the same global scale
choices as Settings. The current size is checked; selecting another size saves
the global pet and HUD scale preferences and refreshes the default and agent pet
windows. The HUD starts at its smallest readable size for XS, then grows more
quickly than the pet at each larger choice. The same
menu also offers **Flip horizontally**, a checked menu item that mirrors that
pet's sprite left/right. Speech bubbles, status badges, controls, and the hit
area stay unmirrored and readable. The orientation is stored per underlying pet
ID in app state (`preferences.petHorizontalFlip`) and survives restart; toggling
one pet updates every live window of that pet (default, agent, plugin-spawned,
and LAN visitor) and leaves other pets unchanged. There is no vertical or
upside-down flip.

## Reactions → animations → speech

A **reaction** is a categorical pet state (thinking, editing, testing, waiting
for permission, success, error, idle, …). The rendering pipeline turns a
reaction into something visible:

1. `reaction-animation-mapping.ts` resolves a reaction to a **sprite animation
   state** (`resolveReactionSpriteState`). This mapping is **user-configurable** - users can override which animation a reaction plays, and overrides persist in
   app state. The selectable animation states include idle, review, running,
   waiting, waving, jumping, and failed; `waving` covers attention/notification
   style reactions.
2. `reaction-messages.ts` picks a **speech message** from the pool for that
   reaction; `i18n/reactions/` provides the localized pools so speech matches the
   active locale (see [Internationalization](/i18n)).
3. `pet-window.ts` renders the chosen animation via CSS sprite animation, and
   shows speech bubbles, alert indicators, pinned HUDs, and status badges as
   requested. The sprite is sized by the pet scale preference; the pinned
   plugin HUD is sized by the separate HUD scale preference (`hudScale`, in
   Settings → General next to pet scale), so HUD readability is independent of
   pet size. The transient display (bubble) expires after a few seconds while
   a busy status badge (`thinking`/`working`/`editing`/`running`/`testing`/
   `waiting`) survives much longer; when the display reaction is gone, a badge
   that resolves to a looping animation (`resolveEffectiveSpriteState`) keeps
   the pet visibly animated, while a badge that resolves to a finite one-shot
   (`waving`/`success`/`error`/`celebrating`) falls back to idle so terminal
   reactions stay bounded.

The waiting animation cycle is a global preference in Control Center → Settings
→ Reactions. **Normal** keeps the default `1010` ms cycle and **Relaxed** uses
`2200` ms. The renderer derives a fresh sprite-state table for the selected
duration instead of mutating `defaultPetSprite.states`, so all other reaction
mappings and animation durations stay unchanged. The setting applies to both
built-in and installed pets; plugin-provided sprite overrides continue to use
their own FPS and loop settings. Changing the preference refreshes open default
and agent pet windows, and the duration is part of their render identity so
already-open windows reload their CSS immediately. The Settings preview uses the
same configured duration.

This separation - mapping vs message vs render - is deliberate: agents and
plugins speak in *reactions*, and the host owns *how* those look and sound.

## Motion

The motion engine (`pet-motion-engine.ts`) drives all pet windows through a
single shared ticker (≈60 fps). Each registered pet gets its own `MotionState`
entry in a `Map<petHandleId, MotionState>`, but all pets share one `setInterval`
so positions advance in lock-step with one `getAllDisplaysCached()` read per
tick.

`pet-roaming-controller.ts` is the host-side orchestrator: it registers every
live pet (default and agent) with the engine and applies the active roaming
configuration (gravity + bounce). When a pet is despawned the controller
unregisters it before the window is destroyed, so the shared ticker never
touches a closed window.

Plugin-driven movement (`plugin-sdk-routes.ts` → `plugin-pet-registry.ts`) feeds
target vectors and physics overrides through the engine's public API
(`motionMoveTo`, `motionSetPhysics`, `motionSetFollowCursor`). The engine is the
**sole continuous position writer**; all per-pet step loops were eliminated to
prevent jitter from competing writers. Sub-pixel fractional accumulators
(`fracX` / `fracY` in `MotionState`) ensure smooth movement at any tick rate.
Gravity and per-tick containment use the live native pet-window bounds, not only
the nominal canvas dimensions, so platform-specific window chrome cannot place
the window below a display work area.
See [Plugin platform](/plugins) and [Plugin SDK v3](/sdk) for the plugin side.

### Display containment and cross-display roaming

`display.ts` owns all screen-geometry decisions. Per-tick clamping in
`clampPosition()` follows a strict priority order:

1. **Confinement** - if a pet has a terminal-bounds assignment (see below), it
   is always snapped into those bounds regardless of any other flag.
2. **Cross-display roaming** (default **off**) - if the
   `petCrossDisplayEnabled` preference is on, `clampToNearestDisplayIfOffscreen`
   is used: the pet is left alone while its bottom-center anchor overlaps any
   display's work area, and is only snapped to the nearest display edge when
   fully off-screen. This lets pets cross seams between adjacent displays
   freely.
3. **Legacy single-display mode** - if `petCrossDisplayEnabled` is off, the
   original `clampToVisibleWorkArea` behavior is used (pet is clamped to the
   display nearest its geometric center).

**Wide gaps between non-adjacent displays:** a pet moving toward an empty
region will stick at the edge of its current display and cannot teleport across
a gap wider than the pet. This is expected behavior and is by design.

**Topology changes** (monitor plugged/unplugged, resolution changed) are
coordinated by `pet-display-coordinator.ts`. It invalidates the display cache
immediately, debounces each native display-event reason independently, and fans
out reclamping to the default pet, agent pets, LAN visitors, and plugin pets.
Pets on a removed display are snapped to the nearest remaining display; pets on
surviving displays are left untouched. The coordinator also owns immediate and
delayed recovery of default-pet mouse interop after power resume.

The `petCrossDisplayEnabled` toggle lives in Control Center → Settings, under
the **Movement** section, and is a global flag (not per-pet). It is shown
disabled with explanatory helper text until a movement plugin - one granted the
`pet:move` permission, such as Walkabout - is enabled, since cross-display
roaming has no effect without a mover driving motion. Confinement remains
strictly per-pet and always takes priority regardless of the cross-display flag.

### Linux & Wayland

All pet motion depends on the app being able to **programmatically position a
top-level window** and keep it **always-on-top** (`setPosition`/`setBounds` plus
`setAlwaysOnTop`). Native Wayland deliberately forbids clients from positioning
or restacking their own toplevels, so under a native Wayland backend every
position write is silently ignored by the compositor: gravity, walkabout,
follow-cursor, cross-display roaming, drag, and z-order all become no-ops even
though the motion engine keeps computing new coordinates. (This is the root
cause behind "pet doesn't move / gravity doesn't work" reports on KDE/KWin
Wayland.)

To keep motion working, OpenPets forces the Linux Ozone backend to **x11
(XWayland)**, where these window operations are honored. Drag selects its path
at window creation via `isEffectiveWaylandBackend()` in `pet-window.ts` (which
delegates the pure decision to `computeEffectiveWaylandBackend()` in
`wayland-backend.ts`): under the forced x11 backend it returns `false` and the
working `setBounds` drag path is used. The backend-forcing itself lives in `main.ts` and is documented in
[Desktop app](/desktop#linux-display-backend-ozonewayland), including the
`OPENPETS_ALLOW_WAYLAND=1` opt-out (which restores native Wayland and therefore
disables the motion/drag/always-on-top behavior above, with a one-time startup
warning).

## Installation

Two install paths exist; they share the same safety rules.

### Through the running app (preferred)

`pet-installation.ts`:

1. `getCatalogPet()` resolves the pet from the catalog (`catalog.ts`).
2. `downloadPetZip()` streams the ZIP from `zip.openpets.dev`, validating magic
   bytes.
3. `extractPetZip()` extracts with `yauzl` under strict entry validation
   (`zip-safety.ts`): no path traversal, no symlinks, case-collision detection,
   size/file-count caps.
4. Extraction is atomic (temp dir → rename) into `userData/pets/{id}/`, and
   `installPetState()` records it in app state.

The stable journal/schema, naming, and recovery-classification protocol lives in
`pet-install-transaction-protocol.ts`; `pet-install-transaction.ts` remains the
filesystem and side-effect orchestrator. The final promotion has a private per-pet journal under
`userData/pets/.openpets-pet-transactions/`. Journal records are written to a
private temporary marker and renamed into place. On process interruption,
startup recovery verifies the actual canonical final/candidate/backup
topology before either restoring the pre-install assets or cleaning a proven
committed install; it does not trust a stale phase by itself. A state-mutating
record whose relationship to app state cannot be proven is retained, warned
about, and fences operations for that same pet while other pet IDs continue to
work. Explicitly uncertain state callbacks likewise preserve the assets for
manual/retry recovery. Transaction directory names carry a trusted pet ID, so
malformed, contradictory, or duplicate same-pet transaction artifacts are
preserved and fence only that pet; another ID can still recover. Pre-metadata
staging candidates have a private ownership marker established before their
directory is created. Recovery removes only candidates validated by that
marker, leaving legacy or unmarked dot directories untouched. The marker is
handed off to the per-ID journal before it is deleted, so an interruption
cannot leave a staged candidate without an owner. A trusted empty transaction
directory is treated as completed cleanup, while directories with unknown
entries are preserved. This journal protocol does not fsync files or directory
metadata, so it does not claim power-loss durability; it only provides
process-interruption recovery and protection when cross-resource state proof is
missing.
The state mutation callback must return synchronously. A returned thenable is
recorded as an explicit uncertain outcome, and recovery never assumes it can
undo asynchronous state side effects. ZIP imports use a separate private
pre-metadata staging name, so the valid pet ID `local` remains independently
fenced when it is the actual imported pet.

Local pet packages can also be installed through the running app via the CLI:
- `openpets install --from-zip <path-to-zip>`
- `openpets install --from-folder <path-to-folder>`

These send a `pets.install-local` request to the running app over IPC, which validates and imports the local zip file or folder.
The CLI resolves relative paths before sending them; the IPC/client protocol
itself requires an absolute path plus an explicit `zip` or `folder` kind.

### Standalone installer (`install-pet`)

`packages/install-pet/` is a standalone CLI (`install-pet <pet-id>` or
`npx -y install-pet <pet-id>`). It prefers the running app via
`@open-pets/client` and **falls back** to a direct download + extract when the
app is unavailable. Direct mode uses a lock file (`.install-pet.lock`, 10-min
stale timeout) to prevent concurrent installs, the same ZIP safety limits (50MB
download / 200MB extracted / 500 files / 100MB per file), and the same
platform-specific user-data path resolution. This is what powers
"`npx install-pet <id>`" without requiring the app to be open.

### ZIP safety (shared)

Both paths enforce: HTTPS-only catalog/ZIP hosts on an allowlist, no encrypted
entries, only stored/deflate compression, valid Unix modes, required files
(`pet.json` + `spritesheet.webp`), and atomic extraction with private
permissions. The pet `id` must match `^[a-z0-9][a-z0-9_-]{0,63}$` and cannot be
`builtin`.

## Codex pets (local authoring)

`codex-pets.ts` imports pets from `~/.codex/pets/` with the same metadata
validation, so an author can iterate on a pet locally before it is published to
the catalog. The publishing path (zipping, thumbnailing, uploading to R2,
regenerating the catalog) lives in `web/`'s sync scripts. The contract those
scripts produce is in [Catalogs](/catalog), with release checks in
[Testing and validation](/testing-and-validation).

### Codex sprite versions

The bundled default Hoodie Cat uses the same V2 atlas contract as imported
Codex V2 pets. Its public `builtin` identity and `Hoodie Cat` display name stay
unchanged; only the desktop asset and runtime layout have been upgraded.

OpenPets preserves the original Codex V1 package shape: an unmarked
`spritesheet.webp` with the nine standard `192×208` animation rows. It also
imports V2 only when `pet.json` has `"spriteVersionNumber": 2` and its source
asset is a fully decodable, single-image, alpha-enabled WebP with the exact `1536×2288`
(`8×11`) grid. Any other supplied version marker, a non-WebP/non-alpha image,
or a mismatched V2 atlas is rejected before the atomic import writes anything.

The V2 adapter uses the unchanged standard rows 0–8 for OpenPets reactions and
horizontal run motion, and uses V2's neutral pose (row 0, column 6) whenever
the existing runtime is idle. This matches the released
[Malou V2 manifest](https://raw.githubusercontent.com/mySebbe/malou-codex-pet/v2.0.0/dist/malou/pet.json)
and its [8×11 atlas specification](https://raw.githubusercontent.com/mySebbe/malou-codex-pet/v2.0.0/metadata/atlas.json).

The Control Center carries that sprite layout with Codex-source and installed
pet entries. Its Pets, Dashboard, and Settings previews therefore scale V1
atlases as 8×9, V2 atlases as 8×11, and show the static V2 neutral cell instead
of treating the extra rows as part of a nine-row animation.

At startup, OpenPets also performs an idempotent repair for Codex V2 imports
created by older releases that copied the 11-row atlas but dropped the version
marker from the installed `pet.json`. It restores only that marker, and only
when the persisted source still points to the expected canonical Codex pet,
the source manifest is valid V2, the local atlas passes the exact V2
`1536×2288` contract, and SHA-256 hashes of the source and local atlas bytes
match. Already-current and unverifiable imports are skipped; per-pet results,
repaired/skipped counts, and skip reasons are logged, and a migration problem
never prevents the desktop app from starting.

V2's sixteen look-direction cells (rows 9–10) are retained in the imported
atlas and selected while an installed V2 pet is visually idle. OpenPets samples
the global cursor around the pet carrier's bottom-center anchor, quantizes the
direction into sixteen clockwise 22.5° sectors, and returns to the neutral pose
inside a small dead zone. Reactions, movement, dragging, plugin sprite
overrides, and paused pets suspend gaze; V1 pets retain their existing idle
behavior. Horizontal flips compensate the selected atlas cell so the pet still
looks toward the cursor. Control Center → Settings → General exposes the
persisted **Idle cursor gaze** setting, enabled by default; disabling it keeps
all V2 pets on the neutral idle pose and stops the shared ticker, without
changing reactions, movement, or V1 behavior. When enabled, cursor movement
drives a short glance: the current direction is held while the cursor is moving
and for about 1.2 seconds afterward, then eligible idle V2 pets return to
neutral. No additional blink frames are used.

Catalog V2 entries may declare the same version with an exact numeric
`spriteVersionNumber: 2`; the desktop carries that marker into Pets previews so
their 8×11 layout is resolved consistently with imported/local V2 pets. Older
catalog entries omit the marker and retain V1 compatibility.

Codex integration remains import-only: OpenPets does not write installed or
catalog pets back into `~/.codex/pets/`.

## Image protocols & CSP

Pet images are served to renderers through internal protocols
(`openpets-codex:`, `openpets-installed:`, `openpets-pet-preview:`). Any new
protocol or image source must be added to the CSP in **both**
`apps/desktop/vite.config.ts` and `apps/desktop/src/renderer/index.html`, or
images silently fall back to the default pet. This is the single most common
"why is my pet showing the wrong sprite" bug - see [Desktop app](/desktop).

## Where to look first

| If you're touching… | Start in |
|---------------------|----------|
| How a reaction looks | `reaction-animation-mapping.ts` |
| What a pet says | `reaction-messages.ts` + `i18n/reactions/` |
| Window behavior (drag, click-through, horizontal flip) | `pet-window.ts`, `pet-window-interaction.ts`, `pet-preload.cjs` |
| Default vs agent visibility | `default-pet-controller.ts`, `agent-pet-controller.ts` |
| Installing / extracting | `pet-installation.ts`, `zip-safety.ts` |
| Standalone install | `packages/install-pet/` |
| Local pet authoring | `codex-pets.ts` |
| Movement | `pet-motion-engine.ts` |
| Display containment / cross-screen | `display.ts`, `confinement-manager.ts` |
| Topology-change reclamp | `pet-display-coordinator.ts` → default and pet-controller reclamp leaves |
