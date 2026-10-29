import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Memento } from "vscode";
import { CompanionService } from "../src/host/companion-service.js";
import { Preferences } from "../src/host/preferences.js";

test("offline initialization preserves an unavailable choice and reports bundled fallback", async () => {
  const values = new Map<string, unknown>([
    ["openpets.selectedPetId", "missing"],
  ]);
  const state: Memento = {
    keys: () => [...values.keys()],
    get: <T>(key: string, defaultValue?: T) =>
      (values.get(key) as T | undefined) ?? defaultValue,
    update: async (key, value) => {
      values.set(key, value);
    },
  };
  const service = new CompanionService(new Preferences(state), "/bundled.webp");
  await service.initialize();
  const snapshot = await service.getSnapshot();
  assert.equal(snapshot.selectedPetId, "missing");
  assert.equal(snapshot.active.petId, "builtin");
  assert.ok(snapshot.notice);
  assert.equal(snapshot.active.sprite.layout.version, 2);
  await assert.rejects(service.installPet("missing"), /not available/);
  assert.equal((await service.getSnapshot()).selectedPetId, "missing");
  await service.dispose();
});

test("shutdown drains accepted writes and rejects later mutations and subscriptions", async () => {
  const values = new Map<string, unknown>();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state: Memento = {
    keys: () => [...values.keys()],
    get: <T>(key: string, defaultValue?: T) =>
      (values.get(key) as T | undefined) ?? defaultValue,
    update: async (key, value) => {
      await pending;
      values.set(key, value);
    },
  };
  const service = new CompanionService(new Preferences(state), "/bundled.webp");
  const accepted = service.setSize("small");
  const shutdown = service.dispose();
  assert.equal(service.dispose(), shutdown);
  await assert.rejects(service.setSize("large"), /disposed/);
  await assert.rejects(service.installPet("cat"), /disposed/);
  assert.throws(() => service.onSnapshot(() => {}), /disposed/);
  release();
  await Promise.all([accepted, shutdown]);
  assert.equal(values.get("openpets.size"), "small");
  await assert.rejects(service.setSize("large"), /disposed/);
});
