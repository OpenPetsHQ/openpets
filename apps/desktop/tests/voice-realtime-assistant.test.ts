import assert from "node:assert/strict";

import { PetAssistantConversationController, PET_ASSISTANT_CONVERSATION_ID } from "../src/pet-assistant-conversation.js";
import { PetAssistantModalityCoordinator } from "../src/pet-assistant-modality.js";
import { PetAssistantService } from "../src/pet-assistant-service.js";
import { petAssistantToolName } from "../src/pet-assistant-tools.js";
import type { PetAssistantCapabilityRuntime, PetAssistantGenerationHandle, PetAssistantTextModelRequest } from "../src/pet-assistant-types.js";
import type { HostProviderOperations, ProviderOperationSnapshot } from "../src/provider-service.js";
import { VoiceMicrophoneArbiter } from "../src/voice-microphone-arbiter.js";
import { VoicePrivacyIndicator } from "../src/voice-privacy-indicator.js";
import { OpenAIRealtimeVoiceAssistantSession, buildOpenAIRealtimeSessionConfig } from "../src/voice-realtime-assistant.js";
import { createOpenAIRealtimeToolResultEvents, parseStrictJsonObject } from "../src/voice-realtime-protocol.js";
import type { VoiceConversationEvent, VoiceConversationTransport, VoiceConversationTransportContext } from "../src/voice-conversation.js";
import { VoiceAssistantHostController } from "../src/voice-assistant-host-core.js";
import { PET_ASSISTANT_CONVERSATION_ID as ARCHIVE_CONVERSATION_ID } from "../src/pet-assistant-archive.js";
import type { PetAssistantArchivedMessage, PetAssistantConversationArchive } from "../src/pet-assistant-archive.js";

class Transport implements VoiceConversationTransport {
  readonly context: VoiceConversationTransportContext;
  readonly sent: string[] = [];
  closeCount = 0;

  constructor(context: VoiceConversationTransportContext) { this.context = context; }
  async start(): Promise<void> {
    this.context.emit({ type: "microphone-acquired" });
    this.context.emit({ type: "negotiating" });
    this.context.emit({ type: "connected" });
  }
  setMuted(): void {}
  async close(): Promise<void> { this.closeCount += 1; }
  async sendToolResult(command: { readonly callId: string; readonly result: unknown }): Promise<void> {
    this.sent.push(JSON.stringify(command));
  }
  emit(event: VoiceConversationEvent): void { this.context.emit(event); }
}

const handle = { generation: 1 } as PetAssistantGenerationHandle;
const capability = { pluginId: "focus.buddy", capability: { id: "start", description: "Start focus", inputSchema: { type: "object" } }, handle };
const toolName = petAssistantToolName("focus.buddy", "start");

function provider(): HostProviderOperations {
  const snapshot: ProviderOperationSnapshot = { role: "realtime", profile: { id: "native", label: "Native", adapter: "openai-realtime", model: "gpt-4o-mini", realtimeModel: "gpt-realtime-2.1", baseUrl: "https://api.openai.com/v1" } };
  return {
    snapshot: async () => snapshot,
    negotiateRealtime: async () => "v=0\r\no=answer",
  } as unknown as HostProviderOperations;
}

