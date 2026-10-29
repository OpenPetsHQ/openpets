import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
import { PetPackagePreparation } from "../src/host/pet-package-preparation.js";

function archive(entries: Record<string, string>): Buffer {
  const files: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const filename = Buffer.from(name), data = Buffer.from(text), crc = crc32(data);
    const local = Buffer.alloc(30), entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    files.push(local, filename, data); central.push(entry, filename); offset += local.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, directory, end]);
}

test("local and catalog packages share validation, target checks and owned cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "package-prepare-"));
  const metadata = { id: "hoodie-cat", displayName: "Cat", description: "Cat", spritesheetPath: "spritesheet.webp", wardrobe: { outfits: [{ id: "hat", displayName: "Hat", spritesheetPath: "outfits/hat.webp" }], schedule: [] } };
  const bytes = archive({ "pet.json": JSON.stringify(metadata), "spritesheet.webp": "base", "outfits/hat.webp": "hat" });
  const path = join(root, "pet.zip");
  await writeFile(path, bytes);
  const seen: string[] = [];
  const validate: ConstructorParameters<typeof PetPackagePreparation>[1] = async (_root, id) => {
    seen.push(id);
    return { metadata: { ...metadata, spritesheetPath: "spritesheet.webp", wardrobe: { outfits: [{ id: "hat", displayName: "Hat", spritesheetPath: "outfits/hat.webp" }], schedule: [] } }, layout: getPetSpriteLayout({}), availableOutfitIds: ["hat"] };
  };
  const owner = new PetPackagePreparation(root, validate);
  const other = new PetPackagePreparation(root, validate);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => { const response = new Response(new Uint8Array(bytes)); Object.defineProperty(response, "url", { value: String(input) }); return response; };
  const signal = new AbortController().signal;
  try {
    const local = await owner.prepareLocal(path, "builtin", signal);
    assert.equal(local.id, "builtin");
    assert.equal(local.packageId, "hoodie-cat");
    assert.deepEqual(local.receipt.source, { kind: "local" });
    assert.equal(JSON.stringify(local.receipt).includes(path), false);
    const pet = { id: "hoodie-cat", displayName: "Cat", description: "Cat", thumbnail: "https://openpets.dev/a", spritesheet: "https://openpets.dev/b", zip: "https://zip.openpets.dev/pets/a.zip", category: "western" as const };
    const catalog = await owner.prepareCatalog(pet, false, signal);
    assert.deepEqual(seen, ["hoodie-cat", "hoodie-cat"]);
    assert.equal(catalog.receipt.source.kind, "catalog");
    await assert.rejects(other.discard(local));
    await assert.rejects(owner.prepareLocal(path, "other", signal));
    await owner.discard(local);
    await owner.discard(catalog);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(owner.prepareLocal(path, undefined, aborted.signal));
    const sessions = await readdir(join(root, "staging"));
    for (const session of sessions) assert.deepEqual(await readdir(join(root, "staging", session)), []);
  } finally {
    globalThis.fetch = originalFetch;
    await owner.dispose(); await other.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("targeted import rejects unusable wardrobe and cleans aborted validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "package-reject-"));
  const metadata = { id: "cat", displayName: "Cat", description: "Cat", spritesheetPath: "spritesheet.webp" as const };
  const path = join(root, "pet.zip");
  await writeFile(path, archive({ "pet.json": JSON.stringify(metadata), "spritesheet.webp": "base" }));
  const controller = new AbortController();
  let abortDuringValidation = false;
  const owner = new PetPackagePreparation(root, async () => {
    if (abortDuringValidation) controller.abort();
    return { metadata, layout: getPetSpriteLayout({}), availableOutfitIds: [] };
  });
  try {
    await assert.rejects(owner.prepareLocal(path, "cat", new AbortController().signal));
    abortDuringValidation = true;
    await assert.rejects(owner.prepareLocal(path, undefined, controller.signal));
    for (const session of await readdir(join(root, "staging"))) assert.deepEqual(await readdir(join(root, "staging", session)), []);
  } finally {
    await owner.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
