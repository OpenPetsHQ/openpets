# OpenPets for VS Code

An unreleased standalone companion for private evaluation, independent of the desktop app. A fresh installation includes Hoodie Cat and five manual outfits offline. Browse the online catalog or import a complete pet ZIP; installation does not add or select a scene instance. Open **OpenPets: Open Pet Space** for an editor tab or **OpenPets: Show Pet in Sidebar** for the movable view.

Studio is an optional online creation tool outside the extension. For locally imported pets or a local builtin outfit override, use the original ZIP or existing Studio project rather than assuming Studio has your changes. See `docs/vscode.md` for import, replacement and validation details.

Run `pnpm --filter openpets-vscode build` then `pnpm --filter openpets-vscode package:local` to create a local VSIX. The placeholder publisher `openpets-local-development` is not an assertion of ownership. Public release requires an owner-confirmed publisher, explicit authorization and release validation; never publish under the placeholder. Windows and Linux remain unverified.
