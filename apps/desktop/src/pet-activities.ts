import { ipcMain, type BrowserWindow, type IpcMainEvent } from "electron";
import { getAppStateSnapshot, getEnabledPetActivityIds, setEnabledPetActivityIds } from "./app-state.js";
import { builtInPet } from "./built-in-pet.js";
import { readInstalledPetMetadata } from "./installed-pet-layout.js";
import { info, warn } from "./logger.js";
import type { PetActivity } from "./pet-activities-core.js";
import type { PetActivitiesSnapshot } from "./pet-activities-types.js";
import { PetActivityService } from "./pet-activity-service.js";
import { updateEnabledPetActivityIds } from "./pet-activity-policy.js";
import { readPetActivitySpritesheet } from "./pet-file-safety.js";
import { assertSafePetId, getPetDir } from "./pet-paths.js";
import { setPetGazeActivityOverride } from "./pet-window-gaze.js";
import type { PetContentRender } from "./pet-window-types.js";

interface WindowEntry {
  readonly window: BrowserWindow;
  render: PetContentRender | null;
  busyReason: string | null;
  pluginOverride: boolean;
  reactionOverride: boolean;
  dragging: boolean;
  scaleOverride: number | null;
  speechRequestId: string | null;
  ready: boolean;
  movedAt: number;
  interactionAt: number;
  readonly extraBusyReason: () => string | null;
}

const windows = new Map<BrowserWindow, WindowEntry>();
const unavailable = new Map<string, Set<string>>();
let timer: NodeJS.Timeout | null = null;
let suspended = false;
let handlersInstalled = false;

const service = new PetActivityService({
  now: Date.now,
  random: Math.random,
  enabledIds: getEnabledPetActivityIds,
  onFailure: (petId, activityId) => {
    const ids = unavailable.get(petId) ?? new Set<string>();
    ids.add(activityId);
    unavailable.set(petId, ids);
    warn("pet.activities", "activity disabled for this install", { petId, activityId });
  },
});

/** Main owns the one scheduler; window teardown independently removes each carrier. */
export function startPetActivities(): void {
  if (timer) return;
  suspended = false;
  timer = setInterval(() => service.tick(), 250);
  timer.unref?.();
}

export function stopPetActivities(): void {
  if (timer) clearInterval(timer);
  timer = null;
  service.stop();
  unavailable.clear();
}

export function suspendPetActivities(value: boolean): void {
  suspended = value;
  service.cancelAll();
}

export function registerPetActivityWindow(window: BrowserWindow, extraBusyReason: () => string | null = () => null): void {
  if (windows.has(window)) return;
  const contents = window.webContents;
  const entry: WindowEntry = {
    window,
    extraBusyReason,
    render: null,
    busyReason: null,
    pluginOverride: false,
    reactionOverride: false,
    dragging: false,
    scaleOverride: null,
    speechRequestId: null,
    ready: false,
    movedAt: 0,
    interactionAt: 0,
  };
  windows.set(window, entry);
  const invalidate = (): void => {
    entry.ready = false;
    entry.dragging = false;
    entry.speechRequestId = null;
    service.cancel(window.id);
  };
  const ready = (): void => {
    entry.ready = true;
  };
  const interrupt = (): void => interruptPetActivity(window);
  const hide = (): void => {
    entry.dragging = false;
    interrupt();
  };
  window.on("hide", hide);
  contents.on("did-start-loading", invalidate);
  contents.on("render-process-gone", invalidate);
  contents.on("did-fail-load", invalidate);
  contents.on("context-menu", interrupt);
  contents.on("did-finish-load", ready);
  window.once("closed", () => {
    service.remove(window.id);
    windows.delete(window);
    window.off("hide", hide);
    if (!contents.isDestroyed()) {
      contents.off("did-start-loading", invalidate);
      contents.off("render-process-gone", invalidate);
      contents.off("did-fail-load", invalidate);
      contents.off("context-menu", interrupt);
      contents.off("did-finish-load", ready);
    }
  });
  if (!handlersInstalled) {
    handlersInstalled = true;
    ipcMain.on("openpets:pet-activity-complete", (event: IpcMainEvent, payload: unknown) => {
      const owner = [...windows.values()].find((candidate) => !candidate.window.isDestroyed() && candidate.window.webContents === event.sender);
      if (!owner || typeof payload !== "object" || payload === null) return;
      const { generation, failed } = payload as { readonly generation?: unknown; readonly failed?: unknown };
      if (typeof generation !== "number" || !Number.isSafeInteger(generation)) return;
      service.complete(owner.window.id, generation, failed === true);
    });
    ipcMain.on("openpets:pet-activity-interaction", (event: IpcMainEvent) => {
      for (const owner of windows.values()) {
        if (!owner.window.isDestroyed() && owner.window.webContents === event.sender) interruptPetActivity(owner.window);
      }
    });
  }
}

