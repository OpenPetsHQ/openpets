import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogPetV3 } from "@open-pets/pet-format/catalog-validation";
import { maxCodexPetJsonBytes, validateCodexPetMetadata } from "@open-pets/pet-format/metadata";
import { defaultPetZipLimits, extractPetZip } from "@open-pets/pet-format/node/archive";
import { readBoundedRegularFile } from "@open-pets/pet-format/node/files";
import { parseReceipt, type Receipt } from "./asset-reference.js";
import { downloadPetZip } from "./download.js";
import { validatePetPackage, type ValidatedPetPackage } from "./package-validation.js";
import { ensureDirectory } from "./storage-directory.js";

export interface PreparedPetPackage {
  readonly id: string;
  readonly packageId: string;
  readonly receipt: Receipt;
  readonly package: ValidatedPetPackage;
  readonly candidate: string;
}

export class PetPackagePreparation {
  private readonly session = randomUUID();
  private readonly candidates = new Set<PreparedPetPackage>();
  private readonly active = new Set<Promise<PreparedPetPackage>>();
  private closed = false;

  constructor(
    private readonly storage: string,
    private readonly validate = validatePetPackage,
    private readonly log: (message: string) => void = () => {},
  ) {}

  prepareCatalog(pet: CatalogPetV3, wardrobe: boolean, signal: AbortSignal): Promise<PreparedPetPackage> {
    if (wardrobe && !pet.wardrobeZip) return Promise.reject(new Error("This pet has no downloadable wardrobe."));
    const url = wardrobe ? pet.wardrobeZip! : (pet.wardrobeZip ?? pet.zip);
    return this.start(async () => this.prepareBytes(await downloadPetZip(url, signal), pet.id, undefined, { kind: "catalog", url }, wardrobe, signal));
  }

  prepareLocal(path: string, targetPetId: string | undefined, signal: AbortSignal): Promise<PreparedPetPackage> {
    return this.start(async () => {
      signal.throwIfAborted();
      const bytes = await readBoundedRegularFile(path, defaultPetZipLimits.maxZipDownloadBytes, "pet zip");
      signal.throwIfAborted();
      return this.prepareBytes(bytes, undefined, targetPetId, { kind: "local" }, targetPetId !== undefined, signal);
    });
  }

  private start(work: () => Promise<PreparedPetPackage>): Promise<PreparedPetPackage> {
    if (this.closed) return Promise.reject(new Error("Pet package preparation is disposed."));
    const operation = work();
    this.active.add(operation);
    void operation.finally(() => this.active.delete(operation)).catch(() => {});
    return operation;
  }

  private async prepareBytes(bytes: Buffer, expectedId: string | undefined, targetId: string | undefined, source: Receipt["source"], requireWardrobe: boolean, signal: AbortSignal): Promise<PreparedPetPackage> {
    signal.throwIfAborted();
    await ensureDirectory(this.storage);
    await ensureDirectory(join(this.storage, "staging"));
    const sessionPath = join(this.storage, "staging", this.session);
    await ensureDirectory(sessionPath);
    const candidate = await mkdtemp(join(sessionPath, "operation-"));
    try {
      const root = join(candidate, "package");
      await mkdir(root, { mode: 0o700 });
      await extractPetZip(bytes, root, { signal });
      const manifest = JSON.parse((await readBoundedRegularFile(join(root, "pet.json"), maxCodexPetJsonBytes, "pet.json")).toString("utf8")) as unknown;
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || !("id" in manifest) || typeof manifest.id !== "string") throw new Error("Pet package ID is invalid.");
      const metadata = validateCodexPetMetadata(manifest, manifest.id);
      const packageId = metadata.id;
      if (expectedId !== undefined && packageId !== expectedId) throw new Error("Catalog pet package ID does not match.");
      if (targetId !== undefined && packageId !== (targetId === "builtin" ? "hoodie-cat" : targetId)) throw new Error("Pet package ID does not match the target.");
      const id = targetId ?? packageId;
      const receipt = parseReceipt({ version: 2, id, packageId, sha256: createHash("sha256").update(bytes).digest("hex"), generation: randomUUID(), source });
      const validated = await this.validate(root, packageId, signal);
      if (requireWardrobe && (!validated.metadata.wardrobe || validated.availableOutfitIds.length === 0 || validated.outfitProblems?.length || validated.metadata.wardrobe.outfits.some((outfit) => !validated.availableOutfitIds.includes(outfit.id)))) throw new Error("Pet package requires a usable wardrobe.");
      signal.throwIfAborted();
      const prepared = { id, packageId, receipt, package: validated, candidate };
      this.candidates.add(prepared);
      return prepared;
    } catch (error) {
      await this.cleanup(candidate);
      throw error;
    }
  }

  async discard(prepared: PreparedPetPackage): Promise<void> {
    if (!this.candidates.delete(prepared)) throw new Error("Pet package candidate is not owned by this preparation session.");
    await this.cleanup(prepared.candidate);
  }

  async dispose(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.active]);
    this.candidates.clear();
    await this.cleanup(join(this.storage, "staging", this.session));
  }

  private async cleanup(path: string): Promise<void> {
    try {
      await rm(path, { recursive: true, force: true });
    } catch (error) {
      this.log(`[storage] staging cleanup failed: ${String(error)}`);
    }
  }
}
