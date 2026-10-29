import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import type * as vscode from "vscode";
import { CompanionService } from "../src/host/companion-service.js";
import { Preferences } from "../src/host/preferences.js";
import { SurfaceCoordinator } from "../src/host/surface-coordinator.js";

test("disposed sidebar request cannot close a replacement editor panel", async () => {
  const panels: Array<{
    disposed: boolean;
    listeners: Set<() => void>;
    dispose(): void;
  }> = [];
  const vscodeMock = {
    ViewColumn: { Beside: 2 },
    Uri: {
      joinPath: () => ({ toString: () => "resource" }),
      file: (path: string) => ({ path }),
    },
    window: {
      createWebviewPanel: () => {
        const panel = {
          disposed: false,
          listeners: new Set<() => void>(),
          visible: true,
          webview: {},
          viewColumn: 2,
          reveal: () => {},
          onDidChangeViewState: () => ({ dispose: () => {} }),
          onDidDispose: (listener: () => void) => {
            panel.listeners.add(listener);
            return { dispose: () => panel.listeners.delete(listener) };
          },
          dispose: () => {
            panel.disposed = true;
            for (const listener of panel.listeners) listener();
          },
        };
        panels.push(panel);
        return panel;
      },
    },
  };
  Object.defineProperty(globalThis, "__openpetsVscode", {
    configurable: true,
    value: vscodeMock,
  });
  try {
    const output = await build({
      stdin: {
        contents:
          'export { WebviewSession } from "./src/host/webview-session.ts"; export { EditorPetPanel } from "./src/host/editor-panel.ts";',
        resolveDir: process.cwd(),
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
      plugins: [
        {
          name: "vscode-test-boundary",
          setup(builder) {
            builder.onResolve({ filter: /^vscode$/ }, () => ({
              path: "vscode",
              namespace: "test",
            }));
            builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
              contents: "module.exports = globalThis.__openpetsVscode",
              loader: "js",
            }));
          },
        },
      ],
    });
    const module = { exports: {} };
    const load = new Function(
      "module",
      "exports",
      "require",
      output.outputFiles[0].text,
    );
    load(module, module.exports, createRequire(resolve("package.json")));
    const host = module.exports as {
      WebviewSession: typeof import("../src/host/webview-session.js").WebviewSession;
      EditorPetPanel: typeof import("../src/host/editor-panel.js").EditorPetPanel;
    };
    const editor = new host.EditorPetPanel(
      () =>
        ({
          dispose: () => {},
          setVisible: () => {},
        }) as unknown as import("../src/host/webview-session.js").WebviewSession,
    );
    editor.show();
    editor.show();
    assert.equal(panels.length, 1);
    let release!: () => void;
    const reveal = new Promise<void>((resolve) => {
      release = resolve;
    });
    let receive: (message: unknown) => void = () => {};
    const webview = {
      options: {},
      html: "",
      cspSource: "local",
      asWebviewUri: () => ({ toString: () => "projected" }),
      onDidReceiveMessage: (listener: (message: unknown) => void) => {
        receive = listener;
        return { dispose: () => {} };
      },
      postMessage: async () => true,
    } as unknown as vscode.Webview;
    const service = new CompanionService(
      new Preferences("/unused-test-storage"),
      "/cat.webp",
    );
    const session = new host.WebviewSession(
      webview,
      "view",
      "view",
      true,
      service,
      new SurfaceCoordinator(),
      {} as vscode.Uri,
      {} as vscode.Uri,
      {
        openEditor: () => {},
        revealSidebar: () => reveal,
        captureCloseEditor: () => editor.captureClose(),
      },
      {
        name: "test",
        append: () => {},
        appendLine: () => {},
        replace: () => {},
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
      },
    );
    const staleClose = editor.captureClose();
    receive({ type: "request", id: "old", method: "showSidebar" });
    session.dispose();
    receive({
      type: "request",
      id: "late",
      method: "setSize",
      params: { size: "large" },
    });
    editor.close();
    editor.show();
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(panels.length, 2);
    assert.equal(panels[1].disposed, false);
    assert.equal((await service.getSnapshot()).revision, 0);
    staleClose();
    assert.equal(panels[1].disposed, false);
    session.dispose();
    editor.dispose();
    await service.dispose();
  } finally {
    Reflect.deleteProperty(globalThis, "__openpetsVscode");
  }
});
