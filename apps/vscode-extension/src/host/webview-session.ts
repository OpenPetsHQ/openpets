import * as vscode from "vscode";
import type {
  CompanionSnapshot,
  Request,
  Response,
  Results,
  SurfaceKind,
} from "../protocol.js";
import type {
  AssetLocation,
  CompanionService,
  HostSnapshot,
} from "./companion-service.js";
import { parseRequest } from "./request-validation.js";
import { SurfaceCoordinator } from "./surface-coordinator.js";
import { webviewHtml } from "./webview-html.js";

export class WebviewSession implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;

  constructor(
    private readonly webview: vscode.Webview,
    private readonly id: string,
    kind: SurfaceKind,
    visible: boolean,
    private readonly service: CompanionService,
    private readonly coordinator: SurfaceCoordinator,
    extensionUri: vscode.Uri,
    storageUri: vscode.Uri,
    private readonly commands: {
      openEditor(): void;
      revealSidebar(): Promise<void>;
      captureCloseEditor(): () => void;
    },
    private readonly log: vscode.OutputChannel,
  ) {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, "dist"),
        storageUri,
      ],
    };
    coordinator.attach(id, kind, visible);
    this.disposables.push(
      webview.onDidReceiveMessage((value: unknown) => {
        void this.receive(value);
      }),
    );
    this.disposables.push({
      dispose: service.onSnapshot((snapshot) =>
        this.post({
          type: "snapshot",
          snapshot: this.projectSnapshot(snapshot),
        }),
      ),
    });
    this.disposables.push({
      dispose: coordinator.subscribe((surface) => {
        if (surface.surfaceId === id) this.post({ type: "surface", surface });
      }),
    });
    webview.html = webviewHtml(webview, extensionUri);
  }

  setVisible(visible: boolean): void {
    this.coordinator.setVisible(this.id, visible);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const disposable of this.disposables) disposable.dispose();
    this.coordinator.detach(this.id);
  }

  private post(message: unknown): void {
    if (!this.disposed)
      void this.webview
        .postMessage(message)
        .then(undefined, (error: unknown) =>
          this.log.appendLine(`[session] post failed: ${String(error)}`),
        );
  }
  private projectLocation(location: AssetLocation): string {
    if (location.kind === "local")
      return this.webview
        .asWebviewUri(vscode.Uri.file(location.path))
        .toString();
    const url = new URL(location.url);
    if (url.protocol !== "https:" || url.origin !== "https://openpets.dev")
      throw new Error("Invalid preview origin.");
    return url.toString();
  }
  private projectSnapshot(snapshot: HostSnapshot): CompanionSnapshot {
    const sprite = (asset: HostSnapshot["active"]["sprite"]) => ({
      ...asset,
      uri: this.projectLocation(asset.uri),
    });
    return {
      ...snapshot,
      installedPets: snapshot.installedPets.map((pet) => ({
        ...pet,
        outfits: pet.outfits.map((outfit) => ({
          ...outfit,
          sprite: sprite(outfit.sprite),
        })),
      })),
      active: { ...snapshot.active, sprite: sprite(snapshot.active.sprite) },
    };
  }
  private async receive(value: unknown): Promise<void> {
    if (this.disposed) return;
    const request = parseRequest(value);
    if (!request) {
      this.log.appendLine("[session] rejected malformed request");
      if (
        value &&
        typeof value === "object" &&
        "id" in value &&
        typeof value.id === "string" &&
        value.id.length <= 128
      )
        this.post({
          type: "response",
          id: value.id,
          ok: false,
          error: { message: "Invalid request." },
        });
      return;
    }
    try {
      if (request.method === "showSidebar") {
        const closeEditor = this.commands.captureCloseEditor();
        await this.commands.revealSidebar();
        if (this.disposed) return;
        await this.webview.postMessage({
          type: "response",
          id: request.id,
          ok: true,
          result: null,
        });
        if (this.disposed) return;
        closeEditor();
        return;
      }
      const result = await this.dispatch(request);
      const response: Response = {
        type: "response",
        id: request.id,
        ok: true,
        result,
      };
      this.post(response);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Request failed.";
      this.log.appendLine(`[session] ${request.method}: ${message}`);
      this.post({
        type: "response",
        id: request.id,
        ok: false,
        error: { message },
      });
    }
  }
  private async dispatch(request: Request): Promise<Results[keyof Results]> {
    switch (request.method) {
      case "ready":
        return {
          snapshot: this.projectSnapshot(await this.service.getSnapshot()),
          surface: this.coordinator.get(this.id),
        };
      case "listCatalog": {
        const listing = await this.service.listCatalog(
          request.params.query,
          request.params.page,
        );
        return {
          ...listing,
          pets: listing.pets.map((pet) => ({
            ...pet,
            thumbnailUri: this.projectLocation(pet.thumbnailUri),
            sprite: {
              ...pet.sprite,
              uri: this.projectLocation(pet.sprite.uri),
            },
          })),
        };
      }
      case "installPet":
        return this.projectSnapshot(
          await this.service.installPet(request.params.petId),
        );
      case "installWardrobe":
        return this.projectSnapshot(
          await this.service.installWardrobe(request.params.petId),
        );
      case "selectPet":
        return this.projectSnapshot(
          await this.service.selectPet(request.params.petId),
        );
      case "selectOutfit":
        return this.projectSnapshot(
          await this.service.selectOutfit(
            request.params.petId,
            request.params.outfitId,
          ),
        );
      case "setSize":
        return this.projectSnapshot(
          await this.service.setSize(request.params.size),
        );
      case "openEditor":
        this.commands.openEditor();
        return null;
      case "showSidebar":
        throw new Error("Sidebar requests must be handled by the session.");
    }
  }
}
