import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

import sharp from "sharp";

const testRoot = realpathSync(mkdtempSync(join(tmpdir(), "openpets-gaze-anchor-install-")));
const userDataPath = join(testRoot, "user-data");
const petsRoot = join(userDataPath, "pets");
const fakeHome = join(testRoot, "home");
const catalogZipUrl = "https://zip.openpets.dev/pets/zip-pet/zip-pet.zip";
const catalogModule = `data:text/javascript,${encodeURIComponent(`
  export async function getCatalogPet(petId) {
    if (petId !== "zip-pet") throw new Error("Unexpected catalog pet request.");
    return {
      id: "zip-pet",
      displayName: "ZIP Pet",
      description: "Package-owned gaze anchor",
      preview: "https://openpets.dev/pets/zip-pet/thumb.webp",
      zip: ${JSON.stringify(catalogZipUrl)},
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
  const { installPetFromFolderWithResult, installPet } = await import("../src/pet-installation.js");
  const { importCodexPet } = await import("../src/codex-pets.js");
  const { readInstalledPetMetadata } = await import("../src/installed-pet-layout.js");

  appState.initializeAppState();
  const spritesheet = await sharp({
    create: {
      width: 1536,
      height: 2288,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).webp().toBuffer();

  const folderPath = join(testRoot, "folder-pet");
  mkdirSync(folderPath, { recursive: true });
  writeFileSync(join(folderPath, "pet.json"), JSON.stringify({
    id: "folder-pet",
    displayName: "Folder Pet",
    description: "Folder import anchor",
    spritesheetPath: "spritesheet.webp",
    spriteVersionNumber: 2,
    gazeAnchor: { x: 0.5, y: 0.25 },
  }));
  writeFileSync(join(folderPath, "spritesheet.webp"), spritesheet);
  await installPetFromFolderWithResult(folderPath);
  assert.deepEqual((await readInstalledPetMetadata("folder-pet")).gazeAnchor, { x: 0.5, y: 0.25 }, "folder installation retains the validated package anchor");

  const codexPetPath = join(fakeHome, ".codex", "pets", "codex-pet");
  mkdirSync(codexPetPath, { recursive: true });
  writeFileSync(join(codexPetPath, "pet.json"), JSON.stringify({
    id: "codex-pet",
    displayName: "Codex Pet",
    description: "Codex import anchor",
    spritesheetPath: "spritesheet.webp",
    spriteVersionNumber: 2,
    gazeAnchor: { x: 0.5, y: 0.25 },
  }));
  writeFileSync(join(codexPetPath, "spritesheet.webp"), spritesheet);
  await importCodexPet("codex-pet");
  assert.deepEqual((await readInstalledPetMetadata("codex-pet")).gazeAnchor, { x: 0.5, y: 0.25 }, "Codex import retains the validated package anchor");

  const zipBytes = createStoredZip([
    {
      name: "pet.json",
      contents: Buffer.from(JSON.stringify({
        id: "zip-pet",
        displayName: "ZIP Pet",
        description: "Package-owned gaze anchor",
        spritesheetPath: "spritesheet.webp",
        spriteVersionNumber: 2,
        gazeAnchor: { x: 0.5, y: 0.25 },
      })),
    },
    { name: "spritesheet.webp", contents: spritesheet },
  ]);
  globalThis.fetch = async (input) => {
    assert.equal(String(input), catalogZipUrl);
    const response = new Response(zipBytes, { status: 200, headers: { "content-length": String(zipBytes.length) } });
    Object.defineProperty(response, "url", { value: catalogZipUrl });
    return response;
  };
  await installPet("zip-pet");
  assert.deepEqual((await readInstalledPetMetadata("zip-pet")).gazeAnchor, { x: 0.5, y: 0.25 }, "catalog ZIP pet.json remains authoritative when the catalog entry omits gazeAnchor");

} finally {
  releaseStartupInstallLock();
  globalThis.fetch = originalFetch;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(testRoot, { recursive: true, force: true });
}
