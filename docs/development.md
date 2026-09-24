---
description: Set up the OpenPets repository, run the desktop app, use plugin development commands, test across platforms, and follow contributor conventions.
---

# Development

How to set up, build, run, and release the workspace. This doc is the practical
"how do I work in this repo" companion; testing and production-validity gates get
their own doc, [Testing and validation](/testing-and-validation).

## Layout & toolchain

- **Monorepo**: pnpm workspaces (`pnpm-workspace.yaml`) over `apps/*` and
  `packages/*`. Package manager pinned to `pnpm@11.x`; Node `>=20`.
- **ESM + TypeScript everywhere**: every package is `"type": "module"` with dual
  type exports; internal links use `workspace:*`.
- **`web/` uses Bun + Nuxt** and is a separate toolchain - its commands run from
  `web/` with `bun`, not pnpm. Only its data/catalog side is in scope here (see
  [Catalogs](/catalog)).
- **Versioning**: packages align around SDK v3 / `manifestVersion 3`. The
  workspace version is owned by the root `package.json`; do not duplicate a
  frozen version number in docs.

The authoritative structural map is the root `codemap.md` plus per-folder
`codemap.md` files; read those before editing a subsystem.

## Root command surface

All from the repo root unless noted (full list in root `package.json`):

| Command | What it does |
|---------|--------------|
| `pnpm build` | Build every package (`pnpm -r build`) |
| `pnpm typecheck` | Type-check every package |
| `pnpm check` | Per-package `check` (typecheck + build + contract checks) |
| `pnpm test` | Build, then run each package's tests |
| `pnpm dev:desktop` | Run the desktop app in dev |
| `pnpm dev:desktop:control-center` | Dev with renderer/Control Center focus |
| `pnpm dev:desktop:plugins` | Dev with official plugins hot-loaded |
| `pnpm dev:desktop:third-parties` | Dev with direct plugin folders under `third-parties` hot-loaded |
| `pnpm capture <cmd>` | Long-running dev capture session for transparent pet/plugin screenshots (see [Screenshots](/screenshots)) |
| `pnpm package:desktop` / `:dir` | Build + package the desktop app (full / unpacked dir) |
| `pnpm release:desktop` | macOS-local build, automatic SignPath Windows signing, and verified GitHub publication |
| `pnpm release:npm` | Publish npm packages |
| `pnpm plugins:*` | Plugin test/validate/package/publish/deploy (see below) |

### Plugin DX commands

| Command | Purpose |
|---------|---------|
| `openpets plugin new <name> --template <t>` | Scaffold an SDK v3 plugin |
| `openpets plugin validate <dir>` | Validate a plugin locally |
| `pnpm plugins:test` | Locale checks + official-plugin harness tests |
| `pnpm plugins:check` | Dry-run the catalog package plan |
| `pnpm plugins:package` | Build catalog + ZIP staging (no upload) |
| `pnpm plugins:validate-release` | Pre-ship release gate |
| `pnpm plugins:publish` | Upload ZIPs to R2 |
| `pnpm plugins:validate-live` | Post-deploy live check |
| `pnpm plugins:deploy` | Deploy the web catalog |

See [Plugin platform](/plugins) for the authoring workflow and
[Testing and validation](/testing-and-validation) for what the validators
catch.

## Running the desktop app

- `pnpm dev:desktop` launches Electron against the TypeScript source with the
  Vite renderer dev server.
- On Linux, the desktop package entry runs a backend bootstrap before importing
  `main.ts`. An unflagged launch starts a replacement process directly with
  Node's `child_process.spawn` and the initial `--ozone-platform=x11` argument.
  The original process waits up to 15 seconds for a bounded ready/failure IPC
  handoff; unpackaged launches, including development over SSH, supervise the
  replacement and propagate signals and exit status. Only packaged launches
  detach. This avoids Electron's relaunch API and preserves the Linux setuid
  sandbox configuration. A short-lived bootstrap process therefore precedes the
  app process. Packaged arm64 KDE/X11 and GNOME startup were exercised; KDE
  packaged testing verified switcher exclusion, chat typing, and close/re-show,
  and a mounted KDE AppImage passed startup and skip-hint checks. Development
  `dev:control-center` startup over SSH and coordinated stop were verified on the
  GNOME VM. Packaged arm64 GNOME XWayland startup and standard skip atoms were
  verified; GUI testing confirmed typed text in pet chat and that the native
  Alt+Tab switcher listed Files and Terminal but not the pet. First-run/keyring
  dialogs were cleared manually before keyboard interaction. DEB, RPM, tar.gz,
  and x86_64 launches are untested.
  Launches already carrying the canonical argument do
  not need the extra process. `OPENPETS_ALLOW_WAYLAND=1` opts out, and native
  layer-shell keeps its separate backend path. See [Desktop app](/desktop) for
  the scope and limitations of these checks.
