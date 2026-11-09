import type { PetActivityIdentity } from "@open-pets/pet-format/activities";

/** Identifies exactly the committed Motion body an activity targets. */
export interface MotionActivityTarget {
  readonly epoch: string;
  readonly snapshotId: string;
  readonly presentationId: string;
  readonly outfitId: string;
}

/** Logical activity identity with the duration of its selected outfit artwork. */
export interface AvailablePetActivity extends PetActivityIdentity {
  readonly durationMs: number;
}

/** Main-to-renderer payload on openpets:pet-activity. */
export type PetActivityCommand =
  | {
    readonly kind: "play";
    readonly generation: number;
    readonly activityId: string;
    readonly format: "motion";
    readonly target: MotionActivityTarget;
    readonly animation: string;
  }
  | {
    readonly kind: "play";
    readonly generation: number;
    readonly activityId: string;
    readonly format: "classic";
    readonly imageUrl: string;
    readonly frameCount: number;
    readonly fps: number;
    readonly scale: number;
  }
  | {
    readonly kind: "cancel";
    readonly generation: number;
    readonly activityId: string;
    readonly format: "motion";
    readonly target: MotionActivityTarget;
  }
  | {
    readonly kind: "cancel";
    readonly generation: number;
    readonly activityId: string;
    readonly format: "classic";
  }
  | {
    readonly kind: "variation";
  };

/** Renderer-to-main payload on openpets:pet-activity-complete. */
export type PetActivityResult =
  | {
    readonly format: "motion";
    readonly generation: number;
    readonly activityId: string;
    readonly outcome: "started" | "completed" | "cancelled" | "failed";
    readonly target: MotionActivityTarget;
  }
  | {
    readonly format: "classic";
    readonly generation: number;
    readonly activityId: string;
    readonly outcome: "started" | "completed" | "cancelled" | "failed";
  };
