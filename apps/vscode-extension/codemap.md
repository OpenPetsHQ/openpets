# VS Code extension

`src/extension.ts` composes one host service and the movable view and singleton editor tab. `src/protocol.ts` defines the shared UI boundary. `src/host/` owns preferences, companion snapshots, webview sessions, resource projection and stage handoffs. `catalog-service.ts` resolves curated catalog v3 pages and search; `pet-store.ts` owns immutable installations, and `package-validation.ts` and its worker own bounded atlas validation. `scripts/build.mjs` bundles both runtimes and copies the canonical desktop-owned Hoodie Cat atlas into the distributable.

`scene-store.ts` owns the worker lifecycle and serialized scene operations; `scene-worker.ts` uses Node SQLite transactions and `scene-state.ts` owns scene validation and commands. Scene settings, selected instance and up to six named instances with per-instance outfits are separate from independent installation receipts and immutable assets. Installation does not add an instance; removal does not uninstall an asset. Wardrobe metadata may be unknown and can be explicitly refreshed.

The webview `App.tsx` composes host snapshots, surface state and mutation controls. `SceneControls.tsx` manages instance and settings actions; `SceneStage.tsx` owns one scene frame loop, pointer capture and transient positions/ball, using pure `scene-core.ts` and `companion-core.ts`. `Gallery.tsx` separates installation from adding, `Wardrobe.tsx` chooses per-instance outfits and refreshes metadata, and `SpritePreview.tsx` renders previews. `view-state.ts` projects snapshots and `backend.ts` owns document-scoped transport and transient UI state; durable state stays host-owned. The surface coordinator enables playback on only one surface.

Scene host and headless core gates passed and scene UI is implemented; rendered editor and clean installed-product acceptance remain pending. The extracted SQLite worker was tested in VS Code 1.101 and 1.142 on macOS arm64, not Windows/Linux or full product UI.

`src/host/local-storage.ts` validates the documented native global storage path against the local `file` or `vscode-userdata` URI before a file URI is used for webview resource roots. The original VS Code storage URI remains available for future `workspace.fs` operations.

Webview request IDs are unique to a document and installation responses have a longer bounded timeout than ordinary controls. Shutdown closes surface request admission before draining service writes; a sidebar handoff closes only the editor instance captured before the asynchronous reveal.

Offline initialization validates recorded generations without catalog access. It preserves scene choices on asset failure and falls back to the bundled companion or base atlas. Installations are serialized, cancel on shutdown, and do not add an instance.

`preferences.ts` owns independent atomic JSON installation references; scene choices are owned by `SceneStore`. `pet-store.ts` promotes every validated install into a fresh immutable generation, so reinstalling repairs damaged content without replacing an old reader's files. Controls reject while an install is pending rather than waiting behind long-running work.
