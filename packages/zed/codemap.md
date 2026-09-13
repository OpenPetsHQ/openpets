# Package: @open-pets/zed

## Responsibility

Pure Node.js package for managing the OpenPets MCP entry in Zed's global
`settings.json`. It builds published, local, and bundled stdio entries,
classifies installation state, preserves JSONC settings, and performs safe
atomic writes. The desktop Control Center and CLI compose it for global settings
management; it does not provide runtime hooks or use IPC itself.

## Design/Patterns

### Global Settings Path

- **macOS**: `~/.config/zed/settings.json`
- **Linux/FreeBSD**: `$FLATPAK_XDG_CONFIG_HOME/zed/settings.json`, then
  `$XDG_CONFIG_HOME/zed/settings.json`, then `~/.config/zed/settings.json`
- **Windows**: `%APPDATA%\Zed\settings.json`
- All operations accept an explicit settings path for tests and callers that
  need a controlled location.

### MCP Entry Modes

- **Published**: `npx -y @open-pets/mcp@VERSION [--pet PET_ID]`
- **Local/Bundled**: `node ABSOLUTE_MCP_ENTRY [--pet PET_ID]` (or a validated
  configured Node.js command)
- Published versions and pet IDs are validated before they become arguments.

### Status and Safety

- Statuses: `missing`, `installed`, `disabled`, `needs-update`, `conflict`,
  `invalid`, and `error`.
- JSONC comments, trailing commas, unrelated top-level settings, and other
  context servers survive targeted edits.
- Settings are capped at 256 KiB; symlinks, unsafe paths, non-regular files,
  malformed JSONC, and invalid schemas are rejected.
- Existing files receive an exclusive hard-link backup after a fresh source
  check; the original is held at a journaled claim path while the prepared temp
  file is hard-linked into place without replacing a target that appeared during
  the operation. A journaled withdrawal path preserves a replacement that
  arrives while the target is being moved. The backup keeps the original inode
  recoverable while a pre-existing descriptor is still open. A sibling lock
  serializes OpenPets writers, interrupted claims are recovered from the journal,
  and execution aborts if settings content or existence changed after planning.
  Write support paths are restricted to the settings directory.
- Managed `enabled`, `env`, and `timeout` fields are preserved during updates;
  unsupported `remote` execution is stripped during correction. A disabled
  managed entry is not silently re-enabled by install; replace is the explicit
  re-enable operation.

## Flow

### Install/Update

1. Read and validate the target settings file with `readZedSettings()`.
2. Classify `context_servers.openpets` with `classifyZedMcpStatus()`.
3. Build a plan with `planZedMcpInstall()` or `planZedMcpReplace()`.
4. Apply the JSONC edit only at `context_servers.openpets`.
5. Execute the journaled backup + atomic write with `executeZedMcpWrite()`.

### Removal

1. Read and classify the existing entry.
2. Refuse removal for missing, invalid, error, or conflicting entries.
3. Remove only `context_servers.openpets` while preserving all other settings.

## Integration

### Entry Points

- `src/index.ts`: Public API barrel.
- `src/zed-mcp.ts`: Entry builders, input validation, and platform path helpers.
- `src/zed-status.ts`: JSONC parsing, status classification, planning, safety,
  backups, and atomic writes.
- `src/check-zed.ts`: Self-contained contract validation.

### Package Surface

- Package version: `3.5.0`.
- Main export: `dist/index.js` with declarations at `dist/index.d.ts`.
- Runtime dependency: `jsonc-parser`.
- Current consumers: `apps/desktop/src/agent-setup.ts` and
  `packages/cli/src/index.ts`.

### Validation

`check-zed.ts` covers path resolution, command construction, version and pet
validation, JSONC preservation, all status classes, disabled/conflict handling,
optional-field preservation, safe file boundaries, backups, atomic writes, and
targeted removal.
