#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

import { classifyNpmViewResult } from "./npm-exact-version-probe.mjs";
import { discoverPublicWorkspacePackages } from "./npm-workspace-release.mjs";
import {
  publishStagedRelease,
  resolveReleaseTag,
} from "./npm-release-policy.mjs";
import {
  recoveryInstallCommand,
  validateCurrentCheckoutState,
  validateRecoverySource,
  validateTrustedTagRefs,
} from "./npm-release-recovery.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const repository = "alvinunreal/openpets";
const npmRegistry = "https://registry.npmjs.org";
const npmRegistryProbeTimeoutMs = 30_000;

const allowedArgs = new Set([
  "--yes",
  "--dry-run",
  "--skip-checks",
  "--tag",
  "--otp",
  "--ref",
  "--help",
]);

const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const options = parseArgs(rawArgs);
if (options.help) {
  printHelp();
  process.exit(0);
}

if (options.skipChecks && options.yes && !options.dryRun) {
  throw new Error("Refusing to publish with --skip-checks and --yes. Run checks before a live release.");
}

if (options.ref) await recoverFromTrustedRef();
else await main({ sourceRoot: repoRoot });

async function recoverFromTrustedRef() {
  // Keep this orchestrator (and all policy modules) from the current checkout;
  // only the package source is read from the trusted historical worktree.
  const currentCheckoutHead = validateCurrentOrchestratorCheckout();
  const selectedVersion = options.ref.slice(1);
  const selectedCommit = validateTrustedRemoteTag(options.ref);
  const worktree = mkdtempSync(join(tmpdir(), `openpets-npm-recovery-${selectedVersion}-`));
  let worktreeAdded = false;
  try {
    run("git", ["worktree", "add", "--detach", worktree, selectedCommit], { cwd: repoRoot });
    worktreeAdded = true;
    const [installCommand, installArgs] = recoveryInstallCommand();
    run(installCommand, installArgs, { cwd: worktree });
    await main({ sourceRoot: worktree, selectedRef: options.ref, selectedCommit, currentCheckoutHead });
  } finally {
    if (worktreeAdded) run("git", ["worktree", "remove", "--force", worktree], { cwd: repoRoot });
    else rmSync(worktree, { recursive: true, force: true });
  }
}

function validateTrustedRemoteTag(ref) {
  const remoteUrl = commandOutput("git", ["remote", "get-url", "origin"], { cwd: repoRoot }).trim();
  if (!remoteUrl.includes(repository)) {
    throw new Error(`Expected origin remote to point at ${repository}. Current origin: ${remoteUrl}`);
  }
  const remoteRefs = commandOutput("git", ["ls-remote", "origin", `refs/tags/${ref}`, `refs/tags/${ref}^{}`], { cwd: repoRoot })
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(/\s+/));
  const peeled = validateTrustedTagRefs({ ref, remoteRefs });
  const direct = remoteRefs.find(([, remoteRef]) => remoteRef === `refs/tags/${ref}`)?.[0];

  run("git", ["fetch", "--force", "origin", `refs/tags/${ref}:refs/tags/${ref}`], { cwd: repoRoot });
  const localType = commandOutput("git", ["cat-file", "-t", `refs/tags/${ref}`], { cwd: repoRoot }).trim();
  if (localType !== "tag") throw new Error(`Remote ${ref} is not an annotated tag.`);
  const localDirect = commandOutput("git", ["rev-parse", `refs/tags/${ref}`], { cwd: repoRoot }).trim();
  if (localDirect !== direct) throw new Error(`Remote ${ref} changed while it was being fetched.`);
  const localCommit = commandOutput("git", ["rev-parse", `refs/tags/${ref}^{commit}`], { cwd: repoRoot }).trim();
  if (localCommit !== peeled) throw new Error(`Remote ${ref} changed while it was being fetched.`);
  return peeled;
}

async function main({ sourceRoot, selectedRef = null, selectedCommit = null, currentCheckoutHead = null }) {
  const packages = discoverPublicWorkspacePackages(sourceRoot);
  preflight({ sourceRoot, selectedRef, selectedCommit, packages, currentCheckoutHead });

  if (!options.skipChecks) {
    run("pnpm", ["build"], { cwd: sourceRoot });
    run("pnpm", ["check"], { cwd: sourceRoot });
  }

  const existing = await findAlreadyPublishedPackages(packages, sourceRoot);

  console.log("\nNPM publish plan:");
  for (const pkg of packages) {
    const alreadyPublished = existing.some((candidate) => candidate.name === pkg.name && candidate.version === pkg.version);
    console.log(`- ${pkg.name}@${pkg.version}${alreadyPublished ? " (already published)" : ""}`);
  }

  if (!options.yes || options.dryRun) {
    console.log("\nDry run: package publish commands will be validated without uploading.");
  }

  if (options.yes && !options.dryRun) {
    await publishStagedRelease({
      packages,
      existing,
      requestedTag: options.tag,
      publishPackage: (pkg, tag) => publishPackage(pkg, tag, false),
      addDistTag,
      inspectExact: (pkg) => npmPackageIsPublished(pkg, sourceRoot),
      inspectDistTags: (pkg) => npmDistTags(pkg, sourceRoot),
      smoke: () => smokePublishedCli(packages, sourceRoot),
      log: console.log,
    });
  } else {
    for (const pkg of packages) {
      if (isAlreadyPublished(existing, pkg)) {
        console.log(`\nSkipping already published ${pkg.name}@${pkg.version}`);
        continue;
      }
      publishPackage(pkg, options.tag, true);
    }
  }

  if (options.yes && !options.dryRun) {
    console.log("\nNPM packages published successfully.");
  } else {
    console.log("\nDry run complete. Re-run with --yes to publish to npm.");
  }
}

