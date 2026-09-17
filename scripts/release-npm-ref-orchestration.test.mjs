import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
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
  const canonicalFixtureRoot = realpathSync(fixtureRoot);
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
      OPENPETS_RELEASE_LOG: logPath,
    },
  });
  if (result.status !== 0) {
    throw new Error(`release-npm --ref fixture failed:\n${result.stderr || result.stdout}\nCommands:\n${readFileSync(logPath, "utf8")}`);
  }

  const lines = readFileSync(logPath, "utf8").trim().split("\n");
  const currentStatus = lines.indexOf(`git|${canonicalFixtureRoot}|status --porcelain`);
  const currentUpstream = lines.indexOf(`git|${canonicalFixtureRoot}|rev-parse --abbrev-ref --symbolic-full-name @{u}`);
  const selectedRemote = lines.findIndex((line) => line.startsWith(`git|${canonicalFixtureRoot}|ls-remote origin refs/tags/v3.5.0`));
  const worktreeAdd = lines.findIndex((line) => line.startsWith(`git|${canonicalFixtureRoot}|worktree add --detach `));
  const install = lines.findIndex((line) => line.includes("openpets-npm-recovery-") && line.endsWith("|install --frozen-lockfile"));
  const sourceStatus = lines.findIndex((line) => line.includes("|status --porcelain") && line.includes("openpets-npm-recovery-"));
  const publish = lines.findIndex((line) => line.includes("|publish --access public --tag recovery-3-5-0"));

  assertBefore(currentStatus, currentUpstream, "current checkout status before upstream validation");
  assertBefore(currentUpstream, selectedRemote, "current upstream validation before historical ref selection");
  assertBefore(worktreeAdd, install, "worktree creation before dependency installation");
  assertBefore(install, sourceStatus, "dependency installation before historical release gates");
  assertBefore(sourceStatus, publish, "historical release gates before package processing");
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
import { cpSync, mkdirSync, realpathSync, rmSync, appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const fixtureRoot = process.env.OPENPETS_RELEASE_FIXTURE_ROOT;
const logPath = process.env.OPENPETS_RELEASE_LOG;
const isFixtureRoot = realpathSync(process.cwd()) === realpathSync(fixtureRoot);
appendFileSync(logPath, \`git|\${process.cwd()}|\${args.join(" ")}\\n\`);
if (args[0] === "remote" && args[1] === "get-url") process.stdout.write("https://github.com/alvinunreal/openpets.git\\n");
else if (args[0] === "status") {}
else if (args[0] === "fetch") {}
else if (args[0] === "rev-parse" && args[1] === "HEAD") process.stdout.write((isFixtureRoot ? "current" : "selected") + "\\n");
else if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") process.stdout.write("origin/main\\n");
else if (args[0] === "rev-parse" && args[1] === "origin/main") process.stdout.write("current\\n");
else if (args[0] === "rev-parse" && args[1]?.includes("^{commit}")) process.stdout.write("selected\\n");
else if (args[0] === "rev-parse" && args[1]?.startsWith("refs/tags/")) process.stdout.write("tag-object\\n");
else if (args[0] === "ls-remote") process.stdout.write("tag-object\\trefs/tags/v3.5.0\\nselected\\trefs/tags/v3.5.0^{}\\n");
else if (args[0] === "cat-file") process.stdout.write("tag\\n");
else if (args[0] === "worktree" && args[1] === "add") {
  const worktree = args[3];
  mkdirSync(worktree, { recursive: true });
  cpSync(fixtureRoot, worktree, { recursive: true, force: true });
} else if (args[0] === "worktree" && args[1] === "remove") {
  rmSync(args[3], { recursive: true, force: true });
} else {
  process.stderr.write("unexpected fake git command: " + args.join(" ") + "\\n");
  process.exitCode = 2;
}
`;
}

function fakePnpmSource() {
  return `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.OPENPETS_RELEASE_LOG, \`pnpm|\${process.cwd()}|\${args.join(" ")}\\n\`);
if (args[0] === "--version") process.stdout.write("11.0.8\\n");
else if (args[0] !== "publish" && args[0] !== "install") {
  process.stderr.write("unexpected fake pnpm command: " + args.join(" ") + "\\n");
  process.exitCode = 2;
}
`;
}

function fakeNpmSource() {
  return `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.OPENPETS_RELEASE_LOG, \`npm|\${process.cwd()}|\${args.join(" ")}\\n\`);
if (args[0] === "--version") process.stdout.write("11.0.0\\n");
else if (args[0] === "view") {
  process.stdout.write(JSON.stringify({ error: { code: "E404", summary: "No match found for version 3.5.0" } }));
  process.exitCode = 1;
} else {
  process.stderr.write("unexpected fake npm command: " + args.join(" ") + "\\n");
  process.exitCode = 2;
}
`;
}

function assertBefore(first, second, label) {
  if (first === -1 || second === -1 || first >= second) {
    throw new Error(`${label} invariant failed: ${first} must precede ${second}.`);
  }
}
