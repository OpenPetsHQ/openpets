import { randomUUID } from "node:crypto";
import { lstat, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readBoundedRegularFile } from "@open-pets/pet-format/node/files";
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
  private readonly installedRecords = new Map<string, unknown>();

  constructor(
    private readonly storage: string,
    private readonly write = writePreferenceRecord,
    private readonly log: (message: string) => void = () => {},
  ) {
    this.root = join(storage, "preferences");
  }

  async initialize(): Promise<void> {
    this.installedRecords.clear();
    await ensureDirectory(this.storage);
    await ensureDirectory(this.root);
    await ensureDirectory(join(this.root, "installed"));
    for (const name of await readdir(join(this.root, "installed"))) {
      const id = name.endsWith(".json") ? name.slice(0, -5) : "";
      if (!safeId.test(id) || id === "builtin") continue;
      this.installedRecords.set(
        id,
        await this.read(join(this.root, "installed", name)),
      );
    }
  }
  installedIds(): string[] {
    return [...this.installedRecords.keys()];
  }
  installed(id: string): unknown {
    return this.installedRecords.get(id);
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
