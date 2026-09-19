---
name: openpets
description: Use whenever the user wants to build, extend, debug, test, validate, locally load, package, or publish an OpenPets plugin; work with the OpenPets Plugin SDK v3, plugin manifest, plugin permissions, sandbox, plugin UI, storage, schedules, assets, or local plugin development. Also use for installing or configuring OpenPets, pets, optional coding-agent integrations, or local MCP controls. Prioritize the local-first plugin authoring experience; agent integrations are optional.
license: MIT
---

# OpenPets

OpenPets is a local-first desktop companion platform. Its core extension point is
the sandboxed Plugin SDK v3: plugins describe companion behavior and the desktop
host owns rendering, state, permissions, and lifecycle. Coding-agent and MCP
integrations are useful optional adapters, not a prerequisite for using or
developing plugins.

## Choose the right path

- Building, changing, or debugging a plugin: read
  [Build a plugin](workflows/build-plugin.md), then the relevant SDK references.
- Loading a work-in-progress plugin into the desktop app: read
  [Develop locally](workflows/develop-locally.md).
- Testing, validating, packaging, or publishing a plugin: read
  [Test and validate](workflows/test-and-validate.md).
- Installing the app or CLI: read [Install OpenPets](workflows/install-openpets.md).
- Connecting Claude Code, OpenCode, Cursor, Codex, or MCP: read
  [Configure a project](workflows/configure-project.md). Treat this as a
  secondary integration path, not the default answer to plugin work.
- Diagnosing desktop, CLI, or agent-control problems: read
  [Troubleshoot](workflows/troubleshoot.md).
- Explaining runtime topology or optional integrations: read
  [Explain architecture](workflows/explain-architecture.md).

## Plugin-authoring posture

Help the user reach a fast local feedback loop before discussing catalog release
or agent integrations:

1. Scaffold from the closest supported template rather than creating a guessed
   package shape.
2. Read the generated manifest and entry point before editing. The manifest and
   current SDK types, not remembered APIs, define what will run.
3. Implement the smallest companion behavior that fulfills the request, asking
   only for permissions it actually needs.
4. Write deterministic harness tests for behavior, validate the folder, then
   load it locally in the desktop app.
5. Use the desktop's Developer Mode watcher to iterate. Publishing is a separate
   decision and must never be implied by local loading.

Do not require the user to configure Claude Code, OpenCode, MCP, or any other
agent to build a plugin. Do not require an OpenPets source checkout when the
desktop app and CLI are enough.

## Local development is a first-class workflow

For a standalone plugin folder, OpenPets provides:

```bash
npm install -g @open-pets/cli@latest
openpets plugin new <name> --template <blank|reminder|ambient|ai-chat|tamagotchi|calendar>
openpets plugin validate <plugin-directory>
```

The one-off CLI alternative is:

```bash
npx -y @open-pets/cli@latest plugin new <name> --template <template>
npx -y @open-pets/cli@latest plugin validate <plugin-directory>
```

After scaffolding, enter the plugin directory and install its test dependency:

```bash
cd <plugin-directory>
npm install
npm test
```

If `openpets plugin` is reported as an unknown command, the globally installed
CLI is older than the SDK v3 plugin tooling. Upgrade it with the first command
above or use the one-off `npx -y @open-pets/cli@latest` form.

Then, with the desktop app running, use **Plugins → Developer Mode → Load
unpacked plugin folder**. OpenPets validates and snapshots the folder, remembers
the source location, watches it, and re-snapshots/reloads after edits. Reloading
locally does not publish or upload anything.

If the user maintains OpenPets itself, `pnpm dev:desktop:plugins` hot-loads the
repository's `plugins/official` and `plugins/dev` lanes. Do not tell an external
plugin author to use maintainer-only environment variables or catalog commands.

## Authoritative references

When the OpenPets checkout is available, use its source and docs as the primary
reference. Read only the material relevant to the requested capability:

