import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { build } from "esbuild";

interface Scene { instances: Array<{ id: string }>; selectedInstanceId: string | null }
interface Reply { id: number; ok: boolean; scene?: Scene; error?: { message: string; kind?: string } }

test("real workers serialize initialization and mutations, preserve empty and reject corruption", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openpets-scene-worker-"));
  const bundle = join(dir, "worker.cjs");
  const databasePath = join(dir, "scene.sqlite");
  const workers: Worker[] = [];
  let nextId = 0;
  try {
    await build({ entryPoints: [resolve("src/host/scene-worker.ts")], outfile: bundle, bundle: true, platform: "node", format: "cjs", target: "node22" });
    const start = (): Worker => {
      const worker = new Worker(bundle, { workerData: { databasePath } });
      workers.push(worker);
      return worker;
    };
    const send = (worker: Worker, operation: string, command?: unknown): Promise<Reply> => new Promise((resolveReply, reject) => {
      const id = ++nextId;
      const onMessage = (reply: Reply): void => {
        if (reply.id !== id) return;
        worker.off("message", onMessage);
        worker.off("error", onError);
        resolveReply(reply);
      };
      const onError = (error: Error): void => {
        worker.off("message", onMessage);
        reject(error);
      };
      worker.on("message", onMessage);
      worker.once("error", onError);
      worker.postMessage({ id, operation, command });
    });
    const first = start();
    const second = start();
    const [a, b] = await Promise.all([send(first, "initialize"), send(second, "initialize")]);
    assert.ok(a.ok && b.ok);
    assert.deepEqual(a.scene, b.scene);
    const initial = a.scene!.instances[0].id;
    const add = (id: string) => ({ type: "addInstance", id, petId: "builtin", name: id });
    const adds = await Promise.all([send(first, "mutate", add("a")), send(second, "mutate", add("b"))]);
    assert.ok(adds.every((reply) => reply.ok));
    assert.deepEqual(new Set((await send(first, "read")).scene!.instances.map((item) => item.id)), new Set([initial, "a", "b"]));
    const cap = await Promise.all(["c", "d", "e", "f"].map((id, index) => send(index % 2 ? first : second, "mutate", add(id))));
    assert.equal(cap.filter((reply) => reply.ok).length, 3);
    const before = (await send(first, "read")).scene!;
    assert.equal((await send(second, "mutate", { type: "renameInstance", instanceId: "absent", name: "x" })).ok, false);
    assert.deepEqual((await send(first, "read")).scene, before);
    for (const instance of before.instances) assert.ok((await send(first, "mutate", { type: "removeInstance", instanceId: instance.id })).ok);
    assert.deepEqual((await send(second, "read")).scene!.instances, []);
    await Promise.all([send(first, "close"), send(second, "close")]);
    const third = start();
    assert.deepEqual((await send(third, "initialize")).scene!.instances, []);
    await send(third, "close");
    const db = new DatabaseSync(databasePath);
    db.prepare("UPDATE scene SET json = ? WHERE id = 1").run("broken");
    db.close();
    const fourth = start();
    const corrupt = await send(fourth, "initialize");
    assert.equal(corrupt.ok, false);
    assert.equal(corrupt.error?.kind, "invalid");
    await send(fourth, "close");
    const check = new DatabaseSync(databasePath);
    assert.equal(check.prepare("SELECT json FROM scene WHERE id = 1").get()?.json, "broken");
    check.close();
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
    await rm(dir, { recursive: true, force: true });
  }
});
