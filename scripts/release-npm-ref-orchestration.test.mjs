import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceScripts = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = mkdtempSync(join(tmpdir(), "openpets-release-ref-fixture-"));
const fixtureScripts = join(fixtureRoot, "scripts");
const fixturePackage = join(fixtureRoot, "packages", "fixture");
const fakeBin = join(fixtureRoot, "fake-bin");
const logPath = join(fixtureRoot, "commands.log");

try {
  mkdirSync(fixtureScripts, { recursive: true });
  mkdirSync(fixturePackage, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  const statePath = join(fixtureRoot, "state.json");
  writeFileSync(statePath, JSON.stringify({
    currentCheckoutValidated: false,
    trustedRefSelected: false,
    trustedTagFetched: false,
    trustedTagInspected: false,
    trustedTagDirectRead: false,
    trustedTagCommitRead: false,
    worktreeCreated: false,
    installed: false,
    historicalSourceGatePassed: false,
    publication: null,
    releaseSucceeded: false,
    cleanupCompleted: false,
  }));
  writeFileSync(join(fixtureRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify({ name: "fixture-root", private: true }));
  writeFileSync(join(fixturePackage, "package.json"), JSON.stringify({
    name: "@fixture/package",
    version: "3.5.0",
    publishConfig: { access: "public" },
  }));

  for (const filename of [
    "release-npm.mjs",
    "npm-exact-version-probe.mjs",
    "npm-release-policy.mjs",
    "npm-release-recovery.mjs",
    "npm-workspace-release.mjs",
  ]) {
    copyFileSync(join(sourceScripts, filename), join(fixtureScripts, filename));
  }
  createFakeCommand("git", fakeGitSource());
  createFakeCommand("pnpm", fakePnpmSource());
  createFakeCommand("npm", fakeNpmSource());

  const result = spawnSync(process.execPath, [join(fixtureScripts, "release-npm.mjs"), "--ref", "v3.5.0", "--dry-run", "--skip-checks"], {
    cwd: fixtureRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      OPENPETS_RELEASE_FIXTURE_ROOT: fixtureRoot,
      OPENPETS_RELEASE_STATE: statePath,
    },
  });
  if (result.status !== 0) {
    throw new Error(`release-npm --ref fixture failed:\n${result.stderr || result.stdout}\nFixture state:\n${readFileSync(statePath, "utf8")}`);
  }

  const state = JSON.parse(readFileSync(statePath, "utf8"));
  assertSuccessfulRelease(state);
  console.log("release-npm historical orchestration invariants passed.");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

function createFakeCommand(name, source) {
  const path = join(fakeBin, name);
  writeFileSync(path, `#!/usr/bin/env node\n${source}`);
  chmodSync(path, 0o755);
}

function fakeGitSource() {
  return `
const { cpSync, mkdirSync, realpathSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const fixtureRoot = process.env.OPENPETS_RELEASE_FIXTURE_ROOT;
const statePath = process.env.OPENPETS_RELEASE_STATE;
const isFixtureRoot = realpathSync(process.cwd()) === realpathSync(fixtureRoot);
const state = readState();

if (args[0] === "remote" && args[1] === "get-url") {
  if (!isFixtureRoot) fail("remote validation must use the current checkout");
  state.remoteChecked = true;
  saveState(state);
  process.stdout.write("https://github.com/alvinunreal/openpets.git\\n");
} else if (args[0] === "status") {
  if (isFixtureRoot) {
    state.currentStatusChecked = true;
  } else {
    requireState(state.installed, "historical source status requires dependency installation");
    state.historicalStatusChecked = true;
    markHistoricalSourceGate(state);
  }
  saveState(state);
} else if (args[0] === "fetch" && args[1] === "origin" && args[2] === undefined) {
  requireState(isFixtureRoot, "current checkout fetch must use the current checkout");
  requireState(state.remoteChecked && state.currentStatusChecked && state.currentHeadChecked, "current checkout validation is incomplete before upstream fetch");
  state.currentFetched = true;
  saveState(state);
} else if (args[0] === "fetch" && args[1] === "--force") {
  requireState(isFixtureRoot && state.currentCheckoutValidated, "trusted ref selection requires current checkout validation");
  requireState(state.trustedRefSelected, "trusted tag fetch requires a selected remote ref");
  state.trustedTagFetched = true;
  saveState(state);
} else if (args[0] === "rev-parse" && args[1] === "HEAD") {
  if (isFixtureRoot) {
    state.currentHeadChecked = true;
    process.stdout.write("current\\n");
  } else {
    requireState(state.installed, "historical source HEAD requires dependency installation");
    state.historicalHeadChecked = true;
    markHistoricalSourceGate(state);
    process.stdout.write("selected\\n");
  }
  saveState(state);
} else if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
  requireState(isFixtureRoot && state.remoteChecked && state.currentStatusChecked && state.currentHeadChecked && state.currentFetched, "upstream validation requires a complete current checkout validation");
  state.upstreamChecked = true;
  saveState(state);
  process.stdout.write("origin/main\\n");
} else if (args[0] === "rev-parse" && args[1] === "origin/main") {
  requireState(isFixtureRoot && state.upstreamChecked, "current checkout validation must resolve upstream before trusted ref selection");
  state.currentCheckoutValidated = true;
  saveState(state);
  process.stdout.write("current\\n");
} else if (args[0] === "rev-parse" && args[1]?.includes("^{commit}")) {
  requireState(isFixtureRoot && state.trustedTagFetched, "trusted tag commit resolution requires the fetched tag");
  state.trustedTagCommitRead = true;
  saveState(state);
  process.stdout.write("selected\\n");
} else if (args[0] === "rev-parse" && args[1]?.startsWith("refs/tags/")) {
  requireState(isFixtureRoot && state.trustedTagFetched, "trusted tag resolution requires the fetched tag");
  state.trustedTagDirectRead = true;
  saveState(state);
  process.stdout.write("tag-object\\n");
} else if (args[0] === "ls-remote") {
  requireState(isFixtureRoot && state.currentCheckoutValidated, "trusted ref selection requires current checkout validation");
  state.trustedRefSelected = true;
  saveState(state);
  process.stdout.write("tag-object\\trefs/tags/v3.5.0\\nselected\\trefs/tags/v3.5.0^{}\\n");
} else if (args[0] === "cat-file") {
  requireState(isFixtureRoot && state.trustedTagFetched, "trusted tag inspection requires the fetched tag");
  state.trustedTagInspected = true;
  saveState(state);
  process.stdout.write("tag\\n");
} else if (args[0] === "worktree" && args[1] === "add") {
  requireState(isFixtureRoot && state.currentCheckoutValidated && state.trustedRefSelected, "worktree creation requires trusted ref selection");
  requireState(state.trustedTagFetched && state.trustedTagInspected && state.trustedTagDirectRead && state.trustedTagCommitRead, "worktree creation requires trusted tag verification");
  const worktree = args[3];
  mkdirSync(worktree, { recursive: true });
  cpSync(fixtureRoot, worktree, { recursive: true, force: true });
  state.worktreeCreated = true;
  state.worktreePath = worktree;
  saveState(state);
} else if (args[0] === "worktree" && args[1] === "remove") {
  rmSync(args[3], { recursive: true, force: true });
  state.cleanupCompleted = true;
  saveState(state);
} else {
  fail("unexpected git operation");
}

function readState() {
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function saveState(nextState) {
  writeFileSync(statePath, JSON.stringify(nextState));
}

function markHistoricalSourceGate(nextState) {
  if (nextState.historicalStatusChecked && nextState.historicalHeadChecked && nextState.trustedTagCommitRead) {
    nextState.historicalSourceGatePassed = true;
  }
}

function requireState(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  process.stderr.write("fixture transition failed: " + message + "\\n");
  process.exit(1);
}
`;
}

function fakePnpmSource() {
  return `
const { readFileSync, realpathSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const statePath = process.env.OPENPETS_RELEASE_STATE;
const state = readState();

if (args[0] === "--version") {
  requireState(state.installed, "pnpm availability check requires the recovery install");
  process.stdout.write("11.0.8\\n");
} else if (args[0] === "install") {
  requireState(state.worktreeCreated, "dependency installation requires a recovery worktree");
  requireState(realpathSync(process.cwd()) === realpathSync(state.worktreePath), "dependency installation must run in the recovery worktree");
  state.installed = true;
  saveState(state);
} else if (args[0] === "publish") {
  requireState(state.installed, "publication requires dependency installation");
  requireState(state.historicalSourceGatePassed, "publication requires the historical source gate");
  requireState(realpathSync(process.cwd()).startsWith(realpathSync(state.worktreePath) + "/"), "publication must use the recovery source");
  const packageJson = JSON.parse(readFileSync(require("node:path").join(process.cwd(), "package.json"), "utf8"));
  state.publication = { name: packageJson.name, version: packageJson.version, sourcePath: process.cwd() };
  state.releaseSucceeded = true;
  saveState(state);
} else {
  fail("unexpected pnpm operation");
}

function readState() {
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function saveState(nextState) {
  writeFileSync(statePath, JSON.stringify(nextState));
}

function requireState(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  process.stderr.write("fixture transition failed: " + message + "\\n");
  process.exit(1);
}
`;
}

function fakeNpmSource() {
  return `
const { readFileSync } = require("node:fs");
const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(process.env.OPENPETS_RELEASE_STATE, "utf8"));
if (args[0] === "--version") {
  if (!state.installed) fail("npm availability check requires the recovery install");
  process.stdout.write("11.0.0\\n");
} else if (args[0] === "view") {
  if (!state.historicalSourceGatePassed) fail("registry inspection requires the historical source gate");
  process.stdout.write(JSON.stringify({ error: { code: "E404", summary: "No match found for version 3.5.0" } }));
  process.exitCode = 1;
} else {
  fail("unexpected npm operation");
}

function fail(message) {
  process.stderr.write("fixture transition failed: " + message + "\\n");
  process.exit(1);
}
`;
}

function assertSuccessfulRelease(state) {
  if (!state.releaseSucceeded || !state.cleanupCompleted) {
    throw new Error("fixture did not reach a successful cleaned-up release state");
  }
  if (state.publication?.name !== "@fixture/package" || state.publication?.version !== "3.5.0") {
    throw new Error("fixture did not observe publication of the recovered package");
  }
}
