# Build an OpenPets Plugin

Use this workflow whenever a user wants a new plugin or asks to change an
existing one. The goal is a working local plugin first, not an integration or a
catalog release.

## Establish the plugin boundary

Translate the request into one companion behavior: its trigger, durable state,
host-visible effect, and user controls. Decide whether it needs a command,
schedule, event subscription, configuration, asset, or host Assistant
capability. Do not add a permission, panel, network host, or AI dependency until
the requested behavior actually needs it.

If an existing plugin is involved, inspect its manifest, entry point, and tests
before changing it. If the user is building from scratch, scaffold the closest
template:

```bash
openpets plugin new <name> --template <blank|reminder|ambient|ai-chat|tamagotchi|calendar>
```

Use `npx -y @open-pets/cli@latest` in place of `openpets` when the CLI is not
installed globally or is too old to recognize `openpets plugin`.

The command produces a valid SDK v3 starting package. Keep the generated layout
unless the current manifest contract requires a deliberate change. Before
running its deterministic test, install the scaffolded package dependencies:

```bash
cd <plugin-directory>
npm install
npm test
```

## Read the contract before implementation

Inspect the generated `openpets.plugin.json`, `index.js`, `test.js`, and
`locales/en.json`. For an exact API or manifest question, consult in this order:

1. `packages/sdk/src/index.ts` for the public SDK type/signature.
2. `docs/sdk.md` for author intent and harness guidance.
3. `docs/plugins.md` for manifest, permissions, runtime, and local loader rules.
4. The closest official plugin for a working composition of the same capability.

Do not copy a large official plugin when only one behavior is needed. Reuse its
pattern while keeping the new plugin focused.

## Build in vertical slices

Implement one observable behavior at a time:

1. Declare the minimum manifest fields and permissions.
2. Register startup behavior through the SDK context.
3. Add the command/event/schedule that invokes it.
4. Persist only state that must survive a restart.
5. Add a test for the user-visible descriptor or resulting state.
6. Validate and local-load the plugin before expanding its scope.

Use the host's SDK surfaces rather than hidden globals, direct filesystem paths,
or renderer tricks. Plugins should request host-rendered effects; they should not
try to control pet windows directly.

## Common design choices

- A user starts something explicitly: register a command.
- Something changes at a particular time: store the durable intent and schedule
  it; reconcile work at startup.
- A plugin needs a small preference: declare a typed `configSchema` field and
  read it through `ctx.config`.
- A plugin communicates status: use `ctx.status` or a host-rendered transient or
  pinned pet surface appropriate to the urgency.
- A plugin calls an external service: declare only the required exact hosts and
  use `ctx.net`; do not add agent integration as a workaround.
- A plugin should be callable by the host Pet Assistant: explicitly register a
  bounded capability. It still needs the ordinary permissions for every effect.

## Finish the slice

Run the plugin test and local validation, then use the local-development
workflow to observe it in the desktop app. Explain the next user action plainly:
where to select the folder, what behavior to trigger, and what should appear.
