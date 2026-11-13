import type { MotionBodyDescriptor } from "./pet-body-contract.js";
import type { HudScaleValue, PetScaleValue } from "./app-state.js";
import type { UniversalSpriteState } from "@open-pets/pet-format/animation";
import type { PetContentRender } from "./pet-window-types.js";
import { createPetWindowCss } from "./pet-window-styles.js";
import { createPetWindowDocument } from "./pet-window-document.js";
import { calculateMotionLayout, motionLayoutCssVariables, type MotionLayoutInput } from "./pet-motion-layout.js";

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
  readonly layoutInput: MotionLayoutInput;
}): PetContentRender {
  const { scale } = options;
  const motionLayout = calculateMotionLayout(options.layoutInput);
  const variables = Object.entries(motionLayoutCssVariables(motionLayout)).map(([name, value]) => `${name}: ${value};`).join(" ");

  const styles = `
    ${createPetWindowCss(options.paused, scale, options.hudScale, options.dragRegion)}
    .stage { ${variables} }
    .pet-shell { width: var(--motion-shell-width); height: var(--motion-shell-height); left: var(--motion-shell-left); top: var(--motion-shell-top); transform-origin: var(--motion-foot-origin-x) var(--motion-foot-origin-y); }
    .pet-hitbox { width: var(--motion-hitbox-width); height: var(--motion-hitbox-height); }
    .sprite[data-motion-body] { position: relative; width: var(--motion-logical-width); height: var(--motion-logical-height); transform: scale(var(--motion-fit-scale)); transform-origin: top left; }
  `;
  return {
    motion: options.motion,
    motionLayout,
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
