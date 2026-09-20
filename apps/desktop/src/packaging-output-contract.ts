import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

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
