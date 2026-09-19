import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from "electron";

import { debug, error as logError, warn } from "./logger.js";
import { getPetAssistantConversationController, onPetAssistantConversationControllerReady } from "./pet-assistant-host.js";
import { createEmptyPetAssistantConversationSnapshot, validateConversationMessageInput } from "./pet-assistant-conversation.js";
import {
  endVoiceAssistant,
  getVoiceAssistantSnapshot,
  interruptVoiceAssistant,
  muteVoiceAssistant,
  onVoiceAssistantEvent,
  retryVoiceAssistant,
  startVoiceAssistant,
  toggleVoiceAssistant,
  unmuteVoiceAssistant,
} from "./voice-assistant-host.js";
import {
  calculateCollapsedCarrierBounds,
  calculateExpandedCarrierBounds,
  defaultPetChatPanelLayout,
  expandedPetWindowSize,
} from "./default-pet-chat-geometry.js";
import { defaultPetWindowSize, type Point } from "./display.js";

let defaultPetWindowRef: BrowserWindow | null = null;
let isChatExpanded = false;
let isChatCompactOpen = false;
let activeChatPanelHeight: number | undefined;
let handlersInstalled = false;
let conversationUnsubscribe: (() => void) | null = null;
let voiceUnsubscribe: (() => void) | null = null;

export function isDefaultPetChatExpanded(): boolean {
  return isChatExpanded;
}

export function isDefaultPetChatCompactOpen(): boolean {
  return isChatCompactOpen;
}

export function getActiveChatPanelHeight(): number | undefined {
  return isChatExpanded ? activeChatPanelHeight : undefined;
}

export function bindDefaultPetChatWindow(window: BrowserWindow): void {
  if (defaultPetWindowRef === window) return;
  unbindDefaultPetChatWindow();
  defaultPetWindowRef = window;
  attachHostSubscriptions(window);

  window.on("closed", () => {
    if (defaultPetWindowRef === window) {
      unbindDefaultPetChatWindow();
    }
  });
}

export function unbindDefaultPetChatWindow(): void {
  teardownHostSubscriptions();
  defaultPetWindowRef = null;
  isChatExpanded = false;
  isChatCompactOpen = false;
}

export function expandDefaultPetChat(): void {
  if (!defaultPetWindowRef || defaultPetWindowRef.isDestroyed()) return;
  if (isChatExpanded) return;
  setCarrierExpansion(defaultPetWindowRef, true);
}

export function collapseDefaultPetChat(): void {
  if (!defaultPetWindowRef || defaultPetWindowRef.isDestroyed()) return;
  if (!isChatExpanded) return;
  setCarrierExpansion(defaultPetWindowRef, false);
}

export function toggleDefaultPetChat(): void {
  if (!defaultPetWindowRef || defaultPetWindowRef.isDestroyed()) return;
  setCarrierExpansion(defaultPetWindowRef, !isChatExpanded);
}

export function setDefaultPetChatCompactOpen(open: boolean): void {
  if (!defaultPetWindowRef || defaultPetWindowRef.isDestroyed()) return;
  if (isChatExpanded) open = false;
  if (isChatCompactOpen === open) return;
  isChatCompactOpen = open;

  if (open) {
    defaultPetWindowRef.setFocusable(true);
    defaultPetWindowRef.focus();
  }

  const window = defaultPetWindowRef;
  void import("./pet-window.js").then(({ applyLinuxPetWindowShapeWithExpansion, refreshDefaultPetFocusPolicy }) => {
    if (window.isDestroyed()) return;
    applyLinuxPetWindowShapeWithExpansion(window, isChatExpanded, isChatCompactOpen);
    refreshDefaultPetFocusPolicy(window);
  }).catch(() => {});

  if (!defaultPetWindowRef.webContents.isDestroyed()) {
    defaultPetWindowRef.webContents.send("openpets:default-pet-chat-compact-changed", open);
  }
}

