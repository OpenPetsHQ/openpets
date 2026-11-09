import {
  defaultPetSprite,
  type UniversalSpriteState,
} from "@open-pets/pet-format/animation";

/** Local evaluation format; deliberately not a published pet.json contract. */
export interface MotionPreviewClip {
  readonly file: string;
  readonly frames: number;
}

export interface MotionPreviewAnimation {
  readonly play: "loop" | "once";
  readonly clip: MotionPreviewClip;
  readonly enter?: MotionPreviewClip;
  readonly exit?: MotionPreviewClip;
}

export interface MotionPreviewPack {
  readonly version: 1;
  readonly width: number;
  readonly height: number;
  readonly pixelsPerUnit: number;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly animations: Readonly<
    Record<UniversalSpriteState, MotionPreviewAnimation>
  >;
}

export const motionPreviewMaxFileBytes = 32 * 1024 * 1024;
export const motionPreviewMaxTotalBytes = 128 * 1024 * 1024;
export const motionPreviewMaxDecodedPixels = 64_000_000;

export function validateMotionPreviewPack(value: unknown): MotionPreviewPack {
  if (!record(value) || value.version !== 1) {
    throw new Error("Motion preview must have version 1.");
  }
  const width = integer(value.width, 1, 1280, "width");
  const height = integer(value.height, 1, 1280, "height");
  const pixelsPerUnit = finite(value.pixelsPerUnit, 1, 8, "pixelsPerUnit");
  if (!record(value.anchor)) {
    throw new Error("Motion preview needs a shared foot anchor.");
  }
  const anchor = {
    x: finite(value.anchor.x, 0, width, "anchor.x"),
    y: finite(value.anchor.y, 0, height, "anchor.y"),
  };
  if (!record(value.animations)) {
    throw new Error("Motion preview needs animations.");
  }
  const animations: Partial<
    Record<UniversalSpriteState, MotionPreviewAnimation>
  > = {};
  const fileFrames = new Map<string, number>();
  const states = Object.keys(defaultPetSprite.states) as UniversalSpriteState[];
  if (
    Object.keys(value.animations).some(
      (state) => !states.includes(state as UniversalSpriteState),
    )
  ) {
    throw new Error("Motion preview contains an unknown animation.");
  }
  for (const state of states) {
    const animation = value.animations[state];
    if (
      !record(animation) ||
      (animation.play !== "loop" && animation.play !== "once")
    ) {
      throw new Error(`Motion preview needs a valid ${state} animation.`);
    }
    const clip = validateClip(animation.clip, width * height);
    const enter =
      animation.enter === undefined
        ? undefined
        : validateClip(animation.enter, width * height);
    const exit =
      animation.exit === undefined
        ? undefined
        : validateClip(animation.exit, width * height);
    for (const item of [clip, enter, exit]) {
      if (!item) {
        continue;
      }
      const previous = fileFrames.get(item.file);
      if (previous !== undefined && previous !== item.frames) {
        throw new Error(
          "A motion preview file must have one consistent frame count.",
        );
      }
      fileFrames.set(item.file, item.frames);
    }
    if (animation.play === "once" && (enter || exit)) {
      throw new Error(
        "One-shot motion previews contain their own entry and return.",
      );
    }
    if (state === "idle" && (animation.play !== "loop" || enter || exit)) {
      throw new Error("Motion preview idle must be one looping clip.");
    }
    animations[state] = {
      play: animation.play,
      clip,
      ...(enter ? { enter } : {}),
      ...(exit ? { exit } : {}),
    };
  }
  // Every canonical state was validated and populated above.
  return {
    version: 1,
    width,
    height,
    pixelsPerUnit,
    anchor,
    animations: animations as Record<
      UniversalSpriteState,
      MotionPreviewAnimation
    >,
  };
}

export function motionPreviewClips(
  pack: MotionPreviewPack,
): MotionPreviewClip[] {
  return Object.values(pack.animations).flatMap((animation) => [
    ...(animation.enter ? [animation.enter] : []),
    animation.clip,
    ...(animation.exit ? [animation.exit] : []),
  ]);
}

function validateClip(value: unknown, pixels: number): MotionPreviewClip {
  if (
    !record(value) ||
    typeof value.file !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,79}\.webp$/.test(value.file)
  ) {
    throw new Error(
      "Motion preview clips must name a local WebP file without directories.",
    );
  }
  const frames = integer(value.frames, 2, 240, "frames");
  if (frames * pixels > motionPreviewMaxDecodedPixels) {
    throw new Error("Motion preview clip exceeds the decoded pixel budget.");
  }
  return { file: value.file, frames };
}

function integer(
  value: unknown,
  min: number,
  max: number,
  name: string,
): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Motion preview ${name} must be an integer.`);
  }
  return finite(value, min, max, name);
}

function finite(
  value: unknown,
  min: number,
  max: number,
  name: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`Motion preview ${name} is out of bounds.`);
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
