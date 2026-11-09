import { ipcMain, type BrowserWindow, type IpcMainEvent, type WebContents } from "electron";
import { getAppStateSnapshot, getEnabledPetActivityIds, setEnabledPetActivityIds } from "./app-state.js";
import { builtInPet } from "./built-in-pet.js";
import { readInstalledPetPackage } from "./installed-pet-layout.js";
import { info, warn } from "./logger.js";
import { enumeratePetActivityAnimations, getPetActivityDurationMs, resolvePetActivityAnimation, type PetActivity, type PetActivityIdentity } from "@open-pets/pet-format/activities";
import { enumerateMotionActivityAnimations, resolveMotionActivityAnimation } from "@open-pets/pet-format/motion";
import type { MotionActivityBodyState } from "./pet-body-contract.js";
import type { AvailablePetActivity, MotionActivityTarget, PetActivityResult } from "./pet-activity-contract.js";
import { getMotionActivityOptions, readMotionActivityPreview } from "./pet-motion-activity-assets.js";
import { getRenderedOutfits } from "./pet-wardrobe-render-state.js";
import type { PetActivitiesSnapshot } from "./pet-activities-types.js";
import { PetActivityService } from "./pet-activity-service.js";
import { PetActivityAssetCache } from "./pet-activity-asset-cache.js";
import { updateEnabledPetActivityIds } from "./pet-activity-policy.js";
import { readPetActivitySpritesheet } from "./pet-atlas-validation.js";
import { assertSafePetId, getPetDir } from "./pet-paths.js";
import { setPetGazeActivityOverride } from "./pet-window-gaze.js";
import type { PetContentRender } from "./pet-window-types.js";
import type { CodexPetMetadata } from "@open-pets/pet-format/metadata";
import type { MotionPetMetadata } from "@open-pets/pet-format/motion";

interface WindowEntry {
  readonly window: BrowserWindow;
  readonly windowId: number;
  readonly contents: WebContents;
  body: MotionActivityBodyState | null;
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
const installationRevisions = new Map<string, number>();
const assetValidation = new PetActivityAssetCache();
let timer: NodeJS.Timeout | null = null;
let suspended = false;
let handlersInstalled = false;

const service = new PetActivityService({
  now: Date.now,
  random: Math.random,
  enabledIds: getEnabledPetActivityIds,
  onFailure: (petId, activityId, outfitId, revision) => {
    const ids = unavailable.get(petId) ?? new Set<string>();
    ids.add(`${activityId}:${outfitId}:${revision}`);
    unavailable.set(petId, ids);
    warn("pet.activities", "activity outfit disabled for this install", { petId, activityId, outfitId });
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
  assetValidation.clear();
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
    windowId: window.id,
    contents,
    body: null,
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
    service.remove(entry.windowId);
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
      const owner = [...windows.values()].find((candidate) => candidate.contents === event.sender);
      if (!owner || typeof payload !== "object" || payload === null) return;
      const result = parseActivityResult(payload);
      if (!result || !service.isCurrent(owner.windowId, result.generation, result.activityId)) return;
      if (result.format === "motion") {
        const current = motionTarget(owner.body);
        if (!current || !sameTarget(current, result.target)) return;
      } else if (owner.body) return;
      if (result.outcome !== "started" && result.format === "classic") setPetGazeActivityOverride(owner.window, false);
      service.result(owner.windowId, result.generation, result.activityId, result.outcome);
    });
    ipcMain.on("openpets:pet-activity-interaction", (event: IpcMainEvent) => {
      for (const owner of windows.values()) {
        if (owner.contents === event.sender) interruptPetActivity(owner.window);
      }
    });
  }
}

