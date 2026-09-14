import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { discoverArtifacts } from "./test-discovery.mjs";

function assertEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label} mismatch:\nexpected ${expectedJson}\nactual ${actualJson}`);
  }
}

async function main() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "openpets-test-discovery-"));
  try {
    await mkdir(join(fixtureRoot, "tests", "nested"), { recursive: true });
    await mkdir(join(fixtureRoot, "contracts", "nested"), { recursive: true });
    await mkdir(join(fixtureRoot, "src", "nested"), { recursive: true });
    await mkdir(join(fixtureRoot, ".test-dist", "tests", "nested"), { recursive: true });
    await mkdir(join(fixtureRoot, ".test-dist", "contracts"), { recursive: true });
    await mkdir(join(fixtureRoot, "dist"), { recursive: true });

    const files = [
      "tests/zeta.test.ts",
      "tests/nested/alpha.test.ts",
      "tests/ignored.ts",
      "tests/nested/ignored.spec.ts",
      "contracts/zeta.contract.ts",
      "contracts/nested/alpha.contract.ts",
      "contracts/ignored.ts",
      "contracts/nested/ignored.contract.js",
      "src/check-zed.ts",
      "src/check-alpha.ts",
      "src/not-a-check.ts",
      "src/nested/check-nested.ts",
      ".test-dist/tests/stale.test.js",
      ".test-dist/tests/nested/stale.test.js",
      ".test-dist/contracts/stale.contract.js",
      "dist/check-stale.js",
    ];
    for (const file of files) await writeFile(join(fixtureRoot, file), "");

    const discovered = await discoverArtifacts(fixtureRoot);
    const toRelative = (paths) => paths.map((path) => relative(fixtureRoot, path).split("\\").join("/"));
    assertEqual(toRelative(discovered.behaviorTests), [
      ".test-dist/tests/nested/alpha.test.js",
      ".test-dist/tests/zeta.test.js",
    ], "behavior artifacts");
    assertEqual(toRelative(discovered.contractTests), [
      ".test-dist/contracts/nested/alpha.contract.js",
      ".test-dist/contracts/zeta.contract.js",
    ], "contract artifacts");
    assertEqual(toRelative(discovered.distChecks), [
      "dist/check-alpha.js",
      "dist/check-zed.js",
      "dist/nested/check-nested.js",
    ], "dist artifacts");
    console.log("Test discovery invariants passed.");
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error("Test discovery invariant failed:", error.message);
  process.exit(1);
});
