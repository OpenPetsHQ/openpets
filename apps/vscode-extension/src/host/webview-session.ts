import * as vscode from "vscode";
import type {
  CompanionSnapshot,
  Request,
  Response,
  Results,
  SurfaceKind,
  PackageOperationResponse,
} from "../protocol.js";
import type {
  AssetLocation,
  CompanionService,
  HostSnapshot,
} from "./companion-service.js";
import { parseRequest } from "./request-validation.js";
import { SurfaceCoordinator } from "./surface-coordinator.js";
import { webviewHtml } from "./webview-html.js";
import { PackageOperationRegistry } from "./package-operation-registry.js";

export class WebviewSession implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;
  private playbackActive = false;
  private readonly packageOperations = new PackageOperationRegistry();
  private readyPending = 0;

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
        if (surface.surfaceId !== id) return;
        this.post({ type: "surface", surface });
        const active = surface.visible && surface.playbackEnabled;
        if (active && !this.playbackActive) {
          void this.service.getSnapshot().then(
            (snapshot) =>
              this.post({
                type: "snapshot",
                snapshot: this.projectSnapshot(snapshot),
              }),
            (error: unknown) =>
              this.log.appendLine(`[session] refresh failed: ${String(error)}`),
          );
        }
        this.playbackActive = active;
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
    const drain = this.packageOperations.dispose();
    this.service.trackDetachedPackageOperations(drain);
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
    const sprite = (
      asset: HostSnapshot["instances"][number]["appearance"]["sprite"],
    ) => ({
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
      instances: snapshot.instances.map((instance) => ({
        ...instance,
        appearance: {
          ...instance.appearance,
          sprite: sprite(instance.appearance.sprite),
        },
      })),
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
      if (request.method === "installPet" || request.method === "installWardrobe" || request.method === "importPetPackage") {
        if (this.readyPending) throw new Error("Companion is not ready.");
        const result = await this.packageOperations.run(request.id, (signal) => this.runPackage(request, signal));
        this.post({ type: "response", id: request.id, ...result });
        return;
      }
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
        error: {
          message,
          ...(typeof error === "object" && error !== null && "outcome" in error && error.outcome === "unknown"
            ? { outcome: "unknown" as const }
            : {}),
        },
      });
    }
  }
  private async runPackage(request: Extract<Request, { method: "installPet" | "installWardrobe" | "importPetPackage" }>, signal: AbortSignal): Promise<PackageOperationResponse> {
    let succeeded = false;
    try {
      if (request.method === "importPetPackage") {
        const result = await this.service.importPetPackage(request.params.targetPetId, signal);
        if (result.status === "cancelled") return { ok: true, result };
        succeeded = true;
        return { ok: true, result: { status: "installed", petId: result.petId, snapshot: this.projectSnapshot(result.snapshot) } };
      }
      const snapshot = request.method === "installPet"
        ? await this.service.installPet(request.params.petId, signal)
        : await this.service.installWardrobe(request.params.petId, signal);
      succeeded = true;
      return { ok: true, result: this.projectSnapshot(snapshot) };
    } catch (error) {
      const unknown = succeeded || (typeof error === "object" && error !== null && "outcome" in error && error.outcome === "unknown");
      return { ok: false, error: { message: unknown ? "Package operation outcome is unknown. Refresh before retrying." : error instanceof Error ? error.message : "Request failed.", ...(unknown ? { outcome: "unknown" as const } : {}) } };
    }
  }
  private async dispatch(request: Request): Promise<Results[keyof Results]> {
    switch (request.method) {
      case "ready": {
        this.readyPending++;
        try {
          await this.packageOperations.activateDocument(request.id);
          await this.service.waitForPackageOperations();
          return { snapshot: this.projectSnapshot(await this.service.getSnapshot()), surface: this.coordinator.get(this.id) };
        } finally {
          this.readyPending--;
        }
      }
      case "packageOperationStatus":
        return this.packageOperations.status(request.params.operationId);
      case "recoverPackageOperation":
        return this.packageOperations.recover(request.params.operationId);
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
      case "installWardrobe":
      case "importPetPackage":
        throw new Error("Package operations must be handled by the session registry.");
      case "openStudio":
        await this.service.openStudio(request.params.intent, request.params.petId);
        return null;
      case "addInstance":
        return this.projectSnapshot(
          await this.service.addInstance(
            request.params.petId,
            request.params.name,
          ),
        );
      case "renameInstance":
        return this.projectSnapshot(
          await this.service.renameInstance(
            request.params.instanceId,
            request.params.name,
          ),
        );
      case "removeInstance":
        return this.projectSnapshot(
          await this.service.removeInstance(request.params.instanceId),
        );
      case "selectInstance":
        return this.projectSnapshot(
          await this.service.selectInstance(request.params.instanceId),
        );
      case "setInstanceOutfit":
        return this.projectSnapshot(
          await this.service.setInstanceOutfit(
            request.params.instanceId,
            request.params.outfitId,
          ),
        );
      case "setSceneSettings":
        return this.projectSnapshot(
          await this.service.setSceneSettings(request.params.changes),
        );
      case "refreshWardrobe":
        return this.projectSnapshot(
          await this.service.refreshWardrobe(request.params.petId),
        );
      case "openEditor":
        this.commands.openEditor();
        return null;
      case "showSidebar":
        throw new Error("Sidebar requests must be handled by the session.");
    }
  }
}
