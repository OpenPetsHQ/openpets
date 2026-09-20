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
import { getManagerCheckInService, type ManagerCheckInPetSnapshot } from "./manager-check-in-service.js";

let defaultPetWindowRef: BrowserWindow | null = null;
const defaultPetPanelStates = ["collapsed", "compact-chat", "expanded-chat", "expanded-check-in"] as const;
export type DefaultPetPanelState = (typeof defaultPetPanelStates)[number];
let carrierState: DefaultPetPanelState = "collapsed";
let activeChatPanelHeight: number | undefined;
let handlersInstalled = false;
let conversationUnsubscribe: (() => void) | null = null;
let voiceUnsubscribe: (() => void) | null = null;
let petPanelEventSequence = 0;
let petCheckInSubmission: Promise<ManagerCheckInPetSnapshot> | null = null;

/** Returns true only when the assistant Chat history surface is expanded. */
export function isDefaultPetChatExpanded(): boolean {
  return carrierState === "expanded-chat";
}

/** Returns whether the shared pet window is carrying any expanded surface. */
export function isDefaultPetCarrierExpanded(): boolean {
  return isExpandedCarrierState(carrierState);
}

export function isDefaultPetChatCompactOpen(): boolean {
  return carrierState === "compact-chat";
}

export function isDefaultPetCheckInOpen(): boolean {
  return carrierState === "expanded-check-in";
}

export function getDefaultPetPanelState(): DefaultPetPanelState {
  return projectDefaultPetPanelState(carrierState);
}

export function isDefaultPetPanelState(value: unknown): value is DefaultPetPanelState {
  return typeof value === "string" && defaultPetPanelStates.includes(value as DefaultPetPanelState);
}

/** Projects unknown state at the preload boundary to one exact carrier state. */
export function projectDefaultPetPanelState(value: unknown): DefaultPetPanelState {
  return isDefaultPetPanelState(value) ? value : "collapsed";
}

export function getActiveChatPanelHeight(): number | undefined {
  return carrierState === "expanded-chat" ? activeChatPanelHeight : undefined;
}

export function bindDefaultPetChatWindow(window: BrowserWindow): void {
  if (defaultPetWindowRef === window) return;
  unbindDefaultPetChatWindow();
  defaultPetWindowRef = window;
  attachHostSubscriptions(window);
  sendInitialManagerCheckInState(window);
  sendPanelState(window);

  window.on("closed", () => {
    if (defaultPetWindowRef === window) {
      unbindDefaultPetChatWindow();
    }
  });
}

export function unbindDefaultPetChatWindow(): void {
  teardownHostSubscriptions();
  defaultPetWindowRef = null;
  carrierState = "collapsed";
  activeChatPanelHeight = undefined;
}

export function expandDefaultPetChat(): void {
  if (!defaultPetWindowRef || defaultPetWindowRef.isDestroyed()) return;
  setCarrierMode(defaultPetWindowRef, "expanded-chat");
}

export function collapseDefaultPetChat(): void {
  if (!defaultPetWindowRef || defaultPetWindowRef.isDestroyed()) return;
  setCarrierMode(defaultPetWindowRef, "collapsed");
}

export function toggleDefaultPetChat(): void {
  if (!defaultPetWindowRef || defaultPetWindowRef.isDestroyed()) return;
  setCarrierMode(
    defaultPetWindowRef,
    carrierState === "expanded-chat" ? "collapsed" : "expanded-chat",
  );
}

export function setDefaultPetChatCompactOpen(open: boolean): void {
  if (!defaultPetWindowRef || defaultPetWindowRef.isDestroyed()) return;
  if (carrierState === "expanded-chat" || carrierState === "expanded-check-in") return;
  setCarrierMode(defaultPetWindowRef, open ? "compact-chat" : "collapsed");
}

export function setCarrierExpansion(window: BrowserWindow, expanded: boolean): void {
  setCarrierMode(window, expanded ? "expanded-chat" : "collapsed");
}

export function openDefaultPetCheckIn(): void {
  if (!defaultPetWindowRef || defaultPetWindowRef.isDestroyed()) return;
  setCarrierMode(defaultPetWindowRef, "expanded-check-in");
}

export function closeDefaultPetCheckIn(): void {
  if (!defaultPetWindowRef || defaultPetWindowRef.isDestroyed()) return;
  if (carrierState === "expanded-check-in") setCarrierMode(defaultPetWindowRef, "collapsed");
}

