# Source: packages/devin/src

## Files

- **index.ts**: Public barrel that re-exports the Devin MCP and status APIs.
- **devin-mcp.ts**: Pure entry builder, pet/semver/Node.js command validation,
  command modes, and platform-specific config path resolution.
- **devin-status.ts**: JSONC parsing/editing, managed-entry detection, status
  classification, install/replace/remove planning, path safety, backup, and
  atomic write execution with a stale-source check.
- **check-devin.ts**: Contract validation for the public behavior and safety
  boundaries; excluded from the implementation flow below.

## Module Dependencies

```
devin-mcp.ts (pure helpers)
    ↓
devin-status.ts imports devin-mcp.ts + jsonc-parser + node fs/path APIs
    ↓
index.ts re-exports both modules
check-devin.ts imports the public APIs for contract validation
```

## Public API Groups

### `devin-mcp.ts`

- `buildDevinMcpEntry()` builds the managed entry.
- `getDevinConfigDir()` and `getDevinGlobalMcpConfigPath()` resolve the shared
  user-scope location.
- `isValidPetId()`, `validateOpenPetsPetId()`, `isValidOpenPetsPackageVersion()`,
  `isValidDevinNodeCommand()`, and `isValidOpenPetsMcpScriptPath()` validate
  command inputs.

### `devin-status.ts`

- `readDevinMcpConfig()` and `classifyDevinMcpStatus()` expose safe read/status
  behavior.
- `isManagedOpenPetsMcpEntry()` recognizes OpenPets-written entries.
- `planDevinMcpInstall()`, `planDevinMcpReplace()`, and `planDevinMcpRemove()`
  plan targeted edits; `executeDevinMcpWrite()` publishes them.
