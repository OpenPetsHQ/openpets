import { join } from "node:path";

import { getCodexPetSpriteLayout, maxCodexPetJsonBytes, maxCodexSpritesheetBytes, validateCodexPetMetadata, validateCodexPetSpritesheet, type CodexPetMetadata, type CodexPetSpriteLayout } from "./codex-pets-core.js";
import { assertPetSpritesheetFiles, readBoundedRegularFile } from "./pet-file-safety.js";
import { petSpritesheetMimeType } from "install-pet/spritesheet";
import { getPetDir } from "./pet-paths.js";

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

export async function readInstalledPetSpritesheet(petId: string, source: "personal" | "team" = "personal"): Promise<{ readonly bytes: Buffer; readonly mimeType: string }> {
  const metadata = await readInstalledPetMetadata(petId, source);
  const directory = getPetDir(petId, source);
  await assertPetSpritesheetFiles(directory, metadata.spritesheetPath);
  const bytes = await readBoundedRegularFile(join(directory, metadata.spritesheetPath), maxCodexSpritesheetBytes, metadata.spritesheetPath);
  if (metadata.spritesheetPath === "spritesheet.svg") await validateCodexPetSpritesheet(bytes, metadata);
  return { bytes, mimeType: petSpritesheetMimeType(metadata.spritesheetPath) };
}
