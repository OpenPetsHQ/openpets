import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildZedMcpEntry, classifyZedMcpStatus, executeZedMcpWrite, getZedGlobalSettingsPath, planZedMcpInstall, planZedMcpRemove, planZedMcpReplace, readZedSettings } from "@open-pets/zed";

const root = mkdtempSync(join(tmpdir(), "openpets-zed-desktop-"));

try {
  const appData = join(root, "appdata");
  const xdg = join(root, "xdg");
  assert.equal(getZedGlobalSettingsPath({ APPDATA: appData }, root, "win32"), join(appData, "Zed", "settings.json"));
  assert.equal(getZedGlobalSettingsPath({ XDG_CONFIG_HOME: xdg }, root, "linux"), join(xdg, "zed", "settings.json"));

  const settingsPath = join(root, "settings.json");
  const options = { mcpVersion: "3.3.0", petId: "fixer" };
  const plan = planZedMcpInstall(settingsPath, options);
  assert.equal("targetPath" in plan, true);
  if ("targetPath" in plan) executeZedMcpWrite(plan);

  const installed = classifyZedMcpStatus(readZedSettings(settingsPath), settingsPath, options);
  assert.equal(installed.status, "installed");
  assert.deepEqual(installed.previewEntry, buildZedMcpEntry(options));

  const source = JSON.stringify({ theme: "dark", context_servers: { openpets: buildZedMcpEntry(options), other: { command: "other", args: [] } } }, null, 2);
  writeFileSync(settingsPath, source, "utf8");
  const removePlan = planZedMcpRemove(settingsPath);
  assert.equal("targetPath" in removePlan, true);
  if ("targetPath" in removePlan) executeZedMcpWrite(removePlan);
  const removed = readFileSync(settingsPath, "utf8");
  assert.match(removed, /"theme": "dark"/);
  assert.match(removed, /"other"/);
  assert.doesNotMatch(removed, /"openpets"/);

  const remoteSettingsPath = join(root, "remote-settings.json");
  writeFileSync(remoteSettingsPath, JSON.stringify({ context_servers: {
    openpets: { ...buildZedMcpEntry(options), enabled: false, remote: true },
  } }, null, 2), "utf8");
  const remoteStatus = classifyZedMcpStatus(readZedSettings(remoteSettingsPath), remoteSettingsPath, options);
  assert.equal(remoteStatus.status, "needs-update");
  assert.equal(remoteStatus.canInstall, false);
  const remoteReplace = planZedMcpReplace(remoteSettingsPath, options);
  assert.equal("targetPath" in remoteReplace, true);
  if ("targetPath" in remoteReplace) executeZedMcpWrite(remoteReplace);
  const remoteEntry = JSON.parse(readFileSync(remoteSettingsPath, "utf8")).context_servers.openpets;
  assert.equal(remoteEntry.enabled, true);
  assert.equal(Object.hasOwn(remoteEntry, "remote"), false);

  mkdirSync(join(root, "nested"), { recursive: true });
  assert.equal(readZedSettings(join(root, "nested", "missing.json")).ok, true);
  console.error("Zed desktop validation passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
