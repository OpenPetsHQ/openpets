import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PackageOperationRegistry } from "../src/host/package-operation-registry.js";
import type { PackageOperationResponse } from "../src/protocol.js";

const documentId = "12345678-1234-4123-8123-123456789abc";
const otherId = "abcdef12-1234-4123-8123-123456789abc";
const id = (number: number) => `${documentId}:${number}`;
const success: PackageOperationResponse = { ok: true, result: { status: "cancelled" } };

test("recovery aborts pending work but waits for its actual terminal result", async () => {
  const registry = new PackageOperationRegistry();
  await registry.activateDocument(id(1));
  let release!: () => void;
  let signal!: AbortSignal;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const result = registry.run(id(2), async (value) => { calls++; signal = value; await gate; return success; });
  await Promise.resolve();
  assert.deepEqual(registry.status(id(2)), { status: "pending" });
  let recovered = false;
  const recovery = registry.recover(id(2)).then((value) => { recovered = true; return value; });
  assert.equal(signal.aborted, true);
  await Promise.resolve();
  assert.equal(recovered, false);
  release();
  assert.deepEqual(await result, success);
  assert.deepEqual(await recovery, { status: "terminal", response: success });
  assert.deepEqual(registry.status(id(2)), { status: "terminal", response: success });
  await assert.rejects(registry.run(id(2), async () => success));
  assert.equal(calls, 1);
  await registry.dispose();
});

test("fences unavailable, foreign and evicted IDs without replay", async () => {
  const registry = new PackageOperationRegistry();
  await registry.activateDocument(id(1));
  assert.deepEqual(await registry.recover(id(5)), { status: "unavailable" });
  await assert.rejects(registry.run(id(4), async () => success));
  await assert.rejects(registry.run(`${otherId}:10`, async () => success));
  for (let n = 6; n <= 38; n++) await registry.run(id(n), async () => success);
  assert.deepEqual(registry.status(id(6)), { status: "unavailable" });
  await assert.rejects(registry.run(id(6), async () => success));
  await registry.dispose();
});

test("pending admission is bounded and document changes drain old work", async () => {
  const registry = new PackageOperationRegistry();
  await registry.activateDocument(id(1));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const signals: AbortSignal[] = [];
  const requests = Array.from({ length: 32 }, (_, index) => registry.run(id(index + 2), async (signal) => { signals.push(signal); await gate; return success; }));
  await Promise.resolve();
  await assert.rejects(registry.run(id(34), async () => success));
  const transition = registry.activateDocument(`${otherId}:1`);
  await Promise.resolve();
  assert.equal(signals.every((signal) => signal.aborted), true);
  await assert.rejects(registry.run(id(35), async () => success));
  release();
  await Promise.all(requests);
  await transition;
  assert.deepEqual(registry.status(id(2)), { status: "unavailable" });
  assert.deepEqual(await registry.run(`${otherId}:2`, async () => success), success);
  await registry.dispose();
  await assert.rejects(registry.run(`${otherId}:3`, async () => success));
});

test("dispose closes admission immediately and waits for a terminal callback", async () => {
  const registry = new PackageOperationRegistry();
  await registry.activateDocument(id(1));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const pending = registry.run(id(2), async () => { await gate; return success; });
  let drained = false;
  const closing = registry.dispose().then(() => { drained = true; });
  await assert.rejects(registry.run(id(3), async () => success));
  assert.equal(drained, false);
  release();
  await pending;
  await closing;
  assert.equal(drained, true);
});
