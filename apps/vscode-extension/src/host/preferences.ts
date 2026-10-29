import { randomUUID } from "node:crypto";
import { lstat, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readBoundedRegularFile } from "@open-pets/pet-format/node/files";
import type { CompanionSize } from "../protocol.js";
import { ensureDirectory } from "./storage-directory.js";

const safeId = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function writePreferenceRecord(
  path: string,
  value: unknown,
): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    try {
      const stats = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink())
        throw new Error("Preference record is unsafe.");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } finally {
    // A stale private temp file cannot affect the committed record.
    await rm(temp, { force: true }).catch(() => {});
  }
}

export class Preferences {
  private readonly root: string;
  private readonly outfits = new Map<string, string>();
  private readonly installedRecords = new Map<string, unknown>();
  private selected = "builtin";
  private companionSize: CompanionSize = "medium";

  constructor(
    private readonly storage: string,
    private readonly write = writePreferenceRecord,
    private readonly log: (message: string) => void = () => {},
  ) {
    this.root = join(storage, "preferences");
  }

  async initialize(): Promise<void> {
    this.outfits.clear();
    this.installedRecords.clear();
    this.selected = "builtin";
    this.companionSize = "medium";
    await ensureDirectory(this.storage);
    await ensureDirectory(this.root);
    await ensureDirectory(join(this.root, "installed"));
    await ensureDirectory(join(this.root, "outfits"));
    const selected = await this.read(join(this.root, "selected.json"));
    if (typeof selected === "string" && safeId.test(selected))
      this.selected = selected;
    else if (selected !== undefined) this.invalid("selected.json");
    const size = await this.read(join(this.root, "size.json"));
    if (size === "small" || size === "medium" || size === "large")
      this.companionSize = size;
    else if (size !== undefined) this.invalid("size.json");
    for (const name of await readdir(join(this.root, "outfits"))) {
      const id = name.endsWith(".json") ? name.slice(0, -5) : "";
      if (!safeId.test(id)) continue;
      const outfit = await this.read(join(this.root, "outfits", name));
      if (
        typeof outfit === "string" &&
        /^[a-z0-9][a-z0-9_-]{0,31}$/.test(outfit) &&
        outfit !== "auto"
      )
        this.outfits.set(id, outfit);
      else if (outfit !== undefined) this.invalid(`outfits/${name}`);
    }
    for (const name of await readdir(join(this.root, "installed"))) {
      const id = name.endsWith(".json") ? name.slice(0, -5) : "";
      if (!safeId.test(id) || id === "builtin") continue;
      this.installedRecords.set(
        id,
        await this.read(join(this.root, "installed", name)),
      );
    }
  }
  get size(): CompanionSize {
    return this.companionSize;
  }
  get selectedPetId(): string {
    return this.selected;
  }
  outfit(id: string): string {
    return this.outfits.get(id) ?? "default";
  }
  installedIds(): string[] {
    return [...this.installedRecords.keys()];
  }
  installed(id: string): unknown {
    return this.installedRecords.get(id);
  }
  async setSize(size: CompanionSize): Promise<void> {
    if (size !== "small" && size !== "medium" && size !== "large")
      throw new Error("Invalid companion size.");
    await this.save(join(this.root, "size.json"), size);
    this.companionSize = size;
  }
  async setPet(id: string): Promise<void> {
    this.assertId(id);
    await this.save(join(this.root, "selected.json"), id);
    this.selected = id;
  }
  async setOutfit(id: string, outfitId: string): Promise<void> {
    this.assertId(id);
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(outfitId) || outfitId === "auto")
      throw new Error("Invalid outfit ID.");
    await this.save(join(this.root, "outfits", `${id}.json`), outfitId);
    this.outfits.set(id, outfitId);
  }
  async setInstalled(id: string, receipt: unknown): Promise<void> {
    this.assertId(id);
    if (id === "builtin") throw new Error("Invalid installed pet ID.");
    await this.save(join(this.root, "installed", `${id}.json`), receipt);
    this.installedRecords.set(id, receipt);
  }
  private assertId(id: string): void {
    if (!safeId.test(id)) throw new Error("Invalid pet ID.");
  }
  private async save(path: string, value: unknown): Promise<void> {
    await ensureDirectory(this.storage);
    await ensureDirectory(this.root);
    const directory = dirname(path);
    if (directory !== this.root) await ensureDirectory(directory);
    await this.write(path, value);
  }
  private async read(path: string): Promise<unknown> {
    try {
      const stats = await lstat(path);
      if (
        stats.isFile() &&
        !stats.isSymbolicLink() &&
        (stats.size === 0 || stats.size > 8192)
      ) {
        this.invalid(path);
        return undefined;
      }
      return JSON.parse(
        (
          await readBoundedRegularFile(path, 8192, "preference record")
        ).toString("utf8"),
      ) as unknown;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return undefined;
      if (error instanceof SyntaxError) {
        this.invalid(path);
        return undefined;
      }
      throw error;
    }
  }
  private invalid(record: string): void {
    this.log(`[storage] invalid preference record: ${record}`);
  }
}
