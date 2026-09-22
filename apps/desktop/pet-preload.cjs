const { ipcRenderer } = require("electron");
const { escapeHtml, renderMarkdown } = require("./src/pet-chat-markdown.ts");
const {
  assistantDisplayName,
  deriveFullPanelVoiceAction,
  deriveTalkButtonPresentation,
  shouldAcceptConversationSnapshot,
  shouldAcceptTalkSnapshot,
  transitionChatDraft,
} = require("./src/pet-chat-view-state.ts");

// The pet window's preload runs sandboxed, where `require()` cannot load
// arbitrary local modules. `pet-tts-helper.cjs` is only loadable when the
// preload is bundled/unsandboxed; provide an inline fallback so the preload
// always loads — its mouse-interaction handlers are what make the pet
// clickable/draggable, and those must survive a missing TTS helper.
let splitSystemSpeech;
try {
  ({ splitSystemSpeech } = require("./pet-tts-helper.cjs"));
} catch {
  splitSystemSpeech = (text, maxChars = 500) => {
    if (typeof text !== "string" || text.length === 0) return [];
    if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error("Invalid system speech chunk limit.");
    const chunks = [];
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + maxChars);
      if (end < text.length) {
        let breakAt = -1;
        for (let i = end - 1; i > start; i -= 1) {
          if (/\s/.test(text[i])) { breakAt = i; break; }
        }
        if (breakAt > start) end = breakAt + 1;
      }
      chunks.push(text.slice(start, end));
      start = end;
    }
    return chunks;
  };
}

const allowedMotionStates = new Set(["idle", "run-left", "run-right"]);
const allowedReactionStates = new Set(["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"]);
const allowedCodexGazeIndices = new Set(Array.from({ length: 16 }, (_value, index) => index));
let lastInteractiveHit = null;
let dragging = false;
let updateDefaultPetCheckInButton = () => {};
let closeDefaultPetCheckInPanel = () => {};
let handleCheckInCarrierCollapsed = () => {};
let currentDefaultPetCarrierState = "collapsed";
let renderDefaultPetCheckIn = () => {};

let latestVoiceSnapshot = {
  sessionId: 0,
  status: "idle",
  activity: null,
  muted: false,
  conversationId: "pet-assistant",
  generation: 0,
  turnId: null,
  userTranscript: null,
  assistantTranscript: null,
  interruptionCount: 0,
  error: null,
  shortcut: null,
  shortcutStatus: "unregistered",
  shortcutReason: null,
};

const updateOnPetTalkButton = (snapshot) => {
  const talkBtn = document.querySelector("[data-openpets-talk-button]");
  if (!talkBtn) return;
  const presentation = deriveTalkButtonPresentation(snapshot);
  talkBtn.classList.toggle("is-active", presentation.active);
  talkBtn.classList.toggle("is-processing", presentation.processing);
  talkBtn.disabled = presentation.disabled;
  if (presentation.disabled) {
    talkBtn.setAttribute("disabled", "true");
    talkBtn.setAttribute("aria-disabled", "true");
  } else if (typeof talkBtn.removeAttribute === "function") {
    talkBtn.removeAttribute("disabled");
    talkBtn.removeAttribute("aria-disabled");
  }
  talkBtn.setAttribute("aria-label", presentation.ariaLabel);
  talkBtn.setAttribute("title", presentation.title);
};

const isInteractivePanelOrBubble = (target) => {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(".openpets-chat-panel, .openpets-compact-composer, .openpets-check-in-panel, .openpets-session-overlay, [data-openpets-companion-launcher], [data-openpets-check-in-button], .openpets-pet-buttons, .bubble, .openpets-context-menu"));
};

const dismissBubble = (event) => {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

  const target = event.target;
  if (!(target instanceof Element)) return;

  const bubble = target.closest(".bubble");
  if (!bubble) return;

  const dismissToken = bubble.dataset.dismissToken;
  if (!dismissToken) return;

  event.preventDefault();
  event.stopPropagation();

  bubble.remove();

  const newTarget = document.elementFromPoint(event.clientX, event.clientY);
  const stillInteractive = Boolean(newTarget && newTarget.closest(".pet-hitbox, .pet-shell, .bubble, .openpets-check-in-panel, [data-openpets-companion-launcher], [data-openpets-check-in-button], .openpets-pet-buttons")) || dragging;
  reportInteractiveHit(stillInteractive, "bubble-dismiss", true);

  ipcRenderer.send("openpets:bubble-dismissed", dismissToken);
};

ipcRenderer.on("openpets:pet-motion", (_event, state) => {
  if (!allowedMotionStates.has(state)) {
    return;
  }

  const apply = () => {
    document.documentElement.dataset.motionState = state;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  } else {
    apply();
  }
});

ipcRenderer.on("openpets:pet-reaction-state", (_event, state) => {
  if (!allowedReactionStates.has(state)) {
    return;
  }

  const apply = () => {
    document.documentElement.dataset.reactionState = state;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  } else {
    apply();
  }
});

ipcRenderer.on("openpets:pet-gaze", (_event, payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 1 || !Object.hasOwn(payload, "index")) return;
  const index = payload.index;
  if (index !== null && (!Number.isInteger(index) || !allowedCodexGazeIndices.has(index))) return;

  const apply = () => {
    document.documentElement.dataset.codexGazeIndex = index === null ? "neutral" : String(index);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  } else {
    apply();
  }
});

ipcRenderer.on("openpets:pet-content-state", (_event, state) => {
  if (!state || typeof state.bodyHtml !== "string" || state.bodyHtml.length > 64 * 1024 || !allowedReactionStates.has(state.reactionState)) {
    return;
  }

  const apply = () => {
    if (typeof state.assetName === "string") {
      document.documentElement.dataset.petAssetName = state.assetName;
    }
    if (typeof state.displayName === "string") {
      document.documentElement.dataset.petDisplayName = state.displayName;
      updateAssistantHeader(state.displayName, state.assetName);
    }
    document.documentElement.dataset.reactionState = state.reactionState;
    const currentStage = document.querySelector(".stage");
    if (currentStage) {
      try {
        const template = document.createElement("template");
        template.innerHTML = state.bodyHtml.trim();
        const newStage = template.content && template.content.firstElementChild;
        if (newStage && newStage.classList && newStage.classList.contains("stage")) {
          currentStage.replaceWith(newStage);
        } else {
          currentStage.outerHTML = state.bodyHtml;
        }
      } catch {
        currentStage.outerHTML = state.bodyHtml;
      }
    } else {
      document.body.insertAdjacentHTML("afterbegin", state.bodyHtml);
    }
    if (spriteOverrideElement) {
      const shell = document.querySelector(".pet-shell");
      if (shell && !shell.contains(spriteOverrideElement)) {
        const base = shell.querySelector(".sprite, .installed-card");
        if (base) base.style.visibility = "hidden";
        shell.appendChild(spriteOverrideElement);
      }
    }
    updateOnPetTalkButton(latestVoiceSnapshot);
    updateDefaultPetCheckInButton();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  } else {
    apply();
  }
});

function updateAssistantHeader(displayName, assetName) {
  const header = document.querySelector(".chat-title");
  if (!header) return;
  header.textContent = assistantDisplayName(
    displayName ?? document.documentElement.dataset.petDisplayName,
    assetName ?? document.documentElement.dataset.petAssetName,
  );
}

const getInteractiveTarget = (event) => {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  return target && target.closest(".pet-hitbox, .pet-shell, .bubble, .openpets-compact-composer, .openpets-chat-panel, .openpets-check-in-panel, .openpets-session-overlay, [data-openpets-companion-launcher], [data-openpets-check-in-button], .openpets-pet-buttons, .openpets-context-menu");
};

const reportInteractiveHit = (interactive, source, force = false) => {
  if (!force && lastInteractiveHit === interactive) return;
  lastInteractiveHit = interactive;
  ipcRenderer.send("openpets:pet-hit-test", interactive, source);
};

const setInteractiveHit = (interactive, source = "mouse") => {
  if (lastInteractiveHit === interactive) return;
  reportInteractiveHit(interactive, source);
};

const updateInteractiveHit = (event) => {
  setInteractiveHit(Boolean(getInteractiveTarget(event)) || dragging);
};

ipcRenderer.on("openpets:pet-probe-hit-test", (_event, point) => {
  if (!point || typeof point.clientX !== "number" || typeof point.clientY !== "number" || !Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return;
  const clientX = point.clientX;
  const clientY = point.clientY;
  const target = document.elementFromPoint(clientX, clientY);
  reportInteractiveHit(Boolean(target && target.closest(".pet-hitbox, .pet-shell, .bubble, .openpets-compact-composer, .openpets-chat-panel, .openpets-check-in-panel, .openpets-session-overlay, [data-openpets-companion-launcher], [data-openpets-check-in-button], .openpets-pet-buttons, .openpets-context-menu")) || dragging, typeof point.reason === "string" ? point.reason.slice(0, 80) : "probe", true);
});

// --- Plugin bubble interactions (actions, inline inputs) -------------------

const collectBubbleInputValues = (bubble) => {
  const values = {};
  for (const control of bubble.querySelectorAll(".bubble-input-control")) {
    const id = control.dataset.inputId;
    if (!id) continue;
    values[id] = control.type === "number" ? Number(control.value) : String(control.value);
  }
  return values;
};

const handleBubbleInteraction = (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const actionButton = target.closest("[data-bubble-action]");
  if (actionButton) {
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.send("openpets:bubble-action", actionButton.dataset.bubbleToken, actionButton.dataset.bubbleAction);
    return true;
  }
  const submitButton = target.closest("[data-bubble-submit]");
  if (submitButton) {
    event.preventDefault();
    event.stopPropagation();
    const bubble = submitButton.closest(".bubble");
    ipcRenderer.send("openpets:bubble-submit", submitButton.dataset.bubbleSubmit, bubble ? collectBubbleInputValues(bubble) : {});
    return true;
  }
  if (target.closest(".bubble-input-control")) return true;
  return false;
};

// --- Pet senses: clicks, hover, drops ---------------------------------------

let lastHoverSentAt = 0;
let suppressClickUntil = 0;

const sendPetEvent = (name, payload) => {
  ipcRenderer.send("openpets:pet-event", name, payload || {});
};

const installPetSenses = () => {
  document.addEventListener("click", (event) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (isInteractivePanelOrBubble(target)) return;
    if (!target.closest(".pet-hitbox, .pet-shell")) return;
    if (Date.now() < suppressClickUntil) return;
    sendPetEvent("pet:clicked", {});
  });
  document.addEventListener("dblclick", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (isInteractivePanelOrBubble(target)) return;
    if (!target.closest(".pet-hitbox, .pet-shell")) return;
    sendPetEvent("pet:doubleClicked", {});
  });
  document.addEventListener("mouseover", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (isInteractivePanelOrBubble(target)) return;
    if (!target.closest(".pet-hitbox, .pet-shell")) return;
    const now = Date.now();
    if (now - lastHoverSentAt < 2000) return;
    lastHoverSentAt = now;
    sendPetEvent("pet:hover", {});
  }, { passive: true });

  const maxDropTextBytes = 256 * 1024;
  const maxDropFileBytes = 5 * 1024 * 1024;
  document.addEventListener("dragover", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (isInteractivePanelOrBubble(target)) return;
    if (target.closest(".pet-hitbox, .pet-shell")) event.preventDefault();
  });
  document.addEventListener("drop", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (isInteractivePanelOrBubble(target)) return;
    if (!target.closest(".pet-hitbox, .pet-shell")) return;
    event.preventDefault();
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const files = [...(transfer.files || [])].slice(0, 4);
    if (files.length > 0) {
      Promise.all(files.map(async (file) => ({
        name: String(file.name).slice(0, 200),
        sizeBytes: file.size,
        text: file.size <= maxDropFileBytes ? await file.text().catch(() => "") : "",
        truncated: file.size > maxDropFileBytes,
      }))).then((read) => sendPetEvent("pet:drop", { kind: "files", droppedFiles: read })).catch(() => undefined);
      return;
    }
    const text = String(transfer.getData("text/plain") || "").slice(0, maxDropTextBytes);
    if (text) sendPetEvent("pet:drop", { kind: "text", text });
  });
};

// --- Default Pet In-Window Attached Chat Panel -------------------------------

const defaultPromptSuggestions = [
  "What can you do?",
  "Check system status",
  "Summarize activity",
];

