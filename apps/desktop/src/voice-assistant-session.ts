import type { VoiceMicrophoneArbiter, VoiceMicrophoneReservation } from "./voice-microphone-arbiter.js";
import type { PetAssistantModalityCoordinator, PetAssistantModalityLease } from "./pet-assistant-modality.js";
import type {
  VoiceAssistantErrorScope,
  VoiceAssistantInput,
  VoiceAssistantInputOptions,
  VoiceAssistantInputResult,
  VoiceAssistantSessionEvent,
  VoiceAssistantSessionEventInput,
  VoiceAssistantSessionLike,
  VoiceAssistantSessionListener,
  VoiceAssistantSessionSnapshot,
  VoiceAssistantSpeech,
  VoiceAssistantPlayer,
  VoiceAssistantSynthesizer,
  VoiceAssistantTurnAdapter,
  VoiceAssistantTurnResult,
} from "./voice-assistant-session-contract.js";
import { info, warn } from "./logger.js";

export type VoiceAssistantSessionOptions = {
  readonly conversationId?: string;
  readonly turnIdPrefix?: string;
  readonly microphoneArbiter: VoiceMicrophoneArbiter;
  readonly input: VoiceAssistantInput;
  readonly assistant: VoiceAssistantTurnAdapter;
  readonly synthesizer: VoiceAssistantSynthesizer;
  readonly player: VoiceAssistantPlayer;
  readonly modalityCoordinator?: PetAssistantModalityCoordinator;
};

type InputStage = {
  readonly generation: number;
  readonly requestId: string;
  readonly turnId: string;
  readonly controller: AbortController;
  promise: Promise<void>;
  cancelPromise: Promise<void> | null;
  lastPartial: string | null;
  submitRequested: boolean;
};

type TurnStage = {
  readonly generation: number;
  readonly turnId: string;
  readonly controller: AbortController;
  promise: Promise<VoiceAssistantTurnResult>;
  unsubscribe: (() => void) | null;
  readonly startedAt: number;
  cancelReason: "user" | "session" | null;
  cancelLogged: boolean;
};

type SpeechStage = {
  readonly generation: number;
  readonly requestId: string;
  readonly turnId: string;
  readonly controller: AbortController;
  readonly synthesisOptions: { readonly requestId: string; readonly signal: AbortSignal; reason?: "user" | "session" };
  synthesis: Promise<VoiceAssistantSpeech>;
  playback: Promise<void> | null;
};

const DEFAULT_CONVERSATION_ID = "voice-assistant";

/** Host-private batch voice session. No provider wire event crosses this boundary. */
export class VoiceAssistantSession implements VoiceAssistantSessionLike {
  readonly #options: VoiceAssistantSessionOptions;
  readonly #conversationId: string;
  readonly #turnIdPrefix: string;
  readonly #listeners = new Set<VoiceAssistantSessionListener>();
  #microphoneReservation: VoiceMicrophoneReservation | null = null;
  #input: InputStage | null = null;
  #turn: TurnStage | null = null;
  #speech: SpeechStage | null = null;
  #ending: Promise<void> | null = null;
  #lifecycleTail: Promise<void> = Promise.resolve();
  #snapshot: VoiceAssistantSessionSnapshot;
  #sequence = 1;
  #generation = 0;
  #started = false;
  #ended = false;
  #muted = false;
  #nextRequest = 1;
  #nextTurnOrdinal = 0;
  #modalityLease: PetAssistantModalityLease | null = null;

