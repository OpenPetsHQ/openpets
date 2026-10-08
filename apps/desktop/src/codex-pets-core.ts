import sharp from "sharp";

export const maxCodexPetJsonBytes = 128 * 1024;
export const maxCodexSpritesheetBytes = 100 * 1024 * 1024;
export const maxCodexThumbnailSourceBytes = 24 * 1024 * 1024;
export const maxCodexPets = 100;

export interface CodexPetMetadata {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly spritesheetPath: "spritesheet.webp";
  readonly spriteVersionNumber?: 2;
  readonly gazeAnchor?: CodexPetGazeAnchor;
}

/** A gaze target normalized within one sprite frame, measured from its top-left. */
export interface CodexPetGazeAnchor {
  readonly x: number;
  readonly y: number;
}

export interface CodexPetSpriteLayout {
  readonly version: 1 | 2;
  readonly frameWidth: 192;
  readonly frameHeight: 208;
  readonly columns: 8;
  readonly rows: 9 | 11;
  readonly neutralPose?: {
    readonly row: 0;
    readonly column: 6;
  };
}

export interface CodexPetSpritePosition {
  readonly row: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly animated: boolean;
}

export const codexV1SpriteLayout: CodexPetSpriteLayout = {
  version: 1,
  frameWidth: 192,
  frameHeight: 208,
  columns: 8,
  rows: 9,
};

export const codexV2SpriteLayout: CodexPetSpriteLayout = {
  version: 2,
  frameWidth: 192,
  frameHeight: 208,
  columns: 8,
  rows: 11,
  neutralPose: { row: 0, column: 6 },
};

export const codexV2GazeSectorCount = 16;
export const codexV2GazeSectorAngle = (Math.PI * 2) / codexV2GazeSectorCount;
export const codexV2GazeDeadZonePx = 24;
export const codexV2GazeIdleResetMs = 1_200;

export interface CodexV2GazePoint {
  readonly x: number;
  readonly y: number;
}

export interface CodexV2GazeCarrierBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Resolve a normalized frame anchor against the base-scale card origin and the
 * sprite's effective transform scale. Omission preserves the legacy carrier
 * bottom-center anchor.
 */
export function getCodexV2GazeAnchorPoint(
  bounds: CodexV2GazeCarrierBounds,
  frame: { readonly width: number; readonly height: number },
  layoutScale: number,
  spriteScaleOverride: number | null,
  gazeAnchor: CodexPetGazeAnchor | undefined,
  flipped: boolean,
  spriteBottomInset: number,
): CodexV2GazePoint {
  if (!gazeAnchor) return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height };

  const layoutFrameWidth = Math.ceil(frame.width * layoutScale);
  const layoutFrameHeight = Math.ceil(frame.height * layoutScale);
  const spriteLeft = bounds.x + (bounds.width - layoutFrameWidth) / 2;
  const spriteTop = bounds.y + bounds.height - spriteBottomInset - layoutFrameHeight;
  const spriteScale = spriteScaleOverride ?? layoutScale;
  const frameAnchorX = gazeAnchor.x * frame.width * spriteScale;
  return {
    x: spriteLeft + (flipped ? layoutFrameWidth - frameAnchorX : frameAnchorX),
    y: spriteTop + gazeAnchor.y * frame.height * spriteScale,
  };
}

export function isCodexV2GazeActive(lastCursorMovedAt: number | null, now: number, idleResetMs = codexV2GazeIdleResetMs): boolean {
  return lastCursorMovedAt !== null
    && Number.isFinite(lastCursorMovedAt)
    && Number.isFinite(now)
    && Number.isFinite(idleResetMs)
    && idleResetMs > 0
    && now - lastCursorMovedAt < idleResetMs;
}

export interface CodexV2GazeSpritePosition {
  readonly row: 9 | 10;
  readonly column: number;
}

export interface CodexV2GazeEligibility {
  readonly spriteVersion: 1 | 2;
  readonly idleCursorGazeEnabled: boolean;
  readonly paused: boolean;
  readonly reactionState: string;
  readonly motionState: string;
  readonly pluginSpriteOverride: boolean;
}

export function shouldTrackCodexV2Gaze(state: CodexV2GazeEligibility): boolean {
  return state.spriteVersion === 2
    && state.idleCursorGazeEnabled
    && !state.paused
    && state.reactionState === "idle"
    && state.motionState === "idle"
    && !state.pluginSpriteOverride;
}

/**
 * Quantize a cursor point around the pet carrier's bottom-center anchor.
 * Index zero points up and indices increase clockwise in 22.5 degree steps.
 */
export function quantizeCodexV2GazeDirection(
  cursor: CodexV2GazePoint,
  anchor: CodexV2GazePoint,
  deadZonePx = codexV2GazeDeadZonePx,
): number | null {
  if (!isFinitePoint(cursor) || !isFinitePoint(anchor) || !Number.isFinite(deadZonePx) || deadZonePx < 0) return null;
  const dx = cursor.x - anchor.x;
  const dy = cursor.y - anchor.y;
  if (Math.hypot(dx, dy) <= deadZonePx) return null;

  const angle = Math.atan2(dx, -dy);
  const sector = Math.floor((angle + codexV2GazeSectorAngle / 2) / codexV2GazeSectorAngle);
  return (sector + codexV2GazeSectorCount) % codexV2GazeSectorCount;
}

