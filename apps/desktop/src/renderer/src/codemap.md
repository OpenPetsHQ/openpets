# apps/desktop/src/renderer/src/

## Responsibility

React/Tailwind source for the Control Center management UI. This renderer presents dashboard status, pet management, coding-agent integrations, plugin management, Teams management, and settings using narrow preload APIs backed by `windows.ts` IPC handlers and desktop services.

## Design

- **Route Shell**: In-renderer route state supports `dashboard`, `pets`, `assistant`, `settings`, `plugins`, `integrations`, and `teams`; tray actions retarget the singleton window through route-change events. Pet Assistant chat is hosted directly inside the default pet carrier window as an attached expandable panel, not inside Control Center.
- **Teams**: Modularized under `teams/` to manage organization membership, synchronization, and security controls while strictly isolating personal content:
  - `teams/TeamsView.tsx`: Top-level container component orchestrating snapshot retrieval, synchronization, permission approval actions, optional plugin enable/disable toggling, error banner/toast presentation, and child section rendering.
  - `teams/TeamEnrollmentSection.tsx`: Presentational view for deep-link invitation enrollment (device display name entry), authoritative preview/expiry gating for acceptance, and un-enrolled onboarding guides with personal isolation assurances.
  - `teams/TeamOverviewSection.tsx`: Organization status banner with applied/pending revisions, manual synchronization trigger, leave action trigger, metadata overview, and pending-approval alert banners.
  - `teams/TeamPetsSection.tsx`: Displays organization-managed companion pets with installed sprite thumbnails and team-managed badges.
  - `teams/TeamPluginsSection.tsx`: Lists organization-provisioned plugins with approval counters and status summaries.
  - `teams/TeamPluginCard.tsx`: Detailed plugin card rendering required/optional policy badges, explicit permission approval workflows (`Approve & Activate` for required vs `Approve Permissions` for optional), actionable enable/disable controls for approved optional plugins, sensitive capability disclosures, and allowed network destinations.
  - `teams/TeamLeaveModal.tsx`: Confirmation modal clarifying the removal of organization assets while guaranteeing personal content safety.
  - `teams/teams-icons.tsx`: Cohesive set of 2px-stroke SVG icons matching Control Center design conventions.
  - `teams/teams-types.ts`: Strong typing for snapshots, pet/plugin entries, approval tokens, and preload bridge API contracts.
  - `teams/teams-state.ts`: Pure state helpers for snapshot validation, display name validation, authoritative enrollment-action gating, error code mapping, and permission tone/label lookup.
  - `teams/manager-check-ins/TeamManagerCheckInSection.tsx`: Control Center Manager Check-ins management section for synchronization, read-only immutable history, and device-private scheduled-offer pause/resume; it intentionally has no submission form.
  - `teams/manager-check-ins/ManagerCheckInHistoryList.tsx`: Read-only employee history timeline with fixed-feeling presentation and pagination.
  - `teams/manager-check-ins/ManagerCheckInPauseControls.tsx`: Local scheduled-offer pause/resume controls whose state is not organization-visible.
  - `teams/manager-check-ins/manager-check-ins-state.ts`: Pure renderer helpers for fixed feelings, bounded display state, labels, dates, and history presentation.
- **Dashboard**: Reads a narrowed dashboard snapshot for default pet preview, install/catalog counts, plugin health, update status, and activity totals.
- **Pets**: Combines installed pets, catalog v3 pages/search, Codex imports, filters, detail panes, set-default/install/import/remove actions, and version-aware V1/V2 sprite previews, including the static V2 neutral cell.
- **Integrations**: Modularized under `integrations/` for developer-tool setup and provider-account management, including command mode/path controls and preview/action flows:
  - `integrations/IntegrationsView.tsx`: Top-level orchestrator with nested Developer integrations / Connected Apps navigation; the existing agent setup screen remains intact.
  - `integrations/ConnectedAppsView.tsx`: Google/Outlook account states, per-plugin read-only calendar consent, reconnect/disconnect confirmation, and explicit OAuth identity-verification blocker.
  - `integrations/connected-apps-state.ts`: Pure connection-state labels, tones, actions, and safe disconnect eligibility.
  - `integrations/IntegrationIcon.tsx`: Brand and tool iconography supporting Claude, OpenCode, Cursor, Pi, VS Code, Windsurf, and Zed, with a consistent SVG fallback glyph.
  - `integrations/PathField.tsx`: Dedicated executable path input with dirty tracking and inline save action.
  - `integrations/types.ts`: TypeScript contracts for agent setup actions, snapshots, command paths, status descriptors, and integration preload bridge APIs.
  - `integrations/icons.tsx`: Dedicated SVG icons matching Control Center design conventions for install, replace, remove, refresh, hook, memory, and configure actions.
  - `integrations/index.ts`: Module entry.
