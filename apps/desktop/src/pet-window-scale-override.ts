const petWindowScaleOverrides = new WeakMap<object, number>();

/** Remember an explicit scale independently for each window across content reloads. */
export function rememberPetWindowScaleOverride(window: object, scale: number): void {
  if (!Number.isFinite(scale) || scale <= 0) return;
  petWindowScaleOverrides.set(window, scale);
}

export function getPetWindowScaleOverride(window: object): number | undefined {
  return petWindowScaleOverrides.get(window);
}

/** Reapply a remembered value after a window's renderer content has been loaded. */
export function restorePetWindowScaleOverride(window: object, restore: (scale: number) => void): void {
  const scale = petWindowScaleOverrides.get(window);
  if (scale !== undefined) restore(scale);
}
