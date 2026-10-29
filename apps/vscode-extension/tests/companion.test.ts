import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
import type { CatalogPetV3 } from "@open-pets/pet-format/catalog-validation";
import { CompanionService } from "../src/host/companion-service.js";
import { Preferences } from "../src/host/preferences.js";
import { SceneStore } from "../src/host/scene-store.js";
import { PetStore, type InstalledPet } from "../src/host/pet-store.js";
import { CatalogService } from "../src/host/catalog-service.js";

const cat: CatalogPetV3 = { id: "cat", displayName: "Cat", description: "Cat", thumbnail: "https://openpets.dev/pets/cat.webp", spritesheet: "https://openpets.dev/pets/cat.webp", zip: "https://zip.openpets.dev/pets/cat.zip", category: "western", original: true };
const fixture: InstalledPet = {
  id: "cat", root: "/assets/cat",
  receipt: { version: 1, id: "cat", sha256: "a".repeat(64), generation: "fixture", url: cat.zip },
  package: { metadata: { id: "cat", displayName: "Cat", description: "Cat", spritesheetPath: "spritesheet.webp", wardrobe: { outfits: [{ id: "hat", displayName: "Hat", spritesheetPath: "outfits/hat.webp" }], schedule: [] } }, layout: getPetSpriteLayout({}), availableOutfitIds: ["hat"] },
};
async function setup(root: string) {
  const workerPath = join(root, "worker.cjs");
  await build({ entryPoints: [resolve("src/host/scene-worker.ts")], outfile: workerPath, bundle: true, platform: "node", format: "cjs", target: "node22" });
  const preferences = new Preferences(root);
  const catalog = new CatalogService(new AbortController().signal, {
    getIndex: async () => ({ version: 3, generatedAt: "2026-01-01", total: 1, pageSize: 1, search: "", filters: { categories: [] }, pages: [""] }),
    getSearch: async () => [{ id: "cat", displayName: "Cat", searchText: "cat", category: "western", catalogPage: 0, original: true }],
    getPage: async () => [cat],
  });
  const petStore = new PetStore(root, preferences);
  petStore.install = async () => fixture;
  petStore.load = async () => fixture;
  const makeService = () => new CompanionService(preferences, "/bundled.webp", root, () => {}, catalog, petStore, new SceneStore({ databasePath: join(root, "scene.sqlite"), workerPath }));
  return { makeService, workerPath, petStore, catalog, preferences };
}

test("install preserves scene; independent instances, stale mutations and empty restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-scene-service-"));
  let service: CompanionService | undefined;
  try {
    const { makeService } = await setup(root);
    service = makeService();
    await service.initialize();
    const before = await service.getSnapshot();
    const installed = await service.installPet("cat");
    assert.deepEqual(installed.instances, before.instances);
    assert.equal(installed.selectedInstanceId, before.selectedInstanceId);
    assert.ok(installed.installedPets.some((pet) => pet.id === "cat"));
    const first = (await service.addInstance("cat", "First")).selectedInstanceId!;
    const second = (await service.addInstance("cat", "Second")).selectedInstanceId!;
    const dressed = await service.setInstanceOutfit(first, "hat");
    assert.deepEqual(dressed.instances.filter((item) => item.petId === "cat").map((item) => [item.name, item.outfitId]), [["First", "hat"], ["Second", "default"]]);
    await service.removeInstance(first);
    await assert.rejects(service.renameInstance(first, "Resurrected"));
    await assert.rejects(service.setInstanceOutfit(first, "hat"));
    assert.ok(!(await service.getSnapshot()).instances.some((item) => item.id === first));
    for (const item of (await service.getSnapshot()).instances) await service.removeInstance(item.id);
    await service.dispose();
    service = makeService();
    await service.initialize();
    assert.deepEqual((await service.getSnapshot()).instances, []);
    assert.equal((await service.getSnapshot()).selectedInstanceId, null);
    assert.notEqual(first, second);
  } finally {
    await service?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("unavailable pet keeps identity and outfit while using bundled fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-scene-fallback-"));
  let service: CompanionService | undefined;
  try {
    const { makeService, workerPath } = await setup(root);
    const scene = new SceneStore({ databasePath: join(root, "scene.sqlite"), workerPath });
    try {
      await scene.initialize();
      await scene.mutate({ type: "addInstance", id: "missing-instance", petId: "missing", name: "Lost" });
      await scene.mutate({ type: "setInstanceOutfit", instanceId: "missing-instance", outfitId: "hat" });
    } finally { await scene.dispose(); }
    service = makeService();
    await service.initialize();
    const instance = (await service.getSnapshot()).instances.find((item) => item.id === "missing-instance")!;
    assert.equal(instance.petId, "missing");
    assert.equal(instance.outfitId, "hat");
    assert.equal(instance.appearance.fallback, true);
    assert.deepEqual(instance.appearance.sprite.uri, { kind: "local", path: "/bundled.webp" });
    assert.ok(instance.problem);
  } finally {
    await service?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("shutdown cancels active and queued installs and rejects later mutations", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-scene-shutdown-"));
  let service: CompanionService | undefined;
  try {
    const { makeService, petStore, preferences } = await setup(root);
    let attempts = 0;
    let started!: () => void;
    const active = new Promise<void>((resolve) => { started = resolve; });
    petStore.install = async (_pet, _wardrobe, signal) => {
      attempts++;
      started();
      return await new Promise<InstalledPet>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    service = makeService();
    await service.initialize();
    const install = service.installPet("cat");
    const queued = service.installPet("cat");
    const results = Promise.allSettled([install, queued]);
    await active;
    const closing = service.dispose();
    assert.equal(service.dispose(), closing);
    await assert.rejects(service.addInstance("builtin", "Late"), /disposed/);
    assert.throws(() => service!.onSnapshot(() => {}), /disposed/);
    const [settled] = await Promise.all([results, closing]);
    assert.deepEqual(settled.map((result) => result.status), ["rejected", "rejected"]);
    assert.equal(attempts, 1);
    assert.equal(preferences.installed("cat"), undefined);
  } finally {
    await service?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("shutdown drains an in-flight catalog list and rejects its late result", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-catalog-shutdown-"));
  let service: CompanionService | undefined;
  let release!: () => void;
  try {
    const { makeService, catalog } = await setup(root);
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const active = new Promise<void>((resolve) => { started = resolve; });
    const list = catalog.list.bind(catalog);
    catalog.list = async (...args) => {
      started();
      await gate;
      return list(...args);
    };
    service = makeService();
    await service.initialize();
    const listing = service.listCatalog("", 0);
    const rejected = assert.rejects(listing, /disposed/);
    await active;
    let closed = false;
    const closing = service.dispose().then(() => { closed = true; });
    await Promise.resolve();
    assert.equal(closed, false);
    release();
    await Promise.all([rejected, closing]);
    assert.equal(closed, true);
  } finally {
    release?.();
    await service?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
