export type ProviderTestCancellationSession = {
  readonly senderId: number;
  readonly session: { cancel(reason?: string): Promise<void> };
};

/** Serializes replacement startup for one Control Center sender. */
export class ProviderTestReplacementLanes {
  readonly #lanes = new Map<number, Promise<void>>();

  enqueue<T>(senderId: number, operation: () => Promise<T>): Promise<T> {
    const previous = this.#lanes.get(senderId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const settled = current.then(() => undefined, () => undefined);
    this.#lanes.set(senderId, settled);
    return current.finally(() => {
      if (this.#lanes.get(senderId) === settled) this.#lanes.delete(senderId);
    });
  }

  async waitForAll(): Promise<void> {
    await Promise.all([...this.#lanes.values()]);
  }
}

export function registerProviderTestInitialization(
  initializations: Map<number, Set<AbortController>>,
  senderId: number,
  controller: AbortController,
): () => void {
  let pending = initializations.get(senderId);
  if (!pending) {
    pending = new Set();
    initializations.set(senderId, pending);
  }
  pending.add(controller);
  return () => {
    pending?.delete(controller);
    if (pending?.size === 0) initializations.delete(senderId);
  };
}

export async function cancelProviderTranscriptionTestsForSender(
  senderId: number,
  reason: string,
  initializations: Map<number, Set<AbortController>>,
  sessions: Map<string, ProviderTestCancellationSession>,
  exceptController?: AbortController,
): Promise<void> {
  for (const controller of initializations.get(senderId) ?? []) {
    if (controller !== exceptController) controller.abort(reason);
  }
  const entries = [...sessions.entries()].filter(([, entry]) => entry.senderId === senderId);
  for (const [id, entry] of entries) {
    sessions.delete(id);
    await entry.session.cancel(reason).catch(() => undefined);
  }
}
