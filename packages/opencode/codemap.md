# packages/opencode/

OpenCode editor integration for OpenPets.

## Responsibility

Provides comprehensive OpenCode editor integration including: MCP server configuration, plugin runtime with event hooks, project/global setup management/removal, and instruction file generation.

## Design

**Plugin Architecture** (`plugin.ts`):
- Default export: `{ id, server }` object
- Server factory: `createOpenPetsOpenCodeHooks(options)`
- Plugin ID: `open-pets-opencode`

**Plugin Runtime** (`opencode-plugin-runtime.ts`):
- Event hooks: `event`, `chat.message`, `tool.execute.before`, `tool.execute.after`
- Event classification: Maps OpenCode bus events to reactions/speech
- Tool classification: Edit → "editing", Bash test commands → "testing"
- Lease management: Acquires on first use, 2s buffer before expiry
- Throttling: 20s speech cooldown, 3s permission cooldown, 10s reaction cooldown
- Async scheduling via `queueMicrotask`

**Config Management** (`opencode-config.ts`):
- JSONC parsing with `jsonc-parser` (comments, trailing commas)
- Config path resolution (project: `.opencode/`, global: `~/.config/opencode/`)
- Safe file operations: atomic writes, backups, permission checks (0o600/0o700)
- Path traversal prevention (relative path validation)
- Symlink detection and rejection with actionable path/target diagnostics

**Path Safety** (`opencode-path-safety.ts`):
- Shared symlink/parent/escape message builders naming the offending path,
  resolved target when safely obtainable, non-modification, atomic-write
  rationale, and scope-aware remediation (global may suggest project-local
  setup; project suggests materializing and rerunning project setup)
- lstat-based existence helpers plus full-ancestor symlink rejection for
  global roots, used by project/global setup and config planning without
  leaking file contents

**Project Setup** (`opencode-project-setup.ts`):
- Status classification: `not_installed`, `installed`, `needs_update`, `custom`, `conflict`, `error`
- Managed block detection in instruction files (`<!-- OPENPETS:START/END -->`)
- Config field updates: `mcp`, `instructions`, `plugin` arrays
- Instruction file: `.opencode/openpets.md` with usage guidelines

**Global Setup** (`opencode-global-setup.ts`):
- Similar to project setup but for `~/.config/opencode/`
- Setup cleanup writes: Removes managed duplicate entries from other config files
- Remove support: `prepareOpenCodeGlobalRemove()` / `writePreparedOpenCodeGlobalRemove()` remove managed MCP, instruction, and plugin entries plus the managed instruction block
- Doctor command: `doctorOpenCodeGlobalSetup()` for status checking
- Config precedence handling: chooses the effective config file across `config.json`, `opencode.json`, and `opencode.jsonc`, preserving existing user arrays when safe

**Status Classification** (`opencode-status.ts`):
- MCP entry detection: `isManagedOpenPetsMcpEntry()`
- Plugin entry detection: `isManagedOpenPetsPluginEntry()`
- Command pattern matching (npx, node, local paths)
- Version comparison for update detection

**Previews** (`opencode-previews.ts`):
- MCP entry builder: `buildOpenCodeMcpEntry()` (published/local/bundled modes)
- Plugin spec builder: `buildOpenCodePluginPreview()`
- Instruction path builder: `buildOpenCodeInstructionPath()`
- Pet ID validation: `validateOpenPetsPetArg()`
- MCP config formatter: `formatOpenCodeMcpConfig()`

## Flow

```
prepareOpenCodeProjectSetup({ projectDir, petId, cliVersion })
    ↓
readExistingConfigs() → Parse all candidate config files
    ↓
classifyOpenCodeMcpStatus() → Check if installed/needs update/conflict
    ↓
classifyOpenCodeInstructionsStatus() → Check instruction file
    ↓
classifyOpenCodePluginStatus() → Check plugin array
    ↓
buildNextConfig() → Merge mcp/instructions/plugin updates
    ↓
planOpenCodeConfigWrite() → Atomic write plan with backup
    ↓
planInstructionWrite() → Upsert managed instruction block
    ↓
writePreparedOpenCodeProjectSetup() → Execute writes atomically
```

## Integration Points

**Dependencies**:
- `@open-pets/client` - IPC for plugin runtime
- `@open-pets/agent-events` - Speech pools and validation
- `jsonc-parser` - JSONC config parsing and editing

**Package Surface**:
- Package version: `2.1.1`
- Main export (`.`): setup, config, preview, status, and runtime APIs from `dist/index.js`
- Server export (`./server`): OpenCode plugin default export from `dist/plugin.js`

**Consumers**:
- `@open-pets/cli` - `configure` command for OpenCode projects plus
  `configure --agent opencode --global` and read-only `doctor` global diagnostics
- Desktop Control Center - global setup/remove preview through the same
  `getGlobalOpenCodeConfigDir()` location logic as the CLI

**Exports**:
- `plugin.ts` - Default plugin export for OpenCode
- `prepareOpenCodeProjectSetup()`, `writePreparedOpenCodeProjectSetup()`
- `prepareOpenCodeGlobalSetup()`, `writePreparedOpenCodeGlobalSetup()`
- `prepareOpenCodeGlobalRemove()`, `writePreparedOpenCodeGlobalRemove()`
- Config management utilities
