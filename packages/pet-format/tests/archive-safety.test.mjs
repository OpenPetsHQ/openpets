import assert from "node:assert/strict";
import { WriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { defaultPetZipLimits, detectPetZipFormat, extractPetZip } from "../dist/node/archive.js";
import { readBoundedRegularFile } from "../dist/node/files.js";

const limits = {
  maxZipDownloadBytes: 1024,
  maxExtractedTotalBytes: 64,
  maxFiles: 1,
  maxIndividualFileBytes: 64,
  maxCodexPetJsonBytes: 8,
};

function storedZip(name, content, unixMode = 0, compressed = false) {
  const filename = Buffer.from(name);
  const bytes = Buffer.from(content);
  const encoded = compressed ? deflateRawSync(bytes) : bytes;
  const local = Buffer.alloc(30 + filename.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(compressed ? 8 : 0, 8);
  local.writeUInt32LE(encoded.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(filename.length, 26);
  filename.copy(local, 30);
  const central = Buffer.alloc(46 + filename.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(unixMode ? 0x0314 : 20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(compressed ? 8 : 0, 10);
  central.writeUInt32LE(encoded.length, 20);
  central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE((unixMode << 16) >>> 0, 38);
  filename.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + encoded.length, 16);
  return Buffer.concat([local, encoded, central, end]);
}

test("archive extraction enforces entry paths, modes and metadata limits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openpets-archive-"));
  try {
    assert.deepEqual(await extractPetZip(storedZip("pet.json", "{}"), dir, { limits }), ["pet.json"]);
    assert.equal(await readFile(join(dir, "pet.json"), "utf8"), "{}");
    await assert.rejects(extractPetZip(storedZip("../pet.json", "{}"), dir, { limits }));
    await assert.rejects(extractPetZip(storedZip("pet.json", "{}", 0o120777), dir, { limits }));
    await assert.rejects(extractPetZip(storedZip("pet.json", "123456789"), dir, { limits }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("default limits retain the desktop archive bounds and extract wrapper layouts", async () => {
  assert.equal(defaultPetZipLimits.maxZipDownloadBytes, 50 * 1024 * 1024);
  assert.equal(defaultPetZipLimits.maxExtractedTotalBytes, 200 * 1024 * 1024);
  assert.equal(defaultPetZipLimits.maxIndividualFileBytes, 100 * 1024 * 1024);
  assert.equal(defaultPetZipLimits.maxFiles, 500);
  assert.equal(defaultPetZipLimits.maxCodexPetJsonBytes, 128 * 1024);
  const dir = await mkdtemp(join(tmpdir(), "openpets-archive-"));
  try {
    assert.deepEqual(await extractPetZip(storedZip("wrapper/pet.json", "{}"), dir), ["pet.json"]);
    assert.equal(await readFile(join(dir, "pet.json"), "utf8"), "{}");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an already aborted extraction does not create files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openpets-archive-"));
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(extractPetZip(storedZip("pet.json", "{}"), dir, { signal: controller.signal }), { name: "AbortError" });
    await assert.rejects(stat(join(dir, "pet.json")), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const compressed of [false, true]) test(`aborting an active ${compressed ? "deflated" : "stored"} write drains streams before staging cleanup`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "openpets-archive-"));
  const controller = new AbortController();
  const zip = storedZip("spritesheet.webp", Buffer.alloc(32 * 1024 * 1024, 1), 0, compressed);
  const write = WriteStream.prototype._write;
  WriteStream.prototype._write = function (chunk, encoding, callback) {
    write.call(this, chunk, encoding, callback);
    setImmediate(() => controller.abort());
  };
  try {
    await assert.rejects(extractPetZip(zip, dir, { signal: controller.signal }), { name: "AbortError" });
    assert.equal(controller.signal.aborted, true);
    const file = join(dir, "spritesheet.webp");
    const sizeAtRejection = (await stat(file)).size;
    assert.ok(sizeAtRejection < 32 * 1024 * 1024);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await stat(file)).size, sizeAtRejection);
    await rm(dir, { recursive: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await assert.rejects(stat(dir), { code: "ENOENT" });
  } finally {
    WriteStream.prototype._write = write;
    await rm(dir, { recursive: true, force: true });
  }
});

test("bounded file reads reject symlinks and oversized or empty files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openpets-files-"));
  try {
    const file = join(dir, "file");
    await writeFile(file, "abc");
    assert.equal((await readBoundedRegularFile(file, 3, "file")).toString(), "abc");
    await assert.rejects(readBoundedRegularFile(file, 2, "file"));
    await symlink(file, join(dir, "link"));
    await assert.rejects(readBoundedRegularFile(join(dir, "link"), 3, "file"));
    await writeFile(file, "");
    await assert.rejects(readBoundedRegularFile(file, 3, "file"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("archive format detection reads a bounded manifest before format-specific extraction", async () => {
  assert.equal(await detectPetZipFormat(storedZip("wrapper/pet.json", '{"format":"motion"}')), "motion");
  assert.equal(await detectPetZipFormat(storedZip("pet.json", "{}")), "classic");
  await assert.rejects(detectPetZipFormat(storedZip("../pet.json", '{"format":"motion"}')));
  await assert.rejects(detectPetZipFormat(storedZip("pet.json", "123456789"), limits));
  const dir = await mkdtemp(join(tmpdir(), "openpets-motion-zip-"));
  try {
    await assert.rejects(extractPetZip(storedZip("clips/idle.webp", "clip"), dir));
    await extractPetZip(storedZip("clips/idle.webp", "clip"), dir, { format: "motion" });
    assert.equal(await readFile(join(dir, "clips/idle.webp"), "utf8"), "clip");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function storedEntriesZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name);
    const bytes = Buffer.from(content);
    const local = Buffer.alloc(30 + filename.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(filename.length, 26);
    filename.copy(local, 30);
    const central = Buffer.alloc(46 + filename.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    filename.copy(central, 46);
    localParts.push(local, bytes);
    centralParts.push(central);
    offset += local.length + bytes.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

test("format detection accepts root and wrapper layouts but rejects ambiguous manifests", async () => {
  const manifest = '{"format":"motion"}';
  for (const prefix of ["", "cat/"]) {
    const zip = storedEntriesZip([[`${prefix}pet.json`, manifest], [`${prefix}clips/idle.webp`, "clip"]]);
    const format = await detectPetZipFormat(zip);
    const dir = await mkdtemp(join(tmpdir(), "motion-zip-"));
    try {
      await extractPetZip(zip, dir, { format });
      assert.equal(await readFile(join(dir, "clips/idle.webp"), "utf8"), "clip");
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  await assert.rejects(detectPetZipFormat(storedEntriesZip([["pet.json", manifest], ["cat/pet.json", "{}"]])));
  await assert.rejects(detectPetZipFormat(storedEntriesZip([["cat/pet.json", manifest], ["dog/pet.json", "{}"]])));
});
