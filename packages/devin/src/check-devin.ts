import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDevinMcpEntry,
  classifyDevinMcpStatus,
  executeDevinConfigWrite,
  getDevinGlobalMcpConfigPath,
  planDevinMcpInstall,
  planDevinMcpRemove,
  planDevinMcpReplace,
  readDevinMcpConfig,
  type DevinConfigError,
  type DevinMcpPreviewOptions,
  type DevinPlannedWrite,
  buildDevinHookCommand,
  classifyDevinHooks,
  getDevinCliConfigPath,
  getDevinDesktopHooksPath,
  mapDevinHookPayload,
  planDevinHooksInstall,
  planDevinHooksRemove,
  type DevinHookCommandOptions,
} from "./index.js";

// macOS tmpdir() lives under /var -> /private/var; the symlink guard would
// rightfully reject it, so work from the resolved path.
const root = mkdtempSync(join(realpathSync(tmpdir()), "openpets-devin-"));
const options: DevinMcpPreviewOptions = { mcpVersion: "4.0.0", petId: "fixer" };
let caseIndex = 0;

function freshConfigPath(): string {
  caseIndex += 1;
  const dir = join(root, `case-${caseIndex}`, "devin");
  mkdirSync(dir, { recursive: true });
  return join(dir, "mcp_config.json");
}

function statusOf(configPath: string, expected: DevinMcpPreviewOptions = options) {
  return classifyDevinMcpStatus(readDevinMcpConfig(configPath), configPath, expected);
}

function expectPlan(plan: DevinPlannedWrite | DevinConfigError): DevinPlannedWrite {
  if ("ok" in plan) assert.fail(`Expected a write plan, got: ${plan.message}`);
  return plan;
}

function expectBlocked(plan: DevinPlannedWrite | DevinConfigError): void {
  assert.equal("ok" in plan && plan.ok === false, true);
}

function readJson(path: string): { readonly mcpServers: Record<string, Record<string, unknown>>; readonly [key: string]: unknown } {
  return JSON.parse(readFileSync(path, "utf8"));
}

