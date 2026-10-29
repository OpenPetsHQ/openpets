import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractPetZip } from "@open-pets/pet-format/node/archive";
import { readBoundedRegularFile } from "@open-pets/pet-format/node/files";
import type { CatalogPetV3 } from "@open-pets/pet-format/catalog-validation";
import { downloadPetZip } from "./download.js";
import {
  validatePetPackage,
  type ValidatedPetPackage,
} from "./package-validation.js";
import { Preferences } from "./preferences.js";
import { ensureDirectory } from "./storage-directory.js";

interface Receipt {
  version: 1;
  id: string;
  sha256: string;
  generation: string;
  url: string;
}
export interface InstalledPet {
  id: string;
  root: string;
  receipt: Receipt;
  package: ValidatedPetPackage;
}

function parseReceipt(value: unknown, id: string): Receipt {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Installed pet receipt is invalid.");
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    record.id !== id ||
    typeof record.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.sha256) ||
    typeof record.generation !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      record.generation,
    ) ||
    typeof record.url !== "string"
  )
    throw new Error("Installed pet receipt is invalid.");
  const url = new URL(record.url);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "zip.openpets.dev" ||
    url.port ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/pets/")
  )
    throw new Error("Installed pet receipt URL is invalid.");
  return {
    version: 1,
    id,
    sha256: record.sha256,
    generation: record.generation,
    url: record.url,
  };
}

export class PetStore {
  private readonly session = randomUUID();
  constructor(
    private readonly storage: string,
    private readonly preferences: Preferences,
    private readonly validate = validatePetPackage,
    private readonly log: (message: string) => void = () => {},
    private readonly cleanup: (path: string) => Promise<void> = (path) =>
      rm(path, { recursive: true, force: true }),
  ) {}
  async initialize(): Promise<void> {
    await ensureDirectory(this.storage);
    await ensureDirectory(join(this.storage, "pets"));
    await ensureDirectory(join(this.storage, "staging"));
  }
  async dispose(): Promise<void> {
    const staging = await lstat(join(this.storage, "staging"));
    if (staging.isSymbolicLink() || !staging.isDirectory()) {
      throw new Error("Pet staging directory is unsafe.");
    }
    await rm(join(this.storage, "staging", this.session), {
      recursive: true,
      force: true,
    });
  }
  async load(id: string, signal: AbortSignal): Promise<InstalledPet> {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || id === "builtin")
      throw new Error("Invalid installed pet ID.");
    const receipt = parseReceipt(this.preferences.installed(id), id);
    return this.loadGeneration(receipt, signal, true);
  }
  private async loadGeneration(
    receipt: Receipt,
    signal: AbortSignal,
    installed: boolean,
  ): Promise<InstalledPet> {
    const petDir = join(this.storage, "pets", receipt.id);
    const generation = join(petDir, receipt.generation);
    for (const path of [
      this.storage,
      join(this.storage, "pets"),
      petDir,
      generation,
      join(generation, "package"),
    ]) {
      const stats = await lstat(path);
      if (stats.isSymbolicLink() || !stats.isDirectory())
        throw new Error("Installed pet directory is unsafe.");
    }
    const stored = parseReceipt(
      JSON.parse(
        (
          await readBoundedRegularFile(
            join(generation, "install.json"),
            8192,
            "install receipt",
          )
        ).toString("utf8"),
      ),
      receipt.id,
    );
    if (
      stored.sha256 !== receipt.sha256 ||
      stored.generation !== receipt.generation ||
      stored.url !== receipt.url
    )
      throw new Error("Installed pet receipt does not match its reference.");
    signal.throwIfAborted();
    return {
      id: receipt.id,
      root: join(generation, "package"),
      receipt,
      package: await this.validate(
        join(generation, "package"),
        receipt.id,
        signal,
        installed,
      ),
    };
  }
  async install(
    pet: CatalogPetV3,
    wardrobe: boolean,
    signal: AbortSignal,
  ): Promise<InstalledPet> {
    if (wardrobe && !pet.wardrobeZip)
      throw new Error("This pet has no downloadable wardrobe.");
    const url = wardrobe ? pet.wardrobeZip! : (pet.wardrobeZip ?? pet.zip);
    const bytes = await downloadPetZip(url, signal);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const receipt: Receipt = {
      version: 1,
      id: pet.id,
      sha256,
      generation: randomUUID(),
      url,
    };
    await ensureDirectory(this.storage);
    await ensureDirectory(join(this.storage, "staging"));
    await ensureDirectory(join(this.storage, "pets"));
    const staging = join(this.storage, "staging", this.session);
    await ensureDirectory(staging);
    const candidate = await mkdtemp(join(staging, "operation-"));
    try {
      const root = join(candidate, "package");
      await mkdir(root, { mode: 0o700 });
      await extractPetZip(bytes, root, { signal });
      const validated = await this.validate(root, pet.id, signal);
      if (wardrobe && !validated.availableOutfitIds.length)
        throw new Error("The downloaded package does not contain a wardrobe.");
      await writeFile(
        join(candidate, "install.json"),
        JSON.stringify(receipt),
        { mode: 0o600, flag: "wx" },
      );
      signal.throwIfAborted();
      const petDir = join(this.storage, "pets", pet.id);
      await ensureDirectory(petDir);
      const target = join(petDir, receipt.generation);
      await rename(candidate, target);
      signal.throwIfAborted();
      await this.preferences.setInstalled(pet.id, receipt);
      return {
        id: pet.id,
        root: join(target, "package"),
        receipt,
        package: validated,
      };
    } finally {
      await this.cleanup(candidate).catch((error: unknown) =>
        this.log(`[storage] staging cleanup failed: ${String(error)}`),
      );
    }
  }
}