function parseArgs(args) {
  const parsed = { yes: false, dryRun: false, skipChecks: false, help: false, tag: "latest", tagWasExplicit: false, otp: "", ref: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--tag" || arg.startsWith("--tag=") || arg === "--otp" || arg.startsWith("--otp=") || arg === "--ref" || arg.startsWith("--ref=")) {
      const optionName = arg.split("=", 1)[0];
      const value = arg.includes("=") ? arg.slice(optionName.length + 1) : args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      if (optionName === "--tag") {
        parsed.tag = value;
        parsed.tagWasExplicit = true;
      }
      if (optionName === "--otp") parsed.otp = value;
      if (optionName === "--ref") parsed.ref = value;
      if (!arg.includes("=")) index += 1;
      continue;
    }

    if (!allowedArgs.has(arg)) throw new Error(`Unknown npm release option: ${arg}`);
    if (arg === "--yes") parsed.yes = true;
    if (arg === "--dry-run") parsed.dryRun = true;
    if (arg === "--skip-checks") parsed.skipChecks = true;
    if (arg === "--help") parsed.help = true;
  }
  if (parsed.ref) {
    if (!/^v\d+\.\d+\.\d+$/.test(parsed.ref)) throw new Error(`--ref must be a stable version tag such as v3.5.0. Received: ${parsed.ref}`);
    parsed.tag = resolveReleaseTag({ version: parsed.ref.slice(1), requestedTag: parsed.tag, tagWasExplicit: parsed.tagWasExplicit, recovery: true });
  }
  return parsed;
}

function preflight({ sourceRoot, selectedRef, selectedCommit, packages, currentCheckoutHead = null }) {
  requireCommand("pnpm", ["--version"]);
  requireCommand("npm", ["--version"]);
  if (options.yes && !options.dryRun) {
    run("npm", ["whoami", "--registry", npmRegistry], { cwd: repoRoot });
  }

  const orchestratorHead = currentCheckoutHead || validateCurrentOrchestratorCheckout();

  const sourceStatus = commandOutput("git", ["status", "--porcelain"], { cwd: sourceRoot }).trim();
  if (sourceStatus) throw new Error(`Historical npm release source must be clean.\n${sourceStatus}`);
  const localHead = commandOutput("git", ["rev-parse", "HEAD"], { cwd: sourceRoot }).trim();
  if (selectedRef) {
    const localTag = `refs/tags/${selectedRef}`;
    const tagType = commandOutput("git", ["cat-file", "-t", localTag], { cwd: repoRoot }).trim();
    const tagCommit = commandOutput("git", ["rev-parse", `${localTag}^{commit}`], { cwd: repoRoot }).trim();
    if (tagType !== "tag") throw new Error(`Recovery source must be the trusted annotated tag ${selectedRef}.`);
    validateRecoverySource({
      ref: selectedRef,
      headCommit: localHead,
      tagCommit,
      expectedCommit: selectedCommit,
      packageVersions: packages.map((pkg) => pkg.version),
    });
  } else if (localHead !== orchestratorHead) {
    throw new Error(`Release source HEAD ${localHead} does not match the validated orchestrator HEAD ${orchestratorHead}.`);
  }
}

