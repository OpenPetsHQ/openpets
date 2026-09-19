// Global shortcut that hides or shows the default pet. Reuses the
// voice-assistant shortcut manager (same canonical-accelerator rules and
// register/rollback semantics); like the chat shortcut it can be cleared —
// an empty accelerator means "no pet visibility shortcut".
import {
  VoiceAssistantShortcutManager,
  type GlobalShortcutRegistry,
  type VoiceAssistantShortcutSnapshot,
} from "./voice-assistant-shortcut.js";

export type PetToggleShortcutSnapshot = VoiceAssistantShortcutSnapshot;

const DISABLED_SNAPSHOT: PetToggleShortcutSnapshot = { accelerator: "", status: "unavailable", reason: "Pet visibility shortcut is disabled." };

let registryRef: GlobalShortcutRegistry | null = null;
let onTriggeredRef: (() => void) | null = null;
let manager: VoiceAssistantShortcutManager | null = null;
let snapshot: PetToggleShortcutSnapshot = DISABLED_SNAPSHOT;

export function initializePetToggleShortcut(registry: GlobalShortcutRegistry, onTriggered: () => void, accelerator: string): PetToggleShortcutSnapshot {
  registryRef = registry;
  onTriggeredRef = onTriggered;
  return configurePetToggleShortcut(accelerator);
}

export function configurePetToggleShortcut(accelerator: string): PetToggleShortcutSnapshot {
  if (!registryRef || !onTriggeredRef) {
    snapshot = { accelerator, status: "unavailable", reason: "Shortcut registration is not initialized." };
    return snapshot;
  }
  if (!accelerator) {
    if (manager) {
      manager.shutdown();
      manager = null;
    }
    snapshot = DISABLED_SNAPSHOT;
    return snapshot;
  }
  if (!manager) {
    manager = new VoiceAssistantShortcutManager(registryRef, onTriggeredRef);
  }
  snapshot = manager.configure(accelerator);
  return snapshot;
}

/** Keep the stored preference at its previous value when registration failed. */
export function resolvePetToggleShortcutPreference(current: string, requested: string, result: PetToggleShortcutSnapshot): string {
  if (requested === "") return "";
  return result.status === "registered" && result.accelerator === requested ? requested : current;
}

export function getPetToggleShortcutSnapshot(): PetToggleShortcutSnapshot {
  return snapshot;
}
