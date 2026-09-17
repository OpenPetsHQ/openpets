import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyNpmViewResult,
  getDesktopNpmGateMode,
  getDesktopNpmGateSpecs,
  getPackagedNpmIntegrationSpecs,
  verifyPackagedNpmIntegrations,
} from "../../../scripts/npm-exact-version-probe.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "../../..");

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, actual ${actual}`);
}

function assertMatch(actual, pattern, label) {
  if (!pattern.test(actual)) throw new Error(`${label} mismatch: ${pattern} did not match:\n${actual}`);
}

function assertDoesNotMatch(actual, pattern, label) {
  if (pattern.test(actual)) throw new Error(`${label} mismatch: ${pattern} unexpectedly matched:\n${actual}`);
}

function assertProcessFailure(args, pattern, label) {
  const result = spawnSync(process.execPath, [join(scriptsDir, "release-local.mjs"), ...args], { encoding: "utf8" });
  if (result.status === 0) throw new Error(`${label}: expected the command to fail`);
  assertMatch(`${result.stderr || ""}\n${result.stdout || ""}`, pattern, label);
}

function readStagePlan(extraArgs) {
  const result = spawnSync(process.execPath, [join(scriptsDir, "release-local.mjs"), ...extraArgs, "--status"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`release-local --status failed:\n${result.stderr || result.stdout}`);
  const stages = [];
  for (const line of String(result.stdout).split("\n")) {
    const match = line.match(/^\s*\d+\.\s+(pending|done|stale|always)\s+(\S+)\s+—/);
    if (match) stages.push({ status: match[1], id: match[2] });
  }
  if (stages.length === 0) throw new Error(`no stages found in release-local --status output:\n${result.stdout}`);
  return stages;
}

function assertThrowsWith(fn, patterns, label) {
  let message = "";
  try {
    fn();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (!message) throw new Error(`${label}: expected an error but none was thrown`);
  for (const pattern of patterns) assertMatch(message, pattern, label);
  return message;
}

function publishedProbe() {
  return () => ({ outcome: "published", detail: "exists" });
}

function e404Stdout(name, version) {
  return JSON.stringify({
    error: {
      code: "E404",
      summary: `No match found for version ${version}`,
      detail: `The requested resource '${name}@${version}' could not be found in the registry.`,
    },
  });
}

function e404PackageStdout(name) {
  const encodedName = name.replace("/", "%2f");
  return JSON.stringify({
    error: {
      code: "E404",
      summary: `Not Found - GET https://registry.npmjs.org/${encodedName} - Not found`,
      detail: `404 Not Found - GET https://registry.npmjs.org/${encodedName} - Not found`,
    },
  });
}

