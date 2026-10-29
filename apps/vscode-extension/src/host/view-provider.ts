import * as vscode from "vscode";
import { WebviewSession } from "./webview-session.js";

export class ViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private current?: vscode.Disposable;
  private closed = false;
  constructor(
    private readonly createSession: (
      webview: vscode.Webview,
      visible: boolean,
    ) => WebviewSession,
  ) {}
  resolveWebviewView(view: vscode.WebviewView): void {
    if (this.closed) return;
    this.current?.dispose();
    const session = this.createSession(view.webview, view.visible);
    const visibility = view.onDidChangeVisibility(() =>
      session.setVisible(view.visible),
    );
    const disposed = view.onDidDispose(() => resolution.dispose());
    let active = true;
    const resolution: vscode.Disposable = {
      dispose: () => {
        if (!active) return;
        active = false;
        visibility.dispose();
        disposed.dispose();
        session.dispose();
        if (this.current === resolution) this.current = undefined;
      },
    };
    this.current = resolution;
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.current?.dispose();
  }
}
