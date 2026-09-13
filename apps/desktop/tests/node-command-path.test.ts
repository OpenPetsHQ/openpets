import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";

const userDataPath = realpathSync(mkdtempSync(join(tmpdir(), "openpets-node-command-path-")));
const nodeDirectory = join(userDataPath, "node");
const nodePath = join(nodeDirectory, "node.exe");
const rawNodePath = `${nodeDirectory}${sep}..${sep}node${sep}node.exe`;
mkdirSync(nodeDirectory, { recursive: true });
writeFileSync(nodePath, "node", "utf8");
chmodSync(nodePath, 0o700);
writeFileSync(join(userDataPath, "openpets-state.json"), JSON.stringify({ version: 1, preferences: { nodeCommandPath: rawNodePath } }), "utf8");

const electronMock = `data:text/javascript,${encodeURIComponent(`
  export const app = { getPath: (name) => name === "userData" ? ${JSON.stringify(userDataPath)} : ${JSON.stringify(userDataPath)}, isReady: () => true };
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

try {
  const { getAppStateSnapshot, initializeAppState, releaseStartupInstallLock } = await import("../src/app-state.js");
  try {
    initializeAppState();
    assert.equal(getAppStateSnapshot().preferences.nodeCommandPath, realpathSync(nodePath));
    const persisted = JSON.parse(readFileSync(join(userDataPath, "openpets-state.json"), "utf8")) as { preferences?: { nodeCommandPath?: unknown } };
    assert.equal(persisted.preferences?.nodeCommandPath, realpathSync(nodePath));
  } finally {
    releaseStartupInstallLock();
  }
} finally {
  rmSync(userDataPath, { recursive: true, force: true });
}

console.error("Node command paths with parent traversal are canonicalized and preserved.");
