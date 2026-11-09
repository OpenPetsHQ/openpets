import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as moduleApi from "node:module";
import { mock, test } from "node:test";

test("Motion activity targets the committed body and rejects stale renderer results", async () => {
  const ipc = new EventEmitter();
  const data = {
    ipc,
    enabled: ["dance"],
    metadata: {
      id: "motion", format: "motion", geometry: { width: 8, height: 8 },
      activities: [{ id: "wave", displayName: "Wave", outfitId: "coat", animation: "wave" }],
      wardrobe: { outfits: [{ id: "coat", displayName: "Original Coat" }] },
    },
    classic: { spritesheetPath: "spritesheet.webp", activities: [{ id: "read", displayName: "Read", outfitId: "default", spritesheetPath: "activities/read.webp", frameCount: 8, fps: 4 }] },
  };
  Object.assign(globalThis, { __motionActivityTest: data });
  const moduleUrl = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;
  const mocks = new Map([
    ["electron", moduleUrl("export const ipcMain = globalThis.__motionActivityTest.ipc;")],
    ["./app-state.js", moduleUrl(`export function getAppStateSnapshot(){ return { pets: { installed: [{id:'motion'},{id:'classic'}] } }; } export function getEnabledPetActivityIds(){return globalThis.__motionActivityTest.enabled} export function setEnabledPetActivityIds(_id, values){globalThis.__motionActivityTest.enabled = [...values]}`)],
    ["./built-in-pet.js", moduleUrl("export const builtInPet={id:'builtin'};")],
    ["./installed-pet-layout.js", moduleUrl("export async function readInstalledPetPackage(id){return id === 'classic' ? {format:'classic',metadata:globalThis.__motionActivityTest.classic} : {format:'motion',metadata:globalThis.__motionActivityTest.metadata}}")],
    ["./logger.js", moduleUrl("export function info(){} export function warn(){}")],
    ["./pet-paths.js", moduleUrl("export function assertSafePetId(){} export function getPetDir(){return '/unused'}")],
    ["./pet-window-gaze.js", moduleUrl("export function setPetGazeActivityOverride(){}")],
    ["./pet-atlas-validation.js", moduleUrl("export async function readPetActivitySpritesheet(){return Buffer.from('unused')}")],
    ["./pet-activity-asset-cache.js", moduleUrl("export class PetActivityAssetCache { retainPets(){} forgetPet(){} clear(){} async getUnavailableIds(){return new Set()} }")],
    ["./pet-motion-activity-assets.js", moduleUrl("export function getMotionActivityOptions(appearance){return appearance.assets.metadata.activities.map(({id,displayName})=>({id,displayName,durationMs:1000}))} export async function readMotionActivityPreview(){return {bytes:Buffer.from('preview'),mimeType:'image/png'}}")],
    ["./pet-wardrobe-render-state.js", moduleUrl("export function getRenderedOutfits(){return [{windowId:7,isDefault:true}]}")],
  ]);
  const hooks = typeof moduleApi.registerHooks === "function" ? moduleApi.registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = context.parentURL?.includes("pet-activities.") ? mocks.get(specifier) : undefined;
      return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
    },
  }) : undefined;
  if (!hooks) {
    moduleApi.register(`data:text/javascript,${encodeURIComponent(`
      const mocks = new Map(${JSON.stringify([...mocks])});
      export async function resolve(specifier, context, nextResolve) {
        const url = context.parentURL?.includes("pet-activities.") ? mocks.get(specifier) : undefined;
        return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
      }
    `)}`, import.meta.url);
  }
  class Contents extends EventEmitter {
    sent: Array<{ channel: string; payload: unknown }> = [];
    isDestroyed() { return false; }
    send(channel: string, payload: unknown) { this.sent.push({ channel, payload }); }
  }
  class Window extends EventEmitter {
    id = 7;
    webContents = new Contents();
    isDestroyed() { return false; }
    isVisible() { return true; }
  }
  const window = new Window();
  const originalRandom = Math.random;
  Math.random = () => 0;
  mock.timers.enable({ apis: ["Date", "setInterval"], now: 1_000_000 });
  try {
    const runtime = await import("../src/pet-activities.js");
    runtime.registerPetActivityWindow(window as never);
    window.webContents.emit("did-finish-load");
    const appearance = { assets: { snapshotId: "snapshot-a", metadata: data.metadata, urls: {}, verifiedClips: {} }, outfitId: "coat", presentationId: "look-a", reason: "initial" } as const;
    const body = { input: { epoch: "epoch", revision: 1, context: "idle", paused: false, suspended: false }, committed: appearance, appearancePending: false } as const;
    runtime.updatePetActivityBody(window as never, body as never);
    const snapshot = await runtime.getPetActivities("motion");
    assert.equal(snapshot.windowId, 7);
    assert.equal(snapshot.outfitId, "coat");
    assert.equal(snapshot.activities[0]?.preview?.format, "motion");
    data.metadata = {
      ...data.metadata,
      activities: [{ id: "dance", displayName: "New Dance", outfitId: "coat", animation: "dance" }],
      wardrobe: { outfits: [{ id: "coat", displayName: "Replacement Coat" }] },
    };
    const oldRevision = await runtime.getPetActivities("motion");
    assert.equal(oldRevision.outfitDisplayName, "Original Coat");
    assert.deepEqual(oldRevision.activities.map((activity) => [activity.id, activity.displayName, activity.availableOutfitIds]), [["wave", "Wave", ["coat"]]]);
    assert.equal(oldRevision.activities[0]?.preview?.format, "motion");
    await runtime.setPetActivityEnabled("motion", "wave", true);
    assert.deepEqual(data.enabled, ["dance", "wave"]);
    const preview = await runtime.readPetActivityPreview("motion", "wave", "coat", { windowId: 7, snapshotId: "snapshot-a", presentationId: "look-a" });
    assert.equal(preview.mimeType, "image/png");
    await assert.rejects(() => runtime.readPetActivityPreview("motion", "wave", "coat", { windowId: 7, snapshotId: "snapshot-b", presentationId: "look-a" }));
    await runtime.playPetActivity("motion", "wave");
    const command = window.webContents.sent.at(-1)?.payload as { generation: number; activityId: string; target: { epoch: string; snapshotId: string; presentationId: string; outfitId: string } };
    assert.equal(command.target.outfitId, "coat");
    runtime.updatePetActivityBody(window as never, { ...body, input: { ...body.input, revision: 2 } } as never);
    runtime.preparePetActivityRender(window as never, true);
    ipc.emit("openpets:pet-activity-complete", { sender: window.webContents }, { format: "motion", generation: command.generation, activityId: "wave", outcome: "completed", target: { ...command.target, presentationId: "stale" } });
    assert.equal((await runtime.getPetActivities("motion")).playingActivityId, "wave");
    ipc.emit("openpets:pet-activity-complete", { sender: window.webContents }, { format: "motion", generation: command.generation, activityId: "wave", outcome: "started", target: command.target });
    ipc.emit("openpets:pet-activity-complete", { sender: window.webContents }, { format: "motion", generation: command.generation, activityId: "wave", outcome: "completed", target: command.target });
    assert.equal((await runtime.getPetActivities("motion")).playingActivityId, null);
    await runtime.playPetActivity("motion", "wave");
    runtime.updatePetActivityBody(window as never, { ...body, appearancePending: true } as never);
    assert.equal((await runtime.getPetActivities("motion")).playingActivityId, null);
    await assert.rejects(() => runtime.playPetActivity("motion", "wave"));
    runtime.updatePetActivityBody(window as never, body as never);
    await runtime.playPetActivity("motion", "wave");
    runtime.updatePetActivityBody(window as never, { ...body, input: { ...body.input, context: "working" } } as never);
    assert.equal((await runtime.getPetActivities("motion")).playingActivityId, null);
    const replacement = { ...appearance, assets: { ...appearance.assets, snapshotId: "snapshot-b", metadata: data.metadata }, presentationId: "look-b" };
    runtime.updatePetActivityBody(window as never, { ...body, committed: replacement } as never);
    const newRevision = await runtime.getPetActivities("motion");
    assert.equal(newRevision.outfitDisplayName, "Replacement Coat");
    assert.deepEqual(newRevision.activities.map((activity) => [activity.id, activity.displayName, activity.availableOutfitIds]), [["dance", "New Dance", ["coat"]]]);
    assert.equal(newRevision.activities[0]?.preview?.format, "motion");
    window.emit("closed");

    // Wire the real semantic body owner to the activity runtime. Classic
    // updates must not destroy its carrier, while an uncommitted Motion body
    // must not fall back to that former Classic appearance.
    const classicWindow = new Window();
    runtime.registerPetActivityWindow(classicWindow as never);
    classicWindow.webContents.emit("did-finish-load");
    const render = {
      renderedPetId: "classic", renderedOutfitId: "default", activities: data.classic.activities,
      cacheKey: "classic", petScale: 1, paused: false,
    };
    runtime.updatePetActivityRender(classicWindow as never, render as never);
    const { createPetBodyState } = await import("../src/pet-body-state.js");
    let epoch = "";
    const semantic = createPetBodyState((value) => { epoch = value.input.epoch; }, () => {}, (value) => runtime.updatePetActivityBody(classicWindow as never, value));
    data.enabled.push("read");
    runtime.startPetActivities();
    mock.timers.tick(250);
    for (let i = 0; i < 6; i += 1) mock.timers.tick(10_000);
    semantic.ready();
    semantic.react("idle");
    runtime.updatePetActivityRender(classicWindow as never, { ...render } as never);
    for (let i = 0; i < 6; i += 1) mock.timers.tick(10_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const automatic = classicWindow.webContents.sent.find((message) => (message.payload as { kind?: string }).kind === "play");
    assert.ok(automatic, "Classic idle opportunity survives body readiness and semantic refresh");
    const automaticPayload = automatic.payload as { generation: number; activityId: string };
    ipc.emit("openpets:pet-activity-complete", { sender: classicWindow.webContents }, { format: "classic", generation: automaticPayload.generation, activityId: automaticPayload.activityId, outcome: "completed" });
    await runtime.playPetActivity("classic", "read");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(classicWindow.webContents.sent.at(-1)?.payload && (classicWindow.webContents.sent.at(-1)?.payload as { format?: string }).format, "classic");
    const candidate = semantic.prepareMotionAppearance(appearance.assets as never, "coat", "initial", false);
    semantic.publishMotionAppearance(candidate);
    assert.equal((await runtime.getPetActivities("classic")).windowId, null);
    assert.equal((await runtime.getPetActivities("motion")).windowId, null);
    await assert.rejects(() => runtime.playPetActivity("classic", "read"));
    semantic.result({ epoch, snapshotId: candidate.assets.snapshotId, presentationId: candidate.presentationId, outfitId: candidate.outfitId, playbackId: 1, outcome: "started" });
    assert.equal((await runtime.getPetActivities("motion")).windowId, classicWindow.id);
    await runtime.playPetActivity("motion", "wave");
    semantic.clearMotion();
    assert.equal((await runtime.getPetActivities("classic")).windowId, null);
    runtime.updatePetActivityRender(classicWindow as never, render as never);
    await runtime.playPetActivity("classic", "read");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal((classicWindow.webContents.sent.at(-1)?.payload as { format?: string }).format, "classic");
    classicWindow.emit("closed");
    runtime.stopPetActivities();
    mock.timers.reset();
  } finally {
    mock.timers.reset();
    Math.random = originalRandom;
    hooks?.deregister();
    Reflect.deleteProperty(globalThis, "__motionActivityTest");
  }
});
