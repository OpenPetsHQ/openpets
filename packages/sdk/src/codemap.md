# packages/sdk/src/

## Responsibility

Source for the published plugin SDK v3 type surface and test harness.

## Design/Patterns

- **Public Contract Module**: `index.ts` defines permissions, manifest-adjacent types, `OpenPetsContext`, namespace APIs, descriptor shapes, handles, and the ambient `OpenPetsPlugin` global.
- **Mock Runtime Module**: `testing.ts` builds a deterministic fake SDK runtime with fake time, permission checks, event injection, mutable default/pinned/plugin pet listings, storage/config subscriptions, command execution, bubble actions, and recorded host effects.
- **Contract Check**: `check-plugin-sdk.ts` compiles/runs a representative plugin against the test harness to detect SDK/test-kit drift.

## Data & Control Flow

1. Plugin source references `/// <reference types="@open-pets/plugin-sdk" />` or imports exported types from `index.ts`.
2. Plugin tests import `createTestHarness` from `testing.ts` and pass the plugin's `register` function.
3. The harness creates a mock `ctx`, starts the plugin, then exposes helpers such as `clock.advance`, `emit`, `runCommand`, `fireBubbleAction`, and assertion helpers (`expectSpoke`, `expectBubble`, `expectScheduled`, etc.).
4. Desktop implementation changes should update `index.ts`, `testing.ts`, and bridge conformance checks together.

## Integration Points

- **Desktop bridge**: Mirrors `apps/desktop/src/plugin-sdk-bridge.ts` plus namespace modules.
- **CLI scaffolding**: Consumed by plugin templates generated from `packages/cli/src/plugin-templates.ts`.
- **Official plugins**: Used by `plugins/official/*/test.js`.

## Files

- `index.ts`: Published SDK v3 contract for permissions, assets, bubbles/alerts, panels, audio, events/drop, pets/motion, schedules, storage, config, network/streaming, notifications, AI, secrets, voice, auth, files, system, commands, status, i18n, logging, and plugin registration.
- `testing.ts`: Deterministic mock context, fake clock, event/config/storage/bus subscriptions, network/AI/files/auth/voice/system mocks, panel messaging, command runner, and recorded effect assertions.
- `check-plugin-sdk.ts`: Runtime/compile contract check for the SDK mock context.
