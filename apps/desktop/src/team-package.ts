import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, posix } from "node:path";
import yauzl from "yauzl";
import type { Entry, ZipFile } from "yauzl";

import { readCatalogPluginManifestFromZip } from "./plugin-package.js";
import { validatePluginConfigReplacement } from "./plugin-config.js";
import { validatePluginManifest, type OpenPetsPluginManifest } from "./plugin-manifest.js";
import type { TeamPackItem } from "./team-protocol.js";

const maxZipBytes = 50 * 1024 * 1024;
const maxFiles = 500;
const maxUncompressed = 200 * 1024 * 1024;
const safeId = /^[a-z0-9][a-z0-9._-]{0,62}$/;

export type StagedTeamArtifact = {
  readonly item: TeamPackItem;
  readonly stagingPath: string;
  readonly manifest?: OpenPetsPluginManifest;
  readonly petMetadata?: {
    readonly id: string;
    readonly displayName: string;
    readonly description: string;
  };
};
export type ActivatedTeamArtifact = {
  readonly target: string;
  readonly commit: () => Promise<void>;
  readonly rollback: () => Promise<void>;
};

export async function stageTeamArtifact(userDataPath: string, item: TeamPackItem, bytes: Buffer): Promise<StagedTeamArtifact> {
  if (bytes.byteLength !== item.size || bytes.byteLength > maxZipBytes || bytes[0] !== 0x50 || bytes[1] !== 0x4b || createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw new Error("Team artifact is invalid or has the wrong checksum or size.");
  const files = await readZipFiles(bytes);
  const root = join(userDataPath, item.type === "pet" ? "team-pets" : "team-plugins");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const stagingPath = join(root, `.staging-${item.id}-${process.pid}-${Date.now()}`);
  await fs.mkdir(stagingPath, { mode: 0o700 });
  try {
    if (item.type === "pet") {
      const pet = validatePetFiles(files, item.id);
      await writeFiles(stagingPath, files);
      return { item, stagingPath, petMetadata: pet };
    }
    const manifestBytes = files.get("openpets.plugin.json");
    if (!manifestBytes) throw new Error("Team plugin is missing openpets.plugin.json.");
    const parsed = JSON.parse(manifestBytes.toString("utf8")) as unknown;
    const result = validatePluginManifest(parsed);
    if (!result.ok || result.manifest.manifestVersion !== 3 || result.manifest.id !== item.id || result.manifest.version !== item.version || result.manifest.runtime !== "javascript") throw new Error("Team plugin manifest does not match the Team Pack.");
    const checked = await readCatalogPluginManifestFromZip({ catalogEntry: {} as never, zip: bytes });
    if (!validatePluginConfigReplacement(checked.manifest, item.config ?? {}).ok) throw new Error("Team plugin configuration does not match its manifest.");
    await writeFiles(stagingPath, files);
    return { item, stagingPath, manifest: checked.manifest };
  } catch (error) { await fs.rm(stagingPath, { recursive: true, force: true }); throw error; }
}

export async function activateTeamArtifact(
  userDataPath: string,
  staged: StagedTeamArtifact,
): Promise<ActivatedTeamArtifact> {
  const root = join(userDataPath, staged.item.type === "pet" ? "team-pets" : "team-plugins");
  const target = join(root, staged.item.id);
  const backup = `${target}.previous-${process.pid}-${Date.now()}`;
  let hadTarget = false;
  try {
    try {
      await fs.rename(target, backup);
      hadTarget = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.rename(staged.stagingPath, target);
    let settled = false;
    return {
      target,
      commit: async () => {
        if (settled) return;
        settled = true;
        if (hadTarget) await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
      },
      rollback: async () => {
        if (settled) return;
        settled = true;
        await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
        if (hadTarget) await fs.rename(backup, target).catch(() => undefined);
      },
    };
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
    if (hadTarget) await fs.rename(backup, target).catch(() => undefined);
    await fs.rm(staged.stagingPath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function removeTeamArtifact(
  userDataPath: string,
  type: TeamPackItem["type"],
  id: string,
): Promise<void> {
  if (!safeId.test(id)) throw new Error("Team item id is invalid.");
  await fs.rm(join(userDataPath, type === "pet" ? "team-pets" : "team-plugins", id), { recursive: true, force: true });
}

export async function discardStagedTeamArtifact(staged: StagedTeamArtifact): Promise<void> {
  await fs.rm(staged.stagingPath, { recursive: true, force: true });
}

function validatePetFiles(files: Map<string, Buffer>, expectedId: string): { id: string; displayName: string; description: string } {
  const petBytes = files.get("pet.json"); const sprite = files.get("spritesheet.webp");
  if (!petBytes || !sprite || files.size !== 2 || petBytes.byteLength > 128 * 1024 || sprite.byteLength < 16 || sprite.toString("ascii", 0, 4) !== "RIFF" || sprite.toString("ascii", 8, 12) !== "WEBP") throw new Error("Team pet package does not match the OpenPets pet format.");
  const value = JSON.parse(petBytes.toString("utf8")) as Record<string, unknown>;
  if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.id) || value.id !== expectedId || typeof value.displayName !== "string" || value.displayName.trim() === "" || value.displayName.length > 80 || typeof value.description !== "string" || value.description.trim() === "" || value.description.length > 500 || value.spritesheetPath !== "spritesheet.webp") throw new Error("Team pet metadata does not match the Team Pack.");
  return { id: value.id, displayName: value.displayName.trim(), description: value.description.trim() };
}

async function readZipFiles(bytes: Buffer): Promise<Map<string, Buffer>> {
  const zip = await new Promise<ZipFile>((resolvePromise, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, file) => error || !file ? reject(error ?? new Error("Unable to open Team artifact.")) : resolvePromise(file)));
  const files = new Map<string, Buffer>(); let count = 0; let total = 0;
  await new Promise<void>((resolvePromise, reject) => {
    let settled = false;
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error instanceof Error ? error : new Error("Unable to read Team artifact.")); } };
    zip.on("error", fail); zip.on("end", () => { if (!settled) { settled = true; resolvePromise(); } });
    zip.on("entry", (entry: Entry) => { void readEntry(zip, entry).then(({ name, content }) => { if (name.endsWith("/")) { zip.readEntry(); return; } count += 1; total += content.byteLength; if (count > maxFiles || total > maxUncompressed || files.has(name)) throw new Error("Team artifact contains too many, duplicate, or oversized files."); files.set(name, content); zip.readEntry(); }).catch(fail); });
    zip.readEntry();
  }).finally(() => zip.close());
  const names = [...files.keys()]; const prefixed = names.filter((name) => name.startsWith(" "));
  if (prefixed.length) throw new Error("Team artifact path is invalid.");
  if (!files.has("pet.json") && !files.has("openpets.plugin.json")) {
    const prefixes = [...new Set(names.map((name) => name.split("/")[0]))];
    if (prefixes.length !== 1) throw new Error("Team artifact must have a root package.");
    const prefix = `${prefixes[0]}/`; const normalized = new Map<string, Buffer>(); for (const [name, content] of files) { if (!name.startsWith(prefix)) throw new Error("Team artifact layout is invalid."); normalized.set(name.slice(prefix.length), content); } return normalized;
  }
  return files;
}

