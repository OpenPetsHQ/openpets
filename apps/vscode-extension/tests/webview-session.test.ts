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
          'export { WebviewSession } from "./src/host/webview-session.ts"; export { SceneMutationOutcomeUnknownError } from "./src/host/companion-store.ts";',
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
      SceneMutationOutcomeUnknownError: typeof import("../src/host/companion-store.js").SceneMutationOutcomeUnknownError;
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
    const studioRequests: Array<[string, string | undefined]> = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let pendingSignal: AbortSignal | undefined;
    let pendingCalls = 0;
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
    let releaseLive!: () => void;
    let liveGate = new Promise<void>((resolve) => { releaseLive = resolve; });
    const detached = new Set<Promise<void>>();
    const service = {
      getSnapshot: async () => snapshot,
      waitForPackageOperations: async () => { await Promise.all([...detached]); },
      trackDetachedPackageOperations: (drain: Promise<void>) => { detached.add(drain); void drain.finally(() => detached.delete(drain)); },
      onSnapshot: () => () => {},
      importPetPackage: async (target?: string, signal?: AbortSignal) => {
        if (target === "pending") { pendingCalls++; pendingSignal = signal; await gate; return { status: "installed" as const, petId: target, snapshot }; }
        if (target === "commit") { await commitGate; return { status: "installed" as const, petId: target, snapshot }; }
        if (target === "picker" || target === "confirmation") { await liveGate; return { status: "cancelled" as const }; }
        if (target === "unknown") throw new host.SceneMutationOutcomeUnknownError();
        if (target === undefined) return { status: "cancelled" as const };
        return { status: "installed" as const, petId: target, snapshot };
      },
      openStudio: async (intent: string, petId?: string) => { studioRequests.push([intent, petId]); },
      addInstance: async () => {
        throw new host.SceneMutationOutcomeUnknownError();
      },
    };
    const messages: unknown[] = [];
    let failProjection = false;
    let receive: (value: unknown) => void = () => {};
    const webview = {
      options: {},
      html: "",
      cspSource: "local",
      asWebviewUri: (uri: { path: string }) => {
        if (failProjection) throw new Error("projection failed");
        return { toString: () => `view-one:${uri.path}` };
      },
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
    receive({ type: "request", id: "12345678-1234-4123-8123-123456789abc:1", method: "ready" });
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
        value.id === "12345678-1234-4123-8123-123456789abc:1",
    );
    assert.equal(
      ready?.result.snapshot.instances[0].appearance.sprite.uri,
      "view-one:/pet.webp",
    );
    assert.equal(
      ready?.result.snapshot.installedPets[0].outfits[0].sprite.uri,
      "view-one:/pet.webp",
    );
    receive({ type: "request", id: "12345678-1234-4123-8123-123456789abc:2", method: "importPetPackage", params: {} });
    receive({ type: "request", id: "12345678-1234-4123-8123-123456789abc:3", method: "importPetPackage", params: { targetPetId: "cat" } });
    receive({ type: "request", id: "12345678-1234-4123-8123-123456789abc:4", method: "importPetPackage", params: { targetPetId: "unknown" } });
    receive({ type: "request", id: "studio-pet", method: "openStudio", params: { intent: "pet" } });
    receive({ type: "request", id: "studio-outfit", method: "openStudio", params: { intent: "outfit", petId: "cat" } });
    receive({ type: "request", id: "invalid", method: "importPetPackage", params: { targetPetId: "cat", path: "/untrusted" } });
    receive({ type: "request", id: "invalid-array", method: "openStudio", params: [] });
    await new Promise<void>((done) => setImmediate(done));
    const response = (id: string): Record<string, unknown> => {
      const item = messages.find((value) => value && typeof value === "object" && "id" in value && value.id === id);
      assert.ok(item && typeof item === "object");
      return item as Record<string, unknown>;
    };
    assert.deepEqual(response("12345678-1234-4123-8123-123456789abc:2").result, { status: "cancelled" });
    const imported = response("12345678-1234-4123-8123-123456789abc:3").result as { status: string; petId: string; snapshot: import("../src/protocol.js").CompanionSnapshot };
    assert.equal(imported.status, "installed");
    assert.equal(imported.petId, "cat");
    assert.equal(imported.snapshot.instances[0].appearance.sprite.uri, "view-one:/pet.webp");
    assert.equal(imported.snapshot.installedPets[0].outfits[0].sprite.uri, "view-one:/pet.webp");
    assert.deepEqual(response("12345678-1234-4123-8123-123456789abc:4").error, { message: "Package operation outcome is unknown. Refresh before retrying.", outcome: "unknown" });
    assert.equal(response("invalid").ok, false);
    assert.equal(response("invalid-array").ok, false);
    assert.equal(response("studio-pet").result, null);
    assert.equal(response("studio-outfit").result, null);
    assert.deepEqual(studioRequests, [["pet", undefined], ["outfit", "cat"]]);
    const pendingId = "12345678-1234-4123-8123-123456789abc:5";
    receive({ type: "request", id: pendingId, method: "importPetPackage", params: { targetPetId: "pending" } });
    await new Promise<void>((done) => setImmediate(done));
    receive({ type: "request", id: "status", method: "packageOperationStatus", params: { operationId: pendingId } });
    receive({ type: "request", id: "recover", method: "recoverPackageOperation", params: { operationId: pendingId } });
    await new Promise<void>((done) => setImmediate(done));
    assert.deepEqual(response("status").result, { status: "pending" });
    assert.equal(pendingSignal?.aborted, true);
    assert.equal(messages.some((value) => !!value && typeof value === "object" && "id" in value && value.id === "recover"), false);
    release();
    await new Promise<void>((done) => setImmediate(done));
    const recovered = response("recover").result as { status: string; response: { result: { snapshot: import("../src/protocol.js").CompanionSnapshot } } };
    assert.equal(recovered.status, "terminal");
    assert.equal(recovered.response.result.snapshot.instances[0].appearance.sprite.uri, "view-one:/pet.webp");
    receive({ type: "request", id: pendingId, method: "importPetPackage", params: { targetPetId: "pending" } });
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(pendingCalls, 1);
    failProjection = true;
    receive({ type: "request", id: "12345678-1234-4123-8123-123456789abc:6", method: "importPetPackage", params: { targetPetId: "cat" } });
    await new Promise<void>((done) => setImmediate(done));
    assert.deepEqual(response("12345678-1234-4123-8123-123456789abc:6").error, { message: "Package operation outcome is unknown. Refresh before retrying.", outcome: "unknown" });
    failProjection = false;
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
    receiveSecond({ type: "request", id: "abcdef12-1234-4123-8123-123456789abc:1", method: "ready" });
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
        value.id === "abcdef12-1234-4123-8123-123456789abc:1",
    );
    assert.equal(
      secondReady?.result.snapshot.instances[0].appearance.sprite.uri,
      "view-two:/pet.webp",
    );
    assert.equal(
      secondReady?.result.snapshot.installedPets[0].outfits[0].sprite.uri,
      "view-two:/pet.webp",
    );
    receiveSecond({ type: "request", id: "abcdef12-1234-4123-8123-123456789abc:2", method: "importPetPackage", params: { targetPetId: "cat" } });
    await new Promise<void>((done) => setImmediate(done));
    const secondImport = secondMessages.find((value) => value && typeof value === "object" && "id" in value && value.id === "abcdef12-1234-4123-8123-123456789abc:2") as { result: { snapshot: import("../src/protocol.js").CompanionSnapshot } };
    assert.equal(secondImport.result.snapshot.instances[0].appearance.sprite.uri, "view-two:/pet.webp");
    assert.equal(secondImport.result.snapshot.installedPets[0].outfits[0].sprite.uri, "view-two:/pet.webp");
    for (const [index, target] of ["picker", "confirmation"].entries()) {
      liveGate = new Promise<void>((resolve) => { releaseLive = resolve; });
      receive({ type: "request", id: `12345678-1234-4123-8123-123456789abc:${8 + index}`, method: "importPetPackage", params: { targetPetId: target } });
      await new Promise<void>((done) => setImmediate(done));
      const readyId = `abcdef12-1234-4123-8123-123456789abc:${10 + index}`;
      receiveSecond({ type: "request", id: readyId, method: "ready" });
      await new Promise<void>((done) => setImmediate(done));
      assert.ok(secondMessages.some((value) => !!value && typeof value === "object" && "id" in value && value.id === readyId && "ok" in value && value.ok === true));
      releaseLive();
      await new Promise<void>((done) => setImmediate(done));
    }
    assert.equal(
      messages.some(
        (value) =>
          !!value &&
          typeof value === "object" &&
          "id" in value &&
          value.id === "abcdef12-1234-4123-8123-123456789abc:1",
      ),
      false,
    );
    receiveSecond({ type: "request", id: "abcdef12-1234-4123-8123-123456789abc:3", method: "importPetPackage", params: { targetPetId: "commit" } });
    await new Promise<void>((done) => setImmediate(done));
    second.dispose();
    receive({ type: "request", id: "12345678-1234-4123-8123-123456789abc:7", method: "ready" });
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(messages.some((value) => !!value && typeof value === "object" && "id" in value && value.id === "12345678-1234-4123-8123-123456789abc:7"), false);
    releaseCommit();
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(response("12345678-1234-4123-8123-123456789abc:7").ok, true);
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