| Need | Read first |
| --- | --- |
| Plugin package shape, local loading, manifest, sandbox, release lanes | `docs/plugins.md` |
| SDK namespaces, permissions, testing harness | `docs/sdk.md`, then `packages/sdk/src/index.ts` or `packages/sdk/src/testing.ts` for an exact signature |
| Scaffolded templates | `packages/cli/src/plugin-templates.ts` |
| Exact manifest validation errors | `packages/cli/src/plugin-validate.ts` and `packages/cli/schemas/openpets.plugin.schema.json` |
| Working patterns | `plugins/official/*/openpets.plugin.json`, `index.js`, and `test.js` |
| Repository dev modes and commands | `docs/development.md` |
| Localization | `docs/i18n.md` |

Without a checkout, use the maintained public docs:

- Documentation hub: https://openpets.dev/docs
- Plugin platform and catalog: https://openpets.dev/plugins
- Plugin SDK v3 reference: https://openpets.dev/sdk
- Development guide: https://openpets.dev/development
- Canonical source repository: https://github.com/OpenPetsHQ/openpets
- Source documentation index: https://github.com/OpenPetsHQ/openpets/tree/main/docs
- Exact SDK contract: https://github.com/OpenPetsHQ/openpets/blob/main/packages/sdk/src/index.ts
- Working first-party examples: https://github.com/OpenPetsHQ/openpets/tree/main/plugins/official

For the maintained navigation map and what each source is authoritative for,
read [Source references](references/source-docs.md).

The exact public SDK contract lives in `packages/sdk/src/index.ts`. Never invent
an SDK method, manifest field, permission, or UI capability because it seems
plausible. Inspect the current contract or explain what needs verification.

## Design for the host, not around it

- Plugins describe behavior through `ctx`; they do not inject arbitrary UI into
  pet windows or take ownership of window placement/lifecycle.
- Match each SDK namespace to a declared manifest permission. A call missing an
  approved permission is denied at runtime.
- Keep permissions narrow. In particular, network access requires declared and
  approved exact hosts; local network access and non-GET requests are separate
  permissions.
- Persist durable plugin state with `ctx.storage`; make scheduled work safe to
  reconcile after restart or sleep.
- Declare every visual or sound asset in the manifest. Do not use ad-hoc local
  paths as asset references.
- Ship `locales/en.json` and use `$t:` / `ctx.t()` when a plugin has user-facing
  strings that need localization.
- Keep behavior companion-first: useful, calm, and stateful rather than a
  generic floating app. Prefer host-rendered descriptors such as commands,
  alerts, bubbles, panels, status, and deliveries over custom rendering.
- Treat the deterministic SDK harness as the default test surface. Assert
  observable descriptors and state transitions, not Electron internals.

## Boundaries worth preserving

- The desktop app must be running to load and observe a local plugin.
- Local load is for iteration; catalog packaging/publishing is for maintainers
  and reviewed release lanes.
- `ctx.assistant.registerCapability(...)` can make an explicit plugin operation
  available to the host Pet Assistant, but it grants no permission or access by
  itself.
- One-shot `ctx.voice.listen()` is host-owned and visible; it is never ambient
  microphone access.
- The host controls approval, quotas, sandboxing, and teardown. Design plugins
  to handle rejected calls and reloads gracefully instead of bypassing those
  boundaries.

## Optional coding-agent integrations

Use the integration workflows only when a user specifically wants an agent to
react through a pet, control a pet over local IPC/MCP, or configure a project.
They are not needed to author, test, locally load, or share an OpenPets plugin.

## Safety and change discipline

- Confirm before replacing user-managed agent, MCP, hook, or plugin
  configuration, or before using `--force`.
- Do not put source code, secrets, credentials, URLs, private paths, or private
  logs into pet speech.
- Verify the current desktop/CLI state rather than promising that it is installed
  or running.
- For source-repo changes, preserve the SDK contract: an SDK surface change must
  update the published types, desktop bridge, test harness, and conformance
  check together.
