import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, session, type Session } from "electron";

import { VOICE_DEVICE_ENUMERATION_TIMEOUT_MS, VOICE_MEDIA_PARTITION, VOICE_OUTPUT_PROBE_TIMEOUT_MS, type VoiceOutputSelectionStatus } from "./voice-device-service.js";
import type { VoiceDeviceDescription } from "./voice-device-resolver.js";
import { isVoiceMediaPermissionAllowed } from "./voice-device-permissions.js";

let configuredSession: Session | null = null;
let captureUrls: readonly string[] | null = null;
let speakerSelectionUrls: readonly string[] | null = null;

export function getVoiceMediaSession(): Session {
  const voiceSession = session.fromPartition(VOICE_MEDIA_PARTITION);
  if (configuredSession === voiceSession) return voiceSession;
  const captureUrl = pathToFileURL(join(app.getAppPath(), "assets", "voice-capture.html")).toString();
  const realtimeUrl = pathToFileURL(join(app.getAppPath(), "assets", "voice-realtime.html")).toString();
  const playerUrl = pathToFileURL(join(app.getAppPath(), "assets", "voice-media-player.html")).toString();
   captureUrls = [captureUrl, realtimeUrl];
   speakerSelectionUrls = [realtimeUrl, playerUrl];
   voiceSession.setPermissionRequestHandler((contents, permission, callback, details) => {
     callback(isVoiceMediaPermissionAllowed(
       permission as string,
       contents?.getURL() ?? "",
       details,
       captureUrls ?? [],
       speakerSelectionUrls ?? [],
     ));
   });
   voiceSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
     return isVoiceMediaPermissionAllowed(
       permission as string,
       contents?.getURL() ?? "",
       details,
       captureUrls ?? [],
       speakerSelectionUrls ?? [],
     );
  });
  configuredSession = voiceSession;
  return voiceSession;
}

export async function probeTrustedVoiceOutput(signal?: AbortSignal): Promise<VoiceOutputSelectionStatus> {
  getVoiceMediaSession();
  const htmlPath = join(app.getAppPath(), "assets", "voice-media-player.html");
  const window = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: VOICE_MEDIA_PARTITION },
  });
  try {
    const operation = (async (): Promise<VoiceOutputSelectionStatus> => {
      await window.loadFile(htmlPath);
      const supported = await window.webContents.executeJavaScript(
        "typeof HTMLAudioElement === 'function' && typeof HTMLAudioElement.prototype.setSinkId === 'function'",
        true,
      ) as boolean;
      return supported ? "supported" : "unsupported";
    })();
    return await raceWithAbortAndDeadline(operation, signal, VOICE_OUTPUT_PROBE_TIMEOUT_MS);
  } catch (error) {
    if (signal?.aborted) throw error;
    return "unavailable";
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

export async function enumerateTrustedVoiceDevices(signal?: AbortSignal): Promise<readonly VoiceDeviceDescription[]> {
  getVoiceMediaSession();
  const htmlPath = join(app.getAppPath(), "assets", "voice-capture.html");
  const window = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: VOICE_MEDIA_PARTITION },
  });
  try {
    const operation = (async () => {
      await window.loadFile(htmlPath);
      return await window.webContents.executeJavaScript("navigator.mediaDevices.enumerateDevices().then((devices) => devices.map(({ deviceId, kind, label }) => ({ deviceId, kind, label })))", true) as readonly VoiceDeviceDescription[];
    })();
    return await raceWithAbortAndDeadline(operation, signal, VOICE_DEVICE_ENUMERATION_TIMEOUT_MS);
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function raceWithAbortAndDeadline<T>(operation: Promise<T>, signal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  let abortListener: (() => void) | null = null;
  const cancellation = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(new Error("Voice device enumeration was cancelled."));
    if (signal?.aborted) abortListener();
    else signal?.addEventListener("abort", abortListener, { once: true });
  });
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("Voice device enumeration timed out.")), timeoutMs);
  });
  try {
    return await Promise.race([operation, cancellation, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortListener && signal) signal.removeEventListener("abort", abortListener);
  }
}
