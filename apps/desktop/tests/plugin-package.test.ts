import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePluginCatalog } from "../src/plugin-catalog-validation.js";
import { stageCatalogPluginPackage, readPluginManifestFromZip, safeDeletePluginInstallDir, validatePluginZipUrl } from "../src/plugin-package.js";
import type { OpenPetsPluginManifest } from "../src/plugin-manifest.js";

const manifest: OpenPetsPluginManifest = { manifestVersion: 1, id: "zip-plug", name: "Zip Plug", version: "1.0.0", runtime: "declarative", permissions: ["timer", "pet:speak"], triggers: [{ on: "timer", everyMinutes: 5, actions: [{ type: "pet.speak", message: "hi" }] }] };
const text = JSON.stringify(manifest);
const zip = makeZip("openpets.plugin.json", Buffer.from(text));
assert.equal((await readPluginManifestFromZip({ zip })).manifest.id, manifest.id);
const entry = { id: manifest.id, name: manifest.name, version: manifest.version, description: "desc", runtime: "declarative" as const, permissions: manifest.permissions, downloadUrl: "https://studio-api.openpets.dev/api/marketplace/plugins/zip-plug/releases/1.0.0/download", sha256: createHash("sha256").update(zip).digest("hex") };

async function installCatalogPluginPackage(options: Parameters<typeof stageCatalogPluginPackage>[0]) {
  const staged = await stageCatalogPluginPackage(options);
  rmSync(staged.installPath, { recursive: true, force: true });
  renameSync(staged.stagePath, staged.installPath);
  return staged;
}

validatePluginZipUrl(entry.downloadUrl);
assert.throws(() => validatePluginZipUrl("http://zip.openpets.dev/plugins/x.zip"), /not allowed/);
assert.throws(() => validatePluginZipUrl("https://example.com:444/plugins/x.zip"), /not allowed/);
assert.throws(() => validatePluginZipUrl("https://user:pass@example.com/plugins/x.zip"), /not allowed/);

const userData = mkdtempSync(join(tmpdir(), "openpets-plugin-package-"));
const installed = await installCatalogPluginPackage({ userDataPath: userData, catalogEntry: entry, zip });
assert.equal(installed.manifest.id, manifest.id);
assert.equal(readFileSync(join(userData, "plugins", manifest.id, "openpets.plugin.json"), "utf8"), text);
await installCatalogPluginPackage({ userDataPath: userData, catalogEntry: { ...entry, name: "Other" }, zip });
await assert.rejects(() => installCatalogPluginPackage({ userDataPath: userData, catalogEntry: { ...entry, sha256: "0".repeat(64) }, zip }), /checksum/);
await assert.rejects(() => installCatalogPluginPackage({ userDataPath: userData, catalogEntry: { ...entry, id: "wrong-id" }, zip }), /identity/);
await assert.rejects(() => installCatalogPluginPackage({ userDataPath: userData, catalogEntry: { ...entry, version: "2.0.0" }, zip }), /version/);
assert.equal(readFileSync(join(userData, "plugins", manifest.id, "openpets.plugin.json"), "utf8"), text);
const nestedZip = makeZip("nested/openpets.plugin.json", Buffer.from(text));
await assert.rejects(() => installCatalogPluginPackage({ userDataPath: userData, catalogEntry: { ...entry, sha256: createHash("sha256").update(nestedZip).digest("hex") }, zip: nestedZip }), /invalid|exactly one root manifest|must contain openpets/);

const jsManifest: OpenPetsPluginManifest = { manifestVersion: 2, id: "js-plug", name: "JS Plug", version: "1.0.0", runtime: "javascript", sdkVersion: "1.0.0", entry: "index.mjs", permissions: ["pet:speak"] };
const jsText = JSON.stringify(jsManifest);
const jsEntryText = "export default {};\n";
const jsZip = makeZipFiles([{ name: "openpets.plugin.json", data: Buffer.from(jsText) }, { name: "index.mjs", data: Buffer.from(jsEntryText) }]);
const jsCatalogEntry = { id: jsManifest.id, name: jsManifest.name, version: jsManifest.version, description: "desc", runtime: "javascript" as const, sdkVersion: "1.0.0", permissions: jsManifest.permissions, downloadUrl: "https://zip.openpets.dev/plugins/js-plug.zip", sha256: createHash("sha256").update(jsZip).digest("hex") };
const jsInstalled = await installCatalogPluginPackage({ userDataPath: userData, catalogEntry: jsCatalogEntry, zip: jsZip });
assert.equal(readFileSync(join(jsInstalled.installPath, "index.mjs"), "utf8"), jsEntryText);
const missingEntryZip = makeZipFiles([{ name: "openpets.plugin.json", data: Buffer.from(jsText) }]);
await assert.rejects(() => installCatalogPluginPackage({ userDataPath: userData, catalogEntry: { ...jsCatalogEntry, sha256: createHash("sha256").update(missingEntryZip).digest("hex") }, zip: missingEntryZip }), /manifest and entry/);
const extraEntryZip = makeZipFiles([{ name: "openpets.plugin.json", data: Buffer.from(jsText) }, { name: "index.mjs", data: Buffer.from(jsEntryText) }, { name: "extra.js", data: Buffer.from("") }]);
await assert.rejects(() => installCatalogPluginPackage({ userDataPath: userData, catalogEntry: { ...jsCatalogEntry, sha256: createHash("sha256").update(extraEntryZip).digest("hex") }, zip: extraEntryZip }), /manifest and entry|too many entries/);

