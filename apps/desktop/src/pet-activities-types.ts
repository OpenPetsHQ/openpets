/** Clone-safe Control Center projection; native playback never creates a carrier. */
export interface PetActivitiesSnapshot {
  readonly petId: string;
  readonly activities: ReadonlyArray<{
    readonly id: string;
    readonly displayName: string;
    readonly frameCount: number;
    readonly fps: number;
    readonly enabled: boolean;
    readonly previewUrl: string | null;
    readonly availabilityReason: string | null;
  }>;
  readonly availabilityReason: string | null;
  readonly playingActivityId: string | null;
}
