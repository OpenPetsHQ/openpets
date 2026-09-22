import type { PetAssistantService } from "./pet-assistant-service.js";
import type { HostProviderOperations } from "./provider-service.js";
import type { VoiceAssistantInput, VoiceAssistantInputOptions, VoiceAssistantInputResult, VoiceAssistantSpeech, VoiceAssistantSessionEvent, VoiceAssistantSessionLike, VoiceAssistantSynthesizer, VoiceAssistantTurnAdapter, VoiceAssistantTurnResult } from "./voice-assistant-session-contract.js";
import type { VoiceCaptureService } from "./voice-capture.js";
import { VoiceListeningService } from "./voice-listening-service.js";
import type { VoiceDeviceService } from "./voice-device-service.js";
import { info, warn } from "./logger.js";

const HOST_RECORDING_DURATION_MS = 10_000;

export type VoiceAssistantHostInstance = {
  readonly session: VoiceAssistantSessionLike;
  readonly sessionId?: number;
  shutdown(): Promise<void>;
};

export type VoiceAssistantHostEvent = VoiceAssistantSessionEvent & { readonly sessionId: number };

/** Owns activation scope; ended sessions are discarded before the next activation. */
export class VoiceAssistantHostController {
  readonly #create: () => VoiceAssistantHostInstance;
  #active: VoiceAssistantHostInstance | null = null;
  #transition: Promise<void> = Promise.resolve();
  #stopped = false;
  readonly #listeners = new Set<(event: VoiceAssistantHostEvent) => void>();
  #unsubscribeSession: (() => void) | null = null;

  constructor(create: () => VoiceAssistantHostInstance) {
    this.#create = create;
  }

  get session(): VoiceAssistantSessionLike | null { return this.#active?.session ?? null; }

  subscribe(listener: (event: VoiceAssistantHostEvent) => void): () => void {
    this.#listeners.add(listener);
    if (this.#active) listener({ type: "snapshot", sequence: 0, snapshot: this.#active.session.snapshot(), sessionId: this.#active.sessionId ?? 0 });
    return () => { this.#listeners.delete(listener); };
  }

  activate(): Promise<VoiceAssistantSessionLike> {
    if (this.#stopped) return Promise.reject(new Error("Voice assistant host has stopped."));
    const next = this.#transition.then(async () => {
      if (this.#stopped) throw new Error("Voice assistant host has stopped.");
      if (this.#active && this.#active.session.snapshot().status === "ended") {
        this.#unsubscribeSession?.();
        this.#unsubscribeSession = null;
        await this.#active.shutdown();
        this.#active = null;
      }
      if (!this.#active) {
        const created = this.#create();
        this.#active = created;
        this.#unsubscribeSession = created.session.subscribe((event) => {
          if (event.type === "ended") info("voice", "talk session ended", { sessionId: created.sessionId ?? 0, reason: event.reason });
          const sessionEvent = { ...event, sessionId: created.sessionId ?? 0 } as VoiceAssistantHostEvent;
          for (const listener of [...this.#listeners]) {
            try { listener(sessionEvent); } catch { /* observers cannot affect session cleanup */ }
          }
        });
        try { await created.session.start(); info("voice", "talk session started", { sessionId: created.sessionId ?? 0 }); }
        catch (error) { this.#unsubscribeSession?.(); this.#unsubscribeSession = null; await created.shutdown().catch(() => undefined); this.#active = null; throw error; }
      }
      return this.#active.session;
    });
    this.#transition = next.then(() => undefined, () => undefined);
    return next;
  }

  toggle(): Promise<VoiceAssistantSessionLike | null> {
    if (this.#stopped) return Promise.reject(new Error("Voice assistant host has stopped."));
    const next = this.#transition.then(async () => {
      if (this.#stopped) throw new Error("Voice assistant host has stopped.");
      const active = this.#active;
      if (active && active.session.snapshot().status !== "ended") {
        const snapshot = active.session.snapshot();
        if (snapshot.status === "paused") {
          // A paused one-shot has no active work.  Let the next explicit Talk
          // click discard it and create the fresh session it represents.
          await active.session.end();
          await active.shutdown();
          this.#unsubscribeSession?.();
          this.#unsubscribeSession = null;
          if (this.#active === active) this.#active = null;
        } else {
          if (snapshot.canSubmitRecording && active.session.submitInput) {
            await active.session.submitInput();
          }
          // Talk is a recording toggle, not a destructive session toggle.  A
          // second click submits generic recording; later clicks are harmless
          // while STT, the assistant, synthesis, or playback owns the turn.
          return active.session;
        }
      }
      if (this.#active && this.#active.session.snapshot().status === "ended") {
        this.#unsubscribeSession?.();
        this.#unsubscribeSession = null;
        await this.#active.shutdown();
        this.#active = null;
      }
      const created = this.#create();
      this.#active = created;
      this.#unsubscribeSession = created.session.subscribe((event) => {
        if (event.type === "ended") info("voice", "talk session ended", { sessionId: created.sessionId ?? 0, reason: event.reason });
        const sessionEvent = { ...event, sessionId: created.sessionId ?? 0 } as VoiceAssistantHostEvent;
        for (const listener of [...this.#listeners]) {
          try { listener(sessionEvent); } catch { /* observers cannot affect session cleanup */ }
        }
      });
      try { await created.session.start(); info("voice", "talk session started", { sessionId: created.sessionId ?? 0 }); }
      catch (error) { this.#unsubscribeSession?.(); this.#unsubscribeSession = null; await created.shutdown().catch(() => undefined); this.#active = null; throw error; }
      return created.session;
    });
    this.#transition = next.then(() => undefined, () => undefined);
    return next;
  }

  end(): Promise<void> {
    const next = this.#transition.then(async () => {
      const active = this.#active;
      if (!active) return;
      await active.session.end();
      await active.shutdown();
      this.#unsubscribeSession?.();
      this.#unsubscribeSession = null;
      if (this.#active === active) this.#active = null;
    });
    this.#transition = next.then(() => undefined, () => undefined);
    return next;
  }

  shutdown(): Promise<void> {
    this.#stopped = true;
    const next = this.#transition.then(async () => {
      const active = this.#active;
      this.#active = null;
      this.#unsubscribeSession?.();
      this.#unsubscribeSession = null;
      await active?.shutdown();
    });
    this.#transition = next.then(() => undefined, () => undefined);
    return next;
  }
}

export class HostVoiceInput implements VoiceAssistantInput {
  readonly #provider: HostProviderOperations;
  readonly #capture: VoiceCaptureService;
  readonly #devices: VoiceDeviceService | null;
  #active: { readonly requestId: string; readonly service: VoiceListeningService; cancelReason: "user" | "session" | "capture" | null } | null = null;
  readonly #cancelReasons = new Map<string, "user" | "session" | "capture">();
  readonly #pendingSubmissions = new Set<string>();

