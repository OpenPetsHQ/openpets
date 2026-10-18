import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

import sharp from "sharp";

const testRoot = realpathSync(mkdtempSync(join(tmpdir(), "openpets-wardrobe-install-")));
const userDataPath = join(testRoot, "user-data");
const petsRoot = join(userDataPath, "pets");
const fakeHome = join(testRoot, "home");
const catalogZipUrl = "https://zip.openpets.dev/pets/zip-wardrobe/zip-wardrobe.zip";
const catalogWardrobeZipUrl = "https://zip.openpets.dev/pets/zip-wardrobe/zip-wardrobe.wardrobe.zip";
const catalogModule = `data:text/javascript,${encodeURIComponent(`
  export async function getCatalogPet(petId) {
    if (petId !== "zip-wardrobe") throw new Error("Unexpected catalog pet request.");
    return {
      id: "zip-wardrobe",
      displayName: "ZIP Wardrobe",
      description: "Catalog wardrobe pet",
      preview: "https://openpets.dev/pets/zip-wardrobe/thumb.webp",
      zip: ${JSON.stringify(catalogZipUrl)},
      ...(globalThis.__offerWardrobeZip ? { wardrobeZip: ${JSON.stringify(catalogWardrobeZipUrl)} } : {}),
    };
  }
`)}`;
const electronMock = `data:text/javascript,${encodeURIComponent(`
  export const app = { getPath: (name) => name === "userData" ? ${JSON.stringify(userDataPath)} : "" };
  export const net = {};
  export const powerMonitor = { on: () => {}, getSystemIdleTime: () => 0 };
  export const screen = { on: () => {}, getAllDisplays: () => [] };
  export const shell = { openPath: async () => "" };
  export default { app, net, powerMonitor, screen, shell };
`)}`;
const petPathsMock = `data:text/javascript,${encodeURIComponent(`
  import { join, resolve, sep } from "node:path";
  export function getPetsRoot() { return ${JSON.stringify(petsRoot)}; }
  export function getPetDir(petId, source) {
    const root = source === "team" ? join(${JSON.stringify(petsRoot)}, "..", "team-pets") : ${JSON.stringify(petsRoot)};
    return resolve(root, petId);
  }
  export function getInstalledPetDir(petId) { return getPetDir(petId, "personal"); }
  export function getTeamPetDir(petId) { return getPetDir(petId, "team"); }
  export function assertSafePetId(petId) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(petId) || petId === "builtin") throw new Error("Invalid installed pet id.");
  }
  export function assertInsideRoot(root, target) {
    const resolvedRoot = resolve(root);
    const resolvedTarget = resolve(target);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + sep)) throw new Error("Resolved path escapes pets root.");
  }
`)}`;