/** Called for raw display/status changes, before asynchronous render composition. */
export function preparePetActivityRender(window: BrowserWindow, busy: boolean): void {
  const entry = windows.get(window);
  if (!entry) return;
  entry.busyReason = busy ? "This pet is busy." : null;
  if (busy) {
    entry.reactionOverride = false;
    service.cancel(window.id);
  }
}

export function updatePetActivityRender(window: BrowserWindow, render: PetContentRender): void {
  const entry = windows.get(window);
  if (!entry) return;
  const previous = entry.render;
  entry.render = render;
  // Body-only HUD refreshes do not change the rendered pet or its native lane.
  if (previous?.cacheKey === render.cacheKey
    && previous.renderedPetId === render.renderedPetId
    && previous.renderedOutfitId === render.renderedOutfitId) {
    return;
  }
  service.register({
    id: window.id,
    petId: render.renderedPetId,
    outfitId: render.renderedOutfitId,
    activities: render.activities.filter((activity) => !unavailable.get(render.renderedPetId)?.has(activity.id)),
    availabilityReason: () => getWindowBusyReason(entry),
    play: (activity, generation) => {
      setPetGazeActivityOverride(window, true);
      void readInstalledActivityAsset(render.renderedPetId, activity.id).then((bytes) => {
        if (!service.isCurrent(window.id, generation) || window.isDestroyed()) return;
        if (getWindowBusyReason(entry)) {
          service.cancel(window.id);
          return;
        }
        info("pet.activities", "play", {
          petId: render.renderedPetId,
          activityId: activity.id,
          windowId: window.id,
        });
        window.webContents.send("openpets:pet-activity", {
          generation,
          activityId: activity.id,
          frameCount: activity.frameCount,
          fps: activity.fps,
          scale: entry.scaleOverride ?? render.petScale,
          imageUrl: `data:image/webp;base64,${bytes.toString("base64")}`,
        });
      }).catch((error: unknown) => {
        if (!service.isCurrent(window.id, generation)) return;
        warn("pet.activities", "activity asset unavailable", {
          petId: render.renderedPetId,
          activityId: activity.id,
          error: error instanceof Error ? error.message : String(error),
        });
        service.complete(window.id, generation, true);
      });
    },
    stop: (generation) => {
      setPetGazeActivityOverride(window, false);
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send("openpets:pet-activity", { generation, cancel: true });
      }
    },
  });
}

function getWindowBusyReason(entry: WindowEntry): string | null {
  const { window, render } = entry;
  if (suspended) return "Activities are paused.";
  if (window.isDestroyed() || !window.isVisible()) return "Show this pet on the desktop to play an activity.";
  if (!entry.ready || !render) return "This pet is loading.";
  const installed = getAppStateSnapshot().pets.installed.find((pet) => pet.id === render.renderedPetId);
  if (!installed || installed.broken) return "This pet is unavailable.";
  if (render.paused || entry.busyReason || entry.dragging || entry.pluginOverride || entry.reactionOverride || entry.speechRequestId) {
    return "This pet is busy.";
  }
  if (Date.now() - Math.max(entry.movedAt, entry.interactionAt) < 500) return "This pet is being interacted with.";
  return entry.extraBusyReason();
}

export function interruptPetActivity(window: BrowserWindow): void {
  const entry = windows.get(window);
  if (!entry) return;
  entry.interactionAt = Date.now();
  service.cancel(window.id);
}

export function movePetActivityWindow(window: BrowserWindow): void {
  const entry = windows.get(window);
  if (!entry) return;
  entry.movedAt = Date.now();
  service.cancel(window.id);
}

export function setPetActivityDragging(window: BrowserWindow, dragging: boolean): void {
  const entry = windows.get(window);
  if (!entry) return;
  entry.dragging = dragging;
  interruptPetActivity(window);
}

export function setPetActivityPluginOverride(window: BrowserWindow, active: boolean): void {
  const entry = windows.get(window);
  if (!entry) return;
  entry.pluginOverride = active;
  interruptPetActivity(window);
}

