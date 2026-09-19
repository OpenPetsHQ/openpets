import { getDefaultPetWindowForPlugins } from "./default-pet-controller.js";
import { speakPetWindowTts, stopPetWindowTts } from "./pet-window.js";
import type { PluginAiGateway } from "./plugin-ai-gateway.js";
import { createElectronVoiceCaptureFactory } from "./voice-capture-electron.js";
import type { VoiceCaptureService } from "./voice-capture.js";
import { VoiceListeningService } from "./voice-listening-service.js";
import { VoiceOperationState, type VoiceOperationSnapshot } from "./voice-operation-state.js";
import { VoicePrivacyIndicator } from "./voice-privacy-indicator.js";
import { VoiceResourceOwner } from "./voice-resource-owner.js";
import type { VoiceMicrophoneArbiter } from "./voice-microphone-arbiter.js";
import { getSharedVoiceDeviceService } from "./voice-device-service.js";
import { getSharedVoiceMediaPlayer, shutdownSharedVoiceMediaPlayer } from "./voice-media-player.js";
import type { VoiceOperationPhase } from "./voice-operation-state.js";

/**
 * Plugin voice (§13.5). TTS uses configured MiniMax speech synthesis when
 * available, with the renderer's OS voice as a fallback. STT is strictly
 * one-shot push-to-talk: a
 * dedicated capture window records a bounded clip in its own session (the only
 * session granted microphone permission), and the clip is transcribed through
 * the user's configured AI provider. Never ambient.
 */

let ttsRequestGeneration = 0;

export async function pluginVoiceSpeak(gateway: PluginAiGateway, text: string, opts: { voice?: string; rate?: number }): Promise<void> {
  const window = getDefaultPetWindowForPlugins();
  if (!window) throw new Error("No pet window is available for speech.");
  const requestGeneration = ++ttsRequestGeneration;
  const speech = await gateway.synthesizeSpeech(text, opts);
  if (requestGeneration !== ttsRequestGeneration) return;
  if (speech) {
    stopPetWindowTts(window);
    const requestId = `plugin-voice-${requestGeneration}`;
    void getSharedVoiceMediaPlayer().play(requestId, speech.bytes, speech.mimeType).catch(() => undefined);
    return;
  }
  await getSharedVoiceMediaPlayer().stop();
  speakPetWindowTts(window, text, opts);
}

export function pluginVoiceStop(): void {
  ttsRequestGeneration++;
  const window = getDefaultPetWindowForPlugins();
  if (window) {
    stopPetWindowTts(window);
  }
  void getSharedVoiceMediaPlayer().stop();
}

let activeListeningService: VoiceListeningService | null = null;
let activePluginId: string | undefined;
let initializingPluginListen: { readonly pluginId?: string; readonly controller: AbortController; readonly reservation: symbol } | null = null;
const voiceResources = new VoiceResourceOwner({
  captureFactory: createElectronVoiceCaptureFactory(),
  privacyIndicator: new VoicePrivacyIndicator(),
});
const voiceOperationState = new VoiceOperationState();
let pluginVoiceShutdownPromise: Promise<void> | null = null;

export function getPluginVoiceOperation(): VoiceOperationSnapshot | null {
  return voiceOperationState.snapshot();
}

export function subscribePluginVoiceOperation(listener: () => void): () => void {
  return voiceOperationState.subscribe(listener);
}

/** Shared host-owned resources used by every voice lane. */
export function getSharedVoiceMicrophoneArbiter(): VoiceMicrophoneArbiter {
  return voiceResources.microphoneArbiter;
}

export function getSharedVoiceCaptureService(): VoiceCaptureService {
  return voiceResources.capture();
}

export type SharedVoiceOperationReservation = {
  readonly reservation: symbol;
  begin(cancel: () => Promise<void>): void;
  setPhase(phase: VoiceOperationPhase): void;
  settle(): void;
  release(): void;
};

export function reserveSharedVoiceOperation(): SharedVoiceOperationReservation {
  const reservation = voiceOperationState.reserve();
  let released = false;
  return {
    reservation,
    begin: (cancel) => voiceOperationState.begin(cancel, reservation),
    setPhase: (phase) => voiceOperationState.setPhase(phase),
    settle: () => voiceOperationState.settle(),
    release: () => {
      if (released) return;
      released = true;
      voiceOperationState.releaseReservation(reservation);
    },
  };
}

export function getSharedVoicePrivacyIndicator() {
  return voiceResources.privacyIndicator;
}

export async function pluginVoiceListen(gateway: PluginAiGateway, opts: { timeoutMs: number; pluginId?: string }): Promise<{ text: string }> {
  if (activeListeningService || initializingPluginListen) throw new Error("A voice capture is already in progress.");
  const reservation = voiceOperationState.reserve();
  const controller = new AbortController();
  initializingPluginListen = { pluginId: opts.pluginId, controller, reservation };
  activePluginId = opts.pluginId;
  try {
    const deviceOperation = await getSharedVoiceDeviceService().snapshotOperation(controller.signal);
    if (controller.signal.aborted) throw new Error("Voice capture was cancelled before microphone acquisition.");
    const transcribe = await gateway.beginTranscriptionOperation();
    if (controller.signal.aborted) throw new Error("Voice capture was cancelled before microphone acquisition.");
    const service = new VoiceListeningService(
      voiceResources.capture(),
      (capture, signal) => transcribe(capture.bytes, capture.mimeType, signal),
      { onPhaseChange: (phase) => voiceOperationState.setPhase(phase) },
    );
    activeListeningService = service;
    initializingPluginListen = null;
    voiceOperationState.begin(() => service.cancel(), reservation);
    return await service.listenOnce(opts.timeoutMs, undefined, deviceOperation.inputDeviceId);
  } finally {
    if (initializingPluginListen?.reservation === reservation) initializingPluginListen = null;
    if (activeListeningService) {
      activeListeningService = null;
      activePluginId = undefined;
      voiceOperationState.settle();
    } else {
      voiceOperationState.releaseReservation(reservation);
      activePluginId = undefined;
    }
  }
}

export async function cancelPluginVoiceListen(pluginId?: string, reason = "Voice capture was cancelled."): Promise<void> {
  if (pluginId && activePluginId !== pluginId) return;
  if (initializingPluginListen) {
    initializingPluginListen.controller.abort(reason);
    return;
  }
  if (!activeListeningService) return;
  await activeListeningService.cancel(reason).catch(() => undefined);
}

export function shutdownPluginVoice(): Promise<void> {
  if (pluginVoiceShutdownPromise) return pluginVoiceShutdownPromise;
  pluginVoiceShutdownPromise = (async () => {
    initializingPluginListen?.controller.abort("OpenPets is shutting down.");
    voiceOperationState.cancelReservation();
    if (activeListeningService) await activeListeningService.shutdown().catch(() => undefined);
    await voiceResources.shutdown();
    await shutdownSharedVoiceMediaPlayer();
    activeListeningService = null;
    activePluginId = undefined;
  })();
  return pluginVoiceShutdownPromise;
}
