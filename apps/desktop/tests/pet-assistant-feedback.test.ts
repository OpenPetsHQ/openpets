import assert from "node:assert/strict";

import { applyPetAssistantFeedback, feedbackForAssistantEvent, feedbackForVoiceActivity, PetAssistantFeedbackReducer } from "../src/pet-assistant-feedback.js";
import { PET_ASSISTANT_CONVERSATION_ID } from "../src/pet-assistant-conversation.js";
import { composeVoiceActivityBadge, composeVoiceActivityDisplay } from "../src/voice-activity-slot.js";

assert.deepEqual(["listening", "thinking", "acting", "speaking"].map((activity) => feedbackForVoiceActivity(activity as "listening" | "thinking" | "acting" | "speaking").state), ["listening", "thinking", "acting", "speaking"]);
assert.equal(feedbackForVoiceActivity("acting").reaction, "working");

const terminalFailure = feedbackForAssistantEvent({ type: "terminal", sequence: 1, result: { conversationId: PET_ASSISTANT_CONVERSATION_ID, turnId: "turn-1", status: "completed", toolOutcomes: [{ id: "call", name: "focus", result: { status: "rejected", reason: "private" } }] } });
assert.equal(terminalFailure?.state, "failure", "a rejected action is failure, not missing information without canonical evidence");
assert.equal(terminalFailure?.reaction, "error");

assert.equal(feedbackForAssistantEvent({ type: "terminal", sequence: 4, result: { conversationId: PET_ASSISTANT_CONVERSATION_ID, turnId: "turn-4", status: "completed", toolOutcomes: [{ id: "call", name: "focus", result: { status: "rejected", reason: "duration required", missingInformation: true } }] } })?.state, "missing-information");

const terminalSuccess = feedbackForAssistantEvent({ type: "terminal", sequence: 2, result: { conversationId: PET_ASSISTANT_CONVERSATION_ID, turnId: "turn-2", status: "completed" } });
assert.equal(terminalSuccess?.state, "success");
assert.equal(terminalSuccess?.reaction, undefined, "successful turn does not attach a separate success reaction");
assert.equal(terminalSuccess?.message, undefined, "successful turn without text response does not synthesize a generic Done message");

const terminalWithResponse = feedbackForAssistantEvent({ type: "terminal", sequence: 5, result: { conversationId: PET_ASSISTANT_CONVERSATION_ID, turnId: "turn-5", status: "completed", response: "It's sunny and 75°F outside!" } });
assert.equal(terminalWithResponse?.state, "success");
assert.equal(terminalWithResponse?.reaction, undefined, "successful turn with response does not attach a success reaction");
assert.equal(terminalWithResponse?.message, "It's sunny and 75°F outside!");

assert.equal(feedbackForAssistantEvent({ type: "terminal", sequence: 6, result: { conversationId: PET_ASSISTANT_CONVERSATION_ID, turnId: "turn-6", status: "failed", response: "Could not connect to service." } })?.message, "Could not connect to service.");
assert.equal(feedbackForAssistantEvent({ type: "activity", sequence: 3, conversationId: PET_ASSISTANT_CONVERSATION_ID, turnId: "turn-3", activity: "failed" }), null, "activity failure is not a terminal feedback trigger");
assert.equal(composeVoiceActivityBadge("waiting", "waiting", "success"), "success", "terminal feedback has priority over next listening activity");
assert.equal(composeVoiceActivityDisplay({ message: "Done." }, "waiting", "success")?.reaction, "success");

// --- Direct applyPetAssistantFeedback tests ---
const appliedFailure: string[] = [];
applyPetAssistantFeedback({
  setActivity: (reaction) => appliedFailure.push(`activity:${reaction}`),
  setStatus: (reaction) => appliedFailure.push(`status:${reaction}`),
  showReaction: (reaction, message) => appliedFailure.push(`reaction:${reaction}:${message}`),
}, terminalFailure);
assert.deepEqual(appliedFailure, ["activity:null", "status:error", "reaction:error:I couldn't complete that."]);

const appliedSuccessWithResponse: string[] = [];
applyPetAssistantFeedback({
  setActivity: (reaction) => appliedSuccessWithResponse.push(`activity:${reaction}`),
  setStatus: (reaction) => appliedSuccessWithResponse.push(`status:${reaction}`),
  showReaction: (reaction, message) => appliedSuccessWithResponse.push(`reaction:${reaction}:${message}`),
}, terminalWithResponse);
assert.deepEqual(appliedSuccessWithResponse, ["activity:null", "status:null", "reaction:null:It's sunny and 75°F outside!"]);

