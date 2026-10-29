---
description: Agreed product direction and first-release scope for standalone OpenPets for VS Code.
---

# OpenPets for VS Code

## Status and product direction

The standalone extension is under active implementation in `apps/vscode-extension/`.
The base standalone catalog, manual outfits, independent storage, and two companion
surfaces are implemented. The 26-test suite and live-backend/dev-host checks
provide evidence for the base; clean installed-VSIX, restart and offline acceptance
remain pending. Nothing here claims a public release. The expanded competitive
features below are approved for first release but remain planned or in progress.

OpenPets for VS Code will be a standalone companion experience: existing OpenPets
pets and their outfits, inside the editor. It must not require the desktop app,
an Electron background service, an account, an AI provider, or agent setup.

The first release promises **a lively OpenPets companion scene and outfits, inside VS Code**.
It should be complete and enjoyable on its own, rather than a preview of desktop
features or an unfinished plugin platform.

The goal is lasting companionship through good animation, direct interaction,
and persistent customization—not feature count. Learn from
[vscode-pets](https://github.com/tonybaloney/vscode-pets)' low-friction installation
and unobtrusive editor presence while keeping OpenPets' own assets and identity.
Do not assume that another project's code license covers its artwork.

## First-release scope

| Area | Agreed scope |
| --- | --- |
| Installation | Install the extension and use it without a desktop dependency or AI configuration. |
| Pet gallery | Browse and search the existing catalog v3, preview pets, and install them into extension-owned storage. |
| Companion surface | One shared scene in a movable sidebar view or dedicated editor-tab pet space beside the code; only one surface is active at a time. |
| Scene (planned) | Up to six independently named instances, including multiple instances of the same installed pet with independent outfits. Add, remove, name and select instances; installing an asset does not add it and removing an instance does not uninstall it. An intentionally empty scene stays empty across restart. |
| Animation | Faithful support for existing OpenPets spritesheet layouts and animation mappings, not static-preview-only compatibility. |
| Outfits | Download available compatible wardrobes and manually choose an outfit or return to the base appearance. |
| Interaction | Existing click and webview-local drag; planned direction-aware dragging and release, bounded autonomous roaming, and ball play. |
| Focused settings | Planned Still, Calm (default), and Playful motion modes; durable Pause is independent. VS Code-only sprite widths are 48/72/96 CSS pixels with proportional height; desktop sizes do not change. Planned Plain/Dots CSS backdrops. |
| Persistence | Restore the scene, names, outfits, size and settings between editor sessions; installed assets and scenes remain usable offline. |

Catalog browsing and new downloads require network access. Previously installed
assets and saved choices must not depend on the catalog remaining reachable.

Pet movement is contained within the companion webview; this is not an OS-level
desktop pet or an overlay on the code editor. The sidebar view can be moved to
VS Code's bottom Panel using the editor's view-placement controls. Separately,
an OpenPets command opens the pet space as an editor tab, like vscode-pets'
`panel` mode; that reference's setting does not mean the bottom Panel container.
Closing VS Code ends its execution. No separate background process
will be introduced to keep the companion alive.

## Existing foundations and missing pieces

The repository already supplies useful foundations:

- Pet assets and package contracts, including the supported WebP/static SVG
  atlases and both spritesheet layouts: [pets.md](pets.md).
- Catalog v3 pagination, search, metadata, and downloadable packages:
  [catalog.md](catalog.md).
- Wardrobe contracts and compatibility rules. Outfits are alternate atlases, and
  wardrobe downloads are distinct from base-pet ZIPs: [wardrobe.md](wardrobe.md).
- Shared animation, metadata, catalog, wardrobe, archive and atlas policy in
  `packages/pet-format/`, and SVG validation in `install-pet/spritesheet`.

Portable pet contracts and validation live in `@open-pets/pet-format`; the
extension supplies its own storage, worker-based decoder, surfaces and UI.
The standalone installer entry is not used as a VS Code host.

Desktop movement and interaction largely control Electron windows, screen
geometry, and IPC. They cannot simply be mounted inside a VS Code webview.
Click reactions and webview-local dragging exist. Ball play, autonomous roaming,
direction-aware drag/release and a multi-instance scene are planned, not existing
portable features. The authored atlases do not provide lifted, sleep, climb or
hang rows; do not promise those animations. Source inspection of vscode-pets
shows the value of independent named pets, visible movement and simple ball play,
while its species-specific state graphs cannot be assumed for OpenPets assets.

## Implementation boundaries

- Share one set of pet/outfit contracts and genuinely portable validation,
  animation, and resolution logic. Extract cohesive owners where necessary;
  do not copy desktop internals into the extension.
- Keep VS Code rendering, pointer interaction, extension lifecycle, installation,
  and persistence in VS Code-specific adapters with clear ownership.
- Use catalog v3 as the source of truth. Do not introduce a new v2 runtime path.
- Store installed assets and preferences independently of desktop user data.
  Desktop installations and outfit choices are not implicitly shared.
- Honor the existing atlas validation and wardrobe compatibility contracts.
  Manual outfit selection must download the wardrobe package, not assume the
  base ZIP contains outfits.
- Keep the host boundary clear enough for later plugin support, but do not build
  speculative SDK adapters or a plugin framework in the first release.

The current host stores independent atomic JSON records for each installation, per-pet
outfit, selected pet and size under extension-owned global storage. It promotes
validated packages to uniquely named immutable generations, recording the archive
SHA-256 separately. Reinstallation creates a fresh generation so damaged assets
can be repaired without disturbing existing readers. A saved but unusable pet falls back to the
bundled companion without erasing the choice. Missing or invalid optional
outfits fall back to the base atlas. Installation does not select a pet. Install
operations retain their cancellable, 150-second phase deadline semantics.
The scene storage implementation remains undecided pending proof of true
cross-process transaction safety; no new locking mechanism or scene protocol
is claimed as shipped.

A planned single scene scheduler owns motion on the active surface, with at most
one ball and one chaser. Hidden scenes pause and resume without accumulating
ticks or deferred actions. Each scene remains offline-safe.

For local development, run `pnpm --filter openpets-vscode build` and
`pnpm --filter openpets-vscode package:local`. Open **OpenPets: Open Pet Space**
for the editor tab or **OpenPets: Show Pet in Sidebar** for the movable view.
The publisher is a local placeholder; public release requires an owner-confirmed
publisher and separate approval.

## Explicitly deferred

- Plugin installation and execution.
- AI assistants and agent integrations.
- Automatic outfit schedules.
- Desktop synchronization or a desktop connection.
- Friendships, import/export, species-specific wall behavior, mini-games beyond
  the planned ball play, and desktop-equivalent throw physics.

These are not required for the approved first release.

## Later plugin direction

The long-term direction is one OpenPets ecosystem with independent desktop and
VS Code hosts—not separate collections of rewritten plugins. Reuse plugin
manifests, SDK contracts, and portable business logic where supported, with
host-specific capability implementations.

Future compatibility must be explicit. Desktop-only capabilities must not
silently become no-ops, and existing plugins must be audited before being
advertised as supported. No cross-host plugin-state synchronization or execution
ownership protocol is included in this first release.

## First-release acceptance

- Install and use the extension with the desktop app absent; catalog downloads
  work online and installed pets, outfits and scenes remain usable offline.
- Create up to six named instances, including two of the same pet with different
  outfits; add, select, rename and remove independently. Installation never adds
  an instance and removal never uninstalls assets. An intentionally empty scene,
  names, outfits and choices survive a full restart.
- Roaming, direction-aware drag/release and one-ball/one-chaser play use available
  authored animations and give visible feedback without invented atlas rows.
- Still/Calm/Playful, separate durable Pause, Plain/Dots and all three proportional
  VS Code sizes work; pets and names stay contained at a 220px sidebar width.
- Sidebar/editor handoff has one active scene scheduler; hiding pauses work and
  reopening resumes without buildup or leaking timers and listeners.
- Failed downloads, invalid individual records and damaged assets offer honest
  recovery or fallback without erasing valid choices; optional outfit failures
  fall back to the base atlas. Verify cross-process storage safety before relying
  on a scene transaction implementation.
- Run focused behavior tests and verify the actual installed VSIX in VS Code,
  including real catalog/install, offline restart, scene interactions and failure
  recovery before release. Existing dev-host evidence is not final acceptance.
