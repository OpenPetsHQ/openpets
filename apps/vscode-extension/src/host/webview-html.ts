import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

export function webviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const nonce = randomBytes(16).toString("base64");
  const script = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "main.js"),
  );
  const stylesheet = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "main.css"),
  );
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https://openpets.dev; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};"><link rel="stylesheet" href="${stylesheet}"><title>OpenPets</title></head><body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
}
