import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getOpenCodeSetup, installOpenCodeGlobal, removeOpenCodeGlobal } from "../src/agent-setup-opencode.js";

// This protects the global OpenCode configuration preview/install/remove lifecycle.
const configDir = mkdtempSync(join(realpathSync(tmpdir()), "openpets-agent-setup-opencode-"));
const formatUserPath = (path: string | undefined) => path;
const dependencies = {
  configDir,
  cliVersion: "3.5.0",
  pluginVersion: "3.5.0",
  commandMode: "published" as const,
  detected: true,
  preferredCommandIsDefault: true,
  formatUserPath,
};

try {
  const initial = getOpenCodeSetup(dependencies);
  assert.equal(initial.status.state, "needs_setup");
  assert.ok(initial.preview.configPath);

  const installed = installOpenCodeGlobal(dependencies);
  assert.equal(installed.action, "opencode-install");
  assert.equal(installed.changed, true);
  const config = JSON.parse(readFileSync(initial.preview.configPath, "utf8")) as { readonly mcp: { readonly openpets: unknown } };
  assert.ok(config.mcp.openpets);

  const configured = getOpenCodeSetup(dependencies);
  assert.equal(configured.status.state, "configured");

  const removed = removeOpenCodeGlobal({ configDir });
  assert.equal(removed.action, "opencode-remove");
  assert.equal(removed.changed, true);

  const final = getOpenCodeSetup(dependencies);
  assert.equal(final.status.state, "needs_setup");
} finally {
  rmSync(configDir, { recursive: true, force: true });
}
