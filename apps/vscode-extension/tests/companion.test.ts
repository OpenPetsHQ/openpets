import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
import type { CatalogPetV3 } from "@open-pets/pet-format/catalog-validation";
import { CompanionService } from "../src/host/companion-service.js";
import { CompanionStore } from "../src/host/companion-store.js";
import { PetStore, type InstalledPet } from "../src/host/pet-store.js";
import { CatalogService } from "../src/host/catalog-service.js";
import type { PreparedPetPackage } from "../src/host/pet-package-preparation.js";
import type { PackageInteractions } from "../src/host/package-interactions.js";
import { studioUrl } from "../src/host/studio-links.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Wardrobe } from "../src/webview/Wardrobe.js";

const cat: CatalogPetV3 = { id: "cat", displayName: "Cat", description: "Cat", thumbnail: "https://openpets.dev/pets/cat.webp", spritesheet: "https://openpets.dev/pets/cat.webp", zip: "https://zip.openpets.dev/pets/cat.zip", category: "western", original: true };
const fixture: InstalledPet = {
  id: "cat", root: "/assets/cat",
  receipt: { version: 2, id: "cat", packageId: "cat", sha256: "a".repeat(64), generation: "12345678-1234-4123-8123-123456789abc", source: { kind: "catalog", url: cat.zip } },
  package: { metadata: { id: "cat", displayName: "Cat", description: "Cat", spritesheetPath: "spritesheet.webp", wardrobe: { outfits: [{ id: "hat", displayName: "Hat", spritesheetPath: "outfits/hat.webp" }], schedule: [] } }, layout: getPetSpriteLayout({}), availableOutfitIds: ["hat"] },
};
async function setup(root: string) {
  const workerPath = join(root, "worker.cjs");
  await build({ entryPoints: [resolve("src/host/scene-worker.ts")], outfile: workerPath, bundle: true, platform: "node", format: "cjs", target: "node22" });
  const catalog = new CatalogService(new AbortController().signal, {
    getIndex: async () => ({ version: 3, generatedAt: "2026-01-01", total: 1, pageSize: 1, search: "", filters: { categories: [] }, pages: [""] }),
    getSearch: async () => [{ id: "cat", displayName: "Cat", searchText: "cat", category: "western", catalogPage: 0, original: true }],
    getPage: async () => [cat],
  });
  let stateStore = new CompanionStore({ databasePath: join(root, "scene.sqlite"), workerPath });
  const petStore = new PetStore(root, {
    readAssetReference: (id) => stateStore.readAssetReference(id),
    compareAndSwapAssetReference: (id, generation, receipt) => stateStore.compareAndSwapAssetReference(id, generation, receipt),
  });
  const prepared: PreparedPetPackage = { id: fixture.id, packageId: "cat", receipt: fixture.receipt, package: fixture.package, candidate: "/fixture" };
  petStore.prepareCatalog = async () => prepared;
  petStore.prepareLocal = async () => prepared;
  petStore.commitPrepared = async (candidate, generation) => {
    await stateStore.compareAndSwapAssetReference(candidate.id, generation, candidate.receipt);
    return fixture;
  };
  petStore.discardPrepared = async () => {};
  petStore.load = async () => fixture;
  const interactions: PackageInteractions = { pickZip: async () => undefined, confirmReplacement: async () => false, openStudio: async () => {} };
  const makeService = () => {
    stateStore = new CompanionStore({ databasePath: join(root, "scene.sqlite"), workerPath });
    return new CompanionService({ atlasPath: "/bundled.webp", storagePath: root, catalog, petStore, stateStore, interactions });
  };
  return { makeService, workerPath, petStore, catalog, interactions };
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

test("cancelled picker or denied replacement leaves scene and installation unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-import-cancel-"));
  let service: CompanionService | undefined;
  try {
    const { makeService, interactions } = await setup(root);
    service = makeService();
    await service.initialize();
    const before = await service.installPet("cat");
    assert.deepEqual(await service.importPetPackage(), { status: "cancelled" });
    interactions.pickZip = async () => "/cat.zip";
    assert.deepEqual(await service.importPetPackage("cat"), { status: "cancelled" });
    const after = await service.getSnapshot();
    assert.deepEqual(after.instances, before.instances);
    assert.equal(after.selectedInstanceId, before.selectedInstanceId);
    assert.ok(after.installedPets.some((pet) => pet.id === "cat"));
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
    const scene = new CompanionStore({ databasePath: join(root, "scene.sqlite"), workerPath });
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

test("offline startup falls back to bundled wardrobe when builtin override is corrupt", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-builtin-fallback-"));
  let service: CompanionService | undefined;
  try {
    const { makeService, workerPath, petStore, catalog, interactions } = await setup(root);
    const store = new CompanionStore({ databasePath: join(root, "scene.sqlite"), workerPath });
    try {
      const scene = await store.initialize();
      await store.initializeAssetReferences([]);
      await store.compareAndSwapAssetReference("builtin", null, {
        version: 2, id: "builtin", packageId: "hoodie-cat", sha256: "a".repeat(64),
        generation: "12345678-1234-4123-8123-123456789abc", source: { kind: "local" },
      });
      await store.mutate({ type: "setInstanceOutfit", instanceId: scene.instances[0].id, outfitId: "pajamas" });
    } finally { await store.dispose(); }
    petStore.load = async () => ({
      ...fixture,
      id: "builtin",
      receipt: { ...fixture.receipt, id: "builtin", packageId: "hoodie-cat", source: { kind: "local" } },
      package: {
        ...fixture.package,
        metadata: {
          ...fixture.package.metadata,
          wardrobe: { outfits: [
            { id: "hat", displayName: "Hat", spritesheetPath: "outfits/hat.webp" },
            { id: "coat", displayName: "Coat", spritesheetPath: "outfits/coat.webp" },
          ], schedule: [] },
        },
        availableOutfitIds: ["hat"],
        outfitProblems: ["coat: corrupt override"],
      },
    });
    catalog.find = async () => { throw new Error("offline"); };
    service = makeService();
    await service.initialize();
    const snapshot = await service.getSnapshot();
    const builtin = snapshot.installedPets.find((pet) => pet.id === "builtin")!;
    assert.equal(builtin.wardrobeSource, "bundled");
    assert.equal(builtin.hasLocalWardrobeOverride, true);
    assert.match(builtin.problem ?? "", /bundled outfits are in use/);
    assert.deepEqual(builtin.outfits.map((outfit) => outfit.id), ["default", "pajamas", "weekend", "halloween", "holidays", "summer"]);
    assert.equal(snapshot.instances[0].outfitId, "pajamas");
    assert.deepEqual(snapshot.instances[0].appearance.sprite.uri, { kind: "local", path: "/default-pet-outfits/pajamas.webp" });
    const projected = {
      ...snapshot,
      instances: snapshot.instances.map((instance) => ({ ...instance, appearance: { ...instance.appearance, sprite: { ...instance.appearance.sprite, uri: "local" } } })),
      installedPets: snapshot.installedPets.map((pet) => ({ ...pet, outfits: pet.outfits.map((outfit) => ({ ...outfit, sprite: { ...outfit.sprite, uri: "local" } })) })),
    };
    const markup = renderToStaticMarkup(createElement(Wardrobe, {
      snapshot: projected, pending: false, importing: false, wardrobeInstallingId: null,
      onGallery: () => {}, onCreateOutfit: () => {}, onImportPet: () => {},
      onSelectInstance: () => {}, onRefreshWardrobe: () => {}, onInstallWardrobe: () => {}, onSelectOutfit: () => {},
    }));
    assert.match(markup, /use your original ZIP or open an existing project/);
    let opened = "";
    interactions.openStudio = async (intent, pet) => { opened = studioUrl(intent, pet); };
    await service.openStudio("outfit", "builtin");
    assert.equal(opened, "https://openpets.dev/studio/import?view=wardrobe");
    await service.dispose();
    const verify = new CompanionStore({ databasePath: join(root, "scene.sqlite"), workerPath });
    try {
      await verify.initialize();
      assert.equal((await verify.readAssetReference("builtin"))?.source.kind, "local");
    } finally { await verify.dispose(); }
  } finally {
    await service?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("readiness ignores live dialogs but waits for detached operation drain", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-ready-drain-"));
  let service: CompanionService | undefined;
  let releasePicker!: (value: string | undefined) => void;
  let releaseConfirm!: (value: boolean) => void;
  let releaseDetached!: () => void;
  try {
    const { makeService, interactions } = await setup(root);
    service = makeService();
    await service.initialize();
    const picker = new Promise<string | undefined>((resolve) => { releasePicker = resolve; });
    interactions.pickZip = () => picker;
    const picking = service.importPetPackage();
    await service.waitForPackageOperations();
    assert.equal((await service.getSnapshot()).instances.length, 1);
    releasePicker(undefined);
    assert.deepEqual(await picking, { status: "cancelled" });

    let confirmEntered!: () => void;
    const entered = new Promise<void>((resolve) => { confirmEntered = resolve; });
    const confirmation = new Promise<boolean>((resolve) => { releaseConfirm = resolve; });
    interactions.pickZip = async () => "/pet.zip";
    interactions.confirmReplacement = async () => { confirmEntered(); return confirmation; };
    const confirming = service.importPetPackage("builtin");
    await entered;
    await service.waitForPackageOperations();
    assert.equal((await service.getSnapshot()).instances.length, 1);
    releaseConfirm(false);
    assert.deepEqual(await confirming, { status: "cancelled" });

    const detached = new Promise<void>((resolve) => { releaseDetached = resolve; });
    service.trackDetachedPackageOperations(detached);
    let ready = false;
    const wait = service.waitForPackageOperations().then(() => { ready = true; });
    await Promise.resolve();
    assert.equal(ready, false);
    releaseDetached();
    await wait;
    assert.equal(ready, true);
  } finally {
    releasePicker?.(undefined);
    releaseConfirm?.(false);
    releaseDetached?.();
    await service?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("detached entered commit blocks readiness until its actual outcome", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-detached-commit-"));
  let service: CompanionService | undefined;
  let release!: () => void;
  try {
    const { makeService, petStore } = await setup(root);
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const commit = petStore.commitPrepared.bind(petStore);
    petStore.commitPrepared = async (...args) => { entered(); await gate; return commit(...args); };
    service = makeService();
    await service.initialize();
    const signal = new AbortController();
    const operation = service.installPet("cat", signal.signal);
    await started;
    signal.abort();
    const detached = operation.then(() => undefined, () => undefined);
    service.trackDetachedPackageOperations(detached);
    let ready = false;
    const barrier = service.waitForPackageOperations().then(() => { ready = true; });
    await Promise.resolve();
    assert.equal(ready, false);
    await assert.rejects(service.addInstance("builtin", "Late"), /installation is in progress/);
    release();
    await operation;
    await barrier;
    assert.equal(ready, true);
  } finally {
    release?.();
    await service?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("shutdown cancels active and queued installs and rejects later mutations", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-scene-shutdown-"));
  let service: CompanionService | undefined;
  try {
    const { makeService, petStore, workerPath } = await setup(root);
    let attempts = 0;
    let started!: () => void;
    const active = new Promise<void>((resolve) => { started = resolve; });
    petStore.prepareCatalog = async (_pet, _wardrobe, signal) => {
      attempts++;
      started();
      return await new Promise<PreparedPetPackage>((_resolve, reject) => {
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
    const reopened = new CompanionStore({ databasePath: join(root, "scene.sqlite"), workerPath });
    try {
      await reopened.initialize();
      assert.equal(await reopened.readAssetReference("cat"), null);
    } finally { await reopened.dispose(); }
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