async function main() {
  // Classifier: published on status 0.
  assertEqual(getDesktopNpmGateMode({ desktopVersion: "3.5.0", publicPackages: [{ version: "3.5.0" }] }), "full", "matching desktop release mode");
  assertEqual(getDesktopNpmGateMode({ desktopVersion: "3.6.0", publicPackages: [{ version: "3.5.0" }] }), "desktop-only", "desktop-only release mode");
  assertEqual(getDesktopNpmGateMode({ desktopVersion: "3.5.0", publicPackages: [{ version: "3.5.0" }, { version: "3.6.0" }] }), "desktop-only", "mixed-version release mode");
  assertEqual(getDesktopNpmGateSpecs({ desktopVersion: "3.5.0", publicPackages: [{ name: "@fixture/public", version: "3.5.0" }] }).length, 1, "full gate spec set");

  assertEqual(
    classifyNpmViewResult({ name: "@open-pets/opencode", version: "3.5.0", status: 0, stdout: '"3.5.0"\n', stderr: "" }).outcome,
    "published",
    "status 0",
  );

  // Classifier: confirmed E404 shape is missing.
  assertEqual(
    classifyNpmViewResult({ name: "@open-pets/opencode", version: "3.5.0", status: 1, stdout: e404Stdout("@open-pets/opencode", "3.5.0"), stderr: "" }).outcome,
    "missing",
    "E404 shape",
  );
  assertEqual(
    classifyNpmViewResult({ name: "@open-pets/opencode", version: "3.5.0", status: 1, stdout: e404PackageStdout("@open-pets/opencode"), stderr: "" }).outcome,
    "missing",
    "package-level E404 shape",
  );

  // Classifier: non-JSON failure output is a registry error, never missing.
  assertEqual(
    classifyNpmViewResult({ name: "@open-pets/opencode", version: "3.5.0", status: 1, stdout: "not json", stderr: "boom" }).outcome,
    "registry-error",
    "non-JSON output",
  );

  // Classifier: E404 for a different version than requested is inconclusive.
  assertEqual(
    classifyNpmViewResult({ name: "@open-pets/opencode", version: "3.5.0", status: 1, stdout: e404Stdout("@open-pets/opencode", "9.9.9"), stderr: "" }).outcome,
    "registry-error",
    "E404 version mismatch",
  );

  // Classifier: unexpected exit codes are registry errors.
  assertEqual(
    classifyNpmViewResult({ name: "@open-pets/opencode", version: "3.5.0", status: 2, stdout: "", stderr: "" }).outcome,
    "registry-error",
    "nonzero status",
  );

  // Specs: both OpenCode and OpenClaw are required, versions from metadata.
  const specs = getPackagedNpmIntegrationSpecs(repoRoot);
  assertEqual(specs.length, 2, "integration spec count");
  assertEqual(specs[0].name, "@open-pets/opencode", "first spec name");
  assertEqual(specs[1].name, "@open-pets/openclaw", "second spec name");
  for (const spec of specs) {
    const manifest = JSON.parse(readFileSync(join(repoRoot, spec.name === "@open-pets/opencode" ? "packages/opencode" : "packages/openclaw", "package.json"), "utf8"));
    assertEqual(spec.version, manifest.version, `${spec.name} version derives from package metadata`);
  }

  // Specs: fixture versions flow through instead of hardcoded values.
  const fixtureRoot = mkdtempSync(join(tmpdir(), "openpets-npm-gate-"));
  try {
    for (const [dir, name] of [["packages/opencode", "@open-pets/opencode"], ["packages/openclaw", "@open-pets/openclaw"]]) {
      mkdirSync(join(fixtureRoot, dir), { recursive: true });
      writeFileSync(join(fixtureRoot, dir, "package.json"), JSON.stringify({ name, version: "0.0.0-fixture.1" }));
    }
    const fixtureSpecs = getPackagedNpmIntegrationSpecs(fixtureRoot);
    assertEqual(fixtureSpecs[0].version, "0.0.0-fixture.1", "fixture opencode version");
    assertEqual(fixtureSpecs[1].version, "0.0.0-fixture.1", "fixture openclaw version");
    assertEqual(getDesktopNpmGateSpecs({ repoRoot: fixtureRoot, desktopVersion: "3.6.0", publicPackages: [{ version: "3.5.0" }] }).length, 2, "desktop-only gate spec set");
    const checked = verifyPackagedNpmIntegrations({ repoRoot: fixtureRoot, probe: publishedProbe() });
    assertEqual(checked.length, 2, "fixture gate passes");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  // Gate: all published passes.
  const passed = verifyPackagedNpmIntegrations({ repoRoot, probe: publishedProbe() });
  assertEqual(passed.length, 2, "gate pass count");

  // Wiring: the release plan verifies npm specs early on every --yes run and
  // again immediately before the tag and publish boundaries. --status performs
  // no network access and no writes; only the local plan is inspected.
  const yesPlan = readStagePlan(["--yes"]);
  const yesIds = yesPlan.map((stage) => stage.id);
  assertEqual(yesIds[0], "verify:npm-integrations", "early gate runs before expensive builds");
  assertEqual(yesPlan[0].status, "always", "early gate re-runs on every invocation, never checkpoint-skipped");
  assertEqual(yesIds[yesIds.indexOf("tag") - 1], "verify:npm-pre-tag", "revalidation precedes tag creation");
  assertEqual(yesPlan[yesIds.indexOf("tag") - 1].status, "always", "pre-tag revalidation is never checkpoint-skipped");
  assertEqual(yesIds[yesIds.indexOf("release:publish") - 1], "verify:npm-pre-publish", "revalidation precedes release publication");
  assertEqual(yesPlan[yesIds.indexOf("release:publish") - 1].status, "always", "pre-publish revalidation is never checkpoint-skipped");
  assertMatch(yesPlan[0].id, /^verify:npm-integrations$/, "full release mode gate wiring");

  // Wiring: non-release invocations carry no npm gate stages.
  const plainPlan = readStagePlan([]);
  for (const id of ["verify:npm-integrations", "verify:npm-pre-tag", "verify:npm-pre-publish"]) {
    assertEqual(plainPlan.some((stage) => stage.id === id), false, `${id} stays on the release path`);
  }
  assertProcessFailure(["--ref", "v3.5.0", "--status"], /Unknown release option.*--ref/, "desktop release has no historical ref mode");

  // Gate: confirmed E404 fails naming package/version with publish guidance.
  assertThrowsWith(
    () => verifyPackagedNpmIntegrations({ repoRoot, probe: () => ({ outcome: "missing", detail: "no match" }) }),
    [/@open-pets\/opencode@/, /@open-pets\/openclaw@/, /pnpm release:npm/],
    "missing specs",
  );

  // Gate: registry failure fails with a distinct diagnostic, not "unpublished".
  const registryMessage = assertThrowsWith(
    () => verifyPackagedNpmIntegrations({ repoRoot, probe: () => ({ outcome: "registry-error", detail: "timed out after 30 seconds" }) }),
    [/registry check failed/, /not treated as unpublished/, /timed out after 30 seconds/],
    "registry failure",
  );
  assertDoesNotMatch(registryMessage, /unavailable npm specs/, "registry failure is not reported as unpublished");

  // Gate: mixed missing + registry failure reports both distinctly.
  const mixedMessage = assertThrowsWith(
    () => verifyPackagedNpmIntegrations({
      repoRoot,
      probe: (spec) => spec.name === "@open-pets/opencode"
        ? { outcome: "missing", detail: "no match" }
        : { outcome: "registry-error", detail: "socket hang up" },
    }),
    [/@open-pets\/opencode@/, /socket hang up/, /registry check failed/],
    "mixed failure",
  );
  assertMatch(mixedMessage, /pnpm release:npm/, "mixed failure keeps publish guidance");

  console.log("npm release gate invariants passed.");
}

main().catch((error) => {
  console.error("npm release gate invariant failed:", error.message);
  process.exit(1);
});
