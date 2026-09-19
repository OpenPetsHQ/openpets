import { join } from "node:path";
import { app, BrowserWindow } from "electron";
import { getSharedVoiceDeviceService, VOICE_MEDIA_PARTITION } from "./voice-device-service.js";
import { getVoiceMediaSession } from "./voice-device-electron.js";

export type VoiceMediaPlaybackOutcome = {
  readonly output: "selected" | "system-default";
  readonly reason?: "no-selection" | "unsupported" | "rejected";
};

type PlaybackRequest = {
  readonly requestId: string;
  readonly controller: AbortController;
  readonly signal?: AbortSignal;
  cancelled: boolean;
  started: boolean;
  stopPromise: Promise<void> | null;
  done: Promise<void>;
  resolveDone(): void;
  externalAbort: (() => void) | null;
};

let sharedPlayer: VoiceMediaPlayer | null = null;

export function getSharedVoiceMediaPlayer(): VoiceMediaPlayer {
  return sharedPlayer ??= new VoiceMediaPlayer();
}

export async function shutdownSharedVoiceMediaPlayer(): Promise<void> {
  await sharedPlayer?.shutdown();
  sharedPlayer = null;
}

export class VoiceMediaPlayer {
  #window: BrowserWindow | null = null;
  #loadPromise: Promise<void> | null = null;
  #current: PlaybackRequest | null = null;
  #transition: Promise<void> = Promise.resolve();
  #shutdownRequested = false;

