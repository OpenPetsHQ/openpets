---
description: Standalone OpenPets for VS Code, its companion scene, packages and evaluation status.
---

# OpenPets for VS Code

## Status

The standalone extension is locally packaged for private macOS evaluation. It
does not require the desktop app, an account, an AI provider or agent setup.
It is not Marketplace-published: the publisher is a placeholder and public
release requires owner confirmation and explicit authorization. Windows and
Linux remain unverified.

## Companion scene

Open **OpenPets: Open Pet Space** for an editor tab or **OpenPets: Show Pet in
Sidebar** for the movable view. One shared scene plays on one surface at a time.
Add up to six named instances, including multiple instances of the same pet with
independent manual outfits. Installing a pet never adds or selects an instance;
removing an instance never uninstalls its asset. An intentionally empty scene
and saved settings persist across restart.

Pets animate, respond to clicks and directional dragging, and roam within the
webview. Motion modes are Still, Calm and Playful, with an independent Pause
setting. Sizes are 48, 72 and 96 CSS pixels wide; Plain and Dots are CSS
backdrops. This is not an OS-level desktop overlay. There are no ball or throw
controls, and no copied vscode-pets scenery or artwork.

## Pets, outfits and offline use

A fresh installation includes the Hoodie Cat base and five bundled outfits:
Pajamas, Weekend, Halloween, Winter Holidays and Summer. Choose outfits
manually; automatic schedules are deferred. The portable builtin wardrobe
definition is shared with desktop, and the extension build copies the canonical
desktop assets rather than maintaining separate artwork.

Browse and search catalog v3 to install pets and compatible wardrobes, or use
the Gallery to import a complete local pet ZIP. Downloads need network access;
installed generations, the bundled pet and saved choices work offline. A local
ZIP is copied into extension-owned storage and is not needed after installation.
Catalog wardrobes use their dedicated packages; local imports must contain a
complete valid package rather than an outfit-only delta.

From Outfits, a targeted ZIP import replaces the whole package for every
instance of that pet after confirmation. The package ID must match and the ZIP
must contain a usable wardrobe. A targeted Hoodie Cat import creates a separate
builtin wardrobe override: it replaces the bundled wardrobe, not the bundled
base, and does not change a separately installed ordinary `hoodie-cat` pet.
Unavailable saved outfits fall back to the base without erasing the selection;
an unavailable or corrupt builtin override falls back to the bundled base and
five outfits with a problem reported.

Replacement of existing local or catalog packages is confirmed where it can
overwrite local work. Packages retain their source provenance and are committed
as immutable generations using SQLite compare-and-swap, so a competing change
requires review rather than silently replacing it. Existing JSON installation
references are read once into SQLite; invalid plausible IDs remain blocked and
reported rather than being treated as absent. SQLite is the current reference
owner, not a parallel JSON writer.

## Studio

OpenPets Studio is an optional online creation service, outside the extension;
its account and creation flow are separate. Create pet opens
`https://openpets.dev/studio/new`. Outfit creation links to the catalog pet in
Studio's wardrobe view for catalog pets and the unmodified builtin. For a local
pet or retained builtin local override, use the original ZIP or an existing Studio
project; Studio does not automatically receive local changes. Export a complete
package and import it into the extension when ready.

The Studio website is deployed at `openpets.dev` and its health endpoint returned
200. The owner elected to skip the cache purge. An authenticated production
Studio import and external query navigation have not been verified; local mock
browser flows were exercised.

## Development and validation

Run `pnpm --filter openpets-vscode build` and
`pnpm --filter openpets-vscode package:local` for a local VSIX. The latest source
gate passed; the extension's 91 tests, build and typecheck and the documentation
build passed after removal of the ball interaction. A macOS development host
demonstrated live drag animation and roaming.

An installed macOS VSIX exercised a handcrafted contract-fixture ZIP through
the real validation worker, WASM decoder, SQLite and file I/O, including builtin
override, separate ordinary Hoodie Cat, restart and offline asset loading. Native
picker and confirmation responses were controlled via the VS Code API, not
automated OS widgets; the fixture was not an actual Studio export. These checks
do not establish authenticated production Studio import, OS dialog behavior,
Windows/Linux behavior or complete release acceptance.

Plugin execution, AI and agent integrations, automatic schedules and desktop
synchronization are outside the current extension scope.
