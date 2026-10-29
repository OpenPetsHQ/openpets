# VS Code extension

`src/extension.ts` composes one host service and the movable view and singleton editor tab. `src/protocol.ts` defines the shared UI boundary. `src/host/` owns preferences, companion snapshots, webview sessions, resource projection and stage handoffs. `src/webview/` is a temporary protocol-driven smoke renderer. `scripts/build.mjs` bundles both runtimes and copies the canonical desktop-owned Hoodie Cat atlas into the distributable. Catalog, install and decoder work are not implemented in this foundation.

`src/host/local-storage.ts` validates the documented native global storage path against the local `file` or `vscode-userdata` URI before a file URI is used for webview resource roots. The original VS Code storage URI remains available for future `workspace.fs` operations.

Webview request IDs are unique to a document and installation responses have a longer bounded timeout than ordinary controls. Shutdown closes surface request admission before draining service writes; a sidebar handoff closes only the editor instance captured before the asynchronous reveal.
