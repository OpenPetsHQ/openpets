import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { bundledOfficialPluginIds } from "./bundled-plugins.js";

type JsonRecord = Record<string, unknown>;

export type PackagingPlatform = "darwin" | "linux" | "win32";
export type PackagingTarget = { readonly platform: PackagingPlatform; readonly arch: "x64" | "arm64" };

export function getRequiredUnpackedRuntimePackageNames(packageJson: { dependencies?: Record<string, string> }): string[] {
  return Object.keys(packageJson.dependencies ?? {})
    .filter((name) => name.startsWith("@open-pets/"))
    .sort();
}

export function getTargetSharpPackageName(target: PackagingTarget): string {
  return `sharp-${target.platform}-${target.arch}`;
}

export function assertTargetSharpNative(appContents: string, target: PackagingTarget): void {
  const packageName = getTargetSharpPackageName(target);
  const nativePath = join(appContents, "node_modules", "@img", packageName, "lib", `${packageName}.node`);
  assertNonEmptyFile(nativePath, `packaged target Sharp native runtime is missing: ${target.platform}/${target.arch} (${packageName})`);
}

export function assertBundledOfficialPlugins(resourceDir: string, sourceDir: string): void {
  for (const id of bundledOfficialPluginIds) {
    const sourcePluginDir = join(sourceDir, id);
    const packagedPluginDir = join(resourceDir, "plugins", "official", id);
    const sourceManifest = readManifest(join(sourcePluginDir, "openpets.plugin.json"), `canonical bundled plugin manifest is missing: ${id}`);
    const packagedManifestPath = join(packagedPluginDir, "openpets.plugin.json");
    const packagedManifest = readManifest(packagedManifestPath, `packaged bundled plugin manifest is missing: ${id}`);

    assert.equal(sourceManifest.id, id, `canonical bundled plugin manifest has the wrong id: ${id}`);
    assert.equal(packagedManifest.id, id, `packaged bundled plugin manifest has the wrong id: ${id}`);
    assert.equal(packagedManifest.entry, sourceManifest.entry, `packaged bundled plugin entry drifted from the canonical source: ${id}`);

    if (sourceManifest.entry) {
      assertNonEmptyFile(join(packagedPluginDir, sourceManifest.entry), `packaged bundled plugin entry is missing: ${id}`);
    }

    const sourceAssets = collectDeclaredAssetPaths(sourceManifest.assets);
    const packagedAssets = new Set(collectDeclaredAssetPaths(packagedManifest.assets));
    for (const assetPath of sourceAssets) {
      assert.ok(packagedAssets.has(assetPath), `packaged bundled plugin asset declaration is missing: ${id}/${assetPath}`);
    }
    for (const assetPath of packagedAssets) {
      assertNonEmptyFile(join(packagedPluginDir, assetPath), `packaged bundled plugin asset is missing: ${id}/${assetPath}`);
    }

    const sourceLocales = listLocaleFiles(sourcePluginDir);
    assert.ok(sourceLocales.includes("en.json"), `canonical bundled plugin English locale is missing: ${id}`);
    for (const locale of sourceLocales) {
      const packagedLocale = join(packagedPluginDir, "locales", locale);
      assertNonEmptyFile(packagedLocale, `packaged bundled plugin locale is missing: ${id}/${locale}`);
      parseJson(packagedLocale, `packaged bundled plugin locale is invalid: ${id}/${locale}`);
    }
    for (const locale of listLocaleFiles(packagedPluginDir)) {
      parseJson(join(packagedPluginDir, "locales", locale), `packaged bundled plugin locale is invalid: ${id}/${locale}`);
    }
  }
}

