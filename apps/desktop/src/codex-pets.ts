import { lstat, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

import sharp from "sharp";

import { getAppStateSnapshot, installPetState, type OpenPetsStateV1 } from "./app-state.js";
import { migrateLegacyCodexV2Imports, type LegacyCodexV2MigrationResult } from "./codex-pet-migration.js";
import { getCodexPetSpriteLayout, maxCodexPetJsonBytes, maxCodexPets, maxCodexSpritesheetBytes, maxCodexThumbnailSourceBytes, validateCodexPetMetadata, validateCodexPetSpritesheet, type CodexPetMetadata, type CodexPetSpriteLayout } from "./codex-pets-core.js";
import { readBoundedRegularFile } from "./pet-file-safety.js";
import { assertNoUnresolvedPetInstallTransaction, createPetInstallCandidate, runPetInstallTransaction } from "./pet-install-transaction.js";
import { assertSafePetId, getPetsRoot } from "./pet-paths.js";

const codexPetsRoot = join(homedir(), ".codex", "pets");
const codexThumbnailCache = new Map<string, string>();

export interface CodexPetUiState {
  readonly source: "codex";
  readonly pets: readonly CodexPetUiItem[];
  readonly error?: string;
}

export interface CodexPetUiItem {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly preview: string;
  readonly spritesheet: string;
  readonly spriteLayout: CodexPetSpriteLayout;
}

export async function migrateLegacyCodexV2ImportsAtStartup(): Promise<LegacyCodexV2MigrationResult> {
  return migrateLegacyCodexV2Imports(getAppStateSnapshot().pets.installed, {
    codexPetsRoot,
    installedPetsRoot: getPetsRoot(),
  });
}

export async function getCodexPetsUiState(): Promise<CodexPetUiState> {
  try {
    const root = await validateCodexRoot();
    const entries = (await readdir(codexPetsRoot, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    const pets: CodexPetUiItem[] = [];
    let attemptedDirectories = 0;

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      attemptedDirectories += 1;
      if (attemptedDirectories > maxCodexPets) break;
      const pet = await tryReadCodexPet(root, join(root, entry.name), entry.name);
      if (pet) {
        pets.push(pet);
      }
    }

    pets.sort((left, right) => left.displayName.localeCompare(right.displayName));
    return { source: "codex", pets };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { source: "codex", pets: [] };
    return { source: "codex", pets: [], error: error instanceof Error ? error.message : "Codex pets unavailable." };
  }
}

export async function importCodexPet(petId: string): Promise<OpenPetsStateV1> {
  assertSafePetId(petId);
  const root = await validateCodexRoot();
  const sourceDir = resolve(root, petId);
  await assertCodexPetDirectory(root, sourceDir);
  const metadata = await readCodexPetMetadata(root, sourceDir, petId);
  const spritesheetPath = join(sourceDir, metadata.spritesheetPath);
  const spritesheet = await readBoundedRegularFile(spritesheetPath, maxCodexSpritesheetBytes, "spritesheet.webp");
  await validateCodexPetSpritesheet(spritesheet, metadata);

  const petsRoot = getPetsRoot();
  await assertNoUnresolvedPetInstallTransaction(petsRoot, metadata.id);
  const candidate = await createPetInstallCandidate(petsRoot, metadata.id);
  try {
    await writeFile(join(candidate, "spritesheet.webp"), spritesheet, { mode: 0o600, flag: "wx" });
    await writeFile(join(candidate, "pet.json"), `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return await runPetInstallTransaction({
      petsRoot,
      petId: metadata.id,
      candidateDir: candidate,
      validateCandidate: async (directory) => {
        const candidateMetadata = JSON.parse((await readBoundedRegularFile(join(directory, "pet.json"), maxCodexPetJsonBytes, "pet.json")).toString("utf8")) as unknown;
        const validatedMetadata = validateCodexPetMetadata(candidateMetadata, metadata.id);
        const candidateSpritesheet = await readBoundedRegularFile(join(directory, validatedMetadata.spritesheetPath), maxCodexSpritesheetBytes, "spritesheet.webp");
        await validateCodexPetSpritesheet(candidateSpritesheet, validatedMetadata);
      },
      mutateState: () => installPetState({
        id: metadata.id,
        displayName: metadata.displayName,
        description: metadata.description,
        source: { kind: "codex", path: sourceDir },
      }),
    });
  } catch (error) {
    await rm(candidate, { recursive: true, force: true });
    throw error;
  }
}

async function tryReadCodexPet(root: string, dir: string, folderName: string): Promise<CodexPetUiItem | null> {
  try {
    const metadata = await readCodexPetMetadata(root, dir, folderName);
    const spritesheetPath = join(dir, metadata.spritesheetPath);
    await validateSpritesheet(spritesheetPath, metadata);
    const spriteLayout = getCodexPetSpriteLayout(metadata);
    const preview = await createCodexThumbnailDataUrl(spritesheetPath, spriteLayout);
    return {
      id: metadata.id,
      displayName: metadata.displayName,
      description: metadata.description,
      preview,
      spritesheet: `openpets-codex://spritesheet/${encodeURIComponent(metadata.id)}`,
      spriteLayout,
    };
  } catch (error) {
    console.error(`Skipping invalid Codex pet at ${dir}.`, error);
    return null;
  }
}

export async function readCodexPetSpritesheet(petId: string): Promise<Buffer> {
  assertSafePetId(petId);
  const root = await validateCodexRoot();
  const sourceDir = resolve(root, petId);
  const metadata = await readCodexPetMetadata(root, sourceDir, petId);
  const spritesheet = await readBoundedRegularFile(join(sourceDir, metadata.spritesheetPath), maxCodexSpritesheetBytes, "spritesheet.webp");
  await validateCodexPetSpritesheet(spritesheet, metadata);
  return spritesheet;
}

async function readCodexPetMetadata(root: string, dir: string, folderName: string): Promise<CodexPetMetadata> {
  await assertCodexPetDirectory(root, dir);
  assertSafePetId(folderName);
  const petJson = join(dir, "pet.json");
  const parsed = JSON.parse((await readBoundedRegularFile(petJson, maxCodexPetJsonBytes, "pet.json")).toString("utf8")) as unknown;
  const metadata = validateCodexPetMetadata(parsed, folderName);
  assertSafePetId(metadata.id);
  return metadata;
}

async function validateSpritesheet(path: string, metadata: CodexPetMetadata): Promise<void> {
  await validateCodexPetSpritesheet(await readBoundedRegularFile(path, maxCodexSpritesheetBytes, "spritesheet.webp"), metadata);
}

async function createCodexThumbnailDataUrl(path: string, spriteLayout: CodexPetSpriteLayout): Promise<string> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size <= 0 || stats.size > maxCodexThumbnailSourceBytes) return "";
  const cacheKey = `${path}:v${spriteLayout.version}:${stats.size}:${stats.mtimeMs}`;
  const cached = codexThumbnailCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const image = sharp(path, { limitInputPixels: 50_000_000 });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) return "";
  const width = Math.min(spriteLayout.frameWidth, metadata.width);
  const height = Math.min(spriteLayout.frameHeight, metadata.height);
  const left = spriteLayout.neutralPose ? spriteLayout.neutralPose.column * spriteLayout.frameWidth : 0;
  const thumbnail = await sharp(path, { limitInputPixels: 50_000_000 })
    .extract({ left, top: 0, width, height })
    .resize(54, 58, { fit: "fill" })
    .png()
    .toBuffer();
  const afterStats = await lstat(path);
  if (afterStats.isSymbolicLink() || !afterStats.isFile() || afterStats.size !== stats.size || afterStats.mtimeMs !== stats.mtimeMs) return "";
  const dataUrl = `data:image/png;base64,${thumbnail.toString("base64")}`;
  codexThumbnailCache.set(cacheKey, dataUrl);
  return dataUrl;
}

async function validateCodexRoot(): Promise<string> {
  const root = resolve(codexPetsRoot);
  const rootStats = await lstat(root);
  if (rootStats.isSymbolicLink()) throw new Error("Codex pets root cannot be a symlink.");
  if (!rootStats.isDirectory()) throw new Error("Codex pets path is not a directory.");
  const realRoot = await realpath(root);
  if (realRoot !== root) throw new Error("Codex pets root path is not canonical.");
  return root;
}

async function assertCodexPetDirectory(root: string, target: string): Promise<void> {
  const resolvedTarget = resolve(target);
  if (resolvedTarget === root || !resolvedTarget.startsWith(`${root}${sep}`) || basename(resolvedTarget).startsWith(".")) {
    throw new Error("Resolved path escapes Codex pets directory.");
  }
  const dirStats = await lstat(resolvedTarget);
  if (dirStats.isSymbolicLink()) throw new Error("Codex pet directory cannot be a symlink.");
  if (!dirStats.isDirectory()) throw new Error("Codex pet path must be a directory.");
  const realTarget = await realpath(resolvedTarget);
  if (!realTarget.startsWith(`${root}${sep}`)) throw new Error("Codex pet directory escapes Codex pets root.");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