  async play(
    requestId: string,
    bytes: Uint8Array,
    mimeType: string,
    signal?: AbortSignal,
    onStarted?: (outcome: VoiceMediaPlaybackOutcome) => void,
  ): Promise<VoiceMediaPlaybackOutcome> {
    if (!requestId) throw new Error("Voice playback request id is required.");
    if (this.#shutdownRequested) throw new Error("Voice media player is shut down.");

    const request = this.#createRequest(requestId, signal);
    const previous = this.#current;
    this.#current = request;
    if (previous) this.#cancelRequest(previous);

    let playback: Promise<VoiceMediaPlaybackOutcome> | null = null;
    const timeout = setTimeout(() => this.#cancelRequest(request), 120_000);
    try {
      await this.#exclusive(async () => {
        if (this.#current !== request || request.cancelled) throw replacementError();
        if (previous) await previous.done;
        this.#throwIfCancelled(request);

        const operation = await getSharedVoiceDeviceService().snapshotOperation(request.controller.signal);
        this.#throwIfCancelled(request);
        const window = await this.#ensureWindow(request.controller.signal);
        this.#throwIfCancelled(request);
        const encoded = Buffer.from(bytes).toString("base64");
        // Mark the request as renderer-owned before invoking the async script.
        // Cancellation can otherwise arrive while setSinkId()/play() is still
        // resolving and leave audio starting after replacement.
        request.started = true;
        const startPromise = this.#execute<VoiceMediaPlaybackOutcome>(
          window,
          `globalThis.__openPetsVoicePlayer.play(${JSON.stringify(encoded)}, ${JSON.stringify(mimeType)}, ${JSON.stringify(operation.outputDeviceId)})`,
        );
        const outcome = await this.#raceRequest(startPromise, request);
        this.#throwIfCancelled(request);
        onStarted?.(outcome);
        playback = this.#execute<unknown>(window, "globalThis.__openPetsVoicePlayer.wait()").then(() => outcome);
      });

      return await this.#raceRequest(playback!, request);
    } finally {
      clearTimeout(timeout);
      this.#detachSignal(request);
      if (this.#current === request) this.#current = null;
      request.resolveDone();
    }
  }

  async stop(requestId?: string): Promise<void> {
    const current = this.#current;
    if (!current || (requestId !== undefined && current.requestId !== requestId)) return;
    this.#cancelRequest(current);
    await this.#exclusive(async () => {
      await current.done;
    });
  }

  async shutdown(): Promise<void> {
    this.#shutdownRequested = true;
    const current = this.#current;
    if (current) this.#cancelRequest(current);
    await this.#exclusive(async () => {
      if (current) await current.done;
      if (this.#window && !this.#window.isDestroyed()) this.#window.destroy();
      this.#window = null;
      this.#loadPromise = null;
    });
  }

  #createRequest(requestId: string, signal?: AbortSignal): PlaybackRequest {
    const controller = new AbortController();
    let resolveDone!: () => void;
    const request: PlaybackRequest = {
      requestId,
      controller,
      signal,
      cancelled: Boolean(signal?.aborted),
      started: false,
      stopPromise: null,
      done: new Promise<void>((resolve) => { resolveDone = resolve; }),
      resolveDone: () => resolveDone(),
      externalAbort: null,
    };
    if (signal) {
      const abort = () => this.#cancelRequest(request);
      request.externalAbort = abort;
      signal.addEventListener("abort", abort, { once: true });
    }
    return request;
  }

  #detachSignal(request: PlaybackRequest): void {
    if (request.signal && request.externalAbort) {
      request.signal.removeEventListener("abort", request.externalAbort);
      request.externalAbort = null;
    }
  }

  #cancelRequest(request: PlaybackRequest): void {
    if (request.cancelled) return;
    request.cancelled = true;
    request.controller.abort();
    if (request.started && !request.stopPromise) {
      request.stopPromise = this.#stopRenderer().finally(() => undefined);
    }
  }

  async #stopRenderer(): Promise<void> {
    const window = this.#window;
    if (window && !window.isDestroyed()) {
      await this.#execute<boolean>(window, "globalThis.__openPetsVoicePlayer.stop()").catch(() => false);
    }
  }

  #throwIfCancelled(request: PlaybackRequest): void {
    if (request.cancelled || request.signal?.aborted || this.#shutdownRequested) {
      throw request.signal?.aborted ? new Error("Voice playback was cancelled.") : replacementError();
    }
  }

  async #raceRequest<T>(promise: Promise<T>, request: PlaybackRequest): Promise<T> {
    let listener: (() => void) | null = null;
    const cancellation = new Promise<never>((_resolve, reject) => {
      listener = () => reject(new Error("Voice playback was cancelled."));
      if (request.cancelled || request.signal?.aborted) listener();
      else request.controller.signal.addEventListener("abort", listener, { once: true });
    });
    try {
      return await Promise.race([promise, cancellation]);
    } catch (error) {
      // Do not release the transition while the renderer's start/wait script
      // is still running. A replacement must not start concurrently with a
      // late completion from the request it replaced.
      await promise.catch(() => undefined);
      await request.stopPromise;
      throw error;
    } finally {
      if (listener) request.controller.signal.removeEventListener("abort", listener);
    }
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#transition;
    let release!: () => void;
    this.#transition = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async #ensureWindow(signal: AbortSignal): Promise<BrowserWindow> {
    if (this.#window && !this.#window.isDestroyed()) {
      await raceAbort(this.#loadPromise ?? Promise.resolve(), signal);
      return this.#window;
    }
    getVoiceMediaSession();
    const window = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: VOICE_MEDIA_PARTITION },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    this.#window = window;
    this.#loadPromise = window.loadFile(join(app.getAppPath(), "assets", "voice-media-player.html")).then(() => undefined);
    try {
      await raceAbort(this.#loadPromise, signal);
      return window;
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      if (this.#window === window) {
        this.#window = null;
        this.#loadPromise = null;
      }
      throw error;
    }
  }

  async #execute<T>(window: BrowserWindow, script: string): Promise<T> {
    if (window.isDestroyed()) throw new Error("Voice media player window was closed.");
    return window.webContents.executeJavaScript(script, true) as Promise<T>;
  }
}

function replacementError(): Error {
  return new Error("Voice playback was replaced.");
}

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("Voice playback was cancelled.");
  let listener: (() => void) | null = null;
  const cancellation = new Promise<never>((_resolve, reject) => {
    listener = () => reject(new Error("Voice playback was cancelled."));
    signal.addEventListener("abort", listener, { once: true });
  });
  try {
    return await Promise.race([promise, cancellation]);
  } finally {
    if (listener) signal.removeEventListener("abort", listener);
  }
}