try {
  // Devin Desktop and the Devin CLI share one user-scope file.
  assert.equal(getDevinGlobalMcpConfigPath({}, "/home/me", "linux"), join("/home/me", ".config", "devin", "mcp_config.json"));
  assert.equal(getDevinGlobalMcpConfigPath({}, "/Users/me", "darwin"), join("/Users/me", ".config", "devin", "mcp_config.json"));
  assert.equal(getDevinGlobalMcpConfigPath({ XDG_CONFIG_HOME: "/xdg" }, "/home/me", "linux"), join("/xdg", "devin", "mcp_config.json"));
  assert.equal(getDevinGlobalMcpConfigPath({ XDG_CONFIG_HOME: "relative" }, "/home/me", "linux"), join("/home/me", ".config", "devin", "mcp_config.json"));
  assert.equal(getDevinGlobalMcpConfigPath({ APPDATA: "/appdata" }, "/home/me", "win32"), join("/appdata", "devin", "mcp_config.json"));

  // Fresh install creates the file with a schema-valid stdio entry (no Cursor-style `type`).
  {
    const configPath = freshConfigPath();
    assert.equal(statusOf(configPath).status, "missing");
    executeDevinConfigWrite(expectPlan(planDevinMcpInstall(configPath, options)));
    assert.deepEqual(readJson(configPath).mcpServers.openpets, { command: "npx", args: ["-y", "@open-pets/mcp@4.0.0", "--pet", "fixer"] });
    assert.equal(statusOf(configPath).status, "installed");
    expectBlocked(planDevinMcpInstall(configPath, options));
  }

  // Install keeps comments, unrelated servers, and other settings, and backs up the original.
  {
    const configPath = freshConfigPath();
    const original = `{
  // team servers
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "x" } },
  },
}
`;
    writeFileSync(configPath, original);
    const plan = expectPlan(planDevinMcpInstall(configPath, options));
    executeDevinConfigWrite(plan);
    const written = readFileSync(configPath, "utf8");
    assert.match(written, /\/\/ team servers/);
    assert.match(written, /server-github/);
    assert.equal(statusOf(configPath).status, "installed");
    assert.ok(plan.backupPath);
    assert.equal(readFileSync(plan.backupPath, "utf8"), original);
  }

  // A different pet is an update that install applies in place.
  {
    const configPath = freshConfigPath();
    executeDevinConfigWrite(expectPlan(planDevinMcpInstall(configPath, options)));
    const otherPet = { ...options, petId: "sprout" };
    assert.equal(statusOf(configPath, otherPet).status, "needs-update");
    executeDevinConfigWrite(expectPlan(planDevinMcpInstall(configPath, otherPet)));
    assert.equal(statusOf(configPath, otherPet).status, "installed");
  }

  // Updating or re-enabling a managed entry keeps the user's own fields such as `env`.
  {
    const configPath = freshConfigPath();
    const env = { OPENPETS_TOKEN: "keep-me" };
    writeFileSync(configPath, JSON.stringify({ mcpServers: { openpets: { ...buildDevinMcpEntry(options), env, disabled: true } } }));
    executeDevinConfigWrite(expectPlan(planDevinMcpReplace(configPath, options)));
    assert.deepEqual(readJson(configPath).mcpServers.openpets?.env, env);

    const otherPet = { ...options, petId: "sprout" };
    executeDevinConfigWrite(expectPlan(planDevinMcpInstall(configPath, otherPet)));
    assert.deepEqual(readJson(configPath).mcpServers.openpets, { ...buildDevinMcpEntry(otherPet), env });
  }

  // A managed entry the user disabled is never silently re-enabled by install.
  {
    const configPath = freshConfigPath();
    writeFileSync(configPath, JSON.stringify({ mcpServers: { openpets: { ...buildDevinMcpEntry(options), disabled: true } } }));
    assert.equal(statusOf(configPath).status, "disabled");
    expectBlocked(planDevinMcpInstall(configPath, options));
    executeDevinConfigWrite(expectPlan(planDevinMcpReplace(configPath, options)));
    assert.equal(readJson(configPath).mcpServers.openpets?.disabled, undefined);
    assert.equal(statusOf(configPath).status, "installed");
  }

  // A user-owned "openpets" server needs an explicit replace and is never removed.
  {
    const configPath = freshConfigPath();
    writeFileSync(configPath, JSON.stringify({ mcpServers: { openpets: { url: "https://example.test/mcp" } } }));
    const status = statusOf(configPath);
    assert.equal(status.status, "conflict");
    expectBlocked(planDevinMcpInstall(configPath, options));
    expectBlocked(planDevinMcpRemove(configPath));
    executeDevinConfigWrite(expectPlan(planDevinMcpReplace(configPath, options)));
    assert.equal(statusOf(configPath).status, "installed");
  }

  // Local/bundled mode runs the MCP entry script through the configured Node.js command.
  {
    const configPath = freshConfigPath();
    const local: DevinMcpPreviewOptions = {
      mcpVersion: "4.0.0",
      commandMode: "bundled",
      mcpEntryPath: join(root, "app", "node_modules", "@open-pets", "mcp", "dist", "index.js"),
      nodeCommand: join(root, "bin", "node"),
    };
    executeDevinConfigWrite(expectPlan(planDevinMcpInstall(configPath, local)));
    assert.equal(statusOf(configPath, local).status, "installed");
    assert.equal(statusOf(configPath, options).status, "needs-update");
  }

  // Remove drops only the OpenPets server.
  {
    const configPath = freshConfigPath();
    writeFileSync(configPath, JSON.stringify({ theme: "dark", mcpServers: { openpets: buildDevinMcpEntry(options), other: { command: "other", args: [] } } }));
    executeDevinConfigWrite(expectPlan(planDevinMcpRemove(configPath)));
    const config = readJson(configPath);
    assert.equal(config.theme, "dark");
    assert.deepEqual(Object.keys(config.mcpServers), ["other"]);
    assert.equal(statusOf(configPath).status, "missing");
  }

  // Unreadable or unsafe configs are reported and never written.
  {
    const configPath = freshConfigPath();
    writeFileSync(configPath, "{ \"mcpServers\": ");
    assert.equal(statusOf(configPath).status, "invalid");
    expectBlocked(planDevinMcpInstall(configPath, options));
    assert.equal(readFileSync(configPath, "utf8"), "{ \"mcpServers\": ");

    const arrayServers = freshConfigPath();
    writeFileSync(arrayServers, JSON.stringify({ mcpServers: [] }));
    assert.equal(statusOf(arrayServers).status, "invalid");

    const target = freshConfigPath();
    writeFileSync(target, "{}");
    const linked = join(root, "linked-mcp_config.json");
    symlinkSync(target, linked);
    assert.equal(statusOf(linked).status, "invalid");
    expectBlocked(planDevinMcpInstall(linked, options));
  }

  // A config edited after planning (e.g. by `devin mcp add`) is not clobbered.
  {
    const configPath = freshConfigPath();
    writeFileSync(configPath, "{}");
    const plan = expectPlan(planDevinMcpInstall(configPath, options));
    writeFileSync(configPath, JSON.stringify({ mcpServers: { added: { command: "added", args: [] } } }));
    assert.throws(() => executeDevinConfigWrite(plan), /changed/);
    assert.deepEqual(Object.keys(readJson(configPath).mcpServers), ["added"]);
  }

  // Hook payloads map to reactions from event/tool names only.
  assert.equal(mapDevinHookPayload({ hook_event_name: "UserPromptSubmit", prompt: "secret" })?.reaction, "thinking");
  assert.equal(mapDevinHookPayload({ hook_event_name: "PreToolUse", tool_name: "edit" })?.reaction, "editing");
  assert.equal(mapDevinHookPayload({ hook_event_name: "PreToolUse", tool_name: "exec", tool_input: { command: "pnpm test" } })?.reaction, "testing");
  assert.equal(mapDevinHookPayload({ hook_event_name: "PreToolUse", tool_name: "exec", tool_input: { command: "ls" } })?.reaction, undefined);
  assert.deepEqual(mapDevinHookPayload({ hook_event_name: "PermissionRequest", tool_name: "exec" }), { eventName: "PermissionRequest", reaction: "waiting", speechCategory: "permission" });
  assert.equal(mapDevinHookPayload({ hook_event_name: "Stop" })?.reaction, "success");
  assert.equal(mapDevinHookPayload({ agent_action_name: "pre_user_prompt", tool_info: { user_prompt: "secret" } })?.reaction, "thinking");
  assert.equal(mapDevinHookPayload({ agent_action_name: "post_write_code", tool_info: { file_path: "/x" } })?.reaction, "editing");
  assert.equal(mapDevinHookPayload({ agent_action_name: "pre_run_command", tool_info: { command_line: "cargo test" } })?.reaction, "testing");
  assert.equal(mapDevinHookPayload({ agent_action_name: "post_cascade_response" })?.reaction, "success");
  assert.equal(mapDevinHookPayload({ unrelated: true }), null);

  // Hook files: Devin CLI config.json and Devin Desktop hooks.json.
  assert.equal(getDevinCliConfigPath({ XDG_CONFIG_HOME: "/xdg" }, "/home/me", "linux"), join("/xdg", "devin", "config.json"));
  assert.equal(getDevinDesktopHooksPath("/home/me"), join("/home/me", ".codeium", "windsurf", "hooks.json"));
  const hookOptions: DevinHookCommandOptions = { cliVersion: "4.0.0", petId: "fixer" };
  assert.equal(buildDevinHookCommand(hookOptions), "npx -y @open-pets/cli@4.0.0 hook --openpets-managed --agent devin --pet fixer");

  // Devin CLI hooks keep comments, user hooks, and other settings; reinstall replaces only ours.
  {
    const configPath = join(freshConfigPath(), "..", "config.json");
    writeFileSync(configPath, `{
  // my settings
  "agent": { "model": "swe-1-6-fast" },
  "hooks": {
    "PreToolUse": [{ "matcher": "exec", "hooks": [{ "type": "command", "command": "./check.sh" }] }],
  },
}
`);
    assert.equal(classifyDevinHooks("cli", configPath, hookOptions).status, "missing");
    executeDevinConfigWrite(expectPlan(planDevinHooksInstall("cli", configPath, hookOptions)));
    assert.equal(classifyDevinHooks("cli", configPath, hookOptions).status, "installed");
    const installedText = readFileSync(configPath, "utf8");
    assert.match(installedText, /\/\/ my settings/);
    assert.match(installedText, /check\.sh/);
    expectBlocked(planDevinHooksInstall("cli", configPath, hookOptions));

    const otherPet = { ...hookOptions, petId: "sprout" };
    assert.equal(classifyDevinHooks("cli", configPath, otherPet).status, "needs-update");
    executeDevinConfigWrite(expectPlan(planDevinHooksInstall("cli", configPath, otherPet)));
    assert.equal(classifyDevinHooks("cli", configPath, otherPet).status, "installed");
    assert.equal((readFileSync(configPath, "utf8").match(/--openpets-managed/g) ?? []).length, 4);

    executeDevinConfigWrite(expectPlan(planDevinHooksRemove("cli", configPath)));
    const removedText = readFileSync(configPath, "utf8");
    assert.doesNotMatch(removedText, /openpets-managed/);
    assert.match(removedText, /check\.sh/);
    assert.match(removedText, /swe-1-6-fast/);
    expectBlocked(planDevinHooksRemove("cli", configPath));
  }

  // Duplicate hooks on one event do not hide a missing event.
  {
    const configPath = join(freshConfigPath(), "..", "config.json");
    executeDevinConfigWrite(expectPlan(planDevinHooksInstall("cli", configPath, hookOptions)));
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { hooks: Record<string, unknown[]> };
    const promptHook = config.hooks.UserPromptSubmit?.[0];
    delete config.hooks.Stop;
    config.hooks.UserPromptSubmit = [promptHook, promptHook];
    writeFileSync(configPath, JSON.stringify(config));
    assert.equal(classifyDevinHooks("cli", configPath, hookOptions).status, "needs-update");
  }

  // Devin Desktop hooks are flat command entries; removing the last one drops the hooks key.
  {
    const hooksPath = join(freshConfigPath(), "..", "hooks.json");
    executeDevinConfigWrite(expectPlan(planDevinHooksInstall("desktop", hooksPath, hookOptions, "linux")));
    const hooks = JSON.parse(readFileSync(hooksPath, "utf8")) as { readonly hooks: Record<string, readonly Record<string, unknown>[]> };
    assert.deepEqual(Object.keys(hooks.hooks), ["pre_user_prompt", "post_write_code", "pre_run_command", "post_cascade_response"]);
    assert.deepEqual(hooks.hooks.pre_user_prompt, [{ command: buildDevinHookCommand(hookOptions), show_output: false }]);
    assert.equal(classifyDevinHooks("desktop", hooksPath, hookOptions, "linux").status, "installed");
    executeDevinConfigWrite(expectPlan(planDevinHooksRemove("desktop", hooksPath)));
    assert.deepEqual(JSON.parse(readFileSync(hooksPath, "utf8")), {});

    const brokenPath = join(freshConfigPath(), "..", "hooks.json");
    writeFileSync(brokenPath, JSON.stringify({ hooks: { pre_user_prompt: {} } }));
    assert.equal(classifyDevinHooks("desktop", brokenPath, hookOptions).status, "invalid");
    expectBlocked(planDevinHooksInstall("desktop", brokenPath, hookOptions));
  }

  console.error("Devin validation passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
