# VS Code extension

`src/extension.ts` composes the host service, movable sidebar and singleton editor tab. `src/protocol.ts` defines the webview boundary. `companion-service.ts` owns snapshots, asset refresh and scene orchestration; `surface-coordinator.ts` enables playback on one surface at a time. `webview-session.ts` projects resources and owns a document-scoped `package-operation-registry.ts` for status, recovery and draining without replay.

`companion-store.ts` owns the worker lifecycle and serialized operations; `scene-worker.ts` owns SQLite scene and asset-reference transactions, and `scene-state.ts` validates scene commands. `asset-reference.ts` defines receipts and problems; `asset-reference-migration.ts` reads legacy JSON references once into SQLite, preserving blocked IDs. Scene instances and installed asset references are independent: installation never adds or selects an instance, and removing an instance never uninstalls an asset.

`catalog-service.ts` resolves catalog v3 pages and search. `package-installation.ts` coordinates native interactions, bounded preparation and commits; `package-interactions.ts` owns dialogs and external opening, and `studio-links.ts` constructs fixed Studio URLs. `pet-package-preparation.ts`, `package-validation.ts` and its worker validate complete packages; `pet-store.ts` promotes immutable generations and commits references by compare-and-swap. `local-storage.ts` validates the native storage path before resource projection.

`scripts/build.mjs` bundles both runtimes and copies the desktop-owned Hoodie Cat base and five outfit atlases. The portable definition is shared in `packages/pet-format/src/builtin-hoodie-cat.ts`. Offline initialization retains choices and reports damaged assets; a damaged builtin override falls back to the bundled base and outfits.

The webview `App.tsx` composes snapshots and controls. `SceneControls.tsx` manages instances and settings; `SceneStage.tsx` owns the scene frame loop, pointer capture and transient positions using `scene-core.ts` and `companion-core.ts`. `Gallery.tsx` separates installation from adding; `Wardrobe.tsx` manages manual outfits; `view-state.ts` projects snapshots and `backend.ts` owns document transport and package-operation recovery.

The local VSIX is for macOS evaluation; installed ZIP tests controlled native API responses rather than OS dialogs. Windows, Linux and complete release acceptance remain unverified. See `docs/vscode.md`.
