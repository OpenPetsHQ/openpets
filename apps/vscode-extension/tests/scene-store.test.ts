import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import {
  SceneMutationOutcomeUnknownError,
  CompanionStore,
} from "../src/host/companion-store.js";

const fixture = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = workerData.databasePath;
function read() { return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : {version:1,instances:[{id:'seed',petId:'builtin',name:'Hoodie Cat',outfitId:'default'}],selectedInstanceId:'seed',settings:{size:'medium',motion:'calm',paused:false,backdrop:'dots'}}; }
parentPort.on('message', (request) => {
  if (request.operation === 'close') { parentPort.postMessage({id:request.id,ok:true}); parentPort.close(); return; }
  if (request.operation === 'mutate') {
    if (request.command.id === 'failure') { parentPort.postMessage({id:request.id,ok:false,error:{message:'rejected'}}); return; }
    const scene=read(); scene.instances.push({id:request.command.id,petId:'cat',name:'Cat',outfitId:'default'}); scene.selectedInstanceId=request.command.id;
    fs.writeFileSync(path, JSON.stringify(scene));
    if (request.command.id === 'lost') process.exit(2);
    setTimeout(() => parentPort.postMessage({id:request.id,ok:true,scene}), 15); return;
  }
  parentPort.postMessage({id:request.id,ok:true,scene:read()});
});`;

test("lost asset CAS reply fences mutations until explicit recovery without replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "asset-driver-"));
  const workerPath = join(dir, "worker.cjs");
  const assetFixture = fixture.replace(
    "if (request.operation === 'mutate') {",
    `
    if (request.operation === 'initializeAssets' || request.operation === 'listAssetReferences') { parentPort.postMessage({id:request.id,ok:true,references:[],problems:[]}); return; }
    if (request.operation === 'assetReferencesInitialized') { parentPort.postMessage({id:request.id,ok:true,initialized:true}); return; }
    if (request.operation === 'readAssetReference') { parentPort.postMessage({id:request.id,ok:true,reference:null}); return; }
    if (request.operation === 'compareAndSwapAssetReference') process.exit(2);
    if (request.operation === 'mutate') {`,
  );
  await writeFile(workerPath, assetFixture);
  const store = new CompanionStore({
    workerPath,
    databasePath: join(dir, "scene.json"),
  });
  const receipt = {
    version: 2 as const,
    id: "cat",
    packageId: "cat",
    sha256: "a".repeat(64),
    generation: "00000000-0000-4000-8000-000000000001",
    source: { kind: "local" as const },
  };
  try {
    await store.initialize();
    assert.deepEqual(await store.initializeAssetReferences([]), { references: [], problems: [] });
    await assert.rejects(
      store.compareAndSwapAssetReference("cat", null, receipt),
      SceneMutationOutcomeUnknownError,
    );
    await assert.rejects(
      store.compareAndSwapAssetReference("cat", null, receipt),
      /fresh read/,
    );
    assert.equal(await store.readAssetReference("cat"), null);
    assert.equal(await store.assetReferencesInitialized(), true);
    assert.deepEqual(await store.listAssetReferences(), { references: [], problems: [] });
    await store.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("driver reads and writes through the real SQLite worker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-driver-sqlite-"));
  let store: CompanionStore | undefined;
  try {
    const workerPath = join(dir, "scene-worker.cjs");
    await build({
      entryPoints: [resolve("src/host/scene-worker.ts")],
      outfile: workerPath,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
    });
    store = new CompanionStore({
      workerPath,
      databasePath: join(dir, "scene.sqlite"),
    });
    const initial = await store.initialize();
    assert.equal(initial.instances.length, 1);
    assert.equal(await store.assetReferencesInitialized(), false);
    const receipt = {
      version: 2 as const,
      id: "cat",
      packageId: "cat",
      sha256: "a".repeat(64),
      generation: "00000000-0000-4000-8000-000000000001",
      source: { kind: "local" as const },
    };
    const blocked = { id: "blocked", message: "Legacy receipt is invalid." };
    assert.deepEqual(await store.initializeAssetReferences([receipt], [blocked]), { references: [receipt], problems: [blocked] });
    assert.equal(await store.assetReferencesInitialized(), true);
    assert.deepEqual(await store.initializeAssetReferences([], []), { references: [receipt], problems: [blocked] });
    const db = new DatabaseSync(join(dir, "scene.sqlite"));
    db.prepare("INSERT INTO asset_references (id, json) VALUES (?, ?)").run("corrupt", "not json");
    db.close();
    const listing = await store.listAssetReferences();
    assert.deepEqual(listing.references, [receipt]);
    assert.deepEqual(listing.problems.map((problem) => problem.id), ["blocked", "corrupt"]);
    assert.equal(listing.problems[0].message, blocked.message);
    await assert.rejects(store.readAssetReference("corrupt"));
    await assert.rejects(store.compareAndSwapAssetReference("corrupt", null, { ...receipt, id: "corrupt", packageId: "corrupt" }));
    assert.deepEqual(
      await store.compareAndSwapAssetReference("cat", receipt.generation, receipt),
      receipt,
    );
    assert.deepEqual(await store.readAssetReference("cat"), receipt);
    assert.deepEqual((await store.listAssetReferences()).references, [receipt]);
    await assert.rejects(
      store.compareAndSwapAssetReference("cat", null, receipt),
      /conflict|changed/i,
    );
    const updated = await store.mutate({
      type: "addInstance",
      id: "cat1",
      petId: "cat",
      name: "Cat",
    });
    assert.equal(updated.selectedInstanceId, "cat1");
    assert.equal((await store.read()).instances.length, 2);
    await store.dispose();
  } finally {
    await store?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("accepted commands drain in order and shutdown closes admission", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-driver-"));
  try {
    const workerPath = join(dir, "worker.cjs");
    await writeFile(workerPath, fixture);
    const store = new CompanionStore({
      workerPath,
      databasePath: join(dir, "scene.json"),
    });
    await store.initialize();
    const first = store.mutate({
      type: "addInstance",
      id: "one",
      petId: "cat",
      name: "Cat",
    });
    const second = store.mutate({
      type: "addInstance",
      id: "two",
      petId: "cat",
      name: "Cat",
    });
    const closing = store.dispose();
    assert.equal(store.dispose(), closing);
    await assert.rejects(store.read(), /disposed/);
    assert.equal((await first).selectedInstanceId, "one");
    assert.deepEqual(
      (await second).instances.map((item) => item.id),
      ["seed", "one", "two"],
    );
    await closing;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lost mutation reply is unknown; queued mutations are not replayed and explicit read recovers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-driver-"));
  try {
    const workerPath = join(dir, "worker.cjs");
    await writeFile(workerPath, fixture);
    const store = new CompanionStore({
      workerPath,
      databasePath: join(dir, "scene.json"),
    });
    await store.initialize();
    await assert.rejects(
      store.mutate({
        type: "addInstance",
        id: "failure",
        petId: "cat",
        name: "Cat",
      }),
      /rejected/,
    );
    const lost = store.mutate({
      type: "addInstance",
      id: "lost",
      petId: "cat",
      name: "Cat",
    });
    const queued = store.mutate({
      type: "addInstance",
      id: "queued",
      petId: "cat",
      name: "Cat",
    });
    const results = await Promise.allSettled([lost, queued]);
    assert.equal(results[0].status, "rejected");
    if (results[0].status === "rejected")
      assert.ok(results[0].reason instanceof SceneMutationOutcomeUnknownError);
    assert.equal(results[1].status, "rejected");
    const recovered = await store.read();
    assert.deepEqual(
      recovered.instances.map((item) => item.id),
      ["seed", "lost"],
    );
    const next = await store.mutate({
      type: "addInstance",
      id: "next",
      petId: "cat",
      name: "Cat",
    });
    assert.deepEqual(
      next.instances.map((item) => item.id),
      ["seed", "lost", "next"],
    );
    await store.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("worker replacement cannot reseed an externally deleted scene", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-recovery-"));
  let store: CompanionStore | undefined;
  try {
    const real = join(dir, "real.cjs");
    const wrapper = join(dir, "wrapper.cjs");
    const databasePath = join(dir, "scene.sqlite");
    await build({
      entryPoints: [resolve("src/host/scene-worker.ts")],
      outfile: real,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
    });
    await writeFile(
      wrapper,
      `
      const {parentPort, workerData, Worker} = require('node:worker_threads');
      const child = new Worker(${JSON.stringify(real)}, {workerData});
      child.on('message', message => parentPort.postMessage(message));
      parentPort.on('message', message => {
        if (message.operation === 'mutate') process.exit(2);
        child.postMessage(message);
      });
    `,
    );
    store = new CompanionStore({ databasePath, workerPath: wrapper });
    await store.initialize();
    const db = new DatabaseSync(databasePath);
    db.exec("DELETE FROM scene WHERE id = 1");
    db.close();
    await assert.rejects(
      store.mutate({
        type: "addInstance",
        id: "lost",
        petId: "cat",
        name: "Cat",
      }),
      SceneMutationOutcomeUnknownError,
    );
    await assert.rejects(store.assetReferencesInitialized());
    await assert.rejects(store.listAssetReferences());
    const check = new DatabaseSync(databasePath);
    assert.equal(
      check.prepare("SELECT json FROM scene WHERE id = 1").get(),
      undefined,
    );
    check.close();
  } finally {
    await store?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed asset replies fail closed and initialization remains outcome-unknown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "asset-driver-invalid-"));
  let store: CompanionStore | undefined;
  try {
    const workerPath = join(dir, "worker.cjs");
    await writeFile(workerPath, fixture.replace(
      "if (request.operation === 'mutate') {",
      `if (request.operation === 'assetReferencesInitialized') { parentPort.postMessage({id:request.id,ok:true,initialized:'yes'}); return; }
       if (request.operation === 'listAssetReferences') { parentPort.postMessage({id:request.id,ok:true,references:[]}); return; }
       if (request.operation === 'initializeAssets') { parentPort.postMessage({id:request.id,ok:true,references:[],problems:[{id:'cat',message:'x'.repeat(501)}]}); return; }
       if (request.operation === 'mutate') {`,
    ));
    store = new CompanionStore({ workerPath, databasePath: join(dir, "scene.json") });
    await store.initialize();
    await assert.rejects(store.assetReferencesInitialized(), /Invalid asset initialization status/);
    await assert.rejects(store.listAssetReferences(), /Invalid asset references/);
    await assert.rejects(store.initializeAssetReferences([]), SceneMutationOutcomeUnknownError);
    await assert.rejects(store.initializeAssetReferences([]), /fresh read/);
    await store.read();
  } finally {
    await store?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a new store rejects a missing row in an existing scene schema", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-restart-missing-"));
  let store: CompanionStore | undefined;
  try {
    const workerPath = join(dir, "worker.cjs");
    const databasePath = join(dir, "scene.sqlite");
    await build({
      entryPoints: [resolve("src/host/scene-worker.ts")],
      outfile: workerPath,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
    });
    store = new CompanionStore({ databasePath, workerPath });
    await store.initialize();
    await store.dispose();
    const db = new DatabaseSync(databasePath);
    db.exec("DELETE FROM scene WHERE id = 1");
    db.close();
    store = new CompanionStore({ databasePath, workerPath });
    await assert.rejects(store.initialize(), /missing or invalid/);
    const check = new DatabaseSync(databasePath);
    assert.equal(
      check.prepare("SELECT json FROM scene WHERE id = 1").get(),
      undefined,
    );
    check.close();
  } finally {
    await store?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("rollback failure fences the connection and requires recovery before another mutation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-poison-"));
  let store: CompanionStore | undefined;
  const logs: string[] = [];
  try {
    const workerPath = join(dir, "worker.cjs");
    const poisonedFixture = fixture.replace(
      "if (request.command.id === 'failure')",
      "if (request.command.id === 'poison') { parentPort.postMessage({id:request.id,ok:false,error:{kind:'connection-failed',message:'write failed (rollback failed: disk error)'}}); return; }\n    if (request.command.id === 'failure')",
    );
    await writeFile(workerPath, poisonedFixture);
    store = new CompanionStore({
      workerPath,
      databasePath: join(dir, "scene.json"),
      log: (message) => logs.push(message),
    });
    await store.initialize();
    await assert.rejects(
      store.mutate({
        type: "addInstance",
        id: "poison",
        petId: "cat",
        name: "Cat",
      }),
      SceneMutationOutcomeUnknownError,
    );
    await assert.rejects(
      store.mutate({
        type: "addInstance",
        id: "blocked",
        petId: "cat",
        name: "Cat",
      }),
      /fresh read/,
    );
    assert.ok(
      logs.some(
        (message) =>
          message.includes("write failed") &&
          message.includes("rollback failed"),
      ),
    );
    const recovered = await store.read();
    assert.deepEqual(
      recovered.instances.map((item) => item.id),
      ["seed"],
    );
    const next = await store.mutate({
      type: "addInstance",
      id: "next",
      petId: "cat",
      name: "Cat",
    });
    assert.deepEqual(
      next.instances.map((item) => item.id),
      ["seed", "next"],
    );
  } finally {
    await store?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
