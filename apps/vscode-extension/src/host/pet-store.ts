import { lstat, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readBoundedRegularFile } from "@open-pets/pet-format/node/files";
import type { CatalogPetV3 } from "@open-pets/pet-format/catalog-validation";
import { convertLegacyCatalogReceipt, parseReceipt, type Receipt } from "./asset-reference.js";
import { PetPackagePreparation, type PreparedPetPackage } from "./pet-package-preparation.js";
import { validatePetPackage, type ValidatedPetPackage } from "./package-validation.js";
import { ensureDirectory } from "./storage-directory.js";

export interface AssetReferenceAccess {
  readAssetReference(assetId: string): Promise<Receipt | null>;
  compareAndSwapAssetReference(assetId: string, expectedGeneration: string | null, receipt: Receipt): Promise<Receipt>;
}

export interface InstalledPet {
  id: string;
  root: string;
  receipt: Receipt;
  package: ValidatedPetPackage;
}

export class PetStore {
  private readonly preparation: PetPackagePreparation;
  private readonly prepared = new Set<PreparedPetPackage>();

  constructor(
    private readonly storage: string,
    private readonly references: AssetReferenceAccess,
    private readonly validate = validatePetPackage,
    private readonly log: (message: string) => void = () => {},
    private readonly cleanup: (path: string) => Promise<void> = (path) => rm(path, { recursive: true, force: true }),
  ) {
    this.preparation = new PetPackagePreparation(storage, validate, log);
  }

  async initialize(): Promise<void> {
    await ensureDirectory(this.storage);
    await ensureDirectory(join(this.storage, "pets"));
    await ensureDirectory(join(this.storage, "staging"));
  }

  async dispose(): Promise<void> {
    this.prepared.clear();
    await this.preparation.dispose();
  }

  async prepareCatalog(pet: CatalogPetV3, wardrobe: boolean, signal: AbortSignal): Promise<PreparedPetPackage> {
    const prepared = await this.preparation.prepareCatalog(pet, wardrobe, signal);
    this.prepared.add(prepared);
    return prepared;
  }

  async prepareLocal(path: string, targetPetId: string | undefined, signal: AbortSignal): Promise<PreparedPetPackage> {
    const prepared = await this.preparation.prepareLocal(path, targetPetId, signal);
    this.prepared.add(prepared);
    return prepared;
  }

  async discardPrepared(prepared: PreparedPetPackage): Promise<void> {
    if (!this.prepared.delete(prepared)) throw new Error("Pet package candidate is not owned by this store.");
    await this.preparation.discard(prepared);
  }

  async commitPrepared(prepared: PreparedPetPackage, expectedGeneration: string | null, signal: AbortSignal): Promise<InstalledPet> {
    if (!this.prepared.delete(prepared)) throw new Error("Pet package candidate is not owned by this store.");
    let target: string | undefined;
    let promoted = false;
    let committed = false;
    let uncertain = false;
    try {
      const receipt = parseReceipt(prepared.receipt);
      await writeFile(join(prepared.candidate, "install.json"), JSON.stringify(receipt), { mode: 0o600, flag: "wx" });
      const petDirectory = join(this.storage, "pets", receipt.id);
      await ensureDirectory(petDirectory);
      signal.throwIfAborted();
      target = join(petDirectory, receipt.generation);
      await rename(prepared.candidate, target);
      promoted = true;
      try {
        await this.references.compareAndSwapAssetReference(receipt.id, expectedGeneration, receipt);
      } catch (error) {
        const knownFailure = typeof error === "object" && error !== null && "kind" in error
          && (error.kind === "conflict" || error.kind === "invalid" || error.kind === "busy");
        uncertain = !knownFailure;
        throw error;
      }
      committed = true;
      return { id: receipt.id, root: join(target, "package"), receipt, package: prepared.package };
    } finally {
      if (target && promoted && !committed && !uncertain) {
        await this.cleanup(target).catch((error: unknown) => this.log(`[storage] generation cleanup failed: ${String(error)}`));
      }
      await this.preparation.discard(prepared);
    }
  }

  async load(id: string, signal: AbortSignal): Promise<InstalledPet> {
    const reference = await this.references.readAssetReference(id);
    if (!reference) throw new Error("Installed pet reference is unavailable.");
    const receipt = parseReceipt(reference);
    if (receipt.id !== id) throw new Error("Installed pet reference ID does not match.");
    const petDirectory = join(this.storage, "pets", receipt.id);
    const generation = join(petDirectory, receipt.generation);
    for (const path of [this.storage, join(this.storage, "pets"), petDirectory, generation, join(generation, "package")]) {
      const stats = await lstat(path);
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("Installed pet directory is unsafe.");
    }
    const stored: unknown = JSON.parse((await readBoundedRegularFile(join(generation, "install.json"), 8192, "install receipt")).toString("utf8"));
    const normalized = typeof stored === "object" && stored !== null && "version" in stored && stored.version === 1
      ? convertLegacyCatalogReceipt(stored)
      : parseReceipt(stored);
    if (JSON.stringify(normalized) !== JSON.stringify(receipt)) throw new Error("Installed pet receipt does not match its reference.");
    signal.throwIfAborted();
    return { id, root: join(generation, "package"), receipt, package: await this.validate(join(generation, "package"), receipt.packageId, signal, true) };
  }
}
