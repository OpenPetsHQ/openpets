import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { maxPinnedPets } from "../src/pinned-pets.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "openpets-pinned-state-")));
const electronMock = `data:text/javascript,${encodeURIComponent(`
  export const app = { getVersion: () => '4.1.0', getPath: () => ${JSON.stringify(root)}, isReady: () => true };
  export const net = {};
  export const powerMonitor = { on() {}, getSystemIdleTime: () => 0 };
  export const screen = { on() {}, getAllDisplays: () => [] };
  export const shell = { openPath: async () => '' };
  export default { app, net, powerMonitor, screen, shell };
`)}`;
const petPathsMock = `data:text/javascript,${encodeURIComponent(`
  import { join } from 'node:path';
  export const getInstalledPetDir = (petId) => join(${JSON.stringify(root)}, 'pets', petId);
  export const getTeamPetDir = (petId) => join(${JSON.stringify(root)}, 'team-pets', petId);
  export function assertSafePetId(petId) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(petId) || petId === 'builtin') throw new Error('Invalid pet id.');
  }
`)}`;
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') return { url: ${JSON.stringify(electronMock)}, shortCircuit: true };
    if (specifier === './pet-paths.js' && context.parentURL?.endsWith('/app-state.js')) {
      return { url: ${JSON.stringify(petPathsMock)}, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

const state = await import("../src/app-state.js");
const extraIds = Array.from({ length: maxPinnedPets + 1 }, (_, index) => `pet-${index}`);

try {
  state.initializeAppState();
  for (const petId of ["primary", ...extraIds]) {
    const directory = join(root, "pets", petId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "pet.json"), JSON.stringify({ id: petId, displayName: petId, spritesheetPath: "spritesheet.svg" }));
    writeFileSync(join(directory, "spritesheet.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1872"><rect width="1536" height="1872" fill="blue"/></svg>');
    state.upsertPetState({ id: petId, displayName: petId });
  }
  state.setDefaultPet("primary");

  // Adding two different desktop companions must not replace the default or lose either saved pin on restart.
  state.setPetPinned(extraIds[0]!, true);
  state.setPetPinned(extraIds[1]!, true);
  state.recordPinnedPetPosition(extraIds[0]!, { x: 120, y: 220 });
  state.recordPinnedPetPosition(extraIds[1]!, { x: 320, y: 420 });
  assert.equal(state.getAppStateSnapshot().preferences.defaultPetId, "primary");
  state.releaseStartupInstallLock();
  state.initializeAppState();
  const restored = state.getAppStateSnapshot();
  assert.deepEqual(restored.preferences.pinnedPets, extraIds.slice(0, 2));
  assert.equal(restored.preferences.defaultPetId, "primary");
  assert.deepEqual(restored.preferences.pinnedPetPositions, {
    [extraIds[0]!]: { x: 120, y: 220 },
    [extraIds[1]!]: { x: 320, y: 420 },
  });

  // Remove only the requested pet and its position; the remaining pin and default stay untouched.
  state.setPetPinned(extraIds[0]!, false);
  const removed = state.getAppStateSnapshot();
  assert.deepEqual(removed.preferences.pinnedPets, [extraIds[1]]);
  assert.deepEqual(removed.preferences.pinnedPetPositions, { [extraIds[1]!]: { x: 320, y: 420 } });
  assert.equal(removed.preferences.defaultPetId, "primary");
  state.setPetPinned(extraIds[1]!, true);
  assert.deepEqual(state.getAppStateSnapshot().preferences.pinnedPets, [extraIds[1]], "adding an existing pin must not duplicate it");

  // A full collection still permits removal, and the freed slot can hold a different pet without losing its siblings.
  state.setPinnedPets([]);
  for (const petId of extraIds) state.setPetPinned(petId, true);
  assert.deepEqual(state.getAppStateSnapshot().preferences.pinnedPets, extraIds.slice(0, maxPinnedPets));
  const removedAtCap = extraIds[3]!;
  state.setPetPinned(removedAtCap, false);
  state.setPetPinned(extraIds[maxPinnedPets]!, true);
  const expected = extraIds.filter((petId) => petId !== removedAtCap);
  assert.deepEqual(state.getAppStateSnapshot().preferences.pinnedPets, expected);
  state.releaseStartupInstallLock();
  state.initializeAppState();
  assert.deepEqual(state.getAppStateSnapshot().preferences.pinnedPets, expected);
  assert.equal(state.getAppStateSnapshot().preferences.defaultPetId, "primary");
} finally {
  state.releaseStartupInstallLock();
  rmSync(root, { recursive: true, force: true });
}

console.log("Pinned companions preserve default, independent pins/positions, restart restoration and capped removal behavior.");
