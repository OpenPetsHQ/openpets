import { defaultPetSprite } from "@open-pets/pet-format/animation";
import { getPetSpritePosition } from "@open-pets/pet-format/sprite-layout";
import type { SpriteAsset } from "../protocol.js";
import { useState } from "react";

/** A single neutral atlas cell, not the full sheet and never an animation loop. */
export function SpritePreview({
  sprite,
  label,
}: {
  sprite: SpriteAsset;
  label: string;
}) {
  const [failedUri, setFailedUri] = useState<string>();
  const { layout } = sprite;
  const pose = getPetSpritePosition(layout, defaultPetSprite.states.idle, true);
  return (
    <span className="sprite-preview" role="img" aria-label={label}>
      {failedUri === sprite.uri ? (
        <span className="preview-error">Preview unavailable</span>
      ) : (
        <span
          className="sprite-cell"
          style={{
            aspectRatio: `${layout.frameWidth} / ${layout.frameHeight}`,
          }}
        >
          <img
            src={sprite.uri}
            alt=""
            draggable={false}
            onError={() => setFailedUri(sprite.uri)}
            style={{
              width: `${layout.columns * 100}%`,
              height: `${layout.rows * 100}%`,
              left: `${-pose.startColumn * 100}%`,
              top: `${-pose.row * 100}%`,
            }}
          />
        </span>
      )}
    </span>
  );
}
