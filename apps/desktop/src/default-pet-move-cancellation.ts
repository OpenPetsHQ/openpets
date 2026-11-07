export type DefaultPetMoveCancellationState = {
  generation: number;
  activeGeneration: number | null;
};

export function beginDefaultPetMove(state: DefaultPetMoveCancellationState): number {
  const generation = ++state.generation;
  state.activeGeneration = generation;
  return generation;
}

export function cancelDefaultPetMove(state: DefaultPetMoveCancellationState): void {
  state.generation += 1;
  state.activeGeneration = null;
}

export function isDefaultPetMoveCurrent(state: DefaultPetMoveCancellationState, generation: number): boolean {
  return state.activeGeneration === generation;
}

export function finishDefaultPetMove(state: DefaultPetMoveCancellationState, generation: number): void {
  if (isDefaultPetMoveCurrent(state, generation)) state.activeGeneration = null;
}