function readEntry(zip: ZipFile, entry: Entry): Promise<{ name: string; content: Buffer }> {
  const normalized = posix.normalize(entry.fileName);
  if (entry.fileName.endsWith("/")) {
    if (entry.fileName.includes("\\") || entry.fileName.includes("\0") || entry.fileName.startsWith("/") || normalized !== entry.fileName || normalized.startsWith("../") || normalized.includes("/../")) return Promise.reject(new Error("Team artifact contains an unsafe ZIP directory."));
    return Promise.resolve({ name: entry.fileName, content: Buffer.alloc(0) });
  }
  const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
  if (entry.fileName.length > 1024 || entry.fileName.includes("\\") || entry.fileName.includes("\0") || entry.fileName.startsWith("/") || normalized !== entry.fileName || normalized.startsWith("../") || normalized.includes("/../") || entry.isEncrypted() || (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) || entry.uncompressedSize > 100 * 1024 * 1024 || (unixType !== 0 && unixType !== 0o100000)) return Promise.reject(new Error("Team artifact contains an unsafe ZIP entry."));
  return new Promise((resolvePromise, reject) => zip.openReadStream(entry, (error, stream) => { if (error || !stream) return reject(error ?? new Error("Unable to read Team artifact entry.")); const chunks: Buffer[] = []; stream.on("data", (chunk: Buffer) => chunks.push(chunk)); stream.on("error", reject); stream.on("end", () => resolvePromise({ name: normalized, content: Buffer.concat(chunks) })); }));
}

async function writeFiles(root: string, files: Map<string, Buffer>): Promise<void> { for (const [name, content] of files) { const path = join(root, name); await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 }); await fs.writeFile(path, content, { mode: 0o600 }); } }
