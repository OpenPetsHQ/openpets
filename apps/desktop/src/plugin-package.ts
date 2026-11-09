import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, posix } from "node:path";
import yauzl from "yauzl";
import type { Entry, ZipFile } from "yauzl";
import { collectDeclaredPluginFiles, preparePluginFileBytes } from "./plugin-assets.js";
import { SUPPORTED_LOCALES } from "./i18n/catalog.js";
import { type PluginCatalogEntry, type PluginCatalogEntryV2 } from "./plugin-catalog-validation.js";
import { defaultMaxPluginManifestBytes, readSafePluginManifest, isUnderPath } from "./plugin-manifest-reader.js";
import { OPENPETS_PLUGIN_MANIFEST_FILENAME, validatePluginManifest, type OpenPetsPluginManifest } from "./plugin-manifest.js";
import { marketplaceOrigin } from "./plugin-marketplace.js";

const maxZipBytes = 16 * 1024 * 1024;
const maxPluginEntryBytes = 1024 * 1024;
const maxPluginZipEntries = 2 + 32 * 5 + 8;
const maxPluginZipUncompressedBytes = 32 * 1024 * 1024;
const maxPluginZipFileBytes = 5 * 1024 * 1024;
export type PluginPackageInstall = { readonly manifest: OpenPetsPluginManifest; readonly installPath: string; readonly manifestPath: string; readonly entryPath?: string };

type AnyPluginCatalogEntry = PluginCatalogEntry | PluginCatalogEntryV2;

export async function downloadCatalogPluginZip(entry: AnyPluginCatalogEntry, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  validatePluginZipUrl(entry.downloadUrl);
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30_000);
  try { const response = await fetchImpl(entry.downloadUrl, { signal: controller.signal, credentials: "omit", redirect: "error" }); if (!response.ok) throw new Error(`Plugin ZIP download failed with HTTP ${response.status}.`); return await readLimitedResponse(response, maxZipBytes); }
  finally { clearTimeout(timeout); }
}

export function validatePluginZipUrl(value: string): void { const url = new URL(value); if (url.origin !== marketplaceOrigin() || url.username || url.password || url.hash) throw new Error("Plugin ZIP URL is not allowed."); }

export async function readCatalogPluginManifestFromZip(options: { readonly catalogEntry: AnyPluginCatalogEntry; readonly zip: Buffer; readonly maxManifestBytes?: number; readonly maxEntryBytes?: number }): Promise<{ readonly manifest: OpenPetsPluginManifest; readonly manifestText: string; readonly entryText?: string; readonly declaredFiles?: ReadonlyMap<string, Buffer> }> {
  if (options.zip.length > maxZipBytes) throw new Error("Plugin ZIP is too large.");
  if (!/^[0-9a-f]{64}$/.test(options.catalogEntry.sha256) || createHash("sha256").update(options.zip).digest("hex") !== options.catalogEntry.sha256) {
    throw new Error("Plugin ZIP checksum mismatch.");
  }
  const parsed = await readPluginManifestFromZip(options);
  if (parsed.manifest.id !== options.catalogEntry.id || parsed.manifest.version !== options.catalogEntry.version) throw new Error("Plugin manifest identity or version mismatch.");
  return parsed;
}

