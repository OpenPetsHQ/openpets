/** Clone-safe Control Center projection; native playback never creates a carrier. */
export interface PetActivitiesSnapshot {
  readonly petId: string;
  readonly windowId: number | null;
  readonly outfitId: string | null;
  readonly outfitDisplayName: string | null;
  readonly activities: ReadonlyArray<{
    readonly id: string;
    readonly displayName: string;
    readonly availableOutfitIds: readonly string[];
    readonly availableForCurrentOutfit: boolean;
    readonly enabled: boolean;
    readonly preview:
      | { readonly format: "classic"; readonly url: string; readonly frameCount: number; readonly fps: number }
      | { readonly format: "motion"; readonly url: string; readonly width: number; readonly height: number }
      | null;
    readonly availabilityReason: string | null;
  }>;
  readonly availabilityReason: string | null;
  readonly playingActivityId: string | null;
}
