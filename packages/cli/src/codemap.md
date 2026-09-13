# packages/cli/src/

TypeScript source files for the OpenPets CLI.

## Files

### index.ts

Main CLI entry point. Command routing, argument parsing, project configuration, plugin scaffolding/validation command dispatch, and all CLI operations.

**Commands:**
- `install <pet-id>` - Install pet via running desktop app
- `configure` - Interactive project setup for Claude, OpenCode, or Cursor, plus global Zed MCP setup
- `status` - Check OpenPets desktop app connectivity
- `pets` - List installed pets
- `react <reaction>` - Send reaction to desktop app
- `say <message> [--reaction <reaction>]` - Display message on pet
- `mcp [--pet <id>]` - Spawn MCP server wrapper
- `hook` - Execute Claude hook from stdin
- `plugin validate <dir>` - Validate a local plugin manifest/package boundary
- `plugin new <name> --template <blank|reminder|ambient|ai-chat|tamagotchi|calendar>` - Scaffold an SDK v3 plugin package

**Configuration Flow:**
- `configureProject()` - Main entry for project setup
- `configureCursorProject()` - Cursor MCP + rules configuration
- `configureOpenCodeProject()` - OpenCode config setup
- `configureZedGlobal()` - Zed global JSONC settings setup
- Claude: Hook settings + MCP via `claude mcp add-json`

**Safety Checks:**
- `resolveProjectDir()` - Symlink/escape validation
- `assertSafeProjectHookPath()` - `.claude` directory safety
- `assertClaudeAvailable()` - Claude CLI presence check
- Atomic file writes with temp + rename pattern

**Exports:**
- `cliPackageName` - Package identifier constant
- `configureProject()`, `resolveConfiguredPet()` - Programmatic API
- `parseConfigureArgs()`, `parseInstallArgs()`, `parseReactArgs()`, `parseSayArgs()` and plugin command parsers - Argument parsers
- `createVersionPinnedCliCommand()`, `createLocalDevCliCommand()` - Command builders
- `installProjectLocalHooks()`, `prepareProjectLocalHooks()` - Hook installation
- `runClaudeMcpAddJson()`, `createClaudeMcpAddJsonArgs()` - MCP integration

### plugin-templates.ts

SDK v3 plugin scaffolding templates for `openpets plugin new`.

**Template responsibilities:**
- Defines `PluginTemplateName`, `pluginTemplateNames`, and template content generators.
- Emits manifestVersion 3 plugin folders with `index.js`, `test.js`, README content, and optional `locales/en.json`.
- Covers `blank`, `reminder`, `ambient`, `ai-chat`, `tamagotchi`, and `calendar` patterns using the published SDK/test harness.
- Demonstrates current plugin APIs: localized `$t:` manifest refs, `ctx.t`, `ctx.ui.alert`, dynamic menu items, schedule reconciliation, storage, events, AI, and virtual-pet HUD/state loops.

### plugin-validate.ts

Author-time plugin folder validator for `openpets plugin validate <dir>`.

**Validation responsibilities:**
- Reads `openpets.plugin.json` and validates manifestVersion 1/2/3 boundaries.
- Enforces reverse-DNS ids, semver versions, JavaScript entry paths, SDK version compatibility, duplicate permissions, and v3 permission names.
- Validates config schema fields, including v3 `date`, `secret`, and `sound` field types.
- Checks exact network hosts, declared assets (`icons`, `images`, `svgs`, `sprites`, `sounds`), allowed extensions, size caps, panels, and safe relative file paths.
- Mirrors desktop install-time validation while keeping the desktop runtime authoritative.

### check-cli-contract.ts

Contract validation and integration checks. Runtime assertions for CLI behavior.

**Test Coverage:**
- Argument parsing validation for all commands
- Command builder output verification
- Pet resolution (explicit vs interactive)
- Project hook installation and updates
- Claude MCP integration (mocked)
- OpenCode project configuration scenarios
- Cursor project configuration (MCP + rules)
- Zed global configuration (JSONC MCP settings)
- Error handling and edge cases

**Safety Tests:**
- Symlink detection and rejection
- Path traversal prevention
- Settings file atomic writes
- Backup creation verification

**Integration Tests:**
- OpenCode: Top-level vs `.opencode/` config precedence
- OpenCode: Existing config preservation
- OpenCode: Custom MCP conflict detection
- Cursor: MCP config installation
- Cursor: Rules-only and remove-rules modes
- Cursor: Conflict detection with --force
- Plugin command parser, template scaffolding, and plugin validator boundary checks
