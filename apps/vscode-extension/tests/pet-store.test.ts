import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import type { CatalogPetV3 } from "@open-pets/pet-format/catalog-validation";
import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
import { Preferences, writePreferenceRecord } from "../src/host/preferences.js";
import { PetStore } from "../src/host/pet-store.js";
import { CompanionService } from "../src/host/companion-service.js";
import { CatalogService } from "../src/host/catalog-service.js";

function zip(entries: Record<string, string>): Buffer {
  const data: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const file = Buffer.from(name),
      body = Buffer.from(text),
      crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(file.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(file.length, 28);
    central.writeUInt32LE(offset, 42);
    data.push(local, file, body);
    directory.push(central, file);
    offset += local.length + file.length + body.length;
  }
  const index = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...data, index, end]);
}

test("failed replacement preserves the installed reference and previous generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-store-"));
  let rejectWrite = false;
  const preferences = new Preferences(root, async (path, value) => {
    if (rejectWrite) throw new Error("state write failed");
    await writePreferenceRecord(path, value);
  });
  const pet: CatalogPetV3 = {
    id: "cat",
    displayName: "Cat",
    description: "Cat",
    thumbnail: "https://openpets.dev/pets/cat.webp",
    spritesheet: "https://openpets.dev/pets/cat.webp",
    zip: "https://zip.openpets.dev/pets/cat.zip",
    category: "western",
    original: true,
  };
  const validate: ConstructorParameters<typeof PetStore>[2] = async (
    path,
    id,
  ) => {
    const metadata = JSON.parse(await readFile(join(path, "pet.json"), "utf8"));
    if (metadata.id !== id) throw new Error("wrong pet");
    return { metadata, layout: getPetSpriteLayout({}), availableOutfitIds: [] };
  };
  const cleanupErrors: string[] = [];
  const store = new PetStore(
    root,
    preferences,
    validate,
    (message) => cleanupErrors.push(message),
    async () => {
      throw new Error("cleanup failed");
    },
  );
  const originalFetch = globalThis.fetch;
  let archive = zip({
    "pet.json": JSON.stringify({
      id: "cat",
      displayName: "Cat",
      description: "Cat",
      spritesheetPath: "spritesheet.webp",
    }),
    "spritesheet.webp": "old",
  });
  globalThis.fetch = async (input) => {
    const response = new Response(new Uint8Array(archive), { status: 200 });
    Object.defineProperty(response, "url", { value: String(input) });
    return response;
  };
  try {
    await preferences.initialize();
    await store.initialize();
    const previous = await store.install(
      pet,
      false,
      new AbortController().signal,
    );
    const reference = preferences.installed("cat");
    archive = zip({
      "pet.json": JSON.stringify({
        id: "cat",
        displayName: "Cat",
        description: "Cat",
        spritesheetPath: "spritesheet.webp",
      }),
      "spritesheet.webp": "new",
    });
    rejectWrite = true;
    await assert.rejects(
      store.install(pet, false, new AbortController().signal),
      /state write failed/,
    );
    assert.equal(cleanupErrors.length, 2);
    assert.deepEqual(preferences.installed("cat"), reference);
    assert.equal(
      await readFile(join(previous.root, "spritesheet.webp"), "utf8"),
      "old",
    );
    assert.equal(
      (await store.load("cat", new AbortController().signal)).root,
      previous.root,
    );
    await store.dispose();
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("shutdown aborts the active download and queued installs do not start", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-shutdown-"));
  const preferences = new Preferences(root);
  const pet: CatalogPetV3 = {
    id: "cat",
    displayName: "Cat",
    description: "Cat",
    thumbnail: "https://openpets.dev/pets/cat.webp",
    spritesheet: "https://openpets.dev/pets/cat.webp",
    zip: "https://zip.openpets.dev/pets/cat.zip",
    category: "western",
    original: true,
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
    getIndex: async () => index,
    getSearch: async () => [
      {
        id: "cat",
        displayName: "Cat",
        searchText: "cat",
        category: "western",
        catalogPage: 0,
        original: true,
      },
    ],
    getPage: async () => [pet],
  });
  const store = new PetStore(root, preferences);
  const service = new CompanionService(
    preferences,
    "/builtin.webp",
    root,
    () => {},
    catalog,
    store,
  );
  const originalFetch = globalThis.fetch;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests++;
    started();
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(signal.reason);
      else
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
    });
  };
  try {
    await service.initialize();
    const first = service.installPet("cat");
    const second = service.installPet("cat");
    const results = Promise.allSettled([first, second]);
    await startedPromise;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await assert.rejects(
        Promise.race([
          service.setSize("large"),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error("control did not settle promptly")),
              1000,
            );
          }),
        ]),
        /installation is in progress/,
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    await service.dispose();
    assert.deepEqual(
      (await results).map((result) => result.status),
      ["rejected", "rejected"],
    );
    assert.equal(requests, 1);
    assert.equal(preferences.installed("cat"), undefined);
    assert.equal(preferences.size, "medium");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("offline startup restores saved pet and falls back from a corrupt outfit", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-offline-"));
  const preferences = new Preferences(root);
  const pet: CatalogPetV3 = {
    id: "cat",
    displayName: "Cat",
    description: "Cat",
    thumbnail: "https://openpets.dev/pets/cat.webp",
    spritesheet: "https://openpets.dev/pets/cat.webp",
    zip: "https://zip.openpets.dev/pets/cat.zip",
    category: "western",
    original: true,
  };
  const metadata = {
    id: "cat",
    displayName: "Cat",
    description: "Cat",
    spritesheetPath: "spritesheet.webp",
    wardrobe: {
      outfits: [
        { id: "hat", displayName: "Hat", spritesheetPath: "outfits/hat.webp" },
      ],
      schedule: [],
    },
  };
  const validator: ConstructorParameters<typeof PetStore>[2] = async (path) => {
    const valid = await readFile(
      join(path, "outfits", "hat.webp"),
      "utf8",
    ).then(
      (value) => value === "good",
      () => false,
    );
    return {
      metadata: {
        ...metadata,
        spritesheetPath: "spritesheet.webp",
        wardrobe: {
          outfits: [
            {
              id: "hat",
              displayName: "Hat",
              spritesheetPath: "outfits/hat.webp",
            },
          ],
          schedule: [],
        },
      },
      layout: getPetSpriteLayout({}),
      availableOutfitIds: valid ? ["hat"] : [],
      ...(valid ? {} : { outfitProblems: ["hat: invalid"] }),
    };
  };
  const store = new PetStore(root, preferences, validator);
  const archive = zip({
    "pet.json": JSON.stringify(metadata),
    "spritesheet.webp": "base",
    "outfits/hat.webp": "good",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const response = new Response(new Uint8Array(archive));
    Object.defineProperty(response, "url", { value: String(input) });
    return response;
  };
  try {
    await preferences.initialize();
    await store.initialize();
    const installed = await store.install(
      pet,
      false,
      new AbortController().signal,
    );
    await preferences.setPet("cat");
    await preferences.setOutfit("cat", "hat");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(installed.root, "outfits", "hat.webp"), "bad");
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    const service = new CompanionService(
      preferences,
      "/builtin.webp",
      root,
      () => {},
      undefined,
      store,
    );
    await service.initialize();
    const snapshot = await service.getSnapshot();
    assert.equal(snapshot.active.petId, "cat");
    assert.equal(snapshot.active.outfitId, "default");
    assert.ok(snapshot.notice);
    assert.match(
      snapshot.installedPets.find((item) => item.id === "cat")?.problem ?? "",
      /hat/,
    );
    await service.dispose();
    globalThis.fetch = async (input) => {
      const response = new Response(new Uint8Array(archive));
      Object.defineProperty(response, "url", { value: String(input) });
      return response;
    };
    const repaired = await store.install(
      pet,
      false,
      new AbortController().signal,
    );
    assert.notEqual(repaired.root, installed.root);
    assert.equal(
      await readFile(join(installed.root, "outfits", "hat.webp"), "utf8"),
      "bad",
    );
    assert.equal(
      await readFile(join(repaired.root, "outfits", "hat.webp"), "utf8"),
      "good",
    );
    assert.deepEqual(
      (await store.load("cat", new AbortController().signal)).package
        .availableOutfitIds,
      ["hat"],
    );
    await store.dispose();
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("the bundled companion can install and manually select its catalog wardrobe", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-builtin-"));
  const preferences = new Preferences(root);
  const metadata = {
    id: "hoodie-cat",
    displayName: "Hoodie Cat",
    description: "Cat",
    spritesheetPath: "spritesheet.webp" as const,
    wardrobe: {
      outfits: [
        {
          id: "hat",
          displayName: "Hat",
          spritesheetPath: "outfits/hat.webp" as const,
        },
      ],
      schedule: [],
    },
  };
  const pet: CatalogPetV3 = {
    id: "hoodie-cat",
    displayName: "Hoodie Cat",
    description: "Cat",
    thumbnail: "https://openpets.dev/pets/cat.webp",
    spritesheet: "https://openpets.dev/pets/cat.webp",
    zip: "https://zip.openpets.dev/pets/cat.zip",
    wardrobeZip: "https://zip.openpets.dev/pets/cat-wardrobe.zip",
    category: "western",
    original: true,
  };
  const archive = zip({
    "pet.json": JSON.stringify(metadata),
    "spritesheet.webp": "base",
    "outfits/hat.webp": "hat",
  });
  const cleanupErrors: string[] = [];
  const store = new PetStore(
    root,
    preferences,
    async () => ({
      metadata,
      layout: getPetSpriteLayout({}),
      availableOutfitIds: ["hat"],
    }),
    (message) => cleanupErrors.push(message),
    async () => {
      throw new Error("cleanup failed");
    },
  );
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
    getIndex: async () => index,
    getSearch: async () => [
      {
        id: "hoodie-cat",
        displayName: "Hoodie Cat",
        searchText: "cat",
        category: "western",
        catalogPage: 0,
        original: true,
      },
    ],
    getPage: async () => [pet],
  });
  const service = new CompanionService(
    preferences,
    "/builtin.webp",
    root,
    () => {},
    catalog,
    store,
  );
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = async (input) => {
    requested = String(input);
    const response = new Response(new Uint8Array(archive));
    Object.defineProperty(response, "url", { value: requested });
    return response;
  };
  try {
    await service.initialize();
    assert.equal((await service.listCatalog("", 0)).pets[0].installed, false);
    const installed = await service.installWardrobe("builtin");
    assert.ok(cleanupErrors.length);
    assert.ok(preferences.installed("hoodie-cat"));
    assert.ok(installed.installedPets.some((item) => item.id === "hoodie-cat"));
    assert.equal((await service.listCatalog("", 0)).pets[0].installed, true);
    assert.equal(requested, pet.wardrobeZip);
    assert.equal(installed.selectedPetId, "builtin");
    assert.equal(installed.active.outfitId, "default");
    const dressed = await service.selectOutfit("builtin", "hat");
    assert.equal(dressed.active.petId, "builtin");
    assert.equal(dressed.active.outfitId, "hat");
    assert.equal(
      (await service.selectOutfit("builtin", "default")).active.outfitId,
      "default",
    );
    await service.dispose();
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
