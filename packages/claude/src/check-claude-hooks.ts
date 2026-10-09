import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { addOpenPetsHooks, assertInstalledClaudeCliPath, claudeHookEvents, createOpenPetsHookCommand, createOpenPetsHookSettingsPreview, doctorClaudeHooks, findInstalledOpenPetsClaudeCli, getBundledClaudeCliPath, getLocalClaudeCliPath, installClaudeHooks, openPetsHookMarker, removeOpenPetsHooks, uninstallClaudeHooks } from "./hook-settings.js";
import { hookSpeechPools } from "./hook-messages.js";
import { handleClaudeHookPayload, hasProjectLocalOpenPetsHook, mapClaudeHookEvent, validateHookSpeech } from "./hooks.js";

assert.equal(mapClaudeHookEvent({ hook_event_name: "UserPromptSubmit" })?.reaction, "thinking");
assert.equal(mapClaudeHookEvent({ hook_event_name: "UserPromptSubmit" })?.speechCategory, undefined);
assert.equal(mapClaudeHookEvent({ hook_event_name: "PreToolUse", tool_name: "Write" })?.reaction, "editing");
assert.equal(mapClaudeHookEvent({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "pnpm test" } })?.reaction, "testing");
assert.equal(mapClaudeHookEvent({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } })?.reaction, undefined);
assert.equal(mapClaudeHookEvent({ hook_event_name: "PreToolUse", tool_name: "Read" })?.reaction, undefined);
assert.equal(mapClaudeHookEvent({ hook_event_name: "PermissionRequest" })?.speechCategory, "permission");
assert.equal(mapClaudeHookEvent({ hook_event_name: "PermissionRequest", tool_name: "Bash" })?.speechCategory, "permission");
assert.equal(mapClaudeHookEvent({ hook_event_name: "PermissionRequest", tool_name: "AskUserQuestion" })?.speechCategory, "question");
assert.equal(mapClaudeHookEvent({ hook_event_name: "PermissionRequest", tool_name: "AskUserQuestion" })?.reaction, "waiting");
assert.equal(mapClaudeHookEvent({ hook_event_name: "Notification" })?.reaction, undefined);
assert.equal(mapClaudeHookEvent({ hook_event_name: "Stop" })?.reaction, "success");
assert.equal(mapClaudeHookEvent({ hook_event_name: "Stop" })?.speechCategory, undefined);
assert.equal(mapClaudeHookEvent({ hook_event_name: "StopFailure" })?.reaction, "error");
assert.equal(mapClaudeHookEvent({ hook_event_name: "Unknown" })?.reaction, undefined);

validateHookSpeech("Thinking it through");
for (const [category, messages] of Object.entries(hookSpeechPools) as Array<[string, readonly string[]]>) {
  for (const message of messages) {
    assert.match(message, /^[A-Z]/, `${category} hook speech must start with an uppercase letter: ${message}`);
    validateHookSpeech(message);
  }
}
for (const unsafe of ["", "a".repeat(141), "line\nbreak", "const x = 1", "https://example.com", "/Users/alvin/project", "api_key=secret"]) {
  assert.throws(() => validateHookSpeech(unsafe));
}

