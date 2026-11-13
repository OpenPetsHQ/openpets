import type {
  OutfitScheduleRule,
  PetOutfitIdentity,
} from "@open-pets/pet-format/wardrobe";

export interface RenderedOutfitState {
  readonly windowId: number;
  readonly isDefault: boolean;
  readonly petId: string;
  readonly outfitId: string | null;
  readonly requestedOutfitId: string;
  readonly presentationId: string;
  readonly status: "ready" | "loading" | "deferred" | "failed";
  readonly error?: string;
}

/** Clone-safe wardrobe policy and actual per-window presentation facts. */
export interface PetWardrobeSnapshot {
  readonly petId: string;
  readonly format: "classic" | "motion";
  readonly previewFormat: "atlas" | "image";
  readonly previewWidth?: number;
  readonly previewHeight?: number;
  readonly outfits: readonly PetOutfitIdentity[];
  readonly creatorSchedule: readonly OutfitScheduleRule[];
  readonly schedule: readonly OutfitScheduleRule[];
  readonly scheduleCustomized: boolean;
  readonly choice: string;
  readonly requested: string;
  readonly wearing: string | null;
  readonly scheduled: string;
  readonly activeRuleIndex: number;
  readonly rendered: readonly RenderedOutfitState[];
}

/** Preference mutation only; retry is a separate, one-shot presentation command. */
export interface PetWardrobeUpdate {
  readonly outfit?: string;
  readonly schedule?: readonly OutfitScheduleRule[] | null;
}
