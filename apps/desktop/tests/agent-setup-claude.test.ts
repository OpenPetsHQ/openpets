import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getClaudeSetup, runClaudeAction, type ClaudeCommandResult, type ClaudeSetupDependencies, type ClaudeSetupJournalEntry } from "../src/agent-setup-claude.js";

// This protects the Claude Code MCP status, configure action, custom-entry guard, and memory lifecycle.
const homeDir = mkdtempSync(join(realpathSync(tmpdir()), "openpets-agent-setup-claude-"));
let state: "missing" | "configured" | "custom" = "missing";
const journal: ClaudeSetupJournalEntry[] = [];

function commandResult(overrides: Partial<ClaudeCommandResult> = {}): ClaudeCommandResult {
  return { ok: true, timedOut: false, stdout: "", stderr: "", ...overrides };
}

const runClaudeCommand = async (spec: { readonly command: string; readonly args: readonly string[] }): Promise<ClaudeCommandResult> => {
  if (spec.args[0] === "--version") return commandResult({ stdout: "Claude Code 1.0.0" });
  if (spec.args[0] === "mcp" && spec.args[1] === "list") {
    if (state === "missing") return commandResult({ stdout: "No MCP servers configured" });
    return commandResult({ stdout: "openpets: configured" });
  }
  if (spec.args[0] === "mcp" && spec.args[1] === "get") {
    if (state === "custom") return commandResult({ stdout: JSON.stringify({ command: "node", args: ["custom.js"] }) });
    return commandResult({ stdout: JSON.stringify({ command: "npx", args: ["-y", "@open-pets/mcp"] }) });
  }
  if (spec.args[0] === "mcp" && spec.args[1] === "add") {
    state = "configured";
    return commandResult();
  }
  if (spec.args[0] === "mcp" && spec.args[1] === "remove") {
    state = "missing";
    return commandResult();
  }
  throw new Error(`Unexpected Claude command: ${spec.args.join(" ")}`);
};

function createDependencies(commandMode: "published" | "bundled" = "published"): ClaudeSetupDependencies {
  return {
    commandMode,
    homeDir,
    preferredClaudeCommand: "claude",
    preferredNodeCommand: "node",
    formatUserPath: (path) => path,
    sanitizeOutput: (value) => value,
    summarizeCommandResult: () => "command failed",
    runClaudeCommand,
    runNodePreflight: async () => commandResult(),
    finishAction: (entry) => journal.push(entry),
  };
}

try {
  const initial = await getClaudeSetup(createDependencies());
  assert.equal(initial.status.state, "needs_setup");
  assert.equal(initial.status.canConfigure, true);
  assert.equal(initial.preview.add.command, "claude");
  assert.equal(initial.memoryStatus.status, "not_installed");

  const configured = await runClaudeAction("configure", createDependencies());
  assert.equal(configured.action, "configure");
  assert.equal(configured.ok, true);
  assert.equal(configured.changed, true);
  assert.equal(journal[0]?.action, "configure");
  assert.deepEqual(journal[0]?.command.slice(0, 5), ["claude", "mcp", "add", "--scope", "user"]);

  const configuredStatus = await getClaudeSetup(createDependencies());
  assert.equal(configuredStatus.status.state, "configured");
  assert.equal(configuredStatus.status.openPetsEntry.matchesExpected, true);
  assert.equal(configuredStatus.memoryStatus.status, "installed");

  state = "custom";
  const customStatus = await getClaudeSetup(createDependencies());
  assert.equal(customStatus.status.label, "Installed — custom");
  assert.equal(customStatus.status.canReplace, true);
  const customConfigure = await runClaudeAction("configure", createDependencies());
  assert.equal(customConfigure.ok, false);
  assert.equal(customConfigure.changed, false);

  const bundledFailure = await runClaudeAction("configure", {
    ...createDependencies("bundled"),
    runNodePreflight: async () => commandResult({ ok: false, stderr: "node unavailable" }),
  });
  assert.equal(bundledFailure.ok, false);
  assert.match(bundledFailure.message, /Node\.js is required for packaged OpenPets commands/);

  const bundledStatus = await getClaudeSetup({
    ...createDependencies("bundled"),
    runNodePreflight: async () => commandResult({ ok: false, stderr: "node unavailable" }),
  });
  assert.equal(bundledStatus.status.state, "error");
  assert.match(bundledStatus.status.details, /Node\.js is required for packaged OpenPets commands/);
} finally {
  rmSync(homeDir, { recursive: true, force: true });
}
