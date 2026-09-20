import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getZedSetup, installZedGlobal, removeZedGlobal, replaceZedGlobal, type ZedSetupAction, type ZedSetupActionResult } from "../src/agent-setup-zed.js";

// This protects the global Zed settings preview/install/replace/remove lifecycle.
const rootDir = mkdtempSync(join(realpathSync(tmpdir()), "openpets-agent-setup-zed-"));
const settingsPath = join(rootDir, "settings.json");
const formatUserPath = (path: string | undefined) => path;
const finished: Array<{ readonly action: ZedSetupAction; readonly previousStatus: string; readonly result: ZedSetupActionResult }> = [];
let nodeChecks = 0;
const dependencies = {
  settingsPath,
  commandMode: "published" as const,
  mcpVersion: "3.5.0",
  selectedPetId: "cat",
  formatUserPath,
  checkNodeCommand: async () => {
    nodeChecks += 1;
    return undefined;
  },
  finishAction: (action: ZedSetupAction, _selectedPetId: string | undefined, previousStatus: string, result: ZedSetupActionResult) => {
    finished.push({ action, previousStatus, result });
    return result;
  },
};

try {
  const initial = await getZedSetup(dependencies);
  assert.equal(initial.status.state, "needs_setup");
  assert.equal(initial.preview.commandMode, "published");
  assert.equal(initial.preview.mcpEntry.command, "npx");

  const installed = await installZedGlobal(dependencies);
  assert.equal(installed.action, "zed-install");
  assert.equal(installed.changed, true);
  const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { readonly context_servers: { readonly openpets: { readonly args: readonly string[] } } };
  assert.deepEqual(settings.context_servers.openpets.args, ["-y", "@open-pets/mcp@3.5.0", "--pet", "cat"]);

  const configured = await getZedSetup(dependencies);
  assert.equal(configured.status.state, "configured");

  const replaced = await replaceZedGlobal({ ...dependencies, selectedPetId: "dog" });
  assert.equal(replaced.action, "zed-replace");
  assert.equal(replaced.changed, true);

  const removed = await removeZedGlobal({ ...dependencies, selectedPetId: "dog" });
  assert.equal(removed.action, "zed-remove");
  assert.equal(removed.changed, true);

  const final = await getZedSetup({ ...dependencies, selectedPetId: "dog" });
  assert.equal(final.status.state, "needs_setup");
  assert.equal(nodeChecks, 2);
  assert.deepEqual(finished.map(({ action }) => action), ["zed-install", "zed-replace", "zed-remove"]);
} finally {
  rmSync(rootDir, { recursive: true, force: true });
}
