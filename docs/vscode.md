---
description: Agreed product direction and first-release scope for standalone OpenPets for VS Code.
---

# OpenPets for VS Code

## Status and product direction

This is the agreed product plan, not documentation of an implemented extension.

OpenPets for VS Code will be a standalone companion experience: existing OpenPets
pets and their outfits, inside the editor. It must not require the desktop app,
an Electron background service, an account, an AI provider, or agent setup.

The first release promises **your OpenPets companion and outfits, inside VS Code**.
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
| Companion surface | One selected companion, shown in a movable sidebar view or a dedicated editor-tab pet space beside the code. Both surfaces use the same saved companion and customization. |
| Animation | Faithful support for existing OpenPets spritesheet layouts and animation mappings, not static-preview-only compatibility. |
| Outfits | Download available compatible wardrobes and manually choose an outfit or return to the base appearance. |
| Interaction | Drag the pet within its webview and click it for a visible reaction. |
| Persistence | Remember the selected pet, outfit, and size between editor sessions. Installed companions remain usable offline. |

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
- Existing animation mappings in
  `apps/desktop/src/reaction-animation-mapping.ts`, atlas validation in
  `packages/install-pet/src/spritesheet.ts`, and pure wardrobe logic in
  `apps/desktop/src/pet-wardrobe-core.ts`.

There is not yet a complete portable pet runtime. Several relevant owners live
inside the desktop app, and `@open-pets/pet-format` is not a complete parser or
runtime. The standalone installer is also not a ready-made VS Code host.

Desktop movement and interaction largely control Electron windows, screen
geometry, and IPC. They cannot simply be mounted inside a VS Code webview.
Click reactions and webview-local dragging need implementation. Ball chasing,
autonomous ambient wandering, and a multi-pet editor scene must not be presented
as existing portable features.

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

Exact module extraction, extension packaging, and UI details are implementation
decisions still to be worked through; they are not established by this plan.

## Explicitly deferred

- Plugin installation and execution.
- AI assistants and agent integrations.
- Automatic outfit schedules.
- Multiple simultaneous pets.
- Ball chasing, mini-games, and desktop-equivalent throw physics.
- Desktop synchronization or a desktop connection.

These are not required to make the first release complete. Additional play and
plugin abilities should build on an already enjoyable companion experience.

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

- A user can install and use the extension with the desktop app absent.
- Catalog selection produces a faithfully animated installed pet.
- Compatible outfits can be installed, selected, and removed without changing
  the pet's identity or corrupting its saved choice.
- Click and drag interactions work inside the companion surface without
  requiring plugins.
- Reopening VS Code restores the selected companion, outfit, and size.
- Installed pets and outfits still work without network access.
- Closing, hiding, and reopening the companion surface has deliberate resource
  ownership and does not accumulate timers or listeners.
- Validate portable contracts with focused unit tests and run the actual
  extension in VS Code to verify installation, rendering, interactions,
  persistence, and offline behavior before release.
