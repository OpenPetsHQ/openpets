// Global shortcut that toggles the compact pet chat composer. Reuses the
// voice-assistant shortcut manager (same canonical-accelerator rules and
// register/rollback semantics); unlike the Talk shortcut, this one can be
// cleared — an empty accelerator means "no chat shortcut".
import {
  VoiceAssistantShortcutManager,
  type GlobalShortcutRegistry,
  type VoiceAssistantShortcutSnapshot,
} from "./voice-assistant-shortcut.js";

export type ChatShortcutSnapshot = VoiceAssistantShortcutSnapshot;

const DISABLED_SNAPSHOT: ChatShortcutSnapshot = { accelerator: "", status: "unavailable", reason: "Chat shortcut is disabled." };

let registryRef: GlobalShortcutRegistry | null = null;
let onTriggeredRef: (() => void) | null = null;
let manager: VoiceAssistantShortcutManager | null = null;
let snapshot: ChatShortcutSnapshot = DISABLED_SNAPSHOT;

export function initializeChatShortcut(registry: GlobalShortcutRegistry, onTriggered: () => void, accelerator: string): ChatShortcutSnapshot {
  registryRef = registry;
  onTriggeredRef = onTriggered;
  return configureChatShortcut(accelerator);
}

export function configureChatShortcut(accelerator: string): ChatShortcutSnapshot {
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
export function resolveChatShortcutPreference(current: string, requested: string, result: ChatShortcutSnapshot): string {
  if (requested === "") return "";
  return result.status === "registered" && result.accelerator === requested ? requested : current;
}

export function getChatShortcutSnapshot(): ChatShortcutSnapshot {
  return snapshot;
}