const installDefaultPetChat = () => {
  if (document.documentElement?.dataset?.petRole !== "default") return;

  let conversationSnapshot = {
    conversationId: "pet-assistant",
    items: [],
    activity: "idle",
    lastSequence: 0,
    revision: 0,
  };
  let voiceSnapshot = {
    sessionId: 0,
    status: "idle",
    activity: null,
    muted: false,
    conversationId: "pet-assistant",
    generation: 0,
    turnId: null,
    userTranscript: null,
    assistantTranscript: null,
    interruptionCount: 0,
    error: null,
    shortcut: null,
    shortcutStatus: "unregistered",
    shortcutReason: null,
  };
  let conversationOrder = { sequence: -1, revision: -1 };
  let voiceOrder = { sessionId: -1, sequence: -1 };
  let draftState = { draft: "", expanded: false, compactOpen: false };
  let errorToastMessage = null;
  let errorToastTimer = null;
  let userScrolledUp = false;

  const updateDraftState = (transition) => {
    draftState = transitionChatDraft(draftState, transition);
  };

  // --- 1. Compact In-Place Composer Structure ---
  const compactEl = document.createElement("div");
  compactEl.className = "openpets-compact-composer";
  compactEl.setAttribute("role", "region");
  compactEl.setAttribute("aria-label", "Compact Pet Chat");

  const compactHeader = document.createElement("div");
  compactHeader.className = "compact-composer-header";

  const compactTitle = document.createElement("div");
  compactTitle.className = "compact-composer-title";
  const compactAvatar = document.createElement("span");
  compactAvatar.textContent = "✨";
  const compactLabel = document.createElement("span");
  compactLabel.textContent = "Chat";
  const compactStatusDot = document.createElement("span");
  compactStatusDot.className = "compact-composer-status-dot";
  compactStatusDot.style.display = "none";
  compactTitle.appendChild(compactAvatar);
  compactTitle.appendChild(compactLabel);
  compactTitle.appendChild(compactStatusDot);

  const compactActions = document.createElement("div");
  compactActions.className = "compact-composer-actions";

  const compactOpenChatBtn = document.createElement("button");
  compactOpenChatBtn.type = "button";
  compactOpenChatBtn.className = "compact-composer-btn is-open-chat";
  compactOpenChatBtn.dataset.chatOpenBtn = "true";
  compactOpenChatBtn.setAttribute("aria-label", "Open chat");
  compactOpenChatBtn.setAttribute("title", "Open chat");
  compactOpenChatBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  const compactCloseBtn = document.createElement("button");
  compactCloseBtn.type = "button";
  compactCloseBtn.className = "compact-composer-btn is-close";
  compactCloseBtn.dataset.chatComposerCloseBtn = "true";
  compactCloseBtn.setAttribute("aria-label", "Close composer");
  compactCloseBtn.setAttribute("title", "Close (Esc)");
  compactCloseBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  compactActions.appendChild(compactOpenChatBtn);
  compactActions.appendChild(compactCloseBtn);

  compactHeader.appendChild(compactTitle);
  compactHeader.appendChild(compactActions);
  compactEl.appendChild(compactHeader);

  const compactError = document.createElement("div");
  compactError.className = "compact-composer-error";
  compactError.dataset.compactChatError = "true";
  compactError.style.display = "none";
  compactEl.appendChild(compactError);

  const compactForm = document.createElement("form");
  compactForm.className = "compact-composer-form";
  compactForm.dataset.compactChatForm = "true";
  compactForm.style.display = "flex";
  compactForm.style.alignItems = "flex-end";

  const compactInput = document.createElement("textarea");
  compactInput.className = "compact-composer-textarea";
  compactInput.dataset.compactChatInput = "true";
  compactInput.placeholder = "Message your pet…";
  compactInput.rows = 1;
  compactInput.style.display = "block";
  compactInput.style.boxSizing = "border-box";
  compactInput.style.flex = "1 1 auto";
  compactInput.style.minWidth = "0";
  compactInput.style.minHeight = "28px";
  compactInput.style.height = "28px";
  compactInput.style.margin = "0";

  const compactSendBtn = document.createElement("button");
  compactSendBtn.type = "submit";
  compactSendBtn.className = "compact-composer-send-btn";
  compactSendBtn.dataset.compactChatSendBtn = "true";
  compactSendBtn.setAttribute("aria-label", "Send message");
  compactSendBtn.setAttribute("title", "Send (Enter)");
  compactSendBtn.disabled = true;
  compactSendBtn.style.display = "flex";
  compactSendBtn.style.alignItems = "center";
  compactSendBtn.style.justifyContent = "center";
  compactSendBtn.style.flexShrink = "0";
  compactSendBtn.style.width = "28px";
  compactSendBtn.style.height = "28px";
  compactSendBtn.style.padding = "0";
  compactSendBtn.style.margin = "0";
  compactSendBtn.style.boxSizing = "border-box";
  compactSendBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';

  const compactCancelBtn = document.createElement("button");
  compactCancelBtn.type = "button";
  compactCancelBtn.className = "compact-composer-cancel-btn";
  compactCancelBtn.dataset.compactChatCancelBtn = "true";
  compactCancelBtn.setAttribute("aria-label", "Cancel turn");
  compactCancelBtn.setAttribute("title", "Cancel turn");
  compactCancelBtn.style.display = "none";
  compactCancelBtn.style.alignItems = "center";
  compactCancelBtn.style.justifyContent = "center";
  compactCancelBtn.style.flexShrink = "0";
  compactCancelBtn.style.width = "28px";
  compactCancelBtn.style.height = "28px";
  compactCancelBtn.style.padding = "0";
  compactCancelBtn.style.margin = "0";
  compactCancelBtn.style.boxSizing = "border-box";
  compactCancelBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';

  compactForm.appendChild(compactInput);
  compactForm.appendChild(compactSendBtn);
  compactForm.appendChild(compactCancelBtn);
  compactEl.appendChild(compactForm);

  document.body.appendChild(compactEl);

  // --- 2. Full In-Pet Attached Chat Panel Structure ---
  const panelEl = document.createElement("div");
  panelEl.className = "openpets-chat-panel";
  panelEl.setAttribute("role", "region");
  panelEl.setAttribute("aria-label", "Pet Assistant Chat");

  // Panel Header
  const header = document.createElement("div");
  header.className = "chat-header";

  const headerLeft = document.createElement("div");
  headerLeft.className = "chat-header-left";
  const avatar = document.createElement("div");
  avatar.className = "chat-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "✨";
  const title = document.createElement("div");
  title.className = "chat-title";
  title.textContent = assistantDisplayName(
    document.documentElement.dataset.petDisplayName,
    document.documentElement.dataset.petAssetName,
  );
  const statusPill = document.createElement("div");
  statusPill.className = "chat-status-pill";
  statusPill.dataset.statusPill = "true";
  const statusDot = document.createElement("span");
  statusDot.className = "chat-status-dot";
  const statusText = document.createElement("span");
  statusText.dataset.statusText = "true";
  statusText.textContent = "Ready";
  statusPill.appendChild(statusDot);
  statusPill.appendChild(statusText);
  headerLeft.appendChild(avatar);
  headerLeft.appendChild(title);
  headerLeft.appendChild(statusPill);

  const headerRight = document.createElement("div");
  headerRight.className = "chat-header-right";
  const voiceBtn = document.createElement("button");
  voiceBtn.type = "button";
  voiceBtn.className = "chat-voice-btn";
  voiceBtn.dataset.chatVoiceBtn = "true";
  voiceBtn.setAttribute("aria-label", "Toggle voice assistant");
  voiceBtn.innerHTML = '<svg class="chat-mic-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>';
  const voiceBtnLabel = document.createElement("span");
  voiceBtnLabel.dataset.voiceBtnLabel = "true";
  voiceBtnLabel.textContent = "Talk";
  voiceBtn.appendChild(voiceBtnLabel);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "chat-close-btn";
  closeBtn.dataset.chatCloseBtn = "true";
  closeBtn.setAttribute("aria-label", "Collapse chat");
  closeBtn.setAttribute("title", "Collapse chat (Esc)");
  closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  headerRight.appendChild(voiceBtn);
  headerRight.appendChild(closeBtn);

  header.appendChild(headerLeft);
  header.appendChild(headerRight);
  panelEl.appendChild(header);

  // Panel Voice banner
  const voiceBanner = document.createElement("div");
  voiceBanner.className = "chat-voice-banner";
  voiceBanner.dataset.voiceBanner = "true";
  voiceBanner.style.display = "none";

  const voiceBannerInfo = document.createElement("div");
  voiceBannerInfo.className = "chat-voice-banner-info";
  const voiceWave = document.createElement("div");
  voiceWave.className = "chat-voice-wave";
  voiceWave.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 4; i += 1) {
    const bar = document.createElement("div");
    bar.className = "chat-voice-bar";
    voiceWave.appendChild(bar);
  }
  const voiceBannerText = document.createElement("span");
  voiceBannerText.dataset.voiceBannerText = "true";
  voiceBannerText.textContent = "Listening...";
  voiceBannerInfo.appendChild(voiceWave);
  voiceBannerInfo.appendChild(voiceBannerText);

  const voiceBannerActions = document.createElement("div");
  voiceBannerActions.className = "chat-voice-actions";
  voiceBannerActions.dataset.voiceBannerActions = "true";

  voiceBanner.appendChild(voiceBannerInfo);
  voiceBanner.appendChild(voiceBannerActions);
  panelEl.appendChild(voiceBanner);

  // Panel Error banner
  const errorBanner = document.createElement("div");
  errorBanner.className = "chat-error-banner";
  errorBanner.dataset.errorBanner = "true";
  errorBanner.style.display = "none";
  const errorText = document.createElement("span");
  errorText.dataset.errorText = "true";
  const errorDismiss = document.createElement("button");
  errorDismiss.type = "button";
  errorDismiss.className = "chat-close-btn";
  errorDismiss.dataset.errorDismiss = "true";
  errorDismiss.setAttribute("aria-label", "Dismiss error");
  errorDismiss.textContent = "✕";
  errorBanner.appendChild(errorText);
  errorBanner.appendChild(errorDismiss);
  panelEl.appendChild(errorBanner);

  // Panel Transcript
  const transcript = document.createElement("div");
  transcript.className = "chat-transcript";
  transcript.dataset.chatTranscript = "true";
  transcript.setAttribute("tabindex", "0");
  transcript.setAttribute("role", "log");
  transcript.setAttribute("aria-live", "polite");
  panelEl.appendChild(transcript);

  // Panel Suggestions
  const suggestions = document.createElement("div");
  suggestions.className = "chat-suggestions";
  suggestions.dataset.chatSuggestions = "true";
  suggestions.style.display = "none";
  panelEl.appendChild(suggestions);

  // Panel Composer
  const composer = document.createElement("form");
  composer.className = "chat-composer";
  composer.dataset.chatComposer = "true";
  composer.style.display = "flex";
  composer.style.alignItems = "flex-end";

  const inputWrapper = document.createElement("div");
  inputWrapper.className = "chat-input-wrapper";
  inputWrapper.style.display = "flex";
  inputWrapper.style.alignItems = "flex-end";
  inputWrapper.style.flex = "1 1 auto";
  inputWrapper.style.minWidth = "0";
  inputWrapper.style.margin = "0";
  inputWrapper.style.padding = "0";
  inputWrapper.style.lineHeight = "0";

  const input = document.createElement("textarea");
  input.className = "chat-textarea";
  input.dataset.chatInput = "true";
  input.placeholder = "Message your pet…";
  input.rows = 1;
  input.style.display = "block";
  input.style.boxSizing = "border-box";
  input.style.width = "100%";
  input.style.minHeight = "36px";
  input.style.height = "36px";
  input.style.margin = "0";
  input.style.lineHeight = "18px";
  inputWrapper.appendChild(input);

  const sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  sendBtn.className = "chat-send-btn";
  sendBtn.dataset.chatSendBtn = "true";
  sendBtn.setAttribute("aria-label", "Send message");
  sendBtn.setAttribute("title", "Send message (Enter)");
  sendBtn.disabled = true;
  sendBtn.style.display = "flex";
  sendBtn.style.alignItems = "center";
  sendBtn.style.justifyContent = "center";
  sendBtn.style.flexShrink = "0";
  sendBtn.style.width = "36px";
  sendBtn.style.height = "36px";
  sendBtn.style.padding = "0";
  sendBtn.style.margin = "0";
  sendBtn.style.boxSizing = "border-box";
  sendBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';

  const cancelTurnBtn = document.createElement("button");
  cancelTurnBtn.type = "button";
  cancelTurnBtn.className = "chat-cancel-turn-btn";
  cancelTurnBtn.dataset.chatCancelTurnBtn = "true";
  cancelTurnBtn.setAttribute("aria-label", "Cancel turn");
  cancelTurnBtn.setAttribute("title", "Cancel turn");
  cancelTurnBtn.style.display = "none";
  cancelTurnBtn.style.alignItems = "center";
  cancelTurnBtn.style.justifyContent = "center";
  cancelTurnBtn.style.flexShrink = "0";
  cancelTurnBtn.style.width = "36px";
  cancelTurnBtn.style.height = "36px";
  cancelTurnBtn.style.padding = "0";
  cancelTurnBtn.style.margin = "0";
  cancelTurnBtn.style.boxSizing = "border-box";
  cancelTurnBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';

  composer.appendChild(inputWrapper);
  composer.appendChild(sendBtn);
  composer.appendChild(cancelTurnBtn);
  panelEl.appendChild(composer);

  document.body.appendChild(panelEl);

  const composerStyle = document.createElement("style");
  composerStyle.setAttribute("data-openpets-composer-styles", "true");
  composerStyle.textContent = `
    .chat-composer,
    .compact-composer-form {
      display: flex;
      align-items: flex-end;
    }
    .chat-input-wrapper {
      display: flex;
      align-items: flex-end;
      flex: 1 1 auto;
      min-width: 0;
      margin: 0;
      padding: 0;
      line-height: 0;
    }
    .chat-textarea {
      display: block;
      box-sizing: border-box;
      width: 100%;
      min-height: 36px;
      max-height: 96px;
      margin: 0;
      line-height: 18px;
    }
    .compact-composer-textarea {
      display: block;
      box-sizing: border-box;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 28px;
      margin: 0;
      line-height: 16px;
    }
    .chat-send-btn,
    .chat-cancel-turn-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      padding: 0;
      margin: 0;
      border: none;
      box-sizing: border-box;
    }
    .compact-composer-send-btn,
    .compact-composer-cancel-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      padding: 0;
      margin: 0;
      border: none;
      box-sizing: border-box;
    }
    .chat-send-btn:disabled,
    .compact-composer-send-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      box-shadow: none;
      transform: none;
    }
  `;
  const styleTarget = document.head || document.documentElement || document.body;
  if (styleTarget && typeof styleTarget.appendChild === "function") {
    styleTarget.appendChild(composerStyle);
  }

  if (typeof ResizeObserver !== "undefined") {
    const panelResizeObserver = new ResizeObserver((entries) => {
      if (!draftState.expanded) return;
      for (const entry of entries) {
        if (entry.target === panelEl) {
          const height = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect?.height ?? panelEl.offsetHeight);
          if (height > 0) {
            ipcRenderer.send("openpets:default-pet-chat-panel-resize", height);
          }
        }
      }
    });
    panelResizeObserver.observe(panelEl);
  }

  // --- Helper & State Updaters ---
  const showErrorToast = (msg) => {
    errorToastMessage = msg;
    if (errorToastTimer) clearTimeout(errorToastTimer);
    if (msg) {
      errorText.textContent = msg;
      errorBanner.style.display = "flex";
      compactError.textContent = msg;
      compactError.style.display = "block";
      errorToastTimer = setTimeout(() => {
        errorToastMessage = null;
        errorBanner.style.display = "none";
        compactError.style.display = "none";
      }, 6000);
    } else {
      errorBanner.style.display = "none";
      compactError.style.display = "none";
    }
  };

  const autoResizeInput = () => {
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(96, Math.max(36, input.scrollHeight))}px`;
  };

  const autoResizeCompactInput = () => {
    if (!compactInput) return;
    compactInput.style.height = "auto";
    // The renderer stylesheet owns the compact geometry contract's max-height;
    // leave the inline height unconstrained so CSS and the Linux input shape
    // cannot drift apart when multiline content grows.
    compactInput.style.height = `${Math.max(28, compactInput.scrollHeight)}px`;
  };

  const updateSendButtonState = () => {
    const text = input ? input.value.trim() : "";
    const isBusy = conversationSnapshot.activity !== "idle";
    if (sendBtn) {
      sendBtn.disabled = text.length === 0 || isBusy;
      sendBtn.style.display = isBusy ? "none" : "flex";
    }
    if (cancelTurnBtn) {
      cancelTurnBtn.style.display = isBusy ? "flex" : "none";
    }
  };

  const updateCompactSendButtonState = () => {
    const text = compactInput ? compactInput.value.trim() : "";
    const isBusy = conversationSnapshot.activity !== "idle";
    if (compactSendBtn) {
      compactSendBtn.disabled = text.length === 0 || isBusy;
      compactSendBtn.style.display = isBusy ? "none" : "flex";
    }
    if (compactCancelBtn) {
      compactCancelBtn.style.display = isBusy ? "flex" : "none";
    }
  };

  const setCompactOpen = (open) => {
    const nextOpen = Boolean(open);
    if (draftState.compactOpen === nextOpen) return;
    updateDraftState({ type: "compact-changed", compactOpen: nextOpen });
    document.documentElement.dataset.compactComposerOpen = draftState.compactOpen ? "true" : "false";
    if (draftState.compactOpen) {
      compactInput.value = draftState.draft;
      autoResizeCompactInput();
      updateCompactSendButtonState();
      setTimeout(() => compactInput.focus(), 30);
    }
    ipcRenderer.send(draftState.compactOpen ? "openpets:default-pet-chat-compact-open" : "openpets:default-pet-chat-compact-close");
  };

  const applyConversationSnapshot = (snapshot) => {
    if (!snapshot || typeof snapshot.lastSequence !== "number" || typeof snapshot.revision !== "number") return false;
    const order = { sequence: snapshot.lastSequence, revision: snapshot.revision };
    if (!shouldAcceptConversationSnapshot(conversationOrder, snapshot)) return false;
    conversationOrder = order;
    conversationSnapshot = snapshot;
    renderAll();
    return true;
  };

  const applyVoiceSnapshot = (snapshot, sequence = 0) => {
    if (!snapshot || typeof snapshot.sessionId !== "number" || typeof snapshot.status !== "string" || typeof snapshot.muted !== "boolean") return false;
    const order = { sessionId: snapshot.sessionId, sequence };
    if (!shouldAcceptTalkSnapshot(voiceOrder, order.sessionId, order.sequence)) return false;
    voiceOrder = order;
    voiceSnapshot = snapshot;
    latestVoiceSnapshot = snapshot;
    renderAll();
    return true;
  };

  const renderStatus = () => {
    const act = conversationSnapshot.activity;
    const isBusy = act !== "idle";
    const activeAction = (conversationSnapshot.items || []).find((item) => item
      && item.kind === "action"
      && item.toolName === conversationSnapshot.activeToolName
      && (item.status === "pending" || item.status === "running"));
    const activeLabel = activeAction && typeof activeAction.label === "string" ? activeAction.label : undefined;

    // Compact header status
    if (isBusy) {
      compactStatusDot.style.display = "inline-block";
      compactLabel.textContent = act === "thinking" ? "Thinking..." : act === "acting" ? (activeLabel ? `Doing: ${activeLabel}` : "Acting...") : "Responding...";
    } else {
      compactStatusDot.style.display = "none";
      compactLabel.textContent = "Chat";
    }

    // Panel header status
    statusPill.className = "chat-status-pill";
    if (act === "thinking") {
      statusPill.classList.add("is-thinking");
      statusText.textContent = "Thinking...";
    } else if (act === "acting") {
      statusPill.classList.add("is-acting");
      statusText.textContent = activeLabel ? `Doing: ${activeLabel}` : "Acting...";
    } else if (act === "responding") {
      statusPill.classList.add("is-responding");
      statusText.textContent = "Responding...";
    } else if (voiceSnapshot.status !== "idle" && voiceSnapshot.status !== "ended") {
      statusPill.classList.add("is-voice");
      statusText.textContent = voiceSnapshot.muted ? "Muted" : voiceSnapshot.activity === "listening" ? "Listening..." : voiceSnapshot.activity === "thinking" ? "Thinking..." : voiceSnapshot.activity === "acting" ? "Acting..." : voiceSnapshot.activity === "speaking" ? "Speaking..." : "Voice active";
    } else {
      statusText.textContent = "Ready";
    }
  };

  const renderVoiceControls = () => {
    const status = voiceSnapshot.status;
    const activity = voiceSnapshot.activity;
    const isMuted = voiceSnapshot.muted;
    const isEnded = status === "idle" || status === "ended";

    voiceBtn.className = "chat-voice-btn";
    if (!isEnded) {
      voiceBtn.classList.add("is-active");
      if (isMuted) voiceBtn.classList.add("is-muted");
    }

    if (isEnded) {
      voiceBtnLabel.textContent = "Talk";
      voiceBanner.style.display = "none";
    } else {
      voiceBtnLabel.textContent = status === "paused" ? "Retry" : isMuted ? "Unmute" : activity === "listening" ? "Listening" : activity === "thinking" ? "Thinking" : activity === "acting" ? "Acting" : activity === "speaking" ? "Speaking" : "Active";
      voiceBanner.style.display = "flex";

      if (status === "paused") {
        voiceBannerText.textContent = voiceSnapshot.error?.message || "Voice paused";
      } else if (activity === "listening") {
        voiceBannerText.textContent = isMuted ? "Microphone is muted" : "Listening to you...";
      } else if (activity === "thinking" || activity === "acting") {
        voiceBannerText.textContent = "Thinking...";
      } else if (activity === "speaking") {
        voiceBannerText.textContent = "Speaking...";
      } else {
        voiceBannerText.textContent = "Voice connected";
      }

      voiceBannerActions.innerHTML = "";
      if (status === "paused") {
        const retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.className = "chat-voice-action-btn";
        retryBtn.textContent = "Retry";
        retryBtn.addEventListener("click", () => ipcRenderer.invoke("openpets:default-pet-chat-voice-retry"));
        voiceBannerActions.appendChild(retryBtn);
      } else if (status !== "ending") {
        const muteBtn = document.createElement("button");
        muteBtn.type = "button";
        muteBtn.className = "chat-voice-action-btn";
        muteBtn.textContent = isMuted ? "Unmute" : "Mute";
        muteBtn.addEventListener("click", () => {
          if (isMuted) ipcRenderer.invoke("openpets:default-pet-chat-voice-unmute");
          else ipcRenderer.invoke("openpets:default-pet-chat-voice-mute");
        });
        voiceBannerActions.appendChild(muteBtn);

        if (activity === "speaking") {
          const interruptBtn = document.createElement("button");
          interruptBtn.type = "button";
          interruptBtn.className = "chat-voice-action-btn";
          interruptBtn.textContent = "Interrupt";
          interruptBtn.addEventListener("click", () => ipcRenderer.invoke("openpets:default-pet-chat-voice-interrupt"));
          voiceBannerActions.appendChild(interruptBtn);
        }
      }

      if (status !== "ending") {
        const endBtn = document.createElement("button");
        endBtn.type = "button";
        endBtn.className = "chat-voice-action-btn is-end";
        endBtn.textContent = "End";
        endBtn.addEventListener("click", () => ipcRenderer.invoke("openpets:default-pet-chat-voice-end"));
        voiceBannerActions.appendChild(endBtn);
      }
    }
  };

  const renderTranscript = () => {
    const items = conversationSnapshot.items || [];
    if (items.length === 0) {
      transcript.innerHTML = `
        <div class="chat-empty">
          <div class="chat-empty-icon" aria-hidden="true">🐾</div>
          <div class="chat-empty-title">Hi, how can I help?</div>
          <div class="chat-empty-subtitle">Ask questions, generate actions, or start a voice conversation.</div>
        </div>
      `;
    } else {
      const parts = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.kind === "message") {
          const isUser = item.role === "user";
          const isLast = i === items.length - 1;
          const showCursor = !isUser && (item.partial || (isLast && conversationSnapshot.activity === "responding"));
          const bubbleContent = isUser ? escapeHtml(item.text) : renderMarkdown(item.text);
          const cursorHtml = showCursor ? '<span class="chat-typing-cursor" aria-hidden="true"></span>' : '';
          parts.push(`
            <div class="chat-msg ${isUser ? "is-user" : "is-assistant"}" data-msg-id="${escapeHtml(item.id)}">
              <div class="chat-msg-bubble">${bubbleContent}${cursorHtml}</div>
            </div>
          `);
        } else if (item.kind === "action") {
          const statusClass = `is-${item.status}`;
          parts.push(`
            <div class="chat-action-card" data-action-id="${escapeHtml(item.id)}">
              <div class="chat-action-left">
                <svg class="chat-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                <span class="chat-action-name">${escapeHtml(item.label || "Capability action")}</span>
              </div>
              <span class="chat-action-badge ${statusClass}">${escapeHtml(item.status)}</span>
            </div>
          `);
        }
      }
      transcript.innerHTML = parts.join("");
    }

    if (!userScrolledUp) {
      transcript.scrollTop = transcript.scrollHeight;
    }
  };

  const renderSuggestions = () => {
    const isIdle = conversationSnapshot.activity === "idle";
    if (isIdle && defaultPromptSuggestions.length > 0) {
      suggestions.style.display = "flex";
      suggestions.innerHTML = defaultPromptSuggestions.slice(0, 3).map((suggestion) => `
        <button type="button" class="chat-chip" data-suggestion="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>
      `).join("");
    } else {
      suggestions.style.display = "none";
      suggestions.innerHTML = "";
    }
  };

  const renderAll = () => {
    renderStatus();
    renderVoiceControls();
    renderTranscript();
    renderSuggestions();
    updateSendButtonState();
    updateCompactSendButtonState();
    updateOnPetTalkButton(voiceSnapshot);
  };

  // --- Transcript scroll detection ---
  transcript.addEventListener("scroll", () => {
    userScrolledUp = transcript.scrollTop + transcript.clientHeight < transcript.scrollHeight - 35;
  }, { passive: true });

  // --- Suggestions click ---
  suggestions.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-suggestion]");
    if (!chip) return;
    const text = chip.dataset.suggestion;
    if (!text) return;
    input.value = text;
    compactInput.value = text;
    updateDraftState({ type: "draft-changed", draft: text });
    autoResizeInput();
    autoResizeCompactInput();
    updateSendButtonState();
    updateCompactSendButtonState();
    sendMessage(text);
  });

  // --- Message Sending Handlers ---
  const sendMessage = (textToSend) => {
    const text = (textToSend ?? input.value).trim();
    if (!text) return;
    input.value = "";
    compactInput.value = "";
    updateDraftState({ type: "draft-changed", draft: "" });
    autoResizeInput();
    autoResizeCompactInput();
    updateSendButtonState();
    updateCompactSendButtonState();
    userScrolledUp = false;

    ipcRenderer.invoke("openpets:default-pet-chat-send-message", text).catch((err) => {
      showErrorToast(err && err.message ? err.message : "Failed to send message");
    });
  };

  const sendCompactMessage = (textToSend) => {
    const text = (textToSend ?? compactInput.value).trim();
    if (!text) return;
    compactInput.value = "";
    input.value = "";
    updateDraftState({ type: "draft-changed", draft: "" });
    autoResizeCompactInput();
    autoResizeInput();
    updateCompactSendButtonState();
    updateSendButtonState();
    setCompactOpen(false);
    userScrolledUp = false;

    ipcRenderer.invoke("openpets:default-pet-chat-send-message", text).catch((err) => {
      showErrorToast(err && err.message ? err.message : "Failed to send message");
    });
  };

  // --- Compact Form Listeners ---
  compactInput.addEventListener("input", () => {
    updateDraftState({ type: "draft-changed", draft: compactInput.value });
    input.value = draftState.draft;
    autoResizeCompactInput();
    autoResizeInput();
    updateCompactSendButtonState();
    updateSendButtonState();
  });

  compactInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendCompactMessage();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setCompactOpen(false);
    }
  });

  compactForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendCompactMessage();
  });

  compactCancelBtn.addEventListener("click", () => {
    ipcRenderer.invoke("openpets:default-pet-chat-cancel-turn").catch(() => {});
  });

  compactOpenChatBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    updateDraftState({ type: "draft-changed", draft: compactInput.value });
    setCompactOpen(false);
    ipcRenderer.send("openpets:default-pet-chat-expand");
  });

  compactCloseBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    updateDraftState({ type: "draft-changed", draft: compactInput.value });
    setCompactOpen(false);
  });

  // --- Panel Form Listeners ---
  input.addEventListener("input", () => {
    updateDraftState({ type: "draft-changed", draft: input.value });
    compactInput.value = draftState.draft;
    autoResizeInput();
    autoResizeCompactInput();
    updateSendButtonState();
    updateCompactSendButtonState();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    } else if (event.key === "Escape") {
      event.preventDefault();
      updateDraftState({ type: "draft-changed", draft: input.value });
      ipcRenderer.send("openpets:default-pet-chat-collapse");
    }
  });

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
  });

  cancelTurnBtn.addEventListener("click", () => {
    ipcRenderer.invoke("openpets:default-pet-chat-cancel-turn").catch(() => {});
  });

  voiceBtn.addEventListener("click", () => {
    const action = deriveFullPanelVoiceAction(voiceSnapshot);
    if (action === "start") {
      ipcRenderer.invoke("openpets:default-pet-chat-voice-start").catch((err) => {
        showErrorToast(err && err.message ? err.message : "Failed to start voice");
      });
    } else if (action === "retry") {
      ipcRenderer.invoke("openpets:default-pet-chat-voice-retry").catch(() => {});
    } else if (action === "unmute") {
      ipcRenderer.invoke("openpets:default-pet-chat-voice-unmute").catch(() => {});
    } else {
      ipcRenderer.invoke("openpets:default-pet-chat-voice-mute").catch(() => {});
    }
  });

  closeBtn.addEventListener("click", () => {
    updateDraftState({ type: "draft-changed", draft: input.value });
    ipcRenderer.send("openpets:default-pet-chat-collapse");
  });

  errorDismiss.addEventListener("click", () => {
    showErrorToast(null);
  });

  // --- Talk Button Click (toggles a voice session) ---
  document.addEventListener("click", (event) => {
    const talkButton = event.target?.closest?.("[data-openpets-talk-button]");
    if (!talkButton) return;
    event.preventDefault();
    event.stopPropagation();
    const presentation = deriveTalkButtonPresentation(latestVoiceSnapshot);
    if (!presentation.disabled) {
      ipcRenderer.invoke("openpets:default-pet-chat-voice-toggle").catch(() => {});
    }
  }, true);

  // --- Launcher Button Click ---
  document.addEventListener("click", (event) => {
    const launcher = event.target?.closest?.("[data-openpets-companion-launcher]");
    if (!launcher || launcher.closest("[data-openpets-check-in-button]")) return;
    event.preventDefault();
    event.stopPropagation();
    if (draftState.expanded) {
      updateDraftState({ type: "draft-changed", draft: input.value });
      ipcRenderer.send("openpets:default-pet-chat-collapse");
    } else {
      setCompactOpen(!draftState.compactOpen);
    }
  });

  // --- Global Escape Key ---
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (document.documentElement.dataset.checkInExpanded === "true") {
        closeDefaultPetCheckInPanel();
        return;
      }
      if (draftState.expanded) {
        updateDraftState({ type: "draft-changed", draft: input.value });
        ipcRenderer.send("openpets:default-pet-chat-collapse");
      } else if (draftState.compactOpen) {
        setCompactOpen(false);
      }
    }
  });

  // --- Carrier Panel State Listener ---
  const validCarrierStates = new Set(["collapsed", "compact-chat", "expanded-chat", "expanded-check-in", "expanded-session"]);
  let latestPanelStateSequence = -1;
  const handleCarrierPanelState = (payload) => {
    const rawState = payload && typeof payload.state === "string" ? payload.state : (typeof payload === "string" ? payload : null);
    if (!rawState || !validCarrierStates.has(rawState)) return;
    if (payload && typeof payload === "object" && typeof payload.sequence === "number" && Number.isFinite(payload.sequence)) {
      if (payload.sequence < latestPanelStateSequence) return;
      latestPanelStateSequence = payload.sequence;
    } else if (latestPanelStateSequence >= 0) {
      return;
    } else {
      latestPanelStateSequence = 0;
    }
    currentDefaultPetCarrierState = rawState;
    if (rawState === "expanded-check-in") {
      document.documentElement.dataset.chatExpanded = "false";
      document.documentElement.dataset.checkInExpanded = "true";
      document.documentElement.dataset.compactComposerOpen = "false";
      updateDraftState({ type: "expanded-changed", expanded: false });
      updateDraftState({ type: "compact-changed", compactOpen: false });
      renderDefaultPetCheckIn();
    } else if (rawState === "expanded-chat") {
      document.documentElement.dataset.checkInExpanded = "false";
      document.documentElement.dataset.chatExpanded = "true";
      document.documentElement.dataset.compactComposerOpen = "false";
      updateDraftState({ type: "expanded-changed", expanded: true });
      updateDraftState({ type: "compact-changed", compactOpen: false });
      input.value = draftState.draft;
      compactInput.value = draftState.draft;
      autoResizeInput();
      autoResizeCompactInput();
      renderAll();
      if (panelEl && typeof panelEl.offsetHeight === "number" && panelEl.offsetHeight > 0) {
        ipcRenderer.send("openpets:default-pet-chat-panel-resize", Math.round(panelEl.offsetHeight));
      }
    } else if (rawState === "expanded-session") {
      // The practice session overlay owns the carrier; every chat surface closes.
      document.documentElement.dataset.checkInExpanded = "false";
      document.documentElement.dataset.chatExpanded = "false";
      document.documentElement.dataset.compactComposerOpen = "false";
      updateDraftState({ type: "expanded-changed", expanded: false });
      updateDraftState({ type: "compact-changed", compactOpen: false });
      handleCheckInCarrierCollapsed();
    } else if (rawState === "compact-chat") {
      document.documentElement.dataset.checkInExpanded = "false";
      document.documentElement.dataset.chatExpanded = "false";
      document.documentElement.dataset.compactComposerOpen = "true";
      updateDraftState({ type: "compact-changed", compactOpen: true });
      updateDraftState({ type: "expanded-changed", expanded: false });
      compactInput.value = draftState.draft;
      autoResizeCompactInput();
      updateCompactSendButtonState();
      handleCheckInCarrierCollapsed();
    } else if (rawState === "collapsed") {
      document.documentElement.dataset.checkInExpanded = "false";
      document.documentElement.dataset.chatExpanded = "false";
      document.documentElement.dataset.compactComposerOpen = "false";
      updateDraftState({ type: "compact-changed", compactOpen: false });
      updateDraftState({ type: "expanded-changed", expanded: false });
      handleCheckInCarrierCollapsed();
    }
  };

  ipcRenderer.on("openpets:default-pet-panel-state", (_event, payload) => handleCarrierPanelState(payload));

  // --- Expansion Changed Listener ---
  ipcRenderer.on("openpets:default-pet-chat-expansion-changed", (_event, expanded) => {
    if (!expanded) {
      currentDefaultPetCarrierState = "collapsed";
      document.documentElement.dataset.chatExpanded = "false";
      document.documentElement.dataset.checkInExpanded = "false";
      handleCheckInCarrierCollapsed();
      updateDraftState({ type: "expanded-changed", expanded: false });
      if (input) {
        updateDraftState({ type: "draft-changed", draft: input.value });
      }
      renderAll();
      return;
    }
    if (currentDefaultPetCarrierState === "expanded-check-in" || document.documentElement.dataset.checkInExpanded === "true") {
      document.documentElement.dataset.chatExpanded = "false";
      return;
    }
    const wasExpanded = draftState.expanded;
    updateDraftState({ type: "expanded-changed", expanded: Boolean(expanded) });
    document.documentElement.dataset.chatExpanded = draftState.expanded ? "true" : "false";
    if (draftState.expanded) {
      setCompactOpen(false);
      input.value = draftState.draft;
      compactInput.value = draftState.draft;
      autoResizeInput();
      autoResizeCompactInput();
      renderAll();
      setTimeout(() => input.focus(), 60);
      if (panelEl && typeof panelEl.offsetHeight === "number" && panelEl.offsetHeight > 0) {
        ipcRenderer.send("openpets:default-pet-chat-panel-resize", Math.round(panelEl.offsetHeight));
      }
    } else {
      if (wasExpanded && input) {
        updateDraftState({ type: "draft-changed", draft: input.value });
      }
      renderAll();
    }
  });

  ipcRenderer.on("openpets:default-pet-chat-compact-changed", (_event, open) => {
    const nextOpen = Boolean(open);
    if (draftState.compactOpen === nextOpen) return;
    updateDraftState({ type: "compact-changed", compactOpen: nextOpen });
    document.documentElement.dataset.compactComposerOpen = nextOpen ? "true" : "false";
    if (nextOpen) {
      compactInput.value = draftState.draft;
      autoResizeCompactInput();
      updateCompactSendButtonState();
      setTimeout(() => compactInput.focus(), 30);
    }
  });

  // --- Conversation Event Listener ---
  ipcRenderer.on("openpets:default-pet-chat-event", (_event, payload) => {
    if (!payload) return;
    if (payload.type === "snapshot" && payload.snapshot) {
      applyConversationSnapshot(payload.snapshot);
    }
  });

  // --- Voice Event Listener ---
  ipcRenderer.on("openpets:default-pet-chat-voice-event", (_event, payload) => {
    if (!payload) return;
    if (payload.type === "snapshot" && payload.snapshot) {
      applyVoiceSnapshot(payload.snapshot, typeof payload.sequence === "number" ? payload.sequence : 0);
    }
  });

  // --- Initial Snapshots Fetch ---
  ipcRenderer.invoke("openpets:default-pet-chat-get-snapshot").then((snap) => {
    if (snap) {
      applyConversationSnapshot(snap);
    }
  }).catch(() => {});

  ipcRenderer.invoke("openpets:default-pet-chat-get-voice-snapshot").then((snap) => {
    if (snap) {
      applyVoiceSnapshot(snap, 0);
    }
  }).catch(() => {});

  ipcRenderer
    .invoke("openpets:default-pet-panel-get-state")
    .then((state) => {
      handleCarrierPanelState(state);
    })
    .catch(() => {});

  renderAll();
};

const readPetCheckInPendingCount = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return 0;
  const count = snapshot.pendingCount;
  if (!Number.isSafeInteger(count) || count < 0) return 0;
  return count;
};

const readPetCheckInActiveItem = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.activeItem || typeof snapshot.activeItem !== "object") {
    return null;
  }
  return snapshot.activeItem;
};

const readPetCheckInCycleId = (item) => {
  return item && typeof item.cycleId === "string" && item.cycleId.trim() ? item.cycleId : null;
};

const readPetCheckInSubmitBinding = (item) => {
  if (!item || typeof item !== "object") return null;
  if (typeof item.scheduleId !== "string" || !item.scheduleId.trim()) return null;
  if (!Number.isSafeInteger(item.scheduleRevision) || item.scheduleRevision < 0) return null;
  const cycleId = readPetCheckInCycleId(item);
  if (!cycleId) return null;
  return {
    scheduleId: item.scheduleId,
    scheduleRevision: item.scheduleRevision,
    cycleId,
  };
};

const readPetCheckInVisibilityText = (item) => {
  const notice = item && item.visibilityNotice;
  if (!notice || typeof notice !== "object") return null;
  if (typeof notice.text !== "string" || !notice.text.trim()) return null;
  return notice.text;
};

const readPetCheckInInvokeError = (err) => {
  if (!err || typeof err !== "object" || typeof err.message !== "string" || !err.message.trim()) {
    return "Couldn't share this check-in.";
  }
  const parts = err.message.split(": ");
  const last = parts[parts.length - 1].trim();
  return last || "Couldn't share this check-in.";
};

const installDefaultPetManagerCheckIn = () => {
  if (document.documentElement?.dataset?.petRole !== "default") return;

  let currentSnapshot = null;
  let selectedFeeling = null;
  let noteText = "";
  let isBusy = false;
  let formErrorMessage = null;
  let latestSnapshotSequence = -1;
  let queueTotal = 0;
  let queueCompleted = 0;
  let viewedCycleId = null;
  let sessionOpen = false;

  const syncCheckInButtonPresentation = (btn, count) => {
    const label = count > 1 ? `Check-in, ${count} due` : "Check-in";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    const badge = btn.querySelector(".openpets-check-in-badge");
    if (!badge) return;
    if (count > 1) {
      badge.textContent = String(count);
      badge.classList.add("is-visible");
      badge.setAttribute("aria-hidden", "false");
    } else {
      badge.textContent = "";
      badge.classList.remove("is-visible");
      badge.setAttribute("aria-hidden", "true");
    }
  };

  updateDefaultPetCheckInButton = () => {
    const pendingCount = readPetCheckInPendingCount(currentSnapshot);
    const shouldShow = pendingCount > 0;
    let petButtons = document.querySelector(".openpets-pet-buttons");
    const existingButtons = document.querySelectorAll("[data-openpets-check-in-button]");
    for (let index = 1; index < existingButtons.length; index += 1) {
      existingButtons[index].remove();
    }
    const existingBtn = document.querySelector("[data-openpets-check-in-button]");

    if (!shouldShow) {
      if (existingBtn) existingBtn.remove();
      petButtons = document.querySelector(".openpets-pet-buttons");
      if (petButtons && petButtons.children.length === 0) {
        petButtons.remove();
      }
      return;
    }

    if (!petButtons) {
      const hitbox = document.querySelector(".pet-hitbox");
      if (!hitbox) return;
      petButtons = document.createElement("div");
      petButtons.className = "openpets-pet-buttons";
      const shell = hitbox.querySelector(".pet-shell");
      if (shell) {
        hitbox.insertBefore(petButtons, shell);
      } else {
        hitbox.appendChild(petButtons);
      }
    }

    if (!existingBtn) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "openpets-companion-launcher openpets-check-in-button";
      btn.dataset.openpetsCheckInButton = "true";
      btn.setAttribute("aria-label", "Check-in");
      btn.setAttribute("title", "Check-in");
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M8 12.5l2.5 2.5 5.5-5.5"></path>
        </svg>
        <span class="openpets-check-in-badge" aria-hidden="true"></span>
      `;
      petButtons.appendChild(btn);
      syncCheckInButtonPresentation(btn, pendingCount);
    } else {
      if (existingBtn.parentElement !== petButtons) {
        petButtons.appendChild(existingBtn);
      }
      syncCheckInButtonPresentation(existingBtn, pendingCount);
    }
  };

  // --- Panel DOM Structure ---
  const panelEl = document.createElement("div");
  panelEl.className = "openpets-check-in-panel";
  panelEl.setAttribute("role", "dialog");
  panelEl.setAttribute("aria-label", "Check-in");

  const headerEl = document.createElement("div");
  headerEl.className = "check-in-header";

  const headerLeftEl = document.createElement("div");
  headerLeftEl.className = "check-in-header-left";

  const titleRowEl = document.createElement("div");
  titleRowEl.className = "check-in-title-row";

  const titleEl = document.createElement("h3");
  titleEl.className = "check-in-title";
  titleEl.textContent = "Check-in";

  const progressEl = document.createElement("p");
  progressEl.className = "check-in-progress";
  progressEl.hidden = true;

  titleRowEl.appendChild(titleEl);
  titleRowEl.appendChild(progressEl);

  const introEl = document.createElement("p");
  introEl.className = "check-in-intro";
  introEl.hidden = true;

  headerLeftEl.appendChild(titleRowEl);
  headerLeftEl.appendChild(introEl);

  const closeBtnEl = document.createElement("button");
  closeBtnEl.type = "button";
  closeBtnEl.className = "check-in-close-btn";
  closeBtnEl.setAttribute("aria-label", "Close check-in");
  closeBtnEl.innerHTML = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  `;
  closeBtnEl.addEventListener("click", (e) => {
    e.stopPropagation();
    closeCheckIn();
  });

  headerEl.appendChild(headerLeftEl);
  headerEl.appendChild(closeBtnEl);
  panelEl.appendChild(headerEl);

  // Body
  const bodyEl = document.createElement("div");
  bodyEl.className = "check-in-body";

  const errorBannerEl = document.createElement("div");
  errorBannerEl.className = "check-in-error-banner";
  errorBannerEl.style.display = "none";
  bodyEl.appendChild(errorBannerEl);

  // Feelings Section
  const feelingsLabelEl = document.createElement("div");
  feelingsLabelEl.className = "check-in-label";
  feelingsLabelEl.textContent = "How are you feeling?";
  bodyEl.appendChild(feelingsLabelEl);

  const feelingsGridEl = document.createElement("div");
  feelingsGridEl.className = "check-in-feelings-grid";
  feelingsGridEl.setAttribute("role", "radiogroup");
  feelingsGridEl.setAttribute("aria-label", "How are you feeling?");

  const feelingConfigs = [
    {
      code: "good",
      defaultLabel: "Good",
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
    },
    {
      code: "steady",
      defaultLabel: "Steady",
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="8" y1="15" x2="16" y2="15"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
    },
    {
      code: "stretched",
      defaultLabel: "Stretched",
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 15c1-1 2-1.5 4-1.5s3 .5 4 1.5"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
    },
    {
      code: "struggling",
      defaultLabel: "Struggling",
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
    },
    {
      code: "need_support",
      defaultLabel: "Need support",
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    },
  ];

  const feelingButtonEls = new Map();

  for (const config of feelingConfigs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "check-in-feeling-btn";
    btn.dataset.code = config.code;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", "false");
    btn.innerHTML = `
      <div class="check-in-feeling-icon">${config.svg}</div>
      <span class="check-in-feeling-name">${config.defaultLabel}</span>
    `;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isBusy) return;
      selectedFeeling = config.code;
      formErrorMessage = null;
      renderCheckIn();
    });
    feelingsGridEl.appendChild(btn);
    feelingButtonEls.set(config.code, btn);
  }
  bodyEl.appendChild(feelingsGridEl);

  // Note Section
  const noteFieldEl = document.createElement("div");
  noteFieldEl.className = "check-in-note-field";

  const noteLabelRowEl = document.createElement("div");
  noteLabelRowEl.className = "check-in-label";
  noteLabelRowEl.innerHTML = `
    <span>Note</span>
    <span class="check-in-char-counter">0 / 500</span>
  `;
  const charCounterEl = noteLabelRowEl.querySelector(".check-in-char-counter");

  const textareaEl = document.createElement("textarea");
  textareaEl.className = "check-in-textarea";
  textareaEl.maxLength = 500;
  textareaEl.rows = 3;
  textareaEl.placeholder = "";
  textareaEl.addEventListener("input", () => {
    noteText = textareaEl.value;
    if (charCounterEl) {
      charCounterEl.textContent = `${textareaEl.value.length} / 500`;
    }
  });

  noteFieldEl.appendChild(noteLabelRowEl);
  noteFieldEl.appendChild(textareaEl);
  bodyEl.appendChild(noteFieldEl);

  // Visibility Notice
  const visibilityNoticeEl = document.createElement("div");
  visibilityNoticeEl.className = "check-in-visibility-notice";
  visibilityNoticeEl.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
    <span class="check-in-visibility-text"></span>
  `;
  const visibilityTextEl = visibilityNoticeEl.querySelector(".check-in-visibility-text");
  bodyEl.appendChild(visibilityNoticeEl);

  panelEl.appendChild(bodyEl);

  // Footer
  const footerEl = document.createElement("div");
  footerEl.className = "check-in-footer";

  const submitBtnEl = document.createElement("button");
  submitBtnEl.type = "button";
  submitBtnEl.className = "check-in-submit-btn";
  submitBtnEl.disabled = true;
  submitBtnEl.innerHTML = `<span>Share</span>`;
  submitBtnEl.addEventListener("click", (e) => {
    e.stopPropagation();
    handleSubmit();
  });

  footerEl.appendChild(submitBtnEl);
  panelEl.appendChild(footerEl);

  document.body.appendChild(panelEl);

  const resetFormFields = () => {
    selectedFeeling = null;
    noteText = "";
    textareaEl.value = "";
    if (charCounterEl) charCounterEl.textContent = "0 / 500";
  };

  const beginCheckInSession = () => {
    if (sessionOpen) return;
    const item = readPetCheckInActiveItem(currentSnapshot);
    const cycleId = readPetCheckInCycleId(item);
    if (cycleId !== viewedCycleId) {
      resetFormFields();
      viewedCycleId = cycleId;
    }
    queueTotal = readPetCheckInPendingCount(currentSnapshot);
    queueCompleted = 0;
    formErrorMessage = null;
    sessionOpen = true;
  };

  const renderCheckIn = () => {
    const item = readPetCheckInActiveItem(currentSnapshot);
    const pendingCount = readPetCheckInPendingCount(currentSnapshot);
    if (sessionOpen && pendingCount <= 0 && !isBusy) {
      closeCheckIn();
      return;
    }
    const binding = readPetCheckInSubmitBinding(item);
    const visibilityText = readPetCheckInVisibilityText(item);
    const missingMessages = [];

    if (pendingCount > 0 && !item) {
      missingMessages.push("This check-in is missing its details.");
    }

    const title = item && typeof item.title === "string" ? item.title.trim() : "";
    if (title) {
      titleEl.textContent = title;
      panelEl.setAttribute("aria-label", title);
    } else {
      titleEl.textContent = "Check-in";
      panelEl.setAttribute("aria-label", "Check-in");
      if (item) missingMessages.push("This check-in is missing its schedule name.");
    }

    const introduction = item && typeof item.introduction === "string" ? item.introduction.trim() : "";
    if (introduction) {
      introEl.textContent = introduction;
      introEl.hidden = false;
    } else {
      introEl.textContent = "";
      introEl.hidden = true;
    }

    const showProgress = queueTotal > 1 && pendingCount > 0;
    if (showProgress) {
      progressEl.textContent = `${queueCompleted + 1} of ${queueTotal}`;
      progressEl.hidden = false;
    } else {
      progressEl.textContent = "";
      progressEl.hidden = true;
    }

    const notePlaceholder = item && typeof item.notePlaceholder === "string" ? item.notePlaceholder.trim() : "";
    textareaEl.placeholder = notePlaceholder;

    if (visibilityTextEl) {
      visibilityTextEl.textContent = visibilityText ?? "";
    }
    visibilityNoticeEl.hidden = !visibilityText;
    if (item && !visibilityText) {
      missingMessages.push("Check-in visibility details are unavailable.");
    }

    for (const [code, btn] of feelingButtonEls.entries()) {
      const labelSpan = btn.querySelector(".check-in-feeling-name");
      const labels = item && item.labels && typeof item.labels === "object" ? item.labels : null;
      const label = labels && typeof labels[code] === "string" ? labels[code].trim() : "";
      if (labelSpan && label) {
        labelSpan.textContent = label;
      }
    }

    if (item && !binding) {
      missingMessages.push("This check-in is missing its schedule details.");
    }

    const displayedError = formErrorMessage || missingMessages[0] || null;
    if (displayedError) {
      errorBannerEl.textContent = displayedError;
      errorBannerEl.style.display = "flex";
    } else {
      errorBannerEl.style.display = "none";
    }

    for (const [code, btn] of feelingButtonEls.entries()) {
      const isSelected = selectedFeeling === code;
      btn.classList.toggle("is-selected", isSelected);
      btn.setAttribute("aria-checked", isSelected ? "true" : "false");
      btn.disabled = isBusy;
    }

    textareaEl.disabled = isBusy;
    const canShare = Boolean(!isBusy && selectedFeeling && binding && visibilityText);
    submitBtnEl.disabled = !canShare;
    panelEl.setAttribute("aria-busy", isBusy ? "true" : "false");
    if (isBusy) {
      submitBtnEl.innerHTML = `
        <svg class="check-in-submit-spinner" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/>
        </svg>
        <span>Sharing...</span>
      `;
    } else {
      submitBtnEl.innerHTML = `<span>Share</span>`;
    }
  };

  const openCheckIn = () => {
    beginCheckInSession();
    currentDefaultPetCarrierState = "expanded-check-in";
    document.documentElement.dataset.checkInExpanded = "true";
    document.documentElement.dataset.chatExpanded = "false";
    document.documentElement.dataset.compactComposerOpen = "false";
    renderCheckIn();
    ipcRenderer
      .invoke("openpets:default-pet-check-in-open")
      .then((snapshot) => {
        if (snapshot) applySnapshot(snapshot);
      })
      .catch((err) => {
        formErrorMessage = readPetCheckInInvokeError(err);
        renderCheckIn();
      });
  };

  const closeCheckIn = () => {
    ipcRenderer.invoke("openpets:default-pet-check-in-close").catch(() => {});
    currentDefaultPetCarrierState = "collapsed";
    document.documentElement.dataset.checkInExpanded = "false";
    sessionOpen = false;
  };

  const handleSubmit = async () => {
    if (isBusy || !selectedFeeling) return;

    const validFeelings = ["good", "steady", "stretched", "struggling", "need_support"];
    if (!validFeelings.includes(selectedFeeling)) {
      formErrorMessage = "Please select a valid feeling.";
      renderCheckIn();
      return;
    }

    const trimmedNote = noteText.trim();
    if (trimmedNote.length > 500) {
      formErrorMessage = "Note must not exceed 500 characters.";
      renderCheckIn();
      return;
    }

    const item = readPetCheckInActiveItem(currentSnapshot);
    const binding = readPetCheckInSubmitBinding(item);
    const visibilityText = readPetCheckInVisibilityText(item);
    if (!binding || !visibilityText) {
      formErrorMessage = !binding
        ? "This check-in is missing its schedule details."
        : "Check-in visibility details are unavailable.";
      renderCheckIn();
      return;
    }

    const previousCycleId = binding.cycleId;
    isBusy = true;
    formErrorMessage = null;
    renderCheckIn();

    try {
      const payload = {
        scheduleId: binding.scheduleId,
        scheduleRevision: binding.scheduleRevision,
        cycleId: binding.cycleId,
        feelingCode: selectedFeeling,
        note: trimmedNote.length > 0 ? trimmedNote : null,
      };
      const result = await ipcRenderer.invoke("openpets:default-pet-check-in-submit", payload);
      isBusy = false;
      if (result) applySnapshot(result, undefined, { skipRender: true });
      const nextItem = readPetCheckInActiveItem(currentSnapshot);
      const nextCount = readPetCheckInPendingCount(currentSnapshot);
      const nextCycleId = readPetCheckInCycleId(nextItem);
      if (nextCount <= 0) {
        resetFormFields();
        formErrorMessage = null;
        viewedCycleId = null;
        queueTotal = 0;
        queueCompleted = 0;
        sessionOpen = false;
        closeCheckIn();
        return;
      }
      if (!nextItem || !nextCycleId) {
        resetFormFields();
        formErrorMessage = "The next check-in is missing its details.";
        renderCheckIn();
        return;
      }
      if (nextCycleId === previousCycleId) {
        formErrorMessage = "This check-in is still due.";
        renderCheckIn();
        return;
      }
      resetFormFields();
      formErrorMessage = null;
      queueCompleted += 1;
      queueTotal = Math.max(queueTotal, queueCompleted + nextCount);
      viewedCycleId = nextCycleId;
      renderCheckIn();
    } catch (err) {
      isBusy = false;
      formErrorMessage = readPetCheckInInvokeError(err);
      renderCheckIn();
    }
  };

  const applySnapshot = (snapshot, sequence, options) => {
    if (!snapshot || typeof snapshot !== "object") return;
    if (typeof sequence === "number") {
      if (sequence < latestSnapshotSequence) return;
      latestSnapshotSequence = sequence;
    }
    currentSnapshot = snapshot;
    updateDefaultPetCheckInButton();
    if (options && options.skipRender) return;
    if (isBusy) return;
    if (document.documentElement.dataset.checkInExpanded === "true") {
      renderCheckIn();
    }
  };

  closeDefaultPetCheckInPanel = closeCheckIn;
  renderDefaultPetCheckIn = () => {
    beginCheckInSession();
    renderCheckIn();
  };
  handleCheckInCarrierCollapsed = () => {
    sessionOpen = false;
  };

  document.addEventListener("click", (event) => {
    const checkInButton = event.target?.closest?.("[data-openpets-check-in-button]");
    if (!checkInButton) return;
    event.preventDefault();
    event.stopPropagation();
    openCheckIn();
  }, true);

  // IPC Event Listeners
  ipcRenderer.on("openpets:default-pet-check-in-event", (_event, payload) => {
    if (!payload || typeof payload !== "object") return;
    const snapshot = payload.type === "snapshot" ? payload.snapshot : payload;
    const sequence = typeof payload.sequence === "number" ? payload.sequence : undefined;
    if (snapshot) applySnapshot(snapshot, sequence);
  });

  // Initial Snapshot Fetch
  ipcRenderer
    .invoke("openpets:default-pet-check-in-get-snapshot")
    .then((snapshot) => {
      if (snapshot) applySnapshot(snapshot);
    })
    .catch(() => {});

  renderCheckIn();
};

