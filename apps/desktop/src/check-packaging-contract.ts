import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { allowedReactions } from "./local-ipc-protocol.js";
import { assertBundledOfficialPlugins, assertTargetSharpNative, assertUnpackedIntegrationRuntimes, getRequiredUnpackedRuntimePackageNames, type PackagingTarget, type PackagingPlatform } from "./packaging-contract.js";
import { assertNoForbiddenPackageOutput, walkPackageOutput } from "./packaging-output-contract.js";
import { pickReactionMessage, reactionMessagePools } from "./reaction-messages.js";

const distDir = dirname(fileURLToPath(import.meta.url));
const appDir = dirname(distDir);
const repoRoot = resolve(appDir, "../..");
const packageJson = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; description?: string; author?: string };
const rootPackageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> };
const workspaceConfig = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
const builderConfigPath = join(appDir, "electron-builder.yml");
const builderConfig = readFileSync(builderConfigPath, "utf8");

assert.equal(packageJson.description, "OpenPets tray-first desktop companion app.");
assert.equal(packageJson.author, "OpenPets");
assert.match(packageJson.scripts?.["dev:debug"] ?? "", /OPENPETS_LOG_LEVEL=debug OPENPETS_LOG_CONSOLE=1 pnpm dev/, "desktop debug dev script must enable verbose log mirroring.");
assert.match(packageJson.scripts?.package ?? "", /node scripts\/clean-package-output\.cjs && electron-builder/);
assert.match(packageJson.scripts?.["package:dir"] ?? "", /node scripts\/clean-package-output\.cjs && electron-builder --dir/);
assert.equal(rootPackageJson.scripts?.["package:desktop:dir"], "pnpm build && pnpm --filter @open-pets/desktop package:dir");
assert.equal(packageJson.dependencies?.["@open-pets/claude"], "workspace:*");
assert.equal(packageJson.dependencies?.["@open-pets/cli"], "workspace:*");
assert.equal(packageJson.dependencies?.["@open-pets/cursor"], "workspace:*");
assert.equal(packageJson.dependencies?.["@open-pets/mcp"], "workspace:*");
assert.equal(packageJson.dependencies?.["@open-pets/opencode"], "workspace:*");
assert.equal(packageJson.dependencies?.["@open-pets/zed"], "workspace:*");
assert.equal(packageJson.dependencies?.["@open-pets/agent-events"], "workspace:*");
assert.equal(packageJson.dependencies?.["@img/sharp-win32-x64"], undefined, "sharp platform binaries must stay optional transitive deps, not direct host-breaking dependencies.");
assert.match(workspaceConfig, /supportedArchitectures:[\s\S]*?os:[\s\S]*?- darwin[\s\S]*?- win32[\s\S]*?- linux/, "pnpm must install optional sharp binaries for desktop release OS targets.");
assert.match(workspaceConfig, /supportedArchitectures:[\s\S]*?cpu:[\s\S]*?- x64[\s\S]*?- arm64/, "pnpm must install optional sharp binaries for desktop release CPU targets.");
assert.match(workspaceConfig, /supportedArchitectures:[\s\S]*?libc:[\s\S]*?- glibc/, "pnpm must install optional sharp binaries for Linux glibc release targets.");
assert.match(packageJson.devDependencies?.["electron-builder"] ?? "", /^\^26\.(?:9|[1-9]\d)\./, "desktop AppImage packaging must use electron-builder 26.9+ for conditional Linux sandbox handling.");
assert.match(builderConfig, /appId:\s*dev\.openpets\.app/);
assert.match(builderConfig, /productName:\s*OpenPets/);
assert.match(builderConfig, /executableName:\s*openpets/, "desktop packages must use a safe executable name for the stricter AppImage toolset.");
assert.match(builderConfig, /output:\s*dist-electron/);
assert.match(builderConfig, /linux:[\s\S]*?target:[\s\S]*?- AppImage[\s\S]*?- deb[\s\S]*?- rpm[\s\S]*?- tar\.gz/, "desktop Linux packaging must include AppImage, deb, rpm, and tar.gz targets.");
assert.match(builderConfig, /publish:\s*null/);
assert.doesNotMatch(builderConfig, /no-sandbox/, "desktop packaging must not force --no-sandbox for every Linux AppImage launch.");
assert.match(builderConfig, /toolsets:\s*\n\s*appimage:\s*1\.0\.3/, "desktop AppImage packaging must use the AppImage 1.0.3 toolset so the launcher can conditionally fall back when Linux sandboxing is unavailable.");
assert.match(builderConfig, /asar:\s*true/);
assert.match(builderConfig, /asarUnpack:/);
assert.match(builderConfig, /node_modules\/\*\*/);
assert.match(builderConfig, /dist\/\*\*/);
assert.match(builderConfig, /control-center-preload\.cjs/);
assert.match(builderConfig, /plugin-sdk-preload\.cjs/);
assert.match(builderConfig, /plugin-command-form-preload\.cjs/);
assert.match(builderConfig, /voice-realtime-preload\.cjs/);
assert.match(builderConfig, /assets\/\*\*/);
assert.match(builderConfig, /extraResources:[\s\S]*from:\s*\.\.\/\.\.\/plugins\/official[\s\S]*to:\s*plugins\/official/, "desktop packages must include bundled official plugins as extra resources.");
assert.match(builderConfig, /icon:\s*assets\/app-icon\.icns/);