function validateCurrentOrchestratorCheckout() {
  const remoteUrl = commandOutput("git", ["remote", "get-url", "origin"], { cwd: repoRoot }).trim();
  if (!remoteUrl.includes(repository)) throw new Error(`Expected origin remote to point at ${repository}. Current origin: ${remoteUrl}`);

  const currentStatus = commandOutput("git", ["status", "--porcelain"], { cwd: repoRoot }).trim();
  const currentHead = commandOutput("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).trim();
  run("git", ["fetch", "origin"], { cwd: repoRoot });
  const upstream = commandOutput("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd: repoRoot }).trim();
  const remoteHead = upstream ? commandOutput("git", ["rev-parse", upstream], { cwd: repoRoot }).trim() : "";
  return validateCurrentCheckoutState({ status: currentStatus, upstream, head: currentHead, remoteHead });
}

async function findAlreadyPublishedPackages(packages, sourceRoot) {
  const existing = [];
  for (const pkg of packages) {
    if (await npmPackageIsPublished(pkg, sourceRoot)) existing.push(pkg);
  }
  return existing;
}

function isAlreadyPublished(existing, pkg) {
  return existing.some((candidate) => candidate.name === pkg.name && candidate.version === pkg.version);
}

function publishPackage(pkg, tag, dryRun) {
  const args = ["publish", "--access", "public", "--tag", tag, "--no-git-checks", "--registry", npmRegistry];
  if (dryRun) args.push("--dry-run");
  if (options.otp) args.push("--otp", options.otp);
  run("pnpm", args, { cwd: pkg.packageDir });
}

function addDistTag(pkg, tag) {
  const args = ["dist-tag", "add", `${pkg.name}@${pkg.version}`, tag, "--registry", npmRegistry];
  if (options.otp) args.push("--otp", options.otp);
  run("npm", args, { cwd: repoRoot });
}

async function smokePublishedCli(packages, sourceRoot) {
  const cli = packages.find((pkg) => pkg.name === "@open-pets/cli");
  if (!cli || !cli.packageJson.bin) {
    console.log("Skipping npm CLI smoke test: no public CLI package was discovered.");
    return;
  }
  console.log(`\n$ npm exec --yes --package ${cli.name}@${cli.version} -- openpets --help`);
  const result = spawnSync("npm", ["exec", "--yes", `--package=${cli.name}@${cli.version}`, "--registry", npmRegistry, "--", "openpets", "--help"], {
    cwd: sourceRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`Published CLI smoke test failed with exit code ${result.status ?? "unknown"}. Requested tag was not promoted.`);
}

async function npmPackageIsPublished(pkg, sourceRoot) {
  const args = ["view", `${pkg.name}@${pkg.version}`, "version", "--json", "--registry", npmRegistry];
  const command = `npm ${args.join(" ")}`;
  console.log(`Checking npm registry: ${pkg.name}@${pkg.version}`);
  let result;
  try {
    result = await runNpmRegistryProbe(args, sourceRoot);
  } catch (error) {
    throw new Error(`npm registry probe failed for ${pkg.name}@${pkg.version}: ${command}. ${error.message}. Check npm registry connectivity and authentication, then retry.`);
  }

  if (result.status === 0) return true;
  const output = `${result.stderr || ""}\n${result.stdout || ""}`.trim();
  if (classifyNpmViewResult({ name: pkg.name, version: pkg.version, status: result.status, stdout: result.stdout, stderr: result.stderr }).outcome === "missing") return false;

  const reason = `exited with code ${result.status ?? "unknown"}`;
  throw new Error(`npm registry probe failed for ${pkg.name}@${pkg.version}: ${command} ${reason}. Check npm registry connectivity and authentication, then retry.${output ? `\n${output}` : ""}`);
}

async function npmDistTags(pkg, sourceRoot) {
  const args = ["view", pkg.name, "dist-tags", "--json", "--registry", npmRegistry];
  const result = await runNpmRegistryProbe(args, sourceRoot);
  if (result.status !== 0) {
    const classification = classifyNpmViewResult({ name: pkg.name, version: pkg.version, status: result.status, stdout: result.stdout, stderr: result.stderr });
    if (classification.outcome === "missing") return null;
    throw new Error(`npm registry probe failed while inspecting dist-tags for ${pkg.name}: ${classification.detail}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Could not parse npm dist-tags for ${pkg.name}: ${error.message}`);
  }
}

function runNpmRegistryProbe(args, cwd = repoRoot) {
  return new Promise((resolveProbe, rejectProbe) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn("npm", args, {
      cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      terminateProcessTree(child);
      rejectProbe(new Error(`timed out after ${npmRegistryProbeTimeoutMs / 1_000} seconds`));
    }, npmRegistryProbeTimeoutMs);

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectProbe(error);
    });
    child.once("close", (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveProbe({ status, stdout, stderr });
    });
  });
}

function terminateProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const terminator = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { detached: true, stdio: "ignore", windowsHide: true });
    terminator.unref();
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function requireCommand(command, args) {
  if (!commandSucceeds(command, args, { cwd: repoRoot })) throw new Error(`Required command is unavailable: ${command}`);
}

function commandSucceeds(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, stdio: "ignore" }).status === 0;
}

function commandOutput(command, args, options) {
  const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  return result.stdout;
}

function run(command, args, options) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: options.cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
}

function printHelp() {
  console.log(`Usage: pnpm release:npm -- --yes

Publishes the public OpenPets npm packages in dependency order.
The public package set and dependency order are discovered from workspace manifests.

Options:
  --yes            publish to npm; without this, runs pnpm publish --dry-run
  --dry-run        force dry-run behavior even with --yes
  --skip-checks    skip pnpm build and pnpm check
  --tag <tag>      npm dist-tag to publish under (default: latest)
  --otp <code>     npm two-factor authentication one-time password
  --ref <vX.Y.Z>   recover from a trusted remote annotated tag in an isolated worktree
  --help           show this help
`);
}