function setCarrierMode(window: BrowserWindow, nextState: DefaultPetPanelState): void {
  if (window.isDestroyed()) return;
  if (carrierState === nextState) return;
  const previousState = carrierState;
  const wasExpanded = isExpandedCarrierState(previousState);
  const isExpanded = isExpandedCarrierState(nextState);
  const compactWasOpen = previousState === "compact-chat";
  const compactIsOpen = nextState === "compact-chat";
  carrierState = nextState;
  if (nextState !== "expanded-chat") activeChatPanelHeight = undefined;

  const currentBounds = window.getBounds();
  const currentPos: Point = { x: currentBounds.x, y: currentBounds.y };
  const currentDisplay = screen.getDisplayMatching(currentBounds);
  const workArea = currentDisplay?.workArea;

  if (isExpanded && !wasExpanded) {
    const nextBounds = calculateExpandedCarrierBounds(currentPos, defaultPetWindowSize, expandedPetWindowSize, workArea);
    debug("pet.chat", "expanding carrier window", { currentPos, nextBounds, windowId: window.id });
    window.setBounds(nextBounds, false);
    window.setFocusable(true);
    window.focus();
  } else if (!isExpanded && wasExpanded) {
    const nextBounds = calculateCollapsedCarrierBounds(currentPos, expandedPetWindowSize, defaultPetWindowSize, workArea);
    debug("pet.chat", "collapsing carrier window", { currentPos, nextBounds, windowId: window.id });
    window.setBounds(nextBounds, false);
  }

  // Refresh Linux shape and focus policy if needed
  if (isExpanded) {
    window.setFocusable(true);
    window.focus();
  }

  void import("./pet-window.js").then(({ applyLinuxPetWindowShapeWithExpansion, refreshDefaultPetFocusPolicy }) => {
    applyLinuxPetWindowShapeWithExpansion(window, isExpanded, compactIsOpen, activeChatPanelHeight);
    refreshDefaultPetFocusPolicy(window);
  }).catch(() => {});

  if (!window.webContents.isDestroyed()) {
    if (compactWasOpen !== compactIsOpen) {
      window.webContents.send("openpets:default-pet-chat-compact-changed", compactIsOpen);
    }
    if (wasExpanded !== isExpanded) {
      window.webContents.send("openpets:default-pet-chat-expansion-changed", isExpanded);
    }
    sendPanelState(window);
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
    if (carrierState === "expanded-chat" && defaultPetWindowRef && !defaultPetWindowRef.isDestroyed()) {
      const win = defaultPetWindowRef;
      void import("./pet-window.js").then(({ applyLinuxPetWindowShapeWithExpansion }) => {
        if (win.isDestroyed()) return;
        applyLinuxPetWindowShapeWithExpansion(win, true, false, activeChatPanelHeight);
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

  handleChat("openpets:default-pet-check-in-get-snapshot", () => {
    return getManagerCheckInService().getPetSnapshot();
  });

  handleChat("openpets:default-pet-check-in-open", () => {
    openDefaultPetCheckIn();
    return getManagerCheckInService().getPetSnapshot();
  });

  handleChat("openpets:default-pet-check-in-close", () => {
    closeDefaultPetCheckIn();
  });

  handleChat("openpets:default-pet-check-in-submit", async (_event, input: unknown) => {
    if (petCheckInSubmission) return petCheckInSubmission;
    const operation = getManagerCheckInService()
      .submit(input as {
        readonly scheduleId: unknown;
        readonly scheduleRevision: unknown;
        readonly cycleId: unknown;
      readonly feelingCode: unknown;
      readonly note?: unknown;
    })
      .then(() => getManagerCheckInService().getPetSnapshot());
    petCheckInSubmission = operation;
    try {
      return await operation;
    } finally {
      if (petCheckInSubmission === operation) petCheckInSubmission = null;
    }
  });

  handleChat("openpets:default-pet-panel-get-state", () => getDefaultPetPanelState());

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

/** Broadcast the pet-safe projection from the main-process service subscription. */
export function broadcastDefaultPetManagerCheckInSnapshot(snapshot: ManagerCheckInPetSnapshot): void {
  if (!defaultPetWindowRef || defaultPetWindowRef.isDestroyed()) return;
  sendManagerCheckInSnapshot(defaultPetWindowRef, snapshot);
}

function sendManagerCheckInSnapshot(window: BrowserWindow, snapshot: ManagerCheckInPetSnapshot): void {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send("openpets:default-pet-check-in-event", {
    type: "snapshot",
    sequence: ++petPanelEventSequence,
    snapshot,
  });
}

function sendInitialManagerCheckInState(window: BrowserWindow): void {
  try {
    sendManagerCheckInSnapshot(window, getManagerCheckInService().getPetSnapshot());
  } catch {
    // The manager service is initialized before normal pet creation. A
    // replacement window during early startup can still bind before it is
    // available; the renderer's initial invoke will retry in that case.
  }
}

function sendPanelState(window: BrowserWindow): void {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send("openpets:default-pet-panel-state", {
    type: "panel-state",
    sequence: ++petPanelEventSequence,
    state: getDefaultPetPanelState(),
  });
}

function isExpandedCarrierState(state: DefaultPetPanelState): boolean {
  return state === "expanded-chat" || state === "expanded-check-in";
}