- Plugin authors using the installed app do not need this repo: open **Plugins →
  Developer Mode → Load unpacked plugin folder** to validate, snapshot, watch, and
  reload a standalone plugin folder.
- For plugin work, `pnpm dev:desktop:plugins` points the local loader at both
  `plugins/official` and `plugins/dev` (via `OPENPETS_DEV_PLUGIN_ROOTS`) so
  official plugins and in-progress dev plugins hot-load when working on OpenPets
  itself.
- `pnpm dev:desktop:third-parties` loads every direct child of `third-parties`
  that contains `openpets.plugin.json` through `OPENPETS_DEV_PLUGIN_ROOTS`, with
  the plugin catalog disabled. Non-plugin folders are ignored, and changes to a
  discovered plugin's manifest or entry file hot-reload it.
- To open the Control Center on a route during development, set
   `OPENPETS_DEV_ROUTE` before starting the Control Center-focused dev command,
   for example `OPENPETS_DEV_ROUTE=teams pnpm dev:desktop:control-center`.
   Use one of the canonical `ControlCenterRoute` values (`dashboard`, `pets`,
   `settings`, `plugins`, `integrations`, or `teams`). To open Settings directly
   on its Providers subtab, use `OPENPETS_DEV_ROUTE=providers pnpm dev:desktop:control-center`.
   The variable is ignored by packaged builds.
- Logs land in `userData/logs/openpets.log` (path varies by OS). Route renderer
  diagnostics into the app log, not just DevTools (per `AGENTS.md`).

### The CSP footgun

Any renderer-visible URL scheme, image source, dev endpoint, or internal
protocol must be added to the CSP in **both** `apps/desktop/vite.config.ts` and
`apps/desktop/src/renderer/index.html`. Symptom of forgetting: images fall back
to the default pet even though install/render logic is correct. See
[Desktop app](/desktop).

## Logging-as-DX

When working on renderer/IPC/catalog/plugin/pet-window behavior, add **targeted,
scoped** logs as part of the change (data shapes, selected ids, load/error
states, boundary decisions). Avoid noisy permanent logs, secrets, full payload
dumps, or logging inside animation/render loops. The logger
(`apps/desktop/src/logger.ts`) provides scopes and redaction. This is an explicit
repo convention (`AGENTS.md`), not optional polish.

### Talk/provider diagnostics

Voice device preferences are host-owned and persist only opaque browser-scoped
input/output IDs. Enumeration reports unavailable or permission-required states
without acquiring a microphone at startup; labels and IDs are not written to Talk
logs. Each generic, plugin, and native Realtime operation resolves its input once
before acquisition or negotiation, so a preference change applies only to future
operations. Output selection remains unsupported and never claims to control
System TTS in this phase.

Generic one-shot Talk lifecycle diagnostics use the `voice` scope and follow the bounded sequence
`talk session started` → capture requested/acquired/finished (or cancelled/failed)
→ STT requested/succeeded (or cancelled/failed) → brain turn requested/completed
(or cancelled/failed) → speech synthesis requested/returned (or failed) → playback
started/completed (or cancelled/failed) → `talk session ended`. Provider network
operations use the `provider` scope and log an outbound event plus a terminal event
for text, STT, TTS, and realtime negotiation. Terminal records include elapsed time,
HTTP status when available, and only output byte counts or transcript/reply character
counts.

