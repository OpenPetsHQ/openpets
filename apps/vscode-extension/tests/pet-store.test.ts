import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { crc32 } from "node:zlib";
import type { CatalogPetV3 } from "@open-pets/pet-format/catalog-validation";
import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
import { Preferences, writePreferenceRecord } from "../src/host/preferences.js";
import { PetStore } from "../src/host/pet-store.js";
import { CompanionService } from "../src/host/companion-service.js";
import { CatalogService } from "../src/host/catalog-service.js";
import { SceneStore } from "../src/host/scene-store.js";

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

test("bundled wardrobe installation preserves scene choices and repairs an offline corrupt outfit", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-wardrobe-repair-"));
  const workerPath = join(root, "worker.cjs");
  const preferences = new Preferences(root);
  const metadata = {
    id: "hoodie-cat", displayName: "Hoodie Cat", description: "Cat", spritesheetPath: "spritesheet.webp" as const,
    wardrobe: { outfits: [{ id: "hat", displayName: "Hat", spritesheetPath: "outfits/hat.webp" as const }], schedule: [] },
  };
  const pet: CatalogPetV3 = {
    id: metadata.id, displayName: metadata.displayName, description: metadata.description,
    thumbnail: "https://openpets.dev/pets/cat.webp", spritesheet: "https://openpets.dev/pets/cat.webp",
    zip: "https://zip.openpets.dev/pets/cat.zip", wardrobeZip: "https://zip.openpets.dev/pets/cat-wardrobe.zip",
    category: "western", original: true,
  };
  let catalogRequests = 0;
  const catalog = new CatalogService(new AbortController().signal, {
    getIndex: async () => { catalogRequests++; return { version: 3, generatedAt: "2026-01-01", total: 1, pageSize: 1, search: "", filters: { categories: [] }, pages: [""] }; },
    getSearch: async () => [{ id: pet.id, displayName: pet.displayName, searchText: "cat", category: "western", catalogPage: 0, original: true }],
    getPage: async () => [pet],
  });
  const validate: ConstructorParameters<typeof PetStore>[2] = async (path) => {
    const valid = await readFile(join(path, "outfits/hat.webp"), "utf8").then((value) => value === "good", () => false);
    return { metadata, layout: getPetSpriteLayout({}), availableOutfitIds: valid ? ["hat"] : [], ...(valid ? {} : { outfitProblems: ["hat: invalid"] }) };
  };
  const store = new PetStore(root, preferences, validate);
  let service: CompanionService | undefined;
  const originalFetch = globalThis.fetch;
  let base = "base";
  let requested = "";
  const online: typeof fetch = async (input) => {
    requested = String(input);
    const response = new Response(new Uint8Array(zip({ "pet.json": JSON.stringify(metadata), "spritesheet.webp": base, "outfits/hat.webp": "good" })));
    Object.defineProperty(response, "url", { value: requested });
    return response;
  };
  const makeService = () => new CompanionService(preferences, "/builtin.webp", root, () => {}, catalog, store, new SceneStore({ databasePath: join(root, "scene.sqlite"), workerPath }));
  try {
    await build({ entryPoints: [resolve("src/host/scene-worker.ts")], outfile: workerPath, bundle: true, platform: "node", format: "cjs", target: "node22" });
    globalThis.fetch = online;
    service = makeService();
    await service.initialize();
    const first = (await service.getSnapshot()).selectedInstanceId!;
    const second = (await service.addInstance("builtin", "Second")).selectedInstanceId!;
    assert.equal((await service.refreshWardrobe("builtin")).installedPets[0].wardrobeStatus, "install");
    const before = await service.getSnapshot();
    const installed = await service.installWardrobe("builtin");
    assert.equal(requested, pet.wardrobeZip);
    assert.deepEqual(installed.instances.map(({ id, outfitId }) => ({ id, outfitId })), before.instances.map(({ id, outfitId }) => ({ id, outfitId })));
    assert.equal(installed.selectedInstanceId, before.selectedInstanceId);
    const dressed = await service.setInstanceOutfit(first, "hat");
    assert.equal(dressed.instances.find((item) => item.id === first)?.outfitId, "hat");
    assert.equal(dressed.instances.find((item) => item.id === second)?.outfitId, "default");
    const previous = await store.load("hoodie-cat", new AbortController().signal);
    await writeFile(join(previous.root, "outfits/hat.webp"), "bad");
    await service.dispose();
    globalThis.fetch = async () => { throw new Error("offline"); };
    const requestsBeforeRestart = catalogRequests;
    service = makeService();
    await service.initialize();
    assert.equal(catalogRequests, requestsBeforeRestart);
    const fallback = (await service.getSnapshot()).instances.find((item) => item.id === first)!;
    assert.equal(fallback.outfitId, "hat");
    assert.equal(fallback.appearance.fallback, true);
    assert.equal(fallback.appearance.outfitName, "Default");
    base = "new generation";
    globalThis.fetch = online;
    const repairedSnapshot = await service.installWardrobe("builtin");
    const repaired = await store.load("hoodie-cat", new AbortController().signal);
    assert.notEqual(repaired.root, previous.root);
    assert.equal(await readFile(join(previous.root, "outfits/hat.webp"), "utf8"), "bad");
    assert.equal(await readFile(join(repaired.root, "outfits/hat.webp"), "utf8"), "good");
    assert.equal(repairedSnapshot.instances.find((item) => item.id === first)?.appearance.fallback, false);
    assert.equal(repairedSnapshot.instances.find((item) => item.id === first)?.outfitId, "hat");
  } finally {
    await service?.dispose();
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