function testArchive(): PetAssistantConversationArchive & { readonly messages: PetAssistantArchivedMessage[] } {
  const messages: PetAssistantArchivedMessage[] = [];
  return {
    messages,
    list: () => messages,
    append: (entries) => {
      messages.push(...entries.map((entry, index) => ({ ...entry, id: `archive-${messages.length + index}`, conversationId: ARCHIVE_CONVERSATION_ID as "openpets-control-center-current", createdAt: 1 })));
    },
    deleteMessage: (id) => {
      const index = messages.findIndex((message) => message.id === id);
      if (index < 0) return false;
      messages.splice(index, 1);
      return true;
    },
    clear: () => { messages.length = 0; },
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

function fixture(options: { readonly runtime?: PetAssistantCapabilityRuntime; readonly archive?: PetAssistantConversationArchive } = {}) {
  const runtime = options.runtime ?? { snapshot: () => ({ capabilities: [capability] }), execute: async () => ({ ok: true, result: { started: true } }) };
  const requests: PetAssistantTextModelRequest[] = [];
  const assistant = new PetAssistantService({ generate: (request) => {
    requests.push(request);
    return { type: "text", text: "unused" };
  } }, runtime, { conversationArchive: options.archive });
  const indicator = new VoicePrivacyIndicator();
  const transports: Transport[] = [];
  const session = new OpenAIRealtimeVoiceAssistantSession({
    provider: provider(),
    assistant,
    microphoneArbiter: new VoiceMicrophoneArbiter(),
    privacyIndicator: indicator,
    modalityCoordinator: new PetAssistantModalityCoordinator(),
    transportFactory: () => (context) => {
      const transport = new Transport(context);
      transports.push(transport);
      return transport;
    },
  });
  return { assistant, session, transports, indicator, requests };
}

// Realtime archives one completed terminal user/assistant pair, while cancellation archives nothing.
{
  const completedArchive = testArchive();
  const completed = fixture({ archive: completedArchive });
  await completed.session.start();
  const completedTransport = completed.transports[0]!;
  completedTransport.emit({ type: "speech-started", itemId: "memory-input" });
  completedTransport.emit({ type: "transcript", entryId: "memory-user", itemId: "memory-input", speaker: "user", status: "final", text: "Remember this" });
  completedTransport.emit({ type: "response-started", responseId: "memory-response" });
  completedTransport.emit({ type: "transcript", entryId: "memory-assistant", itemId: "memory-output", responseId: "memory-response", speaker: "assistant", status: "final", text: "I will remember this." });
  completedTransport.emit({ type: "response-completed", responseId: "memory-response" });
  await flush();
  assert.deepEqual(completedArchive.messages.map((message) => [message.role, message.text]), [
    ["user", "Remember this"],
    ["assistant", "I will remember this."],
  ]);
  await completed.assistant.stop();

  const cancelledArchive = testArchive();
  const cancelled = fixture({ archive: cancelledArchive });
  await cancelled.session.start();
  const cancelledTransport = cancelled.transports[0]!;
  cancelledTransport.emit({ type: "speech-started", itemId: "cancel-input" });
  cancelledTransport.emit({ type: "transcript", entryId: "cancel-user", itemId: "cancel-input", speaker: "user", status: "final", text: "Do not archive this" });
  await cancelled.session.interrupt();
  assert.deepEqual(cancelledArchive.messages, []);
  await cancelled.assistant.stop();
}

// Rejected Realtime outcomes replace optimistic provider prose before active memory and archive commit.
{
  const archive = testArchive();
  const current = fixture({
    archive,
    runtime: {
      snapshot: () => ({ capabilities: [capability] }),
      execute: async () => ({ ok: false, error: { stage: "input", code: "invalid_input", message: "Duration is required." } }),
    },
  });
  await current.session.start();
  const transport = current.transports[0]!;
  transport.emit({ type: "speech-started", itemId: "rejected-input" });
  transport.emit({ type: "transcript", entryId: "rejected-user", itemId: "rejected-input", speaker: "user", status: "final", text: "Start focus" });
  transport.emit({ type: "response-started", responseId: "rejected-response" });
  transport.emit({ type: "tool-call", responseId: "rejected-response", itemId: "rejected-call-item", callId: "rejected-call", name: toolName, arguments: "{}" });
  transport.emit({ type: "response-completed", responseId: "rejected-response" });
  await flush();
  transport.emit({ type: "response-started", responseId: "rejected-followup" });
  transport.emit({ type: "transcript", entryId: "rejected-output", itemId: "rejected-output", responseId: "rejected-followup", speaker: "assistant", status: "final", text: "Focus started successfully." });
  transport.emit({ type: "response-completed", responseId: "rejected-followup" });
  await flush();

  const summary = "Capability outcomes: completed=0, rejected=1, unavailable=0, indeterminate=0.";
  assert.deepEqual(archive.messages.map((message) => [message.role, message.text]), [["user", "Start focus"], ["assistant", summary]]);
  await current.assistant.startTurn(PET_ASSISTANT_CONVERSATION_ID, "What happened?");
  assert.equal(current.requests[0]?.messages.some((message) => message.role === "assistant" && message.content === summary), true);
  assert.equal(current.requests[0]?.messages.some((message) => message.role === "assistant" && message.content === "Focus started successfully."), false);
  await current.assistant.stop();
}

// Cancelled Realtime transcripts do not enter active memory or archive context for a following turn.
{
  const archive = testArchive();
  const current = fixture({ archive });
  await current.session.start();
  const transport = current.transports[0]!;
  transport.emit({ type: "speech-started", itemId: "cancel-input" });
  transport.emit({ type: "transcript", entryId: "cancel-user", itemId: "cancel-input", speaker: "user", status: "final", text: "Do not retain this" });
  await current.session.interrupt();
  await current.assistant.startTurn(PET_ASSISTANT_CONVERSATION_ID, "Next turn");
  assert.equal(current.requests[0]?.messages.some((message) => message.role !== "tool" && message.content === "Do not retain this"), false);
  assert.equal(archive.messages.some((message) => message.text === "Do not retain this"), false);
  await current.session.end();
  await current.assistant.stop();
}

// Canonical tools are translated to the current Realtime schema, including the deliberate empty-tool mode.
{
  const noTools = buildOpenAIRealtimeSessionConfig("gpt-realtime-2.1", { instructions: "rules", tools: [] });
  assert.deepEqual(noTools.tools, []);
  assert.equal(noTools.tool_choice, "none");
  const withTools = buildOpenAIRealtimeSessionConfig("gpt-realtime-2.1", { instructions: "rules", tools: [{ name: "op_tool", description: "Tool", inputSchema: { type: "object" } }] });
  assert.deepEqual(withTools.tools, [{ type: "function", name: "op_tool", description: "Tool", parameters: { type: "object" } }]);
  assert.equal(withTools.tool_choice, "auto");
}

// Native Realtime has no generic recording-submit operation.  Its primary Talk
// toggle is therefore non-destructive while active; explicit end owns teardown.
{
  const current = fixture();
  const controller = new VoiceAssistantHostController(() => ({ session: current.session, shutdown: () => current.session.shutdown() }));
  await controller.activate();
  assert.equal(current.session.snapshot().canSubmitRecording, undefined);
  assert.equal(await controller.toggle(), current.session);
  assert.equal(await controller.toggle(), current.session);
  assert.equal(current.session.snapshot().status, "active");
  assert.equal(current.transports[0]?.closeCount, 0);
  await controller.end();
  assert.equal(current.session.snapshot().status, "ended");
  await current.assistant.stop();
}

// A completed Realtime response is the safe one-shot terminal boundary.  The
// transport closes instead of letting server VAD create another turn.
{
  const current = fixture();
  await current.session.start();
  const transport = current.transports[0]!;
  transport.emit({ type: "speech-started", itemId: "one-shot-input" });
  transport.emit({ type: "response-started", responseId: "one-shot-response" });
  transport.emit({ type: "transcript", entryId: "one-shot-output", itemId: "one-shot-output", responseId: "one-shot-response", speaker: "assistant", status: "final", text: "One-shot response." });
  transport.emit({ type: "response-completed", responseId: "one-shot-response" });
  await flush();
  assert.equal(current.session.snapshot().status, "ended");
  assert.equal(current.session.snapshot().activity, null);
  assert.equal(transport.closeCount, 1);
  await current.assistant.stop();
}

// Tool output uses function_call_output followed by response.create, preserving structured status.
{
  const events = createOpenAIRealtimeToolResultEvents("call_1", { status: "rejected", reason: "missing", missingInformation: true });
  assert.deepEqual(events.map((event) => JSON.parse(event).type), ["conversation.item.create", "response.create"]);
  assert.equal(JSON.parse(events[0]!).item.output, JSON.stringify({ status: "rejected", reason: "missing", missingInformation: true }));
  assert.equal(parseStrictJsonObject("[]"), null);
  assert.equal(parseStrictJsonObject("not-json"), null);
}

// A valid provider function call executes once through PetAssistantService and projects a truthful action result.
{
  let executions = 0;
  const current = fixture({ runtime: { snapshot: () => ({ capabilities: [capability] }), execute: async () => { executions += 1; return { ok: true, result: { started: true } }; } } });
  const projection = new PetAssistantConversationController(current.assistant);
  current.session.subscribe((event) => {
    if (event.type === "transcript") projection.applyNormalizedVoiceTranscript({ type: "transcript", sequence: event.sequence, conversationId: PET_ASSISTANT_CONVERSATION_ID, turnId: event.turnId, entryId: `entry-${event.sequence}`, speaker: event.speaker, text: event.text, status: event.kind });
  });
  await current.session.start();
  const transport = current.transports[0]!;
  transport.emit({ type: "speech-started", itemId: "input-1" });
  transport.emit({ type: "transcript", entryId: "input-1", itemId: "input-1", speaker: "user", status: "final", text: "Start focus" });
  transport.emit({ type: "response-started", responseId: "response-1" });
  transport.emit({ type: "tool-call", responseId: "response-1", itemId: "call-item-1", callId: "call_1", name: toolName, arguments: JSON.stringify({ minutes: 25 }) });
  transport.emit({ type: "response-completed", responseId: "response-1" });
  await flush();
  assert.equal(executions, 1);
  assert.match(transport.sent[0] ?? "", /completed/);
  transport.emit({ type: "response-started", responseId: "response-2" });
  transport.emit({ type: "transcript", entryId: "stale-output-1", itemId: "stale-output-1", responseId: "response-1", speaker: "assistant", status: "final", text: "stale response" });
  transport.emit({ type: "response-completed", responseId: "response-1" });
  assert.equal(current.session.snapshot().assistantTranscript, null);
  transport.emit({ type: "transcript", entryId: "output-1", itemId: "output-1", responseId: "response-2", speaker: "assistant", status: "final", text: "Focus started." });
  transport.emit({ type: "response-completed", responseId: "response-2" });
  await flush();
  const action = projection.getSnapshot().items.find((item) => item.kind === "action");
  assert.equal(action?.kind === "action" ? action.status : "missing", "completed");
  await current.session.end();
  projection.dispose();
  await current.assistant.stop();
}

// Events from an interrupted response cannot mutate, settle, or execute against its replacement turn.
{
  let executions = 0;
  const current = fixture({ runtime: { snapshot: () => ({ capabilities: [capability] }), execute: async () => { executions += 1; return { ok: true, result: {} }; } } });
  const projection = new PetAssistantConversationController(current.assistant);
  const events: Array<{ readonly type: string; readonly turnId?: string; readonly text?: string }> = [];
  current.session.subscribe((event) => {
    if (event.type === "transcript") {
      events.push({ type: event.type, turnId: event.turnId, text: event.text });
      projection.applyNormalizedVoiceTranscript({ type: "transcript", sequence: event.sequence, conversationId: PET_ASSISTANT_CONVERSATION_ID, turnId: event.turnId, entryId: `race-${event.sequence}`, speaker: event.speaker, text: event.text, status: event.kind });
    }
    if (event.type === "turn-settled") events.push({ type: event.type, turnId: event.turnId });
  });
  await current.session.start();
  const transport = current.transports[0]!;

  transport.emit({ type: "speech-started", itemId: "race-input-a" });
  transport.emit({ type: "response-started", responseId: "race-response-a" });
  transport.emit({ type: "transcript", entryId: "race-input-a", itemId: "race-input-a", speaker: "user", status: "final", text: "Turn A" });
  transport.emit({ type: "transcript", entryId: "race-output-a", itemId: "race-output-a", responseId: "race-response-a", speaker: "assistant", status: "partial", text: "A partial" });
  const turnA = current.session.snapshot().turnId;
  assert.ok(turnA);

  await current.session.interrupt();
  transport.emit({ type: "speech-started", itemId: "race-input-b" });
  transport.emit({ type: "response-started", responseId: "race-response-b" });
  const turnB = current.session.snapshot().turnId;
  assert.ok(turnB);
  assert.notEqual(turnA, turnB);

  transport.emit({ type: "speech-stopped", itemId: "race-input-a" });
  transport.emit({ type: "response-audio-started", responseId: "race-response-a" });
  assert.equal(current.session.snapshot().activity, "thinking");
  transport.emit({ type: "transcript", entryId: "race-output-a-final", itemId: "race-output-a", responseId: "race-response-a", speaker: "assistant", status: "final", text: "A terminal text" });
  transport.emit({ type: "tool-call", responseId: "race-response-a", itemId: "race-call-a", callId: "race-call-a", name: toolName, arguments: "{}" });
  transport.emit({ type: "response-completed", responseId: "race-response-a" });
  assert.equal(current.session.snapshot().turnId, turnB);
  assert.equal(current.session.snapshot().assistantTranscript, null);
  assert.equal(executions, 0);
  assert.equal(events.some((event) => event.turnId === turnB && event.text === "A terminal text"), false);
  assert.equal(projection.getSnapshot().items.some((item) => item.kind === "message" && item.text === "A terminal text"), false);

  transport.emit({ type: "transcript", entryId: "race-output-b", itemId: "race-output-b", responseId: "race-response-b", speaker: "assistant", status: "final", text: "B terminal text" });
  transport.emit({ type: "response-completed", responseId: "race-response-b" });
  await flush();
  assert.equal(current.session.snapshot().turnId, null);
  assert.equal(current.session.snapshot().assistantTranscript, "B terminal text");
  assert.equal(events.some((event) => event.turnId === turnB && event.text === "B terminal text"), true);

  await current.session.end();
  transport.emit({ type: "response-completed", responseId: "race-response-a" });
  assert.equal(current.session.snapshot().status, "ended");
  projection.dispose();
  await current.assistant.stop();
}

// Malformed, non-object, and unknown calls never execute and preserve unavailable/rejected outcomes.
{
  let executions = 0;
  const current = fixture({ runtime: { snapshot: () => ({ capabilities: [capability] }), execute: async () => { executions += 1; return { ok: true, result: {} }; } } });
  await current.session.start();
  const transport = current.transports[0]!;
  transport.emit({ type: "speech-started", itemId: "input-2" });
  transport.emit({ type: "response-started", responseId: "response-3" });
  transport.emit({ type: "tool-call", responseId: "response-3", itemId: "bad-item", callId: "bad_json", name: toolName, arguments: "{bad" });
  transport.emit({ type: "tool-call", responseId: "response-3", itemId: "array-item", callId: "array_args", name: toolName, arguments: "[]" });
  transport.emit({ type: "tool-call", responseId: "response-3", itemId: "unknown-item", callId: "unknown", name: "op_missing", arguments: "{}" });
  await flush();
  assert.equal(executions, 0);
  assert.match(current.transports[0]?.sent.join(" ") ?? "", /rejected/);
  assert.match(current.transports[0]?.sent.join(" ") ?? "", /unavailable/);
  await current.session.end();
  await current.assistant.stop();
}

// Duplicate completion and stale events are ignored; an interrupted side effect remains indeterminate and cannot enter a new session.
{
  let release!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const runtime: PetAssistantCapabilityRuntime = {
    snapshot: () => ({ capabilities: [capability] }),
    execute: async () => { started(); await new Promise<void>((resolve) => { release = resolve; }); return { ok: true, result: {} }; },
  };
  const current = fixture({ runtime });
  await current.session.start();
  const oldTransport = current.transports[0]!;
  oldTransport.emit({ type: "speech-started", itemId: "input-3" });
  oldTransport.emit({ type: "response-started", responseId: "response-4" });
  oldTransport.emit({ type: "tool-call", responseId: "response-4", itemId: "running-item", callId: "running", name: toolName, arguments: "{}" });
  await startedPromise;
  await current.session.interrupt();
  release();
  await flush();
  assert.equal(current.transports[0]?.sent.some((value) => value.includes("running")), false, "late result must not be sent after interruption");
  oldTransport.emit({ type: "tool-call", responseId: "response-4", itemId: "running-item", callId: "running", name: toolName, arguments: "{}" });
  assert.equal(current.transports[0]?.sent.length, 0);
  await current.session.end();
  assert.equal(oldTransport.closeCount, 1);
  await current.assistant.stop();
}

console.log("OpenAI Realtime Pet Assistant adapter tests passed.");