When the active generic Talk recording is submitted by a second toggle, the host
atomically leaves the listening snapshot and clears its submit capability before
using the capture handle's `stop()` path. It continues through STT, Pet Assistant,
and synthesis; further primary toggles are idempotent while that turn is active.
After playback or terminal synthesis/playback failure, the one-shot session ends
and the next recording requires a fresh explicit Talk activation.
It records bounded capture-submit requested/succeeded/failed diagnostics; this is
distinct from capture cancellation. Native Realtime keeps its transport-owned
explicit end behavior because it has no generic recording to commit, while its
primary toggle is non-destructive.

These logs intentionally omit credentials, authorization headers, base URLs, raw
prompts, transcripts, assistant replies, request payloads, audio data, and full
provider responses. Cancellation records use the available reason (`user`,
`session`, or `capture`) so a stopped Talk attempt is distinguishable from a
provider or capture failure without exposing content.

## Release flows

### npm packages

`pnpm release:npm` (`scripts/release-npm.mjs`) determines the current public
package set and publishes it in dependency order. Treat its printed dry-run plan
as authoritative; do not maintain a hardcoded package list in documentation.
For a live package release, the package gate (`pnpm check` and `pnpm test`) must
pass first. A partial publish is retryable: re-run the same `--yes` command and
already published versions are skipped. Never use `--skip-checks` for a live
release.

For historical recovery from an existing release tag, use the tagged source
explicitly:

```bash
pnpm release:npm -- --yes --ref vX.Y.Z
```

### Desktop app

`pnpm release:desktop -- --yes` (`apps/desktop/scripts/release-local.mjs`) does a
macOS-local build + packaging, reaches the staged tag-promotion boundary,
dispatches the production SignPath Windows workflow, waits for its signed
artifact, and only then creates a draft GitHub release, verifies its complete
asset set, and publishes it. The local Windows installer is disposable; macOS
and Linux artifacts remain unsigned.

Desktop-only releases do not publish npm packages unless Desktop emits a new
exact npm integration version; that version must be published and verified first.
For a full shared-version release, publish and verify the complete npm plan
before promoting the desktop tag. The Desktop gate is the desktop `check` and
`test` pair (with the workspace build required by the release flow). Never use
`--skip-checks` on a live desktop release.

The release runs as checkpointed stages recorded in
`apps/desktop/.release-state/v<version>.json`. If an attempt is interrupted,
re-run the identical command: finished stages are skipped and the release
resumes where it failed, including re-attaching to the SignPath run that was
already dispatched. Checkpointed artifact outputs include SHA-256 content
digests, so a same-size replacement becomes stale and is revalidated instead
of being skipped. Inspect the plan with `--status`, force a redo with
`--from <stage>`, and discard the checkpoint with `--reset`. Do not warm up with
`pnpm release:desktop -- --dry-run`; it rebuilds the whole artifact set and
throws it away, and the checkpoint already makes retries cheap. SignPath may
pause for manual approval in its dashboard while the release script visibly
waits.
`electron-builder` handles cross-platform packaging; bundled mode unpacks the
integration runtimes and bundles `plugins/official` as extra resources. The
local release script first builds and validates an isolated unpacked package for
each platform/architecture artifact, then extracts the actual distributable and
checks its payload. This includes every canonical bundled plugin's manifest,
entry, assets, locales, every `@open-pets/*` runtime entry (including OpenClaw),
and the target-specific native Sharp runtime (verified by the packaging contract
- see [Testing and validation](/testing-and-validation)). Externally staged
Linux DEB/RPM payloads are inspected before they are copied into release output.
The SignPath Windows workflow runs the same target-aware contract against its x64
unpacked app before signing and against the extracted signed installer payload
before uploading it.

### Web catalog

Pet and plugin catalog deploys run from `web/` with Bun (`bun run deploy`,
`pnpm plugins:deploy`). Catalog generation/verification is in [Catalogs](/catalog)
and the release gates are in [Testing and validation](/testing-and-validation)
and [Release guide](/release).

## Cross-platform & Linux testing

Linux desktop bugs are usually specific to one compositor or window manager, so
the repo defines one reproducible VMware Fusion VM per desktop environment under
`infra/linux-vms/` (Vagrant + `vagrant-vmware-desktop`, ARM64 guests on Apple
Silicon):

