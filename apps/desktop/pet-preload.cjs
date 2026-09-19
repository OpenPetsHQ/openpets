const { ipcRenderer } = require("electron");

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
  const isEnded = !snapshot || snapshot.status === "idle" || snapshot.status === "ended" || !snapshot.status;
  const canSubmit = !isEnded && snapshot.canSubmitRecording === true;

  if (!isEnded) {
    if (canSubmit) {
      talkBtn.classList.remove("is-processing");
      talkBtn.classList.add("is-active");
      talkBtn.disabled = false;
      if (typeof talkBtn.removeAttribute === "function") {
        talkBtn.removeAttribute("disabled");
        talkBtn.removeAttribute("aria-disabled");
      }
      talkBtn.setAttribute("aria-label", "Stop recording and send");
      talkBtn.setAttribute("title", "Stop recording and send");
    } else {
      talkBtn.classList.remove("is-active");
      talkBtn.classList.add("is-processing");
      talkBtn.disabled = true;
      talkBtn.setAttribute("disabled", "true");
      talkBtn.setAttribute("aria-disabled", "true");
      const label = snapshot.activity === "speaking"
        ? "Speaking..."
        : snapshot.activity === "thinking"
          ? "Thinking..."
          : snapshot.activity === "acting"
            ? "Acting..."
            : "Processing...";
      talkBtn.setAttribute("aria-label", label);
      talkBtn.setAttribute("title", label);
    }
  } else {
    talkBtn.classList.remove("is-active");
    talkBtn.classList.remove("is-processing");
    talkBtn.disabled = false;
    if (typeof talkBtn.removeAttribute === "function") {
      talkBtn.removeAttribute("disabled");
      talkBtn.removeAttribute("aria-disabled");
    }
    talkBtn.setAttribute("aria-label", "Talk to companion");
    talkBtn.setAttribute("title", "Talk to companion");
  }
};

const isInteractivePanelOrBubble = (target) => {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(".openpets-chat-panel, .openpets-compact-composer, [data-openpets-companion-launcher], .openpets-pet-buttons, .bubble, .openpets-context-menu"));
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
  const stillInteractive = Boolean(newTarget && newTarget.closest(".pet-hitbox, .pet-shell, .bubble, [data-openpets-companion-launcher], .openpets-pet-buttons")) || dragging;
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
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  } else {
    apply();
  }
});

const assistantHeaderFallback = "Assistant";

function usablePetDisplayName(value, fallback = assistantHeaderFallback) {
  if (typeof value !== "string") return fallback;
  const name = value.trim();
  return name.length > 0 ? name : fallback;
}

function updateAssistantHeader(displayName, assetName) {
  const header = document.querySelector(".chat-title");
  if (!header) return;
  const fallback = usablePetDisplayName(assetName ?? document.documentElement.dataset.petAssetName, assistantHeaderFallback);
  header.textContent = usablePetDisplayName(displayName ?? document.documentElement.dataset.petDisplayName, fallback);
}

