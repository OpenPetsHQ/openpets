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
      method: "setSize",
      params: { size: "enormous" },
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
