import { lstat, realpath, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { assertPetPackageFiles } from "install-pet/spritesheet";

import { getAppStateSnapshot, installPetState, removePetState, setDefaultPet, upsertPetState, type OpenPetsStateV1 } from "./app-state.js";
import { getCatalogPet } from "./catalog.js";
import { maxCodexPetJsonBytes, maxCodexSpritesheetBytes, validateCodexPetMetadata, type CodexPetMetadata } from "@open-pets/pet-format/metadata";
import { builtInPet } from "./built-in-pet.js";
import { defaultPetZipLimits, extractPetZip as extractPetArchive } from "@open-pets/pet-format/node/archive";
import { readBoundedRegularFile } from "@open-pets/pet-format/node/files";
import { assertOutputPathInside, hasSupportedZipMagic } from "@open-pets/pet-format/node/paths";
import { validatePetAtlases } from "./pet-atlas-validation.js";
import { assertInsideRoot, assertSafePetId, getPetsRoot } from "./pet-paths.js";
import { assertNoUnresolvedPetInstallTransaction, createPetInstallCandidate, createPetInstallStagingCandidate, getCanonicalInstalledPetDir, runPetInstallTransaction, withPetInstallLock } from "./pet-install-transaction.js";

const { maxZipDownloadBytes, maxIndividualFileBytes } = defaultPetZipLimits;
const downloadTimeoutMs = 30_000;

let installationChangeHandler: ((petId: string, removed: boolean) => void) | null = null;

/** Main supplies window effects only after the install transaction has committed. */
export function setPetInstallationChangeHandler(handler: typeof installationChangeHandler): void {
  installationChangeHandler = handler;
}

function notifyPetInstallationChanged(petId: string, removed = false): void {
  try {
    installationChangeHandler?.(petId, removed);
  } catch (error) {
    // A presentation failure must not turn an already committed install into a reported rollback.
    console.error("Pet installation presentation refresh failed.", { petId, error });
  }
}

export interface LocalPetInstallResult {
  readonly state: OpenPetsStateV1;
  readonly petId: string;
  readonly displayName: string;
}

export async function installPet(petId: string): Promise<OpenPetsStateV1> {
  assertSafePetId(petId);
  return withPetInstallLock(petId, async () => {
    const petsRoot = getPetsRoot();
    await assertNoUnresolvedPetInstallTransaction(petsRoot, petId);
    if (getAppStateSnapshot().pets.installed.some((pet) => pet.id === petId)) {
      throw new Error(`Pet is already installed: ${petId}`);
    }

    // The lock intentionally covers catalog lookup and download: an install
    // must not recreate a removed or duplicate ID after its preflight check.
    const catalogPet = await getCatalogPet(petId);
    // Apps with wardrobe support take the full package; `zip` is the outfit-free base for older apps.
    const zipUrl = catalogPet.wardrobeZip ?? catalogPet.zip;
    const zip = await downloadPetZip(zipUrl);
    const candidate = await createPetInstallCandidate(petsRoot, petId);
    try {
      await extractPetZip(zip, candidate);
      const metadata = await validateExtractedPet(candidate);
      if (metadata.id !== petId || metadata.id !== catalogPet.id) {
        throw new Error("Catalog pet package id does not match the requested pet.");
      }
      const state = await runPetInstallTransaction({
        petsRoot,
        petId: metadata.id,
        candidateDir: candidate,
        lockAlreadyHeld: true,
        validateCandidate: async (directory) => {
          const validated = await validateExtractedPet(directory);
          if (validated.id !== catalogPet.id) throw new Error("Catalog pet package id does not match the requested pet.");
        },
        mutateState: () => installPetState({
          id: catalogPet.id,
          displayName: catalogPet.displayName,
          description: catalogPet.description,
          source: {
            catalogVersion: 2,
            zip: zipUrl,
            preview: catalogPet.preview,
          },
        }),
      });
      notifyPetInstallationChanged(petId);
      return state;
    } catch (error) {
      await rm(candidate, { recursive: true, force: true });
      throw error;
    }
  });
}

/**
 * Replace an installed catalog pet with its catalog wardrobe package ("Get
 * outfits" / "Update outfits"). Reuses the backup-and-promote install
 * transaction, so a failed download or invalid package leaves the current pet
 * untouched. Wardrobe preferences are keyed by pet id and survive the swap.
 */
export async function installPetWardrobe(petId: string): Promise<OpenPetsStateV1> {
  assertSafePetId(petId);
  return withPetInstallLock(petId, async () => {
    const petsRoot = getPetsRoot();
    await assertNoUnresolvedPetInstallTransaction(petsRoot, petId);
    const installed = getAppStateSnapshot().pets.installed.find((pet) => pet.id === petId);
    if (!installed || installed.builtIn) throw new Error(`Pet is not installed: ${petId}`);
    // Local folder/ZIP imports have no source; replacing them with the catalog
    // package would discard local edits, so only catalog installs qualify.
    if (!installed.source || !("zip" in installed.source)) {
      throw new Error("Only pets installed from the catalog can get outfits from the catalog.");
    }
    const catalogPet = await getCatalogPet(petId);
    if (!catalogPet.wardrobeZip) throw new Error("This pet has no outfits in the catalog.");
    const wardrobeZip = catalogPet.wardrobeZip;
    const zip = await downloadPetZip(wardrobeZip);
    const candidate = await createPetInstallCandidate(petsRoot, petId);
    try {
      await extractPetZip(zip, candidate);
      const metadata = await validateExtractedPet(candidate);
      if (metadata.id !== petId) throw new Error("Catalog wardrobe package id does not match the installed pet.");
      if (!metadata.wardrobe) throw new Error("Catalog wardrobe package does not contain a wardrobe.");
      const state = await runPetInstallTransaction({
        petsRoot,
        petId,
        candidateDir: candidate,
        lockAlreadyHeld: true,
        validateCandidate: async (directory) => {
          const validated = await validateExtractedPet(directory);
          if (validated.id !== petId || !validated.wardrobe) throw new Error("Catalog wardrobe package changed during installation.");
        },
        mutateState: () => upsertPetState({
          id: petId,
          displayName: installed.displayName,
          description: installed.description,
          source: {
            catalogVersion: 2,
            zip: wardrobeZip,
            preview: catalogPet.preview,
          },
        }),
      });
      notifyPetInstallationChanged(petId);
      return state;
    } catch (error) {
      await rm(candidate, { recursive: true, force: true });
      throw error;
    }
  });
}

export async function installPetFromZipFile(zipPath: string): Promise<OpenPetsStateV1> {
  return (await installPetFromZipFileWithResult(zipPath)).state;
}

export async function installPetFromZipFileWithResult(zipPath: string): Promise<LocalPetInstallResult> {
  const zip = await readBoundedRegularFile(zipPath, maxZipDownloadBytes, "pet zip");
  return installPetFromZipBufferWithResult(zip);
}

export interface PetZipUrlInstallOptions {
  /** Hard cap on downloaded bytes; never above the shared local ZIP limit. */
  readonly maxBytes: number;
  /** Rejects URLs the caller does not accept; also applied to the final response URL. */
  readonly validateUrl: (value: string) => void;
}

/**
 * Downloads a user-confirmed pet ZIP and installs it through the same path as
 * a local ZIP import, so validation and limits stay identical.
 */
export async function installPetFromZipUrlWithResult(
  zipUrl: string,
  options: PetZipUrlInstallOptions,
): Promise<LocalPetInstallResult> {
  const maxBytes = Math.min(options.maxBytes, maxZipDownloadBytes);
  const zip = await downloadZip(zipUrl, maxBytes, options.validateUrl);
  return installPetFromZipBufferWithResult(zip);
}

async function installPetFromZipBufferWithResult(zip: Buffer): Promise<LocalPetInstallResult> {
  validateZipMagic(zip);
  const petsRoot = getPetsRoot();
  const candidate = await createPetInstallStagingCandidate(petsRoot);
  try {
    await extractPetZip(zip, candidate);
    const metadata = await validateExtractedPet(candidate);
    const state = await runPetInstallTransaction({
      petsRoot,
      petId: metadata.id,
      candidateDir: candidate,
      validateCandidate: async (directory) => { await validateExtractedPet(directory); },
      mutateState: () => upsertPetState({ id: metadata.id, displayName: metadata.displayName, description: metadata.description }),
    });
    notifyPetInstallationChanged(metadata.id);
    return { state, petId: metadata.id, displayName: metadata.displayName };
  } catch (error) {
    await rm(candidate, { recursive: true, force: true });
    throw error;
  }
}

export async function installPetFromFolder(folderPath: string): Promise<OpenPetsStateV1> {
  return (await installPetFromFolderWithResult(folderPath)).state;
}

export async function installPetFromFolderWithResult(folderPath: string): Promise<LocalPetInstallResult> {
  const sourceDir = resolve(folderPath);
  const sourceStats = await lstat(sourceDir);
  if (sourceStats.isSymbolicLink()) throw new Error("Pet folder cannot be a symlink.");
  if (!sourceStats.isDirectory()) throw new Error("Pet folder must be a directory.");
  if (await realpath(sourceDir) !== sourceDir) throw new Error("Pet folder path is not canonical.");
  const parsed = JSON.parse((await readBoundedRegularFile(join(sourceDir, "pet.json"), maxCodexPetJsonBytes, "pet.json")).toString("utf8")) as unknown;
  const parsedId = isRecord(parsed) && typeof parsed.id === "string" ? parsed.id : basename(sourceDir);
  const metadata = validateCodexPetMetadata(parsed, parsedId);
  assertSafePetId(metadata.id);
  const petsRoot = getPetsRoot();
  const candidate = await createPetInstallCandidate(petsRoot, metadata.id);
  try {
    assertInsideRoot(petsRoot, candidate);
    await validatePetAtlases(sourceDir, metadata, maxCodexSpritesheetBytes, { copyTo: candidate });
    await writeFile(join(candidate, "pet.json"), `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const state = await runPetInstallTransaction({
      petsRoot,
      petId: metadata.id,
      candidateDir: candidate,
      validateCandidate: async (directory) => { await validateExtractedPet(directory); },
      mutateState: () => upsertPetState({ id: metadata.id, displayName: metadata.displayName, description: metadata.description }),
    });
    notifyPetInstallationChanged(metadata.id);
    return { state, petId: metadata.id, displayName: metadata.displayName };
  } catch (error) {
    await rm(candidate, { recursive: true, force: true });
    throw error;
  }
}

export async function removePet(petId: string): Promise<OpenPetsStateV1> {
  return withPetOperation(petId, async () => {
    if (petId === builtInPet.id) {
      throw new Error("Built-in pet cannot be removed.");
    }
    assertSafePetId(petId);
    const petsRoot = getPetsRoot();
    await assertNoUnresolvedPetInstallTransaction(petsRoot, petId);
    const dir = await getCanonicalInstalledPetDir(petsRoot, petId);
    const state = removePetState(petId);
    notifyPetInstallationChanged(petId, true);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      throw new Error(`Pet was removed from OpenPets state, but local files could not be deleted from ${dir}. You may need to remove them manually. ${error instanceof Error ? error.message : ""}`.trim());
    }
    return state;
  });
}

export async function setDefaultInstalledPet(petId: string): Promise<OpenPetsStateV1> {
  if (petId === builtInPet.id) return setDefaultPet(petId);
  return withPetOperation(petId, async () => {
    assertSafePetId(petId);
    await assertNoUnresolvedPetInstallTransaction(getPetsRoot(), petId);
    return setDefaultPet(petId);
  });
}

export async function withPetOperation<T>(key: string, callback: () => Promise<T>): Promise<T> {
  return withPetInstallLock(key, callback);
}

async function downloadPetZip(zipUrl: string): Promise<Buffer> {
  return downloadZip(zipUrl, maxZipDownloadBytes, validateZipUrl);
}

async function downloadZip(
  zipUrl: string,
  maxBytes: number,
  validateUrl: (value: string) => void,
): Promise<Buffer> {
  validateUrl(zipUrl);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, downloadTimeoutMs);

  try {
    const response = await fetch(zipUrl, {
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
    });

    validateUrl(response.url);
    if (response.url !== zipUrl) throw new Error("Zip download final URL changed.");
    if (!response.ok) throw new Error(`Zip download failed with HTTP ${response.status}.`);

    const buffer = await readLimitedResponse(response, maxBytes);
    validateZipMagic(buffer);
    return buffer;
  } catch (error) {
    // Stop any partially read body (oversize, bad status) instead of leaving it streaming.
    controller.abort();
    if (timedOut) throw new Error("Zip download timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateZipUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Zip URL must use https.");
  if (url.hostname !== "zip.openpets.dev") throw new Error("Zip URL host is not allowed.");
  if (!url.pathname.startsWith("/pets/")) throw new Error("Zip URL path is not allowed.");
  if (url.username || url.password) throw new Error("Zip URL cannot include credentials.");
  if (url.port) throw new Error("Zip URL cannot include a custom port.");
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Zip response body is unavailable for bounded reading.");

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new Error("Zip download is too large.");
    chunks.push(value);
  }

  return Buffer.concat(chunks, total);
}

function validateZipMagic(buffer: Buffer): void {
  if (!hasSupportedZipMagic(buffer)) {
    throw new Error("Downloaded file has an unsupported zip signature.");
  }
}

async function extractPetZip(zip: Buffer, tempDir: string): Promise<void> {
  const files = await extractPetArchive(zip, tempDir);
  assertPetPackageFiles(files);
}

async function validateExtractedPet(tempDir: string): Promise<CodexPetMetadata> {
  const petJsonPath = join(tempDir, "pet.json");
  assertOutputPathInside(tempDir, petJsonPath);

  const parsed = JSON.parse((await readBoundedRegularFile(petJsonPath, maxCodexPetJsonBytes, "pet.json")).toString("utf8")) as unknown;
  const parsedId = isRecord(parsed) && typeof parsed.id === "string" ? parsed.id : basename(tempDir);
  const metadata = validateCodexPetMetadata(parsed, parsedId);
  assertSafePetId(metadata.id);
  await validatePetAtlases(tempDir, metadata, maxIndividualFileBytes, { exactPackage: true });
  return metadata;
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
