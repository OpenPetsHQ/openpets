import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { apply, name } from "./index.js";

assert.equal(name, "@open-pets/dsh");
assert.equal(typeof apply, "function");

{
  const packageDirectory = join(import.meta.dirname, "..");
  const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as Record<string, unknown>;
  assert.equal(manifest.name, "@open-pets/dsh");
  assert.match(manifest.version as string, /^\d+\.\d+\.\d+$/, "package version must use stable semver");
  assert.deepEqual(manifest.files, [
    "dist/index.d.ts",
    "dist/index.js",
    "dist/runtime.d.ts",
    "dist/runtime.js",
    "cordis.patch.yml",
  ]);
  assert.deepEqual(manifest.exports, {
    ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json",
  });
  assert.equal((manifest.peerDependencies as Record<string, string>)["@deepseek-ai/cordis"], "^4.0.1");
  for (const output of ["dist/index.js", "dist/index.d.ts", "dist/runtime.js", "dist/runtime.d.ts"]) {
    assert.equal(existsSync(join(packageDirectory, output)), true);
  }
  const exports = manifest.exports as Record<string, unknown>;
  const bundle = (manifest.dsh as Record<string, unknown>).bundle as Record<string, unknown>;
  const patchSubpath = bundle.patch;
  assert.equal(typeof patchSubpath, "string", "dsh bundle patch must be an exported package subpath");
  assert.equal(Object.hasOwn(exports, patchSubpath as string), true, "dsh bundle patch must be exported");

  const patchTarget = exports[patchSubpath as string];
  assert.equal(typeof patchTarget, "string", "exported Cordis patch must resolve to a package file");
  assert.equal((patchTarget as string).startsWith("./"), true, "exported Cordis patch must be a relative path");
  assert.equal(existsSync(join(packageDirectory, patchTarget as string)), true, "resolved Cordis patch artifact must exist");
  assert.equal(createRequire(import.meta.url)("@open-pets/dsh/package.json").name, "@open-pets/dsh");
}

console.log("DSH package artifact checks passed.");
