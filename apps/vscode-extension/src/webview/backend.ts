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
      timer?: ReturnType<typeof setTimeout>;
      isMutation: boolean;
      method: keyof Requests;
      probeId?: string;
    }
  >();
  private readonly unknownPackages = new Map<string, keyof Requests>();
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
    onId?: (id: string) => void,
  ): Promise<Results[M]> {
    if (this.disposed) return Promise.reject(new Error("Connection disposed."));
    if (this.pending.size >= 64)
      return Promise.reject(new Error("Too many pending requests."));
    const id = `${this.documentId}:${++this.nextId}`;
    onId?.(id);
    const isInstall = method === "installPet" || method === "installWardrobe";
    const isPackage = isInstall || method === "importPetPackage";
    const isMutation =
      isInstall ||
      method === "importPetPackage" ||
      method === "addInstance" ||
      method === "renameInstance" ||
      method === "removeInstance" ||
      method === "selectInstance" ||
      method === "setInstanceOutfit" ||
      method === "setSceneSettings";
    const timeoutMs = method === "refreshWardrobe" ? 30_000 : 15_000;
    return new Promise<Results[M]>((resolve, reject) => {
      const timer = isPackage
        ? undefined
        : setTimeout(() => {
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
        method,
      });
      if (isPackage) this.scheduleProbe(id);
      try {
        this.api.postMessage({ type: "request", id, method, params });
      } catch (error) {
        clearTimeout(this.pending.get(id)?.timer);
        this.pending.delete(id);
        reject(
          error instanceof Error ? error : new Error("Could not send request."),
        );
      }
    });
  }
  private scheduleProbe(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    pending.timer = setTimeout(() => {
      if (!this.pending.has(id)) return;
      let probeId = "";
      const probe = this.call(
        "packageOperationStatus",
        { operationId: id },
        (value) => {
          probeId = value;
        },
      );
      const original = this.pending.get(id);
      if (original) original.probeId = probeId;
      void probe.then(
        (status) => {
          const current = this.pending.get(id);
          if (!current) return;
          current.probeId = undefined;
          if (status && status.status === "pending") {
            this.scheduleProbe(id);
          } else if (status && status.status === "terminal") {
            this.settle(id, status.response);
          } else {
            this.failPackage(id);
          }
        },
        () => this.failPackage(id),
      );
    }, 15_000);
  }

  private failPackage(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.unknownPackages.set(id, pending.method);
    this.finish(id);
    pending.reject(
      new CompanionRequestError(
        "OpenPets could not determine the package operation outcome; refresh to check its status.",
        "unknown",
      ),
    );
  }

  private finish(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (pending.probeId) {
      const probe = this.pending.get(pending.probeId);
      if (probe) {
        this.pending.delete(pending.probeId);
        clearTimeout(probe.timer);
        probe.reject(new Error("Package operation settled."));
      }
    }
  }

  private settle(id: string, value: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    const isPackage =
      pending.method === "installPet" ||
      pending.method === "installWardrobe" ||
      pending.method === "importPetPackage";
    const response =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    if (response.ok === true && "result" in response) {
      const result = response.result;
      if (isPackage && !this.validPackageResult(pending.method, result)) {
        this.failPackage(id);
        return;
      }
      this.finish(id);
      pending.resolve(result);
      return;
    }
    const error = response.error;
    if (
      response.ok === false &&
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string" &&
      (!("outcome" in error) || error.outcome === "unknown")
    ) {
      if (isPackage && "outcome" in error && error.outcome === "unknown") {
        this.unknownPackages.set(id, pending.method);
      }
      this.finish(id);
      pending.reject(
        new CompanionRequestError(
          error.message,
          "outcome" in error && error.outcome === "unknown"
            ? "unknown"
            : undefined,
        ),
      );
      return;
    }
    if (isPackage) {
      this.failPackage(id);
      return;
    }
    this.finish(id);
    pending.reject(
      new CompanionRequestError(
        "Invalid response.",
        pending.isMutation ? "unknown" : undefined,
      ),
    );
  }

  private validPackageResult(method: keyof Requests, value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    if (method === "importPetPackage") {
      if (!("status" in value)) return false;
      if (value.status === "cancelled") return true;
      return (
        value.status === "installed" &&
        "petId" in value &&
        typeof value.petId === "string" &&
        "snapshot" in value &&
        this.validSnapshot(value.snapshot)
      );
    }
    return this.validSnapshot(value);
  }

  private validSnapshot(value: unknown): boolean {
    return (
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "revision" in value &&
      typeof value.revision === "number" &&
      "settings" in value &&
      !!value.settings &&
      typeof value.settings === "object" &&
      "selectedInstanceId" in value &&
      (value.selectedInstanceId === null ||
        typeof value.selectedInstanceId === "string") &&
      "instances" in value &&
      Array.isArray(value.instances) &&
      "installedPets" in value &&
      Array.isArray(value.installedPets)
    );
  }
  private validTerminal(method: keyof Requests, value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    if ("ok" in value && value.ok === true && "result" in value) {
      return this.validPackageResult(method, value.result);
    }
    if (
      !("ok" in value) ||
      value.ok !== false ||
      !("error" in value) ||
      !value.error ||
      typeof value.error !== "object"
    )
      return false;
    return (
      "message" in value.error &&
      typeof value.error.message === "string" &&
      (!("outcome" in value.error) || value.error.outcome === "unknown")
    );
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
      this.settle(value.id, value);
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
    const recovering = [...this.unknownPackages.entries()];
    for (const [operationId, method] of recovering) {
      const recovery = await this.call("recoverPackageOperation", {
        operationId,
      });
      if (
        !recovery ||
        (recovery.status !== "unavailable" &&
          (recovery.status !== "terminal" ||
            !this.validTerminal(method, recovery.response)))
      ) {
        throw new Error("Invalid package recovery response.");
      }
    }
    const state = await this.call("ready", undefined);
    if (
      [...this.unknownPackages.keys()].some(
        (id) => !recovering.some(([recovered]) => recovered === id),
      )
    ) {
      throw new Error(
        "Another package operation needs recovery; refresh again.",
      );
    }
    for (const [operationId] of recovering)
      this.unknownPackages.delete(operationId);
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
  importPetPackage(params: Requests["importPetPackage"]) {
    return this.call("importPetPackage", params);
  }
  openStudio(params: Requests["openStudio"]) {
    return this.call("openStudio", params);
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
    for (const [id, pending] of this.pending) {
      if (
        pending.method === "installPet" ||
        pending.method === "installWardrobe" ||
        pending.method === "importPetPackage"
      ) {
        this.unknownPackages.set(id, pending.method);
      }
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
