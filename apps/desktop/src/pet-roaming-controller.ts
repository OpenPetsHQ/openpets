/**
 * pet-roaming-controller.ts — Phase C host module
 *
 * Maintains a registry of all live pet windows so that applyRoamingToAllPets()
 * can reach every registered pet. Native roaming applies gravity to ALL
 * registered pets (both the default pet and agent pets) based on the host
 * `petGravityEnabled` preference (default OFF), which is the single
 * source-of-truth for gravity. Both default-pet-controller.ts and
 * agent-pet-controller.ts register through here so coverage is uniform.
 * When the Walkabout plugin toggles gravity via ctx.pet.physics, it calls
 * setPluginPetPhysics → motionSetPhysics on the same pet id, overriding the
 * host default for that individual pet; applyRoamingToAllPets() can restore
 * the host default for all pets when the preference changes.
 */

import { createRequire } from "node:module";

import { defaultPetBounciness } from "./app-state-core.js";
import { motionSetPhysics, motionStop, registerPet, unregisterPet, type WindowAccessor } from "./pet-motion-engine.js";

// createRequire lets us lazy-load app-state (which imports Electron) only at
// runtime — not at module-load time — so unit tests can import this module
// without a running Electron process. Same pattern as pet-motion-engine.ts.
const require = createRequire(import.meta.url);

let _getPetGravityEnabled: (() => boolean) | null = null;

function getPetGravityEnabledLazy(): boolean {
  if (!_getPetGravityEnabled) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./app-state.js") as { getPetGravityEnabled: () => boolean };
    _getPetGravityEnabled = mod.getPetGravityEnabled;
  }
  return _getPetGravityEnabled();
}

let _getPetBounciness: (() => number) | null = null;

function getPetBouncinessLazy(): number {
  if (!_getPetBounciness) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./app-state.js") as { getPetBounciness: () => number };
    _getPetBounciness = mod.getPetBounciness;
  }
  return _getPetBounciness();
}

// Map of petId -> accessor for all currently live pets
const livePets = new Map<string, WindowAccessor>();

// Test-injectable override so unit tests can set gravity without triggering the
// lazy app-state load (which would fail in plain-node test runners).
let _gravityOverride: boolean | null = null;

function getGravityEnabled(): boolean {
  return _gravityOverride !== null ? _gravityOverride : getPetGravityEnabledLazy();
}

/** The gravity override also pins bounciness to its default so tests never load app-state. */
function getBounciness(): number {
  return _gravityOverride !== null ? defaultPetBounciness : getPetBouncinessLazy();
}

/**
 * Register a pet with the roaming controller AND the motion engine.
 * Call after the pet window has been shown/created.
 */
export function registerRoamingPet(petId: string, accessor: WindowAccessor): void {
  livePets.set(petId, accessor);
  registerPet(petId, accessor);
  applyRoamingToPet(petId, accessor);
}

/**
 * Unregister a pet from the roaming controller and motion engine.
 * Call before the pet window is destroyed.
 */
export function unregisterRoamingPet(petId: string): void {
  livePets.delete(petId);
  unregisterPet(petId);
}

/**
 * Re-apply the current roaming config to every live registered pet.
 * Call when roaming preferences change (e.g. petGravityEnabled toggled).
 */
export function applyRoamingToAllPets(): void {
  for (const [petId, accessor] of livePets) {
    applyRoamingToPet(petId, accessor);
  }
}

/**
 * Apply native roaming registration to a single pet.
 *
 * Reads the host `petGravityEnabled` preference to decide whether to enable
 * physics. When gravity is ON every registered pet falls with physics
 * (gravity:true, bounce:petBounciness). When OFF (the default) no gravity is applied —
 * pets still register for single-writer wander/moveTo motion but without
 * physics. Because both the default pet and all agent pets register through
 * this function, the gravity toggle is uniformly applied to all of them.
 */
export function applyRoamingToPet(petId: string, accessor: WindowAccessor): void {
  motionSetPhysics(petId, accessor, getGravityEnabled() ? { gravity: true, bounce: getBounciness() } : { gravity: false });
}

/**
 * Stop all motion for a single pet (without unregistering it).
 */
export function stopRoamingForPet(petId: string): void {
  motionStop(petId);
}

/** ONLY call from unit tests. Clears the livePets registry (for test isolation). */
export function _resetLivePetsForTesting(): void {
  livePets.clear();
}

/**
 * ONLY call from unit tests. Overrides the gravity pref read so tests can
 * exercise gravity ON/OFF without importing app-state (which has an Electron dep).
 * Pass null to clear the override and fall back to the real getPetGravityEnabled().
 */
export function _setGravityEnabledForTesting(value: boolean | null): void {
  _gravityOverride = value;
}
