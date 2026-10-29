import { strict as assert } from "node:assert";
import { test } from "node:test";
import type * as vscode from "vscode";
import { ViewProvider } from "../src/host/view-provider.js";
import type { WebviewSession } from "../src/host/webview-session.js";

function view() {
  const visibility = new Set<() => void>();
  const disposal = new Set<() => void>();
  const instance = {
    webview: {},
    visible: true,
    onDidChangeVisibility: (listener: () => void) => {
      visibility.add(listener);
      return { dispose: () => visibility.delete(listener) };
    },
    onDidDispose: (listener: () => void) => {
      disposal.add(listener);
      return { dispose: () => disposal.delete(listener) };
    },
  };
  return {
    instance: instance as unknown as vscode.WebviewView,
    visibility,
    disposal,
    close: () => {
      for (const listener of disposal) listener();
    },
  };
}

test("view replacement and disposal release each resolution and its listeners", () => {
  let disposed = 0;
  const provider = new ViewProvider(
    () =>
      ({
        dispose: () => disposed++,
        setVisible: () => {},
      }) as unknown as WebviewSession,
  );
  const first = view();
  const second = view();
  provider.resolveWebviewView(first.instance);
  provider.resolveWebviewView(second.instance);
  assert.equal(disposed, 1);
  assert.equal(first.visibility.size + first.disposal.size, 0);
  assert.equal(second.visibility.size + second.disposal.size, 2);
  second.close();
  assert.equal(disposed, 2);
  assert.equal(second.visibility.size + second.disposal.size, 0);
  provider.dispose();
  provider.dispose();
  provider.resolveWebviewView(first.instance);
  assert.equal(disposed, 2);
  assert.equal(first.visibility.size + first.disposal.size, 0);
});