export function setCarrierExpansion(window: BrowserWindow, expanded: boolean): void {
  if (window.isDestroyed()) return;
  if (isChatExpanded === expanded) return;
  const compactWasOpen = isChatCompactOpen;
  isChatExpanded = expanded;
  if (expanded) isChatCompactOpen = false;

  const currentBounds = window.getBounds();
  const currentPos: Point = { x: currentBounds.x, y: currentBounds.y };
  const currentDisplay = screen.getDisplayMatching(currentBounds);
  const workArea = currentDisplay?.workArea;

  if (expanded) {
    const nextBounds = calculateExpandedCarrierBounds(currentPos, defaultPetWindowSize, expandedPetWindowSize, workArea);
    debug("pet.chat", "expanding carrier window", { currentPos, nextBounds, windowId: window.id });
    window.setBounds(nextBounds, false);
    window.setFocusable(true);
    window.focus();
  } else {
    activeChatPanelHeight = undefined;
    const nextBounds = calculateCollapsedCarrierBounds(currentPos, expandedPetWindowSize, defaultPetWindowSize, workArea);
    debug("pet.chat", "collapsing carrier window", { currentPos, nextBounds, windowId: window.id });
    window.setBounds(nextBounds, false);
  }

  // Refresh Linux shape and focus policy if needed
  void import("./pet-window.js").then(({ applyLinuxPetWindowShapeWithExpansion, refreshDefaultPetFocusPolicy }) => {
    applyLinuxPetWindowShapeWithExpansion(window, expanded, isChatCompactOpen, activeChatPanelHeight);
    refreshDefaultPetFocusPolicy(window);
  }).catch(() => {});

  if (!window.webContents.isDestroyed()) {
    if (compactWasOpen && expanded) {
      window.webContents.send("openpets:default-pet-chat-compact-changed", false);
    }
    window.webContents.send("openpets:default-pet-chat-expansion-changed", expanded);
  }
}

export function installDefaultPetChatIpcHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  ipcMain.on("openpets:default-pet-chat-toggle", (event) => {
    if (!isAuthorizedDefaultPetSender(event.sender.id)) {
      warn("pet.chat", "unauthorized toggle request", { senderId: event.sender.id });
      return;
    }
    toggleDefaultPetChat();
  });

  ipcMain.on("openpets:default-pet-chat-expand", (event) => {
    if (!isAuthorizedDefaultPetSender(event.sender.id)) return;
    expandDefaultPetChat();
  });

  ipcMain.on("openpets:default-pet-chat-collapse", (event) => {
    if (!isAuthorizedDefaultPetSender(event.sender.id)) return;
    collapseDefaultPetChat();
  });

  ipcMain.on("openpets:default-pet-chat-compact-open", (event) => {
    if (!isAuthorizedDefaultPetSender(event.sender.id)) return;
    setDefaultPetChatCompactOpen(true);
  });

  ipcMain.on("openpets:default-pet-chat-compact-close", (event) => {
    if (!isAuthorizedDefaultPetSender(event.sender.id)) return;
    setDefaultPetChatCompactOpen(false);
  });

  ipcMain.on("openpets:default-pet-chat-panel-resize", (event, rawHeight: unknown) => {
    if (!isAuthorizedDefaultPetSender(event.sender.id)) return;
    if (typeof rawHeight !== "number" || !Number.isFinite(rawHeight) || rawHeight <= 0) return;
    const height = Math.min(
      defaultPetChatPanelLayout.maxHeight,
      Math.max(defaultPetChatPanelLayout.minHeight, Math.round(rawHeight)),
    );
    if (activeChatPanelHeight === height) return;
    activeChatPanelHeight = height;
    if (isChatExpanded && defaultPetWindowRef && !defaultPetWindowRef.isDestroyed()) {
      const win = defaultPetWindowRef;
      void import("./pet-window.js").then(({ applyLinuxPetWindowShapeWithExpansion }) => {
        if (win.isDestroyed()) return;
        applyLinuxPetWindowShapeWithExpansion(win, isChatExpanded, isChatCompactOpen, activeChatPanelHeight);
      }).catch(() => {});
    }
  });

  handleChat("openpets:default-pet-chat-get-snapshot", () => {
    return getPetAssistantConversationController()?.getSnapshot() ?? createEmptyPetAssistantConversationSnapshot();
  });

  handleChat("openpets:default-pet-chat-is-expanded", () => {
    return isDefaultPetChatExpanded();
  });

  handleChat("openpets:default-pet-chat-is-compact-open", () => {
    return isDefaultPetChatCompactOpen();
  });

  handleChat("openpets:default-pet-chat-send-message", async (_event, text: unknown) => {
    const controller = getPetAssistantConversationController();
    if (!controller) {
      throw new Error("Pet Assistant is still starting.");
    }
    const validated = validateConversationMessageInput(text);
    return controller.sendTypedMessage(validated);
  });

  handleChat("openpets:default-pet-chat-cancel-turn", () => {
    return { cancelled: getPetAssistantConversationController()?.cancelTypedTurn() ?? false };
  });

  handleChat("openpets:default-pet-chat-get-voice-snapshot", () => {
    return getVoiceAssistantSnapshot();
  });

  handleChat("openpets:default-pet-chat-voice-start", () => {
    return startVoiceAssistant();
  });

  // Talk button on the pet: a second click submits an active generic recording
  // and otherwise ends the session.
  handleChat("openpets:default-pet-chat-voice-toggle", () => {
    return toggleVoiceAssistant();
  });

  handleChat("openpets:default-pet-chat-voice-retry", () => {
    return retryVoiceAssistant();
  });

  handleChat("openpets:default-pet-chat-voice-mute", () => {
    return muteVoiceAssistant();
  });

  handleChat("openpets:default-pet-chat-voice-unmute", () => {
    return unmuteVoiceAssistant();
  });

  handleChat("openpets:default-pet-chat-voice-interrupt", () => {
    return interruptVoiceAssistant();
  });

  handleChat("openpets:default-pet-chat-voice-end", () => {
    return endVoiceAssistant();
  });
}

