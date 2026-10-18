import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Startup must tell a fresh install (no state file) from an upgrade (state file
// written by an older version without the field), and persist the decision.

const globalWithUserData = globalThis as typeof globalThis & { __openPetsTestUserData?: string };

const electronMock = `data:text/javascript,${encodeURIComponent(`
  export const app = {
    getVersion: () => "4.1.0",
    getPath: () => globalThis.__openPetsTestUserData,
    isReady: () => true,
  };
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

const { getLastSeenWhatsNewVersion, initializeAppState, markWhatsNewSeen, releaseStartupInstallLock } = await import("../src/app-state.js");

function withUserData(seedState: unknown | undefined, run: (userDataPath: string) => void): void {
  const userDataPath = realpathSync(mkdtempSync(join(tmpdir(), "openpets-whats-new-state-")));
  globalWithUserData.__openPetsTestUserData = userDataPath;
  if (seedState !== undefined) {
    writeFileSync(join(userDataPath, "openpets-state.json"), JSON.stringify(seedState), "utf8");
  }
  try {
    initializeAppState();
    run(userDataPath);
  } finally {
    releaseStartupInstallLock();
    rmSync(userDataPath, { recursive: true, force: true });
  }
}

function persistedLastSeen(userDataPath: string): unknown {
  const persisted = JSON.parse(readFileSync(join(userDataPath, "openpets-state.json"), "utf8")) as { preferences?: { lastSeenWhatsNewVersion?: unknown } };
  return persisted.preferences?.lastSeenWhatsNewVersion;
}

// Fresh install: the running version is recorded as seen and written to disk.
withUserData(undefined, (userDataPath) => {
  assert.equal(getLastSeenWhatsNewVersion(), "4.1.0");
  assert.equal(persistedLastSeen(userDataPath), "4.1.0");
});

// Upgrade from an older version: the field stays absent so the changelog is pending.
withUserData({ version: 1, preferences: { defaultPetId: "builtin", onboardingCompleted: false } }, (userDataPath) => {
  assert.equal(getLastSeenWhatsNewVersion(), undefined);
  assert.equal(persistedLastSeen(userDataPath), undefined);

  markWhatsNewSeen("4.1.0");
  assert.equal(getLastSeenWhatsNewVersion(), "4.1.0");
  assert.equal(persistedLastSeen(userDataPath), "4.1.0");
});

// A malformed stored value is dropped rather than trusted.
withUserData({ version: 1, preferences: { lastSeenWhatsNewVersion: "soon" } }, () => {
  assert.equal(getLastSeenWhatsNewVersion(), undefined);
});

console.error("What's new app-state validation passed.");
