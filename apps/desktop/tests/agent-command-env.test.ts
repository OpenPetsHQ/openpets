import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";

import { buildExtraCommandPaths, resolveCommandMode } from "../src/agent-command-env.js";

// Regression coverage for https://github.com/OpenPetsHQ/openpets/issues/57.
//
// Packaged builds used to normalize every requested command mode to
// "bundled", so selecting the Package CLI (published) snapped the UI back to
// the desktop version and detection compared the working `npx` MCP entry
// against the bundled expectation. Separately, fnm-managed Node/Claude
// installs were invisible to the Electron main process, which never
// evaluates shell profiles.

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "openpets-command-env-"));
}

function makeBin(root: string, ...segments: string[]): string {
  const dir = join(root, ...segments);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("resolveCommandMode", () => {
  it("honors an explicit Package CLI choice in packaged builds", () => {
    assert.equal(resolveCommandMode("published", true), "published");
  });

  it("keeps packaged defaults and dev-only local gating", () => {
    assert.equal(resolveCommandMode("bundled", true), "bundled");
    assert.equal(resolveCommandMode("local", true), "bundled");
    assert.equal(resolveCommandMode(undefined, true), "bundled");
    assert.equal(resolveCommandMode("garbage", true), "bundled");
  });

  it("preserves historical dev behavior", () => {
    assert.equal(resolveCommandMode("local", false), "local");
    assert.equal(resolveCommandMode("published", false), "published");
    assert.equal(resolveCommandMode("bundled", false), "published");
    assert.equal(resolveCommandMode(undefined, false), "published");
  });
});

describe("buildExtraCommandPaths", () => {
  it("finds fnm default-alias binaries under well-known home roots", () => {
    const home = makeHome();
    try {
      const xdgBin = makeBin(home, ".local", "share", "fnm", "aliases", "default", "bin");
      const legacyBin = makeBin(home, ".fnm", "aliases", "default", "bin");
      const paths = buildExtraCommandPaths({ homeDir: home, env: {}, platform: "linux" });
      assert.ok(paths.includes(xdgBin), "XDG fnm default alias must be on the probe PATH");
      assert.ok(paths.includes(legacyBin), "legacy ~/.fnm default alias must be on the probe PATH");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("respects FNM_DIR for custom fnm roots", () => {
    const home = makeHome();
    const fnmRoot = makeHome();
    try {
      const aliasBin = makeBin(fnmRoot, "aliases", "default", "bin");
      const paths = buildExtraCommandPaths({ homeDir: home, env: { FNM_DIR: fnmRoot }, platform: "linux" });
      assert.ok(paths.includes(aliasBin), "FNM_DIR default alias must be on the probe PATH");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(fnmRoot, { recursive: true, force: true });
    }
  });

  it("finds the legacy macOS Application Support fnm root", () => {
    const home = makeHome();
    try {
      const macBin = makeBin(home, "Library", "Application Support", "fnm", "aliases", "default", "bin");
      const paths = buildExtraCommandPaths({ homeDir: home, env: {}, platform: "darwin" });
      assert.ok(paths.includes(macBin), "macOS Application Support fnm alias must be on the probe PATH");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("finds fnm aliases on Windows without returning Unix entries", () => {
    const home = makeHome();
    try {
      const aliasDir = makeBin(home, "AppData", "Roaming", "fnm", "aliases", "default");
      const paths = buildExtraCommandPaths({
        homeDir: home,
        env: { APPDATA: join(home, "AppData", "Roaming") },
        platform: "win32",
      });
      assert.ok(paths.includes(aliasDir), "Windows fnm default alias must be on the probe PATH");
      assert.ok(!paths.includes("/opt/homebrew/bin"), "Unix entries must stay off the Windows probe PATH");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("ignores missing directories and transient multishell paths", () => {
    const home = makeHome();
    const multishell = makeHome();
    try {
      const multishellBin = makeBin(multishell, "bin");
      const paths = buildExtraCommandPaths({
        homeDir: home,
        env: { FNM_MULTISHELL_PATH: multishell },
        platform: "linux",
      });
      assert.ok(!paths.some((entry) => entry.includes("fnm")), "no fnm entry may appear when nothing is installed");
      assert.ok(!paths.includes(multishell), "transient multishell roots must never be probed");
      assert.ok(!paths.includes(multishellBin), "transient multishell bins must never be probed");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(multishell, { recursive: true, force: true });
    }
  });
});
