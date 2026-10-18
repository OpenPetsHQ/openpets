import { join } from "node:path";

import { getCodexPetSpriteLayout, maxCodexPetJsonBytes, maxCodexSpritesheetBytes, validateCodexPetMetadata, validateCodexPetSpritesheet, type CodexPetMetadata, type CodexPetSpriteLayout } from "./codex-pets-core.js";
import { assertPetSpritesheetFiles, getOutfitAtlasFormat, readBoundedRegularFile } from "./pet-file-safety.js";
import { petSpritesheetMimeType } from "install-pet/spritesheet";
import { getPetDir } from "./pet-paths.js";
import { defaultOutfitId } from "./pet-wardrobe-core.js";

export async function readInstalledPetSpriteLayout(
  petId: string,
  source: "personal" | "team" = "personal",
): Promise<CodexPetSpriteLayout> {
  return getCodexPetSpriteLayout(await readInstalledPetMetadata(petId, source));
}

export async function readInstalledPetMetadata(
  petId: string,
  source: "personal" | "team" = "personal",
): Promise<CodexPetMetadata> {
  const metadataPath = join(getPetDir(petId, source), "pet.json");
  return validateCodexPetMetadata(
    JSON.parse((await readBoundedRegularFile(metadataPath, maxCodexPetJsonBytes, "Installed pet metadata")).toString("utf8")) as unknown,
    petId,
  );
}

/** Read the base atlas, or one outfit's atlas when `outfitId` names a declared outfit. */
export async function readInstalledPetSpritesheet(
  petId: string,
  source: "personal" | "team" = "personal",
  outfitId: string = defaultOutfitId,
): Promise<{ readonly bytes: Buffer; readonly mimeType: string }> {
  const metadata = await readInstalledPetMetadata(petId, source);
  const directory = getPetDir(petId, source);
  await assertPetSpritesheetFiles(directory, metadata);
  if (outfitId !== defaultOutfitId) {
    const outfit = metadata.wardrobe?.outfits.find((candidate) => candidate.id === outfitId);
    if (!outfit) throw new Error(`Installed pet has no outfit: ${outfitId}`);
    // Like the base atlas below, only SVG needs re-validation per read; WebP was validated at install.
    const bytes = await readBoundedRegularFile(join(directory, outfit.spritesheetPath), maxCodexSpritesheetBytes, outfit.spritesheetPath);
    if (outfit.spritesheetPath.endsWith(".svg")) await validateCodexPetSpritesheet(bytes, { spriteVersionNumber: metadata.spriteVersionNumber, spritesheetPath: getOutfitAtlasFormat(outfit) });
    return { bytes, mimeType: petSpritesheetMimeType(outfit.spritesheetPath) };
  }
  const bytes = await readBoundedRegularFile(join(directory, metadata.spritesheetPath), maxCodexSpritesheetBytes, metadata.spritesheetPath);
  if (metadata.spritesheetPath === "spritesheet.svg") await validateCodexPetSpritesheet(bytes, metadata);
  return { bytes, mimeType: petSpritesheetMimeType(metadata.spritesheetPath) };
}