// --- Plugin sprite/scale overrides ------------------------------------------

let spriteOverrideElement = null;
ipcRenderer.on("openpets:pet-sprite-override", (_event, override) => {
  const shell = document.querySelector(".pet-shell");
  if (!shell) return;
  const base = shell.querySelector(".sprite, .installed-card");
  if (spriteOverrideElement) { spriteOverrideElement.remove(); spriteOverrideElement = null; }
  if (!override || typeof override.fileUrl !== "string" || !override.fileUrl.startsWith("file://")) {
    if (base) base.style.visibility = "";
    return;
  }
  const probe = new Image();
  probe.onload = () => {
    const frame = probe.naturalHeight;
    const frames = Math.max(1, Math.floor(probe.naturalWidth / Math.max(1, frame)));
    const fps = Math.min(30, Math.max(1, Number(override.fps) || 8));
    const el = document.createElement("div");
    el.className = "plugin-sprite-override";
    el.style.cssText = `position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:${frame}px;height:${frame}px;background-image:url("${override.fileUrl.replace(/"/g, "%22")}");background-repeat:no-repeat;background-size:${probe.naturalWidth}px ${frame}px;animation:plugin-sprite-frames ${(frames / fps).toFixed(3)}s steps(${frames}) ${override.loop === false ? "1" : "infinite"};pointer-events:none;`;
    let style = document.getElementById("plugin-sprite-override-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "plugin-sprite-override-style";
      document.head.appendChild(style);
    }
    style.textContent = `@keyframes plugin-sprite-frames { from { background-position: 0 0; } to { background-position: -${frames * frame}px 0; } }`;
    if (base) base.style.visibility = "hidden";
    shell.appendChild(el);
    spriteOverrideElement = el;
  };
  probe.src = override.fileUrl;
});

