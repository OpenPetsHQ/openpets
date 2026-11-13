import { fileURLToPath } from "node:url";
import { readBoundedRegularFile } from "@open-pets/pet-format/node/files";
import { calculateMotionActivityDurationMs, getMotionAnimationFirstClip, motionMaxClipBytes, resolveMotionActivityAnimation } from "@open-pets/pet-format/motion";
import type { MotionAnimation, MotionActivity } from "@open-pets/pet-format/motion";
import type { AvailablePetActivity } from "./pet-activity-contract.js";
import type { MotionAppearance } from "./pet-body-contract.js";
import { decodeMotionPreviewFrame } from "./pet-atlas-validation.js";

function resolveActivity(appearance: MotionAppearance, activity: MotionActivity): Extract<MotionAnimation, { play: "once" }> | null {
  const selected = resolveMotionActivityAnimation(activity, appearance.outfitId);
  if (!selected) return null;
  const animation = appearance.assets.metadata.animations[selected.animation];
  if (!animation || animation.play !== "once") throw new Error(`Motion activity ${activity.id} has no valid one-shot animation.`);
  return animation;
}

/** Options are derived only from the committed appearance and verified clip timings. */
export function getMotionActivityOptions(appearance: MotionAppearance): readonly AvailablePetActivity[] {
  const { metadata, verifiedClips } = appearance.assets;
  return (metadata.activities ?? []).flatMap((activity) => {
    const animation = resolveActivity(appearance, activity);
    if (!animation) return [];
    return [{ id: activity.id, displayName: activity.displayName, durationMs: calculateMotionActivityDurationMs(animation, metadata.clips, verifiedClips) }];
  });
}

/** Read the first frame from the live, immutable committed snapshot, never the install tree. */
export async function readMotionActivityPreview(appearance: MotionAppearance, activityId: string): Promise<{ readonly bytes: Buffer; readonly mimeType: string }> {
  const { isTrackedMotionSnapshotDescriptor } = await import("./pet-motion-snapshot.js");
  if (!isTrackedMotionSnapshotDescriptor(appearance.assets)) throw new Error("Motion activity snapshot is no longer retained.");
  const activity = appearance.assets.metadata.activities?.find((candidate) => candidate.id === activityId);
  const animation = activity && resolveActivity(appearance, activity);
  if (!animation) throw new Error("Activity is unavailable for this Motion outfit.");
  const clipId = getMotionAnimationFirstClip(animation);
  const url = appearance.assets.urls[clipId];
  if (!url || !appearance.assets.verifiedClips[clipId]) throw new Error("Motion activity preview clip is unavailable.");
  const encoded = await readBoundedRegularFile(fileURLToPath(url), motionMaxClipBytes, "Motion activity preview clip");
  const bytes = await decodeMotionPreviewFrame(encoded, appearance.assets.metadata.geometry);
  if (!isTrackedMotionSnapshotDescriptor(appearance.assets)) throw new Error("Motion activity snapshot was released during preview decoding.");
  return { bytes, mimeType: "image/png" };
}
