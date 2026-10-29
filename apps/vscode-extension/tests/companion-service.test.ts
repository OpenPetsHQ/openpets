import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompanionService } from "../src/host/companion-service.js";
import { Preferences } from "../src/host/preferences.js";
import { CatalogService } from "../src/host/catalog-service.js";
import type { CatalogPetV3 } from "@open-pets/pet-format/catalog-validation";
import {
  applySceneCommand,
  createDefaultScene,
  type SceneStoreCommand,
} from "../src/host/scene-state.js";

test("scene service keeps instance identities and allows an intentionally empty scene", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-service-"));
  let scene = createDefaultScene("seed");
  let lookups = 0;
  let disposed = false;
  const sceneStore = {
    initialize: async () => scene,
    read: async () => scene,
    mutate: async (command: SceneStoreCommand) => {
      scene = applySceneCommand(scene, command);
      return scene;
    },
    dispose: async () => {
      disposed = true;
    },
  };
  const index = {
    version: 3 as const,
    generatedAt: "2026-01-01",
    total: 1,
    pageSize: 1,
    search: "",
    filters: { categories: [] },
    pages: [""],
  };
  const catalog = new CatalogService(new AbortController().signal, {
    getIndex: async () => {
      lookups++;
      return index;
    },
    getSearch: async () => [
      {
        id: "hoodie-cat",
        displayName: "Cat",
        searchText: "cat",
        category: "western",
        catalogPage: 0,
        original: true,
      },
    ],
    getPage: async () => [
      {
        id: "hoodie-cat",
        displayName: "Cat",
        description: "Cat",
        thumbnail: "https://openpets.dev/pets/a",
        spritesheet: "https://openpets.dev/pets/b",
        zip: "https://zip.openpets.dev/pets/a",
        wardrobeZip: "https://zip.openpets.dev/pets/w",
        category: "western",
        original: true,
      },
    ],
  });
  const service = new CompanionService(
    new Preferences(root),
    "/builtin.webp",
    undefined,
    () => {},
    catalog,
    undefined,
    sceneStore,
  );
  try {
    await service.initialize();
    assert.equal(lookups, 0);
    assert.equal(
      (await service.getSnapshot()).installedPets[0].wardrobeStatus,
      "unknown",
    );
    const refreshed = await service.refreshWardrobe("builtin");
    assert.equal(refreshed.installedPets[0].wardrobeStatus, "install");
    const added = await service.addInstance("builtin", "Second");
    assert.deepEqual(
      added.instances.map((item) => item.name),
      ["Hoodie Cat", "Second"],
    );
    const id = added.selectedInstanceId;
    assert.ok(id);
    await service.renameInstance(id, "Other");
    await assert.rejects(service.setInstanceOutfit(id, "missing"));
    await service.setInstanceOutfit(id, "default");
    await service.setSceneSettings({ paused: true });
    await service.removeInstance("seed");
    const empty = await service.removeInstance(id);
    assert.equal(empty.instances.length, 0);
    assert.equal(empty.selectedInstanceId, null);
    assert.equal((await service.getSnapshot()).instances.length, 0);
    await service.dispose();
    assert.equal(disposed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing saved assets retain their identity and project a visible fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-service-"));
  const scene = {
    ...createDefaultScene("seed"),
    instances: [
      { id: "seed", petId: "missing", name: "Missing", outfitId: "hat" },
    ],
  };
  const store = {
    initialize: async () => scene,
    read: async () => scene,
    mutate: async () => scene,
    dispose: async () => {},
  };
  const service = new CompanionService(
    new Preferences(root),
    "/builtin.webp",
    undefined,
    () => {},
    undefined,
    undefined,
    store,
  );
  try {
    await service.initialize();
    const instance = (await service.getSnapshot()).instances[0];
    assert.equal(instance.petId, "missing");
    assert.equal(instance.outfitId, "hat");
    assert.equal(instance.appearance.fallback, true);
    assert.ok(instance.problem);
    await service.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disposal drains an accepted scene mutation before closing the store", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-service-"));
  let scene = createDefaultScene("seed");
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  let disposed = false;
  const store = {
    initialize: async () => scene,
    read: async () => scene,
    mutate: async (command: SceneStoreCommand) => {
      started();
      await pending;
      scene = applySceneCommand(scene, command);
      return scene;
    },
    dispose: async () => {
      disposed = true;
    },
  };
  const service = new CompanionService(
    new Preferences(root),
    "/builtin.webp",
    undefined,
    () => {},
    undefined,
    undefined,
    store,
  );
  try {
    await service.initialize();
    const mutation = service.renameInstance("seed", "New name");
    await begun;
    const closing = service.dispose();
    assert.equal(disposed, false);
    release();
    assert.equal((await mutation).instances[0].name, "New name");
    await closing;
    assert.equal(disposed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("directory changes refresh once through the scene queue and disposal stops watching", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-watch-"));
  let scene = createDefaultScene("seed");
  let reads = 0;
  const store = {
    initialize: async () => scene,
    read: async () => { reads++; return scene; },
    mutate: async (command: SceneStoreCommand) => { scene = applySceneCommand(scene, command); return scene; },
    dispose: async () => {},
  };
  const service = new CompanionService(new Preferences(root), "/builtin.webp", root, () => {}, undefined, undefined, store);
  try {
    await service.initialize();
    const events: string[] = [];
    let resolveEvent!: () => void;
    const observed = new Promise<void>((resolve) => { resolveEvent = resolve; });
    service.onSnapshot((snapshot) => { events.push(snapshot.instances[0].name); resolveEvent(); });
    await service.getSnapshot();
    assert.deepEqual(events, []);
    scene = applySceneCommand(scene, { type: "renameInstance", instanceId: "seed", name: "External" });
    await writeFile(join(root, "scene.sqlite-journal"), "change");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([observed, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Watcher did not refresh")), 3000); })]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    assert.deepEqual(events, ["External"]);
    await service.getSnapshot();
    assert.deepEqual(events, ["External"]);
    await service.dispose();
    const readsAtClose = reads;
    await writeFile(join(root, "scene.sqlite"), "later");
    assert.equal(reads, readsAtClose);
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("watch setup failure is logged and explicit reads still work", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-watch-fail-"));
  const storage = join(root, "storage");
  const scene = createDefaultScene("seed");
  const logs: string[] = [];
  const store = {
    initialize: async () => { await rm(storage, { recursive: true, force: true }); return scene; },
    read: async () => scene,
    mutate: async () => scene,
    dispose: async () => {},
  };
  const service = new CompanionService(new Preferences(root), "/builtin.webp", storage, (message) => logs.push(message), undefined, undefined, store);
  try {
    await service.initialize();
    assert.ok(logs.some((message) => message.includes("Watcher unavailable")));
    assert.equal((await service.getSnapshot()).instances[0].id, "seed");
    await mkdir(join(storage, "staging"), { recursive: true });
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("a queued refresh cannot publish an older read after a newer mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-read-order-"));
  let scene = createDefaultScene("seed");
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const begun = new Promise<void>((resolve) => { started = resolve; });
  const store = {
    initialize: async () => scene,
    read: async () => { const prior = scene; started(); await gate; return prior; },
    mutate: async (command: SceneStoreCommand) => { scene = applySceneCommand(scene, command); return scene; },
    dispose: async () => {},
  };
  const service = new CompanionService(new Preferences(root), "/builtin.webp", undefined, () => {}, undefined, undefined, store);
  try {
    await service.initialize();
    const names: string[] = [];
    service.onSnapshot((snapshot) => names.push(snapshot.instances[0].name));
    const reading = service.getSnapshot();
    await begun;
    const mutation = service.renameInstance("seed", "New");
    release();
    await reading;
    assert.equal((await mutation).instances[0].name, "New");
    assert.deepEqual(names, ["New"]);
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("pending wardrobe lookup does not block scene mutations and publishes afterwards", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-wardrobe-queue-"));
  let scene = createDefaultScene("seed");
  let resolveLookup!: (pet: CatalogPetV3) => void;
  const lookup = new Promise<CatalogPetV3>((resolve) => { resolveLookup = resolve; });
  class DeferredCatalog extends CatalogService {
    override find(): Promise<CatalogPetV3> { return lookup; }
  }
  const store = {
    initialize: async () => scene,
    read: async () => scene,
    mutate: async (command: SceneStoreCommand) => { scene = applySceneCommand(scene, command); return scene; },
    dispose: async () => {},
  };
  const service = new CompanionService(new Preferences(root), "/builtin.webp", undefined, () => {}, new DeferredCatalog(new AbortController().signal), undefined, store);
  try {
    await service.initialize();
    const published: string[] = [];
    service.onSnapshot((snapshot) => published.push(snapshot.instances[0].name));
    const refresh = service.refreshWardrobe("builtin");
    const renamed = await service.renameInstance("seed", "Renamed");
    assert.equal(renamed.instances[0].name, "Renamed");
    resolveLookup({ id: "hoodie-cat", displayName: "Cat", description: "Cat", thumbnail: "https://openpets.dev/pets/a", spritesheet: "https://openpets.dev/pets/b", zip: "https://zip.openpets.dev/pets/a", category: "western", original: true });
    assert.equal((await refresh).instances[0].name, "Renamed");
    assert.deepEqual(published, ["Renamed", "Renamed"]);
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("disposal aborts and drains a wardrobe lookup without publishing", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-wardrobe-close-"));
  let signalSeen: AbortSignal | undefined;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  class DeferredCatalog extends CatalogService {
    override async find(_id: string, signal?: AbortSignal): Promise<CatalogPetV3> {
      signalSeen = signal;
      await gate;
      signal?.throwIfAborted();
      throw new Error("Unexpected successful lookup");
    }
  }
  const scene = createDefaultScene("seed");
  const store = { initialize: async () => scene, read: async () => scene, mutate: async () => scene, dispose: async () => {} };
  const service = new CompanionService(new Preferences(root), "/builtin.webp", undefined, () => {}, new DeferredCatalog(new AbortController().signal), undefined, store);
  try {
    await service.initialize();
    let publications = 0;
    service.onSnapshot(() => { publications++; });
    const refresh = service.refreshWardrobe("builtin");
    const rejected = assert.rejects(refresh);
    let closed = false;
    const disposal = service.dispose().then(() => { closed = true; });
    assert.equal(signalSeen?.aborted, true);
    await Promise.resolve();
    assert.equal(closed, false);
    finish();
    await rejected;
    await disposal;
    assert.equal(publications, 0);
  } finally {
    finish();
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
