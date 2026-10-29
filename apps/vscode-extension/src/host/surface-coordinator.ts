import type { SurfaceKind, SurfaceState } from "../protocol.js";

export class SurfaceCoordinator {
  private readonly surfaces = new Map<string, SurfaceState>();
  private readonly listeners = new Set<(state: SurfaceState) => void>();
  private sequence = 0;

  attach(surfaceId: string, kind: SurfaceKind, visible: boolean): void {
    this.surfaces.set(surfaceId, {
      surfaceId,
      kind,
      visible,
      playbackEnabled: false,
      sequence: 0,
    });
    this.reconcile();
  }

  setVisible(surfaceId: string, visible: boolean): void {
    const state = this.surfaces.get(surfaceId);
    if (!state || state.visible === visible) return;
    this.surfaces.set(surfaceId, { ...state, visible });
    this.reconcile();
  }

  detach(surfaceId: string): void {
    if (this.surfaces.delete(surfaceId)) this.reconcile();
  }

  get(surfaceId: string): SurfaceState {
    const state = this.surfaces.get(surfaceId);
    if (!state) throw new Error("Surface is no longer available.");
    return state;
  }

  subscribe(listener: (state: SurfaceState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private reconcile(): void {
    const states = [...this.surfaces.values()];
    const active =
      states.find((state) => state.kind === "editor" && state.visible) ??
      states.find((state) => state.kind === "view" && state.visible);
    for (const state of states) {
      const next = {
        ...state,
        playbackEnabled: state.surfaceId === active?.surfaceId,
        sequence: ++this.sequence,
      };
      this.surfaces.set(state.surfaceId, next);
      for (const listener of this.listeners) listener(next);
    }
  }
}
