import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompanionService } from "../src/host/companion-service.js";
import { Preferences, writePreferenceRecord } from "../src/host/preferences.js";

test("offline initialization preserves an unavailable choice and reports bundled fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-preference-"));
  try {
    const preferences = new Preferences(root);
    await preferences.initialize();
    await preferences.setPet("missing");
    const service = new CompanionService(preferences, "/bundled.webp");
    await service.initialize();
    const snapshot = await service.getSnapshot();
    assert.equal(snapshot.selectedPetId, "missing");
    assert.equal(snapshot.active.petId, "builtin");
    assert.ok(snapshot.notice);
    assert.equal(snapshot.active.sprite.layout.version, 2);
    await assert.rejects(service.installPet("missing"));
    assert.equal((await service.getSnapshot()).selectedPetId, "missing");
    await service.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shutdown drains accepted writes and rejects later mutations and subscriptions", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-preference-"));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const preferences = new Preferences(root, async (path, value) => {
      await pending;
      await writePreferenceRecord(path, value);
    });
    const service = new CompanionService(preferences, "/bundled.webp");
    await service.initialize();
    const accepted = service.setSize("small");
    const shutdown = service.dispose();
    assert.equal(service.dispose(), shutdown);
    await assert.rejects(service.setSize("large"), /disposed/);
    await assert.rejects(service.installPet("cat"), /disposed/);
    assert.throws(() => service.onSnapshot(() => {}), /disposed/);
    release();
    await Promise.all([accepted, shutdown]);
    assert.equal(preferences.size, "small");
    await assert.rejects(service.setSize("large"), /disposed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
