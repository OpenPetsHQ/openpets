import { getSharedVoiceCaptureService, getSharedVoiceMicrophoneArbiter, reserveSharedVoiceOperation } from "./plugin-voice.js";
import { VoiceListeningService, type VoiceTranscriber } from "./voice-listening-service.js";
import { getSharedVoiceDeviceService } from "./voice-device-service.js";
import type { VoiceMicrophoneReservation } from "./voice-microphone-arbiter.js";

export const PROVIDER_TEST_RECORDING_DURATION_MS = 30_000;

export type ProviderTranscriptionTestSession = {
  readonly result: Promise<{ readonly text: string }>;
  finish(): Promise<{ readonly text: string }>;
  cancel(reason?: string): Promise<void>;
};

type Deferred<T> = {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

/**
 * Reserve both host voice ownership and the microphone before starting any
 * asynchronous setup. The returned session is live while device enumeration
 * is pending, so renderer loss and modal cancellation can stop that setup too.
 */
export function startProviderTranscriptionTest(
  transcriber: VoiceTranscriber,
): ProviderTranscriptionTestSession {
  const operation = reserveSharedVoiceOperation();
  const arbiter = getSharedVoiceMicrophoneArbiter();
  let microphoneReservation: VoiceMicrophoneReservation;
  try {
    microphoneReservation = arbiter.reserve("listen");
  } catch (error) {
    operation.settle();
    operation.release();
    throw error;
  }
  const controller = new AbortController();
  const result = deferred<{ readonly text: string }>();
  const ready = deferred<VoiceListeningService>();
  void ready.promise.catch(() => undefined);

  let service: VoiceListeningService | null = null;
  let cleanedUp = false;
  let cancelled = false;

  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    operation.settle();
    operation.release();
    arbiter.releaseReservation(microphoneReservation);
  };

  const cancelInternal = async (reason: string): Promise<void> => {
    cancelled = true;
    controller.abort(reason);
    await service?.cancel(reason).catch(() => undefined);
  };

  // Install the cancellation hook before device resolution begins. This is
  // deliberately not deferred until VoiceListeningService owns a recording.
  operation.begin(() => cancelInternal("Provider transcription test was cancelled."));

  const initialization = (async (): Promise<void> => {
    try {
      const device = await getSharedVoiceDeviceService().snapshotOperation(controller.signal);
      if (cancelled || controller.signal.aborted) {
        throw new Error("Provider transcription test was cancelled.");
      }

      service = new VoiceListeningService(
        getSharedVoiceCaptureService(),
        transcriber,
        { onPhaseChange: (phase) => operation.setPhase(phase) },
      );
      ready.resolve(service);

      const listeningResult = service.listenOnce(
        PROVIDER_TEST_RECORDING_DURATION_MS,
        microphoneReservation,
        device.inputDeviceId,
      );
      result.resolve(await listeningResult);
    } catch (error) {
      ready.reject(error);
      result.reject(error);
    } finally {
      cleanup();
    }
  })();
  void initialization.catch(() => undefined);

  const session: ProviderTranscriptionTestSession = {
    result: result.promise,
    finish: async () => {
      const listeningService = await ready.promise;
      await listeningService.submit();
      return result.promise;
    },
    cancel: async (reason = "Provider transcription test was cancelled.") => {
      await cancelInternal(reason);
      await result.promise.catch(() => undefined);
    },
  };
  void result.promise.catch(() => undefined);
  return session;
}

function deferred<T>(): Deferred<T> {
  let resolveValue!: (value: T) => void;
  let rejectValue!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
}
