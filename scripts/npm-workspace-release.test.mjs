import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

import { discoverPublicWorkspacePackages } from "./npm-workspace-release.mjs";

const fixtureRoot = mkdtempSync(join(tmpdir(), "openpets-workspace-release-"));

try {
  writeFileSync(join(fixtureRoot, "pnpm-workspace.yaml"), "packages:\n  - \"packages/*\"\n");
  writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));

  createPackage("z-dependent", { dependencies: { "@fixture/base": "workspace:*" } });
  createPackage("base", { name: "@fixture/base" });
  createPackage("middle", { dependencies: { "@fixture/base": "workspace:*" } });
  createPackage("private", { private: true, name: "@fixture/private" });
  createPackage("unpublished", { name: "@fixture/unpublished" });

  writeFileSync(join(fixtureRoot, "packages/z-dependent/package.json"), JSON.stringify({
    name: "@fixture/z-dependent",
    version: "3.5.0",
    publishConfig: { access: "public" },
    dependencies: { "@fixture/private": "workspace:*" },
  }));
  assert.throws(() => discoverPublicWorkspacePackages(fixtureRoot), /non-public package @fixture\/private/, "private runtime dependency rejection");
  writeFileSync(join(fixtureRoot, "packages/z-dependent/package.json"), JSON.stringify({
    name: "@fixture/z-dependent",
    version: "3.5.0",
    publishConfig: { access: "public" },
    optionalDependencies: { "@fixture/private": "workspace:*" },
  }));
  assert.throws(() => discoverPublicWorkspacePackages(fixtureRoot), /non-public package @fixture\/private/, "private optional dependency rejection");
  writeFileSync(join(fixtureRoot, "packages/z-dependent/package.json"), JSON.stringify({
    name: "@fixture/z-dependent",
    version: "3.5.0",
    publishConfig: { access: "public" },
    dependencies: { "@fixture/base": "^3.5.0" },
  }));
  assert.throws(() => discoverPublicWorkspacePackages(fixtureRoot), /exact workspace:\* spec.*@fixture\/base.*\^3\.5\.0/, "stale internal dependency range rejection");
  writeFileSync(join(fixtureRoot, "packages/z-dependent/package.json"), JSON.stringify({
    name: "@fixture/z-dependent",
    version: "3.5.0",
    publishConfig: { access: "public" },
    optionalDependencies: { "@fixture/base": "workspace:^" },
  }));
  assert.throws(() => discoverPublicWorkspacePackages(fixtureRoot), /exact workspace:\* spec.*@fixture\/base.*workspace:\^/, "malformed optional workspace spec rejection");
  createPackage("z-dependent", { dependencies: { "@fixture/base": "workspace:*" } });

  const packages = discoverPublicWorkspacePackages(fixtureRoot);
  assert.deepEqual(packages.map((pkg) => pkg.name), ["@fixture/base", "@fixture/unpublished", "@fixture/middle", "@fixture/z-dependent"], "public deterministic topological order");
  assert.equal(packages.some((pkg) => pkg.name === "@fixture/private"), false, "private package exclusion");
  assert.equal(packages.every((pkg) => pkg.version === "3.5.0"), true, "shared version validation");

  writeFileSync(join(fixtureRoot, "packages/unpublished/package.json"), JSON.stringify({
    name: "@fixture/unpublished",
    version: "3.5.1",
    publishConfig: { access: "public" },
  }));
  assert.throws(() => discoverPublicWorkspacePackages(fixtureRoot), /one shared version/, "mixed version rejection");
  console.log("npm workspace release invariants passed.");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

function createPackage(directory, overrides = {}) {
  const packageDir = join(fixtureRoot, "packages", directory);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({
    name: overrides.name || `@fixture/${directory}`,
    version: "3.5.0",
    publishConfig: { access: "public" },
    ...overrides,
  }));
}