export function assertUnpackedIntegrationRuntimes(appContents: string, packageNames: readonly string[], sourcePackagesDir?: string): void {
  for (const packageName of packageNames) {
    const packageDir = join(appContents, "node_modules", ...packageName.split("/"));
    assertRegularNonSymlink(packageDir, `packaged ${packageName} runtime directory is missing`);
    const packageJsonPath = join(packageDir, "package.json");
    const packageJson = parseJson(packageJsonPath, `packaged ${packageName} package metadata is missing`) as JsonRecord;
    const runtimePaths = new Set(collectRuntimePaths(packageJson));
    for (const runtimePath of collectPublishedRuntimeFiles(packageDir, packageJson)) runtimePaths.add(runtimePath);
    if (sourcePackagesDir) {
      const sourcePackageDir = join(sourcePackagesDir, packageName.slice("@open-pets/".length));
      const sourcePackageJson = parseJson(join(sourcePackageDir, "package.json"), `canonical ${packageName} package metadata is missing`) as JsonRecord;
      for (const runtimePath of collectRuntimePaths(sourcePackageJson)) runtimePaths.add(runtimePath);
      for (const runtimePath of collectPublishedRuntimeFiles(sourcePackageDir, sourcePackageJson)) runtimePaths.add(runtimePath);
    }
    assert.ok(runtimePaths.size > 0, `packaged ${packageName} does not declare a runtime entry`);
    for (const runtimePath of runtimePaths) {
      assertSafeRelativePath(runtimePath, `${packageName} runtime entry`);
      assertRegularNonSymlink(join(packageDir, runtimePath), `packaged ${packageName} runtime is missing: ${runtimePath}`);
    }
  }
}

function collectPublishedRuntimeFiles(packageDir: string, packageJson: JsonRecord): string[] {
  const paths: string[] = [];
  const publishedFiles = Array.isArray(packageJson.files) ? packageJson.files : ["dist"];
  for (const publishedFile of publishedFiles) {
    if (typeof publishedFile !== "string") continue;
    const absolutePath = join(packageDir, publishedFile);
    collectJavaScriptFiles(absolutePath, packageDir, paths);
  }
  return paths;
}

function collectJavaScriptFiles(path: string, packageDir: string, result: string[]): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    if (/\.(?:cjs|js|mjs)$/u.test(path)) result.push(path.slice(packageDir.length + 1));
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(path)) collectJavaScriptFiles(join(path, entry), packageDir, result);
}

function readManifest(path: string, message: string): JsonRecord & { id?: string; entry?: string; assets?: unknown } {
  assertNonEmptyFile(path, message);
  return parseJson(path, message) as JsonRecord & { id?: string; entry?: string; assets?: unknown };
}

function parseJson(path: string, message: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function listLocaleFiles(pluginDir: string): string[] {
  const localeDir = join(pluginDir, "locales");
  try {
    return readdirSync(localeDir).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

function collectDeclaredAssetPaths(value: unknown, paths: string[] = []): string[] {
  if (typeof value === "string") {
    paths.push(value);
    return paths;
  }
  if (!value || typeof value !== "object") return paths;
  for (const [key, child] of Object.entries(value)) {
    if (key === "path" && typeof child === "string") paths.push(child);
    else collectDeclaredAssetPaths(child, paths);
  }
  return paths;
}

function collectRuntimePaths(packageJson: JsonRecord): string[] {
  const paths = new Set<string>();
  if (typeof packageJson.main === "string") paths.add(packageJson.main);
  collectBinPaths(packageJson.bin, paths);
  collectExportPaths(packageJson.exports, paths);
  return [...paths].filter((path) => !path.endsWith(".d.ts")).sort();
}

function collectBinPaths(value: unknown, paths: Set<string>): void {
  if (typeof value === "string") paths.add(value);
  else if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectBinPaths(child, paths);
  }
}

function collectExportPaths(value: unknown, paths: Set<string>, condition?: string): void {
  if (typeof value === "string") {
    if (condition !== "types") paths.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectExportPaths(child, paths, condition);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) collectExportPaths(child, paths, key === "types" ? "types" : condition);
}

function assertSafeRelativePath(path: string, description: string): void {
  assert.ok(path.length > 0 && !isAbsolute(path) && !path.split(/[\\/]/u).includes(".."), `${description} escapes its package: ${path}`);
}

function assertNonEmptyFile(path: string, message: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Error(message);
  }
  assert.ok(stat.isFile() && stat.size > 0 && !stat.isSymbolicLink(), message);
}

function assertRegularNonSymlink(path: string, message: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Error(message);
  }
  assert.ok(!stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()), message);
}
