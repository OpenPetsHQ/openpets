import { getAppStateSnapshot } from "./app-state.js";
import { error as logError } from "./logger.js";

/**
 * Re-render every window currently showing `petId`, whatever its role
 * (default, agent, plugin-spawned, LAN visitor, pinned). Used when a per-pet
 * presentation preference changes: horizontal flip or the worn outfit.
 *
 * Controllers are imported lazily because they depend on the pet-window
 * modules that call this, which would otherwise form an import cycle.
 */
export function refreshPetWindowsForPetId(petId: string, reason: string): void {
  if (petId === getAppStateSnapshot().preferences.defaultPetId) {
    void import("./default-pet-controller.js")
      .then(({ refreshDefaultPetContent }) => refreshDefaultPetContent())
      .catch((error: unknown) => logRefreshFailure("default", reason, error));
  }
  void import("./agent-pet-controller.js")
    .then(({ refreshAgentPetContent }) => refreshAgentPetContent(petId))
    .catch((error: unknown) => logRefreshFailure("agent", reason, error));
  void import("./plugin-pet-registry.js")
    .then(({ refreshPluginPetsForPetId }) => refreshPluginPetsForPetId(petId))
    .catch((error: unknown) => logRefreshFailure("plugin", reason, error));
  void import("./lan-pet-controller.js")
    .then(({ refreshLanVisitingPetsForPetId }) => refreshLanVisitingPetsForPetId(petId))
    .catch((error: unknown) => logRefreshFailure("lan", reason, error));
  void import("./pinned-pet-controller.js")
    .then(({ refreshPinnedPetContent }) => refreshPinnedPetContent(petId))
    .catch((error: unknown) => logRefreshFailure("pinned", reason, error));
}

/**
 * Re-render every pet window of every role. Used when a global presentation
 * preference changes, such as the speech bubble size.
 */
export function refreshAllPetWindows(reason: string): void {
  void import("./default-pet-controller.js")
    .then(({ refreshDefaultPetContent }) => refreshDefaultPetContent())
    .catch((error: unknown) => logRefreshFailure("default", reason, error));
  void import("./agent-pet-controller.js")
    .then(({ refreshAgentPetContent }) => refreshAgentPetContent())
    .catch((error: unknown) => logRefreshFailure("agent", reason, error));
  void import("./plugin-pet-registry.js")
    .then(({ refreshAllPluginPets }) => refreshAllPluginPets())
    .catch((error: unknown) => logRefreshFailure("plugin", reason, error));
  void import("./lan-pet-controller.js")
    .then(({ refreshAllLanVisitingPets }) => refreshAllLanVisitingPets())
    .catch((error: unknown) => logRefreshFailure("lan", reason, error));
  void import("./pinned-pet-controller.js")
    .then(({ refreshPinnedPetContent }) => refreshPinnedPetContent())
    .catch((error: unknown) => logRefreshFailure("pinned", reason, error));
}

function logRefreshFailure(role: string, reason: string, error: unknown): void {
  logError("pet.window", `refresh ${role} pet on ${reason} failed`, error instanceof Error ? error : { error });
}
