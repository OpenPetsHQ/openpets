import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PackageInstallation } from "../src/host/package-installation.js";
import type { PreparedPetPackage } from "../src/host/pet-package-preparation.js";
import type { InstalledPet } from "../src/host/pet-store.js";
import type { Receipt } from "../src/host/asset-reference.js";
import type { CatalogPetV3 } from "@open-pets/pet-format/catalog-validation";
import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function setup() {
  const receipt: Receipt = { version: 2, id: "cat", packageId: "cat", sha256: "a".repeat(64), generation: "12345678-1234-4123-8123-123456789abc", source: { kind: "catalog", url: "https://zip.openpets.dev/pets/cat.zip" } };
  const prepared: PreparedPetPackage = { id: "cat", packageId: "cat", receipt, candidate: "/candidate", package: { metadata: { id: "cat", displayName: "Cat", description: "Cat", spritesheetPath: "spritesheet.webp" }, layout: getPetSpriteLayout({}), availableOutfitIds: [] } };
  const pet: CatalogPetV3 = { id: "cat", displayName: "Cat", description: "Cat", thumbnail: "https://openpets.dev/pets/cat.webp", spritesheet: "https://openpets.dev/pets/cat.webp", zip: "https://zip.openpets.dev/pets/cat.zip", category: "western", original: true };
  const installed: InstalledPet = { id: "cat", root: "/installed", receipt, package: prepared.package };
  let existing: Receipt | null = null;
  let picked: string | undefined = "/cat.zip";
  let confirmation = true;
  let preparedCount = 0;
  let discarded = 0;
  const confirmed: Array<{ targeted: boolean; replacingLocal: boolean }> = [];
  const commits: Array<string | null> = [];
  const petStore = {
    prepareCatalog: async () => { preparedCount++; return prepared; },
    prepareLocal: async () => { preparedCount++; return prepared; },
    commitPrepared: async (_candidate: PreparedPetPackage, expected: string | null) => { commits.push(expected); return installed; },
    discardPrepared: async () => { discarded++; },
  };
  const interactions = {
    pickZip: async () => picked,
    confirmReplacement: async (details: { targeted: boolean; replacingLocal: boolean }) => { confirmed.push(details); return confirmation; },
    openStudio: async () => {},
  };
  const coordinator = () => new PackageInstallation({ petStore, stateStore: { readAssetReference: async () => existing }, catalog: { find: async () => pet }, interactions });
  return { coordinator, petStore, interactions, receipt, prepared, installed, confirmed, commits, get preparedCount() { return preparedCount; }, get discarded() { return discarded; }, setExisting(value: Receipt | null) { existing = value; }, setPicked(value: string | undefined) { picked = value; }, setConfirmation(value: boolean) { confirmation = value; } };
}

test("cancellation and replacement policy preserve captured generation", async () => {
  const f = setup();
  const coordinator = f.coordinator();
  try {
    f.setPicked(undefined);
    assert.equal(await coordinator.importPackage(), null);
    assert.equal(f.preparedCount, 0);
    f.setPicked("/cat.zip");
    assert.equal(await coordinator.importPackage(), f.installed);
    assert.deepEqual(f.commits, [null]);
    f.setExisting(f.receipt);
    f.setConfirmation(false);
    assert.equal(await coordinator.importPackage(), null);
    assert.equal(f.discarded, 1);
    assert.equal(f.commits.length, 1);
    f.setConfirmation(true);
    await coordinator.importPackage("cat");
    assert.equal(f.confirmed.at(-1)?.targeted, true);
    assert.equal(f.commits.at(-1), f.receipt.generation);
    const count = f.confirmed.length;
    await coordinator.installCatalog("cat", false);
    assert.equal(f.confirmed.length, count);
    f.setExisting({ ...f.receipt, source: { kind: "local" } });
    await coordinator.installCatalog("cat", false);
    assert.equal(f.confirmed.at(-1)?.replacingLocal, true);
  } finally { await coordinator.dispose(); }
});

test("picker and confirmation do not hold shutdown or commit after disposal", async () => {
  const f = setup();
  const picker = deferred<string | undefined>();
  f.interactions.pickZip = () => picker.promise;
  const coordinator = f.coordinator();
  const pending = coordinator.importPackage();
  const rejected = assert.rejects(pending);
  assert.equal(coordinator.busy, false);
  await coordinator.dispose();
  picker.resolve("/late.zip");
  await rejected;
  assert.equal(f.preparedCount, 0);
  const g = setup();
  const confirm = deferred<boolean>();
  const reached = deferred<void>();
  g.setExisting(g.receipt);
  g.interactions.confirmReplacement = async () => { reached.resolve(); return confirm.promise; };
  const next = g.coordinator();
  const pendingConfirmation = next.importPackage();
  const rejectedConfirmation = assert.rejects(pendingConfirmation);
  await reached.promise;
  assert.equal(next.busy, true);
  await next.dispose();
  confirm.resolve(true);
  await rejectedConfirmation;
  assert.equal(g.commits.length, 0);
  assert.equal(g.discarded, 1);
});

test("queued preparation serializes and CAS conflict is not replayed", async () => {
  const f = setup();
  const gate = deferred<void>();
  const started = deferred<void>();
  let starts = 0;
  f.petStore.prepareLocal = async () => { starts++; started.resolve(); await gate.promise; return f.prepared; };
  f.petStore.commitPrepared = async () => { throw new Error("reference changed"); };
  const coordinator = f.coordinator();
  try {
    const first = coordinator.importPackage();
    const second = coordinator.importPackage();
    const failures = Promise.allSettled([first, second]);
    await started.promise;
    assert.equal(coordinator.busy, true);
    assert.equal(starts, 1);
    gate.resolve();
    assert.deepEqual((await failures).map((result) => result.status), ["rejected", "rejected"]);
    assert.equal(starts, 2);
    assert.equal(coordinator.busy, false);
  } finally { await coordinator.dispose(); }
});

