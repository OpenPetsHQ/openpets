import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { hookSpeechPools, validateHookSpeech } from "@open-pets/agent-events";

import { createOpenCodeExecutableDetection, executePlannedWrite, getGlobalOpenCodeConfigDir, getGlobalOpenCodeConfigPaths, getProjectOpenCodeConfigPaths, parseOpenCodeConfig, planOpenCodeConfigWrite, selectProjectOpenCodeConfigPath, updateOpenCodeConfigText } from "./opencode-config.js";
import { buildOpenCodeInstructionPath, buildOpenCodeMcpEntry, buildOpenCodePluginPreview, formatOpenCodeMcpConfig } from "./opencode-previews.js";
import { doctorOpenCodeGlobalSetup, prepareOpenCodeGlobalRemove, prepareOpenCodeGlobalSetup, writePreparedOpenCodeGlobalRemove, writePreparedOpenCodeGlobalSetup } from "./opencode-global-setup.js";
import { classifyOpenCodeInstructionsStatus, classifyOpenCodeMcpStatus, classifyOpenCodePluginStatus } from "./opencode-status.js";

// Canonicalize only the sandbox location: platform temp dirs can sit beneath
// system symlinks (e.g. /var on macOS), which ancestor validation must reject.
// Validation itself never canonicalizes the paths under test.
const root = mkdtempSync(join(realpathSync(tmpdir()), "openpets-opencode-"));
try {
  const project = join(root, "project");
  mkdirSync(project);
  const paths = getProjectOpenCodeConfigPaths(project);
  assert.deepEqual(paths.candidates.map((path) => path.slice(project.length + 1)), ["opencode.json", "opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc"]);
  assert.equal(selectProjectOpenCodeConfigPath(project), join(project, ".opencode", "opencode.jsonc"));
  mkdirSync(join(project, ".opencode"));
  writeFileSync(join(project, ".opencode", "opencode.jsonc"), "{}\n");
  assert.equal(selectProjectOpenCodeConfigPath(project), join(project, ".opencode", "opencode.jsonc"));
  writeFileSync(join(project, "opencode.json"), "{}\n");
  assert.equal(selectProjectOpenCodeConfigPath(project), join(project, "opencode.json"));

  assert.equal(getGlobalOpenCodeConfigDir({ OPENCODE_CONFIG_DIR: join(root, "custom") }, root, "linux"), join(root, "custom"));
  assert.equal(getGlobalOpenCodeConfigDir({ XDG_CONFIG_HOME: join(root, "xdg") }, root, "linux"), join(root, "xdg", "opencode"));
  assert.equal(getGlobalOpenCodeConfigDir({ APPDATA: join(root, "appdata") }, root, "win32"), join(root, ".config", "opencode"), "Windows OpenCode config is XDG-based, not stored under APPDATA.");
  assert.equal(getGlobalOpenCodeConfigDir({ XDG_CONFIG_HOME: join(root, "xdg") }, root, "win32"), join(root, "xdg", "opencode"));
  assert.deepEqual(getGlobalOpenCodeConfigPaths({ OPENCODE_CONFIG_DIR: join(root, "global") }, root, "linux").candidates.map((path) => path.slice(join(root, "global").length + 1)), ["config.json", "opencode.json", "opencode.jsonc"]);
  assert.deepEqual(createOpenCodeExecutableDetection({ platform: "win32" }).command, "opencode");
  assert.deepEqual(createOpenCodeExecutableDetection({ platform: "darwin" }).command, "opencode");

  assert.deepEqual(formatOpenCodeMcpConfig({ cliVersion: "0.0.0", petId: "fixer" }), { mcp: { openpets: { type: "local", command: ["npx", "-y", "@open-pets/cli@0.0.0", "mcp", "--pet", "fixer"], enabled: true } } });
  assert.deepEqual(buildOpenCodeMcpEntry({ cliVersion: "0.0.0" }), { type: "local", command: ["npx", "-y", "@open-pets/cli@0.0.0", "mcp"], enabled: true });
  assert.deepEqual(buildOpenCodeMcpEntry({ cliVersion: "0.0.0", environment: { OPENPETS_DISCOVERY_FILE: "/mnt/c/Users/alvin/AppData/Roaming/OpenPets/runtime/ipc.json" } }), { type: "local", command: ["npx", "-y", "@open-pets/cli@0.0.0", "mcp"], enabled: true, environment: { OPENPETS_DISCOVERY_FILE: "/mnt/c/Users/alvin/AppData/Roaming/OpenPets/runtime/ipc.json" } });
  assert.deepEqual(buildOpenCodeMcpEntry({ cliVersion: "0.0.0", commandMode: "local", cliEntryPath: join(root, "cli.js"), petId: "fixer" }), { type: "local", command: ["node", join(root, "cli.js"), "mcp", "--pet", "fixer"], enabled: true });
  assert.throws(() => buildOpenCodeMcpEntry({ cliVersion: "0.0.0", commandMode: "local", cliEntryPath: "relative.js" }));
  assert.throws(() => buildOpenCodeMcpEntry({ cliVersion: "0.0.0", petId: "bad/pet" }));
  assert.equal(buildOpenCodeInstructionPath("project"), ".opencode/openpets.md");
  assert.equal(buildOpenCodeInstructionPath("global", join(root, "global")), join(root, "global", "openpets.md"));
  assert.deepEqual(buildOpenCodePluginPreview({ petId: "fixer" }), ["@open-pets/opencode", { pet: "fixer" }]);
  assert.deepEqual(buildOpenCodePluginPreview({ petId: "fixer", packageVersion: "0.0.0" }), ["@open-pets/opencode@0.0.0", { pet: "fixer" }]);
  assert.deepEqual(buildOpenCodePluginPreview({}), "@open-pets/opencode");
  assert.deepEqual(buildOpenCodePluginPreview({ excludeReactions: ["success", "thinking", "not-a-reaction"] }), ["@open-pets/opencode", { excludeReactions: ["success", "thinking"] }], "config previews must not persist unrecognized exclusions");
  assert.deepEqual(buildOpenCodePluginPreview({ petId: "fixer", excludeReactions: ["success"] }), ["@open-pets/opencode", { pet: "fixer", excludeReactions: ["success"] }]);

  const jsonc = `{
    // keep this comment
    "theme": "dark",
    "mcp": { "other": { "type": "local", "command": ["x"] } },
  }`;
  const parsed = parseOpenCodeConfig(jsonc);
  assert.equal(parsed.ok, true);
  const updated = updateOpenCodeConfigText(jsonc, [{ path: ["mcp", "openpets"], value: buildOpenCodeMcpEntry({ cliVersion: "0.0.0", petId: "fixer" }) }]);
  assert.equal(typeof updated, "string");
  assert.match(String(updated), /keep this comment/);
  assert.match(String(updated), /"openpets"/);
  assert.match(String(updated), /"other"/);
  assert.equal(parseOpenCodeConfig("{").ok, false);
  assert.equal(parseOpenCodeConfig("[]").ok, false);
  assert.equal(parseOpenCodeConfig(JSON.stringify({ mcp: [] })).ok, false);
  assert.equal(parseOpenCodeConfig(JSON.stringify({ instructions: "x" })).ok, false);
  assert.equal(parseOpenCodeConfig(JSON.stringify({ plugin: {} })).ok, false);
  assert.equal(parseOpenCodeConfig(JSON.stringify({ instructions: [1] })).ok, false);
  assert.equal(parseOpenCodeConfig(`{"x":"${"a".repeat(1024 * 1024)}"}`).ok, false);

  const expected = { cliVersion: "0.0.0", petId: "fixer" };
  assert.equal(classifyOpenCodeMcpStatus([], expected).status, "not_installed");
  assert.equal(classifyOpenCodeMcpStatus([{ mcp: { openpets: buildOpenCodeMcpEntry(expected) } }], expected).status, "installed");
  assert.equal(classifyOpenCodeMcpStatus([{ mcp: { openpets: { ...buildOpenCodeMcpEntry(expected), environment: { OPENPETS_DISCOVERY_FILE: "/mnt/c/Users/alvin/AppData/Roaming/OpenPets/runtime/ipc.json" } } } }], expected).status, "installed");
  assert.equal(classifyOpenCodeMcpStatus([{ mcp: { openpets: { command: ["npx", "-y", "@open-pets/cli@0.0.0", "mcp", "--pet", "fixer"], enabled: true, type: "local" } } }], expected).status, "installed");
  assert.equal(classifyOpenCodeMcpStatus([{ mcp: { openpets: buildOpenCodeMcpEntry({ cliVersion: "0.0.0", petId: "helper" }) } }], expected).status, "needs_update");
  assert.equal(classifyOpenCodeMcpStatus([{ mcp: { openpets: buildOpenCodeMcpEntry({ cliVersion: "0.0.0", commandMode: "local", cliEntryPath: join(root, "cli.js"), petId: "helper" }) } }], { cliVersion: "0.0.0", commandMode: "local", cliEntryPath: join(root, "cli.js"), petId: "fixer" }).status, "needs_update");
  assert.equal(classifyOpenCodeMcpStatus([{ mcp: { openpets: { type: "local", command: ["npx", "-y", "@open-pets/cli@0.0.0", "mcp", "--pet", "fixer"], enabled: false } } }], expected).status, "custom");
  assert.equal(classifyOpenCodeMcpStatus([{ mcp: { openpets: { type: "remote", command: ["npx", "-y", "@open-pets/cli@0.0.0", "mcp", "--pet", "fixer"], enabled: true } } }], expected).status, "custom");
  assert.equal(classifyOpenCodeMcpStatus([{ mcp: { openpets: { type: "local", command: ["npx", "-y", "@open-pets/cli@file:../cli", "mcp", "--pet", "fixer"], enabled: true } } }], expected).status, "custom");
  assert.equal(classifyOpenCodeMcpStatus([{ mcp: { openpets: { type: "local", command: ["npx", "-y", "@open-pets/cli@workspace:*", "mcp", "--pet", "fixer"], enabled: true } } }], expected).status, "custom");
  assert.equal(classifyOpenCodeMcpStatus([{ mcp: { openpets: { type: "local", command: ["npx", "-y", "@open-pets/cli@0.0.0", "mcp", "--pet", "fixer"], enabled: true, timeout: 10 } } }], expected).status, "custom");
  assert.equal(classifyOpenCodeMcpStatus([{ mcp: { openpets: { type: "local", command: ["my-openpets-wrapper"] } } }], expected).status, "custom");
  assert.equal(classifyOpenCodeMcpStatus([{ mcp: { openpets: buildOpenCodeMcpEntry(expected) } }, { mcp: { openpets: buildOpenCodeMcpEntry({ cliVersion: "0.0.0", petId: "helper" }) } }], expected).status, "conflict");
  assert.equal(classifyOpenCodeInstructionsStatus([{ instructions: [".opencode/openpets.md"] }], "project", undefined, { ".opencode/openpets.md": "<!-- OPENPETS:START -->\nHi\n<!-- OPENPETS:END -->\n" }).status, "installed");
  assert.equal(classifyOpenCodeInstructionsStatus([{ instructions: [".opencode/openpets.md"] }], "project").status, "needs_update");
  assert.equal(classifyOpenCodeInstructionsStatus([{ instructions: [".opencode/openpets.md"] }, { instructions: ["old-openpets.md"] }], "project", undefined, { ".opencode/openpets.md": "<!-- OPENPETS:START -->\nHi\n<!-- OPENPETS:END -->\n" }).status, "conflict");
  assert.equal(classifyOpenCodeInstructionsStatus([{ instructions: ["old-openpets.md"] }], "project").status, "custom");
  assert.equal(classifyOpenCodePluginStatus([{ plugin: [["@open-pets/opencode", { pet: "fixer" }]] }], "fixer").status, "installed");
  assert.equal(classifyOpenCodePluginStatus([{ plugin: [["@open-pets/opencode@0.0.0", { pet: "fixer" }]] }], "fixer", "0.0.0").status, "installed");
  assert.equal(classifyOpenCodePluginStatus([{ plugin: ["@open-pets/opencode"] }], "fixer").status, "needs_update");
  assert.equal(classifyOpenCodePluginStatus([{ plugin: [["@open-pets/opencode@old", { pet: "helper" }], "./openpets-custom-plugin.js"] }], "fixer", "0.0.0").status, "conflict");
  assert.equal(classifyOpenCodePluginStatus([{ plugin: [["@open-pets/opencode@0.0.0"]] }], "fixer", "0.0.0").status, "custom");
  assert.equal(classifyOpenCodePluginStatus([{ plugin: [["@open-pets/opencode@0.0.0", {}]] }], "fixer", "0.0.0").status, "custom");
  assert.equal(classifyOpenCodePluginStatus([{ plugin: [["@open-pets/opencode@0.0.0", { pet: "fixer" }, "extra"]] }], "fixer", "0.0.0").status, "custom");
  assert.equal(classifyOpenCodePluginStatus([{ plugin: [["@open-pets/opencode@0.0.0", { pet: "fixer", extra: true }]] }], "fixer", "0.0.0").status, "custom");
  assert.equal(classifyOpenCodePluginStatus([{ plugin: [["@open-pets/opencode@0.0.0", { pet: "fixer", excludeReactions: ["success"] }]] }], "fixer", "0.0.0").status, "needs_update", "plugin with excludeReactions but no matching expected spec should need update");
  assert.equal(classifyOpenCodePluginStatus([{ plugin: [["@open-pets/opencode@0.0.0", { pet: "helper", excludeReactions: ["success"] }]] }], "fixer", "0.0.0").status, "needs_update", "plugin with excludeReactions but wrong pet is managed-but-outdated");
  assert.equal(classifyOpenCodePluginStatus([{ plugin: [["@open-pets/opencode@0.0.0", { excludeReactions: ["success", "thinking"] }]] }], undefined, "0.0.0", ["thinking", "success"]).status, "installed", "exclusions-only plugin options round-trip without a pet regardless of ordering");
  assert.equal(classifyOpenCodePluginStatus([{ plugin: [["@open-pets/opencode@0.0.0", { excludeReactions: ["success", 1] }]] }], undefined, "0.0.0", ["success"]).status, "custom", "invalid exclusions remain custom rather than managed");
  assert.equal(classifyOpenCodePluginStatus([{ plugin: ["./openpets-custom-plugin.js"] }], "fixer").status, "custom");
  assert.equal(classifyOpenCodePluginStatus([{ plugin: [["@open-pets/opencode", { pet: "fixer" }], "./openpets-custom-plugin.js"] }], "fixer").status, "conflict");

  const writeTarget = join(root, "write", "opencode.jsonc");
  const writePlan = planOpenCodeConfigWrite(root, writeTarget, "{\"mcp\":{}}\n");
  if ("targetPath" in writePlan) {
    executePlannedWrite(writePlan);
    assert.equal(existsSync(writeTarget), true);
    const second = planOpenCodeConfigWrite(root, writeTarget, "{\"mcp\":{}}\n");
    assert.equal("backupPath" in second && Boolean(second.backupPath), true);
    if ("targetPath" in second && second.backupPath) {
      writeFileSync(second.backupPath, "already exists");
      assert.throws(() => executePlannedWrite(second));
    }
    assert.throws(() => executePlannedWrite({ ...writePlan, rootPath: join(root, "missing-root") }));
    assert.throws(() => executePlannedWrite({ ...writePlan, tempPath: join(tmpdir(), "openpets-unsafe.tmp") }));
    assert.throws(() => executePlannedWrite({ ...writePlan, backupPath: join(tmpdir(), "openpets-unsafe.backup") }));
  }
  const outsidePlan = planOpenCodeConfigWrite(root, join(tmpdir(), "outside-opencode.jsonc"), "{}\n");
  assert.equal("ok" in outsidePlan ? outsidePlan.ok : true, false);
  const linkTarget = join(root, "link-target");
  mkdirSync(linkTarget);
  symlinkSync(linkTarget, join(root, "link-parent"));
  const linkParentPlan = planOpenCodeConfigWrite(root, join(root, "link-parent", "opencode.jsonc"), "{}\n");
  assert.equal("ok" in linkParentPlan ? linkParentPlan.ok : true, false);
  const linkedFile = join(root, "linked-file.jsonc");
  writeFileSync(join(root, "real-file.jsonc"), "{}\n");
  symlinkSync(join(root, "real-file.jsonc"), linkedFile);
  const linkedFilePlan = planOpenCodeConfigWrite(root, linkedFile, "{}\n");
  assert.equal("ok" in linkedFilePlan ? linkedFilePlan.ok : true, false);
  symlinkSync(project, join(root, "project-link"));
  assert.throws(() => getProjectOpenCodeConfigPaths(join(root, "project-link")));

  const globalDir = join(root, "global-missing");
  const globalPrepared = prepareOpenCodeGlobalSetup({ configDir: globalDir, petId: "fixer", cliVersion: "0.0.0" });
  writePreparedOpenCodeGlobalSetup(globalPrepared);
  assert.equal(existsSync(join(globalDir, "opencode.jsonc")), true);
  assert.equal(doctorOpenCodeGlobalSetup(globalDir).status, "installed");
  const globalConfig = readFileSync(join(globalDir, "opencode.jsonc"), "utf8");
  assert.match(globalConfig, /@open-pets\/opencode@0\.0\.0/);
  assert.match(readFileSync(join(globalDir, "openpets.md"), "utf8"), /OPENPETS:START/);
  const globalRemove = prepareOpenCodeGlobalRemove(globalDir);
  writePreparedOpenCodeGlobalRemove(globalRemove);
  assert.equal(doctorOpenCodeGlobalSetup(globalDir).status, "not_installed");

  const globalExclusionsOnly = join(root, "global-exclusions-only");
  writePreparedOpenCodeGlobalSetup(prepareOpenCodeGlobalSetup({ configDir: globalExclusionsOnly, cliVersion: "0.0.0", excludeReactions: ["success", "thinking", "not-a-reaction"] }));
  assert.doesNotMatch(readFileSync(join(globalExclusionsOnly, "opencode.jsonc"), "utf8"), /not-a-reaction/, "setup must not persist unrecognized exclusions");
  assert.doesNotThrow(() => prepareOpenCodeGlobalSetup({ configDir: globalExclusionsOnly, cliVersion: "0.0.0", excludeReactions: ["thinking", "success", "not-a-reaction"] }), "exclusions-only setup should recognize its existing plugin entry");

  const globalLower = join(root, "global-lower");
  mkdirSync(globalLower);
  writeFileSync(join(globalLower, "config.json"), JSON.stringify({ theme: "keep" }), "utf8");
  writeFileSync(join(globalLower, "opencode.jsonc"), JSON.stringify({ plugin: [["@open-pets/opencode@old", { pet: "helper" }]] }), "utf8");
  writePreparedOpenCodeGlobalSetup(prepareOpenCodeGlobalSetup({ configDir: globalLower, petId: "fixer", cliVersion: "0.0.0" }));
  assert.equal(readFileSync(join(globalLower, "config.json"), "utf8").includes("@open-pets/opencode"), false);
  assert.match(readFileSync(join(globalLower, "opencode.jsonc"), "utf8"), /@open-pets\/opencode@0\.0\.0/);

  const globalExistingJson = join(root, "global-existing-json");
  mkdirSync(globalExistingJson);
  writeFileSync(join(globalExistingJson, "opencode.json"), JSON.stringify({ plugin: ["user-plugin"], instructions: ["USER.md"] }, null, 2), "utf8");
  const existingJsonPrepared = prepareOpenCodeGlobalSetup({ configDir: globalExistingJson, petId: "fixer", cliVersion: "0.0.0" });
  assert.equal(existingJsonPrepared.configPath, join(globalExistingJson, "opencode.json"));
  writePreparedOpenCodeGlobalSetup(existingJsonPrepared);
  assert.equal(existsSync(join(globalExistingJson, "opencode.jsonc")), false, "desktop global setup must not create a higher-precedence opencode.jsonc over an existing opencode.json");
  const existingJsonConfig = JSON.parse(readFileSync(join(globalExistingJson, "opencode.json"), "utf8")) as { readonly plugin?: readonly unknown[]; readonly instructions?: readonly string[] };
  assert.deepEqual(existingJsonConfig.plugin?.[0], "user-plugin");
  assert.ok(existingJsonConfig.instructions?.includes("USER.md"));

  const globalExistingMultiple = join(root, "global-existing-multiple");
  mkdirSync(globalExistingMultiple);
  writeFileSync(join(globalExistingMultiple, "config.json"), JSON.stringify({ theme: "base" }, null, 2), "utf8");
  writeFileSync(join(globalExistingMultiple, "opencode.json"), JSON.stringify({ plugin: ["user-plugin"] }, null, 2), "utf8");
  const existingMultiplePrepared = prepareOpenCodeGlobalSetup({ configDir: globalExistingMultiple, petId: "fixer", cliVersion: "0.0.0" });
  assert.equal(existingMultiplePrepared.configPath, join(globalExistingMultiple, "opencode.json"));
  assert.equal(readFileSync(join(globalExistingMultiple, "config.json"), "utf8").includes("openpets"), false);

  const globalLowerPluginOwner = join(root, "global-lower-plugin-owner");
  mkdirSync(globalLowerPluginOwner);
  writeFileSync(join(globalLowerPluginOwner, "config.json"), JSON.stringify({ plugin: ["user-plugin"] }, null, 2), "utf8");
  writeFileSync(join(globalLowerPluginOwner, "opencode.json"), JSON.stringify({ theme: "dark" }, null, 2), "utf8");
  const lowerPluginPrepared = prepareOpenCodeGlobalSetup({ configDir: globalLowerPluginOwner, petId: "fixer", cliVersion: "0.0.0" });
  assert.equal(lowerPluginPrepared.configPath, join(globalLowerPluginOwner, "config.json"));
  writePreparedOpenCodeGlobalSetup(lowerPluginPrepared);
  const lowerPluginConfig = JSON.parse(readFileSync(join(globalLowerPluginOwner, "config.json"), "utf8")) as { readonly plugin?: readonly unknown[] };
  assert.deepEqual(lowerPluginConfig.plugin?.[0], "user-plugin");
  assert.equal(readFileSync(join(globalLowerPluginOwner, "opencode.json"), "utf8").includes("openpets"), false);

  const globalSplitArrayOwners = join(root, "global-split-array-owners");
  mkdirSync(globalSplitArrayOwners);
  writeFileSync(join(globalSplitArrayOwners, "config.json"), JSON.stringify({ plugin: ["user-plugin"] }, null, 2), "utf8");
  writeFileSync(join(globalSplitArrayOwners, "opencode.json"), JSON.stringify({ instructions: ["USER.md"] }, null, 2), "utf8");
  assert.throws(() => prepareOpenCodeGlobalSetup({ configDir: globalSplitArrayOwners, petId: "fixer", cliVersion: "0.0.0" }), /different config files/);

  const globalEmptyPluginShadow = join(root, "global-empty-plugin-shadow");
  mkdirSync(globalEmptyPluginShadow);
  writeFileSync(join(globalEmptyPluginShadow, "config.json"), JSON.stringify({ plugin: ["user-plugin"] }, null, 2), "utf8");
  writeFileSync(join(globalEmptyPluginShadow, "opencode.json"), JSON.stringify({ plugin: [] }, null, 2), "utf8");
  assert.throws(() => prepareOpenCodeGlobalSetup({ configDir: globalEmptyPluginShadow, petId: "fixer", cliVersion: "0.0.0" }), /higher-precedence config shadows user plugin/);

  const globalEmptyInstructionShadow = join(root, "global-empty-instruction-shadow");
  mkdirSync(globalEmptyInstructionShadow);
  writeFileSync(join(globalEmptyInstructionShadow, "config.json"), JSON.stringify({ instructions: ["USER.md"] }, null, 2), "utf8");
  writeFileSync(join(globalEmptyInstructionShadow, "opencode.json"), JSON.stringify({ instructions: [] }, null, 2), "utf8");
  assert.throws(() => prepareOpenCodeGlobalSetup({ configDir: globalEmptyInstructionShadow, petId: "fixer", cliVersion: "0.0.0" }), /higher-precedence config shadows user instructions/);

  const globalEmptyArrayOwner = join(root, "global-empty-array-owner");
  mkdirSync(globalEmptyArrayOwner);
  writeFileSync(join(globalEmptyArrayOwner, "opencode.json"), JSON.stringify({ plugin: [] }, null, 2), "utf8");
  const emptyArrayOwnerPrepared = prepareOpenCodeGlobalSetup({ configDir: globalEmptyArrayOwner, petId: "fixer", cliVersion: "0.0.0" });
  assert.equal(emptyArrayOwnerPrepared.configPath, join(globalEmptyArrayOwner, "opencode.json"));

  const globalStaleOverlay = join(root, "global-stale-overlay");
  mkdirSync(globalStaleOverlay);
  writeFileSync(join(globalStaleOverlay, "opencode.json"), JSON.stringify({ plugin: ["user-plugin"], instructions: ["USER.md"] }, null, 2), "utf8");
  writeFileSync(join(globalStaleOverlay, "opencode.jsonc"), JSON.stringify({ plugin: [["@open-pets/opencode@0.0.0", { pet: "helper" }]], instructions: [buildOpenCodeInstructionPath("global", globalStaleOverlay)] }, null, 2), "utf8");
  const stalePrepared = prepareOpenCodeGlobalSetup({ configDir: globalStaleOverlay, petId: "fixer", cliVersion: "0.0.1" });
  assert.equal(stalePrepared.configPath, join(globalStaleOverlay, "opencode.json"));
  assert.equal(stalePrepared.cleanupConfigWrites.length, 1);
  writePreparedOpenCodeGlobalSetup(stalePrepared);
  const staleOwnerConfig = JSON.parse(readFileSync(join(globalStaleOverlay, "opencode.json"), "utf8")) as { readonly plugin?: readonly unknown[]; readonly instructions?: readonly string[] };
  assert.deepEqual(staleOwnerConfig.plugin?.[0], "user-plugin");
  assert.ok(staleOwnerConfig.instructions?.includes("USER.md"));
  const staleOverlayText = readFileSync(join(globalStaleOverlay, "opencode.jsonc"), "utf8");
  assert.doesNotMatch(staleOverlayText, /plugin/);
  assert.doesNotMatch(staleOverlayText, /instructions/);

  const globalStaleRemove = join(root, "global-stale-remove");
  mkdirSync(globalStaleRemove);
  writeFileSync(join(globalStaleRemove, "opencode.json"), JSON.stringify({ plugin: ["user-plugin"] }, null, 2), "utf8");
  writeFileSync(join(globalStaleRemove, "opencode.jsonc"), JSON.stringify({ plugin: [["@open-pets/opencode@0.0.0", { pet: "fixer" }]] }, null, 2), "utf8");
  writePreparedOpenCodeGlobalRemove(prepareOpenCodeGlobalRemove(globalStaleRemove));
  assert.doesNotMatch(readFileSync(join(globalStaleRemove, "opencode.jsonc"), "utf8"), /plugin/);
  assert.match(readFileSync(join(globalStaleRemove, "opencode.json"), "utf8"), /user-plugin/);

  const globalPublishedToBundled = join(root, "global-published-to-bundled");
  mkdirSync(globalPublishedToBundled);
  writeFileSync(join(globalPublishedToBundled, "opencode.jsonc"), JSON.stringify({ mcp: { openpets: buildOpenCodeMcpEntry({ cliVersion: "0.0.0", petId: "helper" }) } }), "utf8");
  const bundledCli = join(root, "app.asar.unpacked", "node_modules", "@open-pets", "cli", "dist", "index.js");
  const migrated = prepareOpenCodeGlobalSetup({ configDir: globalPublishedToBundled, petId: "fixer", cliVersion: "0.0.1", pluginVersion: "0.0.2", commandMode: "bundled", cliEntryPath: bundledCli });
  assert.equal(migrated.configPath, join(globalPublishedToBundled, "opencode.jsonc"));
  assert.match(migrated.configWrite.content, /app\.asar\.unpacked/);
  assert.doesNotMatch(migrated.configWrite.content, /app\.asar(?!\.unpacked)/);
  assert.match(migrated.configWrite.content, /@open-pets\/opencode@0\.0\.2/);

  const globalNoInstructionMarkers = join(root, "global-no-instruction-markers");
  mkdirSync(globalNoInstructionMarkers);
  writeFileSync(join(globalNoInstructionMarkers, "opencode.jsonc"), JSON.stringify({ instructions: [buildOpenCodeInstructionPath("global", globalNoInstructionMarkers)] }), "utf8");
  writeFileSync(join(globalNoInstructionMarkers, "openpets.md"), "user owned\n", "utf8");
  const noMarkerRemove = prepareOpenCodeGlobalRemove(globalNoInstructionMarkers);
  assert.equal(noMarkerRemove.instructionWrite, undefined);

  const globalCustomPluginOptions = join(root, "global-custom-plugin-options");
  mkdirSync(globalCustomPluginOptions);
  writeFileSync(join(globalCustomPluginOptions, "opencode.jsonc"), JSON.stringify({ plugin: [["@open-pets/opencode@0.0.0", { pet: "fixer", extra: true }]] }), "utf8");
  assert.throws(() => prepareOpenCodeGlobalSetup({ configDir: globalCustomPluginOptions, petId: "fixer", cliVersion: "0.0.0" }));

  const globalCustom = join(root, "global-custom");
  mkdirSync(globalCustom);
  writeFileSync(join(globalCustom, "opencode.jsonc"), JSON.stringify({ mcp: { openpets: { type: "local", command: ["custom", "mcp"] } } }), "utf8");
  assert.throws(() => prepareOpenCodeGlobalSetup({ configDir: globalCustom, petId: "fixer", cliVersion: "0.0.0" }));
  assert.throws(() => prepareOpenCodeGlobalRemove(globalCustom));

  const globalManagedMcpEnvironment = join(root, "global-managed-mcp-environment");
  mkdirSync(globalManagedMcpEnvironment);
  writeFileSync(join(globalManagedMcpEnvironment, "opencode.jsonc"), JSON.stringify({ mcp: { openpets: { type: "local", command: ["npx", "-y", "@open-pets/cli@0.0.0", "mcp", "--pet", "fixer"], enabled: true, environment: { OPENPETS_DEBUG: "1" } } } }), "utf8");
  assert.doesNotThrow(() => prepareOpenCodeGlobalSetup({ configDir: globalManagedMcpEnvironment, petId: "fixer", cliVersion: "0.0.0" }));

  const globalSymlink = join(root, "global-symlink");
  const globalOutside = join(root, "global-outside");
  mkdirSync(globalOutside);
  writeFileSync(join(globalOutside, "opencode.jsonc"), "{}\n", "utf8");
  symlinkSync(globalOutside, globalSymlink);
  assert.equal(doctorOpenCodeGlobalSetup(globalSymlink).status, "error");

  // Issue #188: symlinked global opencode.json must be rejected with an
  // actionable error that names the path and target without mutating it.
  const symlinkFileDir = join(root, "global-symlink-file");
  const symlinkFileTargetDir = join(root, "global-symlink-file-target");
  mkdirSync(symlinkFileDir);
  mkdirSync(symlinkFileTargetDir);
  const symlinkTargetFile = join(symlinkFileTargetDir, "opencode.json");
  writeFileSync(symlinkTargetFile, JSON.stringify({ theme: "dotfiles" }, null, 2), "utf8");
  const symlinkedConfig = join(symlinkFileDir, "opencode.json");
  symlinkSync(symlinkTargetFile, symlinkedConfig);
  const targetBefore = readFileSync(symlinkTargetFile, "utf8");
  let symlinkFileError = "";
  try {
    prepareOpenCodeGlobalSetup({ configDir: symlinkFileDir, petId: "fixer", cliVersion: "0.0.0" });
  } catch (error) {
    symlinkFileError = error instanceof Error ? error.message : String(error);
  }
  assert.match(symlinkFileError, new RegExp(escapeCheckRegExp(symlinkedConfig)));
  assert.match(symlinkFileError, /symlink/);
  assert.match(symlinkFileError, new RegExp(escapeCheckRegExp(symlinkTargetFile)));
  assert.match(symlinkFileError, /was not modified/);
  assert.match(symlinkFileError, /atomic-write/);
  assert.match(symlinkFileError, /use project-local OpenCode setup/, "global errors suggest project-local setup as a fallback");
  assert.equal(readFileSync(symlinkTargetFile, "utf8"), targetBefore, "symlink target must remain untouched");
  assert.equal(readFileSync(symlinkedConfig, "utf8"), targetBefore);
  const symlinkFileDoctor = doctorOpenCodeGlobalSetup(symlinkFileDir);
  assert.equal(symlinkFileDoctor.status, "error");
  assert.match(symlinkFileDoctor.message, new RegExp(escapeCheckRegExp(symlinkedConfig)));
  assert.match(symlinkFileDoctor.message, /symlink/);
  assert.equal(readFileSync(symlinkTargetFile, "utf8"), targetBefore, "doctor must remain read-only");
  assert.equal(hasCheckEntry(join(symlinkFileDir, "openpets.md")), false, "doctor must not create instruction files");

  // Dangling symlinks must be treated as existing links, never as missing
  // paths that setup may replace via atomic rename.
  const danglingGlobalDir = join(root, "global-dangling-config");
  mkdirSync(danglingGlobalDir);
  const danglingTarget = join(danglingGlobalDir, "missing-target.json");
  const danglingConfig = join(danglingGlobalDir, "opencode.json");
  symlinkSync(danglingTarget, danglingConfig);
  let danglingConfigError = "";
  try {
    prepareOpenCodeGlobalSetup({ configDir: danglingGlobalDir, petId: "fixer", cliVersion: "0.0.0" });
  } catch (error) {
    danglingConfigError = error instanceof Error ? error.message : String(error);
  }
  assert.match(danglingConfigError, new RegExp(escapeCheckRegExp(danglingConfig)));
  assert.match(danglingConfigError, /symlink/);
  assert.match(danglingConfigError, /was not modified/);
  assert.match(danglingConfigError, new RegExp(escapeCheckRegExp(danglingTarget)));
  assert.match(danglingConfigError, /use project-local OpenCode setup/, "global errors suggest project-local setup as a fallback");
  assert.equal(lstatSync(danglingConfig).isSymbolicLink(), true, "dangling symlink itself must not be replaced");
  assert.equal(hasCheckEntry(danglingTarget), false, "no contents may be created through the dangling link");
  const danglingDoctor = doctorOpenCodeGlobalSetup(danglingGlobalDir);
  assert.equal(danglingDoctor.status, "error");
  assert.match(danglingDoctor.message, new RegExp(escapeCheckRegExp(danglingConfig)));
  assert.equal(lstatSync(danglingConfig).isSymbolicLink(), true, "doctor must not replace the dangling symlink");
  assert.equal(hasCheckEntry(join(danglingGlobalDir, "openpets.md")), false, "doctor must remain read-only");

  // Relative dangling links report an absolute resolved target for actionability.
  const relativeGlobalDir = join(root, "global-relative-dangling");
  mkdirSync(relativeGlobalDir);
  const relativeConfig = join(relativeGlobalDir, "opencode.jsonc");
  symlinkSync(join("..", "elsewhere", "opencode.jsonc"), relativeConfig);
  let relativeError = "";
  try {
    prepareOpenCodeGlobalSetup({ configDir: relativeGlobalDir, petId: "fixer", cliVersion: "0.0.0" });
  } catch (error) {
    relativeError = error instanceof Error ? error.message : String(error);
  }
  assert.match(relativeError, /symlink/);
  assert.match(relativeError, new RegExp(escapeCheckRegExp(join(dirname(relativeConfig), join("..", "elsewhere", "opencode.jsonc")))));

  // Dangling instruction-file symlinks are rejected without replacement.
  const danglingInstructionDir = join(root, "global-dangling-instruction");
  mkdirSync(danglingInstructionDir);
  writeFileSync(join(danglingInstructionDir, "opencode.jsonc"), "{}\n", "utf8");
  const danglingInstructionTarget = join(danglingInstructionDir, "missing-instruction.md");
  const danglingInstruction = join(danglingInstructionDir, "openpets.md");
  symlinkSync(danglingInstructionTarget, danglingInstruction);
  let danglingInstructionError = "";
  try {
    prepareOpenCodeGlobalSetup({ configDir: danglingInstructionDir, petId: "fixer", cliVersion: "0.0.0" });
  } catch (error) {
    danglingInstructionError = error instanceof Error ? error.message : String(error);
  }
  assert.match(danglingInstructionError, new RegExp(escapeCheckRegExp(danglingInstruction)));
  assert.match(danglingInstructionError, /symlink/);
  assert.equal(lstatSync(danglingInstruction).isSymbolicLink(), true, "dangling instruction symlink must not be replaced");
  assert.equal(hasCheckEntry(danglingInstructionTarget), false, "no instruction contents may be created through the link");

  // A dangling config directory symlink is reported as a symlink, not a
  // missing directory, by both setup and doctor.
  const danglingDirTarget = join(root, "missing-config-target");
  const danglingDirLink = join(root, "global-dangling-dir");
  symlinkSync(danglingDirTarget, danglingDirLink);
  let danglingDirError = "";
  try {
    prepareOpenCodeGlobalSetup({ configDir: danglingDirLink, petId: "fixer", cliVersion: "0.0.0" });
  } catch (error) {
    danglingDirError = error instanceof Error ? error.message : String(error);
  }
  assert.match(danglingDirError, new RegExp(escapeCheckRegExp(danglingDirLink)));
  assert.match(danglingDirError, /symlink/);
  assert.match(danglingDirError, new RegExp(escapeCheckRegExp(danglingDirTarget)));
  const danglingDirDoctor = doctorOpenCodeGlobalSetup(danglingDirLink);
  assert.equal(danglingDirDoctor.status, "error");
  assert.match(danglingDirDoctor.message, new RegExp(escapeCheckRegExp(danglingDirLink)));
  assert.equal(lstatSync(danglingDirLink).isSymbolicLink(), true, "dangling config dir symlink must not be replaced");
  assert.equal(hasCheckEntry(danglingDirTarget), false);

  // A config directory nested under a dangling ancestor reports the
  // offending ancestor instead of a raw ENOENT from following the link.
  const danglingAncestorTarget = join(root, "missing-ancestor-target");
  const danglingAncestorLink = join(root, "ancestor-link");
  symlinkSync(danglingAncestorTarget, danglingAncestorLink);
  const nestedConfigDir = join(danglingAncestorLink, "opencode");
  let nestedAncestorError = "";
  try {
    prepareOpenCodeGlobalSetup({ configDir: nestedConfigDir, petId: "fixer", cliVersion: "0.0.0" });
  } catch (error) {
    nestedAncestorError = error instanceof Error ? error.message : String(error);
  }
  assert.match(nestedAncestorError, new RegExp(escapeCheckRegExp(danglingAncestorLink)));
  assert.match(nestedAncestorError, /symlink/);
  assert.match(nestedAncestorError, new RegExp(escapeCheckRegExp(danglingAncestorTarget)));
  assert.doesNotMatch(nestedAncestorError, /ENOENT/);
  assert.equal(lstatSync(danglingAncestorLink).isSymbolicLink(), true);
  assert.equal(hasCheckEntry(nestedConfigDir), false, "no config may be created through the dangling ancestor");

  // A valid ancestor directory symlink is rejected before any read or
  // write, even though the configured root itself looks like a directory.
  const ancestorRealDir = join(root, "ancestor-real");
  mkdirSync(ancestorRealDir);
  const ancestorLink = join(root, "ancestor-link-valid");
  symlinkSync(ancestorRealDir, ancestorLink);
  const nestedValidConfigDir = join(ancestorLink, "opencode");
  let ancestorValidError = "";
  try {
    prepareOpenCodeGlobalSetup({ configDir: nestedValidConfigDir, petId: "fixer", cliVersion: "0.0.0" });
  } catch (error) {
    ancestorValidError = error instanceof Error ? error.message : String(error);
  }
  assert.match(ancestorValidError, new RegExp(escapeCheckRegExp(ancestorLink)));
  assert.match(ancestorValidError, /symlink/);
  assert.match(ancestorValidError, /was not modified/);
  assert.match(ancestorValidError, new RegExp(escapeCheckRegExp(ancestorRealDir)));
  assert.match(ancestorValidError, /use project-local OpenCode setup/);
  assert.equal(lstatSync(ancestorLink).isSymbolicLink(), true, "ancestor symlink must not be followed");
  assert.equal(hasCheckEntry(join(ancestorRealDir, "opencode.jsonc")), false, "no config may be written through the ancestor symlink");
  assert.equal(hasCheckEntry(join(ancestorRealDir, "openpets.md")), false, "no instructions may be written through the ancestor symlink");
  const ancestorValidDoctor = doctorOpenCodeGlobalSetup(nestedValidConfigDir);
  assert.equal(ancestorValidDoctor.status, "error");
  assert.match(ancestorValidDoctor.message, new RegExp(escapeCheckRegExp(ancestorLink)));
  assert.match(ancestorValidDoctor.message, /symlink/);
  assert.equal(hasCheckEntry(join(ancestorRealDir, "opencode.jsonc")), false, "doctor must remain read-only");

  // A dangling ancestor symlink is likewise rejected with the offending
  // ancestor path and its fallback target, not a raw ENOENT.
  const ancestorDanglingTarget = join(root, "missing-ancestor-dir");
  const ancestorDanglingLink = join(root, "ancestor-link-dangling");
  symlinkSync(ancestorDanglingTarget, ancestorDanglingLink);
  const nestedDanglingConfigDir = join(ancestorDanglingLink, "opencode");
  let ancestorDanglingError = "";
  try {
    prepareOpenCodeGlobalSetup({ configDir: nestedDanglingConfigDir, petId: "fixer", cliVersion: "0.0.0" });
  } catch (error) {
    ancestorDanglingError = error instanceof Error ? error.message : String(error);
  }
  assert.match(ancestorDanglingError, new RegExp(escapeCheckRegExp(ancestorDanglingLink)));
  assert.match(ancestorDanglingError, /symlink/);
  assert.match(ancestorDanglingError, /was not modified/);
  assert.match(ancestorDanglingError, new RegExp(escapeCheckRegExp(ancestorDanglingTarget)));
  assert.doesNotMatch(ancestorDanglingError, /ENOENT/);
  assert.equal(lstatSync(ancestorDanglingLink).isSymbolicLink(), true);
  assert.equal(hasCheckEntry(ancestorDanglingTarget), false);
  const ancestorDanglingDoctor = doctorOpenCodeGlobalSetup(nestedDanglingConfigDir);
  assert.equal(ancestorDanglingDoctor.status, "error");
  assert.match(ancestorDanglingDoctor.message, new RegExp(escapeCheckRegExp(ancestorDanglingLink)));
  assert.equal(hasCheckEntry(join(nestedDanglingConfigDir, "openpets.md")), false, "doctor must remain read-only");

  // Dangling project config symlinks are rejected at plan time.
  const danglingProjectDir = join(root, "project-dangling");
  mkdirSync(danglingProjectDir);
  const danglingProjectTarget = join(danglingProjectDir, "missing.jsonc");
  const danglingProjectConfig = join(danglingProjectDir, "opencode.jsonc");
  symlinkSync(danglingProjectTarget, danglingProjectConfig);
  const danglingProjectPlan = planOpenCodeConfigWrite(danglingProjectDir, danglingProjectConfig, "{}\n");
  assert.equal("ok" in danglingProjectPlan && !danglingProjectPlan.ok, true);
  const danglingProjectMessage = "ok" in danglingProjectPlan && !danglingProjectPlan.ok ? danglingProjectPlan.message : "";
  assert.match(danglingProjectMessage, new RegExp(escapeCheckRegExp(danglingProjectConfig)));
  assert.match(danglingProjectMessage, /symlink/);
  assert.doesNotMatch(danglingProjectMessage, /use project-local/, "project errors must not suggest switching to project-local setup");
  assert.equal(lstatSync(danglingProjectConfig).isSymbolicLink(), true, "dangling project symlink must not be replaced");
  assert.equal(hasCheckEntry(danglingProjectTarget), false);

  // A dangling parent directory symlink in a project is recognized as a
  // symlink — not a missing directory — during config planning.
  const danglingParentProject = join(root, "project-dangling-parent");
  mkdirSync(danglingParentProject);
  const danglingParentTarget = join(danglingParentProject, "missing-dir");
  const danglingParentLink = join(danglingParentProject, ".opencode");
  symlinkSync(danglingParentTarget, danglingParentLink);
  const danglingParentPlan = planOpenCodeConfigWrite(danglingParentProject, join(danglingParentLink, "opencode.jsonc"), "{}\n");
  assert.equal("ok" in danglingParentPlan && !danglingParentPlan.ok, true);
  const danglingParentPlanMessage = "ok" in danglingParentPlan && !danglingParentPlan.ok ? danglingParentPlan.message : "";
  assert.match(danglingParentPlanMessage, new RegExp(escapeCheckRegExp(danglingParentLink)));
  assert.match(danglingParentPlanMessage, /symlink/);
  assert.match(danglingParentPlanMessage, /was not modified/);
  assert.match(danglingParentPlanMessage, new RegExp(escapeCheckRegExp(danglingParentTarget)));
  assert.doesNotMatch(danglingParentPlanMessage, /ENOENT/);
  assert.doesNotMatch(danglingParentPlanMessage, /use project-local/, "project errors must not suggest switching to project-local setup");
  assert.equal(lstatSync(danglingParentLink).isSymbolicLink(), true, "dangling parent symlink must not be replaced");
  assert.equal(hasCheckEntry(danglingParentTarget), false);

  // Unsafe parent-directory symlinks remain rejected with the offending path.
  const unsafeParentMessage = "ok" in linkParentPlan && !linkParentPlan.ok ? linkParentPlan.message : "";
  assert.match(unsafeParentMessage, /was not modified/);
  assert.match(unsafeParentMessage, new RegExp(escapeCheckRegExp(join(root, "link-parent"))));

  // Regular-file global setup still works with atomic backup/write behavior.
  const regularGlobalDir = join(root, "global-regular-backup");
  mkdirSync(regularGlobalDir);
  writeFileSync(join(regularGlobalDir, "opencode.json"), JSON.stringify({ theme: "keep" }, null, 2), "utf8");
  const firstRegular = prepareOpenCodeGlobalSetup({ configDir: regularGlobalDir, petId: "fixer", cliVersion: "0.0.0" });
  writePreparedOpenCodeGlobalSetup(firstRegular);
  assert.equal(doctorOpenCodeGlobalSetup(regularGlobalDir).status, "installed");
  const configBeforeSecond = readFileSync(firstRegular.configPath, "utf8");
  const secondRegular = prepareOpenCodeGlobalSetup({ configDir: regularGlobalDir, petId: "fixer", cliVersion: "0.0.0" });
  assert.ok(secondRegular.configWrite.backupPath, "second global write must plan a backup");
  writePreparedOpenCodeGlobalSetup(secondRegular);
  const backups = (await import("node:fs")).readdirSync(regularGlobalDir).filter((name) => name.includes("openpets-backup"));
  assert.ok(backups.length >= 1, "atomic backup must be written");
  assert.match(readFileSync(join(regularGlobalDir, backups[0]!), "utf8"), /theme/);
  assert.match(readFileSync(firstRegular.configPath, "utf8"), /@open-pets\/opencode/);
  assert.ok(configBeforeSecond.includes("@open-pets/opencode"));

  for (const [category, messages] of Object.entries(hookSpeechPools) as Array<[string, readonly string[]]>) {
    for (const message of messages) {
      assert.match(message, /^[A-Z]/, `${category} hook speech must start uppercase`);
      validateHookSpeech(message);
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

function escapeCheckRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasCheckEntry(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT") return false;
    throw error;
  }
}

console.error("OpenCode foundation validation passed.");
