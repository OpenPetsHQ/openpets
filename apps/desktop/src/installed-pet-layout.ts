import { join } from "node:path";

import { getCodexPetSpriteLayout, type CodexPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
import { maxCodexPetJsonBytes, maxCodexSpritesheetBytes, type CodexPetMetadata } from "@open-pets/pet-format/metadata";
import { validatePetPackageMetadata } from "@open-pets/pet-format/package";
import { motionMaxClipBytes } from "@open-pets/pet-format/node/package-validation";
import type { PetPackage } from "@open-pets/pet-format/package-types";
import { decodeMotionPreviewFrame, validateCodexPetSpritesheet } from "./pet-atlas-validation.js";
import { withAtlasFormat } from "@open-pets/pet-format/node/atlas-validation";
import { readBoundedRegularFile } from "@open-pets/pet-format/node/files";
import { assertPetSpritesheetFiles, getOutfitAtlasFormat } from "@open-pets/pet-format/node/atlas-validation";
import { petSpritesheetMimeType } from "install-pet/spritesheet";
import { getPetDir } from "./pet-paths.js";
import { defaultOutfitId } from "@open-pets/pet-format/wardrobe";
import { getMotionOutfitBindings } from "@open-pets/pet-format/motion";

export type InstalledPetPresentation =
  | {
      readonly format: "classic";
      readonly previewFormat: "atlas";
      readonly spriteLayout: CodexPetSpriteLayout;
      readonly capabilities: { readonly outfits: boolean; readonly activities: boolean; readonly gaze: boolean };
    }
  | {
      readonly format: "motion";
      readonly previewFormat: "image";
      readonly previewWidth: number;
      readonly previewHeight: number;
      readonly capabilities: { readonly outfits: boolean; readonly activities: boolean; readonly gaze: false };
    };

/** Clone-safe artwork facts for installed-pet UI snapshots. */
export async function readInstalledPetPresentation(
  petId: string,
  source: "personal" | "team" = "personal",
): Promise<InstalledPetPresentation> {
  const petPackage = await readInstalledPetPackage(petId, source);
  if (petPackage.format === "motion") {
    return {
      format: "motion",
      previewFormat: "image",
      previewWidth: petPackage.metadata.geometry.width,
      previewHeight: petPackage.metadata.geometry.height,
      capabilities: { outfits: Boolean(petPackage.metadata.wardrobe?.outfits.length), activities: Boolean(petPackage.metadata.activities?.length), gaze: false },
    };
  }
  const { metadata } = petPackage;
  const spriteLayout = getCodexPetSpriteLayout(metadata);
  return {
    format: "classic",
    previewFormat: "atlas",
    spriteLayout,
    capabilities: {
      outfits: Boolean(metadata.wardrobe?.outfits.length),
      activities: Boolean(metadata.activities?.length),
      gaze: spriteLayout.version === 2,
    },
  };
}

/** Static neutral image for Motion, or the unchanged Classic atlas. */
export async function readInstalledPetPreview(
  petId: string,
  source: "personal" | "team" = "personal",
  outfitId: string = defaultOutfitId,
): Promise<{ readonly bytes: Buffer; readonly mimeType: string }> {
  const petPackage = await readInstalledPetPackage(petId, source);
  if (petPackage.format === "classic") return readInstalledPetSpritesheet(petId, source, outfitId);
  const metadata = petPackage.metadata;
  const bindings = getMotionOutfitBindings(metadata, outfitId);
  const animation = metadata.animations[bindings.idle[0]!.animation];
  if (!animation || animation.play !== "loop") throw new Error("Motion pet has no idle loop.");
  const clip = metadata.clips[animation.loop];
  if (!clip) throw new Error("Motion pet idle clip is unavailable.");
  const encoded = await readBoundedRegularFile(join(getPetDir(petId, source), clip.file), motionMaxClipBytes, "Motion idle clip");
  return { bytes: await decodeMotionPreviewFrame(encoded, metadata.geometry), mimeType: "image/png" };
}

export async function readInstalledPetMetadata(
  petId: string,
  source: "personal" | "team" = "personal",
): Promise<CodexPetMetadata> {
  const petPackage = await readInstalledPetPackage(petId, source);
  if (petPackage.format !== "classic") throw new Error("Installed pet does not have a Classic spritesheet.");
  return petPackage.metadata;
}

/** Read and validate the installed manifest without assuming an artwork format. */
export async function readInstalledPetPackage(
  petId: string,
  source: "personal" | "team" = "personal",
): Promise<PetPackage> {
  const metadataPath = join(getPetDir(petId, source), "pet.json");
  return validatePetPackageMetadata(
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
    if (outfit.spritesheetPath.endsWith(".svg")) await validateCodexPetSpritesheet(bytes, withAtlasFormat(metadata, getOutfitAtlasFormat(outfit)));
    return { bytes, mimeType: petSpritesheetMimeType(outfit.spritesheetPath) };
  }
  const bytes = await readBoundedRegularFile(join(directory, metadata.spritesheetPath), maxCodexSpritesheetBytes, metadata.spritesheetPath);
  if (metadata.spritesheetPath === "spritesheet.svg") await validateCodexPetSpritesheet(bytes, metadata);
  return { bytes, mimeType: petSpritesheetMimeType(metadata.spritesheetPath) };
}
