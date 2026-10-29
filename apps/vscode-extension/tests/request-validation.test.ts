import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseRequest } from "../src/host/request-validation.js";

test("request validation accepts parameterless ready and rejects invalid method parameters", () => {
  assert.equal(
    parseRequest({ type: "request", id: "1", method: "ready" })?.method,
    "ready",
  );
  assert.equal(
    parseRequest({
      type: "request",
      id: "2",
      method: "setSceneSettings",
      params: { changes: { size: "enormous" } },
    }),
    undefined,
  );
  assert.equal(
    parseRequest({
      type: "request",
      id: "3",
      method: "listCatalog",
      params: { query: "", page: -1 },
    }),
    undefined,
  );
  assert.equal(
    parseRequest({ type: "request", id: "4", method: "ready", params: {} }),
    undefined,
  );
});

test("scene request validation accepts partial settings and bounded Unicode names", () => {
  const request = (method: string, params: unknown) =>
    parseRequest({ type: "request", id: "1", method, params });
  assert.ok(
    request("setSceneSettings", { changes: { motion: "calm", paused: false } }),
  );
  assert.equal(request("setSceneSettings", { changes: {} }), undefined);
  assert.equal(
    request("setSceneSettings", { changes: { paused: false, extra: 1 } }),
    undefined,
  );
  assert.equal(
    request("setSceneSettings", { changes: { paused: "false" } }),
    undefined,
  );
  assert.ok(request("addInstance", { petId: "cat", name: "🐈".repeat(40) }));
  assert.equal(
    request("addInstance", { petId: "cat", name: "🐈".repeat(41) }),
    undefined,
  );
  assert.equal(
    request("renameInstance", { instanceId: "i", name: "  " }),
    undefined,
  );
  assert.equal(
    request("removeInstance", { instanceId: "i", extra: true }),
    undefined,
  );
  assert.equal(request("setSize", { size: "small" }), undefined);
  assert.ok(request("renameInstance", { instanceId: "i", name: "Cat" }));
  assert.ok(request("removeInstance", { instanceId: "i" }));
  assert.ok(request("selectInstance", { instanceId: "i" }));
  assert.ok(
    request("setInstanceOutfit", { instanceId: "i", outfitId: "default" }),
  );
  assert.ok(request("refreshWardrobe", { petId: "builtin" }));
  assert.equal(
    request("setInstanceOutfit", { instanceId: "i", outfitId: "" }),
    undefined,
  );
});
