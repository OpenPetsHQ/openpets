import type { VoiceMicrophoneReservation } from "./voice-microphone-arbiter.js";

export type VoiceAssistantActivity = "listening" | "thinking" | "acting" | "speaking";
export type VoiceAssistantSessionStatus = "idle" | "active" | "muted" | "paused" | "ending" | "ended";
export type VoiceAssistantErrorScope = "input" | "assistant" | "synthesis" | "playback" | "session";

export type VoiceAssistantSessionSnapshot = {
  readonly status: VoiceAssistantSessionStatus;
  readonly activity: VoiceAssistantActivity | null;
  readonly muted: boolean;
  readonly conversationId: string;
  readonly generation: number;
  readonly turnId: string | null;
  readonly userTranscript: string | null;
  readonly assistantTranscript: string | null;
  readonly interruptionCount: number;
  readonly error: { readonly scope: VoiceAssistantErrorScope; readonly message: string } | null;
  /** True while the current generic input stage can submit its recording. */
  readonly canSubmitRecording?: boolean;
};

export type VoiceAssistantTranscriptEvent = {
  readonly type: "transcript";
  readonly sequence: number;
  readonly turnId: string;
  readonly speaker: "user" | "assistant";
  readonly kind: "partial" | "final";
  readonly text: string;
};

export type VoiceAssistantSessionEvent =
  | { readonly type: "snapshot"; readonly sequence: number; readonly snapshot: VoiceAssistantSessionSnapshot }
  | VoiceAssistantTranscriptEvent
  | { readonly type: "error"; readonly sequence: number; readonly scope: VoiceAssistantErrorScope; readonly message: string; readonly turnId?: string }
  | { readonly type: "interrupted"; readonly sequence: number; readonly generation: number; readonly turnId: string | null }
  | { readonly type: "turn-settled"; readonly sequence: number; readonly turnId: string; readonly outcome: "completed" | "cancelled" | "failed" }
  | { readonly type: "ended"; readonly sequence: number; readonly reason: "ended" | "shutdown" };

export type VoiceAssistantSessionEventInput =
  | { readonly type: "snapshot"; readonly snapshot: VoiceAssistantSessionSnapshot }
  | Omit<VoiceAssistantTranscriptEvent, "sequence">
  | { readonly type: "error"; readonly scope: VoiceAssistantErrorScope; readonly message: string; readonly turnId?: string }
  | { readonly type: "interrupted"; readonly generation: number; readonly turnId: string | null }
  | { readonly type: "turn-settled"; readonly turnId: string; readonly outcome: "completed" | "cancelled" | "failed" }
  | { readonly type: "ended"; readonly reason: "ended" | "shutdown" };

export type VoiceAssistantSessionListener = (event: VoiceAssistantSessionEvent) => void;

export interface VoiceAssistantSessionLike {
  snapshot(): VoiceAssistantSessionSnapshot;
  subscribe(listener: VoiceAssistantSessionListener): () => void;
  start(): Promise<void>;
  retry(): Promise<void>;
  mute(): Promise<void>;
  unmute(): Promise<void>;
  interrupt(): Promise<void>;
  /** Submit the current generic recording; its terminal response ends Talk. */
  readonly submitInput?: () => Promise<boolean>;
  end(): Promise<void>;
  shutdown(): Promise<void>;
}

export type VoiceAssistantInputResult =
  | { readonly status: "completed"; readonly final: string }
  | { readonly status: "cancelled"; readonly reason?: string };

export type VoiceAssistantInputOptions = {
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly reservation: VoiceMicrophoneReservation;
  readonly onPartial?: (text: string) => void;
  readonly onSubmitAvailabilityChange?: (canSubmit: boolean) => void;
};

/** One bounded capture/transcription attempt. cancel(requestId) settles that attempt. */
export interface VoiceAssistantInput {
  listen(options: VoiceAssistantInputOptions): Promise<VoiceAssistantInputResult>;
  cancel(requestId: string, reason?: string): Promise<void>;
  /** Submit the active recording through the normal STT path. */
  submit?(requestId: string): Promise<boolean>;
}

export type VoiceAssistantTurnResult = {
  readonly status: "completed" | "cancelled" | "failed";
  readonly turnId?: string;
  /** The terminal response after all capability outcomes have been applied. */
  readonly response?: string;
  readonly error?: string;
};

export type VoiceAssistantActivityEvent = {
  readonly conversationId: string;
  readonly turnId: string;
  readonly activity: "thinking" | "acting" | "responding";
};

export interface VoiceAssistantTurnAdapter {
  startTurn(conversationId: string, text: string, signal: AbortSignal, turnId?: string): Promise<VoiceAssistantTurnResult>;
  subscribe(listener: (event: VoiceAssistantActivityEvent) => void): () => void;
}

export type VoiceAssistantSpeech =
  | { readonly kind: "audio"; readonly bytes: Uint8Array; readonly mimeType: string }
  | { readonly kind: "system"; readonly text: string };
export type VoiceAssistantSynthesisOptions = { readonly requestId: string; readonly signal: AbortSignal; readonly reason?: "user" | "session" };

export interface VoiceAssistantSynthesizer {
  synthesize(text: string, options: VoiceAssistantSynthesisOptions): Promise<VoiceAssistantSpeech>;
}

/** The player owns both decoded audio and eventual system speech, per request. */
export interface VoiceAssistantPlayer {
  play(requestId: string, speech: VoiceAssistantSpeech, signal: AbortSignal, onStarted?: () => void): Promise<void>;
  stop(requestId: string, reason?: "user" | "session"): Promise<void>;
}