register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "electron") return { url: ${JSON.stringify(electronMock)}, shortCircuit: true };
    if (specifier === "./pet-paths.js" && context.parentURL.includes("/apps/desktop/.test-dist/src/")) {
      return { url: ${JSON.stringify(petPathsMock)}, shortCircuit: true };
    }
    if (specifier === "./catalog.js" && context.parentURL.endsWith("/pet-installation.js")) {
      return { url: ${JSON.stringify(catalogModule)}, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

const originalHome = process.env.HOME;
process.env.HOME = fakeHome;
const originalFetch = globalThis.fetch;
let releaseStartupInstallLock = (): void => {};

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(files: readonly { readonly name: string; readonly contents: Buffer }[]): Buffer {
  const localEntries: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const checksum = crc32(file.contents);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(file.contents.length, 18);
    localHeader.writeUInt32LE(file.contents.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localEntries.push(localHeader, name, file.contents);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(file.contents.length, 20);
    centralHeader.writeUInt32LE(file.contents.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralEntries.push(centralHeader, name);
    localOffset += localHeader.length + name.length + file.contents.length;
  }

  const centralDirectory = Buffer.concat(centralEntries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localEntries, centralDirectory, end]);
}

try {
  mkdirSync(fakeHome, { recursive: true });
  const appState = await import("../src/app-state.js");
  releaseStartupInstallLock = appState.releaseStartupInstallLock;
  const { installPetFromFolderWithResult, installPetFromZipFileWithResult, installPet } = await import("../src/pet-installation.js");
  const { importCodexPet } = await import("../src/codex-pets.js");
  const { readInstalledPetMetadata, readInstalledPetSpritesheet } = await import("../src/installed-pet-layout.js");

  appState.initializeAppState();
  const atlas = async (red: number): Promise<Buffer> => sharp({
    create: { width: 1536, height: 2288, channels: 4, background: { r: red, g: 0, b: 0, alpha: 0 } },
  }).webp().toBuffer();
  const base = await atlas(0);
  const pajamas = await atlas(10);
  const svgOutfit = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="2288" viewBox="0 0 1536 2288"><circle cx="20" cy="20" r="10" fill="red"/></svg>');
  const metadata = (id: string) => ({
    id,
    displayName: "Wardrobe Pet",
    description: "Pet with outfits",
    spritesheetPath: "spritesheet.webp",
    spriteVersionNumber: 2,
    wardrobe: {
      outfits: [
        { id: "pajamas", displayName: "Pajamas", spritesheetPath: "outfits/pajamas.webp" },
        { id: "santa", displayName: "Santa", spritesheetPath: "outfits/santa.svg" },
      ],
      schedule: [{ outfit: "pajamas", when: { time: { from: "22:00", to: "07:00" } } }],
    },
  });
  const writePetFolder = (dir: string, id: string): void => {
    mkdirSync(join(dir, "outfits"), { recursive: true });
    writeFileSync(join(dir, "pet.json"), JSON.stringify(metadata(id)));
    writeFileSync(join(dir, "spritesheet.webp"), base);
    writeFileSync(join(dir, "outfits", "pajamas.webp"), pajamas);
    writeFileSync(join(dir, "outfits", "santa.svg"), svgOutfit);
  };
  const assertInstalledWardrobe = async (id: string): Promise<void> => {
    assert.deepEqual((await readInstalledPetMetadata(id)).wardrobe?.outfits.map((outfit) => outfit.id), ["pajamas", "santa"], `${id} keeps its wardrobe manifest`);
    assert.deepEqual((await readInstalledPetSpritesheet(id)).bytes, base, `${id} base atlas is unchanged`);
    assert.deepEqual((await readInstalledPetSpritesheet(id, "personal", "pajamas")).bytes, pajamas, `${id} serves its WebP outfit`);
    const santa = await readInstalledPetSpritesheet(id, "personal", "santa");
    assert.equal(santa.mimeType, "image/svg+xml", `${id} serves its SVG outfit`);
    await assert.rejects(() => readInstalledPetSpritesheet(id, "personal", "missing"), `${id} rejects undeclared outfits`);
  };

  // Every install route carries the outfits along with the base atlas.
  const folder = join(testRoot, "folder-wardrobe");
  writePetFolder(folder, "folder-wardrobe");
  await installPetFromFolderWithResult(folder);
  await assertInstalledWardrobe("folder-wardrobe");

  writePetFolder(join(fakeHome, ".codex", "pets", "codex-wardrobe"), "codex-wardrobe");
  await importCodexPet("codex-wardrobe");
  await assertInstalledWardrobe("codex-wardrobe");

  const zipFiles = (id: string, prefix: string) => [
    { name: `${prefix}pet.json`, contents: Buffer.from(JSON.stringify(metadata(id))) },
    { name: `${prefix}spritesheet.webp`, contents: base },
    { name: `${prefix}outfits/pajamas.webp`, contents: pajamas },
    { name: `${prefix}outfits/santa.svg`, contents: svgOutfit },
  ];
  const zipPath = join(testRoot, "wardrobe.zip");
  writeFileSync(zipPath, createStoredZip(zipFiles("root-zip-wardrobe", "")));
  await installPetFromZipFileWithResult(zipPath);
  await assertInstalledWardrobe("root-zip-wardrobe");
  writeFileSync(zipPath, createStoredZip([{ name: "nested/outfits/", contents: Buffer.alloc(0) }, ...zipFiles("nested-zip-wardrobe", "nested/")]));
  await installPetFromZipFileWithResult(zipPath);
  await assertInstalledWardrobe("nested-zip-wardrobe");

  // Catalog: an old-style entry installs the outfit-free base `zip`; once the
  // catalog offers `wardrobeZip`, "Get outfits" swaps in the full package and
  // keeps the user's wardrobe preferences, and fresh installs prefer it.
  const { installPetWardrobe } = await import("../src/pet-installation.js");
  const baseZip = createStoredZip([
    { name: "zip-wardrobe/pet.json", contents: Buffer.from(JSON.stringify({ ...metadata("zip-wardrobe"), wardrobe: undefined })) },
    { name: "zip-wardrobe/spritesheet.webp", contents: base },
  ]);
  const wardrobeZipBytes = createStoredZip(zipFiles("zip-wardrobe", "zip-wardrobe/"));
  const served = new Map([[catalogZipUrl, baseZip], [catalogWardrobeZipUrl, wardrobeZipBytes]]);
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    const body = served.get(url);
    assert.ok(body, `unexpected download ${url}`);
    const response = new Response(body, { status: 200, headers: { "content-length": String(body.length) } });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  const offer = (enabled: boolean): void => { (globalThis as { __offerWardrobeZip?: boolean }).__offerWardrobeZip = enabled; };
  offer(false);
  await installPet("zip-wardrobe");
  assert.equal((await readInstalledPetMetadata("zip-wardrobe")).wardrobe, undefined, "the base package installs without outfits");
  await assert.rejects(() => installPetWardrobe("zip-wardrobe"), /no outfits/, "no upgrade without a catalog wardrobe package");
  appState.setPetWardrobePreference("zip-wardrobe", { outfit: "pajamas" });
  offer(true);
  await installPetWardrobe("zip-wardrobe");
  await assertInstalledWardrobe("zip-wardrobe");
  assert.equal(appState.getPetWardrobePreference("zip-wardrobe")?.outfit, "pajamas", "preferences survive the package swap");
  const upgraded = appState.getAppStateSnapshot().pets.installed.find((pet) => pet.id === "zip-wardrobe");
  assert.equal(upgraded?.source && "zip" in upgraded.source ? upgraded.source.zip : undefined, catalogWardrobeZipUrl, "the installed source records the wardrobe package");
  const { removePet } = await import("../src/pet-installation.js");
  await removePet("zip-wardrobe");
  requested.length = 0;
  await installPet("zip-wardrobe");
  assert.deepEqual(requested, [catalogWardrobeZipUrl], "fresh installs prefer the wardrobe package");
  await assertInstalledWardrobe("zip-wardrobe");

  // A package must contain exactly the outfits its manifest declares, each a valid atlas.
  const rejected: Array<[string, readonly { readonly name: string; readonly contents: Buffer }[]]> = [
    ["missing declared outfit", zipFiles("bad-wardrobe", "").filter((file) => file.name !== "outfits/santa.svg")],
    ["undeclared outfit", [...zipFiles("bad-wardrobe", ""), { name: "outfits/extra.webp", contents: pajamas }]],
    ["outfit with the wrong atlas size", zipFiles("bad-wardrobe", "").map((file) => file.name === "outfits/pajamas.webp" ? { ...file, contents: svgOutfit } : file)],
    ["outfits without a wardrobe", [
      { name: "pet.json", contents: Buffer.from(JSON.stringify({ ...metadata("bad-wardrobe"), wardrobe: undefined })) },
      { name: "spritesheet.webp", contents: base },
      { name: "outfits/pajamas.webp", contents: pajamas },
    ]],
    ["outfit nested too deep", [...zipFiles("bad-wardrobe", "").filter((file) => file.name !== "outfits/santa.svg"), { name: "outfits/deep/santa.svg", contents: svgOutfit }]],
  ];
  for (const [label, files] of rejected) {
    writeFileSync(zipPath, createStoredZip(files));
    await assert.rejects(() => installPetFromZipFileWithResult(zipPath), Error, label);
    assert.equal(existsSync(join(petsRoot, "bad-wardrobe")), false, `${label}: a rejected package never promotes assets`);
  }

  // Legacy V1 base atlases are not decoded, but a V1 outfit is new content: an
  // undecodable outfit would render a blank pet, so it is rejected at install.
  const v1Folder = join(testRoot, "v1-wardrobe");
  mkdirSync(join(v1Folder, "outfits"), { recursive: true });
  writeFileSync(join(v1Folder, "pet.json"), JSON.stringify({ ...metadata("v1-wardrobe"), spriteVersionNumber: undefined, wardrobe: { outfits: [{ id: "pajamas", displayName: "Pajamas", spritesheetPath: "outfits/pajamas.webp" }] } }));
  writeFileSync(join(v1Folder, "spritesheet.webp"), Buffer.from("legacy v1 bytes are not decoded"));
  writeFileSync(join(v1Folder, "outfits", "pajamas.webp"), Buffer.from("not a webp"));
  await assert.rejects(() => installPetFromFolderWithResult(v1Folder), /Outfit spritesheet/, "an undecodable V1 outfit is rejected");
  assert.equal(existsSync(join(petsRoot, "v1-wardrobe")), false);
  writeFileSync(join(v1Folder, "outfits", "pajamas.webp"), await sharp({ create: { width: 1536, height: 1872, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).webp().toBuffer());
  await installPetFromFolderWithResult(v1Folder);
  assert.equal((await readInstalledPetMetadata("v1-wardrobe")).wardrobe?.outfits.length, 1, "a decodable V1 outfit installs");

  // Pets without a wardrobe keep installing exactly as before.
  const plainFolder = join(testRoot, "plain-pet");
  mkdirSync(plainFolder);
  writeFileSync(join(plainFolder, "pet.json"), JSON.stringify({ ...metadata("plain-pet"), wardrobe: undefined }));
  writeFileSync(join(plainFolder, "spritesheet.webp"), base);
  await installPetFromFolderWithResult(plainFolder);
  assert.equal((await readInstalledPetMetadata("plain-pet")).wardrobe, undefined);
  assert.equal(existsSync(join(petsRoot, "plain-pet", "outfits")), false);
} finally {
  releaseStartupInstallLock();
  globalThis.fetch = originalFetch;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(testRoot, { recursive: true, force: true });
}

console.error("Pet wardrobe installation contract passed.");
