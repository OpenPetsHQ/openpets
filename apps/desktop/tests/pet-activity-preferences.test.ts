import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = realpathSync(mkdtempSync(join(tmpdir(), "openpets-activity-preferences-")));
const electronMock = `data:text/javascript,${encodeURIComponent(`
  export const app = { getVersion: () => "4.1.0", getPath: () => ${JSON.stringify(root)}, isReady: () => true };
  export const net = {};
  export const powerMonitor = { on: () => {}, getSystemIdleTime: () => 0 };
  export const screen = { on: () => {}, getAllDisplays: () => [] };
  export const shell = { openPath: async () => "" };
  export default { app, net, powerMonitor, screen, shell };
`)}`;
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: ${JSON.stringify(electronMock)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

const state = await import("../src/app-state.js");
try {
  // The first install is opt-in; preferences are durable across a real state reload.
  state.initializeAppState();
  state.upsertPetState({ id: "cat", displayName: "Cat" });
  assert.deepEqual(state.getEnabledPetActivityIds("cat"), []);
  state.setEnabledPetActivityIds("cat", ["read", "cat_nap"]);
  state.releaseStartupInstallLock();
  state.initializeAppState();
  assert.deepEqual(state.getEnabledPetActivityIds("cat"), ["read", "cat_nap"]);

  // Same-id content replacement preserves an owner's choices; uninstall does not opt a fresh install back in.
  state.upsertPetState({ id: "cat", displayName: "Cat reimport" });
  assert.deepEqual(state.getEnabledPetActivityIds("cat"), ["read", "cat_nap"]);
  state.setEnabledPetActivityIds("cat", ["cat_nap"]);
  state.removePetState("cat");
  state.upsertPetState({ id: "cat", displayName: "New Cat" });
  assert.deepEqual(state.getEnabledPetActivityIds("cat"), []);
} finally {
  state.releaseStartupInstallLock();
  rmSync(root, { recursive: true, force: true });
}
console.log("Native activity opt-in persistence, reimport and uninstall behavior passed.");
