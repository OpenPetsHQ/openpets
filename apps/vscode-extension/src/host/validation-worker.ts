import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import {
  maxCodexPetJsonBytes,
  maxCodexSpritesheetBytes,
  validateCodexPetMetadata,
} from "@open-pets/pet-format/metadata";
import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
import { readBoundedRegularFile } from "@open-pets/pet-format/node/files";
import {
  getOutfitAtlasFormat,
  validateCodexPetOutfitSpritesheet,
  validateCodexPetSpritesheet,
  validatePetAtlases,
} from "@open-pets/pet-format/node/atlas-validation";
import { loadWebpDecoder } from "./image-decoder.js";
import type {
  ValidationWorkerRequest,
  ValidationWorkerResponse,
} from "./package-validation.js";

if (!parentPort) throw new Error("Pet validation must run in a worker.");
const port = parentPort;
const request: ValidationWorkerRequest = workerData;

async function validate(): Promise<ValidationWorkerResponse> {
  const rootStats = await lstat(request.root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("Pet package root must be a regular directory.");
  }
  const bytes = await readBoundedRegularFile(
    join(request.root, "pet.json"),
    maxCodexPetJsonBytes,
    "pet.json",
  );
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  const metadata = validateCodexPetMetadata(parsed, request.expectedId);
  const decoder = await loadWebpDecoder(request.decoderDirectory);
  const availableOutfitIds: string[] = [];
  const outfitProblems: string[] = [];
  if (request.installed) {
    const base = await readBoundedRegularFile(
      join(request.root, metadata.spritesheetPath),
      maxCodexSpritesheetBytes,
      metadata.spritesheetPath,
    );
    await validateCodexPetSpritesheet(base, metadata, decoder);
    for (const outfit of metadata.wardrobe?.outfits ?? []) {
      try {
        const dir = await lstat(join(request.root, "outfits"));
        if (dir.isSymbolicLink() || !dir.isDirectory())
          throw new Error("Outfits directory is invalid.");
        const bytes = await readBoundedRegularFile(
          join(request.root, outfit.spritesheetPath),
          maxCodexSpritesheetBytes,
          outfit.spritesheetPath,
        );
        await validateCodexPetOutfitSpritesheet(
          bytes,
          metadata,
          getOutfitAtlasFormat(outfit),
          decoder,
        );
        availableOutfitIds.push(outfit.id);
      } catch (error) {
        outfitProblems.push(
          `${outfit.id}: ${error instanceof Error ? error.message : "unavailable"}`,
        );
      }
    }
  } else {
    await validatePetAtlases(
      request.root,
      metadata,
      maxCodexSpritesheetBytes,
      decoder,
      { exactPackage: true },
    );
    availableOutfitIds.push(
      ...(metadata.wardrobe?.outfits.map((outfit) => outfit.id) ?? []),
    );
  }
  return {
    ok: true,
    value: {
      metadata,
      layout: getPetSpriteLayout(metadata),
      availableOutfitIds,
      ...(outfitProblems.length ? { outfitProblems } : {}),
    },
  };
}

void validate().then(
  (response) => port.postMessage(response),
  (error: unknown) =>
    port.postMessage({
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Pet package validation failed.",
    } satisfies ValidationWorkerResponse),
);
