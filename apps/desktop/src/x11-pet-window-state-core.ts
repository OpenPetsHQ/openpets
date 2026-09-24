export const petWindowStateAtoms = [
  "_NET_WM_STATE_SKIP_TASKBAR",
  "_NET_WM_STATE_SKIP_PAGER",
] as const;

export const optionalPetWindowStateAtoms = ["_KDE_NET_WM_STATE_SKIP_SWITCHER"] as const;

export const allPetWindowStateAtoms = [...petWindowStateAtoms, ...optionalPetWindowStateAtoms] as const;

export function mergePetWindowStateAtoms(existing: readonly number[], required: readonly number[]): number[] {
  const merged = [...existing];
  for (const atom of required) {
    if (!merged.includes(atom)) merged.push(atom);
  }
  return merged;
}

export function isAtomProperty(type: number, format: number, atomType: number): boolean {
  return type === atomType && format === 32;
}

export function missingAtoms(existing: readonly number[], required: readonly number[]): number[] {
  return required.filter((atom) => !existing.includes(atom));
}

export function requiredPetWindowStateAtoms(
  supportedAtoms: readonly number[],
  standardAtoms: readonly number[],
  optionalAtoms: readonly number[],
): number[] {
  return [
    ...standardAtoms,
    ...optionalAtoms.filter((atom) => supportedAtoms.includes(atom)),
  ];
}

export function canCompletePetWindowStateApplication(
  currentAtoms: readonly number[],
  requiredAtoms: readonly number[],
  requestsProcessed: boolean,
): boolean {
  return requestsProcessed && missingAtoms(currentAtoms, requiredAtoms).length === 0;
}
