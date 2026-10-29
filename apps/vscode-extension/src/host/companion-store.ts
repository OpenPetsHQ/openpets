import { Worker } from "node:worker_threads";
import { parseReceipt, type AssetReferenceListing, type AssetReferenceProblem, type Receipt } from "./asset-reference.js";
import {
  parseStoredScene,
  type SceneStoreCommand,
  type StoredScene,
} from "./scene-state.js";

export class SceneMutationOutcomeUnknownError extends Error {
  readonly outcome = "unknown" as const;
  constructor() {
    super("Scene mutation outcome is unknown. Refresh before retrying.");
  }
}
export class CompanionStoreError extends Error {
  constructor(
    message: string,
    readonly kind?: "busy" | "invalid" | "conflict",
  ) {
    super(message);
  }
}

type Operation =
  | "initialize"
  | "recover"
  | "read"
  | "mutate"
  | "close"
  | "initializeAssets"
  | "assetReferencesInitialized"
  | "readAssetReference"
  | "listAssetReferences"
  | "compareAndSwapAssetReference";
interface Pending {
  id: number;
  operation: Operation;
  resolve(value: unknown): void;
  reject(error: Error): void;
}
function durable(operation: Operation): boolean {
  return (
    operation === "mutate" ||
    operation === "initializeAssets" ||
    operation === "compareAndSwapAssetReference"
  );
}

