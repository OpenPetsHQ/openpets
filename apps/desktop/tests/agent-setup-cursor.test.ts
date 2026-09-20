import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getCursorGlobalMcpPath } from "@open-pets/cursor";

import { getCursorSetup, installCursorGlobal, removeCursorGlobal } from "../src/agent-setup-cursor.js";

// This protects Cursor's global config lifecycle and its fixed published command mode.
const homeDir = mkdtempSync(join(realpathSync(tmpdir()), "openpets-agent-setup-cursor-"));
mkdirSync(join(homeDir, ".cursor"));
const dependencies = {
  homeDir,
  mcpVersion: "3.5.0",
  formatUserPath: (path: string | undefined) => path,
};

try {
  const initial = await getCursorSetup(undefined, dependencies);
  assert.equal(initial.status.state, "needs_setup");
  assert.equal(initial.preview.commandMode, "published");
  assert.equal(initial.preview.mcpEntry.openpets?.command, "npx");
  assert.deepEqual(initial.preview.mcpEntry.openpets?.args, ["-y", "@open-pets/mcp@3.5.0"]);

  const installed = await installCursorGlobal(undefined, dependencies);
  assert.equal(installed.action, "cursor-install");
  assert.equal(installed.changed, true);
  const configPath = getCursorGlobalMcpPath(homeDir);
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { readonly mcpServers: { readonly openpets: { readonly command: string; readonly args: readonly string[] } } };
  assert.equal(config.mcpServers.openpets.command, "npx");
  assert.deepEqual(config.mcpServers.openpets.args, ["-y", "@open-pets/mcp@3.5.0"]);

  const configured = await getCursorSetup(undefined, dependencies);
  assert.equal(configured.status.state, "configured");

  const removed = await removeCursorGlobal(dependencies);
  assert.equal(removed.action, "cursor-remove");
  assert.equal(removed.changed, true);

  const final = await getCursorSetup(undefined, dependencies);
  assert.equal(final.status.state, "needs_setup");
} finally {
  rmSync(homeDir, { recursive: true, force: true });
}
