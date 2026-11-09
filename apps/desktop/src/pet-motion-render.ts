import type { MotionBodyDescriptor } from "./pet-body-contract.js";
import type { HudScaleValue, PetScaleValue } from "./app-state.js";
import type { UniversalSpriteState } from "@open-pets/pet-format/animation";
import type { PetContentRender } from "./pet-window-types.js";
import { createPetWindowCss } from "./pet-window-styles.js";
import { createPetWindowDocument } from "./pet-window-document.js";

export function createInstalledMotionRender(options: {
  readonly motion: MotionBodyDescriptor;
  readonly outfitId: string;
  readonly displayName: string;
  readonly assetName: string;
  readonly bodyHtml: string;
  readonly reactionState: UniversalSpriteState;
  readonly paused: boolean;
  readonly scale: PetScaleValue;
  readonly hudScale: HudScaleValue;
  readonly gazeSpriteBottomInset: number;
  readonly flipped: boolean;
  readonly cacheKey: string;
  readonly language: string;
  readonly role: "default" | "agent";
  readonly dragRegion: "drag" | "no-drag";
}): PetContentRender {
  const { geometry } = options.motion.metadata;
  const width = geometry.width / geometry.pixelsPerUnit;
  const height = geometry.height / geometry.pixelsPerUnit;
  const { scale } = options;
  const styles = `
    ${createPetWindowCss(options.paused, scale, options.hudScale, options.dragRegion)}
    .pet-shell { width: ${width * scale}px; height: ${height * scale}px; left: ${(width / 2 - geometry.footAnchor.x / geometry.pixelsPerUnit) * scale}px; top: ${(height - geometry.footAnchor.y / geometry.pixelsPerUnit) * scale}px; }
    .pet-hitbox { width: ${width * scale + 16}px; height: ${height * scale + 16}px; }
    .sprite[data-motion-body] { position: relative; width: ${width}px; height: ${height}px; transform: scale(${scale}); transform-origin: top left; }
  `;
  return {
    motion: options.motion,
    renderedPetId: options.motion.metadata.id,
    renderedOutfitId: options.outfitId,
    activities: [],
    cacheKey: options.cacheKey,
    bodyHtml: options.bodyHtml,
    displayName: options.displayName,
    assetName: options.assetName,
    reactionState: options.reactionState,
    codexSpriteVersion: 1,
    petScale: scale,
    gazeSpriteBottomInset: options.gazeSpriteBottomInset,
    paused: options.paused,
    flipped: options.flipped,
    html: createPetWindowDocument({
      language: options.language,
      role: options.role,
      displayName: options.displayName,
      assetName: options.assetName,
      reactionState: "idle",
      dragRegion: options.dragRegion,
      flipped: options.flipped,
      spriteVersion: 1,
      paused: options.paused,
      title: "OpenPets Pet",
      styles,
      bodyHtml: options.bodyHtml,
    }),
  };
}
