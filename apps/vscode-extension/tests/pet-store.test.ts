import { strict as assert } from "node:assert";
import { test } from "node:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { crc32 } from "node:zlib";
import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
import { PetStore, type AssetReferenceAccess } from "../src/host/pet-store.js";
import type { Receipt } from "../src/host/asset-reference.js";
import { convertLegacyCatalogReceipt } from "../src/host/asset-reference.js";

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

test("catalog and local commits retain old generations and reload without the source ZIP", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-store-"));
  const manifest = { id: "cat", displayName: "Cat", description: "Cat", spritesheetPath: "spritesheet.webp" as const };
  const references = new Map<string, Receipt>();
  let failure: "conflict" | "unknown" | undefined;
  const access: AssetReferenceAccess = {
    readAssetReference: async (id) => references.get(id) ?? null,
    compareAndSwapAssetReference: async (id, expected, receipt) => {
      if (failure === "unknown") throw Object.assign(new Error("unknown"), { outcome: "unknown" });
      if (failure === "conflict" || (references.get(id)?.generation ?? null) !== expected) throw Object.assign(new Error("conflict"), { kind: "conflict" });
      references.set(id, receipt);
      return receipt;
    },
  };
  const log: string[] = [];
  const store = new PetStore(root, access, async () => ({ metadata: manifest, layout: getPetSpriteLayout({}), availableOutfitIds: [] }), (message) => log.push(message), async () => { throw new Error("cleanup failed"); });
  const signal = new AbortController().signal;
  const path = join(root, "source.zip");
  const makeZip = (base: string) => zip({ "pet.json": JSON.stringify(manifest), "spritesheet.webp": base });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => { const response = new Response(new Uint8Array(makeZip("old"))); Object.defineProperty(response, "url", { value: String(input) }); return response; };
  try {
    await store.initialize();
    const pet = { id: "cat", displayName: "Cat", description: "Cat", thumbnail: "https://openpets.dev/a", spritesheet: "https://openpets.dev/b", zip: "https://zip.openpets.dev/pets/a.zip", category: "western" as const };
    const first = await store.commitPrepared(await store.prepareCatalog(pet, false, signal), null, signal);
    await writeFile(path, makeZip("new"));
    const replacement = await store.prepareLocal(path, undefined, signal);
    failure = "conflict";
    await assert.rejects(store.commitPrepared(replacement, first.receipt.generation, signal));
    assert.equal((await store.load("cat", signal)).receipt.generation, first.receipt.generation);
    assert.ok(log.length > 0);
    failure = undefined;
    const second = await store.commitPrepared(await store.prepareLocal(path, undefined, signal), first.receipt.generation, signal);
    await rm(path);
    assert.equal((await store.load("cat", signal)).receipt.source.kind, "local");
    assert.equal(await readFile(join(first.root, "spritesheet.webp"), "utf8"), "old");
    assert.equal(await readFile(join(second.root, "spritesheet.webp"), "utf8"), "new");
    await writeFile(path, makeZip("uncertain"));
    const unknown = await store.prepareLocal(path, undefined, signal);
    failure = "unknown";
    await assert.rejects(store.commitPrepared(unknown, second.receipt.generation, signal));
    assert.equal(await readFile(join(root, "pets", "cat", unknown.receipt.generation, "package", "spritesheet.webp"), "utf8"), "uncertain");
    assert.equal((await store.load("cat", signal)).receipt.generation, second.receipt.generation);
  } finally {
    globalThis.fetch = originalFetch;
    await store.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("a committed reference survives staging cleanup failure", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-store-cleanup-"));
  const metadata = { id: "cat", displayName: "Cat", description: "Cat", spritesheetPath: "spritesheet.webp" as const };
  const path = join(root, "pet.zip");
  await writeFile(path, zip({ "pet.json": JSON.stringify(metadata), "spritesheet.webp": "base" }));
  let reference: Receipt | null = null;
  let session = "";
  const logs: string[] = [];
  const store = new PetStore(root, {
    readAssetReference: async () => reference,
    compareAndSwapAssetReference: async (_id, _expected, receipt) => {
      reference = receipt;
      await chmod(session, 0);
      return receipt;
    },
  }, async () => ({ metadata, layout: getPetSpriteLayout({}), availableOutfitIds: [] }), (message) => logs.push(message));
  try {
    await store.initialize();
    const prepared = await store.prepareLocal(path, undefined, new AbortController().signal);
    session = dirname(prepared.candidate);
    const installed = await store.commitPrepared(prepared, null, new AbortController().signal);
    assert.deepEqual(reference, installed.receipt);
    assert.equal(await readFile(join(installed.root, "spritesheet.webp"), "utf8"), "base");
    assert.ok(logs.some((message) => message.includes("staging cleanup failed")));
  } finally {
    if (session) await chmod(session, 0o700);
    await store.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy immutable catalog receipt loads through its converted reference without rewriting it", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-store-legacy-"));
  const legacy = { version: 1, id: "cat", sha256: "a".repeat(64), generation: "12345678-1234-4123-8123-123456789abc", url: "https://zip.openpets.dev/pets/cat.zip" };
  const receipt = convertLegacyCatalogReceipt(legacy);
  const metadata = { id: "cat", displayName: "Cat", description: "Cat", spritesheetPath: "spritesheet.webp" as const };
  const generation = join(root, "pets", "cat", legacy.generation);
  await mkdir(join(generation, "package"), { recursive: true });
  const serialized = JSON.stringify(legacy);
  await writeFile(join(generation, "install.json"), serialized);
  await writeFile(join(generation, "package", "spritesheet.webp"), "original");
  const store = new PetStore(root, {
    readAssetReference: async () => receipt,
    compareAndSwapAssetReference: async () => { throw new Error("unexpected write"); },
  }, async (_path, id, _signal, installed) => {
    assert.equal(id, "cat");
    assert.equal(installed, true);
    return { metadata, layout: getPetSpriteLayout({}), availableOutfitIds: [] };
  });
  try {
    await store.initialize();
    const loaded = await store.load("cat", new AbortController().signal);
    assert.deepEqual(loaded.receipt, receipt);
    assert.deepEqual(loaded.receipt.source, { kind: "catalog", url: legacy.url });
    assert.equal(await readFile(join(generation, "install.json"), "utf8"), serialized);
    assert.equal(await readFile(join(loaded.root, "spritesheet.webp"), "utf8"), "original");
  } finally {
    await store.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("known CAS rejection removes the unreferenced promoted generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-store-conflict-"));
  const metadata = { id: "cat", displayName: "Cat", description: "Cat", spritesheetPath: "spritesheet.webp" as const };
  const path = join(root, "pet.zip");
  await writeFile(path, zip({ "pet.json": JSON.stringify(metadata), "spritesheet.webp": "base" }));
  const store = new PetStore(root, {
    readAssetReference: async () => null,
    compareAndSwapAssetReference: async () => { throw Object.assign(new Error("conflict"), { kind: "conflict" }); },
  }, async () => ({ metadata, layout: getPetSpriteLayout({}), availableOutfitIds: [] }));
  try {
    await store.initialize();
    const candidate = await store.prepareLocal(path, undefined, new AbortController().signal);
    await assert.rejects(store.commitPrepared(candidate, null, new AbortController().signal));
    await assert.rejects(stat(join(root, "pets", "cat", candidate.receipt.generation)), { code: "ENOENT" });
  } finally {
    await store.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