const v3Manifest: OpenPetsPluginManifest = { manifestVersion: 3, id: "v3-plug", name: "V3 Plug", version: "1.0.0", runtime: "javascript", sdkVersion: "3.0.0", entry: "index.js", assets: { icons: { plug: "assets/plug.svg" } }, permissions: ["pet:speak"] };
const v3Text = JSON.stringify(v3Manifest);
const v3Zip = makeZipFiles([
  { name: "openpets.plugin.json", data: Buffer.from(v3Text) },
  { name: "index.js", data: Buffer.from("export function register() {}\n") },
  { name: "assets/plug.svg", data: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"><text>ok</text></svg>") },
  { name: "locales/en.json", data: Buffer.from(JSON.stringify({ "plugin.name": "V3 Plug" })) },
]);
const v3CatalogEntry = { id: v3Manifest.id, name: v3Manifest.name, version: v3Manifest.version, description: "desc", runtime: "javascript" as const, sdkVersion: "3.0.0", permissions: v3Manifest.permissions, downloadUrl: "https://zip.openpets.dev/plugins/v3-plug.zip", sha256: createHash("sha256").update(v3Zip).digest("hex") };
const v3Installed = await installCatalogPluginPackage({ userDataPath: userData, catalogEntry: v3CatalogEntry, zip: v3Zip });
assert.equal(readFileSync(join(v3Installed.installPath, "locales", "en.json"), "utf8"), JSON.stringify({ "plugin.name": "V3 Plug" }));

const translatedV3Manifest: OpenPetsPluginManifest = { ...v3Manifest, id: "v3-translated", name: "$t:plugin.name" };
const translatedV3Text = JSON.stringify(translatedV3Manifest);
const translatedV3Zip = makeZipFiles([
  { name: "openpets.plugin.json", data: Buffer.from(translatedV3Text) },
  { name: "index.js", data: Buffer.from("export function register() {}\n") },
  { name: "assets/plug.svg", data: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>") },
  { name: "locales/en.json", data: Buffer.from(JSON.stringify({ "plugin.name": "Translated V3 Plug" })) },
]);
const translatedV3CatalogEntry = { ...v3CatalogEntry, id: translatedV3Manifest.id, name: "Translated V3 Plug", sha256: createHash("sha256").update(translatedV3Zip).digest("hex") };
await installCatalogPluginPackage({ userDataPath: userData, catalogEntry: translatedV3CatalogEntry, zip: translatedV3Zip });

const extraV3Zip = makeZipFiles([...[
  { name: "openpets.plugin.json", data: Buffer.from(v3Text) },
  { name: "index.js", data: Buffer.from("export function register() {}\n") },
  { name: "assets/plug.svg", data: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>") },
], { name: "extra.txt", data: Buffer.from("ok") }]);
await installCatalogPluginPackage({ userDataPath: userData, catalogEntry: { ...v3CatalogEntry, sha256: createHash("sha256").update(extraV3Zip).digest("hex") }, zip: extraV3Zip });

const canonicalEntry = validatePluginCatalog({ version: 1, generatedAt: new Date().toISOString(), plugins: [{ ...entry, permissions: ["timer", "pet:speak"] }] }).plugins[0];
await installCatalogPluginPackage({ userDataPath: userData, catalogEntry: canonicalEntry, zip });

const oldText = JSON.stringify({ ...manifest, version: "0.9.0" });
writeFileSync(join(userData, "plugins", manifest.id, "openpets.plugin.json"), oldText, "utf8");
await installCatalogPluginPackage({ userDataPath: userData, catalogEntry: entry, zip });
assert.equal(readFileSync(join(userData, "plugins", manifest.id, "openpets.plugin.json"), "utf8"), text);

const deleteRoot = mkdtempSync(join(tmpdir(), "openpets-plugin-delete-"));
const outside = mkdtempSync(join(tmpdir(), "openpets-plugin-outside-"));
symlinkSync(outside, join(deleteRoot, "plugins"), "dir");
await assert.rejects(() => safeDeletePluginInstallDir(deleteRoot, manifest.id, join(deleteRoot, "plugins", manifest.id), "catalog"), /invalid|unexpected/);

console.error("Plugin package validation passed.");

function makeZip(name: string, data: Buffer): Buffer {
  return makeZipFiles([{ name, data }]);
}

function makeZipFiles(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const nameBuffer = Buffer.from(file.name); const crc = crc32(file.data); const now = 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8); local.writeUInt32LE(now, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(file.data.length, 18); local.writeUInt32LE(file.data.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); central.writeUInt32LE(now, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(file.data.length, 20); central.writeUInt32LE(file.data.length, 24); central.writeUInt16LE(nameBuffer.length, 28); central.writeUInt32LE((0o100644 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    const localPart = Buffer.concat([local, nameBuffer, file.data]); locals.push(localPart); centrals.push(Buffer.concat([central, nameBuffer])); offset += localPart.length;
  }
  const localPart = Buffer.concat(locals); const centralPart = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralPart.length, 12); end.writeUInt32LE(localPart.length, 16); return Buffer.concat([localPart, centralPart, end]);
}

function crc32(buffer: Buffer): number { let crc = -1; for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
