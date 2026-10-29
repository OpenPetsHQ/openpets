import { Worker } from "node:worker_threads";
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

type Operation = "initialize" | "recover" | "read" | "mutate" | "close";
interface Pending {
  id: number;
  operation: Operation;
  resolve(scene: StoredScene | undefined): void;
  reject(error: Error): void;
}

export class SceneStore {
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
      const scene = this.requireScene(await this.request(this.initialized ? "recover" : "initialize"));
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
          else pending.resolve(parseStoredScene(reply.scene));
        } catch (error) {
          if (pending.operation === "mutate") {
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
          this.options.log?.(`[scene] connection failed: ${reply.error.message}`);
          this.worker = undefined;
          this.connectionInitialized = false;
          this.needsRead = true;
          this.generation++;
          worker.removeAllListeners();
          this.retirement = worker.terminate().then(() => undefined).catch((failure: unknown) => {
            this.options.log?.(`[scene] worker termination failed: ${String(failure)}`);
            throw failure;
          });
          void this.retirement.catch(() => { /* Recovery observes the rejection. */ });
          pending.reject(pending.operation === "mutate"
            ? new SceneMutationOutcomeUnknownError()
            : new Error(reply.error.message));
        } else {
          pending.reject(new Error(reply.error.message));
        }
      } else {
        if (pending.operation === "mutate") {
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
      if (pending?.operation === "mutate") {
        this.needsRead = true;
        pending.reject(new SceneMutationOutcomeUnknownError());
      } else pending?.reject(error);
      worker.removeAllListeners();
      this.retirement = worker
        .terminate().then(() => undefined)
        .catch((failure: unknown) => {
          this.options.log?.(`[scene] worker termination failed: ${String(failure)}`);
          throw failure;
        });
      void this.retirement.catch(() => { /* Recovery observes the rejection. */ });
    };
    worker.on("error", failed);
    worker.on("exit", (code) =>
      failed(new Error(`Scene worker exited (${code}).`)),
    );
  }

  private request(
    operation: Operation,
    command?: SceneStoreCommand,
  ): Promise<StoredScene | undefined> {
    const worker = this.worker;
    if (!worker)
      return Promise.reject(
        new Error("Scene worker is unavailable; refresh before retrying."),
      );
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending = { id, operation, resolve, reject };
      try {
        worker.postMessage({ id, operation, ...(command ? { command } : {}) });
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

  private requireScene(scene: StoredScene | undefined): StoredScene {
    if (!scene) throw new Error("Scene worker returned no scene.");
    return scene;
  }
}
