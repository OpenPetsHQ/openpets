## Repository Map

A full codemap is available at `codemap.md` in the project root.

Before working on any task, read `codemap.md` to understand:
- Project architecture and entry points
- Directory responsibilities and design patterns
- Data flow and integration points between modules

For deep work on a specific folder, also read that folder's `codemap.md`.

## Documentation Map

`docs/` holds the maintained, conceptual documentation — the narrative layer on
top of the codemaps. It explains concepts and contracts and points at the files
that own each behavior (it deliberately avoids pasting code, which rots). Start
at `docs/README.md`, then read the doc for the area you're touching:

- **`docs/architecture.md`** — system overview, runtime topology, package spine,
  end-to-end flows, cross-cutting invariants, glossary. Read first.
- **`docs/desktop.md`** — the Electron app: process model, tray/Control Center,
  windows, app state, lifecycle, security, logging, CSP.
- **`docs/ipc.md`** — local IPC protocol + `@open-pets/client`: discovery,
  transports, the lease model, request surface, security.
- **`docs/pets.md`** — pet model, reactions→animations→speech, installation,
  Codex pets, motion.
- **`docs/catalog.md`** — pet/plugin catalog contracts (v3/v2), pagination,
  search, R2 ZIP hosting, and how the app consumes them.
- **`docs/agent-integrations.md`** — Claude/MCP/OpenCode/Cursor/Pi + the CLI.
- **`docs/plugins.md`** — plugin platform: manifest, permissions, runtime,
  sandbox, install paths, packaging/publishing, troubleshooting.
- **`docs/official-plugins.md`** — companion-first direction, official lineup,
  bundling/enabled defaults, right-click action strategy.
- **`docs/sdk.md`** — public SDK v3 contract + the deterministic test harness.
- **`docs/i18n.md`** — translations across host UI, reaction speech, and plugins.
- **`docs/development.md`** — DX: layout, command surface, dev modes, releases.
- **`docs/testing-and-validation.md`** — tests, contracts, release validators,
  catalog verification, and what "production-valid" means before shipping.

When you change behavior, update the matching `docs/*.md` in the same change.
Ongoing improvement ideas / known issues are tracked in the root `improvements.md`.

## Architecture and Module Ownership

Maintain the architecture described by the codemaps. Before adding code, find the
existing owner of the concern and extend it when that keeps ownership clear. Do
not add a parallel path merely because it is easier than understanding the
existing one.

- Give each durable state, external resource, protocol, and lifecycle one clear
  owner. Keep persistence, filesystem writes, Electron windows, child processes,
  timers, sockets, and subscription cleanup with the module that owns their
  lifecycle.
- Keep facades thin: they compose established collaborators and own public
  orchestration, not duplicated parsing, transport, persistence, or policy.
- Extract a cohesive boundary only when it separates a real responsibility. Good
  boundaries include pure protocol/validation/calculation code, bounded
  transport, and focused state or lifecycle coordinators. Do not split files
  solely to reduce line count.
- Pure modules must be dependency-light and deterministic. Do not import
  Electron, filesystem, logging, settings, or UI modules into a pure core unless
  that dependency is intrinsic to its responsibility. Convert platform objects
  at the adapter boundary.
- Keep imports one-way from orchestration to focused collaborators. Move shared
  contracts/types into the lowest appropriate dependency layer rather than
  creating cycles or making a state module import its orchestrator.
- Preserve operational invariants when refactoring: public and IPC shapes,
  persisted data, protocol bytes, ordering, cancellation, cleanup, error
  precedence, and bounded-resource behavior are contracts even when not
  formally published.
- Prefer a small, explicit function or module over a generic framework, factory,
  compatibility shim, or abstraction that has only one consumer. Do not add
  speculative extension points.
- Remove superseded code, duplicate paths, unused exports, stale tests, and
  obsolete documentation in the same change. Do not leave a new and old path
  running in parallel without a documented versioned-data reason.

## Change Discipline

- Read the relevant codemap, conceptual documentation, owner module, and direct
  callers before editing. Reuse established helpers, names, types, limits, and
  error conventions instead of recreating them.
- Make each change a coherent, reviewable unit with one responsibility. Avoid
  opportunistic rewrites or formatting churn in unrelated code.
- Name files and symbols for the responsibility they own. Use suffixes such as
  `-core`, `-protocol`, `-transport`, or `-coordinator` only when they accurately
  describe a real boundary, not as a naming ritual.
- Keep validation, data access, transport, rendering, and lifecycle control in
  their appropriate layers. Do not put database/filesystem/network work in UI
  components or make UI code own durable state and cleanup.