assert.ok(existsSync(join(appDir, "control-center-preload.cjs")), "control-center-preload.cjs must exist for Control Center IPC.");
const generatedPetPreloadPath = join(distDir, "pet-preload.cjs");
assert.ok(existsSync(generatedPetPreloadPath), "generated dist/pet-preload.cjs must exist for pet window motion state updates.");
assert.ok(existsSync(join(appDir, "plugin-sdk-preload.cjs")), "plugin-sdk-preload.cjs must exist for JavaScript plugin SDK hosting.");
assert.ok(existsSync(join(appDir, "plugin-command-form-preload.cjs")), "plugin-command-form-preload.cjs must exist for plugin command forms.");
assert.ok(existsSync(join(appDir, "voice-realtime-preload.cjs")), "voice-realtime-preload.cjs must exist for the private realtime voice renderer.");
assert.ok(existsSync(join(appDir, "assets", "tray-icon.png")), "tray icon must exist for packaging.");
assert.ok(existsSync(join(appDir, "assets", "app-icon.icns")), "app icon must exist for packaging.");
assert.ok(existsSync(join(appDir, "assets", "app-icon.ico")), "Windows app icon must exist for packaging.");
assertNonEmptyFile(join(appDir, "assets", "default-pet-spritesheet.webp"), "default pet spritesheet must exist for packaging.");
assertNonEmptyFile(join(appDir, "assets", "default-pet-thumbnail.png"), "default pet thumbnail must exist for Pet Manager preview.");
assertNonEmptyFile(join(appDir, "assets", "NotoColorEmoji.ttf"), "pet windows must bundle an emoji font so fresh Linux installs render plugin emoji icons.");
for (const icon of ["claude.svg", "cursor.svg", "opencode.svg", "pi.svg", "vscode.svg", "windsurf.svg", "zed.svg"]) {
  assertSafeBundledSvg(join(appDir, "assets", "integrations", icon), `integration icon must be safe and packaged: ${icon}`);
}
assert.ok(!existsSync(join(appDir, "src", "analytics.ts")), "desktop PostHog analytics module must be removed.");
for (const reaction of allowedReactions) {
  const pool = reactionMessagePools[reaction];
  assert.ok(pool.length >= 8, `reaction message pool must include clear variants for: ${reaction}`);
  for (const message of pool) {
    assert.match(message, /^[A-Z]/, `reaction message must start uppercase: ${message}`);
    assert.doesNotMatch(message, /[\r\n]/, `reaction message must be single-line: ${message}`);
    assert.ok(message.length <= 36, `reaction message must stay bubble-friendly: ${message}`);
  }
}
assert.equal(pickReactionMessage("success", () => 0), reactionMessagePools.success[0], "reaction message picking must be deterministic when random is injected.");
assert.ok(existsSync(join(appDir, "scripts", "clean-package-output.cjs")), "package output cleanup helper must exist.");
assert.ok(existsSync(join(appDir, "scripts", "check-windows-symlink-privilege.cjs")), "Windows package symlink preflight helper must exist.");
assert.ok(existsSync(join(distDir, "main.js")), "desktop main build output must exist before packaging checks run.");
assert.ok(existsSync(join(repoRoot, "packages", "claude", "dist", "index.js")), "@open-pets/claude must be built before packaging.");
assert.ok(existsSync(join(repoRoot, "packages", "client", "dist", "index.js")), "@open-pets/client must be built before packaging.");
assert.ok(existsSync(join(repoRoot, "packages", "mcp", "dist", "index.js")), "@open-pets/mcp must be built before packaging.");
assert.ok(existsSync(join(repoRoot, "packages", "cli", "dist", "index.js")), "@open-pets/cli must be built before packaging.");
assert.ok(existsSync(join(repoRoot, "packages", "opencode", "dist", "plugin.js")), "@open-pets/opencode plugin must be built before packaging.");
assert.ok(existsSync(join(repoRoot, "packages", "agent-events", "dist", "index.js")), "@open-pets/agent-events must be built before packaging.");

