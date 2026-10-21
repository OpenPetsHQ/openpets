import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { register } from "node:module";
import { mock } from "node:test";
import type { PetActivity } from "../src/pet-activities-core.js";
import { normalizePetActivityPreferences } from "../src/pet-activity-policy.js";

const activity = (id: string): PetActivity => ({
  id, displayName: id, outfitId: "default", spritesheetPath: `activities/${id}.webp`, frameCount: 8, fps: 4,
});
const state = {
  activities: [activity("read")],
  enabled: ["read"],
  save(ids: readonly string[]) {
    this.enabled = [...(normalizePetActivityPreferences({ cat: ids })?.cat ?? [])];
  },
};
(globalThis as typeof globalThis & { __petActivitiesRuntimeTest?: typeof state }).__petActivitiesRuntimeTest = state;

const modules: Record<string, string> = {
  electron: "export const ipcMain = { on() {} };",
  "./app-state.js": `
    const state = globalThis.__petActivitiesRuntimeTest;
    export const getAppStateSnapshot = () => ({ pets: { installed: [{ id: 'cat' }] } });
    export const getEnabledPetActivityIds = () => state.enabled;
    export const setEnabledPetActivityIds = (_petId, ids) => state.save(ids);
  `,
  "./built-in-pet.js": "export const builtInPet = { id: 'builtin' };",
  "./installed-pet-layout.js": "export const readInstalledPetMetadata = async () => ({ activities: globalThis.__petActivitiesRuntimeTest.activities });",
  "./logger.js": "export const info = () => {}; export const warn = () => {};",
  "./pet-file-safety.js": "export const readPetActivitySpritesheet = async () => Buffer.from('validated activity bytes');",
  "./pet-paths.js": "export const assertSafePetId = () => {}; export const getPetDir = () => '/pets/cat';",
  "./pet-window-gaze.js": "export const setPetGazeActivityOverride = () => {};",
};
const mocks = Object.fromEntries(Object.entries(modules).map(([name, source]) => [name, `data:text/javascript,${encodeURIComponent(source)}`]));
register(`data:text/javascript,${encodeURIComponent(`
  const mocks = ${JSON.stringify(mocks)};
  export async function resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/pet-activities.js') && mocks[specifier]) {
      return { url: mocks[specifier], shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

class Contents extends EventEmitter {
  readonly sent: Array<{ readonly channel: string; readonly payload: Record<string, unknown> }> = [];
  isDestroyed() { return false; }
  send(channel: string, payload: Record<string, unknown>) { this.sent.push({ channel, payload }); }
}

class Window extends EventEmitter {
  readonly id = 1;
  readonly webContents = new Contents();
  isDestroyed() { return false; }
  isVisible() { return true; }
}

interface Render {
  readonly renderedPetId: string;
  readonly renderedOutfitId: string;
  readonly activities: readonly PetActivity[];
  readonly cacheKey: string;
  readonly petScale: number;
  readonly paused: boolean;
}

interface Runtime {
  registerPetActivityWindow(window: Window): void;
  preparePetActivityRender(window: Window, busy: boolean): void;
  updatePetActivityRender(window: Window, render: Render): void;
  setPetActivityScale(window: Window, scale: number): void;
  playPetActivity(petId: string, activityId: string): Promise<unknown>;
  setPetActivityEnabled(petId: string, activityId: string, enabled: boolean): Promise<unknown>;
  startPetActivities(): void;
  stopPetActivities(): void;
}

const originalRandom = Math.random;
Math.random = () => 0;
mock.timers.enable({ apis: ["Date", "setInterval"], now: 1_000_000 });
const runtimeModule = "../src/pet-activities.js";
const runtime = await import(runtimeModule) as Runtime;
const window = new Window();
const render: Render = {
  renderedPetId: "cat", renderedOutfitId: "default", activities: state.activities,
  cacheKey: "same-base-atlas", petScale: 1, paused: false,
};
const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};
const plays = () => window.webContents.sent.filter((message) => message.channel === "openpets:pet-activity" && message.payload.cancel !== true);
const cancels = () => window.webContents.sent.filter((message) => message.channel === "openpets:pet-activity" && message.payload.cancel === true);

try {
  runtime.registerPetActivityWindow(window);
  runtime.updatePetActivityRender(window, render);
  window.webContents.emit("did-finish-load");
  runtime.startPetActivities();
  mock.timers.tick(250);

  // The Resources HUD refreshes its noninteractive body every ten seconds. Idle still reaches its opportunity.
  for (let refresh = 0; refresh < 12; refresh += 1) {
    runtime.preparePetActivityRender(window, false);
    runtime.updatePetActivityRender(window, { ...render });
    mock.timers.tick(10_000);
  }
  await settle();
  assert.equal(plays().length, 1);
  assert.equal(cancels().length, 0);

  // A genuine raw busy state interrupts immediately; a later manual clip survives harmless body refreshes.
  runtime.preparePetActivityRender(window, true);
  assert.equal(cancels().length, 1);
  runtime.preparePetActivityRender(window, false);
  mock.timers.tick(1_000);
  await runtime.playPetActivity("cat", "read");
  await settle();
  const manualGeneration = plays().at(-1)!.payload.generation;
  runtime.preparePetActivityRender(window, false);
  runtime.updatePetActivityRender(window, { ...render });
  assert.equal(plays().length, 2, "a HUD refresh must not restart a manual clip");
  assert.equal(cancels().length, 1, "a HUD refresh must not truncate a manual clip");
  assert.equal(plays().at(-1)!.payload.generation, manualGeneration);

  // Reload stops the old renderer, but preserves the same scale override the gaze owner replays on ready.
  runtime.setPetActivityScale(window, 1.75);
  window.webContents.emit("did-start-loading");
  window.webContents.emit("did-finish-load");
  runtime.updatePetActivityRender(window, { ...render });
  mock.timers.tick(1_000);
  await runtime.playPetActivity("cat", "read");
  await settle();
  assert.equal(plays().at(-1)!.payload.scale, 1.75);
  const beforeAppearanceChange = cancels().length;
  runtime.updatePetActivityRender(window, { ...render, cacheKey: "pajamas-atlas", renderedOutfitId: "pajamas" });
  assert.equal(cancels().length, beforeAppearanceChange + 1);
  await assert.rejects(runtime.playPetActivity("cat", "read"), /default outfit/);

  // Replacing one id in a full sixteen-activity package must leave room to enable its replacement.
  state.enabled = Array.from({ length: 16 }, (_, index) => `activity-${index}`);
  state.activities = [...state.enabled.slice(1).map(activity), activity("new")];
  await runtime.setPetActivityEnabled("cat", "new", true);
  assert.equal(state.enabled.length, 16);
  assert.equal(state.enabled.includes("new"), true);
  assert.equal(state.enabled.includes("activity-0"), false);
} finally {
  runtime.stopPetActivities();
  window.emit("closed");
  mock.timers.reset();
  Math.random = originalRandom;
  delete (globalThis as typeof globalThis & { __petActivitiesRuntimeTest?: typeof state }).__petActivitiesRuntimeTest;
}
console.log("Native activity HUD continuity, reload scaling, and full-package preference replacement passed.");
