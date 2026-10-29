import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

test("native interactions handle cancellation, replacement and external-open failure", async () => {
  let selection: unknown;
  let confirmation: string | undefined;
  let detail = "";
  let opened = false;
  Object.defineProperty(globalThis, "__openpetsInteractionsMock", {
    configurable: true,
    value: {
      window: {
        showOpenDialog: async () => selection,
        showWarningMessage: async (_message: string, options: { detail: string }) => { detail = options.detail; return confirmation; },
      },
      env: { openExternal: async () => opened },
      Uri: { parse: (url: string) => url },
    },
  });
  try {
    const output = await build({
      entryPoints: [resolve("src/host/package-interactions.ts")], bundle: true, platform: "node", format: "cjs", write: false,
      plugins: [{ name: "vscode-mock", setup(builder) {
        builder.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "mock" }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "module.exports = globalThis.__openpetsInteractionsMock", loader: "js" }));
      } }],
    });
    const module = { exports: {} };
    new Function("module", "exports", "require", output.outputFiles[0].text)(module, module.exports, createRequire(resolve("package.json")));
    const { createPackageInteractions } = module.exports as typeof import("../src/host/package-interactions.js");
    const interactions = createPackageInteractions();
    assert.equal(await interactions.pickZip(), undefined);
    selection = [{ scheme: "file", authority: "", query: "", fragment: "", fsPath: "/tmp/pet.zip" }];
    assert.equal(await interactions.pickZip(), "/tmp/pet.zip");
    selection = [{ scheme: "vscode-remote", authority: "remote", fsPath: "/tmp/pet.zip" }];
    await assert.rejects(interactions.pickZip());
    const details = { displayName: "Cat", assetId: "cat", targeted: true, replacingLocal: true };
    assert.equal(await interactions.confirmReplacement(details), false);
    assert.match(detail, /all instances/i);
    assert.match(detail, /local customizations/i);
    confirmation = "Replace package";
    assert.equal(await interactions.confirmReplacement(details), true);
    await assert.rejects(interactions.openStudio("pet"));
    opened = true;
    await interactions.openStudio("pet");
  } finally {
    Reflect.deleteProperty(globalThis, "__openpetsInteractionsMock");
  }
});
