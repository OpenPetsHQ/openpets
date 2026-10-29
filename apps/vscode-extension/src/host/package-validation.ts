import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { CodexPetMetadata } from "@open-pets/pet-format/metadata";
import type { PetSpriteLayout } from "@open-pets/pet-format/sprite-layout";

export interface ValidatedPetPackage {
  readonly metadata: CodexPetMetadata;
  readonly layout: PetSpriteLayout;
  /** All declared outfits have been validated in this exact package. */
  readonly availableOutfitIds: readonly string[];
}

export interface ValidationWorkerRequest {
  readonly root: string;
  readonly expectedId: string;
  readonly decoderDirectory: string;
}

export type ValidationWorkerResponse =
  | { readonly ok: true; readonly value: ValidatedPetPackage }
  | { readonly ok: false; readonly message: string };

const validationTimeoutMs = 60_000;

/** One worker per package. Every terminal path waits for worker termination. */
export async function validatePetPackage(
  root: string,
  expectedId: string,
  signal?: AbortSignal,
): Promise<ValidatedPetPackage> {
  if (signal?.aborted) throw new Error("Pet package validation was cancelled.");
  const request: ValidationWorkerRequest = {
    root,
    expectedId,
    decoderDirectory: join(__dirname, "decoder"),
  };
  const worker = new Worker(join(__dirname, "validation-worker.cjs"), {
    workerData: request,
    // Extension-host and test-runner flags are not valid worker entry flags.
    execArgv: [],
  });

  return new Promise<ValidatedPetPackage>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Pet package validation timed out.")), validationTimeoutMs);

    function finish(error?: Error, value?: ValidatedPetPackage): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      worker.removeListener("message", onMessage);
      void worker.terminate().then(() => {
        worker.removeListener("error", onError);
        worker.removeListener("exit", onExit);
        if (error) reject(error);
        else if (value) resolve(value);
        else reject(new Error("Pet package validation returned no result."));
      }, (terminationError: unknown) => {
        worker.removeListener("error", onError);
        worker.removeListener("exit", onExit);
        reject(terminationError instanceof Error ? terminationError : new Error("Pet validation worker termination failed."));
      });
    }

    function onAbort(): void { finish(new Error("Pet package validation was cancelled.")); }
    function onError(error: Error): void { finish(error); }
    function onExit(code: number): void { finish(new Error(`Pet validation worker exited before responding (${code}).`)); }
    function onMessage(response: ValidationWorkerResponse): void {
      if (response.ok) finish(undefined, response.value);
      else finish(new Error(response.message));
    }

    worker.once("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
