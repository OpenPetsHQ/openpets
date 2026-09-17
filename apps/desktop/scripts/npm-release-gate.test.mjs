import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyNpmViewResult,
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

async function main() {
  // Classifier: published on status 0.
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
    const checked = verifyPackagedNpmIntegrations({ repoRoot: fixtureRoot, probe: publishedProbe() });
    assertEqual(checked.length, 2, "fixture gate passes");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  // Gate: all published passes and is repeatable (resume-safe).
  const passed = verifyPackagedNpmIntegrations({ repoRoot, probe: publishedProbe() });
  assertEqual(passed.length, 2, "gate pass count");
  verifyPackagedNpmIntegrations({ repoRoot, probe: publishedProbe() });

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
