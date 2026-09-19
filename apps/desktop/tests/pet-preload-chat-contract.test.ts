import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const candidateRoots = [
  process.env.OPENPETS_DESKTOP_ROOT,
  new URL("..", import.meta.url).pathname,
  new URL("../..", import.meta.url).pathname,
].filter(Boolean) as string[];
let desktopRoot = candidateRoots[0];
for (const cand of candidateRoots) {
  try {
    if (existsSync(join(cand, "pet-preload.cjs"))) {
      desktopRoot = cand;
      break;
    }
  } catch {}
}

const source = readFileSync(join(desktopRoot, "pet-preload.cjs"), "utf8");

const listeners = new Map<string, Function>();
const sent: Array<{ channel: string; args: unknown[] }> = [];
const invoked: Array<{ channel: string; args: unknown[] }> = [];
let resolveInitialConversation!: (snapshot: unknown) => void;
let resolveInitialVoice!: (snapshot: unknown) => void;
const initialConversation = new Promise((resolve) => { resolveInitialConversation = resolve; });
const initialVoice = new Promise((resolve) => { resolveInitialVoice = resolve; });

const ipcRenderer = {
  invoke: async (channel: string, ...args: unknown[]) => {
    invoked.push({ channel, args });
    if (channel === "openpets:default-pet-chat-get-snapshot") {
      return initialConversation;
    }
    if (channel === "openpets:default-pet-chat-get-voice-snapshot") {
      return initialVoice;
    }
    if (channel === "openpets:default-pet-chat-is-expanded") {
      return false;
    }
    return undefined;
  },
  on: (channel: string, listener: Function) => {
    listeners.set(channel, listener);
  },
  off: (channel: string, listener: Function) => {
    if (listeners.get(channel) === listener) listeners.delete(channel);
  },
  removeListener: (channel: string, listener: Function) => {
    if (listeners.get(channel) === listener) listeners.delete(channel);
  },
  send: (channel: string, ...args: unknown[]) => {
    sent.push({ channel, args });
  },
};

const toCamelCase = (str: string) => str.replace(/-([a-z])/g, (_, l) => l.toUpperCase());

