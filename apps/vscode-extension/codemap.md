# VS Code extension

`src/extension.ts` composes one host service and the movable view and singleton editor tab. `src/protocol.ts` defines the shared UI boundary. `src/host/` owns preferences, companion snapshots, webview sessions, resource projection and stage handoffs. `catalog-service.ts` resolves curated catalog v3 pages and search; `pet-store.ts` owns immutable installations, and `package-validation.ts` and its worker own bounded atlas validation. `scripts/build.mjs` bundles both runtimes and copies the canonical desktop-owned Hoodie Cat atlas into the distributable.

The base webview UI lives in `src/webview/`: `App.tsx` composes host snapshots, surface state, navigation and mutation controls; `CompanionStage.tsx` owns the animated canvas and local click/drag lifecycle; `Gallery.tsx` displays catalog search, paging and installation; `Wardrobe.tsx` displays installed pets and manual outfit choices; `SpritePreview.tsx` renders atlas previews. `companion-core.ts` and `view-state.ts` provide pure animation/gesture and snapshot projection rules. `backend.ts` owns document-scoped request/response transport and transient webview UI state; durable choices and installations remain host-owned.

The implemented base has dev-host and live-backend evidence, but is not publicly released; clean installed-VSIX acceptance remains pending. User-approved multi-pet scenes, autonomous roaming, ball play and expanded focused settings are planned next-phase work, not current behavior. A SQLite proof is not a product scene database.

`src/host/local-storage.ts` validates the documented native global storage path against the local `file` or `vscode-userdata` URI before a file URI is used for webview resource roots. The original VS Code storage URI remains available for future `workspace.fs` operations.

Webview request IDs are unique to a document and installation responses have a longer bounded timeout than ordinary controls. Shutdown closes surface request admission before draining service writes; a sidebar handoff closes only the editor instance captured before the asynchronous reveal.

Offline initialization validates recorded generations without catalog access. It keeps the saved pet choice on failure and falls back to the bundled companion; unavailable outfits fall back to the base atlas. Installations are serialized, cancel on shutdown, and do not select the installed pet.

`preferences.ts` owns independent atomic JSON records for selected pet, size, each outfit and each installation reference. `pet-store.ts` promotes every validated install into a fresh immutable generation, so reinstalling repairs damaged content without replacing an old reader's files. Controls reject while an install is pending rather than waiting behind long-running work.
