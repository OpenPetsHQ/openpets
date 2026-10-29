export interface PetSpriteLayout {
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

export interface PetSpritePosition {
  readonly row: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly animated: boolean;
}

export const codexV1SpriteLayout: PetSpriteLayout = {
  version: 1,
  frameWidth: 192,
  frameHeight: 208,
  columns: 8,
  rows: 9,
};

export const codexV2SpriteLayout: PetSpriteLayout = {
  version: 2,
  frameWidth: 192,
  frameHeight: 208,
  columns: 8,
  rows: 11,
  neutralPose: { row: 0, column: 6 },
};

export function getCodexPetSpriteLayout(value: unknown): PetSpriteLayout {
  if (!isRecord(value) || !Object.hasOwn(value, "spriteVersionNumber")) return codexV1SpriteLayout;
  if (value.spriteVersionNumber === 2) return codexV2SpriteLayout;
  throw new Error("Codex pet spriteVersionNumber must be 2 when provided.");
}

export function getCodexPetSpritePosition(layout: PetSpriteLayout, state: { readonly row: number; readonly frames: number }, useNeutralPose = false): PetSpritePosition {
  const neutralPose = useNeutralPose ? layout.neutralPose : undefined;
  if (neutralPose && state.row === neutralPose.row) {
    return { row: neutralPose.row, startColumn: neutralPose.column, endColumn: neutralPose.column, animated: false };
  }
  return { row: state.row, startColumn: 0, endColumn: state.frames, animated: true };
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type CodexPetSpriteLayout = PetSpriteLayout;
export type CodexPetSpritePosition = PetSpritePosition;
export const getPetSpriteLayout = getCodexPetSpriteLayout;
export const getPetSpritePosition = getCodexPetSpritePosition;
