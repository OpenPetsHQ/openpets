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
  readonly panelWidth?: number;
  readonly panelHeight?: number;
  readonly panelTop?: number;
};

export type PetInteractiveShape = {
  readonly shape: readonly PetShapeRectangle[];
  readonly petHitbox: PetShapeRectangle;
  readonly companionLauncher: PetShapeRectangle;
  readonly chatPanel?: PetShapeRectangle;
};

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
 * When collapsed, the shape covers the compact pet hitbox and speech bubbles.
 * When expanded, the shape encompasses both the pet at the bottom and the attached
 * chat panel above it.
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
  }

  if (options.hasBubble && !options.isExpanded) {
    const bubbleBottom = Math.ceil(petBottom + scaledHeight + 8);
    shape.push({
      x: 0,
      y: Math.max(0, options.windowHeight - bubbleBottom - bubbleHeight),
      width: options.windowWidth,
      height: Math.min(bubbleHeight, options.windowHeight),
    });
  }

  return { shape, petHitbox, companionLauncher, ...(chatPanel ? { chatPanel } : {}) };
}

export function isRectangleContained(inner: PetShapeRectangle, outer: PetShapeRectangle): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}
