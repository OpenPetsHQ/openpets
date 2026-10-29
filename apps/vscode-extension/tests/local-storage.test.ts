import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolve } from "node:path";
import { validateLocalStoragePath } from "../src/host/local-storage.js";

test("local file and VS Code user-data storage map to the documented native path", () => {
  const nativePath = resolve("test-storage");
  for (const scheme of ["file", "vscode-userdata"]) {
    const uri = {
      scheme,
      authority: "",
      path: "/storage",
      query: "",
      fragment: "",
    };
    assert.equal(
      validateLocalStoragePath(uri, nativePath, "/storage"),
      nativePath,
    );
  }
});

test("remote, nonlocal, mismatched and nonabsolute storage paths are rejected", () => {
  const nativePath = resolve("test-storage");
  const uri = {
    scheme: "vscode-userdata",
    authority: "",
    path: "/storage",
    query: "",
    fragment: "",
  };
  assert.throws(() =>
    validateLocalStoragePath(
      { ...uri, scheme: "vscode-remote" },
      nativePath,
      "/storage",
    ),
  );
  assert.throws(() =>
    validateLocalStoragePath(
      { ...uri, authority: "remote" },
      nativePath,
      "/storage",
    ),
  );
  assert.throws(() =>
    validateLocalStoragePath(
      { ...uri, query: "other" },
      nativePath,
      "/storage",
    ),
  );
  assert.throws(() => validateLocalStoragePath(uri, nativePath, "/different"));
  assert.throws(() => validateLocalStoragePath(uri, "relative", "/storage"));
});
