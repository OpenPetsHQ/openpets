# Package: @open-pets/devin

## Responsibility

Pure Node.js package that manages the OpenPets MCP server entry in Devin's
user-scope MCP config. Devin Desktop (the editor formerly called Windsurf) and
the Devin CLI read the same file, so one managed `mcpServers.openpets` entry
connects both. Configuration-only: Devin launches the OpenPets MCP server, which
makes the runtime IPC connection.

## Design/Patterns

- **Config path**: `$XDG_CONFIG_HOME/devin/mcp_config.json` (default
  `~/.config/devin/mcp_config.json`) on macOS/Linux, and
  `%APPDATA%\devin\mcp_config.json` on Windows. Project `.devin/` files and the
  legacy `~/.codeium/windsurf/mcp_config.json` are not managed.
- **Entry shape**: Devin stdio schema, `{ command, args }` with no `type`;
  published mode pins `npx -y @open-pets/mcp@VERSION`, local/bundled modes run
  the OpenPets MCP entry script with a validated Node.js command.
- **JSONC-preserving edits**: `jsonc-parser` targeted edits keep comments,
  trailing commas, unrelated servers, and top-level settings.
- **Safe writes**: 256 KiB cap, symlink/non-regular/traversal rejection on the
  file and every parent, byte-for-byte backup, exclusive temp file + atomic
  rename, and a stale-source check that refuses to publish if the file changed
  after planning.
- **Status**: `missing`, `installed`, `disabled` (managed entry with
  `"disabled": true`; only replace re-enables it), `needs-update`, `conflict`
  (unmanaged `openpets` server; replace only, never removed), `invalid`, `error`.

## Flow

1. Resolve the path with `getDevinGlobalMcpConfigPath()`.
2. `readDevinMcpConfig()` → `classifyDevinMcpStatus()` for UI/CLI state.
3. `planDevinMcpInstall()` / `planDevinMcpReplace()` / `planDevinMcpRemove()`.
4. `executeDevinMcpWrite()` publishes the plan.

## Integration

- **Consumers**: `apps/desktop/src/agent-setup-devin.ts` (Control Center) and
  `packages/cli` (`openpets configure --agent devin`).
- **Dependencies**: `jsonc-parser`.
- **Checks**: `src/check-devin.ts` (`pnpm --filter @open-pets/devin check`).

See [src/codemap.md](src/codemap.md) for module details.