ipcRenderer.on("openpets:pet-scale-override", (_event, scale) => {
  const value = Number(scale);
  if (!Number.isFinite(value) || value < 0.25 || value > 3) return;
  const sprite = document.querySelector(".sprite, .installed-sprite");
  if (sprite) sprite.style.transform = `scale(${value})`;
});

// --- Plugin audio (named WebAudio recipes + bundled data URLs) ---------------

let audioContext = null;
let activeAudioNodes = [];
let activeAudioElements = [];

const audioLog = (level, message, fields) => {
  try {
    const safeFields = fields && Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
    const line = `[openpets:pet-audio] ${message}`;
    if (level === "warn") console.warn(line, safeFields || {});
    else console.debug(line, safeFields || {});
  } catch { /* diagnostics must never affect playback */ }
};

const getAudioContext = () => {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  return audioContext;
};

const namedSoundRecipes = {
  chime: [{ freq: 880, type: "sine", start: 0, duration: 0.35 }, { freq: 1318.5, type: "sine", start: 0.12, duration: 0.4 }],
  pop: [{ freq: 420, type: "square", start: 0, duration: 0.08 }],
  nom: [{ freq: 220, type: "triangle", start: 0, duration: 0.1 }, { freq: 180, type: "triangle", start: 0.12, duration: 0.1 }],
  alert: [{ freq: 660, type: "sawtooth", start: 0, duration: 0.18 }, { freq: 660, type: "sawtooth", start: 0.26, duration: 0.18 }],
  "level-up": [{ freq: 523.25, type: "sine", start: 0, duration: 0.12 }, { freq: 659.25, type: "sine", start: 0.12, duration: 0.12 }, { freq: 783.99, type: "sine", start: 0.24, duration: 0.22 }],
  tick: [{ freq: 1000, type: "square", start: 0, duration: 0.03 }],
  success: [{ freq: 587.33, type: "sine", start: 0, duration: 0.14 }, { freq: 880, type: "sine", start: 0.14, duration: 0.24 }],
  error: [{ freq: 311.13, type: "sine", start: 0, duration: 0.18 }, { freq: 233.08, type: "sine", start: 0.2, duration: 0.28 }],
};

ipcRenderer.on("openpets:play-audio", (_event, payload) => {
  try {
    if (!payload) return;
    const volume = Math.min(1, Math.max(0, Number(payload.volume) || 0.6));
    audioLog("debug", "play requested", { kind: payload.kind, volume });
    if (payload.kind === "named") {
      const recipe = namedSoundRecipes[payload.name];
      if (!recipe) { audioLog("warn", "named sound skipped", { name: payload.name, reason: "unknown-sound" }); return; }
      const ctxAudio = getAudioContext();
      if (ctxAudio.state === "suspended") void ctxAudio.resume().catch((error) => audioLog("warn", "audio context resume failed", { reason: error && error.message ? error.message : String(error) }));
      const now = ctxAudio.currentTime;
      for (const note of recipe) {
        const osc = ctxAudio.createOscillator();
        const gain = ctxAudio.createGain();
        osc.type = note.type;
        osc.frequency.value = note.freq;
        gain.gain.setValueAtTime(0, now + note.start);
        gain.gain.linearRampToValueAtTime(volume * 0.35, now + note.start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + note.start + note.duration);
        osc.connect(gain).connect(ctxAudio.destination);
        osc.start(now + note.start);
        osc.stop(now + note.start + note.duration + 0.05);
        activeAudioNodes.push(osc);
      }
      audioLog("debug", "named sound scheduled", { name: payload.name, notes: recipe.length, contextState: ctxAudio.state });
      return;
    }
    if (payload.kind === "data" && typeof payload.dataUrl === "string" && payload.dataUrl.startsWith("data:audio/")) {
      const element = new Audio(payload.dataUrl);
      element.volume = volume;
      activeAudioElements.push(element);
      element.addEventListener("ended", () => { activeAudioElements = activeAudioElements.filter((entry) => entry !== element); audioLog("debug", "data sound ended", { remaining: activeAudioElements.length }); });
      element.addEventListener("error", () => audioLog("warn", "data sound element error", { code: element.error ? element.error.code : undefined, message: element.error ? element.error.message : undefined }));
      void element.play().then(() => audioLog("debug", "data sound playback started", { volume })).catch((error) => {
        activeAudioElements = activeAudioElements.filter((entry) => entry !== element);
        audioLog("warn", "data sound playback failed", { reason: error && error.message ? error.message : String(error), name: error && error.name ? error.name : undefined });
      });
    } else {
      audioLog("warn", "play request ignored", { kind: payload.kind, reason: "invalid-payload" });
    }
  } catch (error) { audioLog("warn", "play request threw", { reason: error && error.message ? error.message : String(error) }); }
});

