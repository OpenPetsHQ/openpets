import type { PackageOperationRecovery, PackageOperationResponse, PackageOperationStatus } from "../protocol.js";

interface Operation {
  controller: AbortController;
  completion: Promise<PackageOperationResponse>;
}

function parseId(value: string): { document: string; counter: number } | undefined {
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-9][0-9]*)$/i.exec(value);
  if (!match) return undefined;
  const counter = Number(match[2]);
  if (!Number.isSafeInteger(counter)) return undefined;
  return { document: match[1], counter };
}

/** Connection-local ownership of package requests and their projected replies. */
export class PackageOperationRegistry {
  private document?: string;
  private highWater = 0;
  private readonly pending = new Map<string, Operation>();
  private readonly terminal = new Map<string, PackageOperationResponse>();
  private closed = false;
  private transitions = 0;
  private activation: Promise<void> = Promise.resolve();
  private disposal?: Promise<void>;

  activateDocument(readyRequestId: string): Promise<void> {
    const parsed = parseId(readyRequestId);
    if (!parsed) return Promise.reject(new Error("Invalid document request ID."));
    if (this.closed) return Promise.reject(new Error("Package operation registry is disposed."));
    this.transitions++;
    const transition = this.activation.then(async () => {
      if (this.closed) throw new Error("Package operation registry is disposed.");
      if (this.document !== parsed.document) {
        for (const operation of this.pending.values()) operation.controller.abort();
      }
      await Promise.all([...this.pending.values()].map((operation) => operation.completion));
      if (this.closed) throw new Error("Package operation registry is disposed.");
      if (this.document !== parsed.document) {
        this.document = parsed.document;
        this.highWater = 0;
        this.terminal.clear();
      }
    });
    this.activation = transition.then(() => undefined, () => undefined);
    return transition.finally(() => { this.transitions--; });
  }

  run(operationId: string, operation: (signal: AbortSignal) => Promise<PackageOperationResponse>): Promise<PackageOperationResponse> {
    const parsed = parseId(operationId);
    if (this.closed || this.transitions || !parsed || parsed.document !== this.document || parsed.counter <= this.highWater) {
      return Promise.reject(new Error("Package operation ID is unavailable."));
    }
    if (this.pending.size >= 32) return Promise.reject(new Error("Too many pending package operations."));
    this.highWater = parsed.counter;
    const controller = new AbortController();
    const completion = Promise.resolve().then(() => operation(controller.signal)).catch((): PackageOperationResponse => ({
      ok: false,
      error: { message: "Package operation outcome is unknown.", outcome: "unknown" },
    })).then((response) => {
      this.pending.delete(operationId);
      this.terminal.set(operationId, response);
      while (this.terminal.size > 32) this.terminal.delete(this.terminal.keys().next().value!);
      return response;
    });
    this.pending.set(operationId, { controller, completion });
    return completion;
  }

  status(operationId: string): PackageOperationStatus {
    const parsed = parseId(operationId);
    if (this.closed || !parsed || parsed.document !== this.document) return { status: "unavailable" };
    if (this.pending.has(operationId)) return { status: "pending" };
    const response = this.terminal.get(operationId);
    return response ? { status: "terminal", response } : { status: "unavailable" };
  }

  async recover(operationId: string): Promise<PackageOperationRecovery> {
    const parsed = parseId(operationId);
    if (this.closed || !parsed || parsed.document !== this.document) return { status: "unavailable" };
    const operation = this.pending.get(operationId);
    if (operation) {
      operation.controller.abort();
      return { status: "terminal", response: await operation.completion };
    }
    const response = this.terminal.get(operationId);
    if (response) return { status: "terminal", response };
    this.highWater = Math.max(this.highWater, parsed.counter);
    return { status: "unavailable" };
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closed = true;
    for (const operation of this.pending.values()) operation.controller.abort();
    this.disposal = Promise.all([...this.pending.values()].map((operation) => operation.completion)).then(() => {
      this.terminal.clear();
    });
    return this.disposal;
  }
}
