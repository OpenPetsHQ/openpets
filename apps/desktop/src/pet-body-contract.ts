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

export interface PetBodySnapshot {
  readonly input: PetBodyInput;
  readonly motion: MotionBodyDescriptor | null;
}

export interface PetBodyResult {
  readonly epoch: string;
  readonly snapshotId: string;
  readonly playbackId: number;
  readonly intentId?: string;
  readonly outcome: "started" | "completed" | "cancelled" | "failed";
}

export const petBodyChannels = {
  ready: "openpets:pet-body-ready",
  state: "openpets:pet-body-state",
  result: "openpets:pet-body-result",
} as const;
