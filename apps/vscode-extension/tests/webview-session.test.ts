import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import type * as vscode from "vscode";
import { SurfaceCoordinator } from "../src/host/surface-coordinator.js";
import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";

test("sessions project nested fallback assets per webview and return unknown mutation outcomes", async () => {
  Object.defineProperty(globalThis, "__sessionVscode", {
    configurable: true,
    value: {
      Uri: {
        joinPath: () => ({ toString: () => "resource" }),
        file: (path: string) => ({ path }),
      },
    },
  });
  try {
    const output = await build({
      stdin: {
        contents:
          'export { WebviewSession } from "./src/host/webview-session.ts"; export { SceneMutationOutcomeUnknownError } from "./src/host/scene-store.ts";',
        resolveDir: process.cwd(),
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
      plugins: [
        {
          name: "vscode-test",
          setup(builder) {
            builder.onResolve({ filter: /^vscode$/ }, () => ({
              path: "vscode",
              namespace: "mock",
            }));
            builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
              contents: "module.exports = globalThis.__sessionVscode",
              loader: "js",
            }));
          },
        },
      ],
    });
    const module = { exports: {} };
    new Function("module", "exports", "require", output.outputFiles[0].text)(
      module,
      module.exports,
      createRequire(resolve("package.json")),
    );
    const host = module.exports as {
      WebviewSession: typeof import("../src/host/webview-session.js").WebviewSession;
      SceneMutationOutcomeUnknownError: typeof import("../src/host/scene-store.js").SceneMutationOutcomeUnknownError;
    };
    const layout = getPetSpriteLayout({});
    const sprite = {
      uri: { kind: "local" as const, path: "/pet.webp" },
      layout,
    };
    const snapshot = {
      revision: 1,
      settings: {
        size: "medium" as const,
        motion: "calm" as const,
        paused: false,
        backdrop: "dots" as const,
      },
      selectedInstanceId: "i",
      instances: [
        {
          id: "i",
          petId: "missing",
          name: "Pet",
          outfitId: "hat",
          appearance: { sprite, outfitName: "Default", fallback: true },
        },
      ],
      installedPets: [
        {
          id: "builtin",
          displayName: "Cat",
          description: "Cat",
          source: "builtin" as const,
          wardrobeStatus: "unknown" as const,
          outfits: [{ id: "default", displayName: "Default", sprite }],
        },
      ],
    };
    const service = {
      getSnapshot: async () => snapshot,
      onSnapshot: () => () => {},
      addInstance: async () => {
        throw new host.SceneMutationOutcomeUnknownError();
      },
    };
    const messages: unknown[] = [];
    let receive: (value: unknown) => void = () => {};
    const webview = {
      options: {},
      html: "",
      cspSource: "local",
      asWebviewUri: (uri: { path: string }) => ({
        toString: () => `view-one:${uri.path}`,
      }),
      onDidReceiveMessage: (listener: (value: unknown) => void) => {
        receive = listener;
        return { dispose: () => {} };
      },
      postMessage: async (value: unknown) => {
        messages.push(value);
        return true;
      },
    } as unknown as vscode.Webview;
    const session = new host.WebviewSession(
      webview,
      "one",
      "view",
      true,
      service as unknown as import("../src/host/companion-service.js").CompanionService,
      new SurfaceCoordinator(),
      {} as vscode.Uri,
      {} as vscode.Uri,
      {
        openEditor: () => {},
        revealSidebar: async () => {},
        captureCloseEditor: () => () => {},
      },
      {
        name: "test",
        append: () => {},
        appendLine: () => {},
        replace: () => {},
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
      },
    );
    receive({ type: "request", id: "ready", method: "ready" });
    await new Promise<void>((done) => setImmediate(done));
    const ready = messages.find(
      (
        value,
      ): value is {
        id: string;
        result: { snapshot: import("../src/protocol.js").CompanionSnapshot };
      } =>
        !!value &&
        typeof value === "object" &&
        "id" in value &&
        value.id === "ready",
    );
    assert.equal(
      ready?.result.snapshot.instances[0].appearance.sprite.uri,
      "view-one:/pet.webp",
    );
    assert.equal(
      ready?.result.snapshot.installedPets[0].outfits[0].sprite.uri,
      "view-one:/pet.webp",
    );
    let receiveSecond: (value: unknown) => void = () => {};
    const secondMessages: unknown[] = [];
    const secondView = {
      options: {},
      html: "",
      cspSource: "local",
      asWebviewUri: (uri: { path: string }) => ({
        toString: () => `view-two:${uri.path}`,
      }),
      onDidReceiveMessage: (listener: (value: unknown) => void) => {
        receiveSecond = listener;
        return { dispose: () => {} };
      },
      postMessage: async (value: unknown) => {
        secondMessages.push(value);
        return true;
      },
    } as unknown as vscode.Webview;
    const second = new host.WebviewSession(
      secondView,
      "two",
      "editor",
      true,
      service as unknown as import("../src/host/companion-service.js").CompanionService,
      new SurfaceCoordinator(),
      {} as vscode.Uri,
      {} as vscode.Uri,
      {
        openEditor: () => {},
        revealSidebar: async () => {},
        captureCloseEditor: () => () => {},
      },
      {
        name: "test",
        append: () => {},
        appendLine: () => {},
        replace: () => {},
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
      },
    );
    receiveSecond({ type: "request", id: "second-ready", method: "ready" });
    await new Promise<void>((done) => setImmediate(done));
    const secondReady = secondMessages.find(
      (
        value,
      ): value is {
        id: string;
        result: { snapshot: import("../src/protocol.js").CompanionSnapshot };
      } =>
        !!value &&
        typeof value === "object" &&
        "id" in value &&
        value.id === "second-ready",
    );
    assert.equal(
      secondReady?.result.snapshot.instances[0].appearance.sprite.uri,
      "view-two:/pet.webp",
    );
    assert.equal(
      secondReady?.result.snapshot.installedPets[0].outfits[0].sprite.uri,
      "view-two:/pet.webp",
    );
    assert.equal(
      messages.some(
        (value) =>
          !!value &&
          typeof value === "object" &&
          "id" in value &&
          value.id === "second-ready",
      ),
      false,
    );
    second.dispose();
    receive({
      type: "request",
      id: "add",
      method: "addInstance",
      params: { petId: "builtin", name: "Cat" },
    });
    await new Promise<void>((done) => setImmediate(done));
    assert.ok(
      messages.some(
        (value) =>
          !!value &&
          typeof value === "object" &&
          "id" in value &&
          value.id === "add" &&
          "error" in value &&
          !!value.error &&
          typeof value.error === "object" &&
          "outcome" in value.error &&
          value.error.outcome === "unknown",
      ),
    );
    session.dispose();
  } finally {
    Reflect.deleteProperty(globalThis, "__sessionVscode");
  }
});
