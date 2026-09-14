# apps/desktop/src/renderer/src/

## Responsibility

React/Tailwind source for the Control Center management UI. This renderer presents dashboard status, pet management, coding-agent integrations, plugin management, and settings using narrow preload APIs backed by `windows.ts` IPC handlers and desktop services.

## Design

- **Route Shell**: In-renderer route state supports `dashboard`, `conversation`, `pets`, `settings`, `plugins`, `integrations`, and `teams`; tray actions retarget the singleton window through route-change events.
- **Teams**: Modularized under `teams/` to manage organization membership, synchronization, and security controls while strictly isolating personal content:
  - `teams/TeamsView.tsx`: Top-level container component orchestrating snapshot retrieval, synchronization, permission approval actions, optional plugin enable/disable toggling, error banner/toast presentation, and child section rendering.
  - `teams/TeamEnrollmentSection.tsx`: Presentational view for deep-link invitation enrollment (device display name entry) and un-enrolled onboarding guides with personal isolation assurances.
  - `teams/TeamOverviewSection.tsx`: Organization status banner with applied/pending revisions, manual synchronization trigger, leave action trigger, metadata overview, and pending-approval alert banners.
  - `teams/TeamPetsSection.tsx`: Displays organization-managed companion pets with installed sprite thumbnails and team-managed badges.
  - `teams/TeamPluginsSection.tsx`: Lists organization-provisioned plugins with approval counters and status summaries.
  - `teams/TeamPluginCard.tsx`: Detailed plugin card rendering required/optional policy badges, explicit permission approval workflows (`Approve & Activate` for required vs `Approve Permissions` for optional), actionable enable/disable controls for approved optional plugins, sensitive capability disclosures, and allowed network destinations.
  - `teams/TeamLeaveModal.tsx`: Confirmation modal clarifying the removal of organization assets while guaranteeing personal content safety.
  - `teams/teams-icons.tsx`: Cohesive set of 2px-stroke SVG icons matching Control Center design conventions.
  - `teams/teams-types.ts`: Strong typing for snapshots, pet/plugin entries, approval tokens, and preload bridge API contracts.
  - `teams/teams-state.ts`: Pure state helpers for snapshot validation, display name validation, error code mapping, and permission tone/label lookup.
- **Conversation**: `conversation/ConversationView.tsx` renders the active typed/Talk session plus a separate Local history panel for opening archived messages, returning to the active session, deleting one message, and clearing the archive. `conversation-state.ts` validates live snapshots/events; `history-state.ts` validates and updates archived history without mutating the active session.
- **Dashboard**: Reads a narrowed dashboard snapshot for default pet preview, install/catalog counts, plugin health, update status, and activity totals.
- **Pets**: Combines installed pets, catalog v3 pages/search, Codex imports, filters, detail panes, set-default/install/import/remove actions, and version-aware V1/V2 sprite previews, including the static V2 neutral cell.
- **Integrations**: Card-first setup UI for Claude Code, OpenCode, Cursor, Zed, Pi guidance, and OpenClaw native-plugin setup, including command mode/path controls and preview/action flows.
- **Plugins**: Gallery-first plugin hub for installed/catalog/local/broken filters, catalog refresh, local load, install/update/uninstall, enable/disable, config modal, command execution, runtime/status display, and broken-state feedback.
- **Settings**: Startup, launch-at-login, pet scale, host Pet Assistant personality, reaction-animation mapping, model and speech provider profiles (Text & reasoning, STT, TTS), realtime status, host capability gates, update check, default-pet position reset, and pet reaction previews.
- **Bridge Contract**: All data and actions go through `window.openPetsControlCenter`; page snapshots intentionally omit raw install paths and unrelated app state.

## Key Files

- `main.tsx`: Existing route shell and management pages; Conversation is kept in focused files under `conversation/` and receives the narrow history bridge through the Control Center API type.
- `pet-preview-state.ts`: Pure 8×9/8×11 preview model that preserves V1 frame animation and selects V2's neutral frame.
- `conversation/history-state.ts`: Renderer validation and immutable list updates for local archived messages.
- `styles.css`: Tailwind base/components/utilities plus glass-card layout, navigation, galleries, modals, status pills, previews, and notifications.
- `vite-env.d.ts`: Vite/TypeScript renderer environment declarations.
