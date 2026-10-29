import type { CatalogService } from "./catalog-service.js";
import { compatibilityProblem } from "./catalog-service.js";
import type { CompanionStore } from "./companion-store.js";
import type { PackageInteractions } from "./package-interactions.js";
import type { InstalledPet, PetStore } from "./pet-store.js";
import type { PreparedPetPackage } from "./pet-package-preparation.js";

const preparationTimeoutMs = 150_000;

/** Stop waiting for native dialogs on shutdown without claiming to close them. */
function waitForDialog<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => { cleanup(); reject(signal.reason); };
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
  });
}

export class PackageInstallation {
  private readonly controller = new AbortController();
  private readonly requests = new Set<Promise<unknown>>();
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private closed = false;
  private disposal?: Promise<void>;
  private readonly onExternalAbort: () => void;

  constructor(private readonly options: {
    petStore: Pick<PetStore, "prepareCatalog" | "prepareLocal" | "commitPrepared" | "discardPrepared">;
    stateStore: Pick<CompanionStore, "readAssetReference">;
    catalog: Pick<CatalogService, "find">;
    interactions: PackageInteractions;
    signal?: AbortSignal;
    log?: (message: string) => void;
  }) {
    this.onExternalAbort = () => this.controller.abort(options.signal?.reason);
    if (options.signal?.aborted) this.onExternalAbort();
    else options.signal?.addEventListener("abort", this.onExternalAbort, { once: true });
  }

  get busy(): boolean { return this.pending > 0; }

  installCatalog(petId: string, wardrobe: boolean, requestOperationSignal?: AbortSignal): Promise<InstalledPet | null> {
    return this.run(requestOperationSignal, (operationSignal) => this.enqueue(async (signal) => {
      const pet = await this.options.catalog.find(petId, signal);
      signal.throwIfAborted();
      const problem = compatibilityProblem(pet);
      if (problem) throw new Error(problem);
      return this.options.petStore.prepareCatalog(pet, wardrobe, signal);
    }, false, false, operationSignal));
  }

  importPackage(targetPetId?: string, requestOperationSignal?: AbortSignal): Promise<InstalledPet | null> {
    return this.run(requestOperationSignal, async (operationSignal) => {
      operationSignal.throwIfAborted();
      const path = await waitForDialog(this.options.interactions.pickZip(), operationSignal);
      operationSignal.throwIfAborted();
      if (!path) return null;
      return this.enqueue((signal) => this.options.petStore.prepareLocal(path, targetPetId, signal), true, targetPetId !== undefined, operationSignal);
    });
  }

  drain(): Promise<void> {
    return Promise.allSettled([...this.requests]).then(() => undefined);
  }

  private run<T>(requestSignal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try { this.assertOpen(); } catch (error) { return Promise.reject(error); }
    const controller = new AbortController();
    const shutdown = (): void => controller.abort(this.controller.signal.reason);
    const abortRequest = (): void => controller.abort(requestSignal?.reason);
    if (this.controller.signal.aborted) shutdown();
    else this.controller.signal.addEventListener("abort", shutdown, { once: true });
    if (requestSignal?.aborted) abortRequest();
    else requestSignal?.addEventListener("abort", abortRequest, { once: true });
    let result: Promise<T>;
    try {
      controller.signal.throwIfAborted();
      result = work(controller.signal);
    } catch (error) {
      result = Promise.reject(error);
    }
    const tracked = result.finally(() => {
      this.controller.signal.removeEventListener("abort", shutdown);
      requestSignal?.removeEventListener("abort", abortRequest);
      this.requests.delete(tracked);
    });
    this.requests.add(tracked);
    return tracked;
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closed = true;
    this.controller.abort(new Error("Package installation is disposed."));
    this.options.signal?.removeEventListener("abort", this.onExternalAbort);
    this.disposal = this.drain();
    return this.disposal;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Package installation is disposed.");
    this.controller.signal.throwIfAborted();
  }

  private enqueue(prepare: (signal: AbortSignal) => Promise<PreparedPetPackage>, local: boolean, targeted: boolean, operationSignal: AbortSignal): Promise<InstalledPet | null> {
    this.assertOpen();
    operationSignal.throwIfAborted();
    this.pending++;
    const result = this.queue.then(async () => {
      this.assertOpen();
      operationSignal.throwIfAborted();
      const controller = new AbortController();
      const abort = (): void => controller.abort(operationSignal.reason);
      operationSignal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error("Pet package preparation timed out.")), preparationTimeoutMs);
      let prepared: PreparedPetPackage | undefined;
      try {
        try {
          prepared = await prepare(controller.signal);
          controller.signal.throwIfAborted();
        } finally {
          clearTimeout(timer);
          operationSignal.removeEventListener("abort", abort);
        }
        const reference = await this.options.stateStore.readAssetReference(prepared.id);
        operationSignal.throwIfAborted();
        const replacingLocal = reference?.source.kind === "local";
        if (targeted || (local && reference !== null) || (!local && replacingLocal)) {
          const confirmed = await waitForDialog(this.options.interactions.confirmReplacement({
            displayName: prepared.package.metadata.displayName,
            assetId: prepared.id,
            targeted,
            replacingLocal,
          }), operationSignal);
          operationSignal.throwIfAborted();
          if (!confirmed) return null;
        }
        operationSignal.throwIfAborted();
        const candidate = prepared;
        // commitPrepared takes ownership and cleans its candidate on every outcome.
        prepared = undefined;
        return await this.options.petStore.commitPrepared(candidate, reference?.generation ?? null, operationSignal);
      } finally {
        if (prepared) {
          await this.options.petStore.discardPrepared(prepared).catch((error: unknown) => {
            this.options.log?.(`[install] candidate cleanup failed: ${String(error)}`);
          });
        }
      }
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result.finally(() => { this.pending--; });
  }
}
