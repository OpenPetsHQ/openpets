# apps/

## Responsibility

Container for application packages selected by the pnpm workspace `apps/*` glob: the Electron desktop app and a standalone VS Code extension foundation. The extension is a preview shell, not the full released product.

## Design Patterns

- **Workspace App Boundary**: `pnpm-workspace.yaml` includes `apps/*`, so each app directory is an independently buildable workspace package.
- **Workspace Dependencies**: apps consume shared `packages/` modules through `workspace:*` dependencies.
- **Electron-First Architecture**: the desktop app uses an Electron main process, tray-centric UX, and isolated renderer windows rather than a traditional main window.
- **Service-Oriented Desktop Modules**: desktop features are split into main-process services for state, IPC, pet controllers, catalog installation, setup flows, and plugin management/runtime.
- **Independent VS Code UI Host**: the extension owns its local preferences, companion service and sidebar/editor webviews rather than requiring the desktop app or its IPC server.
- **Security-First Renderers**: CSP headers, sandboxed renderers, context isolation, and disabled `nodeIntegration` protect UI surfaces including plugin-related windows.

## Data & Control Flow

1. Workspace tooling discovers application packages via the `apps/*` pnpm workspace glob.
2. The desktop app bootstraps from `apps/desktop/src/main.ts`, initializes user data and app state, then creates tray and renderer windows.
3. Agent commands flow through the local IPC server into lease-managed pet controllers and window updates.
4. Pet assets flow from built-in assets, local development sources, or downloaded catalog packages into installation/state services and renderer windows.
5. Desktop plugin manifests/configuration flow through plugin loader, package, catalog, state, service, and runtime modules before exposing controlled pet APIs and plugin UI.
6. The VS Code foundation activates in the local UI host and renders its bundled pet; catalog, installation and wardrobe installation are not yet available.

## Integration Points

- **Workspace packages**: consumes `@open-pets/agent-events`, `@open-pets/claude`, `@open-pets/cli`, `@open-pets/cursor`, `@open-pets/mcp`, `@open-pets/opencode`, and IPC/client-facing shared APIs.
- **Desktop submodules**: `apps/desktop/src/` provides lifecycle, state, tray/windows, setup integrations, pet installation, local IPC, and plugin runtime services.
- **Shared pet contracts**: `@open-pets/pet-format` supplies host-neutral pet rules and separate Node package-validation policy.
- **External services**: GitHub Releases API for update checks, `openpets.dev` for catalog data, and `zip.openpets.dev` for pet downloads.
- **System surfaces**: Claude Code CLI, OpenCode CLI, OS tray/dock, renderer windows, and filesystem locations such as `userData`, `~/.codex`, and `~/.claude`.
