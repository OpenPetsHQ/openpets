import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describeOutputs, outputsIntact } from "./release-checkpoint.mjs";

const root = mkdtempSync(join(tmpdir(), "openpets-release-checkpoint-"));
const artifact = join(root, "OpenPets-linux-amd64.deb");
writeFileSync(artifact, Buffer.from("payload with a stable size\n", "utf8"));

try {
  const checkpoint = { outputs: describeOutputs(root, [artifact]) };
  assert.equal(outputsIntact(root, checkpoint), true, "an unchanged checkpoint remains reusable without rerunning payload validation");
  assert.equal(outputsIntact(root, { outputs: [{ ...checkpoint.outputs[0], digest: undefined }] }), false, "legacy size-only checkpoints are stale and must be revalidated");

  const mutated = readFileSync(artifact);
  mutated[0] ^= 0xff;
  writeFileSync(artifact, mutated);
  assert.equal(mutated.length, checkpoint.outputs[0].size, "the regression mutation must preserve artifact size");
  assert.equal(outputsIntact(root, checkpoint), false, "a same-size content mutation must stale the stage before tag/upload");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.error("Release checkpoint digest validation passed.");