test("disposal aborts preparation and drains it without committing", async () => {
  const f = setup();
  const started = deferred<void>();
  f.petStore.prepareLocal = async (_path?: string, _target?: string, signal?: AbortSignal) => {
    started.resolve();
    return await new Promise<PreparedPetPackage>((_resolve, reject) => {
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const coordinator = f.coordinator();
  const operation = coordinator.importPackage();
  const rejected = assert.rejects(operation);
  await started.promise;
  await coordinator.dispose();
  await rejected;
  assert.equal(f.commits.length, 0);
  assert.equal(coordinator.busy, false);
});

test("accepted commit drains on disposal and reports its successful result", async () => {
  const f = setup();
  const entered = deferred<void>();
  const commit = deferred<InstalledPet>();
  f.petStore.commitPrepared = async () => { entered.resolve(); return commit.promise; };
  const coordinator = f.coordinator();
  const operation = coordinator.importPackage();
  await entered.promise;
  let closed = false;
  const closing = coordinator.dispose().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  commit.resolve(f.installed);
  assert.equal(await operation, f.installed);
  await closing;
  assert.equal(f.discarded, 0);
});

test("request abort drains picker and confirmation without allowing late commits", async () => {
  const pickerFixture = setup();
  const picker = deferred<string | undefined>();
  pickerFixture.interactions.pickZip = () => picker.promise;
  const first = pickerFixture.coordinator();
  const pickerSignal = new AbortController();
  const pendingPicker = first.importPackage(undefined, pickerSignal.signal);
  const pickerRejected = assert.rejects(pendingPicker);
  pickerSignal.abort();
  await first.drain();
  picker.resolve("/late.zip");
  await pickerRejected;
  assert.equal(pickerFixture.preparedCount, 0);
  await first.dispose();

  const f = setup();
  f.setExisting(f.receipt);
  const confirmation = deferred<boolean>();
  const reached = deferred<void>();
  f.interactions.confirmReplacement = async () => { reached.resolve(); return confirmation.promise; };
  const coordinator = f.coordinator();
  const signal = new AbortController();
  const operation = coordinator.importPackage("cat", signal.signal);
  const rejected = assert.rejects(operation);
  await reached.promise;
  signal.abort();
  await coordinator.drain();
  confirmation.resolve(true);
  await rejected;
  assert.equal(f.commits.length, 0);
  assert.equal(f.discarded, 1);
  await coordinator.dispose();
});

test("an aborted queued request never begins preparation", async () => {
  const f = setup();
  const gate = deferred<void>();
  const started = deferred<void>();
  let starts = 0;
  f.petStore.prepareLocal = async () => { starts++; started.resolve(); await gate.promise; return f.prepared; };
  const coordinator = f.coordinator();
  const first = coordinator.importPackage();
  await started.promise;
  const signal = new AbortController();
  const second = coordinator.importPackage(undefined, signal.signal);
  const rejected = assert.rejects(second);
  signal.abort();
  gate.resolve();
  await first;
  await rejected;
  await coordinator.drain();
  assert.equal(starts, 1);
  await coordinator.dispose();
});

test("request abort during an entered commit waits for the actual outcome", async () => {
  const f = setup();
  const entered = deferred<void>();
  const commit = deferred<InstalledPet>();
  f.petStore.commitPrepared = async () => { entered.resolve(); return commit.promise; };
  const coordinator = f.coordinator();
  const signal = new AbortController();
  const operation = coordinator.installCatalog("cat", false, signal.signal);
  await entered.promise;
  signal.abort();
  let drained = false;
  const barrier = coordinator.drain().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(coordinator.busy, true);
  assert.equal(drained, false);
  commit.resolve(f.installed);
  assert.equal(await operation, f.installed);
  await barrier;
  assert.equal(coordinator.busy, false);
  await coordinator.dispose();
});

test("request abort during preparation drains cancellation", async () => {
  const f = setup();
  const entered = deferred<void>();
  f.petStore.prepareLocal = async (_path?: string, _target?: string, signal?: AbortSignal) => {
    entered.resolve();
    return await new Promise<PreparedPetPackage>((_resolve, reject) => {
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const coordinator = f.coordinator();
  const signal = new AbortController();
  const operation = coordinator.importPackage(undefined, signal.signal);
  const rejected = assert.rejects(operation);
  await entered.promise;
  signal.abort();
  await coordinator.drain();
  await rejected;
  assert.equal(f.commits.length, 0);
  assert.equal(coordinator.busy, false);
  await coordinator.dispose();
});

test("request abort during an entered commit preserves unknown outcome", async () => {
  const f = setup();
  const entered = deferred<void>();
  const commit = deferred<InstalledPet>();
  f.petStore.commitPrepared = async () => { entered.resolve(); return commit.promise; };
  const coordinator = f.coordinator();
  const signal = new AbortController();
  const operation = coordinator.installCatalog("cat", false, signal.signal);
  const unknown = new Error("unknown commit outcome");
  const rejected = assert.rejects(operation, (error: unknown) => error === unknown);
  await entered.promise;
  signal.abort();
  assert.equal(coordinator.busy, true);
  const barrier = coordinator.drain();
  commit.reject(unknown);
  await rejected;
  await barrier;
  assert.equal(f.discarded, 0);
  await coordinator.dispose();
});
