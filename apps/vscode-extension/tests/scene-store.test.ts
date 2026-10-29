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
  SceneStore,
} from "../src/host/scene-store.js";

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

test("driver reads and writes through the real SQLite worker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-driver-sqlite-"));
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
    const store = new SceneStore({
      workerPath,
      databasePath: join(dir, "scene.sqlite"),
    });
    const initial = await store.initialize();
    assert.equal(initial.instances.length, 1);
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
    await rm(dir, { recursive: true, force: true });
  }
});

test("accepted commands drain in order and shutdown closes admission", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-driver-"));
  try {
    const workerPath = join(dir, "worker.cjs");
    await writeFile(workerPath, fixture);
    const store = new SceneStore({
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
    const store = new SceneStore({
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
  let store: SceneStore | undefined;
  try {
    const real = join(dir, "real.cjs");
    const wrapper = join(dir, "wrapper.cjs");
    const databasePath = join(dir, "scene.sqlite");
    await build({ entryPoints: [resolve("src/host/scene-worker.ts")], outfile: real, bundle: true, platform: "node", format: "cjs", target: "node22" });
    await writeFile(wrapper, `
      const {parentPort, workerData, Worker} = require('node:worker_threads');
      const child = new Worker(${JSON.stringify(real)}, {workerData});
      child.on('message', message => parentPort.postMessage(message));
      parentPort.on('message', message => {
        if (message.operation === 'mutate') process.exit(2);
        child.postMessage(message);
      });
    `);
    store = new SceneStore({ databasePath, workerPath: wrapper });
    await store.initialize();
    const db = new DatabaseSync(databasePath);
    db.exec("DELETE FROM scene WHERE id = 1");
    db.close();
    await assert.rejects(store.mutate({ type: "addInstance", id: "lost", petId: "cat", name: "Cat" }), SceneMutationOutcomeUnknownError);
    await assert.rejects(store.read());
    const check = new DatabaseSync(databasePath);
    assert.equal(check.prepare("SELECT json FROM scene WHERE id = 1").get(), undefined);
    check.close();
  } finally {
    await store?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a new store rejects a missing row in an existing scene schema", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-restart-missing-"));
  let store: SceneStore | undefined;
  try {
    const workerPath = join(dir, "worker.cjs");
    const databasePath = join(dir, "scene.sqlite");
    await build({ entryPoints: [resolve("src/host/scene-worker.ts")], outfile: workerPath, bundle: true, platform: "node", format: "cjs", target: "node22" });
    store = new SceneStore({ databasePath, workerPath });
    await store.initialize();
    await store.dispose();
    const db = new DatabaseSync(databasePath);
    db.exec("DELETE FROM scene WHERE id = 1");
    db.close();
    store = new SceneStore({ databasePath, workerPath });
    await assert.rejects(store.initialize(), /missing or invalid/);
    const check = new DatabaseSync(databasePath);
    assert.equal(check.prepare("SELECT json FROM scene WHERE id = 1").get(), undefined);
    check.close();
  } finally {
    await store?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("rollback failure fences the connection and requires recovery before another mutation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-poison-"));
  let store: SceneStore | undefined;
  const logs: string[] = [];
  try {
    const workerPath = join(dir, "worker.cjs");
    const poisonedFixture = fixture.replace(
      "if (request.command.id === 'failure')",
      "if (request.command.id === 'poison') { parentPort.postMessage({id:request.id,ok:false,error:{kind:'connection-failed',message:'write failed (rollback failed: disk error)'}}); return; }\n    if (request.command.id === 'failure')",
    );
    await writeFile(workerPath, poisonedFixture);
    store = new SceneStore({ workerPath, databasePath: join(dir, "scene.json"), log: (message) => logs.push(message) });
    await store.initialize();
    await assert.rejects(store.mutate({ type: "addInstance", id: "poison", petId: "cat", name: "Cat" }), SceneMutationOutcomeUnknownError);
    await assert.rejects(store.mutate({ type: "addInstance", id: "blocked", petId: "cat", name: "Cat" }), /fresh read/);
    assert.ok(logs.some((message) => message.includes("write failed") && message.includes("rollback failed")));
    const recovered = await store.read();
    assert.deepEqual(recovered.instances.map((item) => item.id), ["seed"]);
    const next = await store.mutate({ type: "addInstance", id: "next", petId: "cat", name: "Cat" });
    assert.deepEqual(next.instances.map((item) => item.id), ["seed", "next"]);
  } finally {
    await store?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
