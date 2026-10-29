import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompanionService,
  PackageOutcomeUnknownError,
} from "../src/host/companion-service.js";
import type { Receipt } from "../src/host/asset-reference.js";
const interactions = {
  pickZip: async () => undefined,
  confirmReplacement: async () => false,
  openStudio: async () => {},
};
function withAssets<T extends object>(store: T) {
  return {
    ...store,
    assetReferencesInitialized: async () => true,
    initializeAssetReferences: async (_records: readonly Receipt[]) => ({
      references: [],
      problems: [],
    }),
    listAssetReferences: async () => ({ references: [], problems: [] }),
    readAssetReference: async (_id: string) => null,
    compareAndSwapAssetReference: async (
      _id: string,
      _expected: string | null,
      receipt: Receipt,
    ) => receipt,
  };
}

test("bundled wardrobe, local override and independent catalog identity refresh without scene mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-assets-"));
  let scene = createDefaultScene("seed");
  const records = new Map<string, Receipt>();
  let failAfterCommit = false;
  let breakRefresh = false;
  const generation = "00000000-0000-4000-8000-000000000001";
  const receipt = (id: string): Receipt => ({
    version: 2,
    id,
    packageId: id === "builtin" ? "hoodie-cat" : id,
    sha256: "a".repeat(64),
    generation,
    source: { kind: "local" },
  });
  const state = {
    initialize: async () => scene,
    read: async () => scene,
    mutate: async (command: SceneStoreCommand) => {
      scene = applySceneCommand(scene, command);
      return scene;
    },
    assetReferencesInitialized: async () => true,
    initializeAssetReferences: async () => ({
      references: [...records.values()],
      problems: [],
    }),
    listAssetReferences: async () => {
      if (breakRefresh) throw new Error("read failed");
      return { references: [...records.values()], problems: [] };
    },
    readAssetReference: async (id: string) => records.get(id) ?? null,
    compareAndSwapAssetReference: async (
      id: string,
      _expected: string | null,
      value: Receipt,
    ) => {
      records.set(id, value);
      return value;
    },
    dispose: async () => {},
  };
  let corrupt = false;
  let partial = false;
  const installed = (reference: Receipt): InstalledPet => ({
    id: reference.id,
    receipt: reference,
    root: `/assets/${reference.id}`,
    package: {
      metadata: {
        id: reference.packageId,
        displayName: "Cat",
        description: "Cat",
        spritesheetPath: "spritesheet.webp",
        wardrobe: {
          outfits: [
            {
              id: "custom",
              displayName: "Custom",
              spritesheetPath: "outfits/custom.webp",
            },
          ],
          schedule: [],
        },
      },
      layout: getPetSpriteLayout({}),
      availableOutfitIds: ["custom"],
    },
  });
  class FakePetStore extends PetStore {
    override async initialize() {}
    override async dispose() {}
    override async load(id: string) {
      if (corrupt && id === "builtin") throw new Error("corrupt override");
      const value = records.get(id);
      if (!value) throw new Error("missing");
      const pet = installed(value);
      if (partial && id === "builtin")
        return {
          ...pet,
          package: {
            ...pet.package,
            availableOutfitIds: [],
            outfitProblems: ["custom invalid"],
          },
        };
      return pet;
    }
    override async prepareLocal(
      _path: string,
      target?: string,
    ): Promise<PreparedPetPackage> {
      const ref = receipt(target ?? "hoodie-cat");
      return {
        id: ref.id,
        packageId: ref.packageId,
        receipt: ref,
        package: installed(ref).package,
        candidate: "/private",
      };
    }
    override async prepareCatalog(
      pet: CatalogPetV3,
    ): Promise<PreparedPetPackage> {
      const ref: Receipt = {
        ...receipt(pet.id),
        source: { kind: "catalog", url: pet.zip },
      };
      return {
        id: ref.id,
        packageId: ref.packageId,
        receipt: ref,
        package: installed(ref).package,
        candidate: "/private",
      };
    }
    override async commitPrepared(
      prepared: PreparedPetPackage,
    ): Promise<InstalledPet> {
      records.set(prepared.id, prepared.receipt);
      if (failAfterCommit) breakRefresh = true;
      return installed(prepared.receipt);
    }
    override async discardPrepared() {}
  }
  const petStore = new FakePetStore(root, state);
  let selected = false;
  const ui = {
    pickZip: async () => (selected ? "/package.zip" : undefined),
    confirmReplacement: async () => true,
    openStudio: async () => {},
  };
  class TestCatalog extends CatalogService {
    override async find(): Promise<CatalogPetV3> {
      return {
        id: "hoodie-cat",
        displayName: "Cat",
        description: "Cat",
        thumbnail: "https://openpets.dev/pets/a",
        spritesheet: "https://openpets.dev/pets/b",
        zip: "https://zip.openpets.dev/pets/a",
        category: "western",
        original: true,
      };
    }
  }
  const service = new CompanionService({
    atlasPath: "/media/base.webp",
    storagePath: root,
    stateStore: state,
    petStore,
    catalog: new TestCatalog(new AbortController().signal),
    interactions: ui,
  });
  try {
    await service.initialize();
    const fresh = await service.getSnapshot();
    assert.equal(fresh.installedPets[0].outfits.length, 6);
    assert.equal(fresh.installedPets[0].wardrobeSource, "bundled");
    assert.deepEqual(await service.importPetPackage(), { status: "cancelled" });
    selected = true;
    const imported = await service.importPetPackage();
    assert.equal(imported.status, "installed");
    const local = await service.getSnapshot();
    assert.equal(local.instances.length, 1);
    assert.equal(
      local.installedPets.find((pet) => pet.id === "hoodie-cat")?.source,
      "local",
    );
    assert.equal(local.installedPets[0].wardrobeSource, "bundled");
    await assert.rejects(
      service.installWardrobe("hoodie-cat"),
      /Local outfits/,
    );
    const sceneBeforeInstall = (await service.getSnapshot()).instances;
    const catalogInstall = await service.installPet("hoodie-cat");
    assert.deepEqual(catalogInstall.instances, sceneBeforeInstall);
    assert.equal(
      catalogInstall.installedPets.find((pet) => pet.id === "hoodie-cat")
        ?.source,
      "catalog",
    );
    const override = await service.importPetPackage("builtin");
    assert.equal(override.status, "installed");
    const snapshot = await service.getSnapshot();
    assert.equal(snapshot.installedPets[0].wardrobeSource, "local");
    assert.deepEqual(
      snapshot.installedPets[0].outfits.map((outfit) => outfit.id),
      ["default", "custom"],
    );
    assert.equal(snapshot.instances.length, 1);
    await service.setInstanceOutfit("seed", "custom");
    partial = true;
    records.set("builtin", {
      ...receipt("builtin"),
      generation: "00000000-0000-4000-8000-000000000003",
    });
    const partialFallback = await service.getSnapshot();
    assert.equal(partialFallback.installedPets[0].outfits.length, 6);
    assert.equal(partialFallback.instances[0].outfitId, "custom");
    assert.equal(partialFallback.instances[0].appearance.fallback, true);
    assert.ok(
      partialFallback.installedPets
        .find((pet) => pet.id === "hoodie-cat")
        ?.outfits.some((outfit) => outfit.id === "custom"),
    );
    corrupt = true;
    records.set("builtin", {
      ...receipt("builtin"),
      generation: "00000000-0000-4000-8000-000000000002",
    });
    const fallback = await service.getSnapshot();
    assert.equal(fallback.instances[0].outfitId, "custom");
    assert.equal(fallback.instances[0].appearance.fallback, true);
    assert.equal(fallback.installedPets[0].wardrobeSource, "bundled");
    assert.ok(fallback.installedPets[0].problem);
    failAfterCommit = true;
    await assert.rejects(
      service.importPetPackage(),
      (error: unknown) =>
        error instanceof PackageOutcomeUnknownError &&
        error.outcome === "unknown",
    );
    assert.equal(records.get("hoodie-cat")?.source.kind, "local");
    breakRefresh = false;
    assert.equal(
      (await service.getSnapshot()).installedPets.find(
        (pet) => pet.id === "hoodie-cat",
      )?.source,
      "local",
    );
    await service.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reference refresh retries a two-asset race and retries transient load failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-asset-race-"));
  const scene = createDefaultScene("seed");
  const reference = (id: string, suffix: string): Receipt => ({
    version: 2,
    id,
    packageId: id,
    sha256: "a".repeat(64),
    generation: `00000000-0000-4000-8000-00000000000${suffix}`,
    source: { kind: "local" },
  });
  const records = new Map<string, Receipt>();
  const state = {
    initialize: async () => scene,
    read: async () => scene,
    mutate: async () => scene,
    dispose: async () => {},
    assetReferencesInitialized: async () => true,
    initializeAssetReferences: async () => ({ references: [], problems: [] }),
    listAssetReferences: async () => ({
      references: [...records.values()],
      problems: [],
    }),
    readAssetReference: async (id: string) => records.get(id) ?? null,
    compareAndSwapAssetReference: async (
      _id: string,
      _expected: string | null,
      value: Receipt,
    ) => value,
  };
  let race = false;
  let transient = false;
  class FakePetStore extends PetStore {
    override async initialize() {}
    override async dispose() {}
    override async load(id: string): Promise<InstalledPet> {
      if (id === "dog" && race) {
        race = false;
        records.set("dog", reference("dog", "2"));
      }
      if (id === "cat" && transient) {
        transient = false;
        throw new Error("temporary read failure");
      }
      const receipt = records.get(id);
      if (!receipt) throw new Error("missing");
      return {
        id,
        receipt,
        root: `/pets/${id}`,
        package: {
          metadata: {
            id,
            displayName: id,
            description: id,
            spritesheetPath: "spritesheet.webp",
          },
          layout: getPetSpriteLayout({}),
          availableOutfitIds: [],
        },
      };
    }
  }
  const service = new CompanionService({
    atlasPath: "/base.webp",
    storagePath: root,
    stateStore: state,
    petStore: new FakePetStore(root, state),
    interactions,
  });
  try {
    await service.initialize();
    records.set("cat", reference("cat", "1"));
    records.set("dog", reference("dog", "1"));
    race = true;
    const refreshed = await service.getSnapshot();
    assert.deepEqual(
      refreshed.installedPets.map((pet) => pet.id),
      ["builtin", "cat", "dog"],
    );
    records.set("cat", reference("cat", "2"));
    transient = true;
    const failed = await service.getSnapshot();
    assert.equal(
      failed.installedPets.some((pet) => pet.id === "cat"),
      false,
    );
    const recovered = await service.getSnapshot();
    assert.equal(
      recovered.installedPets.some((pet) => pet.id === "cat"),
      true,
    );
    await service.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migration records blocked keys and skips legacy files once initialized", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-migrate-"));
  const dir = join(root, "preferences", "installed");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "cat.json"), "broken");
  let initialized = false;
  let seenProblems: readonly { id: string; message: string }[] = [];
  const scene = createDefaultScene("seed");
  const base = withAssets({
    initialize: async () => scene,
    read: async () => scene,
    mutate: async () => scene,
    dispose: async () => {},
  });
  const state = {
    ...base,
    assetReferencesInitialized: async () => initialized,
    initializeAssetReferences: async (
      _records: readonly Receipt[],
      problems: readonly { id: string; message: string }[] = [],
    ) => {
      initialized = true;
      seenProblems = problems;
      return { references: [], problems: [...problems] };
    },
    listAssetReferences: async () => ({
      references: [],
      problems: [...seenProblems],
    }),
  };
  const first = new CompanionService({
    atlasPath: "/base.webp",
    storagePath: root,
    stateStore: state,
    interactions,
  });
  try {
    await first.initialize();
    assert.equal(seenProblems[0].id, "cat");
    assert.ok((await first.getSnapshot()).notice?.includes("cat"));
    await first.dispose();
    await rm(dir, { recursive: true });
    await writeFile(dir, "unreadable as directory");
    const second = new CompanionService({
      atlasPath: "/base.webp",
      storagePath: root,
      stateStore: state,
      interactions,
    });
    await second.initialize();
    assert.equal((await second.getSnapshot()).instances[0].petId, "builtin");
    assert.equal(seenProblems[0].id, "cat");
    await second.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
import { CatalogService } from "../src/host/catalog-service.js";
import { PetStore, type InstalledPet } from "../src/host/pet-store.js";
import type { PreparedPetPackage } from "../src/host/pet-package-preparation.js";
import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
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
  const service = new CompanionService({
    atlasPath: "/builtin.webp",
    storagePath: root,
    stateStore: withAssets(sceneStore),
    catalog,
    interactions,
  });
  try {
    await service.initialize();
    assert.equal(lookups, 0);
    assert.equal(
      (await service.getSnapshot()).installedPets[0].wardrobeStatus,
      "current",
    );
    const refreshed = await service.refreshWardrobe("builtin");
    assert.equal(refreshed.installedPets[0].wardrobeStatus, "current");
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
  const service = new CompanionService({
    atlasPath: "/builtin.webp",
    storagePath: root,
    stateStore: withAssets(store),
    interactions,
  });
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
  const service = new CompanionService({
    atlasPath: "/builtin.webp",
    storagePath: root,
    stateStore: withAssets(store),
    interactions,
  });
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
    read: async () => {
      reads++;
      return scene;
    },
    mutate: async (command: SceneStoreCommand) => {
      scene = applySceneCommand(scene, command);
      return scene;
    },
    dispose: async () => {},
  };
  const service = new CompanionService({
    atlasPath: "/builtin.webp",
    storagePath: root,
    stateStore: withAssets(store),
    interactions,
  });
  try {
    await service.initialize();
    const events: string[] = [];
    let resolveEvent!: () => void;
    const observed = new Promise<void>((resolve) => {
      resolveEvent = resolve;
    });
    service.onSnapshot((snapshot) => {
      events.push(snapshot.instances[0].name);
      resolveEvent();
    });
    await service.getSnapshot();
    assert.deepEqual(events, []);
    scene = applySceneCommand(scene, {
      type: "renameInstance",
      instanceId: "seed",
      name: "External",
    });
    await writeFile(join(root, "scene.sqlite-journal"), "change");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        observed,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Watcher did not refresh")),
            3000,
          );
        }),
      ]);
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
    initialize: async () => {
      await rm(storage, { recursive: true, force: true });
      return scene;
    },
    read: async () => scene,
    mutate: async () => scene,
    dispose: async () => {},
  };
  let firstRead = true;
  const stateStore = {
    ...withAssets(store),
    listAssetReferences: async () => {
      if (firstRead) {
        firstRead = false;
        await rm(storage, { recursive: true, force: true });
      }
      return { references: [], problems: [] };
    },
  };
  const service = new CompanionService({
    atlasPath: "/builtin.webp",
    storagePath: storage,
    stateStore,
    log: (message) => logs.push(message),
    interactions,
  });
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
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const store = {
    initialize: async () => scene,
    read: async () => {
      const prior = scene;
      started();
      await gate;
      return prior;
    },
    mutate: async (command: SceneStoreCommand) => {
      scene = applySceneCommand(scene, command);
      return scene;
    },
    dispose: async () => {},
  };
  const service = new CompanionService({
    atlasPath: "/builtin.webp",
    storagePath: root,
    stateStore: withAssets(store),
    interactions,
  });
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
  const lookup = new Promise<CatalogPetV3>((resolve) => {
    resolveLookup = resolve;
  });
  class DeferredCatalog extends CatalogService {
    override find(): Promise<CatalogPetV3> {
      return lookup;
    }
  }
  const store = {
    initialize: async () => scene,
    read: async () => scene,
    mutate: async (command: SceneStoreCommand) => {
      scene = applySceneCommand(scene, command);
      return scene;
    },
    dispose: async () => {},
  };
  const service = new CompanionService({
    atlasPath: "/builtin.webp",
    storagePath: root,
    stateStore: withAssets(store),
    catalog: new DeferredCatalog(new AbortController().signal),
    interactions,
  });
  try {
    await service.initialize();
    const published: string[] = [];
    service.onSnapshot((snapshot) =>
      published.push(snapshot.instances[0].name),
    );
    const refresh = service.refreshWardrobe("builtin");
    const renamed = await service.renameInstance("seed", "Renamed");
    assert.equal(renamed.instances[0].name, "Renamed");
    resolveLookup({
      id: "hoodie-cat",
      displayName: "Cat",
      description: "Cat",
      thumbnail: "https://openpets.dev/pets/a",
      spritesheet: "https://openpets.dev/pets/b",
      zip: "https://zip.openpets.dev/pets/a",
      category: "western",
      original: true,
    });
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
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  class DeferredCatalog extends CatalogService {
    override async find(
      _id: string,
      signal?: AbortSignal,
    ): Promise<CatalogPetV3> {
      signalSeen = signal;
      await gate;
      signal?.throwIfAborted();
      throw new Error("Unexpected successful lookup");
    }
  }
  const scene = createDefaultScene("seed");
  const store = {
    initialize: async () => scene,
    read: async () => scene,
    mutate: async () => scene,
    dispose: async () => {},
  };
  const service = new CompanionService({
    atlasPath: "/builtin.webp",
    storagePath: root,
    stateStore: withAssets(store),
    catalog: new DeferredCatalog(new AbortController().signal),
    interactions,
  });
  try {
    await service.initialize();
    let publications = 0;
    service.onSnapshot(() => {
      publications++;
    });
    const refresh = service.refreshWardrobe("builtin");
    const rejected = assert.rejects(refresh);
    let closed = false;
    const disposal = service.dispose().then(() => {
      closed = true;
    });
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
