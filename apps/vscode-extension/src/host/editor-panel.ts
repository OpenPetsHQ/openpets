import * as vscode from "vscode";
import { WebviewSession } from "./webview-session.js";

export class EditorPetPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  constructor(
    private readonly createSession: (
      webview: vscode.Webview,
      visible: boolean,
    ) => WebviewSession,
  ) {}
  show(): void {
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "openpets.petSpace",
      "OpenPets",
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );
    this.panel = panel;
    const session = this.createSession(panel.webview, panel.visible);
    const visibility = panel.onDidChangeViewState(() =>
      session.setVisible(panel.visible),
    );
    const disposed = panel.onDidDispose(() => {
      visibility.dispose();
      disposed.dispose();
      session.dispose();
      if (this.panel === panel) this.panel = undefined;
    });
  }
  close(): void {
    this.panel?.dispose();
  }
  captureClose(): () => void {
    const panel = this.panel;
    return () => {
      if (panel && this.panel === panel) panel.dispose();
    };
  }
  dispose(): void {
    this.close();
  }
}
