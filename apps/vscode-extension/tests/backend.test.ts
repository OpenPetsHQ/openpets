import { strict as assert } from "node:assert";
import { test } from "node:test";
import { WebviewBackend } from "../src/webview/backend.js";

test("document IDs isolate delayed responses and installs outlive control deadlines", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const messages: Array<{ id: string; method: string }> = [];
  const listeners = new Set<(event: { data: unknown }) => void>();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousApi = Object.getOwnPropertyDescriptor(
    globalThis,
    "acquireVsCodeApi",
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: (
        _type: string,
        listener: (event: { data: unknown }) => void,
      ) => listeners.add(listener),
      removeEventListener: (
        _type: string,
        listener: (event: { data: unknown }) => void,
      ) => listeners.delete(listener),
    },
  });
  Object.defineProperty(globalThis, "acquireVsCodeApi", {
    configurable: true,
    value: () => ({
      postMessage: (message: { id: string; method: string }) =>
        messages.push(message),
    }),
  });
  const deliver = (id: string, result: unknown) => {
    for (const listener of listeners)
      listener({ data: { type: "response", id, ok: true, result } });
  };
  try {
    const old = new WebviewBackend();
    const oldRequest = old.listCatalog("old", 0);
    old.dispose();
    await assert.rejects(oldRequest, /disposed/);
    const current = new WebviewBackend();
    let settled = false;
    const currentRequest = current.listCatalog("new", 0).then((value) => {
      settled = true;
      return value;
    });
    assert.notEqual(messages[0].id, messages[1].id);
    deliver(messages[0].id, { query: "old" });
    await Promise.resolve();
    assert.equal(settled, false);
    deliver(messages[1].id, { query: "new" });
    assert.equal((await currentRequest).query, "new");

    const install = current.installPet("cat");
    t.mock.timers.tick(16_000);
    deliver(messages[2].id, { revision: 7 });
    assert.equal((await install).revision, 7);
    const timeout = current.installWardrobe("cat");
    t.mock.timers.tick(180_000);
    await assert.rejects(timeout, /may still complete/);
    current.dispose();
    assert.throws(() => current.onSnapshot(() => {}), /disposed/);
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousApi)
      Object.defineProperty(globalThis, "acquireVsCodeApi", previousApi);
    else Reflect.deleteProperty(globalThis, "acquireVsCodeApi");
  }
});