- Treat cancellation, timeouts, replacement generations, retries, and teardown
  as part of the normal behavior. Clean up listeners, timers, readers, sockets,
  child processes, and windows on every terminal path.
- Do not silence type errors with broad casts, `any`, ignored promises, or empty
  catches. Narrow unknown input at boundaries and either handle failures with
  context or deliberately propagate them. A best-effort cleanup failure may be
  ignored only when it cannot affect the state invariant and the reason is clear.
- After a behavior or structure change, update the owning folder codemap and the
  relevant conceptual documentation when its responsibility, contract, or flow
  changed.

## Tests Must Protect Behavior

Tests are evidence of a user-visible behavior, public contract, or a plausible
regression—not a record of the implementation that happened to be written.

- Before adding a test, state the bug or contract it would catch. If there is
  no concrete answer, do not add it.
- Prefer a small assertion of the observable outcome over exact internal calls,
  helper sequencing, incidental data shapes, generated asset/source mappings,
  arbitrary versions/counts, or full wording snapshots.
- Do not test private implementation details merely to increase coverage.
  Test assets only when their format or integrity is itself a shipped contract.
- Keep one behavior-focused purpose per test. Remove no-op assertions,
  duplicate coverage, and brittle snapshots/regexes that fail on harmless
  refactors or copy changes.
- Never assert by reading source files and matching regexes or slicing on
  code text (e.g. `readFileSync` a `.tsx` + `assert.match`). Such tests pin
  the implementation, not behavior; delete them on sight instead of updating
  them after a refactor.
- When fixing a bug, add the narrowest regression test that fails without the
  fix. When reviewing existing tests, delete or rewrite tests that do not
  protect a plausible failure mode.
- Do not test implementation-specific error-code strings, helper call order,
  source layout, or internal constants unless that exact value is a documented
  externally observable contract. Prefer the user-visible outcome and stable
  boundary behavior.

## Desktop Code Readability

Desktop TypeScript and TSX must be written for human maintenance. Do not compress
functions, conditionals, validation, object construction, or JSX into dense
single-line expressions. Use conventional multi-line formatting, named
intermediate values, focused helpers, and explicit branches when they make the
state transition or boundary decision clearer. Prefer a readable function over
a clever expression; do not trade clarity for fewer lines.

Tests that assert arbitrary source strings, implementation codes, or incidental
contract details are meaningless and should be removed rather than maintained.

## Validation Before Commit

Run the narrowest relevant behavior tests first, then the applicable project
check. For desktop changes, normally run
`pnpm --filter @open-pets/desktop check`; run
`pnpm --filter @open-pets/desktop test` for cross-cutting changes or before
merge. Build docs with `pnpm docs:build` whenever documentation changes.
Always finish with `git diff --check` and leave the working tree free of generated
or unrelated changes.

## Catalog Direction

Catalog v2 is legacy and exists only for old app versions/fallback compatibility.
For new work, migrations, and Control Center UI, do not optimize for v2 behavior.
Use catalog v3 (`thumbnail`, `spritesheet`, paginated pages, and search index) as the source of truth.

See `docs/catalog.md` for the v3/v2 contracts, pagination/search, ZIP hosting, and how the app consumes them.

## Forward-Only Product Direction

Move the current app forward; do not keep legacy compatibility code, duplicate
paths, stale shims, or old behavior in current runtime code unless it is required
so older released app versions can still open/use versioned catalogs or existing
published data. Prefer clean migrations, versioned catalog/data boundaries, and
removing obsolete code over preserving backwards-compatible branches. The bar is:
old app versions should not break catastrophically, but the current app should
not carry legacy bloat for deprecated plugin/catalog behavior.

## Plugin Docs

Before changing plugin platform code, official plugins, plugin catalog generation, plugin packaging, plugin runtime behavior, or plugin-facing UI, read:
- `docs/plugins.md` for the current plugin platform architecture, manifest/runtime rules, local development workflow, publishing commands, and troubleshooting notes.
- `docs/official-plugins.md` for the companion-first plugin direction, current official plugin lineup, bundling defaults, and right-click plugin action strategy.

When plugin work is finished, update these docs if behavior, commands, manifests, plugin IDs, default bundled/enabled status, catalog workflow, permissions, or the planned plugin lineup changed. Do not leave plugin docs stale after implementation.

For plugin release/catalog work, run the release validator before shipping:
- `pnpm plugins:package`
- `pnpm plugins:validate-release`
- after deploy/R2 upload, `pnpm plugins:validate-live`

