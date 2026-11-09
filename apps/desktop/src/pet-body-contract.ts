import type {
  MotionContextReaction,
  MotionEventReaction,
  MotionPetMetadata,
  VerifiedMotionClip,
} from "@open-pets/pet-format/motion";

/** Semantic intent is independent of bubble lifetime and artwork timing. */
export interface PetBodyInput {
  readonly epoch: string;
  readonly revision: number;
  readonly context: MotionContextReaction | "idle";
  readonly event?: {
    readonly id: string;
    readonly reaction: MotionEventReaction;
  };
  readonly paused: boolean;
  readonly suspended: boolean;
}

/** Immutable, validated artwork retained until renderer commitment or teardown. */
export interface MotionBodyDescriptor {
  readonly snapshotId: string;
  readonly metadata: MotionPetMetadata;
  readonly urls: Readonly<Record<string, string>>;
  readonly verifiedClips: Readonly<Record<string, VerifiedMotionClip>>;
}

export interface MotionAppearance {
  readonly assets: MotionBodyDescriptor;
  readonly outfitId: string;
  readonly presentationId: string;
  readonly reason: "initial" | "manual" | "scheduled" | "replacement";
}

export interface PetBodySnapshot {
  readonly input: PetBodyInput;
  readonly motion: MotionAppearance | null;
}

/** Current semantic input and first-frame-committed Motion activity target. */
export interface MotionActivityBodyState {
  readonly input: PetBodyInput;
  readonly committed: MotionAppearance | null;
  readonly appearancePending: boolean;
}

export interface PetBodyResult {
  readonly epoch: string;
  readonly snapshotId: string;
  readonly presentationId: string;
  readonly outfitId: string;
  readonly playbackId: number;
  readonly intentId?: string;
  readonly outcome: "started" | "completed" | "cancelled" | "failed" | "deferred";
}

export const petBodyChannels = {
  ready: "openpets:pet-body-ready",
  state: "openpets:pet-body-state",
  result: "openpets:pet-body-result",
  preference: "openpets:pet-motion-preference",
} as const;