const calls: Array<{ readonly kind: string; readonly value: string; readonly leaseId?: string; readonly requestedPetId?: string }> = [];
const client = {
  hello: async () => ({}),
  status: async () => ({ ok: true, appRunning: true }),
  listPets: async () => ({ ok: true as const, pets: [], defaultPetId: "builtin" }),
  installPet: async () => { throw new Error("unused"); },
  installLocalPet: async () => { throw new Error("unused"); },
  acquireLease: async (options?: { readonly requestedPetId?: string }) => {
    calls.push({ kind: "lease", value: "acquire", requestedPetId: options?.requestedPetId });
    return { leaseId: "lease-fixer", requestedPetId: options?.requestedPetId, targetKind: "explicit" as const, actualTargetPetId: options?.requestedPetId ?? "builtin", actualTargetPetName: "Fixer", usingDefaultPet: false, expiresAt: Date.now() + 15_000, leaseActive: true };
  },
  heartbeatLease: async () => { throw new Error("unused"); },
  releaseLease: async () => { throw new Error("unused"); },
  react: async (reaction: string, options?: { readonly leaseId?: string }) => { calls.push({ kind: "react", value: reaction, leaseId: options?.leaseId }); },
  say: async (message: string, options?: { readonly leaseId?: string }) => { calls.push({ kind: "say", value: message, leaseId: options?.leaseId }); },
  showMedia: async () => ({ ok: true, shown: true }),
};
const dir = mkdtempSync(join(tmpdir(), "openpets-hooks-"));
try {
await handleClaudeHookPayload(JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "never shown" }), { client, configuredPetId: "fixer", throttlePath: join(dir, "throttle.json"), now: () => 100_000, random: () => 0 });
assert.deepEqual(calls[0], { kind: "lease", value: "acquire", requestedPetId: "fixer" });
assert.deepEqual(calls[1], { kind: "react", value: "thinking", leaseId: "lease-fixer" });
await handleClaudeHookPayload(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test -- --secret" } }), { client, throttlePath: join(dir, "throttle.json"), now: () => 101_000 });
assert.deepEqual(calls[2], { kind: "react", value: "testing", leaseId: undefined });
const beforeSilentBash = calls.length;
await handleClaudeHookPayload(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }), { client, throttlePath: join(dir, "throttle.json"), now: () => 102_000 });
assert.equal(calls.length, beforeSilentBash);
await handleClaudeHookPayload(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } }), { client, throttlePath: join(dir, "throttle.json"), now: () => 102_000 });
assert.equal(calls.length, beforeSilentBash, "duplicate testing reaction should be throttled");
await handleClaudeHookPayload("not json", { client, throttlePath: join(dir, "throttle.json") });
await handleClaudeHookPayload(JSON.stringify({ hook_event_name: "PermissionRequest", tool_name: "AskUserQuestion" }), { client, throttlePath: join(dir, "throttle.json"), now: () => 104_000, random: () => 0 });
assert.deepEqual(calls.at(-1), { kind: "say", value: "Question for you", leaseId: undefined });