export function setPetActivityReactionOverride(window: BrowserWindow, active: boolean): void {
  const entry = windows.get(window);
  if (!entry) return;
  entry.reactionOverride = active;
  interruptPetActivity(window);
}

export function setPetActivityScale(window: BrowserWindow, scale: number): void {
  const entry = windows.get(window);
  if (!entry || !Number.isFinite(scale) || scale <= 0) return;
  entry.scaleOverride = scale;
  interruptPetActivity(window);
}

export function startPetActivitySpeech(window: BrowserWindow, requestId: string): void {
  const entry = windows.get(window);
  if (!entry) return;
  entry.speechRequestId = requestId;
  interruptPetActivity(window);
}

export function finishPetActivitySpeech(window: BrowserWindow, requestId?: string): void {
  const entry = windows.get(window);
  if (!entry || (requestId !== undefined && entry.speechRequestId !== requestId)) return;
  entry.speechRequestId = null;
  interruptPetActivity(window);
}

export function resetPetActivitiesForPet(petId: string, restoreAssets = false): void {
  if (restoreAssets) unavailable.delete(petId);
  for (const entry of windows.values()) {
    if (entry.render?.renderedPetId === petId) {
      service.cancel(entry.window.id);
      entry.render = null;
    }
  }
}

export function removePetActivitiesForPet(petId: string): void {
  service.forgetPet(petId);
  unavailable.delete(petId);
  for (const entry of windows.values()) {
    if (entry.render?.renderedPetId === petId) entry.render = null;
  }
}

export async function readInstalledActivityAsset(petId: string, activityId: string): Promise<Buffer> {
  const { activities, source } = await readActivities(petId);
  const activity = activities.find((candidate) => candidate.id === activityId);
  if (!activity) throw new Error("Unknown pet activity.");
  return readPetActivitySpritesheet(getPetDir(petId, source), activity);
}

async function readActivities(petId: string): Promise<{ readonly activities: readonly PetActivity[]; readonly source: "personal" | "team" }> {
  const pet = getAppStateSnapshot().pets.installed.find((candidate) => candidate.id === petId);
  if (!pet || pet.broken) throw new Error("This pet is unavailable.");
  const source = pet.source?.kind === "team" ? "team" : "personal";
  if (pet.id === builtInPet.id) return { activities: [], source };
  assertSafePetId(petId);
  return { activities: (await readInstalledPetMetadata(petId, source)).activities ?? [], source };
}

export async function getPetActivities(petId: string): Promise<PetActivitiesSnapshot> {
  const { activities, source } = await readActivities(petId);
  const availabilityReason = service.getAvailabilityReason(petId);
  const enabled = getEnabledPetActivityIds(petId);
  const items = await Promise.all(activities.map(async (activity) => {
    let reason = unavailable.get(petId)?.has(activity.id) ? "Activity asset unavailable. Reinstall this pet to restore it." : null;
    if (!reason) {
      try {
        await readPetActivitySpritesheet(getPetDir(petId, source), activity);
      } catch {
        reason = "Activity asset unavailable. Reinstall this pet to restore it.";
      }
    }
    return {
      id: activity.id,
      displayName: activity.displayName,
      frameCount: activity.frameCount,
      fps: activity.fps,
      enabled: enabled.includes(activity.id),
      previewUrl: reason ? null : `openpets-installed://activity/${encodeURIComponent(petId)}/${encodeURIComponent(activity.id)}`,
      availabilityReason: reason ?? availabilityReason,
    };
  }));
  return {
    petId,
    activities: items,
    availabilityReason,
    playingActivityId: service.getPlayingActivityId(petId),
  };
}

export async function setPetActivityEnabled(petId: string, activityId: string, enabled: boolean): Promise<PetActivitiesSnapshot> {
  const { activities } = await readActivities(petId);
  const previous = getEnabledPetActivityIds(petId);
  const next = updateEnabledPetActivityIds(activities, previous, activityId, enabled);
  setEnabledPetActivityIds(petId, next);
  if (!enabled) {
    for (const entry of windows.values()) {
      if (entry.render?.renderedPetId === petId) service.cancel(entry.window.id);
    }
  }
  info("pet.activities", "automatic playback preference changed", { petId, activityId, enabled });
  return getPetActivities(petId);
}

export async function playPetActivity(petId: string, activityId: string): Promise<PetActivitiesSnapshot> {
  await readInstalledActivityAsset(petId, activityId);
  service.play(petId, activityId);
  return getPetActivities(petId);
}
