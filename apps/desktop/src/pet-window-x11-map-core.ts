export type PetWindowX11Event = {
  readonly name: string;
  readonly wid?: number;
};

export type PetWindowX11MapTransition = {
  acceptMapNotify(event: PetWindowX11Event): boolean;
  cancel(): void;
  isCancelled(): boolean;
};

export function createPetWindowX11MapTransition(windowId: number): PetWindowX11MapTransition {
  let state: "waiting" | "mapped" | "cancelled" = "waiting";

  return {
    acceptMapNotify(event) {
      if (state !== "waiting" || event.name !== "MapNotify" || event.wid !== windowId) return false;
      state = "mapped";
      return true;
    },
    cancel() {
      if (state === "waiting") state = "cancelled";
    },
    isCancelled() {
      return state === "cancelled";
    },
  };
}
