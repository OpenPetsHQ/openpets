import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Preferences, writePreferenceRecord } from "../src/host/preferences.js";
import { CompanionService } from "../src/host/companion-service.js";

test("independent pet references survive writes by stale windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-records-"));
  try {
    const first = new Preferences(root);
    const second = new Preferences(root);
    await Promise.all([first.initialize(), second.initialize()]);
    await first.setInstalled("cat", { generation: "one" });
    await second.setInstalled("dog", { generation: "two" });
    const restarted = new Preferences(root);
    await restarted.initialize();
    assert.deepEqual(restarted.installed("cat"), { generation: "one" });
    assert.deepEqual(restarted.installed("dog"), { generation: "two" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid individual records do not block valid records or the bundled companion", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-records-"));
  const diagnostics: string[] = [];
  try {
    const initial = new Preferences(root);
    await initial.initialize();
    await initial.setInstalled("dog", { generation: "valid" });
    await initial.setOutfit("dog", "hat");
    await writeFile(join(root, "preferences", "installed", "cat.json"), "");
    await writeFile(join(root, "preferences", "size.json"), "x".repeat(8193));
    await writeFile(join(root, "preferences", "outfits", "cat.json"), "{");
    await writeFile(
      join(root, "preferences", "selected.json"),
      JSON.stringify({ invalid: true }),
    );
    const preferences = new Preferences(root, undefined, (message) =>
      diagnostics.push(message),
    );
    const service = new CompanionService(preferences, "/builtin.webp");
    await service.initialize();
    assert.deepEqual(preferences.installed("dog"), { generation: "valid" });
    assert.equal(preferences.installed("cat"), undefined);
    assert.equal(preferences.outfit("dog"), "hat");
    assert.equal(preferences.outfit("cat"), "default");
    const snapshot = await service.getSnapshot();
    assert.equal(snapshot.active.petId, "builtin");
    assert.equal(snapshot.size, "medium");
    assert.ok(diagnostics.some((message) => message.includes("cat.json")));
    assert.ok(diagnostics.some((message) => message.includes("size.json")));
    assert.ok(diagnostics.some((message) => message.includes("selected.json")));
    await service.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed replacement stays uncommitted after a later unrelated setting write", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-records-"));
  let rejectReference = false;
  try {
    const preferences = new Preferences(root, async (path, value) => {
      if (rejectReference && path.endsWith(`${join("installed", "cat.json")}`))
        throw new Error("write rejected");
      await writePreferenceRecord(path, value);
    });
    await preferences.initialize();
    await preferences.setInstalled("cat", { generation: "old" });
    rejectReference = true;
    await assert.rejects(
      preferences.setInstalled("cat", { generation: "new" }),
    );
    await preferences.setSize("large");
    assert.deepEqual(preferences.installed("cat"), { generation: "old" });
    const restarted = new Preferences(root);
    await restarted.initialize();
    assert.deepEqual(restarted.installed("cat"), { generation: "old" });
    assert.equal(restarted.size, "large");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
