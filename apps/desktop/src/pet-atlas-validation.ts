import sharp from "sharp";
import type { PetSpritesheetPath } from "install-pet/spritesheet";
import type { CodexPetMetadata } from "@open-pets/pet-format/metadata";
import type { PetActivity } from "@open-pets/pet-format/activities";
import {
  readPetActivitySpritesheet as readActivity,
  validateCodexPetOutfitSpritesheet as validateOutfit,
  validateCodexPetSpritesheet as validateBase,
  validatePetActivitySpritesheet as validateActivity,
  validatePetAtlases as validateAtlases,
  type ImageDecoder,
} from "@open-pets/pet-format/node/atlas-validation";

const sharpDecoder: ImageDecoder = {
  open(bytes, limitInputPixels) {
    const image = sharp(Buffer.from(bytes), { animated: true, failOn: "error", limitInputPixels });
    return {
      metadata: () => image.metadata(),
      async decode() {
        await image.raw().toBuffer();
      },
      async decodeWithAlpha() {
        const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return { data, channels: info.channels };
      },
    };
  },
};

export function validateCodexPetSpritesheet(bytes: Buffer, metadata: Pick<CodexPetMetadata, "spriteVersionNumber" | "spritesheetPath">): Promise<void> {
  return validateBase(bytes, metadata, sharpDecoder);
}

export function validateCodexPetOutfitSpritesheet(bytes: Buffer, metadata: Pick<CodexPetMetadata, "spriteVersionNumber">, format: PetSpritesheetPath): Promise<void> {
  return validateOutfit(bytes, metadata, format, sharpDecoder);
}

export function validatePetActivitySpritesheet(bytes: Buffer, activity: PetActivity): Promise<void> {
  return validateActivity(bytes, activity, sharpDecoder);
}

export function readPetActivitySpritesheet(directory: string, activity: PetActivity): Promise<Buffer> {
  return readActivity(directory, activity, sharpDecoder);
}

export function validatePetAtlases(
  directory: string,
  metadata: CodexPetMetadata,
  maxBytes: number,
  options: { readonly exactPackage?: boolean; readonly copyTo?: string } = {},
): Promise<void> {
  return validateAtlases(directory, metadata, maxBytes, sharpDecoder, options);
}