if (process.argv.includes("--output")) {
  checkPackageOutput(getOutputDirectoryArgument() ?? join(appDir, "dist-electron"), getPackagingTarget());
} else {
  checkCleanupHelper();
}

console.error("Packaging contract validation passed.");

function checkPackageOutput(outputDir: string, target: PackagingTarget): void {
  assert.ok(existsSync(outputDir), "dist-electron output must exist after packaging.");
  assertNoForbiddenPackageOutput(outputDir);
  assertNoEscapingSymlinks(outputDir);

  const appResourceDir = findPackagedAppResourceDir(outputDir);
  assert.ok(appResourceDir, "packaged app resources directory was not found.");
  assert.ok(existsSync(join(appResourceDir, "app.asar")), "packaged app.asar is missing.");
  assertBundledOfficialPlugins(appResourceDir, join(repoRoot, "plugins", "official"));
  const appContents = join(appResourceDir, "app.asar.unpacked");
  assert.ok(existsSync(appContents), "packaged app.asar.unpacked resources are missing.");
  assertUnpackedIntegrationRuntimes(appContents, getRequiredUnpackedRuntimePackageNames(packageJson), join(repoRoot, "packages"));
  assert.ok(existsSync(join(appContents, "node_modules", "@modelcontextprotocol", "sdk")), "packaged MCP SDK runtime dependency is missing.");
  assert.ok(existsSync(join(appContents, "node_modules", "zod", "index.cjs")), "packaged zod runtime dependency is missing.");
  assert.ok(existsSync(join(appContents, "node_modules", "yauzl", "index.js")), "packaged yauzl runtime dependency is missing.");
  assert.ok(existsSync(join(appContents, "node_modules", "yauzl", "fd-slicer.js")), "packaged yauzl fd-slicer helper is missing.");
  assert.ok(existsSync(join(appContents, "node_modules", "buffer-crc32", "index.js")), "packaged yauzl transitive dependency buffer-crc32 is missing.");
  assert.ok(existsSync(join(appContents, "node_modules", "pend", "index.js")), "packaged yauzl transitive dependency pend is missing.");
  assert.ok(existsSync(join(appContents, "node_modules", "jsonc-parser", "lib", "umd", "main.js")), "packaged Zed JSONC runtime dependency is missing.");
  assert.ok(existsSync(join(appContents, "node_modules", "sharp", "lib", "index.js")), "packaged sharp runtime is missing.");
  assertTargetSharpNative(appContents, target);
  assertRegularNonSymlink(join(appContents, "node_modules", "@open-pets", "mcp", "dist", "index.js"));
  assertRegularNonSymlink(join(appContents, "node_modules", "@open-pets", "cli", "dist", "index.js"));
  assertRegularNonSymlink(join(appContents, "node_modules", "@open-pets", "opencode", "dist", "plugin.js"));
  assertRegularNonSymlink(join(appContents, "node_modules", "@open-pets", "claude", "dist", "cli.js"));
  assertRegularNonSymlink(join(appContents, "node_modules", "@open-pets", "zed", "dist", "index.js"));
  assertCommandSmoke(appContents);
}

function findPackagedAppResourceDir(outputDir: string): string | null {
  const candidates: string[] = [];
  collectDirectories(outputDir, candidates, 4);

  for (const dir of candidates) {
    if (existsSync(join(dir, "app.asar")) || existsSync(join(dir, "app", "dist", "main.js"))) {
      return dir;
    }
  }

  return null;
}

function collectDirectories(dir: string, result: string[], depth: number): void {
  if (depth < 0 || !existsSync(dir)) return;
  result.push(dir);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) collectDirectories(join(dir, entry.name), result, depth - 1);
  }
}

