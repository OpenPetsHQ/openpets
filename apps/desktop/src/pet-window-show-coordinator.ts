export type PetWindowShowCoordinator = {
  schedule(readiness: Promise<unknown>, show: () => void): void;
  cancel(): void;
};

export function createPetWindowShowCoordinator(): PetWindowShowCoordinator {
  let generation = 0;

  return {
    schedule(readiness, show) {
      const requestedGeneration = ++generation;
      const showIfCurrent = (): void => {
        if (requestedGeneration === generation) show();
      };
      void readiness.then(showIfCurrent, showIfCurrent);
    },
    cancel() {
      generation += 1;
    },
  };
}