function handleChat<T extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: T) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args: T) => {
    if (!isAuthorizedDefaultPetSender(event.sender.id)) {
      throw new Error("Chat request came from an unexpected window.");
    }
    return handler(event, ...args);
  });
}

function isAuthorizedDefaultPetSender(senderWebContentsId: number): boolean {
  return Boolean(
    defaultPetWindowRef
    && !defaultPetWindowRef.isDestroyed()
    && defaultPetWindowRef.webContents.id === senderWebContentsId,
  );
}

function attachHostSubscriptions(window: BrowserWindow): void {
  teardownHostSubscriptions();

  const webContents = window.webContents;
  if (webContents.isDestroyed()) return;

  // 1. Voice assistant events
  voiceUnsubscribe = onVoiceAssistantEvent((voiceEvent) => {
    if (webContents.isDestroyed()) {
      teardownHostSubscriptions();
      return;
    }
    try {
      webContents.send("openpets:default-pet-chat-voice-event", voiceEvent);
    } catch (error) {
      logError("pet.chat", "voice event send failed", error instanceof Error ? error : { error });
    }
  });

  // 2. Conversation events
  const attachConversation = (controller: NonNullable<ReturnType<typeof getPetAssistantConversationController>>): void => {
    if (webContents.isDestroyed()) return;
    const unsub = controller.subscribe((event) => {
      if (webContents.isDestroyed()) {
        teardownHostSubscriptions();
        return;
      }
      try {
        webContents.send("openpets:default-pet-chat-event", event);
      } catch (error) {
        logError("pet.chat", "conversation event send failed", error instanceof Error ? error : { error });
      }
    });
    conversationUnsubscribe = unsub;

    // Send initial snapshot on attach
    try {
      const snapshot = controller.getSnapshot();
      webContents.send("openpets:default-pet-chat-event", {
        type: "snapshot",
        sequence: snapshot.lastSequence,
        snapshot,
      });
    } catch {}
  };

  const controller = getPetAssistantConversationController();
  if (controller) {
    attachConversation(controller);
  } else {
    const readyDisposer = onPetAssistantConversationControllerReady((readyController) => {
      attachConversation(readyController);
    });
    conversationUnsubscribe = readyDisposer;
  }
}

function teardownHostSubscriptions(): void {
  if (conversationUnsubscribe) {
    try { conversationUnsubscribe(); } catch {}
    conversationUnsubscribe = null;
  }
  if (voiceUnsubscribe) {
    try { voiceUnsubscribe(); } catch {}
    voiceUnsubscribe = null;
  }
}
