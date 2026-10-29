import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { maxCodexPetJsonBytes, maxCodexSpritesheetBytes, validateCodexPetMetadata } from "@open-pets/pet-format/metadata";
import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
import { readBoundedRegularFile } from "@open-pets/pet-format/node/files";
import { validatePetAtlases } from "@open-pets/pet-format/node/atlas-validation";
import { loadWebpDecoder } from "./image-decoder.js";
import type { ValidationWorkerRequest, ValidationWorkerResponse } from "./package-validation.js";

if (!parentPort) throw new Error("Pet validation must run in a worker.");
const port = parentPort;
const request: ValidationWorkerRequest = workerData;

async function validate(): Promise<ValidationWorkerResponse> {
  const rootStats = await lstat(request.root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("Pet package root must be a regular directory.");
  }
  const bytes = await readBoundedRegularFile(join(request.root, "pet.json"), maxCodexPetJsonBytes, "pet.json");
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  const metadata = validateCodexPetMetadata(parsed, request.expectedId);
  const decoder = await loadWebpDecoder(request.decoderDirectory);
  await validatePetAtlases(request.root, metadata, maxCodexSpritesheetBytes, decoder, { exactPackage: true });
  return {
    ok: true,
    value: {
      metadata,
      layout: getPetSpriteLayout(metadata),
      availableOutfitIds: metadata.wardrobe?.outfits.map((outfit) => outfit.id) ?? [],
    },
  };
}

void validate().then(
  (response) => port.postMessage(response),
  (error: unknown) => port.postMessage({ ok: false, message: error instanceof Error ? error.message : "Pet package validation failed." } satisfies ValidationWorkerResponse),
);
