import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDevinMcpEntry,
  classifyDevinMcpStatus,
  executeDevinMcpWrite,
  getDevinGlobalMcpConfigPath,
  planDevinMcpInstall,
  planDevinMcpRemove,
  planDevinMcpReplace,
  readDevinMcpConfig,
  type DevinConfigError,
  type DevinMcpPreviewOptions,
  type DevinPlannedWrite,
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
    executeDevinMcpWrite(expectPlan(planDevinMcpInstall(configPath, options)));
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
    executeDevinMcpWrite(plan);
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
    executeDevinMcpWrite(expectPlan(planDevinMcpInstall(configPath, options)));
    const otherPet = { ...options, petId: "sprout" };
    assert.equal(statusOf(configPath, otherPet).status, "needs-update");
    executeDevinMcpWrite(expectPlan(planDevinMcpInstall(configPath, otherPet)));
    assert.equal(statusOf(configPath, otherPet).status, "installed");
  }

  // A managed entry the user disabled is never silently re-enabled by install.
  {
    const configPath = freshConfigPath();
    writeFileSync(configPath, JSON.stringify({ mcpServers: { openpets: { ...buildDevinMcpEntry(options), disabled: true } } }));
    assert.equal(statusOf(configPath).status, "disabled");
    expectBlocked(planDevinMcpInstall(configPath, options));
    executeDevinMcpWrite(expectPlan(planDevinMcpReplace(configPath, options)));
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
    executeDevinMcpWrite(expectPlan(planDevinMcpReplace(configPath, options)));
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
    executeDevinMcpWrite(expectPlan(planDevinMcpInstall(configPath, local)));
    assert.equal(statusOf(configPath, local).status, "installed");
    assert.equal(statusOf(configPath, options).status, "needs-update");
  }

  // Remove drops only the OpenPets server.
  {
    const configPath = freshConfigPath();
    writeFileSync(configPath, JSON.stringify({ theme: "dark", mcpServers: { openpets: buildDevinMcpEntry(options), other: { command: "other", args: [] } } }));
    executeDevinMcpWrite(expectPlan(planDevinMcpRemove(configPath)));
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
    assert.throws(() => executeDevinMcpWrite(plan), /changed/);
    assert.deepEqual(Object.keys(readJson(configPath).mcpServers), ["added"]);
  }

  console.error("Devin validation passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