export async function readPluginManifestFromZip(options: { readonly zip: Buffer; readonly maxManifestBytes?: number; readonly maxEntryBytes?: number }): Promise<{ readonly manifest: OpenPetsPluginManifest; readonly manifestText: string; readonly entryText?: string; readonly declaredFiles?: ReadonlyMap<string, Buffer> }> {
  if (options.zip.length > maxZipBytes) throw new Error("Plugin ZIP is too large.");
  const files = await readPluginZipFiles(options.zip, options.maxManifestBytes ?? defaultMaxPluginManifestBytes, options.maxEntryBytes ?? maxPluginEntryBytes);
  const text = files.get(OPENPETS_PLUGIN_MANIFEST_FILENAME)?.toString("utf8");
  if (text === undefined) throw new Error("Plugin ZIP must contain openpets.plugin.json.");
  const parsed = JSON.parse(text) as unknown; const result = validatePluginManifest(parsed); if (!result.ok) throw new Error(`Plugin manifest validation failed: ${formatManifestValidationErrors(result.errors)}`);
  const manifest = result.manifest;
  let entryText: string | undefined;
  if (manifest.manifestVersion === 2) {
    entryText = files.get(manifest.entry)?.toString("utf8");
    if (entryText === undefined || files.size !== 2) throw new Error("JavaScript plugin ZIP must contain exactly manifest and entry file.");
  } else if (manifest.manifestVersion === 3) {
    entryText = files.get(manifest.entry)?.toString("utf8");
    if (entryText === undefined) throw new Error("JavaScript plugin ZIP is missing the entry file.");
    const declared = collectDeclaredPluginFiles(manifest);
    const declaredFiles = new Map<string, Buffer>();
    for (const file of declared) {
      const bytes = files.get(file.relPath);
      if (bytes === undefined) throw new Error(`Plugin ZIP is missing declared file: ${file.relPath}`);
      declaredFiles.set(file.relPath, preparePluginFileBytes(file, bytes));
    }
    const localeFiles = collectPluginLocaleZipFiles(files);
    for (const relPath of localeFiles) declaredFiles.set(relPath, files.get(relPath)!);
    return { manifest, manifestText: text, entryText, declaredFiles };
  } else if (files.size !== 1) throw new Error("Plugin ZIP must contain exactly one root manifest file.");
  return { manifest, manifestText: text, entryText };
}

export async function stageCatalogPluginPackage(options: { readonly userDataPath: string; readonly catalogEntry: AnyPluginCatalogEntry; readonly zip: Buffer; readonly maxManifestBytes?: number }): Promise<PluginPackageInstall & { readonly stagePath: string }> {
  const { manifest, manifestText: text, entryText, declaredFiles } = await readCatalogPluginManifestFromZip(options);
  const root = join(options.userDataPath, "plugins"); await fs.mkdir(root, { recursive: true }); await assertDir(root);
  const installPath = join(root, manifest.id); const manifestPath = join(installPath, OPENPETS_PLUGIN_MANIFEST_FILENAME); const tempPath = join(root, `.tmp-${manifest.id}-${randomUUID()}`);
  const entryPath = manifest.manifestVersion === 2 || manifest.manifestVersion === 3 ? join(installPath, manifest.entry) : undefined;
  try {
    await fs.rm(tempPath, { recursive: true, force: true });
    await fs.mkdir(tempPath, { recursive: false, mode: 0o700 });
    await assertDir(tempPath);
    await fs.writeFile(join(tempPath, OPENPETS_PLUGIN_MANIFEST_FILENAME), text, { mode: 0o600 });
    if ((manifest.manifestVersion === 2 || manifest.manifestVersion === 3) && entryPath && entryText !== undefined) {
      if (Buffer.byteLength(entryText) > maxPluginEntryBytes) throw new Error("Plugin entry file is too large.");
      const tempEntryPath = join(tempPath, manifest.entry);
      await fs.mkdir(dirname(tempEntryPath), { recursive: true, mode: 0o700 });
      await fs.writeFile(tempEntryPath, entryText, { mode: 0o600 });
      for (const [relPath, bytes] of declaredFiles ?? new Map<string, Buffer>()) {
        const filePath = join(tempPath, relPath);
        await fs.mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
        await fs.writeFile(filePath, bytes, { mode: 0o600 });
      }
    }
    await readSafePluginManifest({ installPath: tempPath, manifestPath: join(tempPath, OPENPETS_PLUGIN_MANIFEST_FILENAME), allowedPluginRoots: [root], maxManifestBytes: options.maxManifestBytes, expectedId: manifest.id, expectedVersion: manifest.version });
  } catch (e) { await fs.rm(tempPath, { recursive: true, force: true }); throw e; }
  return { manifest, installPath, manifestPath, entryPath, stagePath: tempPath };
}

