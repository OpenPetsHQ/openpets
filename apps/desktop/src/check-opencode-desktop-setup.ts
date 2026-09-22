import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { mapAsarPathToUnpacked } from "@open-pets/claude";
import { doctorOpenCodeGlobalSetup, parseOpenCodeConfig, prepareOpenCodeGlobalRemove, prepareOpenCodeGlobalSetup, writePreparedOpenCodeGlobalRemove, writePreparedOpenCodeGlobalSetup } from "@open-pets/opencode";

// Canonicalize only the sandbox location: platform temp dirs can sit beneath
// system symlinks (e.g. /var on macOS), which ancestor validation must reject.
// Validation itself never canonicalizes the paths under test.
const root = mkdtempSync(join(realpathSync(tmpdir()), "openpets-desktop-opencode-"));

try {
  const globalDir = join(root, "opencode-global");
  const bundledCli = mapAsarPathToUnpacked(join(root, "OpenPets.app", "Contents", "Resources", "app.asar", "node_modules", "@open-pets", "cli", "dist", "index.js"));

  assert.equal(doctorOpenCodeGlobalSetup(globalDir).status, "not_installed");

  const install = prepareOpenCodeGlobalSetup({
    configDir: globalDir,
    petId: "fixer",
    cliVersion: "1.2.3",
    pluginVersion: "4.5.6",
    commandMode: "bundled",
    cliEntryPath: bundledCli,
  });

  assert.equal(install.configPath, join(globalDir, "opencode.jsonc"));
  assert.equal(install.instructionPath, join(globalDir, "openpets.md"));
  assert.match(install.configWrite.content, /app\.asar\.unpacked/);
  assert.doesNotMatch(install.configWrite.content, /app\.asar(?!\.unpacked)/);
  assert.match(install.configWrite.content, /@open-pets\/opencode@4\.5\.6/);

  const preview = parseOpenCodeConfig(install.configWrite.content);
  assert.equal(preview.ok, true, "desktop OpenCode preview must parse as JSONC without JSON.parse.");
  const previewConfig = preview.value as { readonly mcp?: { readonly openpets?: { readonly command?: readonly string[] } }; readonly plugin?: readonly unknown[] };
  assert.deepEqual(previewConfig.mcp?.openpets?.command, ["node", bundledCli, "mcp", "--pet", "fixer"]);
  assert.deepEqual(previewConfig.plugin, [["@open-pets/opencode@4.5.6", { pet: "fixer" }]]);

  writePreparedOpenCodeGlobalSetup(install);
  assert.equal(doctorOpenCodeGlobalSetup(globalDir).status, "installed");

  const remove = prepareOpenCodeGlobalRemove(globalDir);
  assert.equal(remove.configWrites.length, 1);
  writePreparedOpenCodeGlobalRemove(remove);
  assert.equal(doctorOpenCodeGlobalSetup(globalDir).status, "not_installed");

  const commentedGlobalDir = join(root, "commented-global");
  mkdirSync(commentedGlobalDir);
  writeFileSync(join(commentedGlobalDir, "opencode.jsonc"), `{
    // user comment must not block desktop preview planning
    "theme": "dark"
  }\n`, "utf8");
  const commented = prepareOpenCodeGlobalSetup({ configDir: commentedGlobalDir, petId: "fixer", cliVersion: "1.2.3", pluginVersion: "4.5.6" });
  assert.equal(parseOpenCodeConfig(commented.configWrite.content).ok, true);
  assert.match(commented.configWrite.content, /user comment/);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.error("OpenCode desktop setup validation passed.");