| Machine | Guest | Session | Use for |
| --- | --- | --- | --- |
| `gnome` | Ubuntu 24.04 | GNOME Wayland (GDM; "Ubuntu on Xorg" selectable) | baseline Linux behavior, tray/AppIndicator, DEB/RPM fallback builds |
| `kde` | Ubuntu 24.04 + Kubuntu | Plasma 5.27 X11 (SDDM) | KWin focus, activation, drag, input-shape bugs |
| `cosmic` | Fedora 43 | COSMIC Wayland (cosmic-greeter) | COSMIC/XWayland visibility and placement bugs |

Drive them through `infra/linux-vms/vm`, never bare `vagrant`: the wrapper keeps
Vagrant state and VM disks outside the repository (`~/.openpets-vms`, override
with `OPENPETS_VM_HOME`). Run one VM at a time on a 16 GB host.

```bash
infra/linux-vms/vm up kde          # first boot provisions everything, then reboots into the desktop
infra/linux-vms/vm sync kde        # copy this working tree (incl. .git) into the guest checkout
infra/linux-vms/vm dx kde          # build and launch OpenPets in the guest desktop session
infra/linux-vms/vm dx kde --packaged -- --disable-gpu   # unpacked electron-builder app + app args
infra/linux-vms/vm log kde         # follow the guest openpets.log
infra/linux-vms/vm focus kde       # print real X11 keyboard-focus changes (xdotool)
infra/linux-vms/vm screenshot kde  # save the guest screen under infra/linux-vms/logs/
infra/linux-vms/vm ssh kde         # anything else is passed to vagrant (halt, destroy, ...)
```

Each guest has an isolated checkout at `~/src/openpets` with its own Linux
`node_modules`; the macOS checkout is never mounted, because its native modules
are darwin-specific. Local, unpushed changes reach the guest only through
`vm sync`. Guest helpers live in `/usr/local/bin`: `openpets-dx`,
`openpets-stop`, `openpets-log`, `openpets-set-pref <key> <json>` (edits
`openpets-state.json` preferences, for example `showChatButton true`),
`openpets-focus-watch`, `openpets-session-env`, and `openpets-fix-sandbox`.

Things that are easy to get wrong in these guests:

- Electron 42 downloads its binary lazily on the first `require('electron')`,
  not during `pnpm install`; `openpets-fix-sandbox` resolves it before making
  `chrome-sandbox` root-owned `4755`.
- Commands started over SSH need the logged-in desktop's `DISPLAY`,
  `WAYLAND_DISPLAY`, `XAUTHORITY`, and D-Bus address; `openpets-session-env`
  prints them from the running session, and `openpets-dx` uses it.
- Electron's own `isFocusable()` and our `focus policy applied` log line only
  reflect what Electron believes. Verify focus with `vm focus` or
  `xdotool getwindowfocus`, and activation with `xdotool windowactivate`.
- On `cosmic`, the first launch shows a "Choose password for new keyring"
  prompt (Electron safe storage via gnome-keyring). It is a native Wayland
  dialog, so `xdotool` cannot dismiss it; cancel it by hand or
  `pkill -f gcr-prompter`.
- The guests are ARM64, so released x64 AppImage/DEB/RPM artifacts do not run
  there; test a guest build (`--packaged` for the closest match). GPU-driver
  bugs (for example NVIDIA proprietary drivers) cannot be reproduced in these
  VMs at all and need real hardware or an x86 GPU cloud instance.

- **WSL** cross-platform IPC (WSL client → Windows host over private TCP) is part
  of the protocol - see [IPC and remote control](/ipc).

## Code intelligence

This repo has a **CodeGraph** index (`.codegraph/`) and an MCP server
(`codegraph_*` tools) - a tree-sitter knowledge graph of every symbol/edge/file.
Prefer it for structural questions (who calls X, what breaks if I change Y, where
is Z defined) over grep. Read-only dependency clones for inspecting Electron /
KWin behavior live under `.slim/clonedeps/repos/` (do not edit). Both are
described in `AGENTS.md`.

## Conventions checklist

- Match surrounding code style; keep comment density and naming idiomatic.
- Update the matching `docs/*.md` and `codemap.md` when behavior changes.
- Honor forward-only direction: no legacy compat in current runtime paths.
- Validate at boundaries; atomic writes; reject path traversal/symlinks.
- For plugin/catalog/i18n changes, follow the explicit "update docs / run
  validators" rules in `AGENTS.md`.
