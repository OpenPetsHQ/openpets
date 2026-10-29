import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { CompanionService } from "./host/companion-service.js";
import { Preferences } from "./host/preferences.js";
import { SurfaceCoordinator } from "./host/surface-coordinator.js";
import { WebviewSession } from "./host/webview-session.js";
import { ViewProvider } from "./host/view-provider.js";
import { EditorPetPanel } from "./host/editor-panel.js";
import { validateLocalStoragePath } from "./host/local-storage.js";
import type { SurfaceKind } from "./protocol.js";

let service: CompanionService | undefined;
let stopAdmission: (() => void) | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const log = vscode.window.createOutputChannel("OpenPets");
  context.subscriptions.push(log);
  for (const [name, uri] of [
    ["globalStorage", context.globalStorageUri],
    ["extension", context.extensionUri],
  ] as const) {
    log.appendLine(
      `[activation] ${name} URI: scheme=${uri.scheme} authority=${uri.authority} path=${uri.path}`,
    );
  }
  let storageFileUri: vscode.Uri;
  let storagePath: string;
  try {
    // VS Code documents globalStoragePath as the native absolute path even when
    // the storage URI uses its local vscode-userdata filesystem provider.
    storagePath = context.globalStoragePath;
    storageFileUri = vscode.Uri.file(storagePath);
    validateLocalStoragePath(
      context.globalStorageUri,
      storagePath,
      storageFileUri.path,
    );
  } catch (error) {
    log.appendLine(`[activation] storage unavailable: ${String(error)}`);
    throw error;
  }
  if (
    context.extensionUri.scheme !== "file" ||
    context.extensionUri.authority !== ""
  ) {
    const message = `Unsupported extension URI: scheme=${context.extensionUri.scheme}, authority=${context.extensionUri.authority || "(empty)"}.`;
    log.appendLine(`[activation] ${message}`);
    throw new Error(message);
  }
  service = new CompanionService(
    new Preferences(storagePath, undefined, (message) =>
      log.appendLine(message),
    ),
    vscode.Uri.joinPath(
      context.extensionUri,
      "dist",
      "media",
      "default-pet-spritesheet.webp",
    ).fsPath,
    storagePath,
    (message) => log.appendLine(message),
  );
  await service.initialize();
  const companion = service;
  const coordinator = new SurfaceCoordinator();
  let editor: EditorPetPanel;
  const commands = {
    openEditor: () => editor.show(),
    revealSidebar: async () => {
      await vscode.commands.executeCommand("openpets.companion.focus");
    },
    captureCloseEditor: () => editor.captureClose(),
  };
  const create =
    (kind: SurfaceKind) => (webview: vscode.Webview, visible: boolean) =>
      new WebviewSession(
        webview,
        randomUUID(),
        kind,
        visible,
        companion,
        coordinator,
        context.extensionUri,
        storageFileUri,
        commands,
        log,
      );
  editor = new EditorPetPanel(create("editor"));
  const provider = new ViewProvider(create("view"));
  const registrations = [
    vscode.window.registerWebviewViewProvider("openpets.companion", provider),
    vscode.commands.registerCommand("openpets.openEditor", commands.openEditor),
    vscode.commands.registerCommand("openpets.showSidebar", async () => {
      const closeEditor = commands.captureCloseEditor();
      await commands.revealSidebar();
      closeEditor();
    }),
  ];
  let stopped = false;
  stopAdmission = () => {
    if (stopped) return;
    stopped = true;
    for (const registration of registrations) registration.dispose();
    provider.dispose();
    editor.dispose();
  };
  context.subscriptions.push({ dispose: stopAdmission });
  const snapshot = await companion.getSnapshot();
  log.appendLine(
    `[activation] ready; selected=${snapshot.selectedPetId}, active=${snapshot.active.petId}${snapshot.notice ? `; ${snapshot.notice}` : ""}`,
  );
}

export async function deactivate(): Promise<void> {
  stopAdmission?.();
  stopAdmission = undefined;
  await service?.dispose();
  service = undefined;
}