export async function resolveSafePluginInstallDir(userDataPath: string, id: string, installPath: string, source: "catalog" | "local"): Promise<string> { const root = join(userDataPath, source === "catalog" ? "plugins" : "plugins-dev"); await assertDir(root); const stat = await fs.lstat(installPath); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Plugin install directory is invalid."); const realRoot = await fs.realpath(root); const realInstall = await fs.realpath(installPath); if (!isUnderPath(realInstall, realRoot) || realInstall !== join(realRoot, id)) throw new Error("Refusing to delete unexpected plugin directory."); return realInstall; }

export async function safeDeletePluginInstallDir(userDataPath: string, id: string, installPath: string, source: "catalog" | "local"): Promise<void> { const realInstall = await resolveSafePluginInstallDir(userDataPath, id, installPath, source); await fs.rm(realInstall, { recursive: true, force: true }); }

function collectPluginLocaleZipFiles(files: ReadonlyMap<string, Buffer>): string[] { const locales = new Set(SUPPORTED_LOCALES.map((locale) => `locales/${locale}.json`)); return [...files.keys()].filter((name) => locales.has(name)); }
function formatManifestValidationErrors(errors: readonly { readonly path: string; readonly code: string; readonly message: string }[]): string { return errors.slice(0, 6).map((error) => `${error.path} ${error.code}: ${error.message}`).join("; "); }
async function readPluginZipFiles(zip: Buffer, maxManifestBytes: number, maxEntryBytes: number): Promise<Map<string, Buffer>> { const zipFile = await new Promise<ZipFile>((res, rej) => yauzl.fromBuffer(zip, { lazyEntries: true, validateEntrySizes: true }, (e, z) => e || !z ? rej(e ?? new Error("Unable to open plugin ZIP.")) : res(z))); const files = new Map<string, Buffer>(); let entryCount = 0; let totalUncompressed = 0; await new Promise<void>((resolve, reject) => { zipFile.on("error", reject); zipFile.on("end", resolve); zipFile.on("entry", (entry: Entry) => { try { if (entry.fileName.endsWith("/")) { zipFile.readEntry(); return; } entryCount += 1; if (entryCount > maxPluginZipEntries) throw new Error("Plugin ZIP contains too many entries."); totalUncompressed += entry.uncompressedSize; if (totalUncompressed > maxPluginZipUncompressedBytes) throw new Error("Plugin ZIP uncompressed size is too large."); const name = validateEntry(entry); if (files.has(name)) throw new Error("Plugin ZIP contains duplicate entry path."); const limit = name === OPENPETS_PLUGIN_MANIFEST_FILENAME ? maxManifestBytes : name.endsWith(".js") || name.endsWith(".mjs") ? maxEntryBytes : maxPluginZipFileBytes; if (entry.uncompressedSize > limit) throw new Error(name === OPENPETS_PLUGIN_MANIFEST_FILENAME ? "Plugin manifest is too large." : "Plugin entry file is too large."); zipFile.openReadStream(entry, (err, stream) => { if (err || !stream) return reject(err ?? new Error("Unable to read plugin ZIP entry.")); const chunks: Buffer[] = []; let total = 0; stream.on("data", (chunk: Buffer) => { total += chunk.length; if (total > limit) { stream.destroy(new Error("Plugin ZIP entry is too large.")); return; } chunks.push(chunk); }); stream.on("error", reject); stream.on("end", () => { files.set(name, Buffer.concat(chunks)); zipFile.readEntry(); }); }); } catch (e) { reject(e); } }); zipFile.readEntry(); }).finally(() => zipFile.close()); return files; }
function validateEntry(entry: Entry): string { const normalized = posix.normalize(entry.fileName); if (entry.fileName.includes("\\") || entry.fileName.includes("\0") || entry.fileName.startsWith("/") || /^[A-Za-z]:/.test(entry.fileName) || normalized !== entry.fileName || normalized.startsWith("../") || normalized === "." || normalized.includes("/../")) throw new Error("Plugin ZIP entry path is invalid."); if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) throw new Error("Unsupported plugin ZIP entry compression method."); const type = (entry.externalFileAttributes >>> 16) & 0o170000; if (type === 0o120000 || (type !== 0 && type !== 0o100000)) throw new Error("Plugin ZIP entry type is unsupported."); if (entry.generalPurposeBitFlag & 0x1) throw new Error("Encrypted plugin ZIP entries are unsupported."); return normalized; }
async function assertDir(path: string): Promise<void> { const stat = await fs.lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Plugin directory is invalid."); }
async function readLimitedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Plugin ZIP response body is unavailable.");
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Plugin ZIP is too large.");
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } finally { await reader.cancel(); }
}