const appliedSuccessEmpty: string[] = [];
applyPetAssistantFeedback({
  setActivity: (reaction) => appliedSuccessEmpty.push(`activity:${reaction}`),
  setStatus: (reaction) => appliedSuccessEmpty.push(`status:${reaction}`),
  showReaction: (reaction, message) => appliedSuccessEmpty.push(`reaction:${reaction}:${message}`),
}, terminalSuccess);
assert.deepEqual(appliedSuccessEmpty, ["activity:null", "status:null"]);

// --- Typed turn feedback reducer lifecycle ---
const typedEvents: string[] = [];
const typedReducer = new PetAssistantFeedbackReducer({
  setActivity: (reaction) => typedEvents.push(`activity:${reaction}`),
  setStatus: (reaction) => typedEvents.push(`status:${reaction}`),
  showReaction: (reaction, message) => typedEvents.push(`reaction:${reaction}:${message}`),
});

// 1. Typed turn enters thinking
typedReducer.applyAssistantEvent({ type: "activity", sequence: 1, conversationId: PET_ASSISTANT_CONVERSATION_ID, turnId: "typed-1", activity: "thinking" });
assert.deepEqual(typedEvents, ["activity:thinking"]);

// 2. Typed turn completes with actual response - keeps response message above pet, clears thinking & status
typedReducer.applyAssistantEvent({ type: "terminal", sequence: 2, result: { conversationId: PET_ASSISTANT_CONVERSATION_ID, turnId: "typed-1", status: "completed", response: "The answer is 42." } });
assert.deepEqual(typedEvents, [
  "activity:thinking",
  "activity:null",
  "status:null",
  "reaction:null:The answer is 42.",
]);

// 3. Typed turn fails - clears thinking, sets error status, shows error message and reaction
const failedEvents: string[] = [];
const failReducer = new PetAssistantFeedbackReducer({
  setActivity: (reaction) => failedEvents.push(`activity:${reaction}`),
  setStatus: (reaction) => failedEvents.push(`status:${reaction}`),
  showReaction: (reaction, message) => failedEvents.push(`reaction:${reaction}:${message}`),
});
failReducer.applyAssistantEvent({ type: "activity", sequence: 1, conversationId: PET_ASSISTANT_CONVERSATION_ID, turnId: "fail-1", activity: "thinking" });
failReducer.applyAssistantEvent({ type: "terminal", sequence: 2, result: { conversationId: PET_ASSISTANT_CONVERSATION_ID, turnId: "fail-1", status: "failed", response: "Service unavailable." } });
assert.deepEqual(failedEvents, [
  "activity:thinking",
  "activity:null",
  "status:error",
  "reaction:error:Service unavailable.",
]);

// --- Voice lane feedback reducer lifecycle ---
const voiceDeferred: string[] = [];
const voiceReducer = new PetAssistantFeedbackReducer({
  setActivity: (reaction) => voiceDeferred.push(`activity:${reaction}`),
  setStatus: (reaction) => voiceDeferred.push(`status:${reaction}`),
  showReaction: (reaction, message) => voiceDeferred.push(`reaction:${reaction}:${message}`),
});
voiceReducer.applyVoiceEvent({ type: "snapshot", sequence: 1, snapshot: { status: "active", activity: "thinking", muted: false, conversationId: PET_ASSISTANT_CONVERSATION_ID, generation: 1, turnId: "voice-turn-1", userTranscript: null, assistantTranscript: null, interruptionCount: 0, error: null } });
voiceReducer.applyAssistantEvent({ type: "activity", sequence: 2, conversationId: PET_ASSISTANT_CONVERSATION_ID, turnId: "voice-turn-1", activity: "responding" });
voiceReducer.applyAssistantEvent({ type: "terminal", sequence: 3, result: { conversationId: PET_ASSISTANT_CONVERSATION_ID, turnId: "voice-turn-1", status: "completed", response: "Voice answer." } });
assert.equal(voiceDeferred.some((entry) => entry.startsWith("reaction:")), false, "voice terminal feedback waits for playback settlement");
voiceReducer.applyVoiceEvent({ type: "turn-settled", sequence: 4, turnId: "voice-turn-1", outcome: "completed" });
voiceReducer.applyVoiceEvent({ type: "turn-settled", sequence: 5, turnId: "voice-turn-1", outcome: "completed" });
voiceReducer.applyVoiceEvent({ type: "snapshot", sequence: 6, snapshot: { status: "active", activity: "listening", muted: false, conversationId: PET_ASSISTANT_CONVERSATION_ID, generation: 1, turnId: "voice-turn-1", userTranscript: null, assistantTranscript: null, interruptionCount: 0, error: null } });
assert.deepEqual(voiceDeferred.filter((entry) => entry.startsWith("reaction:")), ["reaction:null:Voice answer."], "settled terminal feedback is delivered exactly once without generic success reaction");

console.log("Pet assistant feedback mapping verified.");
