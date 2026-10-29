export interface PetSpriteLayout {
  readonly version: 1 | 2;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly neutralPose?: {
    readonly row: number;
    readonly column: number;
  };
}

/** Activity previews address one declared outfit representation of an installed pet. */
export function isAllowedPetActivityPreview(value: string | undefined): value is string {
  return typeof value === "string"
    && /^openpets-installed:\/\/activity\/[a-z0-9][a-z0-9_-]{0,63}\/[a-z0-9][a-z0-9_-]{0,31}\/[a-z0-9][a-z0-9_-]{0,31}$/u.test(value);
}

export interface PetSpritePreviewModel {
  readonly atlasColumns: number;
  readonly atlasRows: number;
  readonly row: number;
  readonly frameColumns: readonly number[];
  readonly animated: boolean;
}

export const defaultPetSpriteLayout: PetSpriteLayout = {
  version: 1,
  frameWidth: 192,
  frameHeight: 208,
  columns: 8,
  rows: 9,
};

export const catalogV2SpriteLayout: PetSpriteLayout = {
  version: 2,
  frameWidth: 192,
  frameHeight: 208,
  columns: 8,
  rows: 11,
  neutralPose: { row: 0, column: 6 },
};

export function getCatalogPetSpriteLayout(spriteVersionNumber: 2 | undefined): PetSpriteLayout | undefined {
  return spriteVersionNumber === 2 ? catalogV2SpriteLayout : undefined;
}

export function buildPetSpritePreviewModel(
  layout: PetSpriteLayout | undefined,
  state: { readonly row: number; readonly frames: number },
  useNeutralPose = false,
): PetSpritePreviewModel {
  const resolvedLayout = layout ?? defaultPetSpriteLayout;
  const neutralPose = useNeutralPose && state.row === resolvedLayout.neutralPose?.row
    ? resolvedLayout.neutralPose
    : undefined;
  const frameColumns = neutralPose
    ? [neutralPose.column]
    : Array.from({ length: state.frames }, (_, index) => index);

  return {
    atlasColumns: resolvedLayout.columns,
    atlasRows: resolvedLayout.rows,
    row: neutralPose?.row ?? state.row,
    frameColumns,
    animated: !neutralPose && frameColumns.length > 1,
  };
}