  constructor(provider: HostProviderOperations, capture: VoiceCaptureService, devices?: VoiceDeviceService) {
    this.#provider = provider;
    this.#capture = capture;
    this.#devices = devices ?? null;
  }

  async listen(options: VoiceAssistantInputOptions): Promise<VoiceAssistantInputResult> {
    if (this.#active) throw new Error("A voice capture is already in progress.");
    if (options.signal.aborted) return { status: "cancelled", reason: "Voice input was cancelled." };
    const startedAt = Date.now();
    info("voice", "stt requested");
    try {
      const deviceOperation = this.#devices
        ? await this.#devices.snapshotOperation(options.signal)
        : { inputDeviceId: null };
      const snapshot = await this.#provider.snapshot("stt");
      if (options.signal.aborted) return this.#cancelledStt(startedAt, this.#cancelReasons.get(options.requestId) ?? "session");
      const service = new VoiceListeningService(this.#capture, async (capture, signal) => options.signal.aborted ? "" : await this.#provider.transcribe(snapshot, capture.bytes, capture.mimeType, signal), {
        onPhaseChange: (phase) => options.onSubmitAvailabilityChange?.(phase !== "transcribing"),
      });
      this.#active = { requestId: options.requestId, service, cancelReason: null };
      const resultPromise = service.listenOnce(HOST_RECORDING_DURATION_MS, options.reservation, deviceOperation.inputDeviceId);
      if (this.#pendingSubmissions.delete(options.requestId)) {
        void this.#submitActive(this.#active, options.requestId).catch(() => undefined);
      }
      const result = await resultPromise;
      if (options.signal.aborted) return this.#cancelledStt(startedAt, this.#active?.cancelReason ?? "session");
      info("voice", "stt succeeded", { elapsedMs: Date.now() - startedAt, transcriptChars: result.text.length });
      return { status: "completed", final: result.text };
    } catch (error) {
      if (options.signal.aborted) return this.#cancelledStt(startedAt, this.#active?.cancelReason ?? this.#cancelReasons.get(options.requestId) ?? "session");
      if (isCancellation(error)) return this.#cancelledStt(startedAt, cancellationReason(error));
      warn("voice", "stt failed", { elapsedMs: Date.now() - startedAt, errorCode: errorCode(error) });
      throw error;
    } finally {
      if (this.#active?.requestId === options.requestId) this.#active = null;
      this.#cancelReasons.delete(options.requestId);
      this.#pendingSubmissions.delete(options.requestId);
    }
  }

  async cancel(requestId: string, reason = "user"): Promise<void> {
    const category = cancellationCategory(reason);
    if (this.#active?.requestId !== requestId) {
      this.#cancelReasons.set(requestId, category);
      return;
    }
    this.#active.cancelReason = category;
    await this.#active.service.cancel(reason);
  }

  async submit(requestId: string): Promise<boolean> {
    const active = this.#active;
    if (!active) {
      this.#pendingSubmissions.add(requestId);
      info("voice", "capture submit requested", { requestId });
      return true;
    }
    if (active.requestId !== requestId) return false;
    info("voice", "capture submit requested", { requestId });
    return this.#submitActive(active, requestId);
  }

  async #submitActive(active: { readonly requestId: string; readonly service: VoiceListeningService; cancelReason: "user" | "session" | "capture" | null }, requestId: string): Promise<boolean> {
    try {
      const submitted = await active.service.submit();
      if (!submitted) {
        warn("voice", "capture submit failed", { requestId, errorCode: "voice.capture.submit.unavailable" });
        return false;
      }
      info("voice", "capture submit succeeded", { requestId });
      return true;
    } catch (error) {
      warn("voice", "capture submit failed", { requestId, errorCode: errorCode(error) ?? "voice.capture.submit.failed" });
      throw error;
    }
  }

