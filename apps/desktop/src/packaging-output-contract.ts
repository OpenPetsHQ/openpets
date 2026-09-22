import assert from "node:assert/strict";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

type PackagingPlatform = "darwin" | "linux" | "win32";

export function assertNoForbiddenPackageOutput(outputDir: string): void {
  for (const path of walkPackageOutput(outputDir)) {
    const rel = relative(outputDir, path);
    const segments = rel.split(/[\\/]/g);
    const isDependencyOutput = segments.includes("node_modules");

    for (const segment of segments) {
      assert.ok(!segment.startsWith(".env") && segment !== ".claude", `package output contains forbidden path segment: ${rel}`);
    }

    if (isDependencyOutput) continue;
    assert.ok(!segments.includes("docs") || !segments.includes("phases"), `package output must not include phase docs: ${rel}`);
    assert.ok(!segments.includes("v1") && !segments.includes("web"), `package output contains forbidden path segment: ${rel}`);
  }
}

export function walkPackageOutput(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    result.push(path);
    if (entry.isDirectory()) result.push(...walkPackageOutput(path));
  }
  return result;
}

export function assertNoEscapingPackageOutputSymlinks(outputDir: string, platform: PackagingPlatform): void {
  const outputReal = realpathSync(outputDir);
  for (const path of walkPackageOutput(outputDir)) {
    const stat = lstatSync(path);
    if (!stat.isSymbolicLink()) continue;

    const target = realpathSync(path);
    const rel = relative(outputDir, path);
    if (isExpectedMacDmgApplicationsAlias(rel, target, platform)) continue;
    assert.ok(isInside(outputReal, target), `package output symlink escapes package directory: ${rel} -> ${target}`);
  }
}

export function isExpectedMacDmgApplicationsAlias(relativePath: string, target: string, platform: PackagingPlatform): boolean {
  return platform === "darwin" && relativePath === "Applications" && target === "/Applications";
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
