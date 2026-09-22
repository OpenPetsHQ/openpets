import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function describeOutputs(repoRoot, outputs) {
  return outputs.map((filePath) => ({
    name: filePath.startsWith(repoRoot) ? filePath.slice(repoRoot.length + 1) : filePath,
    size: statSync(filePath).size,
    digest: sha256(filePath),
  }));
}

export function outputsIntact(repoRoot, record) {
  if (!record) return false;
  for (const output of record.outputs || []) {
    let stat;
    try {
      stat = statSync(join(repoRoot, output.name));
    } catch {
      return false;
    }
    if (!stat.isFile() || stat.size !== output.size || typeof output.digest !== "string" || sha256(join(repoRoot, output.name)) !== output.digest) return false;
  }
  return true;
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}
