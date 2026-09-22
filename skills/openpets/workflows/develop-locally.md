# Develop an OpenPets Plugin Locally

Use this workflow to put an unpacked plugin into OpenPets for fast iteration.
Local loading is the normal authoring loop; it does not publish a plugin.

## Standalone plugin author loop

1. Ensure the OpenPets desktop app is installed and running.
2. Keep the plugin as a normal folder with `openpets.plugin.json` at its root.
3. Validate before loading:

   ```bash
   openpets plugin validate <plugin-directory>
   ```

4. In the desktop app open **Plugins → Developer Mode → Load unpacked plugin
   folder**, then select that root folder.
5. Verify the plugin appears as a local/development plugin. Enable it if the app
   leaves it disabled after approval.
6. Make an edit, allow the watcher to re-snapshot and reload, then trigger the
   behavior again. Use the plugin inspector/diagnostics when it is marked broken
   or a requested SDK action is blocked.

The loader validates the selected folder and snapshots its manifest, entry file,
and declared assets into the app's local development store. It remembers and
watches the original source folder, so edit the original plugin directory—not a
snapshot inside OpenPets user data.

This loop requires no OpenPets source clone and no Claude, MCP, or other coding
agent configuration. A standalone author needs only the desktop app, the plugin
folder, and the CLI (or its `npx -y @open-pets/cli@latest` form) to scaffold and
validate. `npm install` in the scaffolded folder is needed to run its harness
tests, not to use the desktop app's local folder loader.

## When working inside the OpenPets repository

Run the suitable dev mode from the repository root:

```bash
pnpm dev:desktop:plugins
```

This hot-loads `plugins/official` and `plugins/dev`. For third-party plugin
folders placed directly under the repository's `third-parties/` directory, use:

```bash
pnpm dev:desktop:third-parties
```

These are repository-maintainer workflows. Do not prescribe their environment
variables to a standalone plugin author.

## Diagnose a failed local load

Start with `openpets plugin validate <plugin-directory>`. Then check:

- `openpets.plugin.json` is in the selected folder's root.
- The manifest is SDK v3 (`manifestVersion: 3`, compatible `sdkVersion`, and a
  relative `.js`/`.mjs` entry file).
- Every entry, panel, locale, and declared asset file exists as a regular file;
  local-loader paths and symlink escapes are rejected.
- Each runtime SDK call has a corresponding declared and approved permission.
- A network host is exact, declared, and approved; local/private hosts additionally
  require the local-network permission and an explicit port.
- The desktop app is running and the plugin is enabled after loading.

For a plugin that initially works but becomes broken, inspect the plugin
diagnostics and reduce the failure to the first rejected SDK call or invalid
descriptor. Do not bypass the loader or patch its snapshots manually.
