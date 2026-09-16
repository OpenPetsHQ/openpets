# packages/opencode/src/

## Files

- **index.ts**: Barrel export. Re-exports all public modules including path-safety helpers.
- **plugin.ts**: OpenCode plugin definition (10 lines). Default export with `id` and `server` factory.
- **opencode-plugin-runtime.ts**: Plugin hook implementations (229 lines). `createOpenPetsOpenCodeHooks()`, event classification, tool reaction mapping, lease management, throttling.
- **opencode-config.ts**: Config file management. Path resolution, JSONC parsing, safe file operations, atomic writes with backups, actionable symlink/parent diagnostics.
- **opencode-path-safety.ts**: Shared safety message builders. Symlink target display plus config/instruction/parent/directory error formatters naming paths and remediation.
- **opencode-project-setup.ts**: Project-level setup. `prepareOpenCodeProjectSetup()`, `writePreparedOpenCodeProjectSetup()`, instruction block management with path-aware safety errors.
- **opencode-global-setup.ts**: Global setup management. `prepareOpenCodeGlobalSetup()`, `prepareOpenCodeGlobalRemove()`, cleanup writes, doctor command, config precedence handling, global state classification with actionable safety errors.
- **opencode-status.ts**: Status classification (147 lines). `classifyOpenCodeMcpStatus()`, `classifyOpenCodeInstructionsStatus()`, `classifyOpenCodePluginStatus()`, managed MCP/plugin/instruction detection helpers, OpenPets-like entry detection.
- **opencode-previews.ts**: Config entry builders (55 lines). `buildOpenCodeMcpEntry()`, `buildOpenCodePluginPreview()`, `buildOpenCodeInstructionPath()`, `formatOpenCodeMcpConfig()`, `validateOpenPetsPetArg()`.
- **check-opencode-foundation.ts**: Contract validation (excluded from detailed documentation).
- **check-opencode-plugin.ts**: Plugin contract validation (excluded from detailed documentation).
