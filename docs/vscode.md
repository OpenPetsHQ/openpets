---
description: Agreed product direction and first-release scope for standalone OpenPets for VS Code.
---

# OpenPets for VS Code

## Status and product direction

The standalone extension in `apps/vscode-extension/` is locally packaged for
private evaluation. Catalog, manual outfits, independent storage, two surfaces,
and scene UI are implemented. Host, core and UI gates passed, including the UI
gate's live-pointer condition. The final installed VSIX has been exercised on
macOS, with the limits described below. It is not Marketplace-published; public
release requires an owner-confirmed publisher identity and explicit authorization.

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
| Scene | Up to six independently named instances, including multiple instances of the same installed pet with independent outfits. Add, remove, name and select instances; installing an asset does not add it and removing an instance does not uninstall it. An intentionally empty scene stays empty across restart. |
| Animation | Faithful support for existing OpenPets spritesheet layouts and animation mappings, not static-preview-only compatibility. |
| Outfits | Download available compatible wardrobes and manually choose an outfit or return to the base appearance. |
| Interaction | Click and webview-local direction-aware dragging and release, bounded autonomous roaming, and ball play. |
| Focused settings | Still, Calm (default), and Playful motion modes; durable Pause is independent. VS Code-only sprite widths are 48/72/96 CSS pixels with proportional height; desktop sizes do not change. Plain/Dots CSS backdrops. |
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
The scene renderer implements click, webview-local direction-aware dragging,
autonomous roaming and ball play. These are VS Code-specific, not desktop
movement. The authored atlases do not provide lifted, sleep, climb or
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

`SceneStore` and its SQLite worker own scene transactions, settings, selection and
up to six independently named instances with per-instance outfits; an intentionally
empty scene remains empty. Installed-asset receipts are separate atomic JSON
records owned by `preferences.ts` and `pet-store.ts`. Validated packages are
promoted to uniquely named immutable generations with archive SHA-256 recorded
separately; reinstalling repairs damaged assets without replacing old readers.
Installing does not add an instance; removing one does not uninstall its asset.
Unavailable assets and outfits fall back without erasing saved choices. Wardrobe
metadata can be unknown: users can explicitly check it rather than treating unknown
as unavailable. Install operations retain cancellable 150-second phase deadlines.

One active playback surface runs one shared scene scheduler; positions and the
single ball/chaser are transient webview state. Hidden scenes pause and resume
without accumulating ticks. The packaged SQLite worker was exercised in isolated
VS Code 1.101 and 1.142 hosts and a cross-process contention/recovery test on
macOS arm64; that is not Windows/Linux or power-loss proof.

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
  ball play, and desktop-equivalent throw physics.

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

## Validation status and limits

- The full 56-test suite, typecheck and build passed. On macOS, development-host
  checks exercised six pets in a 220px sidebar and wide editor, real pointer
  gestures, roaming, ball play, pause and mutation admission. Hidden-state
  behavior was simulated; true OS hide lifecycle and quantitative six-pet
  performance are not fully established.
- The final installed VSIX restored two independently named, differently dressed
  instances after restart and preserved an intentionally empty scene. An installed
  path harness rendered local outfits with zero startup fetches while intercepting
  fetch; that is not an OS-level offline test. Scene V1 pixels and all size
  combinations were not independently verified in the installed product.
- A separate production-source service test observed cross-process watcher
  updates; it was not a two-GUI-window test of the installed product. The latest
  watcher test passed, but the cause of an earlier filesystem-watcher timeout
  remains unconfirmed. Windows and Linux have not been verified in these checks.

These observations support private evaluation, not a claim that every release
acceptance condition has passed or authorization to publish.
