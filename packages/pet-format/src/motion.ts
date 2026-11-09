import { defaultOutfitId, type PetOutfitIdentity, type WardrobeDefinition } from "./wardrobe.js";

export type MotionContextReaction =
  | "thinking"
  | "working"
  | "editing"
  | "running"
  | "testing"
  | "waiting";

export type MotionEventReaction = "waving" | "success" | "error" | "celebrating";

export interface MotionVariant {
  readonly animation: string;
  readonly weight?: number;
}

export type MotionAnimation =
  | {
    readonly play: "loop";
    readonly intro?: string;
    readonly loop: string;
    readonly outro?: string;
  }
  | {
    readonly play: "once";
    readonly intro?: string;
    readonly clip: string;
    readonly outro?: string;
  };

export interface MotionBindings {
  readonly idle: MotionVariant[];
  readonly movement: { readonly left: string; readonly right: string };
  readonly contexts?: Partial<Record<MotionContextReaction, MotionVariant[]>>;
  readonly events?: Partial<Record<MotionEventReaction, MotionVariant[]>>;
}

export interface MotionOutfit extends PetOutfitIdentity {
  readonly bindings: MotionBindings;
}

export interface MotionWardrobe extends WardrobeDefinition {
  readonly outfits: readonly MotionOutfit[];
}

export interface MotionPetMetadata {
  readonly format: "motion";
  readonly version: 1;
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly geometry: {
    readonly width: number;
    readonly height: number;
    readonly pixelsPerUnit: number;
    readonly footAnchor: { readonly x: number; readonly y: number };
  };
  readonly clips: Record<string, {
    readonly file: string;
    readonly frames: number;
    readonly playbackRate?: number;
  }>;
  readonly animations: Record<string, MotionAnimation>;
  readonly bindings: MotionBindings;
  readonly wardrobe?: MotionWardrobe;
}

export function getMotionOutfitBindings(metadata: MotionPetMetadata, outfitId: string): MotionBindings {
  if (outfitId === defaultOutfitId) return metadata.bindings;
  const outfit = metadata.wardrobe?.outfits.find((candidate) => candidate.id === outfitId);
  if (!outfit) throw new Error(`Unknown Motion outfit: ${outfitId}`);
  return outfit.bindings;
}

/** Native encoded durations; the authored playback rate is applied at runtime. */
export interface VerifiedMotionClip {
  readonly frameDurationsMs: readonly number[];
  readonly durationMs: number;
}
