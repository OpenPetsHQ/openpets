import assert from "node:assert/strict";

import { getOpenClawSetup, mutateOpenClaw, type OpenClawCommandResult, type OpenClawSetupDependencies } from "../src/agent-setup-openclaw.js";

// This protects the OpenClaw global management status and postcondition-checked install lifecycle.
type Phase = "not-installed" | "installed-disabled" | "installed-enabled";

let phase: Phase = "not-installed";
const calls: Array<{ readonly action: string; readonly targetVersion?: string; readonly timeoutMs?: number }> = [];

function pluginList(): string {
  if (phase === "not-installed") return JSON.stringify({ plugins: [] });
  return JSON.stringify({ plugins: [{ id: "openpets", enabled: phase === "installed-enabled", dependencyStatus: { requiredInstalled: true } }] });
}

function pluginInspect(): string {
  const enabled = phase === "installed-enabled";
  return JSON.stringify({
    plugin: {
      id: "openpets",
      enabled,
      status: enabled ? "loaded" : "disabled",
      version: "3.5.0",
      dependencyStatus: { requiredInstalled: true },
    },
    install: { source: "npm", spec: "@open-pets/openclaw@3.5.0" },
  });
}

const dependencies: OpenClawSetupDependencies = {
  preferredCommand: "openclaw",
  targetVersion: "3.5.0",
  platform: "linux",
  managementDisabled: false,
  statusTimeoutMs: 6_000,
  mutationTimeoutMs: 60_000,
  runCommand: async (action, targetVersion, timeoutMs): Promise<OpenClawCommandResult> => {
    calls.push({ action, targetVersion, timeoutMs });
    if (action === "version") return { ok: true, timedOut: false, stdout: "OpenClaw 2026.7.1", stderr: "" };
    if (action === "list") return { ok: true, timedOut: false, stdout: pluginList(), stderr: "" };
    if (action === "inspect" && phase === "not-installed") return { ok: false, timedOut: false, stdout: "", stderr: "plugin not found" };
    if (action === "inspect") return { ok: true, timedOut: false, stdout: pluginInspect(), stderr: "" };
    if (action === "install") {
      phase = "installed-disabled";
      return { ok: false, timedOut: true, stdout: "", stderr: "command timed out" };
    }
    if (action === "enable") {
      phase = "installed-enabled";
      return { ok: true, timedOut: false, stdout: "", stderr: "" };
    }
    throw new Error(`Unexpected action: ${action}`);
  },
};

const initial = await getOpenClawSetup(dependencies);
assert.equal(initial.status.state, "not-installed");
assert.equal(initial.preview.command, "openclaw");
assert.deepEqual(initial.preview.install, ["plugins", "install", "npm:@open-pets/openclaw@3.5.0"]);

const installed = await mutateOpenClaw("configure", dependencies);
assert.equal(installed.action, "openclaw-install");
assert.equal(installed.ok, true);
assert.equal(installed.changed, true);
assert.deepEqual(calls.filter(({ action }) => action === "install").map(({ timeoutMs }) => timeoutMs), [60_000]);

const configured = await getOpenClawSetup(dependencies);
assert.equal(configured.status.state, "installed-enabled");
assert.equal(configured.status.installedVersion, "3.5.0");

const nix = await getOpenClawSetup({
  ...dependencies,
  managementDisabled: true,
  runCommand: async () => {
    throw new Error("Nix mode must not probe OpenClaw");
  },
});
assert.equal(nix.status.state, "management-disabled");
