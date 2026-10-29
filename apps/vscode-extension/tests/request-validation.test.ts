import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseRequest } from "../src/host/request-validation.js";
import type { InstalledPetView } from "../src/protocol.js";

test("package status and recovery accept only bounded document operation IDs", () => {
  const operationId = "e1ff0248-0202-4a98-acd0-08af4bd4f3bc:123";
  for (const method of ["packageOperationStatus", "recoverPackageOperation"]) {
    const request = (params: unknown) =>
      parseRequest({ type: "request", id: "1", method, params });
    assert.ok(request({ operationId }));
    assert.equal(request({ operationId, extra: true }), undefined);
    assert.equal(request({ operationId: "" }), undefined);
    assert.equal(
      request({ operationId: `${operationId}0`.repeat(20) }),
      undefined,
    );
    assert.equal(request({ operationId: "not-a-document:1" }), undefined);
    assert.equal(
      request({ operationId: operationId.replace(":123", ":0") }),
      undefined,
    );
  }
});

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

test("Studio and ZIP requests accept only fixed intents and safe pet IDs", () => {
  const request = (method: string, params: unknown) =>
    parseRequest({ type: "request", id: "1", method, params });
  assert.ok(request("importPetPackage", {}));
  assert.ok(request("importPetPackage", { targetPetId: "builtin" }));
  assert.equal(
    request("importPetPackage", { targetPetId: "../cat" }),
    undefined,
  );
  assert.equal(
    request("importPetPackage", { path: "/tmp/cat.zip" }),
    undefined,
  );
  assert.ok(request("openStudio", { intent: "pet" }));
  assert.ok(request("openStudio", { intent: "outfit", petId: "builtin" }));
  assert.equal(
    request("openStudio", { intent: "pet", petId: "cat" }),
    undefined,
  );
  assert.equal(request("openStudio", { intent: "outfit" }), undefined);
  assert.equal(
    request("openStudio", { intent: "pet", url: "https://example.com" }),
    undefined,
  );
});

test("installed view exposes local provenance and builtin wardrobe origin", () => {
  const local: InstalledPetView = {
    id: "cat",
    displayName: "Cat",
    description: "Cat",
    source: "local",
    wardrobeStatus: "local",
    outfits: [],
  };
  const builtin: InstalledPetView = {
    id: "builtin",
    displayName: "Cat",
    description: "Cat",
    source: "builtin",
    wardrobeSource: "bundled",
    wardrobeStatus: "none",
    outfits: [],
  };
  assert.equal(local.source, "local");
  assert.equal(builtin.wardrobeSource, "bundled");
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
