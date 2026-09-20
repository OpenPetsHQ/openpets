import { app } from "electron";
import { closeAllAgentPets } from "./agent-pet-controller.js";
import { destroyDefaultPet } from "./default-pet-controller.js";
import { info } from "./logger.js";
import { stopLocalIpcServer } from "./local-ipc.js";
import { stopRemoteControlService } from "./remote-control-service.js";
import { closeAllLanVisitingPets } from "./lan-pet-controller.js";
import { stopPluginService } from "./plugin-service.js";
import { stopPetAssistantHost } from "./pet-assistant-host.js";
import { stopVoiceAssistantHost } from "./voice-assistant-host.js";
import { shutdownPluginVoice } from "./plugin-voice.js";
import { parseTeamEnrollmentLink, type TeamEnrollmentLink } from "./team-protocol.js";
import { focusOpenTaskWindows } from "./windows.js";
import { shutdownVoiceAssistantShortcut } from "./voice-assistant-shortcut.js";

let intentionalQuit = false;
let cleanupStarted = false;
let cleanupFinished = false;
let hardExitTimer: NodeJS.Timeout | null = null;

export type AppLifecycleOptions = {
  readonly onTeamEnrollmentLink?: (link: TeamEnrollmentLink) => void;
  readonly stopManagerCheckIns?: () => Promise<void>;
  readonly stopTeams?: () => Promise<void>;
  readonly stopPetDisplayCoordinator?: () => void;
};

export function installAppLifecycle(options: AppLifecycleOptions = {}): void {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    const link = parseTeamEnrollmentLink(url);
    if (link) {
      options.onTeamEnrollmentLink?.(link);
    }
  });
  app.on("second-instance", (_event, commandLine) => {
    info("app", "second instance requested");
    console.log("Second OpenPets launch requested; keeping existing instance.");
    focusOpenTaskWindows();
    const value = commandLine
      .map((item) => parseTeamEnrollmentLink(item))
      .find((item): item is TeamEnrollmentLink => Boolean(item));
    if (value) {
      options.onTeamEnrollmentLink?.(value);
    }
  });

  app.on("window-all-closed", () => {
    if (!intentionalQuit) {
      info("app", "all task windows closed; tray app kept alive");
      console.log("All OpenPets task windows closed; keeping tray app running.");
    }
  });

  app.on("activate", () => {
    info("app", "activate event");
    console.log("OpenPets activate event received; not opening a dashboard window.");
  });

  app.on("before-quit", (event) => {
    if (cleanupFinished) return;
    event.preventDefault();
    if (cleanupStarted) return;
    cleanupStarted = true;
    intentionalQuit = true;
    info("app", "before quit cleanup begin");
    scheduleHardExitFallback("before-quit");
    void (async () => {
      options.stopPetDisplayCoordinator?.();
      shutdownVoiceAssistantShortcut();
      await stopVoiceAssistantHost().catch(() => undefined);
      await stopPetAssistantHost().catch(() => undefined);
      await shutdownPluginVoice().catch(() => undefined);
      await options.stopManagerCheckIns?.().catch(() => undefined);
      await options.stopTeams?.().catch(() => undefined);
      await stopPluginService().catch(() => undefined);
      await stopRemoteControlService().catch(() => undefined);
      stopLocalIpcServer();
      closeAllLanVisitingPets();
      closeAllAgentPets();
      destroyDefaultPet();
      cleanupFinished = true;
      app.quit();
    })();
  });
}

export function quitOpenPets(): void {
  intentionalQuit = true;
  info("app", "quit requested");
  scheduleHardExitFallback("quit-requested");
  app.quit();
}

function scheduleHardExitFallback(reason: string): void {
  if (hardExitTimer) return;
  hardExitTimer = setTimeout(() => {
    info("app", "hard exit fallback", { reason });
    app.exit(0);
  }, 2_000);
  hardExitTimer.unref?.();
}
