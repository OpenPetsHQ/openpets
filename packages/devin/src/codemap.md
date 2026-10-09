# Source: packages/devin/src

## Files

- **index.ts**: Public barrel for the MCP, hook config, hook mapping, and
  config-write APIs.
- **devin-config-file.ts**: Shared safe JSONC read/edit/plan/publish
  transaction for every Devin file OpenPets touches.
- **devin-mcp.ts**: Pure MCP entry builder, pet/semver/Node.js validation,
  command modes, and config directory/path resolution.
- **devin-status.ts**: MCP managed-entry detection, status classification, and
  install/replace/remove planning.
- **devin-hook-events.ts**: Pure Devin CLI / Devin Desktop hook payload →
  reaction mapping and the subscribed event lists.
- **devin-hooks.ts**: Hook command builder, hook file paths, per-product hook
  formats, status classification, and install/remove planning.
- **check-devin.ts**: Contract validation for the public behavior and safety
  boundaries; excluded from the implementation flow below.

## Module Dependencies

```
devin-config-file.ts (jsonc-parser + node fs/path)   devin-mcp.ts (pure)   devin-hook-events.ts (pure)
        ↓                                                 ↓                        ↓
devin-status.ts  ← devin-config-file + devin-mcp
devin-hooks.ts   ← devin-config-file + devin-mcp + devin-hook-events
        ↓
index.ts re-exports the public APIs
```

## Public API Groups

- MCP: `buildDevinMcpEntry()`, `getDevinConfigDir()`,
  `getDevinGlobalMcpConfigPath()`, `readDevinMcpConfig()`,
  `classifyDevinMcpStatus()`, `isManagedOpenPetsMcpEntry()`,
  `planDevinMcpInstall()` / `planDevinMcpReplace()` / `planDevinMcpRemove()`.
- Hooks: `buildDevinHookCommand()`, `getDevinCliConfigPath()`,
  `getDevinDesktopHooksPath()`, `readDevinHooksFile()`, `classifyDevinHooks()`,
  `planDevinHooksInstall()` / `planDevinHooksRemove()`, `mapDevinHookPayload()`.
- Writes: `executeDevinConfigWrite()`.
