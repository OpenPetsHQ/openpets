import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import * as moduleApi from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";

test("Motion install and restart retain healthy state, while damaged assets are marked broken", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openpets-motion-state-")));
  const userData = join(root, "user-data");
  const paths = `data:text/javascript,${encodeURIComponent(`
    import { join, resolve, sep } from "node:path";
    export function getPetsRoot() { return join(${JSON.stringify(userData)}, "pets"); }
    export function getPetDir(id, source) { return join(${JSON.stringify(userData)}, source === "team" ? "team-pets" : "pets", id); }
    export function getInstalledPetDir(id) { return getPetDir(id, "personal"); }
    export function getTeamPetDir(id) { return getPetDir(id, "team"); }
    export function assertSafePetId(id) { if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || id === "builtin") throw new Error("Invalid pet id"); }
    export function assertInsideRoot(root, target) { if (resolve(target) !== resolve(root) && !resolve(target).startsWith(resolve(root) + sep)) throw new Error("Outside root"); }
  `)}`;
  const electron = `data:text/javascript,${encodeURIComponent(`
    export const app = { getPath: () => ${JSON.stringify(userData)}, getVersion: () => "4.1.0" };
    export const net = {};
    export const powerMonitor = { on() {}, getSystemIdleTime: () => 0 };
    export const screen = { on() {}, getAllDisplays: () => [] };
    export const shell = { openPath: async () => "" };
    export default { app, net, powerMonitor, screen, shell };
  `)}`;
  const resolveMock = (specifier: string, parent: string | undefined): string | undefined => {
    if (specifier === "electron") return electron;
    if (specifier === "./pet-paths.js" && parent?.includes("/apps/desktop/")) return paths;
    return undefined;
  };
  const hooks = typeof moduleApi.registerHooks === "function" ? moduleApi.registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = resolveMock(specifier, context.parentURL);
      return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
    },
  }) : undefined;
  if (!hooks) {
    moduleApi.register(`data:text/javascript,${encodeURIComponent(`
      export async function resolve(specifier, context, nextResolve) {
        if (specifier === "electron") return { url: ${JSON.stringify(electron)}, shortCircuit: true };
        if (specifier === "./pet-paths.js" && context.parentURL?.includes("/apps/desktop/")) return { url: ${JSON.stringify(paths)}, shortCircuit: true };
        return nextResolve(specifier, context);
      }
    `)}`, import.meta.url);
  }
  let release = (): void => {};
  try {
    const state = await import("../src/app-state.js");
    const { installPetFromFolderWithResult } = await import("../src/pet-installation.js");
    release = state.releaseStartupInstallLock;
    state.initializeAppState();
    const folder = join(root, "source");
    await mkdir(join(folder, "clips"), { recursive: true });
    const pixels = Buffer.alloc(8 * 16 * 4, 255);
    pixels[3] = 0;
    pixels[8 * 8 * 4 + 3] = 0;
    for (let offset = 8 * 8 * 4; offset < pixels.length; offset += 4) pixels[offset] = 0;
    const bytes = await sharp(pixels, { raw: { width: 8, height: 16, channels: 4, pageHeight: 8 } }).webp({ delay: [100, 120], loop: 0 }).toBuffer();
    const manifest = {
      format: "motion", version: 1, id: "motion", displayName: "Motion", description: "Motion pet",
      geometry: { width: 8, height: 8, pixelsPerUnit: 1, footAnchor: { x: 4, y: 8 } },
      clips: { idle: { file: "clips/idle.webp", frames: 2 } },
      animations: { idle: { play: "loop", loop: "idle" } },
      bindings: { idle: [{ animation: "idle" }], movement: { left: "idle", right: "idle" } },
    };
    await writeFile(join(folder, "pet.json"), JSON.stringify(manifest));
    await writeFile(join(folder, "clips", "idle.webp"), bytes);
    await installPetFromFolderWithResult(folder);
    const pet = () => state.getAppStateSnapshot().pets.installed.find((entry) => entry.id === "motion");
    assert.notEqual(pet()?.broken, true);
    release();
    state.initializeAppState();
    assert.notEqual(pet()?.broken, true);

    const installedClip = join(userData, "pets", "motion", "clips", "idle.webp");
    await unlink(installedClip);
    state.updatePreferences({});
    assert.equal(pet()?.broken, true);
    assert.match(pet()?.brokenReason ?? "", /Motion clip idle is missing/);
    await writeFile(installedClip, Buffer.alloc(0));
    state.updatePreferences({});
    assert.match(pet()?.brokenReason ?? "", /Motion clip idle is invalid/);
    await writeFile(installedClip, bytes);
    await writeFile(join(userData, "pets", "motion", "pet.json"), JSON.stringify({ ...manifest, version: 99 }));
    state.updatePreferences({});
    assert.equal(pet()?.broken, true);
    assert.match(pet()?.brokenReason ?? "", /Motion/);
    await installPetFromFolderWithResult(folder);
    assert.notEqual(pet()?.broken, true, "successful replacement clears a prior broken state");

    // Existing Classic health checks continue to reject missing atlases.
    const classicDir = join(userData, "pets", "classic");
    await mkdir(classicDir, { recursive: true });
    await writeFile(join(classicDir, "pet.json"), JSON.stringify({ id: "classic", spritesheetPath: "spritesheet.webp" }));
    await writeFile(join(classicDir, "spritesheet.webp"), Buffer.from("existing Classic atlas"));
    state.upsertPetState({ id: "classic", displayName: "Classic" });
    assert.notEqual(state.getAppStateSnapshot().pets.installed.find((entry) => entry.id === "classic")?.broken, true);
    await unlink(join(classicDir, "spritesheet.webp"));
    state.updatePreferences({});
    assert.equal(state.getAppStateSnapshot().pets.installed.find((entry) => entry.id === "classic")?.broken, true);
  } finally {
    release();
    hooks?.deregister();
    await rm(root, { recursive: true, force: true });
  }
});