function assertNoEscapingSymlinks(outputDir: string): void {
  const outputReal = realpathSync(outputDir);
  for (const path of walkPackageOutput(outputDir)) {
    const stat = lstatSync(path);
    if (!stat.isSymbolicLink()) continue;
    const target = realpathSync(path);
    assert.ok(isInside(outputReal, target), `package output symlink escapes package directory: ${relative(outputDir, path)} -> ${target}`);
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function checkCleanupHelper(): void {
  const sentinel = join(appDir, "dist-electron", ".openpets-clean-sentinel");
  mkdirSync(dirname(sentinel), { recursive: true });
  writeFileSync(sentinel, "stale", "utf8");
  const result = spawnSync(process.execPath, [join(appDir, "scripts", "clean-package-output.cjs")], { cwd: appDir, encoding: "utf8" });
  assert.equal(result.status, 0, `cleanup helper failed: ${result.stderr || result.stdout}`);
  assert.ok(!existsSync(sentinel), "cleanup helper did not remove stale package output sentinel.");
}

function assertRegularNonSymlink(path: string): void {
  assert.ok(!lstatSync(path).isSymbolicLink(), `packaged command file must not be a symlink: ${path}`);
  assert.ok(lstatSync(path).isFile(), `packaged command file must be regular: ${path}`);
}

function assertNonEmptyFile(path: string, message: string): void {
  assert.ok(existsSync(path), message);
  const stat = lstatSync(path);
  assert.ok(stat.isFile(), message);
  assert.ok(stat.size > 0, message);
}

function assertSafeBundledSvg(path: string, message: string): void {
  assertNonEmptyFile(path, message);
  const source = readFileSync(path, "utf8");
  assert.doesNotMatch(source, /<script\b/i, `${message}: script tags are not allowed.`);
  assert.doesNotMatch(source, /\son[a-z]+\s*=/i, `${message}: event attributes are not allowed.`);
  assert.doesNotMatch(source, /(?:href|xlink:href)\s*=\s*["'](?:https?:|file:|javascript:)/i, `${message}: external or script hrefs are not allowed.`);
  assert.doesNotMatch(source.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/gi, ""), /https?:\/\//i, `${message}: remote references are not allowed.`);
}

function assertCommandSmoke(appContents: string): void {
  const mcpEntry = join(appContents, "node_modules", "@open-pets", "mcp", "dist", "index.js");
  const mcp = spawnSync(process.execPath, [mcpEntry, "--version"], { encoding: "utf8" });
  assert.equal(mcp.status, 0, `packaged MCP command smoke failed: ${mcp.stderr || mcp.stdout}`);

  const hookEntry = join(appContents, "node_modules", "@open-pets", "claude", "dist", "cli.js");
  const hook = spawnSync(process.execPath, [hookEntry, "hook", "--openpets-managed"], {
    input: JSON.stringify({ hook_event_name: "Notification", message: "safe" }),
    encoding: "utf8",
    env: { ...process.env, OPENPETS_DISCOVERY_FILE: join(appContents, "missing-ipc.json") },
  });
  assert.equal(hook.status, 0, `packaged Claude hook command smoke failed: ${hook.stderr || hook.stdout}`);
  assert.equal(hook.stdout, "");

  const opencodePlugin = join(appContents, "node_modules", "@open-pets", "opencode", "dist", "plugin.js");
  const plugin = spawnSync(process.execPath, ["--input-type=module", "--eval", `const mod = await import(${JSON.stringify(`file://${opencodePlugin}`)}); if (!mod.default?.server || !mod.default?.id) process.exit(2);`], { encoding: "utf8" });
  assert.equal(plugin.status, 0, `packaged OpenCode plugin smoke failed: ${plugin.stderr || plugin.stdout}`);
}

function getOutputDirectoryArgument(): string | null {
  const argument = process.argv.find((value) => value.startsWith("--output-dir="));
  if (argument) return resolve(argument.slice("--output-dir=".length));
  const index = process.argv.indexOf("--output-dir");
  if (index !== -1 && process.argv[index + 1]) return resolve(process.argv[index + 1]);
  return null;
}

function getPackagingTarget(): PackagingTarget {
  const platform = getOptionValue("--platform") ?? process.platform;
  const arch = getOptionValue("--arch") ?? process.arch;
  assert.ok(platform === "darwin" || platform === "linux" || platform === "win32", `Unsupported packaging platform: ${platform}`);
  assert.ok(arch === "x64" || arch === "arm64", `Unsupported packaging architecture: ${arch}`);
  return { platform: platform as PackagingPlatform, arch: arch as "x64" | "arm64" };
}

function getOptionValue(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index !== -1 ? process.argv[index + 1] ?? null : null;
}