  #cancelledStt(startedAt: number, reason: "user" | "session" | "capture"): VoiceAssistantInputResult {
    info("voice", "stt cancelled", { elapsedMs: Date.now() - startedAt, reason });
    return { status: "cancelled", reason: "Voice input was cancelled." };
  }
}

export class ProviderVoiceSynthesizer implements VoiceAssistantSynthesizer {
  readonly #provider: HostProviderOperations;

  constructor(provider: HostProviderOperations) {
    this.#provider = provider;
  }

  async synthesize(text: string, options: { readonly requestId: string; readonly signal: AbortSignal; readonly reason?: "user" | "session" }): Promise<VoiceAssistantSpeech> {
    const startedAt = Date.now();
    info("voice", "speech synthesis requested");
    try {
      const snapshot = await this.#provider.snapshot("tts");
      const voice = snapshot.profile.adapter === "minimax-tts" || snapshot.profile.adapter === "elevenlabs-tts" || snapshot.profile.adapter === "openai-compatible-speech" ? snapshot.profile.voice : undefined;
      const speech = await this.#provider.synthesize(snapshot, text, { voice }, options.signal);
      info("voice", "speech synthesis returned", { elapsedMs: Date.now() - startedAt, ...(speech ? { mimeType: speech.mimeType, byteCount: speech.bytes.byteLength } : { kind: "system" }) });
      return speech ? { kind: "audio", bytes: speech.bytes, mimeType: speech.mimeType } : { kind: "system", text };
    } catch (error) {
      if (options.signal.aborted || errorCode(error) === "provider.cancelled") info("voice", "speech synthesis cancelled", { elapsedMs: Date.now() - startedAt, reason: options.reason ?? "session" });
      else warn("voice", "speech synthesis failed", { elapsedMs: Date.now() - startedAt, errorCode: errorCode(error) });
      throw error;
    }
  }
}

function isCancellation(error: unknown): boolean {
  return errorCode(error) === "provider.cancelled" || (error instanceof Error && /cancelled|canceled/i.test(error.message));
}

function cancellationReason(error: unknown): "user" | "session" | "capture" {
  const message = error instanceof Error ? error.message : "";
  if (/shutdown|session|ended/i.test(message)) return "session";
  if (/capture|microphone|recording/i.test(message)) return "capture";
  return "user";
}

function cancellationCategory(reason: string): "user" | "session" | "capture" {
  if (/shutdown|session|ended/i.test(reason)) return "session";
  if (/capture|microphone|recording/i.test(reason)) return "capture";
  return "user";
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export class PetAssistantVoiceAdapter implements VoiceAssistantTurnAdapter {
  readonly #assistant: PetAssistantService;

  constructor(assistant: PetAssistantService) {
    this.#assistant = assistant;
  }

  startTurn(conversationId: string, text: string, signal: AbortSignal, turnId?: string): Promise<VoiceAssistantTurnResult> {
    return this.#assistant.startTurn(conversationId, text, signal, turnId === undefined ? {} : { turnId }).then((result) => ({ status: result.status, turnId: result.turnId, ...(result.response === undefined ? {} : { response: result.response }), ...(result.error === undefined ? {} : { error: result.error }) }));
  }

  subscribe(listener: (event: { readonly conversationId: string; readonly turnId: string; readonly activity: "thinking" | "acting" | "responding" }) => void): () => void {
    return this.#assistant.subscribe((event) => {
      if (event.type !== "activity" || (event.activity !== "thinking" && event.activity !== "acting" && event.activity !== "responding")) return;
      listener({ conversationId: event.conversationId, turnId: event.turnId, activity: event.activity });
    });
  }

}

export function reactionForVoiceActivity(activity: "listening" | "thinking" | "acting" | "speaking"): "waiting" | "thinking" | "working" | "running" {
  if (activity === "listening") return "waiting";
  if (activity === "acting") return "working";
  if (activity === "speaking") return "running";
  return "thinking";
}