The validator exists to catch production-breaking plugin mistakes: unresolved
`$t:` names/descriptions in catalog cards, missing plugin ZIPs, SHA mismatches,
missing `locales/en.json`, missing declared assets/entry files, and catalog/package
drift. Do not rely on `plugins:check` alone for release readiness.

See `docs/testing-and-validation.md` for the full quality ladder and what "production-valid" means per change type.

## Logging for Fast DX

When working on desktop UI, renderer, IPC, catalog, plugin, or pet-window behavior, add targeted logging as part of the implementation when it helps diagnose issues quickly.
Prefer concise, scoped logs that capture data shape, selected IDs, load/error states, and boundary decisions.
Route renderer diagnostics into the app log when possible so failures are visible in `openpets.log`, not only DevTools.
Avoid noisy permanent logs, secrets, full payload dumps, or logging in tight animation/render loops.

See `docs/development.md` (DX) and `docs/desktop.md` (logging subsystem and scopes).

## Control Center CSP

When adding any renderer-visible URL scheme, image source, dev server endpoint, or internal protocol, update the Control Center CSP in both `apps/desktop/vite.config.ts` and `apps/desktop/src/renderer/index.html`.
Common pet image protocols include `openpets-codex:`, `openpets-installed:`, and `openpets-pet-preview:`; forgetting CSP causes images to load as the default/fallback pet even when install/render logic is correct.

See `docs/desktop.md` (security model) and `docs/pets.md` (image protocols).

## Linux Desktop Test VMs

Reproducible VMware Fusion/Vagrant VMs for Linux GUI testing are defined in
`infra/linux-vms/`: `gnome` (Ubuntu 24.04 GNOME Wayland), `kde` (Kubuntu Plasma
X11), and `cosmic` (Fedora 43 COSMIC). Always drive them through
`infra/linux-vms/vm` (`up`, `sync`, `dx`, `log`, `focus`, `screenshot`), which
keeps VM state outside the repo in `~/.openpets-vms`. Pick the VM that matches
the reporter's desktop, run one at a time, and check guest logs with
`vm log <name>`.

Never mount the macOS checkout into a guest; each guest has its own clone at
`~/src/openpets` with Linux `node_modules`, and local changes arrive via
`vm sync`. Verify window-manager behavior (focus, activation, stacking) with
X11 tools such as `xdotool`, not Electron's own state or our logs.

See `docs/development.md` (Cross-platform & Linux testing) for the full workflow
and guest helpers.

FYI: third-parties/ folder contains other repos related to openpets, putting here so it's easier to work on those other repos too.

## Cloned Dependency Source

Read-only dependency source repositories are available under
`.slim/clonedeps/repos/` for inspection. Do not edit these clones.

- `.slim/clonedeps/repos/electron__electron/` — `electron/electron` at `v42.0.0`; inspect Electron BrowserWindow behavior, including Linux window hints that affect taskbar, switcher, and focus visibility, alongside general Linux and Wayland geometry behavior.
- `.slim/clonedeps/repos/KDE__kwin/` — `KDE/kwin` at `v5.27.11` (`c328a2fd746a8c838b3d6d3c47475d8191d05b7f`); inspect KDE Wayland handling of taskbar, switcher, and focus roles for xdg toplevels, alongside movement, activation, and window geometry constraints.
- `.slim/clonedeps/repos/GNOME__mutter/` — `GNOME/mutter` at `46.0` (`c4753689e3413cd9332d885dd0297b3b7d9ba9ca`); inspect GNOME Wayland handling of taskbar, switcher, and focus roles, alongside window movement, activation, and geometry constraints.
- `.slim/clonedeps/repos/GNOME__gnome-shell/` — `GNOME/gnome-shell` at `46.0` (`0463511457612ca87f7426b3b01356d1d85bee9b`); inspect GNOME Shell taskbar, switcher, and focus behavior and its interaction with Mutter, alongside Linux desktop window movement and activation.
- `.slim/clonedeps/repos/sidorares__node-x11/` — `sidorares/node-x11` at `v4.2.1` (`12bb53b3d78f592f05762784ec3be68cb011b8b8`); inspect the Node.js X11 client and its support for setting or querying X11 window properties relevant to taskbar, switcher, and focus behavior.
- `.slim/clonedeps/repos/xorg__xserver/` — `xorg/xserver` at `xwayland-23.2.6` (`db9cde0328aa1bd21210cf5472ca7901697b3713`); inspect Xwayland and X server handling of X11 window properties relevant to Linux taskbar, switcher, and focus behavior.

The OpenClaw source clone recorded in `.slim/clonedeps.json` is not currently present under `.slim/clonedeps/repos/`.
