# packages/claude/

Claude Code integration for OpenPets.

## Responsibility

Provides Claude Code editor integration via MCP configuration and lifecycle hooks. Manages hook installation, event handling, and speech feedback during Claude Code sessions.

## Design

**CLI Entry** (`cli.ts`):
- Commands: `hook`, `doctor-hooks`, `install-hooks`, `uninstall-hooks`
- `--settings` path override, `--pet` targeting, `--project-local` flag
- Delegates to `hooks.ts` and `hook-settings.ts`

**Hook Execution** (`hooks.ts`):
- `runClaudeHookFromStdin()` - Main entry for Claude hook protocol
- Event mapping: `UserPromptSubmit` → thinking, `PermissionRequest` → waiting (question speech for `AskUserQuestion`, approval speech otherwise), `Stop` → success, `StopFailure` → error, `PreToolUse` → tool-specific
- Tool classification: Edit/Write/MultiEdit → "editing", Bash with test commands → "testing"
- Project-local detection: Checks `.claude/settings.local.json` for `--openpets-managed --project-local`
- Throttling: 20s speech, 3s permission/question, 10s reaction cooldowns via JSON state file
- Lease acquisition for targeted pets
- Error handling: Debug logging, graceful degradation

**Hook Settings Management** (`hook-settings.ts`):
- Settings path: `~/.claude/settings.json`
- Hook events: `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `Notification`, `Stop`, `StopFailure`
- Command entry: `{ type: "command", command, timeout: 3, async: true, asyncRewake: false }`
- Marker: `--openpets-managed` in command for identification
- Install modes: `published` (npx), `local` (node path), `bundled` (asar unpacked)
- Safety: Backup before write, atomic rename, permission checks
- Status: `not_installed`, `installed`, `needs_update`, `error`

**MCP Configuration** (`claude-code.ts`):
- MCP server name: `openpets`
- Command modes: `published` (npx -y @open-pets/mcp), `local`/`bundled` (node path)
- Claude CLI integration: `claude mcp add`, `claude mcp get`, `claude mcp remove`
- Output parsing: Handles both JSON and text formats from `claude mcp get`
- Path safety: Validates local/bundled paths are within expected directories
- Asar handling: `mapAsarPathToUnpacked()` for Electron apps

**Speech Messages** (`hook-messages.ts`):
- Re-exports from `@open-pets/agent-events`

## Flow

```
Claude Hook Event (stdin JSON)
    ↓
runClaudeHookFromStdin() → readLimitedStdin()
    ↓
parseHookPayload() → mapClaudeHookEvent()
    ↓
Decision: { reaction?, speechCategory? }
    ↓
hasProjectLocalOpenPetsHook() → Skip if project-local exists
    ↓
shouldSendSpeech() / shouldSendReaction() → Throttle check
    ↓
acquireHookLease() → Get leaseId for targeted pet
    ↓
client.say(message, { reaction, leaseId }) or client.react(reaction, { leaseId })
```

## Integration Points

**Dependencies**:
- `@open-pets/client` - IPC communication
- `@open-pets/agent-events` - Speech pools

**External Commands**:
- `claude` - Claude Code CLI for MCP and settings management

**Consumers**:
- `@open-pets/cli` - `configure` command for Claude projects

**Exports**:
- `claudePackageName` constant
- `runClaudeHookFromStdin()`, `handleClaudeHookPayload()`
- `installClaudeHooks()`, `uninstallClaudeHooks()`, `doctorClaudeHooks()`
- `buildClaudeMcpPreview()`, `parseClaudeMcpGetOutput()`, `classifyClaudeMcpStatus()`
- `validateOpenPetsPetArg()`, `openPetsHookMarker`, `claudeHookEvents`
