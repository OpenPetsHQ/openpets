import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertNoForbiddenPackageOutput } from "../src/packaging-output-contract.js";

const fixtureRoot = mkdtempSync(join(tmpdir(), "openpets-packaging-output-"));

try {
  const dependencyOutput = join(fixtureRoot, "dependency-output");
  writeFixtureFile(dependencyOutput, "resources/app.asar.unpacked/node_modules/undici/lib/web/fetch/index.js");
  assert.doesNotThrow(() => assertNoForbiddenPackageOutput(dependencyOutput), "dependency directories may use ordinary names such as web");

  const applicationOutput = join(fixtureRoot, "application-output");
  writeFixtureFile(applicationOutput, "resources/web/index.html");
  assert.throws(() => assertNoForbiddenPackageOutput(applicationOutput), /forbidden path segment/, "application output must not include an unowned web directory");

  const sensitiveDependencyOutput = join(fixtureRoot, "sensitive-dependency-output");
  writeFixtureFile(sensitiveDependencyOutput, "resources/app.asar.unpacked/node_modules/example/.env");
  assert.throws(() => assertNoForbiddenPackageOutput(sensitiveDependencyOutput), /forbidden path segment/, "sensitive files remain forbidden inside dependencies");

  console.error("Packaging output contract validation passed.");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

function writeFixtureFile(root: string, relativePath: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "fixture\n");
}
