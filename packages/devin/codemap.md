# Package: @open-pets/devin

## Responsibility

Node.js package that manages OpenPets in Devin's user-scope configuration and
maps Devin hook payloads to pet reactions. Devin Desktop (the editor formerly
called Windsurf) and the Devin CLI read the same MCP config, so one managed
`mcpServers.openpets` entry connects both; their lifecycle hooks live in two
separate files that this package also manages.

## Design/Patterns

- **Paths**: MCP config `$XDG_CONFIG_HOME/devin/mcp_config.json` (default
  `~/.config/devin/mcp_config.json`; `%APPDATA%\devin\mcp_config.json` on
  Windows); Devin CLI hooks in the `hooks` key of the sibling `config.json`;
  Devin Desktop hooks in `~/.codeium/windsurf/hooks.json`. Project `.devin/`
  files and the legacy `~/.codeium/windsurf/mcp_config.json` are not managed.
- **MCP entry**: Devin stdio schema, `{ command, args }` with no `type`.
- **Hook command**: `openpets hook --openpets-managed --agent devin [--pet id]`
  via pinned `npx -y @open-pets/cli@VERSION` or Node.js + CLI entry script.
- **Shared file transaction** (`devin-config-file.ts`): JSONC parse with
  caller shape checks, targeted `jsonc-parser` edits, 256 KiB cap,
  symlink/non-regular/traversal rejection, byte-for-byte backup, exclusive
  temp file + atomic rename, and a stale-source check.
- **MCP status**: `missing`, `installed`, `disabled`, `needs-update`,
  `conflict`, `invalid`, `error`. **Hook status**: `missing`, `installed`,
  `needs-update`, `invalid`, `error`.
- **Payload mapping** is pure and reads only event/tool names and a bounded
  command slice (test detection); no prompt/code/output text.

## Flow

1. Resolve paths (`getDevinGlobalMcpConfigPath`, `getDevinCliConfigPath`,
   `getDevinDesktopHooksPath`).
2. Classify (`classifyDevinMcpStatus`, `classifyDevinHooks`).
3. Plan (`planDevinMcp*`, `planDevinHooksInstall` / `planDevinHooksRemove`).
4. Publish with `executeDevinConfigWrite()`.
5. At runtime the CLI's `hook --agent devin` calls `mapDevinHookPayload()`.

## Integration

- **Consumers**: `apps/desktop/src/agent-setup-devin.ts` (Control Center) and
  `packages/cli` (`openpets configure --agent devin`, `openpets hook --agent devin`).
- **Dependencies**: `jsonc-parser`.
- **Checks**: `src/check-devin.ts` (`pnpm --filter @open-pets/devin check`).

See [src/codemap.md](src/codemap.md) for module details.
