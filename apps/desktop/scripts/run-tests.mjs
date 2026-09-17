#!/usr/bin/env node
/**
 * Desktop test runner
 * Runs preload checks, builds and runs behavior tests, contract tests, then remaining dist checks.
 */

import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { discoverArtifacts, relativePath } from "./test-discovery.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const preloadChecks = ["control-center-preload.cjs", "pet-preload.cjs", "pet-tts-helper.cjs", "plugin-sdk-preload.cjs", "panel-preload.cjs", "voice-realtime-preload.cjs"];

async function assertArtifactsExist(label, artifacts) {
  const missing = [];
  for (const artifact of artifacts) {
    try {
      if (!(await stat(artifact)).isFile()) missing.push(artifact);
    } catch (error) {
      if (error.code === "ENOENT") missing.push(artifact);
      else throw error;
    }
  }
  if (missing.length > 0) {
    const listed = missing.map((artifact) => `  ${relativePath(rootDir, artifact)}`).join("\n");
    throw new Error(`Missing mapped ${label} artifacts:\n${listed}`);
  }
}

function logDiscoveredArtifacts(label, artifacts) {
  console.log(`\nDiscovered ${label}:`);
  for (const artifact of artifacts) console.log(`- ${relativePath(rootDir, artifact)}`);
}

function commandForPlatform(command, args) {
  if (process.platform === "win32" && command === "pnpm") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "pnpm.cmd", ...args] };
  }
  return { command, args };
}

function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const platformCommand = commandForPlatform(command, args);
    const child = spawn(platformCommand.command, platformCommand.args, {
      stdio: "inherit",
      cwd: rootDir,
      env: { ...process.env, OPENPETS_DESKTOP_ROOT: rootDir },
      ...options,
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(" ")}`));
      } else {
        resolve();
      }
    });
    child.on("error", reject);
  });
}

async function main() {
  console.log("\n[preflight] Checking test discovery invariants...");
  await run("node", ["scripts/test-discovery.test.mjs"]);

  console.log("\n[preflight] Checking npm release gate invariants...");
  await run("node", ["scripts/npm-release-gate.test.mjs"]);

  const { behaviorTests, contractTests, distChecks } = await discoverArtifacts(rootDir);
  await rm(join(rootDir, ".test-dist"), { force: true, recursive: true });
  logDiscoveredArtifacts("behavior tests", behaviorTests);
  logDiscoveredArtifacts("contract tests", contractTests);
  logDiscoveredArtifacts("dist checks", distChecks);

  // 1. Preload syntax checks
  console.log("\n[1/5] Checking preload syntax...");
  for (const preload of preloadChecks) await run("node", ["--check", preload]);

  // 2. Build tests
  console.log("\n[2/5] Building tests...");
  await run("pnpm", ["test:build"]);
  await assertArtifactsExist("behavior test", behaviorTests);
  await assertArtifactsExist("contract test", contractTests);

  // 3. Run behavior tests
  console.log("\n[3/5] Running behavior tests...");
  for (const test of behaviorTests) {
    console.log(`- ${relativePath(rootDir, test)}`);
    await run("node", [test]);
  }

  // 4. Run contract tests
  console.log("\n[4/5] Running contract tests...");
  for (const test of contractTests) {
    console.log(`- ${relativePath(rootDir, test)}`);
    await run("node", [test]);
  }

  // 5. Run remaining dist checks
  console.log("\n[5/5] Running dist checks...");
  await rm(join(rootDir, "dist"), { force: true, recursive: true });
  await run("pnpm", ["build:main"]);
  await assertArtifactsExist("dist check", distChecks);
  for (const check of distChecks) {
    console.log(`- ${relativePath(rootDir, check)}`);
    await run("node", [check]);
  }

  console.log("\nâœ“ All tests passed!");
}

main().catch((err) => {
  console.error("\nâœ— Test suite failed:", err.message);
  process.exit(1);
});
