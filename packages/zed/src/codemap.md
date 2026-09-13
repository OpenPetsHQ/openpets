# Source: packages/zed/src

## Files

- **index.ts**: Public barrel that re-exports the Zed MCP and status APIs.
- **zed-mcp.ts**: Pure entry builders, semver/pet validation, command modes, and
  platform-specific global settings path resolution.
- **zed-status.ts**: JSONC parsing/editing, managed-entry detection, status
  classification, install/replace/remove planning, path safety, backup, and
  atomic write execution.
- **check-zed.ts**: Contract validation for the public behavior and safety
  boundaries; excluded from the implementation flow below.

## Module Dependencies

```
zed-mcp.ts (pure helpers)
    ↓
zed-status.ts imports zed-mcp.ts + jsonc-parser + node fs/path APIs
    ↓
index.ts re-exports both modules
check-zed.ts imports the public APIs for contract validation
```

## Public API Groups

### `zed-mcp.ts`

- `buildZedMcpEntry()` and `formatZedMcpConfig()` build managed entries.
- `validateOpenPetsPetId()`, `isValidPetId()`,
  `validateOpenPetsPackageVersion()`, and
  `isValidOpenPetsPackageVersion()` validate command inputs.
- `getZedGlobalSettingsDir()` and `getZedGlobalSettingsPath()` resolve global
  settings locations for macOS, Linux/FreeBSD, and Windows.

### `zed-status.ts`

- `parseZedSettings()` and `updateZedSettingsText()` handle JSONC.
- `readZedSettings()` and `classifyZedMcpStatus()` expose safe read/status
  behavior.
- `planZedMcpInstall()`, `planZedMcpReplace()`, and `planZedMcpRemove()` create
  mutation plans.
- `executeZedMcpWrite()` applies validated plans atomically.
- `isManagedOpenPetsMcpEntry()` identifies recognized published or standard
  local OpenPets command shapes.

## Safety Invariants

- No mutation is planned for parse, schema, size, symlink, unsafe-path, or I/O
  failures.
- Existing settings are never overwritten without a verified hard-link backup;
  claim and withdrawal artifacts preserve the original or a replacement during
  publication.
- Interrupted writes recover from the journal on the next write; the live
  target may be absent briefly during withdrawal, and ambiguous or unsafe
  recovery artifacts fail closed.
- Only `context_servers.openpets` is changed or removed.
- Disabled entries require an explicit replace operation before re-enabling.
- User-controlled `env`, `timeout`, and enabled fields are retained for
  recognized managed entries; unsupported `remote` execution is stripped during
  correction.
