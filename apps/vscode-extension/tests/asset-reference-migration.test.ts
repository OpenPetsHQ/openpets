import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readLegacyInstalledReferences } from "../src/host/asset-reference-migration.js";

test("legacy references migrate independently without altering source records", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-legacy-references-"));
  try {
    assert.deepEqual(await readLegacyInstalledReferences(root), { references: [], problems: [] });
    const dir = join(root, "preferences", "installed");
    await mkdir(dir, { recursive: true });
    const legacy = { version: 1, id: "cat", sha256: "a".repeat(64), generation: "12345678-1234-4123-8123-123456789abc", url: "https://zip.openpets.dev/pets/cat.zip" };
    const original = JSON.stringify(legacy);
    await writeFile(join(dir, "cat.json"), original);
    await writeFile(join(dir, "wrong.json"), original);
    await writeFile(join(dir, "Bad.json"), original);
    await writeFile(join(dir, "empty.json"), "");
    await writeFile(join(dir, "large.json"), "x".repeat(8193));
    await writeFile(join(dir, "broken.json"), "{");
    await writeFile(join(dir, "builtin.json"), original);
    await writeFile(join(dir, "untrusted.json"), JSON.stringify({ ...legacy, id: "untrusted", url: "https://example.com/pets/cat.zip" }));
    await writeFile(join(dir, "unknown.txt"), "ignored");
    await symlink(join(dir, "cat.json"), join(dir, "link.json"));
    const logs: string[] = [];
    const first = await readLegacyInstalledReferences(root, (message) => logs.push(message));
    assert.deepEqual(first.references, [{ version: 2, id: "cat", packageId: "cat", sha256: legacy.sha256, generation: legacy.generation, source: { kind: "catalog", url: legacy.url } }]);
    assert.deepEqual(first.problems.map((problem) => problem.id).sort(), ["broken", "builtin", "empty", "large", "link", "untrusted", "wrong"]);
    assert.ok(first.problems.every((problem) => problem.message.length > 0));
    for (const name of ["wrong", "Bad", "empty", "large", "broken", "link", "builtin", "untrusted"]) {
      assert.ok(logs.some((message) => message.includes(`${name}.json`)));
    }
    assert.ok(logs.some((message) => message.includes("unknown.txt")));
    assert.deepEqual(await readLegacyInstalledReferences(root), first);
    assert.equal(await readFile(join(dir, "cat.json"), "utf8"), original);
    assert.equal(await readFile(join(dir, "wrong.json"), "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid storage directory errors are not treated as an absent migration", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-legacy-root-"));
  try {
    await writeFile(join(root, "preferences"), "not a directory");
    await assert.rejects(readLegacyInstalledReferences(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