ipcRenderer.on("openpets:stop-audio", () => {
  audioLog("debug", "stop requested", { nodes: activeAudioNodes.length, elements: activeAudioElements.length });
  for (const node of activeAudioNodes) { try { node.stop(); } catch { /* already stopped */ } }
  activeAudioNodes = [];
  for (const element of activeAudioElements) { try { element.pause(); } catch { /* noop */ } }
  activeAudioElements = [];
});

// --- Plugin TTS ---------------------------------------------------------------

let generatedTtsRequest = 0;
let activeTts = null;

const sendTtsCompletion = (request, outcome) => {
  try { ipcRenderer.send("openpets:tts-speech-finished", { requestId: request.requestId, kind: "system", outcome }); } catch { /* main process observes renderer loss separately */ }
};

const stopTtsMedia = (request) => {
  if (!request) return;
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* noop */ }
};

const settleTts = (request, outcome) => {
  if (!request || activeTts !== request) return false;
  activeTts = null;
  stopTtsMedia(request);
  sendTtsCompletion(request, outcome);
  return true;
};

const stopMatchingTts = (requestId, kind) => {
  const request = activeTts;
  if (!request) return false;
  if (requestId !== undefined && requestId !== request.requestId) return false;
  if (kind !== undefined && request.kind !== kind) return false;
  return settleTts(request, "stopped");
};

ipcRenderer.on("openpets:tts-speak", (_event, payload) => {
  try {
    if (!payload || typeof payload.text !== "string" || !window.speechSynthesis) return;
    settleTts(activeTts, "stopped");
    const request = { requestId: typeof payload.requestId === "string" ? payload.requestId : `renderer-tts-${++generatedTtsRequest}`, kind: "system", media: { chunks: splitSystemSpeech(payload.text), index: 0 } };
    activeTts = request;
    const speakNext = () => {
      if (activeTts !== request) return;
      const text = request.media.chunks[request.media.index];
      if (typeof text !== "string") { settleTts(request, "ended"); return; }
      const utterance = new SpeechSynthesisUtterance(text);
      if (typeof payload.rate === "number" && payload.rate >= 0.5 && payload.rate <= 2) utterance.rate = payload.rate;
      if (typeof payload.voice === "string" && payload.voice) {
        const match = window.speechSynthesis.getVoices().find((voice) => voice.name === payload.voice || voice.lang === payload.voice);
        if (match) utterance.voice = match;
      }
      utterance.addEventListener("end", () => {
        if (activeTts !== request) return;
        request.media.index += 1;
        if (request.media.index >= request.media.chunks.length) settleTts(request, "ended");
        else speakNext();
      });
      utterance.addEventListener("error", () => { settleTts(request, "error"); });
      try { window.speechSynthesis.speak(utterance); } catch { settleTts(request, "error"); }
    };
    speakNext();
  } catch { settleTts(activeTts, "error"); }
});

ipcRenderer.on("openpets:tts-stop", (_event, payload) => {
  stopMatchingTts(typeof payload?.requestId === "string" ? payload.requestId : undefined, "system");
});

