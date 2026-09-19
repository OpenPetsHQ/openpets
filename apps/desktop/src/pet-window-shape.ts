export type PetShapeRectangle = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type PetInteractiveShapeOptions = {
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly spriteWidth: number;
  readonly spriteHeight: number;
  readonly scale: number;
  readonly hasBubble: boolean;
  readonly isExpanded?: boolean;
  readonly isCompactOpen?: boolean;
  readonly panelWidth?: number;
  readonly panelHeight?: number;
  readonly panelTop?: number;
};

export type PetInteractiveShape = {
  readonly shape: readonly PetShapeRectangle[];
  readonly petHitbox: PetShapeRectangle;
  readonly companionLauncher: PetShapeRectangle;
  readonly chatPanel?: PetShapeRectangle;
  readonly compactComposer?: PetShapeRectangle;
};

/**
 * Shared compact-composer envelope. The renderer keeps its normal auto-sized
 * layout, but its textarea and error feedback are bounded to this envelope so
 * the Linux input mask can cover the same maximum geometry.
 */
export const compactComposerGeometry = Object.freeze({
  maxWidth: 196,
  horizontalInset: 8,
  maxHeight: 152,
  paddingX: 10,
  paddingY: 8,
  gap: 6,
  borderWidth: 1,
  headerHeight: 20,
  errorMaxHeight: 34,
  textareaMaxHeight: 68,
  controlHeight: 30,
});

const petBottom = 22;
const hitPadding = 28;
const bubbleHeight = 156;
const companionLauncherSize = 22;
const companionLauncherInset = 8;
const defaultPanelWidth = 390;
const defaultPanelHeight = 500;
const defaultPanelTop = 14;

/**
 * Computes the Linux input shape for the carrier window.
 * When passive, the shape covers the pet hitbox and speech bubbles. When the
 * compact composer is open, it replaces the bubble region. When expanded, the
 * shape encompasses both the pet at the bottom and the attached chat panel above it.
 */
export function calculatePetInteractiveShape(options: PetInteractiveShapeOptions): PetInteractiveShape {
  const scaledWidth = Math.ceil(options.spriteWidth * options.scale);
  const scaledHeight = Math.ceil(options.spriteHeight * options.scale);
  const petHitbox: PetShapeRectangle = {
    x: Math.round((options.windowWidth - (scaledWidth + hitPadding * 2)) / 2),
    y: Math.round(options.windowHeight - Math.max(0, petBottom - hitPadding) - (scaledHeight + hitPadding * 2)),
    width: scaledWidth + hitPadding * 2,
    height: scaledHeight + hitPadding * 2,
  };
  const companionLauncher: PetShapeRectangle = {
    x: petHitbox.x + petHitbox.width - companionLauncherInset - companionLauncherSize,
    y: petHitbox.y + petHitbox.height - companionLauncherInset - companionLauncherSize,
    width: companionLauncherSize,
    height: companionLauncherSize,
  };
  const shape: PetShapeRectangle[] = [petHitbox];

  let chatPanel: PetShapeRectangle | undefined;
  let compactComposer: PetShapeRectangle | undefined;
  if (options.isExpanded) {
    const width = options.panelWidth ?? defaultPanelWidth;
    const height = options.panelHeight ?? defaultPanelHeight;
    const top = options.panelTop ?? defaultPanelTop;
    chatPanel = {
      x: Math.round((options.windowWidth - width) / 2),
      y: top,
      width,
      height,
    };
    shape.push(chatPanel);
  } else if (options.isCompactOpen) {
    const width = Math.min(compactComposerGeometry.maxWidth, Math.max(0, options.windowWidth - compactComposerGeometry.horizontalInset * 2));
    const height = Math.min(compactComposerGeometry.maxHeight, options.windowHeight);
    const bubbleBottom = Math.ceil(petBottom + scaledHeight + 8);
    compactComposer = {
      x: Math.round((options.windowWidth - width) / 2),
      y: options.windowHeight - bubbleBottom - height,
      width,
      height,
    };
    shape.push(compactComposer);
  }

  if (options.hasBubble && !options.isExpanded && !options.isCompactOpen) {
    const bubbleBottom = Math.ceil(petBottom + scaledHeight + 8);
    shape.push({
      x: 0,
      y: Math.max(0, options.windowHeight - bubbleBottom - bubbleHeight),
      width: options.windowWidth,
      height: Math.min(bubbleHeight, options.windowHeight),
    });
  }

  return {
    shape,
    petHitbox,
    companionLauncher,
    ...(chatPanel ? { chatPanel } : {}),
    ...(compactComposer ? { compactComposer } : {}),
  };
}

export function isRectangleContained(inner: PetShapeRectangle, outer: PetShapeRectangle): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}
