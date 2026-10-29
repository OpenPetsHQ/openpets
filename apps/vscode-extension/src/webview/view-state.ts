import type { CatalogPetView, CompanionSnapshot, SurfaceState } from "../protocol.js";

/** A cached catalog listing must reflect the latest host-owned installations. */
export function projectCatalogInstallations(
  pets: readonly CatalogPetView[],
  snapshot: CompanionSnapshot,
): readonly CatalogPetView[] {
  const installedIds = new Set(snapshot.installedPets.filter((pet) => pet.source === "catalog").map((pet) => pet.id));
  return pets.map((pet) => ({ ...pet, installed: installedIds.has(pet.id) }));
}

/** Apply equally to events, ready results, and mutation replies. */
export function acceptSnapshot(current: CompanionSnapshot | undefined, incoming: CompanionSnapshot): CompanionSnapshot {
  return !current || incoming.revision > current.revision ? incoming : current;
}

/** Surface sequences are connection-local; reset current when attaching a new surface. */
export function acceptSurface(current: SurfaceState | undefined, incoming: SurfaceState): SurfaceState {
  return !current || (incoming.surfaceId === current.surfaceId && incoming.sequence > current.sequence) ? incoming : current;
}