  constructor(options: VoiceAssistantSessionOptions) {
    this.#options = options;
    this.#conversationId = normalizeConversationId(options.conversationId ?? DEFAULT_CONVERSATION_ID);
    this.#turnIdPrefix = normalizeTurnIdPrefix(options.turnIdPrefix ?? "voice-turn");
    this.#snapshot = freeze({
      status: "idle",
      activity: null,
      muted: false,
      conversationId: this.#conversationId,
      generation: 0,
      turnId: null,
      userTranscript: null,
      assistantTranscript: null,
      interruptionCount: 0,
      error: null,
      canSubmitRecording: false,
    });
  }

  snapshot(): VoiceAssistantSessionSnapshot { return this.#snapshot; }

  subscribe(listener: VoiceAssistantSessionListener): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  start(): Promise<void> { return this.#serialize(() => this.#start()); }
  retry(): Promise<void> { return this.#serialize(() => this.#retry()); }
  mute(): Promise<void> { return this.#serialize(() => this.#mute()); }
  unmute(): Promise<void> { return this.#serialize(() => this.#unmute()); }
  interrupt(): Promise<void> { return this.#serialize(() => this.#interrupt()); }
  submitInput(): Promise<boolean> { return this.#serialize(() => this.#submitInput()); }
  end(): Promise<void> { return this.#serialize(() => this.#end("ended")); }
  shutdown(): Promise<void> { return this.#serialize(() => this.#end("shutdown")); }

  async #start(): Promise<void> {
    if (this.#ended) throw new Error("Voice assistant session has ended.");
    if (this.#started) return;
    this.#microphoneReservation = this.#options.microphoneArbiter.reserve("assistant-session");
    this.#started = true;
    this.#setSnapshot({ status: "active", activity: "listening", muted: false, error: null });
    this.#beginListen(true);
    await Promise.resolve();
  }

  async #retry(): Promise<void> {
    if (!this.#started) throw new Error("Voice assistant session has not started.");
    if (this.#ended || this.#muted || this.#snapshot.status !== "paused") return;
    this.#setSnapshot({ status: "active", activity: "listening", error: null });
    this.#beginListen(true);
    await Promise.resolve();
  }

  async #mute(): Promise<void> {
    if (!this.#started) throw new Error("Voice assistant session has not started.");
    if (this.#ended || this.#muted) return;
    this.#muted = true;
    this.#setSnapshot({ muted: true, status: "muted", activity: null, canSubmitRecording: false });
    const input = this.#input;
    if (input) {
      ++this.#generation;
      await this.#cancelInput(input, "user");
      this.#input = null;
    }
    if (!this.#turn && !this.#speech) {
      this.#modalityLease?.release();
      this.#modalityLease = null;
    }
    if (!this.#turn && !this.#speech) this.#setSnapshot({ activity: null });
  }

  async #unmute(): Promise<void> {
    if (!this.#started) throw new Error("Voice assistant session has not started.");
    if (this.#ended || !this.#muted) return;
    this.#muted = false;
    this.#setSnapshot({ muted: false, status: "active" });
    if (!this.#input && !this.#turn && !this.#speech) this.#beginListen(true);
    await Promise.resolve();
  }

  async #submitInput(): Promise<boolean> {
    if (!this.#started || this.#ended || this.#muted) return false;
    const input = this.#input;
    if (!input || !this.#options.input.submit) return false;
    if (input.submitRequested) return true;
    if (!this.#snapshot.canSubmitRecording) return false;
    // Leave the listening state before asking the capture implementation to
    // stop.  stop() may wait for renderer/capture cleanup, but the canonical
    // snapshot must make the Talk control non-recording immediately.
    input.submitRequested = true;
    this.#setSnapshot({ status: "active", activity: "thinking", canSubmitRecording: false, error: null });
    return this.#options.input.submit(input.requestId);
  }

  async #interrupt(): Promise<void> {
    if (!this.#started || this.#ended) return;
    const input = this.#input;
    const turn = this.#turn;
    const speech = this.#speech;
    ++this.#generation;
    const turnId = input?.turnId ?? turn?.turnId ?? speech?.turnId ?? null;
    this.#setSnapshot({ status: this.#muted ? "muted" : "active", activity: null, canSubmitRecording: false, interruptionCount: this.#snapshot.interruptionCount + 1 });
    this.#emit({ type: "interrupted", generation: this.#generation, turnId });
    await this.#cancelStages(input, turn, speech, "user");
    this.#input = null;
    this.#turn = null;
    this.#speech = null;
    this.#modalityLease?.release();
    this.#modalityLease = null;
    if (this.#muted) this.#setSnapshot({ status: "muted", activity: null });
    else {
      this.#setSnapshot({ status: "active", activity: "listening" });
      this.#beginListen();
    }
  }

  #beginListen(throwOnBusy = false): void {
    if (this.#ended || !this.#started || !this.#microphoneReservation || this.#muted || this.#input || this.#turn || this.#speech) return;
    let lease: PetAssistantModalityLease | null = null;
    try {
      lease = this.#options.modalityCoordinator?.acquire("voice") ?? null;
    } catch (error) {
      if (throwOnBusy) throw error;
      this.#pauseInput(errorMessage(error), true, "assistant");
      return;
    }
    this.#modalityLease = lease;
    const generation = ++this.#generation;
    const ordinal = ++this.#nextTurnOrdinal;
    const turnId = `${this.#turnIdPrefix}-${ordinal}`;
    const requestId = `voice-input-${this.#nextRequest++}`;
    const controller = new AbortController();
    this.#setSnapshot({ status: "active", activity: "listening", turnId, userTranscript: null, assistantTranscript: null, error: null, canSubmitRecording: typeof this.#options.input.submit === "function" });
    const stage: InputStage = { generation, requestId, turnId, controller, promise: Promise.resolve(), cancelPromise: null, lastPartial: null, submitRequested: false };
    const promise = Promise.resolve().then(() => this.#options.input.listen({
      requestId,
      signal: controller.signal,
      reservation: this.#microphoneReservation!,
      onPartial: (value) => {
        if (!this.#isCurrentInput(stage) || stage.submitRequested) return;
        const text = normalizeTranscript(value);
        if (!text || text === stage.lastPartial) return;
        stage.lastPartial = text;
        this.#setSnapshot({ activity: "listening", turnId, userTranscript: text, error: null });
        this.#emit({ type: "transcript", turnId, speaker: "user", kind: "partial", text });
      },
      onSubmitAvailabilityChange: (canSubmit) => {
        if (this.#isCurrentInput(stage) && !stage.submitRequested) this.#setSnapshot({ canSubmitRecording: canSubmit });
      },
    })).then((result) => {
      if (!this.#isCurrentInput(stage)) return;
      this.#finishInput(stage);
      if (result.status === "cancelled") {
        this.#pauseInput(result.reason ?? "Voice input was cancelled.", false);
        return;
      }
      const text = normalizeTranscript(result.final);
      if (!text) {
        this.#pauseInput("Voice input returned no text.");
        return;
      }
      this.#setSnapshot({ userTranscript: text, activity: "thinking", error: null });
      this.#emit({ type: "transcript", turnId, speaker: "user", kind: "final", text });
      this.#beginTurn(turnId, text);
    }).catch((error: unknown) => {
      if (!this.#isCurrentInput(stage)) return;
      this.#finishInput(stage);
      this.#pauseInput(errorMessage(error));
    });
    stage.promise = promise;
    this.#input = stage;
  }

  #beginTurn(turnId: string, text: string): void {
    if (this.#ended || this.#muted || this.#turn) return;
    const generation = ++this.#generation;
    const controller = new AbortController();
    const stage: TurnStage = { generation, turnId, controller, promise: Promise.resolve(undefined as never), unsubscribe: null, startedAt: Date.now(), cancelReason: null, cancelLogged: false };
    this.#turn = stage;
    info("voice", "brain turn requested", { turnId });
    try {
      stage.unsubscribe = this.#options.assistant.subscribe((event) => {
        if (!this.#isCurrentTurn(stage) || event.conversationId !== this.#conversationId || event.turnId !== stage.turnId) return;
        this.#setSnapshot({ activity: this.#muted ? null : event.activity === "acting" ? "acting" : "thinking", error: null });
      });
    } catch (error) {
      this.#finishTurn(stage);
      this.#emitError("assistant", errorMessage(error), turnId);
      this.#settleTurn(turnId, "failed");
      this.#endAfterTurn();
      return;
    }
    stage.promise = Promise.resolve().then(() => this.#options.assistant.startTurn(this.#conversationId, text, controller.signal, turnId));
    void stage.promise.then((result) => {
      if (!this.#isCurrentTurn(stage)) return;
      this.#finishTurn(stage);
      if (result.status === "cancelled") {
        if (!stage.cancelLogged) info("voice", "brain turn cancelled", { turnId, elapsedMs: Date.now() - stage.startedAt, reason: stage.cancelReason ?? "session" });
        this.#settleTurn(turnId, "cancelled");
        this.#endAfterTurn();
        return;
      }
      if (result.status === "failed") {
        warn("voice", "brain turn failed", { turnId, elapsedMs: Date.now() - stage.startedAt, errorCode: "assistant.turn.failed" });
        this.#emitError("assistant", result.error ?? "Pet Assistant turn failed.", turnId);
        this.#settleTurn(turnId, "failed");
        this.#endAfterTurn();
        return;
      }
      const response = normalizeTranscript(result.response ?? "");
      if (!response) {
        warn("voice", "brain turn failed", { turnId, elapsedMs: Date.now() - stage.startedAt, errorCode: "assistant.reply.empty" });
        this.#emitError("assistant", "Pet Assistant returned no response.", turnId);
        this.#settleTurn(turnId, "failed");
        this.#endAfterTurn();
        return;
      }
      info("voice", "brain turn completed", { turnId, elapsedMs: Date.now() - stage.startedAt, replyChars: response.length });
      this.#setSnapshot({ assistantTranscript: response, activity: this.#muted ? null : "thinking", error: null });
      this.#emit({ type: "transcript", turnId, speaker: "assistant", kind: "final", text: response });
      this.#beginSpeech(turnId, response);
    }, (error: unknown) => {
      if (!this.#isCurrentTurn(stage)) return;
      this.#finishTurn(stage);
      warn("voice", "brain turn failed", { turnId, elapsedMs: Date.now() - stage.startedAt, errorCode: errorCode(error) });
      this.#emitError("assistant", errorMessage(error), turnId);
      this.#settleTurn(turnId, "failed");
      this.#endAfterTurn();
    });
  }

  #beginSpeech(turnId: string, text: string): void {
    if (this.#ended) return;
    const generation = ++this.#generation;
    const requestId = `voice-output-${this.#nextRequest++}`;
    const controller = new AbortController();
    const synthesisOptions = { requestId, signal: controller.signal } as { readonly requestId: string; readonly signal: AbortSignal; reason?: "user" | "session" };
    const stage: SpeechStage = { generation, requestId, turnId, controller, synthesisOptions, synthesis: Promise.resolve(undefined as never), playback: null };
    stage.synthesis = Promise.resolve().then(() => this.#options.synthesizer.synthesize(text, synthesisOptions));
    this.#speech = stage;
    void stage.synthesis.then((speech) => {
      if (!this.#isCurrentSpeech(stage)) return;
      stage.playback = Promise.resolve().then(() => this.#options.player.play(requestId, speech, controller.signal, () => {
        if (this.#isCurrentSpeech(stage)) this.#setSnapshot({ activity: this.#muted ? null : "speaking", error: null });
      }));
      void stage.playback.then(() => {
        if (!this.#isCurrentSpeech(stage)) return;
        this.#finishSpeech(stage);
        this.#settleTurn(turnId, "completed");
        this.#endAfterTurn();
      }, (error: unknown) => {
        if (!this.#isCurrentSpeech(stage)) return;
        this.#finishSpeech(stage);
        this.#emitError("playback", errorMessage(error), turnId);
        this.#settleTurn(turnId, "failed");
        this.#endAfterTurn();
      });
    }, (error: unknown) => {
      if (!this.#isCurrentSpeech(stage)) return;
      this.#finishSpeech(stage);
      this.#emitError("synthesis", errorMessage(error), turnId);
      this.#settleTurn(turnId, "failed");
      this.#endAfterTurn();
    });
  }

  #endAfterTurn(): void {
    if (this.#ended) return;
    // Talk is a one-shot interaction.  The next capture must be created by a
    // fresh explicit activation, never by the terminal output callback.
    void this.#end("ended");
  }

  #pauseInput(message: string, emitError = true, scope: VoiceAssistantErrorScope = "input"): void {
    const normalized = message.trim() || "Voice input failed.";
    this.#setSnapshot({ status: "paused", activity: null, canSubmitRecording: false, error: { scope, message: normalized } });
    if (emitError) this.#emit({ type: "error", scope, message: normalized });
    this.#modalityLease?.release();
    this.#modalityLease = null;
  }

  async #end(reason: "ended" | "shutdown"): Promise<void> {
    if (this.#ended) return;
    if (this.#ending) return this.#ending;
    this.#ending = this.#finishEnd(reason);
    await this.#ending;
  }

  async #finishEnd(reason: "ended" | "shutdown"): Promise<void> {
    this.#ended = true;
    ++this.#generation;
    this.#setSnapshot({ status: "ending", activity: null, canSubmitRecording: false });
    const turn = this.#turn;
    await this.#cancelStages(this.#input, turn, this.#speech, "session");
    if (turn) {
      turn.unsubscribe?.();
      turn.unsubscribe = null;
    }
    // Voice owns only its capture and playback stages. The canonical
    // conversation is shared with typed chat and survives voice teardown.
    if (this.#microphoneReservation) {
      this.#options.microphoneArbiter.releaseReservation(this.#microphoneReservation);
      this.#microphoneReservation = null;
    }
    this.#input = null;
    this.#turn = null;
    this.#speech = null;
    this.#modalityLease?.release();
    this.#modalityLease = null;
    this.#setSnapshot({ status: "ended", activity: null });
    this.#emit({ type: "ended", reason });
  }

  async #cancelStages(input: InputStage | null, turn: TurnStage | null, speech: SpeechStage | null, reason: "user" | "session"): Promise<void> {
    const pending: Promise<unknown>[] = [];
    if (input) pending.push(this.#cancelInput(input, reason));
    if (turn) {
      turn.cancelReason = reason;
      if (!turn.cancelLogged) {
        turn.cancelLogged = true;
        info("voice", "brain turn cancelled", { turnId: turn.turnId, elapsedMs: Date.now() - turn.startedAt, reason });
      }
      turn.controller.abort();
      pending.push(turn.promise.catch(() => undefined));
    }
    if (speech) {
      speech.synthesisOptions.reason = reason;
      speech.controller.abort();
      pending.push(Promise.resolve().then(() => this.#options.player.stop(speech.requestId, reason)).catch(() => undefined));
      pending.push(speech.synthesis.catch(() => undefined));
      if (speech.playback) pending.push(speech.playback.catch(() => undefined));
    }
    await Promise.all(pending);
  }

  async #cancelInput(stage: InputStage, reason: "user" | "session"): Promise<void> {
    if (!stage.cancelPromise) stage.cancelPromise = this.#options.input.cancel(stage.requestId, reason).catch(() => undefined);
    stage.controller.abort();
    await Promise.all([stage.cancelPromise, stage.promise.catch(() => undefined)]);
  }

  #finishInput(stage: InputStage): void {
    if (this.#input !== stage) return;
    this.#input = null;
    this.#setSnapshot({ canSubmitRecording: false });
  }
  #finishTurn(stage: TurnStage): void { stage.unsubscribe?.(); stage.unsubscribe = null; if (this.#turn === stage) this.#turn = null; }
  #finishSpeech(stage: SpeechStage): void { if (this.#speech === stage) this.#speech = null; }

  #settleTurn(turnId: string, outcome: "completed" | "cancelled" | "failed"): void {
    this.#emit({ type: "turn-settled", turnId, outcome });
    this.#modalityLease?.release();
    this.#modalityLease = null;
  }

  #isCurrentInput(stage: InputStage): boolean { return this.#input === stage && !this.#ended && this.#generation === stage.generation; }
  #isCurrentTurn(stage: TurnStage): boolean { return this.#turn === stage && !this.#ended && this.#generation === stage.generation; }
  #isCurrentSpeech(stage: SpeechStage): boolean { return this.#speech === stage && !this.#ended && this.#generation === stage.generation; }

  #serialize<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = this.#lifecycleTail.then(operation, operation);
    this.#lifecycleTail = next.then(() => undefined, () => undefined);
    return next;
  }

  #setSnapshot(patch: Partial<VoiceAssistantSessionSnapshot>): void {
    this.#snapshot = freeze({ ...this.#snapshot, ...patch, generation: this.#generation });
    this.#emit({ type: "snapshot", snapshot: this.#snapshot });
  }

  #emitError(scope: VoiceAssistantErrorScope, message: string, turnId?: string): void {
    const normalized = message.trim() || "Voice assistant operation failed.";
    this.#setSnapshot({ error: { scope, message: normalized } });
    this.#emit({ type: "error", scope, message: normalized, ...(turnId ? { turnId } : {}) });
  }

  #emit(event: VoiceAssistantSessionEventInput): void {
    const immutable = freeze({ ...event, sequence: this.#sequence++ }) as unknown as VoiceAssistantSessionEvent;
    for (const listener of [...this.#listeners]) {
      try { listener(immutable); } catch { /* observers cannot affect cleanup */ }
    }
  }
}

function normalizeConversationId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Voice assistant conversation id must not be empty.");
  return normalized;
}

function normalizeTurnIdPrefix(value: string): string {
  const normalized = value.trim();
  if (!normalized || !/^[A-Za-z0-9_-]{1,64}$/.test(normalized)) throw new Error("Voice assistant turn id prefix is invalid.");
  return normalized;
}

function normalizeTranscript(value: string): string { return value.trim(); }
function errorMessage(error: unknown): string { return error instanceof Error && error.message ? error.message : String(error); }
function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return Object.freeze(value);
}