const installLayerShellContextMenu = () => {
  let overlay = null;
  const style = document.createElement("style");
  style.textContent = `
    .openpets-context-menu { position: fixed; z-index: 1000; box-sizing: border-box; overflow: auto; padding: 4px; border: 1px solid rgba(30,41,59,.16); border-radius: 8px; background: rgba(255,255,255,.98); box-shadow: 0 10px 30px rgba(15,23,42,.2), 0 2px 6px rgba(15,23,42,.1); color: #1e293b; font: 13px/1.35 system-ui,sans-serif; pointer-events: auto; -webkit-app-region: no-drag; }
    .openpets-context-item { display: block; box-sizing: border-box; width: 100%; min-height: 30px; margin: 0; border: 0; border-radius: 5px; padding: 6px 12px; background: transparent; color: inherit; font: inherit; text-align: left; white-space: nowrap; cursor: pointer; }
    .openpets-context-item:hover { background: rgba(37,99,235,.12); }
    button.openpets-context-item:disabled { color: #94a3b8; cursor: default; }
    .openpets-context-separator { height: 1px; margin: 4px 7px; background: rgba(30,41,59,.11); }
    .openpets-context-group { margin: 0; }
    .openpets-context-group > summary { list-style: none; padding-right: 24px; position: relative; }
    .openpets-context-group > summary::-webkit-details-marker { display: none; }
    .openpets-context-group > summary::after { content: "›"; position: absolute; right: 10px; }
    .openpets-context-group[open] > summary::after { transform: rotate(90deg); }
    .openpets-context-children { padding-left: 8px; }
  `;
  document.head.appendChild(style);

  const close = () => {
    overlay?.remove();
    overlay = null;
  };

  const appendItems = (items, container, depth = 0) => {
    for (const item of items || []) {
      if (item.type === "separator") {
        const separator = document.createElement("div");
        separator.className = "openpets-context-separator";
        container.appendChild(separator);
        continue;
      }
      if (item.submenu?.length) {
        const group = document.createElement("details");
        group.className = "openpets-context-group";
        const summary = document.createElement("summary");
        summary.className = "openpets-context-item";
        summary.textContent = item.label || "";
        group.appendChild(summary);
        const children = document.createElement("div");
        children.className = "openpets-context-children";
        appendItems(item.submenu, children, depth + 1);
        group.appendChild(children);
        container.appendChild(group);
        continue;
      }
      const row = document.createElement("button");
      row.type = "button";
      row.className = "openpets-context-item";
      row.textContent = item.label || "";
      row.style.paddingLeft = `${12 + depth * 12}px`;
      row.disabled = typeof item.clickIndex !== "number";
      if (!row.disabled) row.addEventListener("click", (event) => {
        event.stopPropagation();
        const index = item.clickIndex;
        close();
        ipcRenderer.send("openpets:pet-menu-select", index);
      });
      container.appendChild(row);
    }
  };

  ipcRenderer.on("openpets:pet-menu-data", (_event, menu) => {
    close();
    const root = document.createElement("div");
    root.className = "openpets-context-menu";
    root.addEventListener("mousedown", (event) => event.stopPropagation());
    root.addEventListener("contextmenu", (event) => event.preventDefault());
    appendItems(menu?.items, root);
    document.body.appendChild(root);

    const width = 232;
    const maxHeight = Math.min(360, Math.max(120, window.innerHeight - 12));
    const requestedX = Number.isFinite(menu?.x) ? menu.x : window.innerWidth / 2;
    const requestedY = Number.isFinite(menu?.y) ? menu.y : window.innerHeight / 2;
    root.style.width = `${width}px`;
    root.style.maxHeight = `${maxHeight}px`;
    root.style.left = `${Math.max(6, Math.min(requestedX, window.innerWidth - width - 6))}px`;
    root.style.top = `${Math.max(6, Math.min(requestedY, window.innerHeight - Math.min(root.scrollHeight, maxHeight) - 6))}px`;
    overlay = root;
    setInteractiveHit(true, "context-menu");
  });

  ipcRenderer.on("openpets:pet-menu-close", close);

  document.addEventListener("mousedown", (event) => {
    if (overlay && !overlay.contains(event.target)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
};

// ---------------------------------------------------------------------------
// Practice session overlay (ui:session) — breathing orb around the pet.
// The host coordinator sends a validated descriptor over
// "openpets:session-overlay"; this module owns the 60fps orb shader, the
// phase clock, the session card, and reports control events back.
// ---------------------------------------------------------------------------

const installDefaultPetSession = () => {
  if (document.documentElement?.dataset?.petRole !== "default") return;

  // The stylesheet ships static fallback geometry; the source of truth is a
  // runtime measurement of the real rendered sprite and session card, applied
  // as :root CSS variable overrides so the orb hugs the pet, the pet sits at
  // the orb centre, and the orb rests on the card for any pet asset or scale.
  const readGeometryVar = (name, fallback) => {
    const raw = Number(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  };
  let ORB_RADIUS = readGeometryVar("--session-orb-radius", 140);
  const ORB_CARD_GAP = 10;
  const CARD_BOTTOM_INSET = 14;

  const PHASE_STYLE = {
    in: { nameKey: "inhale", guidanceKey: "inhaleGuidance", color: [0.42, 0.68, 1.0], css: "#7ab3ff" },
    hold: { nameKey: "hold", guidanceKey: "holdGuidance", color: [0.72, 0.62, 1.0], css: "#b7a4ff" },
    out: { nameKey: "exhale", guidanceKey: "exhaleGuidance", color: [0.30, 0.86, 0.78], css: "#4fdcc5" },
  };
  const IDLE_COLOR = [0.45, 0.62, 0.98];

  // Host-localized chrome strings arrive with the descriptor; English is the
  // in-place fallback so a missing key never renders blank.
  const chromeFallback = {
    inhale: "Inhale", hold: "Hold", exhale: "Exhale",
    inhaleGuidance: "Breathe in slowly", holdGuidance: "Hold gently", exhaleGuidance: "Breathe out slowly",
    paused: "Paused", pausedGuidance: "Resume when you're ready",
    complete: "Complete", completeGuidance: "Nice work. Take a moment.",
    idleGuidance: "Press start when you're ready",
    pause: "Pause", resume: "Resume", start: "Start", done: "Done", restart: "Restart", again: "Again",
    remaining: "remaining", elapsed: "elapsed", breathPace: "breath pace",
    cyclesCount: "{count} cycles", cycleN: "cycle {n}", untilStopped: "until stopped",
    footerBreathing: "breathing with {name}", footerComplete: "nicely done", footerReady: "ready when you are",
    close: "Close", about: "About this technique",
    mute: "Mute breathing cues", unmute: "Unmute breathing cues",
    getReady: "Get ready", getReadyGuidance: "Settle in — we begin in a moment", startNow: "Start now",
    tense: "Tense", release: "Release", groupProgress: "{n} / {total}", footerRelaxing: "relaxing with {name}",
  };
  let chromeStrings = { ...chromeFallback };

  const PMR_TENSE_COLOR = [0.90, 0.64, 0.42];
  const PMR_TENSE_CSS = "#e6a36b";
  const PMR_RELEASE_COLOR = [0.30, 0.86, 0.78];
  const PMR_RELEASE_CSS = "#4fdcc5";

  const chromeText = (key, vars) => {
    let text = typeof chromeStrings[key] === "string" && chromeStrings[key] ? chromeStrings[key] : chromeFallback[key] ?? "";
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  };

  let descriptor = null;
  let runState = "idle"; // idle | active | paused | complete
  let selectedPatternId = null;
  let phaseIndex = 0;
  let cycleIndex = 0;
  let stepIndex = 0;
  let stepPhase = "tense"; // "tense" | "release"
  let phaseElapsedMs = 0;
  let countdownRemainingMs = 0;
  let lastFrameAt = 0;
  let rafHandle = null;
  let pulseStartedAt = -10;
  let breathValue = 0;
  let currentColor = IDLE_COLOR.slice();
  let targetColor = IDLE_COLOR.slice();
  let currentPhaseCss = "#7ab3ff";
  let lastCountdownText = "";
  let currentIllustrationUrl = "";
  let illustrationVisible = false;
  let cuesVisible = false;
  let lastRenderedCuesStep = null;

  // Phase audio cues (host-gated by the global plugin-audio setting and quiet
  // hours; user-toggled via the top-bar mute button).
  let audioCues = null; // { enabled, allowed, inhaleEl, exhaleEl }

  const stopCuePlayback = () => {
    if (!audioCues) return;
    for (const element of [audioCues.inhaleEl, audioCues.exhaleEl]) {
      if (element) {
        element.pause();
        element.currentTime = 0;
      }
    }
  };

  const playPhaseCue = (phaseKind) => {
    if (!audioCues || !audioCues.enabled || !audioCues.allowed || runState !== "active") return;
    const element = phaseKind === "in" ? audioCues.inhaleEl : phaseKind === "out" ? audioCues.exhaleEl : null;
    if (!element) return;
    stopCuePlayback();
    element.volume = 0.9;
    element.currentTime = 0;
    void element.play().catch(() => undefined);
  };

  const applyAudioPayload = (raw) => {
    if (!raw || typeof raw !== "object") {
      stopCuePlayback();
      audioCues = null;
      return;
    }
    const makeCueElement = (dataUrl, existing) => {
      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:audio/")) return null;
      if (existing && existing.src === dataUrl) return existing;
      const element = new Audio();
      element.preload = "auto";
      element.src = dataUrl;
      return element;
    };
    audioCues = {
      enabled: raw.enabled !== false,
      allowed: raw.allowed === true,
      inhaleEl: makeCueElement(raw.inhaleDataUrl, audioCues?.inhaleEl),
      exhaleEl: makeCueElement(raw.exhaleDataUrl, audioCues?.exhaleEl),
    };
  };

  const sendSessionEvent = (payload) => {
    ipcRenderer.send("openpets:session-overlay-event", payload);
  };

  const selectedPattern = () => {
    if (!descriptor || descriptor.kind !== "breathing") return null;
    return descriptor.patterns.find((pattern) => pattern.id === selectedPatternId) ?? descriptor.patterns[0];
  };

  // --- DOM ---------------------------------------------------------------

  const root = document.createElement("div");
  root.className = "openpets-session-overlay";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Practice session");

  const orbCanvas = document.createElement("canvas");
  orbCanvas.className = "session-orb-canvas";
  root.appendChild(orbCanvas);


  const topbar = document.createElement("div");
  topbar.className = "session-card-header";
  const topbarIcon = document.createElement("div");
  topbarIcon.className = "session-header-icon";
  // lucide:leaf (via better-icons/Iconify)
  topbarIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><path d="M11 20a10 10 0 0 0 10-10a25.9 25.9 0 0 0-1.04-7.281a1 1 0 0 0-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0 0 11 20"/><path d="M2 21a5 5 0 0 1 2.911-4.544C7.613 15.212 8.351 15.24 11 13"/></svg>';
  const topbarTitles = document.createElement("div");
  topbarTitles.className = "session-header-titles";
  const topbarTitle = document.createElement("div");
  topbarTitle.className = "session-header-title";
  const topbarSubtitle = document.createElement("div");
  topbarSubtitle.className = "session-header-subtitle";
  topbarTitles.appendChild(topbarTitle);
  topbarTitles.appendChild(topbarSubtitle);
  // The top bar doubles as the phase HUD: during a run it shows the phase
  // name, guidance, and the live countdown instead of the plugin title.
  const phaseName = topbarTitle;
  const phaseGuidance = topbarSubtitle;
  const phaseCount = document.createElement("div");
  phaseCount.className = "session-header-count";
  const phaseCountValue = document.createElement("span");
  const phaseCountUnit = document.createElement("span");
  phaseCountUnit.className = "count-unit";
  phaseCountUnit.textContent = "s";
  phaseCount.appendChild(phaseCountValue);
  phaseCount.appendChild(phaseCountUnit);
  // lucide:volume-2 / lucide:volume-x (via better-icons/Iconify)
  const volumeOnSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298zM16 9a5 5 0 0 1 0 6m3.364 3.364a9 9 0 0 0 0-12.728"/></svg>';
  const volumeOffSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298zm5.5 9.798l5-5m-5 0l5 5"/></svg>';
  const audioBtn = document.createElement("button");
  audioBtn.type = "button";
  audioBtn.className = "session-close-btn session-audio-btn";
  audioBtn.style.display = "none";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "session-close-btn";
  closeBtn.setAttribute("aria-label", "Close session");
  closeBtn.setAttribute("title", "Close (Esc)");
  // lucide:x (via better-icons/Iconify)
  closeBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

  const card = document.createElement("div");
  card.className = "session-card";

  // Row 1: the header (phase name/guidance, countdown, mute, close) — the
  // former top bar, merged into the single bottom HUD.
  topbar.appendChild(topbarIcon);
  topbar.appendChild(topbarTitles);
  topbar.appendChild(phaseCount);
  topbar.appendChild(audioBtn);
  topbar.appendChild(closeBtn);
  card.appendChild(topbar);

  // PMR pose illustration well: fixed height so tense/release swaps do not jump
  // the card. Hidden when breathing or when the step has no declared pose image.
  const illustrationWell = document.createElement("div");
  illustrationWell.className = "session-illustration";
  const illustrationImg = document.createElement("img");
  illustrationImg.className = "session-illustration-img";
  illustrationImg.alt = "";
  illustrationImg.addEventListener("error", () => {
    if (illustrationVisible) {
      illustrationVisible = false;
      illustrationWell.style.display = "none";
      currentIllustrationUrl = "";
      scheduleSessionGeometry();
    }
  });
  illustrationWell.appendChild(illustrationImg);
  card.appendChild(illustrationWell);

  // PMR cue row: side-by-side exercise step bullets (tense & release)
  const cuesRow = document.createElement("div");
  cuesRow.className = "session-pmr-cues";

  const tenseCol = document.createElement("div");
  tenseCol.className = "session-cues-col is-tense";
  const tenseHeader = document.createElement("div");
  tenseHeader.className = "session-cues-header";
  const tenseTitle = document.createElement("span");
  tenseTitle.className = "session-cues-title";
  tenseHeader.appendChild(tenseTitle);
  const tenseList = document.createElement("ol");
  tenseList.className = "session-cues-list";
  tenseCol.appendChild(tenseHeader);
  tenseCol.appendChild(tenseList);

  const releaseCol = document.createElement("div");
  releaseCol.className = "session-cues-col is-release";
  const releaseHeader = document.createElement("div");
  releaseHeader.className = "session-cues-header";
  const releaseTitle = document.createElement("span");
  releaseTitle.className = "session-cues-title";
  releaseHeader.appendChild(releaseTitle);
  const releaseList = document.createElement("ol");
  releaseList.className = "session-cues-list";
  releaseCol.appendChild(releaseHeader);
  releaseCol.appendChild(releaseList);

  cuesRow.appendChild(tenseCol);
  cuesRow.appendChild(releaseCol);
  card.appendChild(cuesRow);

  // Row 2: cycle dots (or a slim bar for long/until-stopped runs) + count.
  const dotsRow = document.createElement("div");
  dotsRow.className = "session-dots-row";
  const dotsBox = document.createElement("div");
  dotsBox.className = "session-dots";
  const dotsBar = document.createElement("div");
  dotsBar.className = "session-dots-bar";
  const dotsBarFill = document.createElement("div");
  dotsBarFill.className = "session-dots-bar-fill";
  dotsBar.appendChild(dotsBarFill);
  const dotsCount = document.createElement("div");
  dotsCount.className = "session-dots-count";
  dotsRow.appendChild(dotsBox);
  dotsRow.appendChild(dotsBar);
  dotsRow.appendChild(dotsCount);
  card.appendChild(dotsRow);

  // Row 2: session timer · animated lungs · breath pace.
  const tiles = document.createElement("div");
  tiles.className = "session-tiles";
  const makeTile = (extraClass) => {
    const tile = document.createElement("div");
    tile.className = `session-tile${extraClass ? ` ${extraClass}` : ""}`;
    return tile;
  };
  const timerTile = makeTile("");
  const timerIcon = document.createElement("div");
  timerIcon.className = "session-tile-icon";
  // lucide:timer (via better-icons/Iconify)
  timerIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><path d="M10 2h4m-2 12l3-3"/><circle cx="12" cy="14" r="8"/></svg>';
  const timerContent = document.createElement("div");
  timerContent.className = "session-tile-content";
  const timerValue = document.createElement("div");
  timerValue.className = "session-tile-value";
  const timerLabel = document.createElement("div");
  timerLabel.className = "session-tile-label";
  timerLabel.textContent = "remaining";
  timerContent.appendChild(timerValue);
  timerContent.appendChild(timerLabel);
  timerTile.appendChild(timerIcon);
  timerTile.appendChild(timerContent);

  const lungsTile = makeTile("is-middle");
  const lungsIcon = document.createElement("div");
  lungsIcon.className = "session-lungs";
  lungsIcon.setAttribute("aria-hidden", "true");
  // tabler:lungs (via better-icons/Iconify)
  lungsIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" aria-hidden="true"><path d="M6.081 20C7.693 20 9 18.665 9 17.02V7.257C9 6.563 8.448 6 7.768 6c-.205 0-.405.052-.584.15l-.13.083C5.594 7.292 4.622 8.88 3.65 12.057q-.63 2.055-.648 4.775c-.012 1.675 1.261 3.054 2.877 3.161zm11.839 0C16.307 20 15 18.665 15 17.02V7.257C15 6.563 15.552 6 16.233 6c.204 0 .405.052.584.15l.13.083c1.46 1.059 2.432 2.647 3.405 5.824q.63 2.055.648 4.775c.012 1.675-1.261 3.054-2.878 3.161zM9 12a3 3 0 0 0 3-3a3 3 0 0 0 3 3m-3-8v5"/></svg>';
  const phaseWord = document.createElement("div");
  phaseWord.className = "session-tile-value";
  phaseWord.style.display = "none";
  lungsTile.appendChild(lungsIcon);
  lungsTile.appendChild(phaseWord);

  const paceTile = makeTile("");
  const paceIcon = document.createElement("div");
  paceIcon.className = "session-tile-icon";
  // lucide:audio-waveform (via better-icons/Iconify)
  paceIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2"/></svg>';
  const paceContent = document.createElement("div");
  paceContent.className = "session-tile-content";
  const paceValue = document.createElement("div");
  paceValue.className = "session-tile-value";
  const paceLabel = document.createElement("div");
  paceLabel.className = "session-tile-label";
  paceLabel.textContent = "breath pace";
  paceContent.appendChild(paceValue);
  paceContent.appendChild(paceLabel);
  paceTile.appendChild(paceIcon);
  paceTile.appendChild(paceContent);

  tiles.appendChild(timerTile);
  tiles.appendChild(lungsTile);
  tiles.appendChild(paceTile);
  card.appendChild(tiles);

  // Row 3: the phase segment track.
  const steps = document.createElement("div");
  steps.className = "session-steps";
  card.appendChild(steps);

  // Row 4: Info · Restart · Pause/Resume/Done.
  const controls = document.createElement("div");
  controls.className = "session-controls";
  const infoBtn = document.createElement("button");
  infoBtn.type = "button";
  infoBtn.className = "session-info-btn";
  infoBtn.setAttribute("aria-label", "About this technique");
  infoBtn.setAttribute("title", "About this technique");
  // lucide:info (via better-icons/Iconify)
  infoBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>';
  const controlsSpacer = document.createElement("div");
  controlsSpacer.className = "session-controls-spacer";
  const switchPracticeBtn = document.createElement("button");
  switchPracticeBtn.type = "button";
  switchPracticeBtn.className = "session-ghost-btn";
  switchPracticeBtn.style.display = "none";
  switchPracticeBtn.addEventListener("click", () => {
    if (!descriptor?.practices || descriptor.practices.length <= 1) return;
    const currentId = descriptor.practiceId ?? (descriptor.kind === "breathing" ? "breathing" : "pmr");
    const currentIndex = descriptor.practices.findIndex((p) => p.id === currentId);
    const nextPractice = descriptor.practices[(currentIndex + 1) % descriptor.practices.length];
    if (nextPractice) {
      sendSessionEvent({ type: "practiceSelected", practiceId: nextPractice.id });
    }
  });
  const restartBtn = document.createElement("button");
  restartBtn.type = "button";
  restartBtn.className = "session-ghost-btn";
  const primaryBtn = document.createElement("button");
  primaryBtn.type = "button";
  primaryBtn.className = "session-primary-btn";
  controls.appendChild(infoBtn);
  controls.appendChild(controlsSpacer);
  controls.appendChild(switchPracticeBtn);
  controls.appendChild(restartBtn);
  controls.appendChild(primaryBtn);
  card.appendChild(controls);

  // Footer: paws + companion line.
  const footer = document.createElement("div");
  footer.className = "session-footer";
  card.appendChild(footer);

  root.appendChild(card);

  document.body.appendChild(root);

  // --- Runtime geometry ------------------------------------------------------
  // Measures the real rendered sprite and card, then aligns orb, ring, and
  // pet lift so the composition is exact for any pet asset and scale.

  const parseCurrentPetLift = (hitbox) => {
    const transform = getComputedStyle(hitbox).transform;
    if (!transform || transform === "none") return 0;
    const match = /matrix\(([^)]+)\)/.exec(transform);
    if (!match) return 0;
    const parts = match[1].split(",").map((value) => Number(value.trim()));
    const translateY = parts.length === 6 && Number.isFinite(parts[5]) ? parts[5] : 0;
    return -translateY;
  };

  const applySessionGeometry = () => {
    if (!descriptor) return;
    const sprite = document.querySelector(".installed-sprite, .sprite");
    const hitbox = document.querySelector(".pet-hitbox");
    if (!sprite || !hitbox) return;
    const cardHeight = Math.max(110, Math.round(card.getBoundingClientRect().height));
    const spriteRect = sprite.getBoundingClientRect();
    if (spriteRect.height <= 0 || window.innerHeight <= 0) return;

    // The lift transform may already (or still) be applied; subtracting the
    // live translation recovers the sprite's resting centre.
    const currentLift = parseCurrentPetLift(hitbox);
    const restCenterY = spriteRect.top + spriteRect.height / 2 + currentLift;

    // Keep the orb (rim glow included) inside the band above the card.
    const rimReserved = 18;
    const bandHeight = window.innerHeight - rimReserved - (CARD_BOTTOM_INSET + cardHeight + ORB_CARD_GAP);
    const maxRadius = Math.max(96, Math.floor((bandHeight - 40) / 2));
    ORB_RADIUS = Math.max(96, Math.min(Math.min(240, maxRadius), Math.round(spriteRect.height)));

    const orbCenterBottom = CARD_BOTTOM_INSET + cardHeight + ORB_CARD_GAP + ORB_RADIUS;
    const desiredCenterY = window.innerHeight - orbCenterBottom;
    const petLift = Math.max(0, Math.round(restCenterY - desiredCenterY));

    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--session-orb-radius", String(ORB_RADIUS));
    rootStyle.setProperty("--session-orb-center-bottom", String(orbCenterBottom));
    rootStyle.setProperty("--session-pet-lift", `${petLift}px`);

  };

  const scheduleSessionGeometry = () => {
    requestAnimationFrame(() => requestAnimationFrame(applySessionGeometry));
  };

  window.addEventListener("resize", () => {
    if (descriptor) scheduleSessionGeometry();
  });

  // --- WebGL orb -----------------------------------------------------------

  const orbGl = createOrbRenderer(orbCanvas);

  function createOrbRenderer(canvas) {
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) {
      // Graceful fallback: a layered radial gradient still reads as an orb.
      canvas.style.background = "radial-gradient(circle at 50% 42%, rgba(120,170,255,0.55), rgba(48,90,190,0.34) 42%, rgba(20,40,90,0.18) 58%, transparent 68%)";
      canvas.style.borderRadius = "50%";
      return null;
    }

    const vertexSource = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;
    const fragmentSource = `
      precision highp float;
      uniform vec2 u_resolution;
      uniform float u_radius;
      uniform float u_time;
      uniform float u_breath;
      uniform float u_energy;
      uniform float u_pulse;
      uniform vec3 u_tint;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.55;
        for (int i = 0; i < 4; i++) {
          value += amplitude * noise(p);
          p = p * 2.03 + vec2(17.7, 9.2);
          amplitude *= 0.5;
        }
        return value;
      }

      vec2 rotate(vec2 p, float a) {
        float c = cos(a);
        float s = sin(a);
        return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
      }

      void main() {
        vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_radius;
        p.y = -p.y;
        float breathScale = 0.84 + 0.13 * u_breath;
        float d = length(p) / breathScale;

        // Saturated galaxy palette: indigo base + violet nebula accent.
        // No near-black bases — dark desaturated colors read as gray fog
        // once composited at partial alpha over light desktops.
        vec3 deep = vec3(0.10, 0.16, 0.46);
        vec3 nebulaViolet = vec3(0.54, 0.32, 0.95);
        vec3 tint = u_tint;
        vec3 color = vec3(0.0);
        float alpha = 0.0;

        if (d < 1.0) {
          float z = sqrt(max(0.0, 1.0 - d * d));
          vec3 n = vec3(p / breathScale, z);

          // The galaxy's own night sky: a near-opaque deep-space disc fitted
          // exactly to the sphere (it breathes with it), so the nebula reads
          // the same on light and dark desktops.
          float discMask = smoothstep(1.0, 0.975, d);
          vec3 space = vec3(0.014, 0.028, 0.082);

          // Volumetric wisps: two drifting fbm layers, weighted toward depth.
          vec2 q = rotate(p, u_time * 0.05) * 1.9;
          float w1 = fbm(q + vec2(0.0, -u_time * 0.09));
          float w2 = fbm(rotate(p, -u_time * 0.03) * 3.1 + vec2(u_time * 0.05, 0.0));
          float wisps = (w1 * 0.72 + w2 * 0.45) * (0.35 + 0.65 * z);
          // Only the bright filaments render — the space between strands stays
          // fully transparent so the orb never fogs the desktop behind it.
          float strands = max(0.0, wisps - 0.42) * 1.9;

          // A compact luminous heart that swells with the breath.
          float core = exp(-d * d * 4.5) * (0.22 + 0.5 * u_breath);

          // Rim light (fresnel) sells the sphere.
          float fresnel = pow(1.0 - z, 2.4);

          // Soft glint from the top-left (p is y-down here).
          vec3 lightDir = normalize(vec3(-0.42, -0.58, 0.72));
          float spec = pow(max(dot(n, lightDir), 0.0), 34.0) * 0.7;

          // Sparse round motes drifting inside the volume.
          vec2 moteCoord = rotate(p, u_time * 0.02) * 7.0 + vec2(0.0, u_time * 0.12);
          vec2 moteCell = floor(moteCoord);
          vec2 moteLocal = fract(moteCoord) - 0.5;
          vec2 moteOffset = vec2(hash(moteCell) - 0.5, hash(moteCell + 19.7) - 0.5) * 0.6;
          float moteDist = length(moteLocal - moteOffset);
          float mote = smoothstep(0.11, 0.02, moteDist) * step(0.78, hash(moteCell + 7.3)) * z;
          float twinkle = mote * (0.30 + 0.70 * (0.5 + 0.5 * sin(u_time * 1.7 + hash(moteCell.yx) * 6.283)));

          // Broad colored galaxy volume: saturated, so it tints white
          // desktops instead of graying them (compositing is single-alpha).
          float bodyGlow = (0.30 + 0.38 * wisps) * z;

          vec3 body = mix(deep, tint, clamp(0.28 + 0.55 * wisps, 0.0, 1.0));
          body = mix(body, nebulaViolet, clamp(w2 * 0.65, 0.0, 0.65));
          color = space * discMask
            + body * (core * 1.5 + strands * 1.1 + bodyGlow)
            + tint * fresnel * 0.95
            + vec3(0.80, 0.88, 1.0) * spec * 0.5
            + vec3(0.85, 0.93, 1.0) * twinkle * 0.55;
          alpha = clamp(core * 1.2 + strands * 0.6 + bodyGlow * 0.85 + fresnel * 0.9 + spec * 0.5 + twinkle * 0.55, 0.0, 1.0);
          alpha = max(alpha, discMask * 0.96);
        }

        // Halo + crisp rim band. The halo is windowed to a hard outer edge so
        // the canvas never veils the desktop beyond the glow.
        float rim = exp(-abs(d - 1.0) * 26.0);
        float haloWindow = 1.0 - smoothstep(1.02, 1.42, d);
        float halo = d >= 1.0 ? exp(-(d - 1.0) * 4.2) * 0.28 * haloWindow : 0.0;
        color += tint * (rim * 0.85 + halo);
        alpha = clamp(alpha + rim * 0.75 + halo, 0.0, 1.0);

        // Expanding ripple on phase change: icy phase-tinted light.
        float pulseAge = u_time - u_pulse;
        if (pulseAge >= 0.0 && pulseAge < 1.6) {
          float rippleRadius = 1.0 + pulseAge * 0.30;
          float rippleFade = (1.0 - pulseAge / 1.6);
          float ripple = exp(-abs(d - rippleRadius) * 34.0) * rippleFade * rippleFade * 0.7;
          vec3 rippleColor = mix(tint, vec3(0.85, 0.93, 1.0), 0.35);
          color += rippleColor * ripple;
          alpha = clamp(alpha + ripple, 0.0, 1.0);
        }

        alpha *= u_energy;
        // Hard floor: fully transparent outside the visible glow.
        if (alpha < 0.006) alpha = 0.0;
        // Premultiplied output: color already carries the light energy — do
        // NOT multiply by alpha again, or every semi-transparent pixel
        // composites darker than its true color (black-fringed glows).
        gl_FragColor = vec4(min(color * u_energy, vec3(1.0)), alpha);
      }
    `;

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Session orb shader failed to compile.", gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };
    const vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Session orb shader failed to link.", gl.getProgramInfoLog(program));
      return null;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    return {
      gl,
      uniforms: {
        resolution: gl.getUniformLocation(program, "u_resolution"),
        radius: gl.getUniformLocation(program, "u_radius"),
        time: gl.getUniformLocation(program, "u_time"),
        breath: gl.getUniformLocation(program, "u_breath"),
        energy: gl.getUniformLocation(program, "u_energy"),
        pulse: gl.getUniformLocation(program, "u_pulse"),
        tint: gl.getUniformLocation(program, "u_tint"),
      },
    };
  }

  const resizeOrbCanvas = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = orbCanvas.clientWidth || 1;
    const height = orbCanvas.clientHeight || 1;
    if (orbCanvas.width !== Math.round(width * dpr) || orbCanvas.height !== Math.round(height * dpr)) {
      orbCanvas.width = Math.round(width * dpr);
      orbCanvas.height = Math.round(height * dpr);
      if (orbGl) orbGl.gl.viewport(0, 0, orbCanvas.width, orbCanvas.height);
    }
    return dpr;
  };

  // --- Phase clock ---------------------------------------------------------

  const phasePresentation = (phase) => {
    const base = PHASE_STYLE[phase.kind] ?? PHASE_STYLE.in;
    return {
      name: chromeText(base.nameKey),
      guidance: typeof phase.label === "string" && phase.label ? phase.label : chromeText(base.guidanceKey),
      color: base.color,
    };
  };

  const easeInOutSine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

  const breathTargetFor = (phase, progress) => {
    if (!phase) return 0.25;
    if (phase.kind === "in") return easeInOutSine(progress);
    if (phase.kind === "out") return 1 - easeInOutSine(progress);
    // Hold keeps the lungs where the previous phase left them.
    const pattern = selectedPattern();
    if (!pattern) return 0.5;
    const previous = pattern.phases[(phaseIndex + pattern.phases.length - 1) % pattern.phases.length];
    return previous && previous.kind === "out" ? 0.06 : 1;
  };

  const triggerPulse = (nowSeconds) => {
    pulseStartedAt = nowSeconds;
  };

  const advancePmrClock = (deltaMs, nowSeconds) => {
    if (!descriptor || descriptor.kind !== "pmr" || runState !== "active") return;
    phaseElapsedMs += deltaMs;
    let guard = 0;
    while (guard < 32) {
      guard += 1;
      const step = descriptor.steps[stepIndex];
      if (!step) break;
      const phaseMs = (stepPhase === "tense" ? step.tenseSeconds : step.releaseSeconds) * 1000;
      if (phaseElapsedMs < phaseMs) break;
      phaseElapsedMs -= phaseMs;
      triggerPulse(nowSeconds);
      if (stepPhase === "tense") {
        stepPhase = "release";
      } else {
        stepPhase = "tense";
        stepIndex += 1;
        if (stepIndex >= descriptor.steps.length) {
          runState = "complete";
          phaseElapsedMs = 0;
          sendSessionEvent({ type: "completed", patternId: "pmr", cycles: 1 });
          renderStatics();
          return;
        }
        renderStepTrack();
        renderProgressMeta();
      }
      renderPhaseText();
    }
  };

  const advanceClock = (deltaMs, nowSeconds) => {
    if (descriptor?.kind === "pmr") {
      advancePmrClock(deltaMs, nowSeconds);
      return;
    }
    const pattern = selectedPattern();
    if (!pattern || runState !== "active") return;
    phaseElapsedMs += deltaMs;
    let guard = 0;
    while (guard < 16) {
      guard += 1;
      const phase = pattern.phases[phaseIndex];
      const phaseMs = phase.seconds * 1000;
      if (phaseElapsedMs < phaseMs) break;
      phaseElapsedMs -= phaseMs;
      phaseIndex += 1;
      triggerPulse(nowSeconds);
      if (phaseIndex >= pattern.phases.length) {
        phaseIndex = 0;
        cycleIndex += 1;
        if (pattern.cycles !== null && cycleIndex >= pattern.cycles) {
          runState = "complete";
          phaseElapsedMs = 0;
          stopCuePlayback();
          sendSessionEvent({ type: "completed", patternId: pattern.id, cycles: pattern.cycles });
          renderStatics();
          return;
        }
        renderProgressMeta();
      }
      playPhaseCue(pattern.phases[phaseIndex].kind);
      renderPhaseText();
    }
  };

  // --- Rendering -----------------------------------------------------------

  const renderIllustration = () => {
    if (!descriptor || descriptor.kind !== "pmr") {
      if (illustrationVisible) {
        illustrationVisible = false;
        illustrationWell.style.display = "none";
        currentIllustrationUrl = "";
        illustrationImg.removeAttribute("src");
        scheduleSessionGeometry();
      } else {
        illustrationWell.style.display = "none";
      }
      return;
    }

    const stepsList = Array.isArray(descriptor.steps) ? descriptor.steps : [];
    let targetUrl = null;
    let activeStep = null;

    if (runState === "idle" || runState === "countdown") {
      activeStep = stepsList[0] ?? null;
      targetUrl = activeStep?.tenseImageUrl ?? null;
    } else if (runState === "complete") {
      activeStep = stepsList[Math.max(0, stepsList.length - 1)] ?? null;
      targetUrl = activeStep?.releaseImageUrl ?? activeStep?.tenseImageUrl ?? null;
    } else {
      activeStep = stepsList[stepIndex] ?? stepsList[0] ?? null;
      targetUrl = (stepPhase === "tense" ? activeStep?.tenseImageUrl : activeStep?.releaseImageUrl) ?? null;
    }

    const hasUrl = typeof targetUrl === "string" && targetUrl.trim().length > 0;
    if (!hasUrl) {
      if (illustrationVisible) {
        illustrationVisible = false;
        illustrationWell.style.display = "none";
        currentIllustrationUrl = "";
        illustrationImg.removeAttribute("src");
        scheduleSessionGeometry();
      } else {
        illustrationWell.style.display = "none";
      }
      return;
    }

    if (!illustrationVisible) {
      illustrationVisible = true;
      illustrationWell.style.display = "flex";
      scheduleSessionGeometry();
    }

    if (currentIllustrationUrl !== targetUrl) {
      currentIllustrationUrl = targetUrl;
      illustrationImg.src = targetUrl;
      illustrationImg.alt = activeStep?.name ? String(activeStep.name) : "";
    }
  };

  const renderCues = () => {
    if (!descriptor || descriptor.kind !== "pmr") {
      if (cuesVisible) {
        cuesVisible = false;
        cuesRow.style.display = "none";
        lastRenderedCuesStep = null;
        scheduleSessionGeometry();
      } else {
        cuesRow.style.display = "none";
      }
      return;
    }

    const stepsList = Array.isArray(descriptor.steps) ? descriptor.steps : [];
    let activeStep = null;

    if (runState === "idle" || runState === "countdown") {
      activeStep = stepsList[0] ?? null;
    } else if (runState === "complete") {
      activeStep = stepsList[Math.max(0, stepsList.length - 1)] ?? null;
    } else {
      activeStep = stepsList[stepIndex] ?? stepsList[0] ?? null;
    }

    const hasCues = Boolean(
      activeStep &&
      Array.isArray(activeStep.tenseCues) &&
      activeStep.tenseCues.length > 0 &&
      Array.isArray(activeStep.releaseCues) &&
      activeStep.releaseCues.length > 0
    );

    if (!hasCues) {
      if (cuesVisible) {
        cuesVisible = false;
        cuesRow.style.display = "none";
        lastRenderedCuesStep = null;
        scheduleSessionGeometry();
      } else {
        cuesRow.style.display = "none";
      }
      return;
    }

    if (!cuesVisible) {
      cuesVisible = true;
      cuesRow.style.display = "grid";
      scheduleSessionGeometry();
    }

    tenseTitle.textContent = activeStep.tenseLabel || chromeText("tense");
    releaseTitle.textContent = activeStep.releaseLabel || chromeText("release");

    if (lastRenderedCuesStep !== activeStep) {
      lastRenderedCuesStep = activeStep;

      const populateList = (listEl, items) => {
        listEl.textContent = "";
        for (let i = 0; i < items.length; i += 1) {
          const item = document.createElement("li");
          item.className = "session-cue-item";
          const badge = document.createElement("span");
          badge.className = "session-cue-badge";
          badge.textContent = String(i + 1);
          const text = document.createElement("span");
          text.className = "session-cue-text";
          text.textContent = String(items[i]);
          item.appendChild(badge);
          item.appendChild(text);
          listEl.appendChild(item);
        }
      };

      populateList(tenseList, activeStep.tenseCues);
      populateList(releaseList, activeStep.releaseCues);
    }

    const isTenseActive = (runState === "active" || runState === "paused") && stepPhase === "tense";
    const isReleaseActive = ((runState === "active" || runState === "paused") && stepPhase === "release") || runState === "complete";

    tenseCol.classList.toggle("is-active", isTenseActive);
    releaseCol.classList.toggle("is-active", isReleaseActive);
    cuesRow.classList.toggle("has-active", isTenseActive || isReleaseActive);
  };

  const renderPhaseText = () => {
    if (!descriptor) return;
    if (runState === "complete") {
      phaseName.textContent = chromeText("complete");
      phaseGuidance.textContent = chromeText("completeGuidance");
      phaseCount.style.display = "none";
      updateStepStates();
      renderIllustration();
      renderCues();
      return;
    }
    if (runState === "countdown") {
      phaseName.textContent = chromeText("getReady");
      phaseGuidance.textContent = chromeText("getReadyGuidance");
      phaseCount.style.display = "";
      updateStepStates();
      renderIllustration();
      renderCues();
      return;
    }
    if (runState === "idle") {
      phaseName.textContent = descriptor.title;
      phaseGuidance.textContent = descriptor.subtitle ?? chromeText("idleGuidance");
      phaseCount.style.display = "none";
      if (descriptor.kind === "pmr") {
        phaseWord.textContent = chromeText("tense");
      }
      updateStepStates();
      renderIllustration();
      renderCues();
      return;
    }
    if (descriptor.kind === "pmr") {
      const step = descriptor.steps[stepIndex] ?? descriptor.steps[0];
      if (!step) return;
      phaseName.textContent = runState === "paused" ? chromeText("paused") : step.name;
      const hasCues = Boolean(
        step &&
        Array.isArray(step.tenseCues) &&
        step.tenseCues.length > 0 &&
        Array.isArray(step.releaseCues) &&
        step.releaseCues.length > 0
      );
      const phaseWordText = stepPhase === "tense"
        ? (step.tenseLabel || chromeText("tense"))
        : (step.releaseLabel || chromeText("release"));
      phaseGuidance.textContent = runState === "paused"
        ? chromeText("pausedGuidance")
        : (hasCues ? phaseWordText : (stepPhase === "tense" ? (step.tenseCue || step.tenseLabel) : (step.releaseCue || step.releaseLabel)));
      phaseCount.style.display = runState === "paused" ? "none" : "";
      targetColor = stepPhase === "tense" ? PMR_TENSE_COLOR : PMR_RELEASE_COLOR;
      currentPhaseCss = stepPhase === "tense" ? PMR_TENSE_CSS : PMR_RELEASE_CSS;
      document.documentElement.style.setProperty("--session-phase-color", currentPhaseCss);
      phaseWord.textContent = phaseWordText;
      updateStepStates();
      renderIllustration();
      renderCues();
      return;
    }
    const pattern = selectedPattern();
    if (!pattern) return;
    const phase = pattern.phases[phaseIndex];
    const presentation = phasePresentation(phase);
    phaseName.textContent = runState === "paused" ? chromeText("paused") : presentation.name;
    phaseGuidance.textContent = runState === "paused" ? chromeText("pausedGuidance") : presentation.guidance;
    phaseCount.style.display = runState === "paused" ? "none" : "";
    targetColor = presentation.color;
    currentPhaseCss = PHASE_STYLE[phase.kind]?.css ?? "#7ab3ff";
    document.documentElement.style.setProperty("--session-phase-color", currentPhaseCss);
    updateStepStates();
    renderIllustration();
    renderCues();
  };

  const updateStepStates = () => {
    const stepElements = steps.children;
    const running = runState === "active" || runState === "paused";
    if (descriptor?.kind === "pmr") {
      const activeIdx = stepPhase === "tense" ? 0 : 1;
      for (let index = 0; index < stepElements.length; index += 1) {
        const step = stepElements[index];
        step.classList.toggle("is-active", running && index === activeIdx);
        step.classList.toggle("is-done", (running && index < activeIdx) || runState === "complete");
      }
      return;
    }
    for (let index = 0; index < stepElements.length; index += 1) {
      const step = stepElements[index];
      step.classList.toggle("is-active", running && index === phaseIndex);
      step.classList.toggle("is-done", (running && index < phaseIndex) || runState === "complete");
    }
  };

  // Control glyphs from better-icons/Iconify: lucide:pause, lucide:play,
  // lucide:check, lucide:rotate-ccw. Pause/play are filled so the primary
  // pill glyph stays solid at 13px.
  const pauseSvg = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><rect width="5" height="18" x="14" y="3" rx="1"/><rect width="5" height="18" x="5" y="3" rx="1"/></svg>';
  const playSvg = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>';
  const doneSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.6" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
  const restartSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

  const escapeChromeText = (key, vars) => escapeHtml(chromeText(key, vars));

  const primaryButtonContent = () => {
    if (runState === "countdown") return `${playSvg}<span>${escapeChromeText("startNow")}</span>`;
    if (runState === "active") return `${pauseSvg}<span>${escapeChromeText("pause")}</span>`;
    if (runState === "paused") return `${playSvg}<span>${escapeChromeText("resume")}</span>`;
    if (runState === "complete") return `${doneSvg}<span>${escapeChromeText("done")}</span>`;
    return `${playSvg}<span>${escapeChromeText("start")}</span>`;
  };

  const petCompanionName = () => {
    const name = document.documentElement.dataset.petDisplayName;
    return typeof name === "string" && name.trim() ? name.trim() : "your pet";
  };

  const cycleSeconds = (pattern) => pattern.phases.reduce((sum, phase) => sum + phase.seconds, 0);

  const formatClock = (totalSeconds) => {
    const clamped = Math.max(0, Math.round(totalSeconds));
    const minutes = Math.floor(clamped / 60);
    const seconds = clamped % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  const formatPace = (pattern) => {
    const seconds = cycleSeconds(pattern);
    if (seconds <= 0) return "";
    const perMinute = 60 / seconds;
    const rounded = Math.round(perMinute * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} / min`;
  };

  const maxCycleDots = 16;

  const renderStepTrack = () => {
    steps.textContent = "";
    if (descriptor?.kind === "pmr") {
      const step = descriptor.steps[stepIndex] ?? descriptor.steps[0];
      if (step) {
        const tenseStep = document.createElement("div");
        tenseStep.className = "session-step";
        tenseStep.style.flexGrow = String(Math.max(1, step.tenseSeconds));
        const tenseBar = document.createElement("div");
        tenseBar.className = "session-step-bar";
        const tenseFill = document.createElement("div");
        tenseFill.className = "session-step-fill";
        tenseBar.appendChild(tenseFill);
        const tenseLabel = document.createElement("div");
        tenseLabel.className = "session-step-label";
        tenseLabel.textContent = `${step.tenseLabel || chromeText("tense")} · ${formatSeconds(step.tenseSeconds)}`;
        tenseStep.appendChild(tenseBar);
        tenseStep.appendChild(tenseLabel);
        steps.appendChild(tenseStep);

        const releaseStep = document.createElement("div");
        releaseStep.className = "session-step";
        releaseStep.style.flexGrow = String(Math.max(1, step.releaseSeconds));
        const releaseBar = document.createElement("div");
        releaseBar.className = "session-step-bar";
        const releaseFill = document.createElement("div");
        releaseFill.className = "session-step-fill";
        releaseBar.appendChild(releaseFill);
        const releaseLabel = document.createElement("div");
        releaseLabel.className = "session-step-label";
        releaseLabel.textContent = `${step.releaseLabel || chromeText("release")} · ${formatSeconds(step.releaseSeconds)}`;
        releaseStep.appendChild(releaseBar);
        releaseStep.appendChild(releaseLabel);
        steps.appendChild(releaseStep);
      }
      return;
    }
    const pattern = selectedPattern();
    if (!descriptor || !pattern) return;
    for (const phase of pattern.phases) {
      const step = document.createElement("div");
      step.className = "session-step";
      step.style.flexGrow = String(Math.max(1, phase.seconds));
      const bar = document.createElement("div");
      bar.className = "session-step-bar";
      const fill = document.createElement("div");
      fill.className = "session-step-fill";
      bar.appendChild(fill);
      const label = document.createElement("div");
      label.className = "session-step-label";
      label.textContent = `${phasePresentation(phase).name} · ${formatSeconds(phase.seconds)}`;
      step.appendChild(bar);
      step.appendChild(label);
      steps.appendChild(step);
    }
  };

  const renderStatics = () => {
    if (!descriptor) return;
    const isPmr = descriptor.kind === "pmr";

    if (isPmr) {
      topbarIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><circle cx="12" cy="5" r="1"/><path d="m9 20l3-6l3 6M6 8l6 2l6-2m-6 2v4"/></svg>';
      lungsTile.style.flex = "1 1 0";
      lungsIcon.style.display = "none";
      phaseWord.style.display = "";
      paceTile.style.display = "none";
    } else {
      topbarIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><path d="M11 20a10 10 0 0 0 10-10a25.9 25.9 0 0 0-1.04-7.281a1 1 0 0 0-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0 0 11 20"/><path d="M2 21a5 5 0 0 1 2.911-4.544C7.613 15.212 8.351 15.24 11 13"/></svg>';
      lungsTile.style.flex = "";
      lungsIcon.style.display = "";
      phaseWord.style.display = "none";
      paceTile.style.display = "";
    }

    renderStepTrack();

    // Cycle dots for short finite runs; a slim bar otherwise.
    if (isPmr) {
      dotsBox.style.display = "none";
      dotsBar.style.display = "";
    } else {
      const pattern = selectedPattern();
      const useDots = pattern && pattern.cycles !== null && pattern.cycles <= maxCycleDots;
      dotsBox.style.display = useDots ? "" : "none";
      dotsBar.style.display = useDots ? "none" : "";
      if (useDots) {
        dotsBox.textContent = "";
        for (let index = 0; index < pattern.cycles; index += 1) {
          const dot = document.createElement("span");
          dot.className = "session-dot";
          dotsBox.appendChild(dot);
        }
      }
    }

    if (!isPmr) {
      const pattern = selectedPattern();
      if (pattern) {
        paceValue.textContent = formatPace(pattern);
        paceLabel.textContent = chromeText("breathPace");
      }
    }

    renderAudioButton();
    closeBtn.setAttribute("aria-label", chromeText("close"));
    closeBtn.setAttribute("title", `${chromeText("close")} (Esc)`);
    infoBtn.setAttribute("aria-label", chromeText("about"));
    infoBtn.setAttribute("title", chromeText("about"));
    card.classList.toggle("is-complete", runState === "complete");
    primaryBtn.innerHTML = primaryButtonContent();
    restartBtn.innerHTML = `${restartSvg}<span>${escapeChromeText(runState === "complete" ? "again" : "restart")}</span>`;
    restartBtn.style.display = runState === "idle" || runState === "countdown" ? "none" : "";
    infoBtn.style.display = descriptor.info ? "" : "none";

    if (runState === "idle" && descriptor.practices && descriptor.practices.length > 1) {
      const currentId = descriptor.practiceId ?? (isPmr ? "pmr" : "breathing");
      const currentIndex = descriptor.practices.findIndex((p) => p.id === currentId);
      const nextPractice = descriptor.practices[(currentIndex + 1) % descriptor.practices.length];
      if (nextPractice) {
        switchPracticeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" aria-hidden="true"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg><span>${escapeHtml(nextPractice.name)}</span>`;
        switchPracticeBtn.style.display = "";
      } else {
        switchPracticeBtn.style.display = "none";
      }
    } else {
      switchPracticeBtn.style.display = "none";
    }

    renderProgressMeta();
    renderPhaseText();
    // Card contents can change its height across states, and the orb stack is
    // anchored to the card — re-measure after this render settles.
    scheduleSessionGeometry();
  };

  /** Cycle dots/bar state, the count label, and the paw footer line. */
  const renderProgressMeta = () => {
    if (!descriptor) return;
    if (descriptor.kind === "pmr") {
      const totalSteps = descriptor.steps.length;
      dotsCount.innerHTML = "";
      if (runState === "idle" || runState === "countdown") {
        dotsCount.textContent = chromeText("groupProgress", { n: 1, total: totalSteps });
      } else {
        const displayStep = runState === "complete" ? totalSteps : Math.min(stepIndex + 1, totalSteps);
        const current = document.createElement("span");
        current.className = "count-current";
        current.textContent = String(displayStep);
        dotsCount.appendChild(current);
        dotsCount.appendChild(document.createTextNode(` / ${totalSteps}`));
      }

      if (runState === "complete") footer.textContent = `🐾  ${chromeText("footerComplete")}  🐾`;
      else if (runState === "idle" || runState === "countdown") footer.textContent = `🐾  ${chromeText("footerReady")}  🐾`;
      else footer.textContent = `🐾  ${chromeText("footerRelaxing", { name: petCompanionName() })}  🐾`;
      return;
    }

    const pattern = selectedPattern();
    if (!pattern) return;

    if (pattern.cycles !== null) {
      dotsCount.innerHTML = "";
      if (runState === "idle" || runState === "countdown") {
        dotsCount.textContent = chromeText("cyclesCount", { count: pattern.cycles });
      } else {
        const displayCycle = runState === "complete" ? pattern.cycles : Math.min(cycleIndex + 1, pattern.cycles);
        const current = document.createElement("span");
        current.className = "count-current";
        current.textContent = String(displayCycle);
        dotsCount.appendChild(current);
        dotsCount.appendChild(document.createTextNode(` / ${pattern.cycles}`));
      }
    } else {
      dotsCount.textContent = runState === "idle" || runState === "countdown" ? chromeText("untilStopped") : chromeText("cycleN", { n: cycleIndex + 1 });
    }

    const dots = dotsBox.children;
    for (let index = 0; index < dots.length; index += 1) {
      const done = runState === "complete" || ((runState === "active" || runState === "paused") && index < cycleIndex);
      const isCurrent = (runState === "active" || runState === "paused") && index === cycleIndex;
      dots[index].classList.toggle("is-done", done);
      dots[index].classList.toggle("is-current", isCurrent);
    }

    if (runState === "complete") footer.textContent = `🐾  ${chromeText("footerComplete")}  🐾`;
    else if (runState === "idle" || runState === "countdown") footer.textContent = `🐾  ${chromeText("footerReady")}  🐾`;
    else footer.textContent = `🐾  ${chromeText("footerBreathing", { name: petCompanionName() })}  🐾`;
  };

  const formatSeconds = (seconds) => {
    return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}s`;
  };

  // --- Frame loop ----------------------------------------------------------

  const frame = (now) => {
    rafHandle = null;
    if (!descriptor) return;
    const nowSeconds = now / 1000;
    const deltaMs = lastFrameAt > 0 ? Math.min(120, now - lastFrameAt) : 0;
    lastFrameAt = now;

    advanceClock(runState === "active" ? deltaMs : 0, nowSeconds);

    // Lead-in countdown before the first inhale.
    if (runState === "countdown") {
      countdownRemainingMs -= deltaMs;
      if (countdownRemainingMs <= 0) {
        beginActiveRun();
      } else {
        const text = String(Math.max(1, Math.ceil(countdownRemainingMs / 1000)));
        if (text !== lastCountdownText) {
          lastCountdownText = text;
          phaseCountValue.textContent = text;
        }
      }
    }

    const settlingToStart = runState === "countdown" && countdownRemainingMs < 1600;
    let breathTarget = 0.25;

    if (descriptor.kind === "pmr") {
      const step = descriptor.steps[stepIndex];
      const phaseMs = step ? (stepPhase === "tense" ? step.tenseSeconds : step.releaseSeconds) * 1000 : 1;
      const phaseProgress = step ? Math.min(1, phaseElapsedMs / phaseMs) : 0;
      const eased = easeInOutSine(phaseProgress);
      // Tense gathers the orb inward. Release lets it open, short of a full
      // inhale balloon — the opposite of the breathing swell.
      breathTarget = runState === "complete"
        ? 0.3
        : settlingToStart
          ? 0.35
          : runState === "idle" || runState === "countdown"
            ? 0.22 + 0.06 * Math.sin(nowSeconds * 0.8)
            : stepPhase === "tense"
              ? 0.45 - eased * (0.45 - 0.08)
              : 0.08 + eased * (0.62 - 0.08);
    } else {
      const pattern = selectedPattern();
      const phase = pattern && (runState === "active" || runState === "paused") ? pattern.phases[phaseIndex] : null;
      const phaseMs = phase ? phase.seconds * 1000 : 1;
      const phaseProgress = phase ? Math.min(1, phaseElapsedMs / phaseMs) : 0;
      breathTarget = runState === "complete"
        ? 0.3
        : settlingToStart
          ? 0.02
          : runState === "idle" || runState === "countdown"
            ? 0.22 + 0.06 * Math.sin(nowSeconds * 0.8)
            : breathTargetFor(phase, phaseProgress);
    }

    const smoothing = runState === "active" ? 0.16 : 0.05;
    breathValue += (breathTarget - breathValue) * smoothing;

    for (let channel = 0; channel < 3; channel += 1) {
      const target = runState === "active" ? targetColor[channel] : IDLE_COLOR[channel];
      currentColor[channel] += (target - currentColor[channel]) * 0.06;
    }

    // Countdown reflects the live phase clock.
    if (descriptor.kind === "pmr") {
      if (runState === "active") {
        const step = descriptor.steps[stepIndex];
        if (step) {
          const phaseMs = (stepPhase === "tense" ? step.tenseSeconds : step.releaseSeconds) * 1000;
          const remaining = Math.max(0, Math.ceil((phaseMs - phaseElapsedMs) / 1000));
          const text = String(remaining);
          if (text !== lastCountdownText) {
            lastCountdownText = text;
            phaseCountValue.textContent = text;
          }
        }
      }
    } else {
      const pattern = selectedPattern();
      const phase = pattern && (runState === "active" || runState === "paused") ? pattern.phases[phaseIndex] : null;
      if (phase && runState === "active") {
        const phaseMs = phase.seconds * 1000;
        const remaining = Math.max(0, Math.ceil((phaseMs - phaseElapsedMs) / 1000));
        const text = String(remaining);
        if (text !== lastCountdownText) {
          lastCountdownText = text;
          phaseCountValue.textContent = text;
        }
      }
    }

    // Session timer tile (whole-session remaining, or elapsed when endless)
    // plus the slim per-cycle/step bar.
    if (descriptor.kind === "pmr") {
      const totalSeconds = descriptor.steps.reduce((sum, s) => sum + s.tenseSeconds + s.releaseSeconds, 0);
      let elapsedSeconds = 0;
      for (let i = 0; i < stepIndex && i < descriptor.steps.length; i += 1) {
        elapsedSeconds += descriptor.steps[i].tenseSeconds + descriptor.steps[i].releaseSeconds;
      }
      const currentStep = descriptor.steps[stepIndex];
      if (currentStep && (runState === "active" || runState === "paused")) {
        if (stepPhase === "tense") {
          elapsedSeconds += phaseElapsedMs / 1000;
        } else {
          elapsedSeconds += currentStep.tenseSeconds + phaseElapsedMs / 1000;
        }
      }
      const remainingSeconds = runState === "complete" ? 0 : Math.max(0, totalSeconds - elapsedSeconds);
      const timerText = formatClock(remainingSeconds);
      if (timerValue.textContent !== timerText) timerValue.textContent = timerText;
      timerLabel.textContent = chromeText("remaining");

      if (dotsBar.style.display !== "none") {
        const progressFraction = runState === "complete"
          ? 1
          : runState === "idle" || runState === "countdown"
            ? 0
            : elapsedSeconds / Math.max(1, totalSeconds);
        dotsBarFill.style.width = `${Math.min(100, Math.max(0, progressFraction * 100))}%`;
      }
    } else {
      const pattern = selectedPattern();
      if (pattern) {
        const secondsPerCycle = cycleSeconds(pattern);
        const phase = (runState === "active" || runState === "paused") ? pattern.phases[phaseIndex] : null;
        const phaseMs = phase ? phase.seconds * 1000 : 1;
        const phaseProgress = phase ? Math.min(1, phaseElapsedMs / phaseMs) : 0;
        const withinCycleSeconds = runState === "idle" ? 0 : cycleProgressWithinCycle(pattern, phaseProgress) * secondsPerCycle;
        const elapsedSeconds = cycleIndex * secondsPerCycle + withinCycleSeconds;
        let timerText;
        if (pattern.cycles !== null) {
          const totalSeconds = pattern.cycles * secondsPerCycle;
          timerText = formatClock(runState === "complete" ? 0 : totalSeconds - elapsedSeconds);
          timerLabel.textContent = chromeText("remaining");
        } else {
          timerText = formatClock(elapsedSeconds);
          timerLabel.textContent = chromeText("elapsed");
        }
        if (timerValue.textContent !== timerText) timerValue.textContent = timerText;
        if (dotsBar.style.display !== "none") {
          dotsBarFill.style.width = `${Math.min(100, (withinCycleSeconds / Math.max(1, secondsPerCycle)) * 100)}%`;
        }
      }
    }

    if (descriptor.kind === "breathing") {
      lungsIcon.style.transform = `scale(${(0.88 + 0.24 * breathValue).toFixed(3)})`;
      lungsIcon.style.color = runState === "active" ? currentPhaseCss : "";
    }

    if (descriptor.kind === "pmr") {
      const step = descriptor.steps[stepIndex];
      const fills = steps.querySelectorAll(".session-step-fill");
      if (step && fills.length >= 2) {
        if (runState === "active" || runState === "paused") {
          if (stepPhase === "tense") {
            const progress = Math.min(1, phaseElapsedMs / (step.tenseSeconds * 1000));
            fills[0].style.width = `${progress * 100}%`;
            fills[1].style.width = "0%";
          } else {
            const progress = Math.min(1, phaseElapsedMs / (step.releaseSeconds * 1000));
            fills[0].style.width = "100%";
            fills[1].style.width = `${progress * 100}%`;
          }
        } else if (runState === "complete") {
          fills[0].style.width = "100%";
          fills[1].style.width = "100%";
        } else {
          fills[0].style.width = "0%";
          fills[1].style.width = "0%";
        }
      }
    } else {
      const pattern = selectedPattern();
      const phase = pattern && (runState === "active" || runState === "paused") ? pattern.phases[phaseIndex] : null;
      if (phase) {
        const phaseMs = phase.seconds * 1000;
        const phaseProgress = Math.min(1, phaseElapsedMs / phaseMs);
        const fills = steps.querySelectorAll(".session-step-fill");
        const activeFill = fills[phaseIndex];
        if (activeFill) activeFill.style.width = `${phaseProgress * 100}%`;
      }
    }

    if (orbGl) {
      const dpr = resizeOrbCanvas();
      const { gl, uniforms } = orbGl;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uniforms.resolution, orbCanvas.width, orbCanvas.height);
      gl.uniform1f(uniforms.radius, ORB_RADIUS * dpr);
      gl.uniform1f(uniforms.time, nowSeconds);
      gl.uniform1f(uniforms.breath, breathValue);
      gl.uniform1f(uniforms.energy, runState === "paused" ? 0.55 : runState === "idle" ? 0.7 : runState === "countdown" ? 0.8 : 1.0);
      gl.uniform1f(uniforms.pulse, pulseStartedAt);
      gl.uniform3f(uniforms.tint, currentColor[0], currentColor[1], currentColor[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    rafHandle = requestAnimationFrame(frame);
  };

  const cycleProgressWithinCycle = (pattern, phaseProgress) => {
    if (!pattern) return 0;
    const total = pattern.phases.reduce((sum, phase) => sum + phase.seconds, 0);
    let elapsed = 0;
    for (let index = 0; index < phaseIndex; index += 1) elapsed += pattern.phases[index].seconds;
    const current = pattern.phases[phaseIndex];
    elapsed += (current ? current.seconds : 0) * phaseProgress;
    return total > 0 ? Math.min(1, elapsed / total) : 0;
  };

  const startFrameLoop = () => {
    if (rafHandle === null) {
      lastFrameAt = 0;
      rafHandle = requestAnimationFrame(frame);
    }
  };

  const stopFrameLoop = () => {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  };

  // --- Run control ---------------------------------------------------------

  const resetClock = () => {
    phaseIndex = 0;
    cycleIndex = 0;
    stepIndex = 0;
    stepPhase = "tense";
    phaseElapsedMs = 0;
    lastCountdownText = "";
  };

  const beginActiveRun = () => {
    if (!descriptor) return;
    resetClock();
    breathValue = Math.min(breathValue, 0.05);
    runState = "active";
    triggerPulse(performance.now() / 1000);
    renderStatics();
    if (descriptor.kind === "breathing") {
      const pattern = selectedPattern();
      if (pattern) {
        playPhaseCue(pattern.phases[0].kind);
        sendSessionEvent({ type: "started", patternId: pattern.id });
      }
    } else if (descriptor.kind === "pmr") {
      sendSessionEvent({ type: "started", patternId: "pmr" });
    }
  };

  const startRun = () => {
    if (!descriptor) return;
    if (descriptor.kind === "breathing" && !selectedPattern()) return;
    const countdownSeconds = Number(descriptor?.countdownSeconds);
    if (Number.isFinite(countdownSeconds) && countdownSeconds > 0) {
      resetClock();
      runState = "countdown";
      countdownRemainingMs = countdownSeconds * 1000;
      lastCountdownText = "";
      renderStatics();
      return;
    }
    beginActiveRun();
  };

  const selectPattern = (patternId) => {
    selectedPatternId = patternId;
    const wasRunning = runState === "active" || runState === "paused";
    resetClock();
    if (wasRunning) runState = "active";
    renderStatics();
  };

  const currentCycleNumber = () => cycleIndex + 1;

  primaryBtn.addEventListener("click", () => {
    if (!descriptor) return;
    if (descriptor.kind === "pmr") {
      if (runState === "active") {
        runState = "paused";
        sendSessionEvent({ type: "paused", patternId: "pmr", cycle: 1 });
        renderStatics();
      } else if (runState === "paused") {
        runState = "active";
        sendSessionEvent({ type: "resumed", patternId: "pmr", cycle: 1 });
        renderStatics();
      } else if (runState === "complete") {
        dismissOverlay();
      } else if (runState === "countdown") {
        beginActiveRun();
      } else {
        startRun();
      }
      return;
    }
    const pattern = selectedPattern();
    if (!pattern) return;
    if (runState === "active") {
      runState = "paused";
      stopCuePlayback();
      sendSessionEvent({ type: "paused", patternId: pattern.id, cycle: currentCycleNumber() });
      renderStatics();
    } else if (runState === "paused") {
      runState = "active";
      sendSessionEvent({ type: "resumed", patternId: pattern.id, cycle: currentCycleNumber() });
      renderStatics();
    } else if (runState === "complete") {
      dismissOverlay();
    } else if (runState === "countdown") {
      beginActiveRun();
    } else {
      startRun();
    }
  });

  restartBtn.addEventListener("click", () => {
    if (!descriptor || runState === "idle") return;
    if (descriptor.kind === "breathing" && !selectedPattern()) return;
    startRun();
  });

  const renderAudioButton = () => {
    const available = Boolean(audioCues && audioCues.allowed && (audioCues.inhaleEl || audioCues.exhaleEl));
    audioBtn.style.display = available ? "" : "none";
    if (!available) return;
    const muted = !audioCues.enabled;
    audioBtn.innerHTML = muted ? volumeOffSvg : volumeOnSvg;
    audioBtn.setAttribute("aria-label", chromeText(muted ? "unmute" : "mute"));
    audioBtn.setAttribute("title", chromeText(muted ? "unmute" : "mute"));
    audioBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  };

  audioBtn.addEventListener("click", () => {
    if (!audioCues) return;
    audioCues.enabled = !audioCues.enabled;
    if (!audioCues.enabled) stopCuePlayback();
    renderAudioButton();
    sendSessionEvent({ type: "audioToggled", enabled: audioCues.enabled });
  });

  infoBtn.addEventListener("click", () => {
    if (!descriptor?.info) return;
    // The host opens the dedicated Info window in response.
    sendSessionEvent({ type: "infoOpened" });
  });

  const dismissOverlay = () => {
    sendSessionEvent({ type: "dismissed" });
  };

  closeBtn.addEventListener("click", dismissOverlay);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !descriptor) return;
    dismissOverlay();
  });

  // --- Descriptor intake ---------------------------------------------------

  const applyPayload = (payload) => {
    const next = payload && typeof payload === "object" ? payload.descriptor : null;
    if (payload && typeof payload === "object" && payload.chrome && typeof payload.chrome === "object") {
      chromeStrings = { ...chromeFallback, ...payload.chrome };
    }
    applyAudioPayload(payload && typeof payload === "object" ? payload.audio : null);
    const previous = descriptor;
    descriptor = next && typeof next === "object" ? next : null;
    if (!descriptor) {
      document.documentElement.dataset.sessionOpen = "false";
      runState = "idle";
      resetClock();
      stopFrameLoop();
      if (illustrationVisible) {
        illustrationVisible = false;
        illustrationWell.style.display = "none";
        currentIllustrationUrl = "";
        illustrationImg.removeAttribute("src");
      }
      if (cuesVisible) {
        cuesVisible = false;
        cuesRow.style.display = "none";
        lastRenderedCuesStep = null;
      }
      return;
    }
    document.documentElement.dataset.sessionOpen = "true";
    const kindChanged = previous && (previous.kind !== descriptor.kind || previous.practiceId !== descriptor.practiceId);
    const patternChanged = descriptor.kind === "breathing" && (selectedPatternId !== descriptor.patternId || !previous);
    selectedPatternId = descriptor.kind === "breathing" ? descriptor.patternId : null;
    if (!previous || kindChanged) {
      lastRenderedCuesStep = null;
      runState = "idle";
      resetClock();
      renderStatics();
      startFrameLoop();
      if (descriptor.autoStart) startRun();
    } else if (patternChanged) {
      selectPattern(descriptor.patternId);
    } else {
      renderStatics();
    }
  };

  ipcRenderer.on("openpets:session-overlay", (_event, payload) => applyPayload(payload));

  // Plugin-driven controls (pet menu commands relayed through the host).
  ipcRenderer.on("openpets:session-overlay-control", (_event, action) => {
    if (!descriptor) return;
    const isPmr = descriptor.kind === "pmr";
    const patternId = isPmr ? "pmr" : selectedPattern()?.id;
    if (!patternId) return;
    if (action === "pause" && runState === "active") {
      runState = "paused";
      stopCuePlayback();
      sendSessionEvent({ type: "paused", patternId, cycle: isPmr ? 1 : currentCycleNumber() });
      renderStatics();
    } else if (action === "resume" && runState === "paused") {
      runState = "active";
      sendSessionEvent({ type: "resumed", patternId, cycle: isPmr ? 1 : currentCycleNumber() });
      renderStatics();
    } else if (action === "stop" && (runState === "active" || runState === "paused")) {
      stopCuePlayback();
      sendSessionEvent({ type: "stopped", patternId, cycle: isPmr ? 1 : currentCycleNumber() });
      runState = "idle";
      resetClock();
      renderStatics();
    }
  });

  ipcRenderer
    .invoke("openpets:session-overlay-get")
    .then((existing) => {
      if (existing && !descriptor) applyPayload(existing);
    })
    .catch(() => {});
};

const installMouseInterop = () => {
  lastInteractiveHit = null;
  dragging = false;

  const usesNativePetDrag = () => document.documentElement?.dataset?.nativePetDrag === "wayland";

  document.addEventListener("click", (event) => {
    if (handleBubbleInteraction(event)) return;
    dismissBubble(event);
  });
  installPetSenses();
  installDefaultPetChat();
  installDefaultPetManagerCheckIn();
  installDefaultPetSession();
  if (usesNativePetDrag()) installLayerShellContextMenu();

  let dragStartPoint = null;

  document.addEventListener("mousemove", (event) => {
    updateInteractiveHit(event);
    if (dragging && !usesNativePetDrag()) ipcRenderer.send("openpets:pet-drag-move", { screenX: event.screenX, screenY: event.screenY });
  }, { passive: true });

  document.addEventListener("mousedown", (event) => {
    const target = event.target instanceof Element ? event.target : getInteractiveTarget(event);
    setInteractiveHit(Boolean(getInteractiveTarget(event)));
    if (event.button !== 0 || !target) return;
    if (isInteractivePanelOrBubble(target)) return;
    if (!target.closest(".pet-hitbox, .pet-shell")) return;
    if (usesNativePetDrag()) {
      dragging = true;
      dragStartPoint = { screenX: event.screenX, screenY: event.screenY };
      ipcRenderer.send("openpets:pet-drag-start", { screenX: event.screenX, screenY: event.screenY });
      return;
    }
    event.preventDefault();
    dragging = true;
    dragStartPoint = { screenX: event.screenX, screenY: event.screenY };
    setInteractiveHit(true);
    ipcRenderer.send("openpets:pet-drag-start", { screenX: event.screenX, screenY: event.screenY });
  });

  document.addEventListener("mouseup", (event) => {
    if (!dragging) return;
    dragging = false;
    if (dragStartPoint && Math.hypot(event.screenX - dragStartPoint.screenX, event.screenY - dragStartPoint.screenY) > 4) {
      suppressClickUntil = Date.now() + 300;
    }
    dragStartPoint = null;
    ipcRenderer.send("openpets:pet-drag-end");
  });

  document.addEventListener("mouseleave", () => {
    if (!dragging) setInteractiveHit(false);
  }, { passive: true });

  setInteractiveHit(false, "ready");
  ipcRenderer.send("openpets:pet-ready");
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installMouseInterop, { once: true });
} else {
  installMouseInterop();
}