- **Plugins**: Gallery-first plugin hub for installed/catalog/local/broken filters, catalog refresh, local load, install/update/uninstall, enable/disable, config modal, command execution, runtime/status display, and broken-state feedback.
- **Assistant**: Top-level route owning the Pet Assistant feature surfaces — chat/talk button and shortcut preferences, personality authoring, conversation archive management, and model/speech provider profiles (Pet Brain text & reasoning, Hearing STT, Speech TTS) with realtime status. Deep links target it via `assistantTab` (currently `providers`).
- **Settings**: Startup, launch-at-login, pet scale, persisted idle cursor-gaze toggle, voice devices hardware routing, reaction-animation mapping, host capability gates, update check, default-pet position reset, and pet reaction previews.
- **General Settings**: Modularized under `settings/general/` for host-wide hardware preferences:
  - `settings/general/VoiceDevicesSection.tsx`: Hardware audio device routing controls for microphone input and speaker output with truthful disconnected-fallback badges, capability gating, and refresh trigger.
  - `settings/general/types.ts`: TypeScript contracts for voice device descriptions, resolutions, and snapshots.
  - `settings/general/icons.tsx`: Dedicated SVG icons for audio devices and actions.
  - `settings/general/index.ts`: Module entry.
- **Conversation Archive Settings**: Modularized under `settings/history/` to provide Settings-owned management of the local persisted conversation history:
  - `settings/history/ConversationArchiveSection.tsx`: Settings-owned archive management view with privacy boundary notice, search filter, message list, turn metadata, single-entry delete, clear-all confirmation modal, and immediate state refresh.
  - `settings/history/types.ts`: Archive message models and bridge API contracts.
  - `settings/history/index.ts`: Module entry.
- **Provider Settings**: Modularized under `settings/providers/` to present a role-first overview with compact saved profile cards and guided configuration modal:
  - `settings/providers/ProvidersSection.tsx`: Top-level orchestrator connecting provider role cards, compact library, guided setup modal, and capability gates.
  - `settings/providers/ProviderRoleOverview.tsx`: Role-first status cards for Pet Brain (Text), Hearing (STT), Speech (TTS), and derived Realtime voice, including adapter-aware model/voice and readiness details.
  - `settings/providers/ProviderLibrary.tsx`: Configured profile library cards showing active role pills, endpoint details, credential-policy status, persisted TTS voice, inline credential updates, and role activation toggles.
   - `settings/providers/ProviderModal.tsx`: Guided setup modal featuring the canonical preset catalog, adapter-specific model/voice controls, inline credential entry, static request headers, role activation checkboxes, and non-persisting adapter-specific setup tests.
  - `settings/providers/ModelControls.tsx`: Separate normal-text and realtime model fields for OpenAI Realtime profiles.
  - `settings/providers/VoiceControl.tsx`: Curated/custom voice selection for network TTS profiles and system-default voice presentation.
  - `settings/providers/AdvancedConnectionSettings.tsx`: Host-applied custom auth and redacted-header editing controls; opaque credential references are not exposed.
  - `settings/providers/ProviderGatesSection.tsx`: Host capability toggles for audio playback, dynamic speech, voice output, microphone capture, and quiet hours.
  - `settings/providers/presets.ts`: Renderer adapter for the canonical snapshot preset catalog, with a fallback for unavailable snapshots.
  - `settings/providers/types.ts`: TypeScript contracts for provider adapters, roles, snapshots, inputs, and form draft states.
  - `settings/providers/icons.tsx`: Custom SVG icons for provider roles and UI actions.
- **Bridge Contract**: All Control Center data and actions go through `window.openPetsControlCenter`; page snapshots intentionally omit raw install paths and unrelated app state. Manager Check-ins uses this bridge for sync, immutable history, and device-private pause/resume only; explicit submission is owned by the pet preload/card and its host service.

## Key Files

- `main.tsx`: Existing route shell and management pages for Dashboard, Pets, Plugins, Integrations, Teams, and Settings.
- `teams/manager-check-ins/`: Control Center's read-only Manager Check-ins management lane. The private weekly action circle and five-feeling submission card live in the default pet renderer (`pet-preload.cjs`), outside this Control Center bundle.
- `pet-preview-state.ts`: Pure 8×9/8×11 preview model that preserves V1 frame animation, selects V2's neutral frame, and resolves catalog V2 sprite metadata.
- `styles.css`: Tailwind base/components/utilities plus glass-card layout, navigation, galleries, modals, status pills, previews, and notifications.
- `vite-env.d.ts`: Vite/TypeScript renderer environment declarations.