const getInteractiveTarget = (event) => {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  return target && target.closest(".pet-hitbox, .pet-shell, .bubble, .openpets-compact-composer, .openpets-chat-panel, [data-openpets-companion-launcher], .openpets-pet-buttons, .openpets-context-menu");
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
  reportInteractiveHit(Boolean(target && target.closest(".pet-hitbox, .pet-shell, .bubble, .openpets-compact-composer, .openpets-chat-panel, [data-openpets-companion-launcher], .openpets-pet-buttons, .openpets-context-menu")) || dragging, typeof point.reason === "string" ? point.reason.slice(0, 80) : "probe", true);
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

const escapeHtml = (value) => {
  if (typeof value !== "string") return "";
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const renderMarkdown = (text) => {
  if (!text) return "";
  let safe = escapeHtml(text);
  // Code blocks: ```lang ... ```
  safe = safe.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre class="chat-code-block"><code>${code.trim()}</code></pre>`;
  });
  // Inline code: `code`
  safe = safe.replace(/`([^`]+)`/g, '<code class="chat-code-inline">$1</code>');
  // Bold: **text**
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *text*
  safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Lists: lines starting with "- " or "* "
  const lines = safe.split("\n");
  let inList = false;
  const processedLines = [];
  for (const line of lines) {
    const listMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (listMatch) {
      if (!inList) {
        processedLines.push("<ul>");
        inList = true;
      }
      processedLines.push(`<li>${listMatch[2]}</li>`);
    } else {
      if (inList) {
        processedLines.push("</ul>");
        inList = false;
      }
      processedLines.push(line);
    }
  }
  if (inList) processedLines.push("</ul>");
  return processedLines.join("\n").replace(/(?<!<\/pre>|<\/ul>|<\/li>)\n/g, "<br>");
};

const defaultPromptSuggestions = [
  "What can you do?",
  "Check system status",
  "Summarize activity",
];

const installDefaultPetChat = () => {
  if (document.documentElement?.dataset?.petRole !== "default") return;

  let isExpanded = false;
  let isCompactOpen = false;
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
  let promptSuggestions = [...defaultPromptSuggestions];
  let preservedDraft = "";
  let errorToastMessage = null;
  let errorToastTimer = null;
  let userScrolledUp = false;

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

  const compactHistoryBtn = document.createElement("button");
  compactHistoryBtn.type = "button";
  compactHistoryBtn.className = "compact-composer-btn is-history";
  compactHistoryBtn.dataset.chatHistoryBtn = "true";
  compactHistoryBtn.setAttribute("aria-label", "View conversation history");
  compactHistoryBtn.setAttribute("title", "Conversation history / full panel");
  compactHistoryBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>';

  const compactCloseBtn = document.createElement("button");
  compactCloseBtn.type = "button";
  compactCloseBtn.className = "compact-composer-btn is-close";
  compactCloseBtn.dataset.chatComposerCloseBtn = "true";
  compactCloseBtn.setAttribute("aria-label", "Close composer");
  compactCloseBtn.setAttribute("title", "Close (Esc)");
  compactCloseBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  compactActions.appendChild(compactHistoryBtn);
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
  const initialFallback = usablePetDisplayName(document.documentElement.dataset.petAssetName, assistantHeaderFallback);
  title.textContent = usablePetDisplayName(document.documentElement.dataset.petDisplayName, initialFallback);
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
      if (!isExpanded) return;
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
    if (isCompactOpen === nextOpen) return;
    isCompactOpen = nextOpen;
    document.documentElement.dataset.compactComposerOpen = isCompactOpen ? "true" : "false";
    if (isCompactOpen) {
      compactInput.value = preservedDraft;
      autoResizeCompactInput();
      updateCompactSendButtonState();
      setTimeout(() => compactInput.focus(), 30);
    }
    ipcRenderer.send(isCompactOpen ? "openpets:default-pet-chat-compact-open" : "openpets:default-pet-chat-compact-close");
  };

  const applyConversationSnapshot = (snapshot) => {
    if (!snapshot || typeof snapshot.lastSequence !== "number" || typeof snapshot.revision !== "number") return false;
    const order = { sequence: snapshot.lastSequence, revision: snapshot.revision };
    if (order.sequence < conversationOrder.sequence || (order.sequence === conversationOrder.sequence && order.revision <= conversationOrder.revision)) return false;
    conversationOrder = order;
    conversationSnapshot = snapshot;
    if (Array.isArray(snapshot.promptSuggestions)) promptSuggestions = snapshot.promptSuggestions;
    renderAll();
    return true;
  };

  const applyVoiceSnapshot = (snapshot, sequence = 0) => {
    if (!snapshot || typeof snapshot.sessionId !== "number" || typeof snapshot.status !== "string" || typeof snapshot.muted !== "boolean") return false;
    const order = { sessionId: snapshot.sessionId, sequence };
    if (order.sessionId < voiceOrder.sessionId || (order.sessionId === voiceOrder.sessionId && order.sequence <= voiceOrder.sequence)) return false;
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
    if (isIdle && promptSuggestions && promptSuggestions.length > 0) {
      suggestions.style.display = "flex";
      suggestions.innerHTML = promptSuggestions.slice(0, 3).map((suggestion) => `
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
    preservedDraft = text;
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
    preservedDraft = "";
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
    preservedDraft = "";
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
    preservedDraft = compactInput.value;
    input.value = preservedDraft;
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

  compactHistoryBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    preservedDraft = compactInput.value;
    setCompactOpen(false);
    ipcRenderer.send("openpets:default-pet-chat-expand");
  });

  compactCloseBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    preservedDraft = compactInput.value;
    setCompactOpen(false);
  });

  // --- Panel Form Listeners ---
  input.addEventListener("input", () => {
    preservedDraft = input.value;
    compactInput.value = preservedDraft;
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
      preservedDraft = input.value;
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
    if (voiceSnapshot.status === "idle" || voiceSnapshot.status === "ended") {
      ipcRenderer.invoke("openpets:default-pet-chat-voice-start").catch((err) => {
        showErrorToast(err && err.message ? err.message : "Failed to start voice");
      });
    } else if (voiceSnapshot.status === "paused") {
      ipcRenderer.invoke("openpets:default-pet-chat-voice-retry").catch(() => {});
    } else if (voiceSnapshot.muted) {
      ipcRenderer.invoke("openpets:default-pet-chat-voice-unmute").catch(() => {});
    } else {
      ipcRenderer.invoke("openpets:default-pet-chat-voice-mute").catch(() => {});
    }
  });

  closeBtn.addEventListener("click", () => {
    preservedDraft = input.value;
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
    if (
      talkButton.disabled ||
      (typeof talkButton.hasAttribute === "function" && talkButton.hasAttribute("disabled")) ||
      talkButton.getAttribute("aria-disabled") === "true" ||
      (talkButton.classList && talkButton.classList.contains("is-processing"))
    ) {
      return;
    }
    ipcRenderer.invoke("openpets:default-pet-chat-voice-toggle").catch(() => {});
  }, true);

  // --- Launcher Button Click ---
  document.addEventListener("click", (event) => {
    const launcher = event.target?.closest?.("[data-openpets-companion-launcher]");
    if (!launcher) return;
    event.preventDefault();
    event.stopPropagation();
    if (isExpanded) {
      preservedDraft = input.value;
      ipcRenderer.send("openpets:default-pet-chat-collapse");
    } else {
      setCompactOpen(!isCompactOpen);
    }
  });

  // --- Global Escape Key ---
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (isExpanded) {
        preservedDraft = input.value;
        ipcRenderer.send("openpets:default-pet-chat-collapse");
      } else if (isCompactOpen) {
        setCompactOpen(false);
      }
    }
  });

  // --- Expansion Changed Listener ---
  ipcRenderer.on("openpets:default-pet-chat-expansion-changed", (_event, expanded) => {
    const wasExpanded = isExpanded;
    isExpanded = Boolean(expanded);
    document.documentElement.dataset.chatExpanded = isExpanded ? "true" : "false";
    if (isExpanded) {
      setCompactOpen(false);
      input.value = preservedDraft;
      compactInput.value = preservedDraft;
      autoResizeInput();
      autoResizeCompactInput();
      renderAll();
      setTimeout(() => input.focus(), 60);
      if (panelEl && typeof panelEl.offsetHeight === "number" && panelEl.offsetHeight > 0) {
        ipcRenderer.send("openpets:default-pet-chat-panel-resize", Math.round(panelEl.offsetHeight));
      }
    } else {
      if (wasExpanded && input) {
        preservedDraft = input.value;
      }
      renderAll();
    }
  });

  ipcRenderer.on("openpets:default-pet-chat-compact-changed", (_event, open) => {
    const nextOpen = Boolean(open);
    if (isCompactOpen === nextOpen) return;
    isCompactOpen = nextOpen;
    document.documentElement.dataset.compactComposerOpen = nextOpen ? "true" : "false";
    if (nextOpen) {
      compactInput.value = preservedDraft;
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

  ipcRenderer.invoke("openpets:default-pet-chat-is-compact-open").then((open) => {
    if (typeof open === "boolean") {
      isCompactOpen = open;
      document.documentElement.dataset.compactComposerOpen = open ? "true" : "false";
      if (open) {
        compactInput.value = preservedDraft;
        autoResizeCompactInput();
        updateCompactSendButtonState();
      }
    }
  }).catch(() => {});

  ipcRenderer.invoke("openpets:default-pet-chat-is-expanded").then((expanded) => {
    if (typeof expanded === "boolean") {
      isExpanded = expanded;
      document.documentElement.dataset.chatExpanded = isExpanded ? "true" : "false";
      if (isExpanded) {
        input.value = preservedDraft;
        compactInput.value = preservedDraft;
        autoResizeInput();
        autoResizeCompactInput();
        renderAll();
      }
    }
  }).catch(() => {});

  renderAll();
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
