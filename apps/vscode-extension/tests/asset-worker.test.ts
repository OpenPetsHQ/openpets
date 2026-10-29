import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import type { Receipt } from "../src/host/asset-reference.js";

test("independent workers initialize once and enforce asset generation CAS", async () => {
  const root = await mkdtemp(join(tmpdir(), "asset-worker-"));
  const path = join(root, "worker.cjs");
  await build({ entryPoints: [resolve("src/host/scene-worker.ts")], outfile: path, bundle: true, platform: "node", format: "cjs", target: "node22" });
  const workers = [0, 1].map(() => new Worker(path, { workerData: { databasePath: join(root, "scene.sqlite") } }));
  let id = 0;
  const call = (worker: Worker, operation: string, command?: unknown): Promise<Record<string, unknown>> => new Promise((resolveReply, reject) => {
    const requestId = ++id;
    const onMessage = (message: Record<string, unknown>) => {
      if (message.id !== requestId) return;
      worker.off("message", onMessage);
      worker.off("error", onError);
      resolveReply(message);
    };
    const onError = (error: Error) => { worker.off("message", onMessage); reject(error); };
    worker.on("message", onMessage);
    worker.once("error", onError);
    if (operation === "mutate") {
      worker.postMessage({ id: requestId, operation, command });
    } else if (command && typeof command === "object" && !Array.isArray(command)) {
      worker.postMessage({ id: requestId, operation, ...command });
    } else {
      worker.postMessage({ id: requestId, operation });
    }
  });
  const receipt: Receipt = { version: 2, id: "hoodie-cat", packageId: "hoodie-cat", sha256: "a".repeat(64), generation: "12345678-1234-4123-8123-123456789abc", source: { kind: "catalog", url: "https://zip.openpets.dev/pets/a.zip" } };
  try {
    await Promise.all(workers.map((worker) => call(worker, "initialize")));
    assert.equal((await call(workers[0], "assetReferencesInitialized")).initialized, false);
    assert.equal((await call(workers[0], "initializeAssets", { records: [receipt, receipt] })).ok, false);
    const problem = { id: "broken", message: "Invalid legacy receipt" };
    const [first, second] = await Promise.all(workers.map((worker) => call(worker, "initializeAssets", { records: [receipt], problems: [problem] })));
    assert.deepEqual(first.references, [receipt]);
    assert.deepEqual(second.references, [receipt]);
    assert.deepEqual(first.problems, [problem]);
    assert.equal((await call(workers[1], "assetReferencesInitialized")).initialized, true);
    assert.deepEqual((await call(workers[1], "initializeAssets", { records: [] })).references, [receipt]);
    const local: Receipt = { ...receipt, generation: "87654321-1234-4123-8123-123456789abc", source: { kind: "local" } };
    assert.equal((await call(workers[0], "compareAndSwapAssetReference", { assetId: receipt.id, expectedGeneration: receipt.generation, receipt: local })).ok, true);
    assert.equal((await call(workers[1], "compareAndSwapAssetReference", { assetId: receipt.id, expectedGeneration: receipt.generation, receipt })).ok, false);
    const builtin: Receipt = { ...local, id: "builtin" };
    assert.equal((await call(workers[1], "compareAndSwapAssetReference", { assetId: "builtin", expectedGeneration: null, receipt: builtin })).ok, true);
    assert.deepEqual((await call(workers[0], "readAssetReference", { assetId: receipt.id })).reference, local);
    assert.deepEqual((await call(workers[0], "readAssetReference", { assetId: "builtin" })).reference, builtin);
    assert.equal((await call(workers[0], "readAssetReference", { assetId: "broken" })).ok, false);
    assert.equal((await call(workers[0], "compareAndSwapAssetReference", { assetId: "broken", expectedGeneration: null, receipt: { ...local, id: "broken", packageId: "broken" } })).ok, false);
    const db = new DatabaseSync(join(root, "scene.sqlite"));
    try {
      db.prepare("INSERT INTO asset_references (id, json) VALUES (?, ?)").run("corrupt", "not json");
      const listing = await call(workers[1], "listAssetReferences");
      assert.deepEqual(listing.references, [builtin, local]);
      assert.ok(Array.isArray(listing.problems) && listing.problems.some((entry: { id: string }) => entry.id === "corrupt"));
      assert.equal((await call(workers[1], "readAssetReference", { assetId: "corrupt" })).ok, false);
      assert.equal((await call(workers[1], "compareAndSwapAssetReference", { assetId: "corrupt", expectedGeneration: null, receipt: { ...local, id: "corrupt", packageId: "corrupt" } })).ok, false);
      assert.equal(db.prepare("SELECT json FROM asset_references WHERE id = ?").get("corrupt")?.json, "not json");
      assert.equal((await call(workers[1], "compareAndSwapAssetReference", { assetId: "hoodie-cat", expectedGeneration: local.generation, receipt })).ok, true);
    } finally { db.close(); }
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
    await rm(root, { recursive: true, force: true });
  }
});
