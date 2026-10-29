import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  CompanionRequestError,
  WebviewBackend,
} from "../src/webview/backend.js";

test("package watchdog waits for native UI and retrieves terminal responses without replay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const messages: Array<{ id: string; method: string; params: unknown }> = [];
  const listeners = new Set<(event: { data: unknown }) => void>();
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldApi = Object.getOwnPropertyDescriptor(
    globalThis,
    "acquireVsCodeApi",
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: (
        _: string,
        listener: (event: { data: unknown }) => void,
      ) => listeners.add(listener),
      removeEventListener: (
        _: string,
        listener: (event: { data: unknown }) => void,
      ) => listeners.delete(listener),
    },
  });
  Object.defineProperty(globalThis, "acquireVsCodeApi", {
    configurable: true,
    value: () => ({
      postMessage: (message: { id: string; method: string; params: unknown }) =>
        messages.push(message),
    }),
  });
  const reply = (id: string, result: unknown) => {
    for (const listener of listeners)
      listener({ data: { type: "response", id, ok: true, result } });
  };
  const unknown = (error: unknown) =>
    error instanceof CompanionRequestError && error.outcome === "unknown";
  try {
    const backend = new WebviewBackend();
    let settled = false;
    const picker = backend.importPetPackage({}).finally(() => {
      settled = true;
    });
    const pickerId = messages.at(-1)!.id;
    for (let i = 0; i < 14; i++) {
      t.mock.timers.tick(15_000);
      const probe = messages.at(-1)!;
      assert.equal(probe.method, "packageOperationStatus");
      assert.deepEqual(probe.params, { operationId: pickerId });
      reply(probe.id, { status: "pending" });
      await Promise.resolve();
    }
    assert.equal(settled, false);
    t.mock.timers.tick(15_000);
    reply(messages.at(-1)!.id, {
      status: "terminal",
      response: { ok: true, result: { status: "cancelled" } },
    });
    assert.deepEqual(await picker, { status: "cancelled" });
    assert.equal(
      messages.filter((message) => message.method === "importPetPackage")
        .length,
      1,
    );

    const install = backend.installPet("cat");
    t.mock.timers.tick(15_000);
    reply(messages.at(-1)!.id, {
      status: "terminal",
      response: {
        ok: true,
        result: {
          revision: 7,
          settings: {},
          selectedInstanceId: null,
          instances: [],
          installedPets: [],
        },
      },
    });
    assert.equal((await install).revision, 7);
    assert.equal(
      messages.filter((message) => message.method === "installPet").length,
      1,
    );

    const lost = backend.installWardrobe("cat");
    const lostId = messages.at(-1)!.id;
    t.mock.timers.tick(15_000);
    t.mock.timers.tick(15_000);
    await assert.rejects(lost, unknown);
    reply(lostId, { revision: 8 });
    const refresh = backend.ready();
    assert.equal(messages.at(-1)!.method, "recoverPackageOperation");
    assert.deepEqual(messages.at(-1)!.params, { operationId: lostId });
    reply(messages.at(-1)!.id, { status: "unavailable" });
    await Promise.resolve();
    assert.equal(messages.at(-1)!.method, "ready");
    reply(messages.at(-1)!.id, {
      snapshot: { revision: 8 },
      surface: { sequence: 1 },
    });
    await refresh;
    const plainReady = backend.ready();
    assert.equal(messages.at(-1)!.method, "ready");
    reply(messages.at(-1)!.id, {
      snapshot: { revision: 8 },
      surface: { sequence: 1 },
    });
    await plainReady;

    const malformed = backend.importPetPackage({});
    reply(messages.at(-1)!.id, { status: "installed", petId: "cat" });
    await assert.rejects(malformed, unknown);
    const failedRefresh = backend.ready();
    reply(messages.at(-1)!.id, { status: "pending" });
    await assert.rejects(failedRefresh, /Invalid package recovery/);
    const secondRefresh = backend.ready();
    assert.equal(messages.at(-1)!.method, "recoverPackageOperation");
    reply(messages.at(-1)!.id, { status: "unavailable" });
    await Promise.resolve();
    t.mock.timers.tick(15_000);
    await assert.rejects(secondRefresh, /timed out/);
    const thirdRefresh = backend.ready();
    assert.equal(messages.at(-1)!.method, "recoverPackageOperation");
    reply(messages.at(-1)!.id, { status: "unavailable" });
    await Promise.resolve();
    reply(messages.at(-1)!.id, {
      snapshot: { revision: 9 },
      surface: { sequence: 2 },
    });
    await thirdRefresh;

    const pending = backend.importPetPackage({});
    t.mock.timers.tick(15_000);
    const count = messages.length;
    backend.dispose();
    await assert.rejects(pending, unknown);
    t.mock.timers.tick(180_000);
    await Promise.resolve();
    assert.equal(messages.length, count);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (oldApi) Object.defineProperty(globalThis, "acquireVsCodeApi", oldApi);
    else Reflect.deleteProperty(globalThis, "acquireVsCodeApi");
  }
});
