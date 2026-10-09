import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDevinSetup, installDevinGlobal, removeDevinGlobal, replaceDevinGlobal, type DevinSetupAction, type DevinSetupDependencies } from "../src/agent-setup-devin.js";

// Protects the Control Center lifecycle for the user-scope MCP config shared by
// Devin Desktop and Devin CLI, including the Node.js preflight for local modes.
const rootDir = mkdtempSync(join(realpathSync(tmpdir()), "openpets-agent-setup-devin-"));
const configPath = join(rootDir, "devin", "mcp_config.json");
const finished: DevinSetupAction[] = [];
let nodeChecks = 0;
const dependencies: DevinSetupDependencies = {
  configPath,
  commandMode: "published",
  mcpVersion: "4.0.0",
  selectedPetId: "cat",
  formatUserPath: (path) => path,
  checkNodeCommand: async () => {
    nodeChecks += 1;
    return undefined;
  },
  finishAction: (action) => {
    finished.push(action);
  },
};

function readOpenPetsArgs(): readonly string[] | undefined {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { readonly mcpServers?: { readonly openpets?: { readonly args?: readonly string[] } } };
  return config.mcpServers?.openpets?.args;
}

try {
  const initial = await getDevinSetup(dependencies);
  assert.equal(initial.status.state, "needs_setup");
  assert.equal(initial.status.canInstall, true);
  assert.equal(initial.preview.mcpEntry.command, "npx");

  const installed = await installDevinGlobal(dependencies);
  assert.equal(installed.ok, true);
  assert.deepEqual(readOpenPetsArgs(), ["-y", "@open-pets/mcp@4.0.0", "--pet", "cat"]);
  assert.equal((await getDevinSetup(dependencies)).status.state, "configured");

  const repeated = await installDevinGlobal(dependencies);
  assert.equal(repeated.ok, false);
  assert.equal(repeated.changed, false);

  const otherPet = { ...dependencies, selectedPetId: "dog" };
  assert.equal((await getDevinSetup(otherPet)).status.state, "needs_update");
  const replaced = await replaceDevinGlobal(otherPet);
  assert.equal(replaced.ok, true);
  assert.deepEqual(readOpenPetsArgs(), ["-y", "@open-pets/mcp@4.0.0", "--pet", "dog"]);

  const removed = await removeDevinGlobal(otherPet);
  assert.equal(removed.ok, true);
  assert.equal(readOpenPetsArgs(), undefined);
  assert.equal((await getDevinSetup(otherPet)).status.state, "needs_setup");

  // A failing Node.js preflight blocks writes that would point Devin at a broken command.
  const blocked = await installDevinGlobal({ ...dependencies, checkNodeCommand: async () => "Node.js is required." });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.message, "Node.js is required.");
  assert.equal(readOpenPetsArgs(), undefined);

  assert.equal(nodeChecks, 3, "install and replace preflight Node.js; remove does not");
  assert.deepEqual(finished, ["devin-install", "devin-install", "devin-replace", "devin-remove", "devin-install"]);
} finally {
  rmSync(rootDir, { recursive: true, force: true });
}
