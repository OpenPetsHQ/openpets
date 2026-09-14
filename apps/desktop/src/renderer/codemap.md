# apps/desktop/src/renderer/

## Responsibility

Vite renderer workspace for the desktop React/Tailwind Control Center. It owns the packaged `index.html` entry and delegates UI implementation to `src/`, while Electron main-process code owns windows, IPC handlers, and service logic.

## Design

- Built as a sandboxed Electron renderer loaded by the singleton Control Center BrowserWindow.
- Uses `control-center-preload.cjs` as the only bridge to the main process; `ipcRenderer` is not exposed directly.
- Production output is emitted to `apps/desktop/dist/renderer/`; development can load a loopback-only Vite URL.
- Transparent pet windows and plugin JavaScript host windows are separate lightweight renderers and do not live here.

## Key Files

- `index.html`: Vite HTML entry mounting the React app.
- `src/main.tsx`: Route shell and pages for Dashboard, Pets, Settings, Plugins, Integrations, and Teams.
- `src/styles.css`: Tailwind directives plus Control Center component styling.