const projectDir = join(dir, "project-with-local-hook");
mkdirSync(join(projectDir, ".claude"), { recursive: true });
writeFileSync(join(projectDir, ".claude", "settings.local.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "openpets hook --openpets-managed --project-local --pet fixer" }] }] } }), "utf8");
assert.equal(hasProjectLocalOpenPetsHook(projectDir), true);
const beforeSkippedGlobal = calls.length;
const previousProjectDir = process.env.CLAUDE_PROJECT_DIR;
process.env.CLAUDE_PROJECT_DIR = projectDir;
try {
  await handleClaudeHookPayload(JSON.stringify({ hook_event_name: "PermissionRequest" }), { client, throttlePath: join(dir, "project-skip-throttle.json"), now: () => 102_000, debug: true, random: () => 0 });
  assert.equal(calls.length, beforeSkippedGlobal);
  await handleClaudeHookPayload(JSON.stringify({ hook_event_name: "PermissionRequest" }), { client, projectLocal: true, configuredPetId: "fixer", throttlePath: join(dir, "throttle.json"), now: () => 103_000, random: () => 0 });
  assert.deepEqual(calls.at(-2), { kind: "lease", value: "acquire", requestedPetId: "fixer" });
  assert.deepEqual(calls.at(-1), { kind: "say", value: "Approval needed", leaseId: "lease-fixer" });
} finally {
  if (previousProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
  else process.env.CLAUDE_PROJECT_DIR = previousProjectDir;
}

const preview = createOpenPetsHookSettingsPreview();
const hooks = (preview.hooks ?? {}) as Record<string, unknown>;
for (const event of claudeHookEvents) {
  const entries = hooks[event] as Array<{ hooks: Array<{ command: string; timeout: number; async: boolean; asyncRewake: boolean }> }>;
  const hook = entries[0]?.hooks[0];
  assert.ok(hook?.command.includes(openPetsHookMarker));
  assert.equal(hook.timeout, 3);
  assert.equal(hook.async, true);
  assert.equal(hook.asyncRewake, false);
}
const localPreview = createOpenPetsHookSettingsPreview("local");
const localHook = (((localPreview.hooks as Record<string, unknown>).Stop as Array<{ hooks: Array<{ command: string }> }>)[0]?.hooks[0]);
assert.ok(localHook?.command.includes(getLocalClaudeCliPath()));
assert.ok(localHook?.command.includes(openPetsHookMarker));
const bundledPreview = createOpenPetsHookSettingsPreview("bundled");
const bundledHook = (((bundledPreview.hooks as Record<string, unknown>).Stop as Array<{ hooks: Array<{ command: string }> }>)[0]?.hooks[0]);
assert.ok(bundledHook?.command.includes(getBundledClaudeCliPath()));
assert.ok(bundledHook?.command.includes(openPetsHookMarker));
const customNodeHookCommand = createOpenPetsHookCommand("bundled", "fixer", "/Users/test/Library/Application Support/Herd/config/nvm/versions/node/v22.22.2/bin/node");
assert.ok(customNodeHookCommand.startsWith('"/Users/test/Library/Application Support/Herd/config/nvm/versions/node/v22.22.2/bin/node"'));
assert.ok(customNodeHookCommand.includes("--pet fixer"));
assert.ok(createOpenPetsHookCommand("published", "fixer").endsWith("--openpets-managed --pet fixer"));
const petPreview = createOpenPetsHookSettingsPreview("published", "fixer");
const petHook = (((petPreview.hooks as Record<string, unknown>).UserPromptSubmit as Array<{ hooks: Array<{ command: string }> }>)[0]?.hooks[0]);
assert.ok(petHook?.command.includes("--pet fixer"));

const settings = { theme: "dark", hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo safe" }] }] } };
const installed = addOpenPetsHooks(settings);
assert.equal(doctorStatus(installed), "installed");
const installedForFixer = addOpenPetsHooks(settings, "published", "fixer");
assert.equal(doctorStatus(installedForFixer, "fixer"), "installed");
assert.equal(doctorStatus(installedForFixer), "needs_update");
assert.ok(doctorClaudeHooks(doctorStatusPath(installedForFixer), "published", "fixer").message.includes("Hook events target fixer."));
const reinstalled = addOpenPetsHooks(removeOpenPetsHooks(installed));
assert.deepEqual(reinstalled, installed);
const uninstalled = removeOpenPetsHooks(installed);
assert.deepEqual(uninstalled, settings);
assert.throws(() => addOpenPetsHooks({ hooks: { UserPromptSubmit: { bad: true } } }));

const stale = addOpenPetsHooks({});
((stale.hooks as Record<string, unknown>).Stop as unknown[]).push({ hooks: [{ type: "command", command: "npx -y @open-pets/claude hook --openpets-managed --old" }] });
const stalePath = join(dir, "stale-settings.json");
writeFileSync(stalePath, JSON.stringify(stale), "utf8");
assert.equal(doctorClaudeHooks(stalePath).status, "needs_update");
assert.equal(installClaudeHooks(stalePath).status, "installed");

const settingsPath = join(dir, "settings.json");
writeFileSync(settingsPath, JSON.stringify(settings), "utf8");
assert.equal(doctorClaudeHooks(settingsPath).status, "not_installed");
assert.equal(installClaudeHooks(settingsPath).status, "installed");
assert.equal(installClaudeHooks(settingsPath).changed, false);
assert.equal(uninstallClaudeHooks(settingsPath).status, "not_installed");
assert.equal(uninstallClaudeHooks(settingsPath).changed, false);

writeFileSync(settingsPath, JSON.stringify({ hooks: [] }), "utf8");
assert.equal(doctorClaudeHooks(settingsPath).status, "error");
writeFileSync(settingsPath, JSON.stringify({ hooks: { Stop: { bad: true } } }), "utf8");
assert.equal(doctorClaudeHooks(settingsPath).status, "error");
const symlinkPath = join(dir, "settings-link.json");
symlinkSync(settingsPath, symlinkPath);
assert.equal(doctorClaudeHooks(symlinkPath).status, "error");

process.env.OPENPETS_DISABLE_CLAUDE_ASYNC_HOOKS = "1";
assert.throws(() => installClaudeHooks(join(dir, "async-disabled.json")));
delete process.env.OPENPETS_DISABLE_CLAUDE_ASYNC_HOOKS;

const isolatedEnv = { ...process.env, OPENPETS_DISCOVERY_FILE: join(dir, "missing-ipc.json") };
const normalHook = spawnSync(process.execPath, [new URL("./cli.js", import.meta.url).pathname, "hook", "--openpets-managed"], { input: JSON.stringify({ hook_event_name: "Notification", message: "safe" }), encoding: "utf8", env: isolatedEnv });
assert.equal(normalHook.status, 0);
assert.equal(normalHook.stdout, "");

const petHookRun = spawnSync(process.execPath, [new URL("./cli.js", import.meta.url).pathname, "hook", "--openpets-managed", "--pet", "fixer"], { input: JSON.stringify({ hook_event_name: "Notification", message: "safe" }), encoding: "utf8", env: isolatedEnv });
assert.equal(petHookRun.status, 0);
assert.equal(petHookRun.stdout, "");

const invalidPetHook = spawnSync(process.execPath, [new URL("./cli.js", import.meta.url).pathname, "hook", "--openpets-managed", "--pet", "bad/pet"], { input: JSON.stringify({ hook_event_name: "Notification", message: "safe" }), encoding: "utf8", env: isolatedEnv });
assert.equal(invalidPetHook.status, 1);
const missingPetHook = spawnSync(process.execPath, [new URL("./cli.js", import.meta.url).pathname, "hook", "--openpets-managed", "--pet"], { input: JSON.stringify({ hook_event_name: "Notification", message: "safe" }), encoding: "utf8", env: isolatedEnv });
assert.equal(missingPetHook.status, 1);

const malformedHook = spawnSync(process.execPath, [new URL("./cli.js", import.meta.url).pathname, "hook", "--openpets-managed"], { input: "not json", encoding: "utf8", env: isolatedEnv });
assert.equal(malformedHook.status, 0);
assert.equal(malformedHook.stdout, "");

// Explicit installed-CLI path: hooks run as `node <abs-path> hook ...`, and the
// resolved command must round-trip cleanly through install -> doctor (status
// stays "installed", not "needs_update").
const fakeAppCliDir = join(dir, "OpenPets.app", "Contents", "Resources", "app.asar.unpacked", "node_modules", "@open-pets", "claude", "dist");
mkdirSync(fakeAppCliDir, { recursive: true });
const fakeAppCliPath = join(fakeAppCliDir, "cli.js");
writeFileSync(fakeAppCliPath, "// bundled cli", "utf8");
assertInstalledClaudeCliPath(fakeAppCliPath);
const installedCliCommand = createOpenPetsHookCommand("published", undefined, "node", fakeAppCliPath);
assert.ok(installedCliCommand.startsWith(`node ${fakeAppCliPath} hook ${openPetsHookMarker}`), "explicit installed CLI path must produce a node + absolute-path hook command");
assert.ok(!installedCliCommand.includes("npx"), "explicit installed CLI path must not fall back to npx");
const installedCliPreview = createOpenPetsHookSettingsPreview("published", undefined, "node", fakeAppCliPath);
const installedCliHook = (((installedCliPreview.hooks as Record<string, unknown>).Stop as Array<{ hooks: Array<{ command: string }> }>)[0]?.hooks[0]);
assert.equal(installedCliHook?.command, installedCliCommand);
const explicitSettingsPath = join(dir, "explicit-cli-settings.json");
writeFileSync(explicitSettingsPath, JSON.stringify(settings), "utf8");
assert.equal(installClaudeHooks(explicitSettingsPath, "published", undefined, "node", fakeAppCliPath).status, "installed");
assert.equal(doctorClaudeHooks(explicitSettingsPath, "published", undefined, "node", fakeAppCliPath).status, "installed");
// A published-mode doctor sees the explicit-path hooks as stale (npx command differs).
assert.equal(doctorClaudeHooks(explicitSettingsPath).status, "needs_update");

// findInstalledOpenPetsClaudeCli returns the first valid candidate and skips
// missing / malformed ones; returns null when nothing valid is present.
assert.equal(findInstalledOpenPetsClaudeCli([join(dir, "nope", "cli.js"), fakeAppCliPath]), fakeAppCliPath);
assert.equal(findInstalledOpenPetsClaudeCli([join(dir, "absent", "@open-pets", "claude", "dist", "cli.js")]), null);

// Path validation rejects unsafe / wrong-shaped CLI paths.
assert.throws(() => assertInstalledClaudeCliPath("relative/cli.js"));
assert.throws(() => assertInstalledClaudeCliPath(join(dir, "OpenPets.app", "Contents", "Resources", "app.asar", "node_modules", "@open-pets", "claude", "dist", "cli.js")));
assert.throws(() => assertInstalledClaudeCliPath(join(fakeAppCliDir, "index.js")));
const symlinkedCliPath = join(dir, "linked-cli.js-target", "@open-pets", "claude", "dist", "cli.js");
mkdirSync(join(dir, "linked-cli.js-target", "@open-pets", "claude", "dist"), { recursive: true });
symlinkSync(fakeAppCliPath, symlinkedCliPath);
assert.throws(() => assertInstalledClaudeCliPath(symlinkedCliPath));

} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.error("Claude hooks validation passed.");

function doctorStatus(value: Record<string, unknown>, selectedPetId?: string) {
  const path = doctorStatusPath(value);
  return doctorClaudeHooks(path, "published", selectedPetId).status;
}

function doctorStatusPath(value: Record<string, unknown>) {
  const path = join(dir, `settings-${Math.random()}.json`);
  writeFileSync(path, JSON.stringify(value), "utf8");
  return path;
}