class MockElement {
  tagName: string;
  className = "";
  private _innerHTML = "";
  get innerHTML(): string {
    return this._innerHTML;
  }
  set innerHTML(val: string) {
    this._innerHTML = val;
  }
  textContent = "";
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  style: Record<string, string> = {};
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  eventListeners = new Map<string, Function[]>();
  value = "";
  scrollTop = 0;
  scrollHeight = 100;
  clientHeight = 100;
  disabled = false;
  placeholder = "";

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get classList() {
    return {
      contains: (cls: string) => this.className.split(/\s+/).includes(cls),
      add: (cls: string) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        set.add(cls);
        this.className = [...set].join(" ");
      },
      remove: (cls: string) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        set.delete(cls);
        this.className = [...set].join(" ");
      },
    };
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name.startsWith("data-")) {
      const camelKey = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      this.dataset[camelKey] = value;
    }
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name.startsWith("data-")) {
      const camelKey = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      delete this.dataset[camelKey];
      delete this.dataset[name];
    }
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  replaceWith(newElement: MockElement) {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        newElement.parentElement = this.parentElement;
        this.parentElement.children[idx] = newElement;
      }
      this.parentElement = null;
    }
  }

  contains(child: MockElement | null): boolean {
    if (!child) return false;
    if (child === this) return true;
    for (const c of this.children) {
      if (c.contains(child)) return true;
    }
    return false;
  }

  insertAdjacentHTML(position: string, _html: string) {
    const el = new MockElement("div");
    el.className = "stage";
    if (position === "afterbegin") {
      el.parentElement = this;
      this.children.unshift(el);
    }
  }

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const match = (el: MockElement): boolean => {
      if (selector.startsWith(".")) {
        return el.classList.contains(selector.slice(1));
      }
      if (selector.startsWith("[") && selector.endsWith("]")) {
        const attr = selector.slice(1, -1);
        if (attr.includes("=")) {
          const [name, val] = attr.split("=");
          const unquoted = val.replace(/^["']|["']$/g, "");
          const camelKey = toCamelCase(name.startsWith("data-") ? name.slice(5) : name);
          return el.getAttribute(name) === unquoted || el.dataset[camelKey] === unquoted || el.dataset[name] === unquoted;
        }
        const camelKey = toCamelCase(attr.startsWith("data-") ? attr.slice(5) : attr);
        return el.attributes.has(attr) || camelKey in el.dataset || attr in el.dataset;
      }
      return el.tagName.toLowerCase() === selector.toLowerCase();
    };

    const walk = (node: MockElement) => {
      if (match(node)) results.push(node);
      for (const child of node.children) {
        walk(child);
      }
    };

    for (const child of this.children) {
      walk(child);
    }
    return results;
  }

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    const selectors = selector.split(",").map((s) => s.trim());
    while (curr) {
      for (const sel of selectors) {
        if (sel.startsWith(".") && curr.classList.contains(sel.slice(1))) return curr;
        if (sel.startsWith("[") && sel.endsWith("]")) {
          const attr = sel.slice(1, -1);
          if (attr.includes("=")) {
            const [name, val] = attr.split("=");
            const unquoted = val.replace(/^["']|["']$/g, "");
            const camelKey = toCamelCase(name.startsWith("data-") ? name.slice(5) : name);
            if (curr.getAttribute(name) === unquoted || curr.dataset[camelKey] === unquoted || curr.dataset[name] === unquoted) return curr;
          } else {
            const camelKey = toCamelCase(attr.startsWith("data-") ? attr.slice(5) : attr);
            if (curr.attributes.has(attr) || camelKey in curr.dataset || attr in curr.dataset) return curr;
          }
        }
        if (curr.tagName.toLowerCase() === sel.toLowerCase()) return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  addEventListener(type: string, listener: Function) {
    const list = this.eventListeners.get(type) ?? [];
    list.push(listener);
    this.eventListeners.set(type, list);
  }

  dispatchEvent(event: { type: string; target?: MockElement; defaultPrevented?: boolean; preventDefault?: () => void; stopPropagation?: () => void; screenX?: number; screenY?: number; clientX?: number; clientY?: number; button?: number; key?: string; shiftKey?: boolean; isComposing?: boolean }) {
    if (!event.target) event.target = this;
    const list = this.eventListeners.get(event.type) ?? [];
    for (const listener of list) {
      listener(event);
    }
    if (this.parentElement) {
      this.parentElement.dispatchEvent(event);
    }
  }

  focus() {}
}

const documentListeners = new Map<string, Function[]>();
const documentElement = new MockElement("html");
documentElement.dataset.petRole = "default";
documentElement.dataset.petDisplayName = "Hoodie Cat";
const body = new MockElement("body");
const initialStage = new MockElement("div");
initialStage.className = "stage";
const petHitbox = new MockElement("div");
petHitbox.className = "pet-hitbox";
const launcher = new MockElement("button");
launcher.className = "openpets-companion-launcher";
launcher.setAttribute("data-openpets-companion-launcher", "true");
const talkButton = new MockElement("button");
talkButton.className = "openpets-companion-launcher openpets-talk-button";
talkButton.setAttribute("data-openpets-talk-button", "true");
talkButton.setAttribute("aria-label", "Talk to companion");
talkButton.setAttribute("title", "Talk to companion");
const petShell = new MockElement("div");
petShell.className = "pet-shell";
const sprite = new MockElement("div");
sprite.className = "sprite";
petShell.appendChild(sprite);
petHitbox.appendChild(launcher);
petHitbox.appendChild(talkButton);
petHitbox.appendChild(petShell);
initialStage.appendChild(petHitbox);
body.appendChild(initialStage);
documentElement.appendChild(body);

class MockTemplateElement extends MockElement {
  content = {
    firstElementChild: null as MockElement | null,
  };
  set innerHTML(val: string) {
    const newStage = new MockElement("div");
    newStage.className = val.includes("has-bubble") ? "stage has-bubble" : "stage";
    if (val.includes("bubble")) {
      const bubbleEl = new MockElement("div");
      bubbleEl.className = "bubble is-message-only";
      newStage.appendChild(bubbleEl);
    }
    const newHitbox = new MockElement("div");
    newHitbox.className = "pet-hitbox";
    if (val.includes("openpets-companion-launcher") && !val.includes("bubble")) {
      const newLauncher = new MockElement("button");
      newLauncher.className = "openpets-companion-launcher";
      newLauncher.setAttribute("data-openpets-companion-launcher", "true");
      newHitbox.appendChild(newLauncher);
    }
    if (val.includes("openpets-talk-button") && !val.includes("bubble")) {
      const newTalk = new MockElement("button");
      newTalk.className = val.includes("is-active")
        ? "openpets-companion-launcher openpets-talk-button is-active"
        : val.includes("is-processing")
          ? "openpets-companion-launcher openpets-talk-button is-processing"
          : "openpets-companion-launcher openpets-talk-button";
      newTalk.setAttribute("data-openpets-talk-button", "true");
      if (val.includes("is-processing") || val.includes("disabled")) {
        newTalk.disabled = true;
        newTalk.setAttribute("disabled", "true");
        newTalk.setAttribute("aria-disabled", "true");
        newTalk.setAttribute("aria-label", "Processing...");
        newTalk.setAttribute("title", "Processing...");
      } else if (val.includes("is-active")) {
        newTalk.setAttribute("aria-label", "Stop recording and send");
        newTalk.setAttribute("title", "Stop recording and send");
      } else {
        newTalk.setAttribute("aria-label", "Talk to companion");
        newTalk.setAttribute("title", "Talk to companion");
      }
      newHitbox.appendChild(newTalk);
    }
    const newShell = new MockElement("div");
    newShell.className = "pet-shell";
    newHitbox.appendChild(newShell);
    newStage.appendChild(newHitbox);
    this.content.firstElementChild = newStage;
  }
}

const mockDocument = {
  readyState: "complete",
  documentElement,
  body,
  createElement: (tag: string) => {
    if (tag.toLowerCase() === "template") return new MockTemplateElement(tag);
    return new MockElement(tag);
  },
  getElementById: (_id: string) => null,
  querySelector: (sel: string) => documentElement.querySelector(sel),
  querySelectorAll: (sel: string) => documentElement.querySelectorAll(sel),
  elementFromPoint: (_x: number, _y: number) => null,
  addEventListener: (type: string, listener: Function) => {
    const list = documentListeners.get(type) ?? [];
    list.push(listener);
    documentListeners.set(type, list);
  },
};

const mockWindow = {
  document: mockDocument,
  addEventListener: () => {},
};

runInNewContext(source, {
  require: (mod: string) => {
    if (mod === "electron") return { ipcRenderer };
    throw new Error(`Cannot load ${mod}`);
  },
  document: mockDocument,
  window: mockWindow,
  Element: MockElement,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Date,
  Math,
  String,
  Number,
  Boolean,
  Array,
  Object,
  Set,
  Map,
});

// 1. Verify IPC listeners were registered
assert.ok(listeners.has("openpets:default-pet-chat-expansion-changed"));
assert.ok(listeners.has("openpets:default-pet-chat-event"));
assert.ok(listeners.has("openpets:default-pet-chat-voice-event"));
assert.ok(listeners.has("openpets:pet-content-state"));
assert.ok(listeners.has("openpets:pet-gaze"));
const gazeListener = listeners.get("openpets:pet-gaze")!;
assert.equal(documentElement.dataset.codexGazeIndex, undefined);
gazeListener!({}, { index: 4 });
assert.equal(documentElement.dataset.codexGazeIndex, "4", "valid gaze payload updates only the gaze data attribute");
gazeListener!({}, { index: 16 });
assert.equal(documentElement.dataset.codexGazeIndex, "4", "out-of-range gaze payload is ignored");
gazeListener!({}, { index: 4, extra: true });
assert.equal(documentElement.dataset.codexGazeIndex, "4", "extra gaze payload fields are ignored");
gazeListener!({}, { index: null });
assert.equal(documentElement.dataset.codexGazeIndex, "neutral", "null gaze payload restores the neutral frame");

// Verify both compact composer and full chat panel exist in DOM
const compactComposer = documentElement.querySelector(".openpets-compact-composer");
assert.ok(compactComposer, "Compact composer must be present in DOM");
assert.ok(body.contains(compactComposer), "Compact composer must be attached to body");

const fullPanel = documentElement.querySelector(".openpets-chat-panel");
assert.ok(fullPanel, "Full chat panel must be present in DOM");
assert.ok(body.contains(fullPanel), "Full chat panel must be attached to body");
const chatTitle = fullPanel!.querySelector(".chat-title") as MockElement;
assert.ok(chatTitle, "Chat title must exist");
assert.equal(chatTitle.textContent, "Hoodie Cat", "Chat header must use the active pet display name");
const headerContentStateListener = listeners.get("openpets:pet-content-state");
assert.ok(headerContentStateListener);
const headerRefreshBody = '<div class="stage"><button class="openpets-companion-launcher" data-openpets-companion-launcher="true"></button><button class="openpets-talk-button" data-openpets-talk-button="true"></button></div>';
headerContentStateListener!({}, { bodyHtml: headerRefreshBody, displayName: "Calico", reactionState: "idle" });
assert.equal(chatTitle.textContent, "Calico", "Chat header must react to an updated pet display name");
headerContentStateListener!({}, { bodyHtml: headerRefreshBody, displayName: "   ", reactionState: "idle" });
assert.equal(chatTitle.textContent, "Assistant", "Chat header must fall back when the pet display name is unusable");
headerContentStateListener!({}, { bodyHtml: headerRefreshBody, displayName: "   ", assetName: "Hoodie Cat", reactionState: "idle" });
assert.equal(chatTitle.textContent, "Hoodie Cat", "Chat header must fall back to asset name when personal display name is unusable");
headerContentStateListener!({}, { bodyHtml: headerRefreshBody, displayName: "   ", assetName: "   ", reactionState: "idle" });
assert.equal(chatTitle.textContent, "Assistant", "Chat header must fall back to Assistant when neither display name nor asset name is usable");
const voiceBtnLabel = fullPanel!.querySelector("[data-voice-btn-label]") as MockElement;
assert.ok(voiceBtnLabel, "Talk button label must exist");

const compactInput = compactComposer!.querySelector("[data-compact-chat-input]") as MockElement;
assert.ok(compactInput, "Compact chat input must exist");
assert.equal(compactInput.placeholder, "Message your pet…", "Compact composer placeholder must be concise and natural");

const fullInput = fullPanel!.querySelector("[data-chat-input]") as MockElement;
assert.ok(fullInput, "Full chat input must exist");
assert.equal(fullInput.placeholder, "Message your pet…", "Full panel placeholder must match the compact composer");

const historyBtn = compactComposer!.querySelector("[data-chat-history-btn]") as MockElement;
assert.ok(historyBtn, "Explicit history/transcript affordance button must exist in compact composer");

const compactCloseBtn = compactComposer!.querySelector("[data-chat-composer-close-btn]") as MockElement;
assert.ok(compactCloseBtn, "Compact composer close button must exist");

// Visual-contract: unified flex alignment, geometry, and visual centerline between inputs and send buttons
const compactForm = compactComposer!.querySelector("[data-compact-chat-form]") as MockElement;
const compactSendBtn = compactComposer!.querySelector("[data-compact-chat-send-btn]") as MockElement;
const fullComposer = fullPanel!.querySelector("[data-chat-composer]") as MockElement;
const fullSendBtn = fullPanel!.querySelector("[data-chat-send-btn]") as MockElement;
const inputWrapper = fullPanel!.querySelector(".chat-input-wrapper") as MockElement;

assert.ok(compactForm, "Compact composer form must exist");
assert.ok(compactSendBtn, "Compact composer send button must exist");
assert.ok(fullComposer, "Full chat composer form must exist");
assert.ok(fullSendBtn, "Full chat send button must exist");
assert.ok(inputWrapper, "Full chat input wrapper must exist");

// Flex containers share bottom alignment for consistent multi-line behavior
assert.equal(fullComposer.style.display, "flex", "Full composer must use flex display");
assert.equal(fullComposer.style.alignItems, "flex-end", "Full composer must align items to flex-end");
assert.equal(compactForm.style.display, "flex", "Compact composer must use flex display");
assert.equal(compactForm.style.alignItems, "flex-end", "Compact composer must align items to flex-end");

// Input wrapper in full composer eliminates inline-block baseline gap / descent
assert.equal(inputWrapper.style.display, "flex", "Input wrapper must be a flex container to eliminate baseline gap");
assert.equal(inputWrapper.style.alignItems, "flex-end", "Input wrapper must align items to flex-end");
assert.equal(inputWrapper.style.lineHeight, "0", "Input wrapper must zero out line-height strut");

// Inputs share block layout and border-box sizing
assert.equal(fullInput.style.display, "block", "Full input must be display block");
assert.equal(fullInput.style.boxSizing, "border-box", "Full input must use border-box");
assert.equal(compactInput.style.display, "block", "Compact input must be display block");
assert.equal(compactInput.style.boxSizing, "border-box", "Compact input must use border-box");

// Send buttons share zero padding/margin, flex centering, and exact heights
assert.equal(fullSendBtn.style.padding, "0", "Full send button must zero padding");
assert.equal(fullSendBtn.style.margin, "0", "Full send button must zero margin");
assert.equal(fullSendBtn.style.boxSizing, "border-box", "Full send button must use border-box");
assert.equal(compactSendBtn.style.padding, "0", "Compact send button must zero padding");
assert.equal(compactSendBtn.style.margin, "0", "Compact send button must zero margin");
assert.equal(compactSendBtn.style.boxSizing, "border-box", "Compact send button must use border-box");

// Exact visual centerline match in resting / disabled single-line state
assert.equal(fullInput.style.height, "36px", "Full input single-line height must be 36px");
assert.equal(fullSendBtn.style.height, "36px", "Full send button height must be 36px");
assert.equal(fullSendBtn.disabled, true, "Full send button must be initially disabled when input is empty");
const fullCenterlineOffset = Math.abs(parseInt(fullInput.style.height, 10) / 2 - parseInt(fullSendBtn.style.height, 10) / 2);
assert.equal(fullCenterlineOffset, 0, "Full input and send button must share an exact visual centerline (0px offset)");

assert.equal(compactInput.style.height, "28px", "Compact input single-line height must be 28px");
assert.equal(compactSendBtn.style.height, "28px", "Compact send button height must be 28px");
assert.equal(compactSendBtn.disabled, true, "Compact send button must be initially disabled when input is empty");
const compactCenterlineOffset = Math.abs(parseInt(compactInput.style.height, 10) / 2 - parseInt(compactSendBtn.style.height, 10) / 2);
assert.equal(compactCenterlineOffset, 0, "Compact input and send button must share an exact visual centerline (0px offset)");

// 2. Test opening compact composer via launcher button click
const clickListeners = documentListeners.get("click") ?? [];
const currentLauncher = documentElement.querySelector("[data-openpets-companion-launcher]")!;
assert.ok(currentLauncher);

sent.length = 0;
for (const l of clickListeners) {
  l({ button: 0, target: currentLauncher, preventDefault: () => {}, stopPropagation: () => {} });
}
// Launcher toggles compact composer, does NOT auto-expand full panel
assert.equal(documentElement.dataset.compactComposerOpen, "true", "Launcher click must open compact composer");
assert.notEqual(documentElement.dataset.chatExpanded, "true", "Launcher click must NOT auto-expand full panel");

// 3. Test typing draft in compact composer & draft synchronization
compactInput.value = "Draft message from compact composer";
compactInput.dispatchEvent({ type: "input" });
assert.equal(fullInput.value, "Draft message from compact composer", "Draft must synchronize to full panel composer");

// 4. Test explicit history trigger from compact composer to expand full panel
sent.length = 0;
historyBtn.dispatchEvent({ type: "click", button: 0, preventDefault: () => {}, stopPropagation: () => {} });
const expandSent = sent.find((s) => s.channel === "openpets:default-pet-chat-expand");
assert.ok(expandSent, "Clicking history affordance must send default-pet-chat-expand to host");
assert.equal(documentElement.dataset.compactComposerOpen, "false", "Opening full panel closes compact composer");

// Simulate host expanding window
const expansionListener = listeners.get("openpets:default-pet-chat-expansion-changed");
assert.ok(expansionListener);
expansionListener!({}, true);
assert.equal(documentElement.dataset.chatExpanded, "true", "Chat expanded state must be true");
assert.equal(fullInput.value, "Draft message from compact composer", "Full panel must retain preserved draft");

// 5. Test Escape key collapses full chat panel
const keydownListeners = documentListeners.get("keydown") ?? [];
sent.length = 0;
for (const l of keydownListeners) {
  l({ key: "Escape", preventDefault: () => {} });
}
const collapseSent = sent.find((s) => s.channel === "openpets:default-pet-chat-collapse");
assert.ok(collapseSent, "Escape key in expanded view must trigger collapse");

expansionListener!({}, false);
assert.equal(documentElement.dataset.chatExpanded, "false");

// 6. Test snapshot event updates in transcript
const eventListener = listeners.get("openpets:default-pet-chat-event");
assert.ok(eventListener);

eventListener!({}, {
  type: "snapshot",
  snapshot: {
    conversationId: "pet-assistant",
    items: [
      { kind: "message", id: "m1", turnId: "t1", role: "user", source: "typed", text: "Hello pet!" },
      { kind: "message", id: "m2", turnId: "t1", role: "assistant", source: "typed", text: "Hello human!" },
    ],
    activity: "idle",
    lastSequence: 1,
    revision: 1,
    promptSuggestions: ["How are you?"],
  },
});

// A streamed Talk snapshot is authoritative even when the initial invoke is
// still pending. The late initial response must not roll the renderer back.
const voiceEventListener = listeners.get("openpets:default-pet-chat-voice-event");
assert.ok(voiceEventListener);
voiceEventListener!({}, {
  type: "snapshot",
  sequence: 1,
  snapshot: {
    sessionId: 1,
    status: "active",
    activity: "listening",
    muted: false,
    conversationId: "pet-assistant",
    generation: 1,
    turnId: "voice-turn-1",
    userTranscript: null,
    assistantTranscript: null,
    interruptionCount: 0,
    error: null,
    shortcut: null,
    shortcutStatus: "registered",
    shortcutReason: null,
  },
});
assert.equal(voiceBtnLabel.textContent, "Listening", "authoritative active Talk snapshot should label listening activity");
const onPetTalkBtn = documentElement.querySelector("[data-openpets-talk-button]");
assert.ok(onPetTalkBtn, "on-pet talk button must exist");
assert.ok(onPetTalkBtn!.classList.contains("is-processing"), "processing talk button without canSubmitRecording has is-processing class");
assert.ok(!onPetTalkBtn!.classList.contains("is-active"), "processing talk button without canSubmitRecording must not have is-active class");
assert.equal(onPetTalkBtn!.disabled, true, "processing talk button must be disabled");
assert.equal(onPetTalkBtn!.getAttribute("aria-label"), "Processing...", "processing talk button without canSubmitRecording has 'Processing...' aria-label");
assert.equal(onPetTalkBtn!.getAttribute("title"), "Processing...", "processing talk button without canSubmitRecording has 'Processing...' title");

// Click while in processing state must be suppressed and not dispatched over IPC
invoked.length = 0;
for (const l of clickListeners) {
  l({ button: 0, target: onPetTalkBtn, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
}
const voiceToggleWhileProcessing = invoked.find((inv) => inv.channel === "openpets:default-pet-chat-voice-toggle");
assert.strictEqual(voiceToggleWhileProcessing, undefined, "Click on disabled/processing talk button must NOT toggle voice session or dispatch IPC");

// Voice snapshot with canSubmitRecording: true updates talk button to 'Stop recording and send' (active recording state)
voiceEventListener!({}, {
  type: "snapshot",
  sequence: 2,
  snapshot: {
    sessionId: 1,
    status: "active",
    activity: "listening",
    canSubmitRecording: true,
    muted: false,
    conversationId: "pet-assistant",
    generation: 1,
    turnId: "voice-turn-1",
    userTranscript: null,
    assistantTranscript: null,
    interruptionCount: 0,
    error: null,
    shortcut: null,
    shortcutStatus: "registered",
    shortcutReason: null,
  },
});
assert.ok(onPetTalkBtn!.classList.contains("is-active"), "recording talk button with canSubmitRecording has is-active class");
assert.ok(!onPetTalkBtn!.classList.contains("is-processing"), "recording talk button with canSubmitRecording does not have is-processing class");
assert.equal(onPetTalkBtn!.disabled, false, "recording talk button with canSubmitRecording is enabled");
assert.equal(onPetTalkBtn!.getAttribute("aria-label"), "Stop recording and send", "talk button with canSubmitRecording has 'Stop recording and send' aria-label");
assert.equal(onPetTalkBtn!.getAttribute("title"), "Stop recording and send", "talk button with canSubmitRecording has 'Stop recording and send' title");

// Click while in recording active state triggers voice toggle IPC
invoked.length = 0;
for (const l of clickListeners) {
  l({ button: 0, target: onPetTalkBtn, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
}
const voiceToggleWhileActive = invoked.find((inv) => inv.channel === "openpets:default-pet-chat-voice-toggle");
assert.ok(voiceToggleWhileActive, "Click on active recording talk button must invoke voice toggle IPC");

// Speaking activity updates talk button to subdued 'Speaking...' state
voiceEventListener!({}, {
  type: "snapshot",
  sequence: 3,
  snapshot: {
    sessionId: 1,
    status: "active",
    activity: "speaking",
    canSubmitRecording: false,
    muted: false,
    conversationId: "pet-assistant",
    generation: 1,
    turnId: "voice-turn-1",
    userTranscript: null,
    assistantTranscript: "I am responding now.",
    interruptionCount: 0,
    error: null,
    shortcut: null,
    shortcutStatus: "registered",
    shortcutReason: null,
  },
});
assert.ok(onPetTalkBtn!.classList.contains("is-processing"), "speaking talk button has is-processing class");
assert.ok(!onPetTalkBtn!.classList.contains("is-active"), "speaking talk button does not have is-active class");
assert.equal(onPetTalkBtn!.disabled, true, "speaking talk button is disabled");
assert.equal(onPetTalkBtn!.getAttribute("aria-label"), "Speaking...", "speaking talk button has 'Speaking...' aria-label");
assert.equal(onPetTalkBtn!.getAttribute("title"), "Speaking...", "speaking talk button has 'Speaking...' title");

// Click while speaking is suppressed
invoked.length = 0;
for (const l of clickListeners) {
  l({ button: 0, target: onPetTalkBtn, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
}
const voiceToggleWhileSpeaking = invoked.find((inv) => inv.channel === "openpets:default-pet-chat-voice-toggle");
assert.strictEqual(voiceToggleWhileSpeaking, undefined, "Click on speaking talk button must NOT invoke voice toggle");

voiceEventListener!({}, {
  type: "snapshot",
  sequence: 4,
  snapshot: {
    sessionId: 1,
    status: "muted",
    activity: null,
    muted: true,
    conversationId: "pet-assistant",
    generation: 1,
    turnId: "voice-turn-1",
    userTranscript: null,
    assistantTranscript: null,
    interruptionCount: 0,
    error: null,
    shortcut: null,
    shortcutStatus: "registered",
    shortcutReason: null,
  },
});
assert.equal(voiceBtnLabel.textContent, "Unmute", "authoritative muted Talk snapshot should offer unmute");

const transcript = fullPanel!.querySelector("[data-chat-transcript]");
assert.ok(transcript, "Transcript container must exist");
assert.ok(transcript!.innerHTML.includes("Hello human!"), "Transcript must contain rendered message");

// 7. Test sending a message from compact composer
// Re-open compact composer
for (const l of clickListeners) {
  l({ button: 0, target: currentLauncher, preventDefault: () => {}, stopPropagation: () => {} });
}
assert.equal(documentElement.dataset.compactComposerOpen, "true");
assert.equal(compactInput.value, "Draft message from compact composer", "Re-opened compact composer must retain draft");

invoked.length = 0;
compactInput.dispatchEvent({ type: "keydown", key: "Enter", shiftKey: false, isComposing: false, preventDefault: () => {} });
const sendInvoked = invoked.find((inv) => inv.channel === "openpets:default-pet-chat-send-message");
assert.ok(sendInvoked, "Enter key in compact composer must send message");
assert.equal(sendInvoked!.args[0], "Draft message from compact composer");
assert.equal(documentElement.dataset.compactComposerOpen, "false", "Sending message closes compact composer");
assert.equal(compactInput.value, "", "Input must be cleared after sending");
assert.equal(fullInput.value, "", "Draft must be cleared after sending");

// 8. REGRESSION TEST: in-place pet content update (openpets:pet-content-state)
const contentStateListener = listeners.get("openpets:pet-content-state");
assert.ok(contentStateListener);

// Set draft
compactInput.value = "Draft before state refresh";
compactInput.dispatchEvent({ type: "input" });

contentStateListener!({}, {
  reactionState: "running-right",
  bodyHtml: `<div class="stage" aria-label="OpenPets default pet" data-pet-role="default"><div class="pet-hitbox"><button class="openpets-companion-launcher" data-openpets-companion-launcher="true"></button><button class="openpets-companion-launcher openpets-talk-button is-processing" data-openpets-talk-button="true" disabled aria-disabled="true"></button><div class="pet-shell"><div class="sprite"></div></div></div></div>`,
});

// Verify reaction state was updated on root
assert.equal(documentElement.dataset.reactionState, "running-right");

// Verify talk button state was reapplied after content-state DOM replacement (from active voice snapshot seq 4)
const talkAfterRefresh = documentElement.querySelector("[data-openpets-talk-button]");
assert.ok(talkAfterRefresh, "Talk button must exist after pet-content-state update");
assert.ok(talkAfterRefresh!.classList.contains("is-processing"), "Talk button must retain is-processing class across DOM refresh");
assert.equal(talkAfterRefresh!.disabled, true, "Talk button must retain disabled state across DOM refresh");
assert.equal(talkAfterRefresh!.getAttribute("aria-label"), "Processing...", "Talk button aria-label must be reapplied across DOM refresh");
assert.equal(talkAfterRefresh!.getAttribute("title"), "Processing...", "Talk button title must be reapplied across DOM refresh");

// Verify compact composer and chat panel are STILL attached to document body and NOT wiped out
const compactAfterRefresh = documentElement.querySelector(".openpets-compact-composer");
assert.ok(compactAfterRefresh, "Compact composer must remain in DOM after pet-content-state update");
assert.strictEqual(compactAfterRefresh, compactComposer, "Compact composer reference must be preserved");

const panelAfterRefresh = documentElement.querySelector(".openpets-chat-panel");
assert.ok(panelAfterRefresh, "Chat panel must remain in DOM after pet-content-state update");
assert.strictEqual(panelAfterRefresh, fullPanel, "Chat panel reference must be preserved");

// Verify draft was preserved across content refresh
assert.equal(compactInput.value, "Draft before state refresh", "Draft must be preserved across content refreshes");
assert.equal(fullInput.value, "Draft before state refresh", "Full panel input must retain preserved draft");

// 8b. Mutual exclusion test: response bubble replaces launcher affordance, clearing bubble restores launcher
contentStateListener!({}, {
  reactionState: "idle",
  bodyHtml: `<div class="stage has-bubble" aria-label="OpenPets default pet" data-pet-role="default"><div class="bubble is-message-only"><div class="bubble-body"><span class="bubble-text">Here is the pet reply!</span></div></div><div class="pet-hitbox"><div class="pet-shell"><div class="sprite"></div></div></div></div>`,
});
assert.ok(documentElement.querySelector(".bubble"), "Response bubble must be present in stage");
assert.strictEqual(documentElement.querySelector("[data-openpets-companion-launcher]"), null, "Chat launcher must be omitted while response bubble is displayed");

contentStateListener!({}, {
  reactionState: "idle",
  bodyHtml: `<div class="stage" aria-label="OpenPets default pet" data-pet-role="default"><div class="pet-hitbox"><button class="openpets-companion-launcher" data-openpets-companion-launcher="true"></button><button class="openpets-companion-launcher openpets-talk-button is-processing" data-openpets-talk-button="true"></button><div class="pet-shell"><div class="sprite"></div></div></div></div>`,
});
assert.strictEqual(documentElement.querySelector(".bubble"), null, "Bubble must be absent after clearing");
assert.ok(documentElement.querySelector("[data-openpets-companion-launcher]"), "Chat launcher must be restored when message bubble clears");
const talkRestored = documentElement.querySelector("[data-openpets-talk-button]");
assert.ok(talkRestored, "Talk button must be restored when message bubble clears");
assert.ok(talkRestored!.classList.contains("is-processing"), "Talk button re-applies processing state when restored");
assert.equal(talkRestored!.disabled, true, "Talk button re-applies disabled state when restored");
assert.equal(talkRestored!.getAttribute("aria-label"), "Processing...", "Talk button re-applies aria-label when restored");

// 9. REGRESSION TEST: Interaction isolation - compact composer & chat panel do NOT reach pet drag/click path
sent.length = 0;
const mousedownListeners = documentListeners.get("mousedown") ?? [];
const dblclickListeners = documentListeners.get("dblclick") ?? [];

for (const l of mousedownListeners) {
  l({ button: 0, target: compactInput, screenX: 100, screenY: 100, clientX: 100, clientY: 100, preventDefault: () => {} });
}
const dragStartSent = sent.find((s) => s.channel === "openpets:pet-drag-start");
assert.strictEqual(dragStartSent, undefined, "Mousedown on compact composer must NOT start pet drag");

for (const l of clickListeners) {
  l({ button: 0, target: compactInput, preventDefault: () => {}, stopPropagation: () => {} });
}
const petClickedSent = sent.find((s) => s.channel === "openpets:pet-event" && s.args[0] === "pet:clicked");
assert.strictEqual(petClickedSent, undefined, "Click on compact composer must NOT send pet:clicked event");

for (const l of dblclickListeners) {
  l({ button: 0, target: compactInput, preventDefault: () => {}, stopPropagation: () => {} });
}
const petDoubleClickedSent = sent.find((s) => s.channel === "openpets:pet-event" && s.args[0] === "pet:doubleClicked");
assert.strictEqual(petDoubleClickedSent, undefined, "Double-click on compact composer must NOT send pet:doubleClicked event");

// 10. REGRESSION TEST: Pet body click sends pet:clicked and does NOT auto-expand panel
sent.length = 0;
const currentPetShell = documentElement.querySelector(".pet-shell")!;
assert.ok(currentPetShell);

// A stationary drag still has an explicit start/end lifetime on both drag paths.
sent.length = 0;
for (const listener of mousedownListeners) {
  listener({ button: 0, target: currentPetShell, screenX: 100, screenY: 100, clientX: 100, clientY: 100, preventDefault: () => {} });
}
assert.ok(sent.some((message) => message.channel === "openpets:pet-drag-start"), "stationary manual drag must publish its start");
for (const listener of documentListeners.get("mouseup") ?? []) {
  listener({ button: 0, target: currentPetShell, screenX: 100, screenY: 100, clientX: 100, clientY: 100 });
}
assert.ok(sent.some((message) => message.channel === "openpets:pet-drag-end"), "stationary manual drag must publish its end");

documentElement.dataset.nativePetDrag = "wayland";
sent.length = 0;
for (const listener of mousedownListeners) {
  listener({ button: 0, target: currentPetShell, screenX: 100, screenY: 100, clientX: 100, clientY: 100, preventDefault: () => {} });
}
assert.ok(sent.some((message) => message.channel === "openpets:pet-drag-start"), "stationary native drag must publish its start");
for (const listener of documentListeners.get("mouseup") ?? []) {
  listener({ button: 0, target: currentPetShell, screenX: 100, screenY: 100, clientX: 100, clientY: 100 });
}
assert.ok(sent.some((message) => message.channel === "openpets:pet-drag-end"), "stationary native drag must publish its end");
delete documentElement.dataset.nativePetDrag;

for (const l of clickListeners) {
  l({ button: 0, target: currentPetShell, preventDefault: () => {}, stopPropagation: () => {} });
}
const petBodyToggleSent = sent.filter((s) => s.channel === "openpets:default-pet-chat-toggle" || s.channel === "openpets:default-pet-chat-expand");
assert.equal(petBodyToggleSent.length, 0, "Pet body click must NOT toggle or expand chat panel");

const petBodyClickSent = sent.find((s) => s.channel === "openpets:pet-event" && s.args[0] === "pet:clicked");
assert.ok(petBodyClickSent, "Pet body click must send pet:clicked event");

resolveInitialConversation({ conversationId: "pet-assistant", items: [], activity: "idle", lastSequence: 0, revision: 0 });
resolveInitialVoice({
  sessionId: 1,
  status: "ended",
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
  shortcutStatus: "registered",
  shortcutReason: null,
});
setTimeout(() => {
  assert.ok(transcript!.innerHTML.includes("Hello human!"), "a late initial conversation snapshot must not overwrite streamed state");
  assert.equal(voiceBtnLabel.textContent, "Unmute", "a late initial Talk snapshot must not overwrite streamed state");
  const talkBtnAtEnd = documentElement.querySelector("[data-openpets-talk-button]");
  assert.ok(talkBtnAtEnd, "talk button exists");
  assert.ok(talkBtnAtEnd!.classList.contains("is-processing"), "talk button remains in processing state before end event");

  voiceEventListener!({}, {
    type: "snapshot",
    sequence: 5,
    snapshot: {
      sessionId: 1,
      status: "ended",
      activity: null,
      muted: false,
      conversationId: "pet-assistant",
      generation: 1,
      turnId: null,
      userTranscript: null,
      assistantTranscript: null,
      interruptionCount: 0,
      error: null,
      shortcut: null,
      shortcutStatus: "registered",
      shortcutReason: null,
    },
  });
  assert.ok(!talkBtnAtEnd!.classList.contains("is-active"), "Ended talk session removes is-active class");
  assert.ok(!talkBtnAtEnd!.classList.contains("is-processing"), "Ended talk session removes is-processing class");
  assert.equal(talkBtnAtEnd!.disabled, false, "Ended talk session enables talk button");
  assert.equal(talkBtnAtEnd!.getAttribute("aria-label"), "Talk to companion", "Ended talk session resets aria-label to Talk to companion");
  assert.equal(talkBtnAtEnd!.getAttribute("title"), "Talk to companion", "Ended talk session resets title to Talk to companion");

  // Click on idle talk button dispatches voice toggle IPC
  invoked.length = 0;
  for (const l of clickListeners) {
    l({ button: 0, target: talkBtnAtEnd, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
  }
  const voiceToggleAtIdle = invoked.find((inv) => inv.channel === "openpets:default-pet-chat-voice-toggle");
  assert.ok(voiceToggleAtIdle, "Click on idle talk button must invoke voice toggle IPC");

  console.log("pet-preload-chat-contract tests passed.");
}, 0);
