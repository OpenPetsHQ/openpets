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

const ipcRenderer = {
  invoke: async (channel: string, ...args: unknown[]) => {
    invoked.push({ channel, args });
    if (channel === "openpets:default-pet-chat-get-snapshot") {
      return { conversationId: "pet-assistant", items: [], activity: "idle", lastSequence: 0, revision: 0 };
    }
    if (channel === "openpets:default-pet-chat-get-voice-snapshot") {
      return { state: "idle", isMuted: false, error: null, shortcut: null, shortcutStatus: "unregistered", shortcutReason: null };
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
const body = new MockElement("body");
const initialStage = new MockElement("div");
initialStage.className = "stage";
const petHitbox = new MockElement("div");
petHitbox.className = "pet-hitbox";
const launcher = new MockElement("button");
launcher.className = "openpets-companion-launcher";
launcher.setAttribute("data-openpets-companion-launcher", "true");
const petShell = new MockElement("div");
petShell.className = "pet-shell";
const sprite = new MockElement("div");
sprite.className = "sprite";
petShell.appendChild(sprite);
petHitbox.appendChild(launcher);
petHitbox.appendChild(petShell);
initialStage.appendChild(petHitbox);
body.appendChild(initialStage);
documentElement.appendChild(body);

class MockTemplateElement extends MockElement {
  content = {
    firstElementChild: null as MockElement | null,
  };
  set innerHTML(_val: string) {
    const newStage = new MockElement("div");
    newStage.className = "stage";
    const newHitbox = new MockElement("div");
    newHitbox.className = "pet-hitbox";
    const newLauncher = new MockElement("button");
    newLauncher.className = "openpets-companion-launcher";
    newLauncher.setAttribute("data-openpets-companion-launcher", "true");
    const newShell = new MockElement("div");
    newShell.className = "pet-shell";
    newHitbox.appendChild(newLauncher);
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

// Verify both compact composer and full chat panel exist in DOM
const compactComposer = documentElement.querySelector(".openpets-compact-composer");
assert.ok(compactComposer, "Compact composer must be present in DOM");
assert.ok(body.contains(compactComposer), "Compact composer must be attached to body");

const fullPanel = documentElement.querySelector(".openpets-chat-panel");
assert.ok(fullPanel, "Full chat panel must be present in DOM");
assert.ok(body.contains(fullPanel), "Full chat panel must be attached to body");

const compactInput = compactComposer!.querySelector("[data-compact-chat-input]") as MockElement;
assert.ok(compactInput, "Compact chat input must exist");

const fullInput = fullPanel!.querySelector("[data-chat-input]") as MockElement;
assert.ok(fullInput, "Full chat input must exist");

const historyBtn = compactComposer!.querySelector("[data-chat-history-btn]") as MockElement;
assert.ok(historyBtn, "Explicit history/transcript affordance button must exist in compact composer");

const compactCloseBtn = compactComposer!.querySelector("[data-chat-composer-close-btn]") as MockElement;
assert.ok(compactCloseBtn, "Compact composer close button must exist");

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
  bodyHtml: `<div class="stage" aria-label="OpenPets default pet" data-pet-role="default"><div class="pet-hitbox"><button class="openpets-companion-launcher" data-openpets-companion-launcher="true"></button><div class="pet-shell"><div class="sprite"></div></div></div></div>`,
});

// Verify reaction state was updated on root
assert.equal(documentElement.dataset.reactionState, "running-right");

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

for (const l of clickListeners) {
  l({ button: 0, target: currentPetShell, preventDefault: () => {}, stopPropagation: () => {} });
}
const petBodyToggleSent = sent.filter((s) => s.channel === "openpets:default-pet-chat-toggle" || s.channel === "openpets:default-pet-chat-expand");
assert.equal(petBodyToggleSent.length, 0, "Pet body click must NOT toggle or expand chat panel");

const petBodyClickSent = sent.find((s) => s.channel === "openpets:pet-event" && s.args[0] === "pet:clicked");
assert.ok(petBodyClickSent, "Pet body click must send pet:clicked event");

console.log("pet-preload-chat-contract tests passed.");
