import type { RenderedOutfitState } from "./pet-wardrobe-types.js";

const windows = new Map<number, RenderedOutfitState>();
const listeners = new Set<(petId: string) => void>();

function notify(petId: string): void {
  for (const listener of listeners) listener(petId);
}

export function subscribeRenderedOutfits(listener: (petId: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getRenderedOutfits(petId: string): readonly RenderedOutfitState[] {
  return [...windows.values()].filter((entry) => entry.petId === petId);
}

export function noteOutfitRequest(windowId: number, petId: string, outfitId: string, presentationId: string, hidden: boolean, isDefault: boolean): void {
  const previous = windows.get(windowId);
  if (previous?.petId === petId && previous.presentationId === presentationId) return;
  windows.set(windowId, {
    windowId, isDefault, petId, outfitId: previous?.petId === petId ? previous.outfitId : null,
    requestedOutfitId: outfitId, presentationId, status: hidden ? "deferred" : "loading",
  });
  if (previous && previous.petId !== petId) notify(previous.petId);
  notify(petId);
}

export function commitRenderedOutfit(windowId: number, petId: string, presentationId: string): void {
  const current = windows.get(windowId);
  if (!current || current.petId !== petId || current.presentationId !== presentationId) return;
  if (current.status === "ready" && current.outfitId === current.requestedOutfitId) return;
  windows.set(windowId, { ...current, outfitId: current.requestedOutfitId, status: "ready", error: undefined });
  notify(petId);
}

export function failOutfitRequest(windowId: number, petId: string, presentationId: string, status: "failed" | "deferred", error?: string): void {
  const current = windows.get(windowId);
  if (!current || current.petId !== petId || current.presentationId !== presentationId) return;
  if (current.status === status && current.error === error) return;
  windows.set(windowId, { ...current, status, error });
  notify(petId);
}

export function forgetOutfitWindow(windowId: number): void {
  const current = windows.get(windowId);
  if (!current) return;
  windows.delete(windowId);
  notify(current.petId);
}
