import type { CodexPetMetadata } from "./metadata.js";
import type { MotionPetMetadata, VerifiedMotionClip } from "./motion.js";

export type PetPackage =
  | { readonly format: "classic"; readonly metadata: CodexPetMetadata }
  | { readonly format: "motion"; readonly metadata: MotionPetMetadata };

export type ValidatedPetPackage =
  | { readonly package: Extract<PetPackage, { format: "classic" }> }
  | {
    readonly package: Extract<PetPackage, { format: "motion" }>;
    readonly verifiedClips: Record<string, VerifiedMotionClip>;
  };