/** Called for raw display/status changes, before asynchronous render composition. */
export function preparePetActivityRender(window: BrowserWindow, busy: boolean): void {
  const entry = windows.get(window);
  if (!entry) return;
  entry.busyReason = busy ? "This pet is busy." : null;
  if (entry.body) return;
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
  if (render.motion) {
    if (previous && !previous.motion) service.remove(entry.windowId);
    registerMotionCarrier(entry);
    return;
  }
  const hadMotionBody = entry.body !== null;
  entry.body = null;
  if (hadMotionBody) service.remove(entry.windowId);
  if (!hadMotionBody && previous?.renderedPetId === render.renderedPetId && previous.renderedOutfitId === render.renderedOutfitId && !previous.motion) return;
  const revision = `classic:${installationRevisions.get(render.renderedPetId) ?? 0}`;
  const animations = render.activities.flatMap((activity) => {
    const animation = resolvePetActivityAnimation(activity, render.renderedOutfitId);
    return animation ? [{ ...activity, ...animation }] : [];
  });
  service.register({
    id: entry.windowId,
    petId: render.renderedPetId,
    outfitId: render.renderedOutfitId,
    revision,
    failureRevision: revision,
    activities: animations.filter((activity) => !unavailable.get(render.renderedPetId)?.has(`${activity.id}:${render.renderedOutfitId}:${revision}`))
      .map((activity) => ({ id: activity.id, displayName: activity.displayName, durationMs: getPetActivityDurationMs(activity) })),
    availabilityReason: () => getWindowBusyReason(entry),
    play: (activity, generation) => {
      const animation = animations.find((candidate) => candidate.id === activity.id);
      if (!animation) { service.result(entry.windowId, generation, activity.id, "failed"); return; }
      setPetGazeActivityOverride(window, true);
      void readInstalledActivityAsset(render.renderedPetId, activity.id, animation.outfitId).then((bytes) => {
        if (!service.isCurrent(entry.windowId, generation, activity.id) || window.isDestroyed()) return;
        if (getWindowBusyReason(entry)) {
          service.cancel(window.id);
          return;
        }
        info("pet.activities", "play", {
          petId: render.renderedPetId,
          activityId: activity.id,
          windowId: window.id,
        });
        entry.contents.send("openpets:pet-activity", {
          kind: "play", format: "classic", generation,
          activityId: activity.id,
          frameCount: animation.frameCount,
          fps: animation.fps,
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
        service.result(entry.windowId, generation, activity.id, "failed");
        setPetGazeActivityOverride(window, false);
      });
    },
    stop: (activity, generation) => {
      setPetGazeActivityOverride(window, false);
      if (!entry.contents.isDestroyed()) {
        entry.contents.send("openpets:pet-activity", { kind: "cancel", format: "classic", generation, activityId: activity.id });
      }
    },
  });
}

export function updatePetActivityBody(window: BrowserWindow, state: MotionActivityBodyState | null): void {
  const entry = windows.get(window);
  if (!entry) return;
  if (!state) {
    if (!entry.body) return;
    service.remove(entry.windowId);
    entry.body = null;
    const classicRender = entry.render;
    if (classicRender && !classicRender.motion) {
      entry.render = null;
      updatePetActivityRender(window, classicRender);
    }
    return;
  }
  if (!entry.body) {
    service.remove(entry.windowId);
    // The previous Classic render is no longer the committed body. A later
    // Classic content commit supplies its own fresh render before registration.
    entry.render = null;
  }
  const previous = motionTarget(entry.body);
  entry.body = state;
  const current = motionTarget(state);
  if (state.appearancePending || !current || !previous || !sameTarget(previous, current) || state.input.context !== "idle" || state.input.event || state.input.paused || state.input.suspended) {
    service.cancel(entry.windowId);
  }
  if (!previous || !current || !sameTarget(previous, current)) registerMotionCarrier(entry);
}

function registerMotionCarrier(entry: WindowEntry): void {
  const appearance = entry.body?.committed;
  const target = motionTarget(entry.body);
  if (!appearance || !target) {
    service.remove(entry.windowId);
    return;
  }
  const petId = appearance.assets.metadata.id;
  const revision = target.snapshotId;
  const options = getMotionActivityOptions(appearance).filter((activity) => !unavailable.get(petId)?.has(`${activity.id}:${target.outfitId}:${revision}`));
  service.register({
    id: entry.windowId, petId, outfitId: target.outfitId, revision: `${target.epoch}:${revision}:${target.presentationId}`, failureRevision: revision,
    activities: options,
    availabilityReason: () => getWindowBusyReason(entry),
    play: (activity, generation) => {
      const declaration = appearance.assets.metadata.activities?.find((candidate) => candidate.id === activity.id);
      const animation = declaration && resolveMotionActivityAnimation(declaration, target.outfitId);
      if (!animation || entry.contents.isDestroyed()) { service.result(entry.windowId, generation, activity.id, "failed"); return; }
      entry.contents.send("openpets:pet-activity", { kind: "play", format: "motion", target, generation, activityId: activity.id, animation: animation.animation });
    },
    stop: (activity, generation) => {
      if (!entry.contents.isDestroyed()) entry.contents.send("openpets:pet-activity", { kind: "cancel", format: "motion", target, generation, activityId: activity.id });
    },
    variation: () => { if (!entry.contents.isDestroyed()) entry.contents.send("openpets:pet-activity", { kind: "variation" }); },
  });
}

function getWindowBusyReason(entry: WindowEntry): string | null {
  const { window, render } = entry;
  if (suspended) return "Activities are paused.";
  if (window.isDestroyed() || !window.isVisible()) return "Show this pet on the desktop to play an activity.";
  if (!entry.ready) return "This pet is loading.";
  const body = entry.body;
  const isMotion = body !== null;
  if (isMotion && (!body.committed || body.appearancePending)) return "This pet's appearance is loading.";
  if (isMotion && (body.input.context !== "idle" || body.input.event || body.input.paused || body.input.suspended)) return "This pet is busy.";
  if (!isMotion && !render) return "This pet is loading.";
  const petId = body?.committed?.assets.metadata.id ?? render?.renderedPetId;
  const installed = getAppStateSnapshot().pets.installed.find((pet) => pet.id === petId);
  if (!installed || installed.broken) return "This pet is unavailable.";
  if ((!isMotion && (render?.paused || entry.busyReason || entry.reactionOverride)) || entry.dragging || entry.pluginOverride || entry.speechRequestId) {
    return "This pet is busy.";
  }
  if (Date.now() - Math.max(entry.movedAt, entry.interactionAt) < 500) return "This pet is being interacted with.";
  return entry.extraBusyReason();
}

function motionTarget(state: MotionActivityBodyState | null): MotionActivityTarget | null {
  if (!state?.committed) return null;
  return { epoch: state.input.epoch, snapshotId: state.committed.assets.snapshotId, presentationId: state.committed.presentationId, outfitId: state.committed.outfitId };
}

function sameTarget(left: MotionActivityTarget, right: MotionActivityTarget): boolean {
  return left.epoch === right.epoch && left.snapshotId === right.snapshotId && left.presentationId === right.presentationId && left.outfitId === right.outfitId;
}

function parseActivityResult(value: object): PetActivityResult | null {
  if (!("generation" in value) || typeof value.generation !== "number" || !Number.isSafeInteger(value.generation)
    || !("activityId" in value) || typeof value.activityId !== "string"
    || !("outcome" in value) || (value.outcome !== "started" && value.outcome !== "completed" && value.outcome !== "cancelled" && value.outcome !== "failed")
    || !("format" in value)) return null;
  const common: { readonly generation: number; readonly activityId: string; readonly outcome: PetActivityResult["outcome"] } = {
    generation: value.generation, activityId: value.activityId, outcome: value.outcome,
  };
  if (value.format === "classic") return { ...common, format: "classic" };
  if (value.format !== "motion" || !("target" in value) || typeof value.target !== "object" || value.target === null) return null;
  const target = value.target;
  if (!("epoch" in target) || typeof target.epoch !== "string" || !("snapshotId" in target) || typeof target.snapshotId !== "string"
    || !("presentationId" in target) || typeof target.presentationId !== "string" || !("outfitId" in target) || typeof target.outfitId !== "string") return null;
  return { ...common, format: "motion", target: { epoch: target.epoch, snapshotId: target.snapshotId, presentationId: target.presentationId, outfitId: target.outfitId } };
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
  if (entry.body) return;
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
  assetValidation.forgetPet(petId);
  if (restoreAssets) {
    unavailable.delete(petId);
    installationRevisions.set(petId, (installationRevisions.get(petId) ?? 0) + 1);
  }
  for (const entry of windows.values()) {
    if ((entry.body?.committed?.assets.metadata.id ?? entry.render?.renderedPetId) === petId) {
      service.cancel(entry.window.id);
      entry.render = null;
    }
  }
}

export function removePetActivitiesForPet(petId: string): void {
  assetValidation.forgetPet(petId);
  service.forgetPet(petId);
  unavailable.delete(petId);
  installationRevisions.delete(petId);
  for (const entry of windows.values()) {
    if ((entry.body?.committed?.assets.metadata.id ?? entry.render?.renderedPetId) === petId) { entry.render = null; entry.body = null; }
  }
}

export async function readInstalledActivityAsset(petId: string, activityId: string, outfitId: string): Promise<Buffer> {
  const { metadata, source, format } = await readActivities(petId);
  const activity = format === "classic" && metadata && "spritesheetPath" in metadata ? metadata.activities?.find((candidate) => candidate.id === activityId) : undefined;
  const animation = activity && resolvePetActivityAnimation(activity, outfitId);
  if (!activity || !animation) throw new Error("This activity has no artwork for the current outfit.");
  return readPetActivitySpritesheet(getPetDir(petId, source), { ...activity, ...animation });
}

async function readActivities(petId: string): Promise<{ readonly activities: readonly PetActivityIdentity[]; readonly source: "personal" | "team"; readonly metadata: CodexPetMetadata | MotionPetMetadata | null; readonly format: "classic" | "motion" }> {
  const installed = getAppStateSnapshot().pets.installed;
  assetValidation.retainPets(installed.map((pet) => pet.id));
  const pet = installed.find((candidate) => candidate.id === petId);
  if (!pet || pet.broken) throw new Error("This pet is unavailable.");
  const source = pet.source?.kind === "team" ? "team" : "personal";
  if (pet.id === builtInPet.id) return { activities: [], source, metadata: null, format: "classic" };
  assertSafePetId(petId);
  const petPackage = await readInstalledPetPackage(petId, source);
  const { metadata } = petPackage;
  return { activities: metadata.activities ?? [], source, metadata, format: petPackage.format };
}

export async function getPetActivities(petId: string): Promise<PetActivitiesSnapshot> {
  const installed = await readActivities(petId);
  const carrier = selectActivityWindow(petId);
  const appearance = carrier?.body?.committed ?? null;
  const target = carrier ? motionTarget(carrier.body) : null;
  const format = appearance ? "motion" : installed.format;
  const metadata = appearance?.assets.metadata ?? installed.metadata;
  const activities = appearance ? appearance.assets.metadata.activities ?? [] : installed.activities;
  let outfitId: string | null = null;
  if (carrier) {
    outfitId = format === "motion" ? target?.outfitId ?? null : carrier.render?.renderedOutfitId ?? null;
  }
  const outfitDisplayName = metadata?.wardrobe?.outfits.find((outfit) => outfit.id === outfitId)?.displayName ?? "Default";
  const availabilityReason = service.getAvailabilityReason(petId, carrier?.windowId);
  const enabled = getEnabledPetActivityIds(petId);
  let invalidAssets: ReadonlySet<string> = new Set();
  const classicActivities = format === "classic" && metadata && "spritesheetPath" in metadata ? metadata.activities ?? [] : [];
  if (classicActivities.length === 0 || !outfitId) {
    assetValidation.forgetPet(petId);
  } else {
    const matching = classicActivities.flatMap((activity) => {
      const animation = resolvePetActivityAnimation(activity, outfitId);
      return animation ? [{ ...activity, ...animation }] : [];
    });
    invalidAssets = await assetValidation.getUnavailableIds(petId, getPetDir(petId, installed.source), matching);
  }
  const items = activities.map((activity) => {
    const classic = classicActivities.find((candidate) => candidate.id === activity.id);
    const motionDefinition = format === "motion" && metadata && "format" in metadata ? metadata.activities?.find((candidate) => candidate.id === activity.id) : undefined;
    const animation = outfitId && classic ? resolvePetActivityAnimation(classic, outfitId) : null;
    const motionAnimation = outfitId && appearance && motionDefinition ? resolveMotionActivityAnimation(motionDefinition, outfitId) : null;
    const revision = format === "motion" ? target?.snapshotId : `classic:${installationRevisions.get(petId) ?? 0}`;
    let reason: string | null = null;
    if (!animation && !motionAnimation) {
      reason = "This activity has no artwork for the current outfit.";
    } else if (unavailable.get(petId)?.has(`${activity.id}:${outfitId}:${revision}`) || invalidAssets.has(activity.id)) {
      reason = "Activity asset unavailable. Reinstall this pet to restore it.";
    }
    const baseUrl = `openpets-installed://activity/${encodeURIComponent(petId)}/${encodeURIComponent(activity.id)}/${encodeURIComponent(outfitId ?? "default")}`;
    let preview: PetActivitiesSnapshot["activities"][number]["preview"] = null;
    if (!reason && outfitId && animation) {
      preview = { format: "classic", url: baseUrl, frameCount: animation.frameCount, fps: animation.fps };
    } else if (!reason && outfitId && target && carrier && appearance && motionAnimation) {
      const query = new URLSearchParams({
        windowId: String(carrier.windowId),
        snapshotId: target.snapshotId,
        presentationId: target.presentationId,
      });
      preview = {
        format: "motion",
        url: `${baseUrl}?${query}`,
        width: appearance.assets.metadata.geometry.width,
        height: appearance.assets.metadata.geometry.height,
      };
    }
    let availableOutfitIds: readonly string[] = [];
    if (classic) {
      availableOutfitIds = enumeratePetActivityAnimations(classic).map((variant) => variant.outfitId);
    } else if (motionDefinition) {
      availableOutfitIds = enumerateMotionActivityAnimations(motionDefinition).map((variant) => variant.outfitId);
    }
    return {
      id: activity.id,
      displayName: activity.displayName,
      availableOutfitIds,
      availableForCurrentOutfit: Boolean(animation || motionAnimation),
      enabled: enabled.includes(activity.id),
      preview,
      availabilityReason: reason ?? availabilityReason,
    };
  });
  return {
    petId,
    windowId: carrier?.windowId ?? null,
    outfitId,
    outfitDisplayName: outfitId === null ? null : outfitDisplayName,
    activities: items,
    availabilityReason,
    playingActivityId: service.getPlayingActivityId(petId),
  };
}

export async function setPetActivityEnabled(petId: string, activityId: string, enabled: boolean): Promise<PetActivitiesSnapshot> {
  const { activities } = await readActivities(petId);
  const committed = selectActivityWindow(petId)?.body?.committed?.assets.metadata.activities ?? [];
  const definitions = [...activities, ...committed.filter((activity) => !activities.some((installed) => installed.id === activity.id))];
  const previous = getEnabledPetActivityIds(petId);
  const next = updateEnabledPetActivityIds(definitions, previous, activityId, enabled);
  setEnabledPetActivityIds(petId, next);
  if (!enabled) {
    for (const entry of windows.values()) {
      if ((entry.body?.committed?.assets.metadata.id ?? entry.render?.renderedPetId) === petId) service.cancel(entry.windowId);
    }
  }
  info("pet.activities", "automatic playback preference changed", { petId, activityId, enabled });
  return getPetActivities(petId);
}

export async function playPetActivity(petId: string, activityId: string): Promise<PetActivitiesSnapshot> {
  const snapshot = await getPetActivities(petId);
  const item = snapshot.activities.find((activity) => activity.id === activityId);
  if (!item || item.availabilityReason) throw new Error(item?.availabilityReason ?? "Unknown pet activity.");
  if (snapshot.windowId === null || snapshot.outfitId === null) throw new Error("Show this pet on the desktop to play an activity.");
  if (item.preview?.format === "classic") await readInstalledActivityAsset(petId, activityId, snapshot.outfitId);
  const selected = selectActivityWindow(petId);
  if (!selected || selected.windowId !== snapshot.windowId) throw new Error("This pet's activity window changed.");
  if (item.preview?.format === "motion") {
    const target = motionTarget(selected.body);
    const url = new URL(item.preview.url);
    if (!target || selected.body?.appearancePending || target.outfitId !== snapshot.outfitId
      || target.snapshotId !== url.searchParams.get("snapshotId") || target.presentationId !== url.searchParams.get("presentationId")) {
      throw new Error("This pet's appearance changed.");
    }
  } else if (selected.render?.renderedOutfitId !== snapshot.outfitId) {
    throw new Error("This pet's appearance changed.");
  }
  service.play(petId, activityId, snapshot.windowId);
  return getPetActivities(petId);
}

function selectActivityWindow(petId: string): WindowEntry | undefined {
  const defaults = new Set(getRenderedOutfits(petId).filter((entry) => entry.isDefault).map((entry) => entry.windowId));
  return [...windows.values()].filter((entry) => !entry.window.isDestroyed() && (entry.body?.committed?.assets.metadata.id ?? entry.render?.renderedPetId) === petId)
    .sort((left, right) => Number(defaults.has(right.windowId)) - Number(defaults.has(left.windowId)) || left.windowId - right.windowId)[0];
}

export async function readPetActivityPreview(petId: string, activityId: string, outfitId: string, target?: { readonly windowId: number; readonly snapshotId: string; readonly presentationId: string }): Promise<{ readonly bytes: Buffer; readonly mimeType: string }> {
  if (!target) return { bytes: await readInstalledActivityAsset(petId, activityId, outfitId), mimeType: "image/webp" };
  const entry = [...windows.values()].find((candidate) => candidate.windowId === target.windowId);
  const appearance = entry?.body?.committed;
  if (!entry || entry.window.isDestroyed() || !appearance || appearance.assets.metadata.id !== petId || appearance.outfitId !== outfitId
    || appearance.assets.snapshotId !== target.snapshotId || appearance.presentationId !== target.presentationId) {
    throw new Error("Activity preview appearance is no longer available.");
  }
  const preview = await readMotionActivityPreview(appearance, activityId);
  if (entry.body?.committed !== appearance || entry.window.isDestroyed()) throw new Error("Activity preview appearance changed.");
  return preview;
}
