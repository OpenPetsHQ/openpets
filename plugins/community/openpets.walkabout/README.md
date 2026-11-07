# openpets.walkabout

An OpenPets plugin that makes the default pet and user-pinned desktop pets roam
the screen independently. Each pet has its own movement runner, and unpinning a
pet removes it from Walkabout immediately.

## Modes

| Mode | Description |
|------|-------------|
| **Wander** (default) | Pet takes random strolls, pausing between steps |
| **Follow cursor** | Pet trails your mouse with configurable lag |
| **Patrol** | Pet paces back and forth across the screen |

## Config options

| Option | Values | Default |
|--------|--------|---------|
| Movement mode | wander / follow-cursor / patrol | wander |
| Speed | slow / normal / brisk | slow |
| Move interval | 2s / 5s / 10s / 20s | 10s |
| Pause when agent is busy | on / off | on |

> **Gravity** is now a global OpenPets Settings preference and applies to all pets — it is no longer a per-plugin toggle.

When one or more pets are pinned, Walkabout adds **Toggle pinned pet movement**
to its plugin commands. Choose a pet to pause or resume its movement. That
preference is saved per pet and survives plugin restarts. The default pet keeps
the existing Walkabout behavior and is not changed by this command.

## Dev setup

The plugin requires the OpenPets desktop app and the `pet:move` permission set.

### Loading in dev mode

Point the OpenPets app at this folder via the `OPENPETS_DEV_PLUGIN_PATHS` env var:

```sh
# Packaged app (macOS)
OPENPETS_DEV_PLUGIN_PATHS=/Users/GTN473/repos/pets/openpets/plugins/dev/openpets.walkabout \
  open -a OpenPets

# Dev build (from repo root — requires pnpm)
OPENPETS_DEV_PLUGIN_PATHS=/Users/GTN473/repos/pets/openpets/plugins/dev/openpets.walkabout \
  pnpm dev:desktop
```

The plugin will be auto-approved in dev mode — no permission dialog.

### Running tests

```sh
node test.js
```

Tests use the `@open-pets/plugin-sdk/testing` harness (falls back to the local
monorepo build if the package isn't installed).

## File layout

```
openpets.walkabout/
├── openpets.plugin.json   Manifest (v3)
├── index.js               Plugin entry — three mode implementations
├── test.js                Unit + lifecycle tests
├── package.json           Dev dependency declaration
├── locales/
│   └── en.json            English strings
└── README.md              This file
```