/** Mirror a gaze index before the renderer applies its horizontal CSS flip. */
export function mirrorCodexV2GazeIndex(index: number): number | null {
  if (!isCodexV2GazeIndex(index)) return null;
  return (codexV2GazeSectorCount - index) % codexV2GazeSectorCount;
}

/** Return the static V2 atlas cell for a gaze index, optionally flip-compensated. */
export function getCodexV2GazeSpritePosition(index: number, flipped = false): CodexV2GazeSpritePosition | null {
  if (!isCodexV2GazeIndex(index)) return null;
  const selectedIndex = flipped ? mirrorCodexV2GazeIndex(index) : index;
  if (selectedIndex === null) return null;
  return selectedIndex < 8
    ? { row: 9, column: selectedIndex }
    : { row: 10, column: selectedIndex - 8 };
}

function isCodexV2GazeIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < codexV2GazeSectorCount;
}

function isFinitePoint(value: unknown): value is CodexV2GazePoint {
  return typeof value === "object"
    && value !== null
    && Number.isFinite((value as { readonly x?: unknown }).x)
    && Number.isFinite((value as { readonly y?: unknown }).y);
}

export function validateCodexPetMetadata(value: unknown, folderName: string): CodexPetMetadata {
  if (!isSafeCodexPetId(folderName)) throw new Error("Codex pet folder name is invalid.");
  if (!isRecord(value)) throw new Error("pet.json must be an object.");
  const spriteLayout = getCodexPetSpriteLayout(value);
  if (value.id !== folderName || typeof value.id !== "string") throw new Error("Codex pet id must match its folder name.");
  if (!isSafeCodexPetId(value.id)) throw new Error("Codex pet id is invalid.");
  if (typeof value.displayName !== "string" || value.displayName.trim().length === 0 || value.displayName.length > 80) throw new Error("Codex pet displayName is invalid.");
  if (typeof value.description !== "string" || value.description.trim().length === 0 || value.description.length > 500) throw new Error("Codex pet description is invalid.");
  if (value.spritesheetPath !== "spritesheet.webp") throw new Error("Codex pet spritesheetPath must be spritesheet.webp.");
  const gazeAnchor = value.gazeAnchor === undefined ? undefined : validateCodexPetGazeAnchor(value.gazeAnchor);
  return {
    id: value.id,
    displayName: value.displayName.trim(),
    description: value.description.trim(),
    spritesheetPath: "spritesheet.webp",
    ...(spriteLayout.version === 2 ? { spriteVersionNumber: 2 as const } : {}),
    ...(gazeAnchor ? { gazeAnchor } : {}),
  };
}

function validateCodexPetGazeAnchor(value: unknown): CodexPetGazeAnchor {
  if (!isRecord(value)
    || typeof value.x !== "number"
    || !Number.isFinite(value.x)
    || value.x < 0
    || value.x > 1
    || typeof value.y !== "number"
    || !Number.isFinite(value.y)
    || value.y < 0
    || value.y > 1) {
    throw new Error("Codex pet gazeAnchor must contain normalized finite x and y coordinates.");
  }
  return { x: value.x, y: value.y };
}

export function getCodexPetSpriteLayout(value: unknown): CodexPetSpriteLayout {
  if (!isRecord(value) || !Object.hasOwn(value, "spriteVersionNumber")) return codexV1SpriteLayout;
  if (value.spriteVersionNumber === 2) return codexV2SpriteLayout;
  throw new Error("Codex pet spriteVersionNumber must be 2 when provided.");
}

export function getCodexPetSpritePosition(layout: CodexPetSpriteLayout, state: { readonly row: number; readonly frames: number }, useNeutralPose = false): CodexPetSpritePosition {
  const neutralPose = useNeutralPose ? layout.neutralPose : undefined;
  if (neutralPose && state.row === neutralPose.row) {
    return { row: neutralPose.row, startColumn: neutralPose.column, endColumn: neutralPose.column, animated: false };
  }
  return { row: state.row, startColumn: 0, endColumn: state.frames, animated: true };
}

export async function validateCodexPetSpritesheet(spritesheet: Buffer, metadata: Pick<CodexPetMetadata, "spriteVersionNumber">): Promise<void> {
  const layout = getCodexPetSpriteLayout(metadata);
  if (layout.version === 1) return;

  let imageMetadata: sharp.Metadata;
  const image = sharp(spritesheet, { animated: true, failOn: "error", limitInputPixels: 50_000_000 });
  try {
    imageMetadata = await image.metadata();
  } catch {
    throw new Error("Codex V2 spritesheet metadata is invalid.");
  }
  if (imageMetadata.format !== "webp") throw new Error("Codex V2 spritesheet must be WebP.");
  if (!imageMetadata.hasAlpha) throw new Error("Codex V2 spritesheet must include transparency.");
  if ((imageMetadata.pages ?? 1) !== 1) throw new Error("Codex V2 spritesheet must contain exactly one image.");
  if (imageMetadata.width !== layout.frameWidth * layout.columns || imageMetadata.height !== layout.frameHeight * layout.rows) {
    throw new Error(`Codex V2 spritesheet must be exactly ${layout.frameWidth * layout.columns}x${layout.frameHeight * layout.rows}.`);
  }
  try {
    await image.raw().toBuffer();
  } catch {
    throw new Error("Codex V2 spritesheet must be fully decodable.");
  }
}

function isSafeCodexPetId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) && value !== "builtin";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
