import type {
  CompanionBackend,
  CompanionSnapshot,
  HostEvent,
  ReadyState,
  Requests,
  Results,
  SurfaceState,
} from "../protocol.js";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: WebviewUiState): void;
};

export interface WebviewUiState {
  readonly activeTab: "companion" | "gallery" | "wardrobe";
  readonly searchQuery: string;
  readonly catalogPage: number;
}

export function validateWebviewUiState(value: unknown): WebviewUiState {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const activeTab =
    record.activeTab === "gallery" || record.activeTab === "wardrobe"
      ? record.activeTab
      : "companion";
  return {
    activeTab,
    searchQuery:
      typeof record.searchQuery === "string" ? record.searchQuery : "",
    catalogPage:
      typeof record.catalogPage === "number" &&
      Number.isSafeInteger(record.catalogPage) &&
      record.catalogPage >= 0
        ? record.catalogPage
        : 0,
  };
}

export class CompanionRequestError extends Error {
  constructor(
    message: string,
    readonly outcome?: "unknown",
  ) {
    super(message);
  }
}

export class WebviewBackend implements CompanionBackend {
  private readonly api = acquireVsCodeApi();
  private readonly documentId = crypto.randomUUID();
  private readonly pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
      isMutation: boolean;
    }
  >();
  private readonly snapshots = new Set<(snapshot: CompanionSnapshot) => void>();
  private readonly surfaces = new Set<(surface: SurfaceState) => void>();
  private nextId = 0;
  private revision = -1;
  private sequence = -1;
  private disposed = false;

  constructor() {
    window.addEventListener("message", this.receive);
  }
  readUiState(): WebviewUiState {
    return validateWebviewUiState(this.api.getState());
  }
  writeUiState(state: WebviewUiState): void {
    this.api.setState(validateWebviewUiState(state));
  }
  private call<M extends keyof Requests>(
    method: M,
    params: Requests[M],
  ): Promise<Results[M]> {
    if (this.disposed) return Promise.reject(new Error("Connection disposed."));
    if (this.pending.size >= 64)
      return Promise.reject(new Error("Too many pending requests."));
    const id = `${this.documentId}:${++this.nextId}`;
    const isInstall = method === "installPet" || method === "installWardrobe";
    const isMutation =
      isInstall ||
      method === "addInstance" ||
      method === "renameInstance" ||
      method === "removeInstance" ||
      method === "selectInstance" ||
      method === "setInstanceOutfit" ||
      method === "setSceneSettings";
    // Installation needs room for a future 150s host operation and delivery.
    const timeoutMs = isInstall
      ? 180_000
      : method === "refreshWardrobe"
        ? 30_000
        : 15_000;
    return new Promise<Results[M]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new CompanionRequestError(
            isMutation
              ? "OpenPets response timed out. The operation may still complete; refresh to check its status."
              : "OpenPets request timed out.",
            isMutation ? "unknown" : undefined,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as Results[M]),
        reject,
        timer,
        isMutation,
      });
      this.api.postMessage({ type: "request", id, method, params });
    });
  }
  private receive = (event: MessageEvent<unknown>): void => {
    const value = event.data;
    if (!value || typeof value !== "object" || !("type" in value)) return;
    if (
      value.type === "response" &&
      "id" in value &&
      typeof value.id === "string"
    ) {
      const pending = this.pending.get(value.id);
      if (!pending) return;
      this.pending.delete(value.id);
      clearTimeout(pending.timer);
      if ("ok" in value && value.ok === true && "result" in value)
        pending.resolve(value.result);
      else if (
        "ok" in value &&
        value.ok === false &&
        "error" in value &&
        value.error &&
        typeof value.error === "object" &&
        "message" in value.error &&
        typeof value.error.message === "string" &&
        (!("outcome" in value.error) || value.error.outcome === "unknown")
      )
        pending.reject(
          new CompanionRequestError(
            value.error.message,
            "outcome" in value.error && value.error.outcome === "unknown"
              ? "unknown"
              : undefined,
          ),
        );
      else
        pending.reject(
          new CompanionRequestError(
            "Invalid response.",
            pending.isMutation ? "unknown" : undefined,
          ),
        );
    } else if (value.type === "snapshot" && "snapshot" in value) {
      const snapshot = (value as HostEvent & { type: "snapshot" }).snapshot;
      if (snapshot.revision > this.revision) {
        this.revision = snapshot.revision;
        for (const listener of this.snapshots) listener(snapshot);
      }
    } else if (value.type === "surface" && "surface" in value) {
      const surface = (value as HostEvent & { type: "surface" }).surface;
      if (surface.sequence > this.sequence) {
        this.sequence = surface.sequence;
        for (const listener of this.surfaces) listener(surface);
      }
    }
  };
  async ready(): Promise<ReadyState> {
    const state = await this.call("ready", undefined);
    this.revision = Math.max(this.revision, state.snapshot.revision);
    this.sequence = Math.max(this.sequence, state.surface.sequence);
    return state;
  }
  listCatalog(query: string, page: number) {
    return this.call("listCatalog", { query, page });
  }
  installPet(petId: string) {
    return this.call("installPet", { petId });
  }
  installWardrobe(petId: string) {
    return this.call("installWardrobe", { petId });
  }
  addInstance(petId: string, name: string) {
    return this.call("addInstance", { petId, name });
  }
  renameInstance(instanceId: string, name: string) {
    return this.call("renameInstance", { instanceId, name });
  }
  removeInstance(instanceId: string) {
    return this.call("removeInstance", { instanceId });
  }
  selectInstance(instanceId: string) {
    return this.call("selectInstance", { instanceId });
  }
  setInstanceOutfit(instanceId: string, outfitId: string) {
    return this.call("setInstanceOutfit", { instanceId, outfitId });
  }
  setSceneSettings(changes: Requests["setSceneSettings"]["changes"]) {
    return this.call("setSceneSettings", { changes });
  }
  refreshWardrobe(petId: string) {
    return this.call("refreshWardrobe", { petId });
  }
  async openEditor() {
    await this.call("openEditor", undefined);
  }
  async showSidebar() {
    await this.call("showSidebar", undefined);
  }
  onSnapshot(listener: (value: CompanionSnapshot) => void) {
    if (this.disposed) throw new Error("Connection disposed.");
    this.snapshots.add(listener);
    return () => {
      this.snapshots.delete(listener);
    };
  }
  onSurface(listener: (value: SurfaceState) => void) {
    if (this.disposed) throw new Error("Connection disposed.");
    this.surfaces.add(listener);
    return () => {
      this.surfaces.delete(listener);
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("message", this.receive);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new CompanionRequestError(
          "Connection disposed.",
          pending.isMutation ? "unknown" : undefined,
        ),
      );
    }
    this.pending.clear();
    this.snapshots.clear();
    this.surfaces.clear();
  }
}