export class CompanionStore {
  private worker?: Worker;
  private pending?: Pending;
  private nextId = 0;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;
  private connectionInitialized = false;
  private needsRead = false;
  private closed = false;
  private disposal?: Promise<void>;
  private retirement: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: {
      databasePath: string;
      workerPath: string;
      log?: (message: string) => void;
    },
  ) {}

  initialize(): Promise<StoredScene> {
    return this.enqueue(async () => {
      if (this.connectionInitialized) {
        const scene = this.requireScene(await this.request("read"));
        this.needsRead = false;
        return scene;
      }
      await this.retirement;
      this.start();
      const scene = this.requireScene(
        await this.request(this.initialized ? "recover" : "initialize"),
      );
      this.initialized = true;
      this.connectionInitialized = true;
      this.needsRead = false;
      return scene;
    });
  }

  read(): Promise<StoredScene> {
    return this.enqueue(async () => {
      if (!this.initialized) throw new Error("Scene store is not initialized.");
      if (!this.connectionInitialized) {
        await this.retirement;
        this.start();
        await this.request("recover");
        this.connectionInitialized = true;
      }
      const scene = this.requireScene(await this.request("read"));
      this.needsRead = false;
      return scene;
    });
  }

  mutate(command: SceneStoreCommand): Promise<StoredScene> {
    return this.enqueue(async () => {
      if (!this.initialized || !this.connectionInitialized || this.needsRead)
        throw new Error("Scene store requires a fresh read before mutation.");
      return this.requireScene(await this.request("mutate", command));
    });
  }

  assetReferencesInitialized(): Promise<boolean> {
    return this.enqueue(async () => {
      await this.ensureReadable();
      const value = await this.request("assetReferencesInitialized");
      if (typeof value !== "boolean") throw new Error("Invalid asset initialization status.");
      return value;
    });
  }
  initializeAssetReferences(records: readonly Receipt[], problems?: readonly AssetReferenceProblem[]): Promise<AssetReferenceListing> {
    return this.enqueue(async () => {
      this.assertWritable();
      return this.requireReferences(await this.request("initializeAssets", { records, problems }));
    });
  }
  readAssetReference(assetId: string): Promise<Receipt | null> {
    return this.enqueue(async () => {
      await this.ensureReadable();
      const value = await this.request("readAssetReference", { assetId });
      return value === null ? null : parseReceipt(value);
    });
  }
  listAssetReferences(): Promise<AssetReferenceListing> {
    return this.enqueue(async () => {
      await this.ensureReadable();
      return this.requireReferences(await this.request("listAssetReferences"));
    });
  }
  compareAndSwapAssetReference(
    assetId: string,
    expectedGeneration: string | null,
    receipt: Receipt,
  ): Promise<Receipt> {
    return this.enqueue(async () => {
      this.assertWritable();
      return parseReceipt(
        await this.request("compareAndSwapAssetReference", {
          assetId,
          expectedGeneration,
          receipt,
        }),
      );
    });
  }

  private assertWritable(): void {
    if (!this.initialized || !this.connectionInitialized || this.needsRead)
      throw new Error("Scene store requires a fresh read before mutation.");
  }
  private async ensureReadable(): Promise<void> {
    if (!this.initialized) throw new Error("Scene store is not initialized.");
    if (!this.connectionInitialized) {
      await this.retirement;
      this.start();
      this.requireScene(await this.request("recover"));
      this.connectionInitialized = true;
    }
    if (this.needsRead) {
      this.requireScene(await this.request("read"));
      this.needsRead = false;
    }
  }
  private requireReferences(value: unknown): AssetReferenceListing {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid asset references response.");
    const listing = value as Record<string, unknown>;
    if (Object.keys(listing).length !== 2 || !Array.isArray(listing.references) || !Array.isArray(listing.problems))
      throw new Error("Invalid asset references response.");
    const problems = listing.problems.map((value: unknown): AssetReferenceProblem => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid asset problem response.");
      const problem = value as Record<string, unknown>;
      if (Object.keys(problem).length !== 2 || typeof problem.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(problem.id) || typeof problem.message !== "string" || !problem.message.trim() || problem.message.length > 500)
        throw new Error("Invalid asset problem response.");
      return { id: problem.id, message: problem.message };
    });
    return { references: listing.references.map(parseReceipt), problems };
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closed = true;
    this.disposal = this.queue.then(async () => {
      await this.retirement;
      const worker = this.worker;
      if (!worker) return;
      try {
        if (this.connectionInitialized) await this.request("close");
      } catch (error) {
        this.options.log?.(`[scene] close failed: ${String(error)}`);
      } finally {
        this.worker = undefined;
        this.generation++;
        await worker.terminate();
        worker.removeAllListeners();
      }
    });
    return this.disposal;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed)
      return Promise.reject(new Error("Scene store is disposed."));
    const result = this.queue.then(work);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private start(): void {
    if (this.worker) return;
    const worker = new Worker(this.options.workerPath, {
      workerData: { databasePath: this.options.databasePath },
      execArgv: [],
    });
    const generation = ++this.generation;
    this.worker = worker;
    worker.on("message", (value: unknown) => {
      if (generation !== this.generation) return;
      const pending = this.pending;
      if (
        !pending ||
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
      )
        return;
      const reply = value as Record<string, unknown>;
      if (reply.id !== pending.id) return;
      this.pending = undefined;
      if (reply.ok === true) {
        try {
          if (pending.operation === "close") pending.resolve(undefined);
          else if (
            pending.operation === "initializeAssets" ||
            pending.operation === "listAssetReferences"
          )
            pending.resolve(this.requireReferences({ references: reply.references, problems: reply.problems }));
          else if (pending.operation === "assetReferencesInitialized") {
            if (typeof reply.initialized !== "boolean") throw new Error("Invalid asset initialization status.");
            pending.resolve(reply.initialized);
          }
          else if (pending.operation === "readAssetReference") {
            if (!("reference" in reply))
              throw new Error("Missing asset reference response.");
            pending.resolve(
              reply.reference === null ? null : parseReceipt(reply.reference),
            );
          } else if (pending.operation === "compareAndSwapAssetReference")
            pending.resolve(parseReceipt(reply.reference));
          else pending.resolve(parseStoredScene(reply.scene));
        } catch (error) {
          if (durable(pending.operation)) {
            this.needsRead = true;
            pending.reject(new SceneMutationOutcomeUnknownError());
          } else
            pending.reject(
              error instanceof Error
                ? error
                : new Error("Invalid scene response."),
            );
        }
      } else if (
        reply.ok === false &&
        reply.error &&
        typeof reply.error === "object" &&
        "message" in reply.error &&
        typeof reply.error.message === "string"
      ) {
        if ("kind" in reply.error && reply.error.kind === "connection-failed") {
          this.options.log?.(
            `[scene] connection failed: ${reply.error.message}`,
          );
          this.worker = undefined;
          this.connectionInitialized = false;
          this.needsRead = true;
          this.generation++;
          worker.removeAllListeners();
          this.retirement = worker
            .terminate()
            .then(() => undefined)
            .catch((failure: unknown) => {
              this.options.log?.(
                `[scene] worker termination failed: ${String(failure)}`,
              );
              throw failure;
            });
          void this.retirement.catch(() => {
            /* Recovery observes the rejection. */
          });
          pending.reject(
            durable(pending.operation)
              ? new SceneMutationOutcomeUnknownError()
              : new Error(reply.error.message),
          );
        } else {
          const kind =
            "kind" in reply.error &&
            (reply.error.kind === "busy" ||
              reply.error.kind === "invalid" ||
              reply.error.kind === "conflict")
              ? reply.error.kind
              : undefined;
          pending.reject(new CompanionStoreError(reply.error.message, kind));
        }
      } else {
        if (durable(pending.operation)) {
          this.needsRead = true;
          pending.reject(new SceneMutationOutcomeUnknownError());
        } else pending.reject(new Error("Invalid scene response."));
      }
    });
    const failed = (error: Error) => {
      if (generation !== this.generation) return;
      this.worker = undefined;
      this.connectionInitialized = false;
      this.generation++;
      const pending = this.pending;
      this.pending = undefined;
      if (pending && durable(pending.operation)) {
        this.needsRead = true;
        pending.reject(new SceneMutationOutcomeUnknownError());
      } else pending?.reject(error);
      worker.removeAllListeners();
      this.retirement = worker
        .terminate()
        .then(() => undefined)
        .catch((failure: unknown) => {
          this.options.log?.(
            `[scene] worker termination failed: ${String(failure)}`,
          );
          throw failure;
        });
      void this.retirement.catch(() => {
        /* Recovery observes the rejection. */
      });
    };
    worker.on("error", failed);
    worker.on("exit", (code) =>
      failed(new Error(`Scene worker exited (${code}).`)),
    );
  }

  private request(
    operation: Operation,
    payload?:
      | SceneStoreCommand
      | { records: readonly Receipt[]; problems?: readonly AssetReferenceProblem[] }
      | { assetId: string }
      | {
          assetId: string;
          expectedGeneration: string | null;
          receipt: Receipt;
        },
  ): Promise<unknown> {
    const worker = this.worker;
    if (!worker)
      return Promise.reject(
        new Error("Scene worker is unavailable; refresh before retrying."),
      );
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending = { id, operation, resolve, reject };
      try {
        const fields =
          operation === "mutate" ? { command: payload } : (payload ?? {});
        worker.postMessage({ id, operation, ...fields });
      } catch (error) {
        this.pending = undefined;
        reject(
          error instanceof Error
            ? error
            : new Error("Could not send scene request."),
        );
      }
    });
  }

  private requireScene(scene: unknown): StoredScene {
    return parseStoredScene(scene);
  }
}
