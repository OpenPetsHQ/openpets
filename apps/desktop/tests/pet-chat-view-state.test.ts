import assert from "node:assert/strict";
import {
  assistantDisplayName,
  deriveFullPanelVoiceAction,
  deriveTalkButtonPresentation,
  shouldAcceptConversationSnapshot,
  shouldAcceptTalkSnapshot,
  transitionChatDraft,
} from "../src/pet-chat-view-state.js";

assert.deepEqual(deriveTalkButtonPresentation({ status: "idle" }), {
  action: "toggle",
  disabled: false,
  active: false,
  processing: false,
  label: "Talk",
  ariaLabel: "Talk to companion",
  title: "Talk to companion",
});
const recordableTalk = deriveTalkButtonPresentation({ status: "active", canSubmitRecording: true });
assert.equal(recordableTalk.action, "toggle");
assert.equal(recordableTalk.disabled, false);
assert.equal(deriveTalkButtonPresentation({ status: "active", activity: "speaking" }).action, "none");
assert.equal(deriveTalkButtonPresentation({ status: "active", activity: "speaking" }).disabled, true);
assert.equal(deriveTalkButtonPresentation({ status: "paused", canSubmitRecording: true }).action, "toggle");
assert.equal(deriveTalkButtonPresentation({ status: "active", muted: true, canSubmitRecording: true }).action, "toggle");
assert.equal(deriveTalkButtonPresentation({ status: "paused" }).label, "Processing...");
assert.equal(deriveTalkButtonPresentation({ status: "active", muted: true }).label, "Processing...");

assert.equal(deriveFullPanelVoiceAction({ status: "idle" }), "start");
assert.equal(deriveFullPanelVoiceAction({ status: "paused" }), "retry");
assert.equal(deriveFullPanelVoiceAction({ status: "active", muted: true }), "unmute");
assert.equal(deriveFullPanelVoiceAction({ status: "active" }), "mute");

assert.equal(shouldAcceptConversationSnapshot({ sequence: 4, revision: 2 }, { lastSequence: 4, revision: 3 }), true);
assert.equal(shouldAcceptConversationSnapshot({ sequence: 4, revision: 3 }, { lastSequence: 4, revision: 3 }), false);
assert.equal(shouldAcceptConversationSnapshot({ sequence: 4, revision: 3 }, { lastSequence: 3, revision: 9 }), false);

assert.equal(shouldAcceptTalkSnapshot({ sessionId: 8, sequence: 10 }, 8, 9), false);
assert.equal(shouldAcceptTalkSnapshot({ sessionId: 8, sequence: 10 }, 9, 0), true);

assert.equal(assistantDisplayName("  ", "Codex"), "Codex");
assert.equal(assistantDisplayName(undefined, ""), "Assistant");

const draft = { draft: "hello", expanded: false, compactOpen: false } as const;
assert.deepEqual(transitionChatDraft(draft, { type: "expanded-changed", expanded: true }), {
  draft: "hello",
  expanded: true,
  compactOpen: false,
});
assert.equal(transitionChatDraft(draft, { type: "draft-changed", draft: "next" }).draft, "next");

console.log("pet-chat-view-state tests passed.");
