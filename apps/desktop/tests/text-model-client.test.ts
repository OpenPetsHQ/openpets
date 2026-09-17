import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { TextModelClient } from "../src/text-model-client.js";
import { initializePluginPlatformSettings, providerPresets, updateProviderProfile } from "../src/plugin-platform-settings.js";
import { configureProvider } from "./provider-test-helpers.js";
import type { PluginSecretsStore } from "../src/plugin-secrets.js";

const userDataPath = mkdtempSync(join(tmpdir(), "openpets-text-model-client-"));
const secrets = { get: async () => "test-key" } as unknown as PluginSecretsStore;
let calls: Array<{ input: string; init?: RequestInit }> = [];

try {
  initializePluginPlatformSettings(userDataPath);
  configureProvider({ id: "text-test", label: "Text test", adapter: "openai-compatible-text", model: "test-model", baseUrl: "https://provider.test/v1", secretRef: "text-test" }, "text");

  const openAi = new TextModelClient(secrets, { fetchImpl: async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify({ choices: [{ message: { content: "Planning the focus session.", tool_calls: [{ id: "call-1", type: "function", function: { name: "op_tool", arguments: '{"minutes":25}' } }] } }] }), { status: 200 });
  } });
  const toolResponse = await openAi.generate({ messages: [
    { role: "system", content: "Fixed host rules." },
    { role: "system", content: "Curated context." },
    { role: "system", content: "Personality style." },
    { role: "user", content: "start" },
  ], tools: [{ name: "op_tool", description: "Start", inputSchema: { type: "object" } }] }, new AbortController().signal);
  assert.deepEqual(toolResponse, { type: "tool-calls", text: "Planning the focus session.", toolCalls: [{ id: "call-1", name: "op_tool", arguments: { minutes: 25 } }] });
  assert.equal(calls[0]?.input, "https://provider.test/v1/chat/completions");
  const openAiInitialBody = JSON.parse(String(calls[0]?.init?.body)) as { messages: Array<{ role: string; content: string }> };
  assert.deepEqual(openAiInitialBody.messages.filter((message) => message.role === "system").map((message) => message.content), ["Fixed host rules.", "Curated context.", "Personality style."]);

  let snapshotCalls = 0;
  const snapshotUrls: string[] = [];
  const snapshotClient = new TextModelClient(secrets, { fetchImpl: async (input) => {
    snapshotUrls.push(String(input));
    snapshotCalls += 1;
    if (snapshotCalls === 1) updateProviderProfile("text-test", { baseUrl: "https://changed.test/v1" });
    return new Response(JSON.stringify({ choices: [{ message: { content: `step-${snapshotCalls}` } }] }), { status: 200 });
  } });
  await snapshotClient.generate({ messages: [{ role: "user", content: "one" }], tools: [] }, new AbortController().signal);
  await snapshotClient.generate({ messages: [{ role: "user", content: "two" }], tools: [] }, new AbortController().signal);
  assert.equal(snapshotCalls, 2);
  assert.deepEqual(snapshotUrls, ["https://provider.test/v1/chat/completions", "https://provider.test/v1/chat/completions"]);

  calls = [];
  await openAi.generate({ messages: [
    { role: "assistant", content: "Planning the focus session.", toolCalls: [{ id: "call-1", name: "op_tool", arguments: { minutes: 25 } }] },
    { role: "tool", toolCallId: "call-1", name: "op_tool", result: { status: "completed", result: { started: true } } },
  ], tools: [] }, new AbortController().signal);
  const openAiBody = JSON.parse(String(calls[0]?.init?.body)) as { messages: Array<Record<string, unknown>> };
  assert.equal(openAiBody.messages[0]?.content, "Planning the focus session.");
  assert.equal((openAiBody.messages[0]?.tool_calls as Array<{ id: string }>)[0]?.id, "call-1");
  assert.equal(openAiBody.messages[1]?.tool_call_id, "call-1");

  configureProvider({ id: "anthropic-test", label: "Anthropic test", adapter: "anthropic-text", model: "claude-test", baseUrl: "https://anthropic.test", secretRef: "anthropic-test" }, "text");
  calls = [];
  const anthropic = new TextModelClient(secrets, { fetchImpl: async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify({ content: [{ type: "text", text: "Preparing." }, { type: "tool_use", id: "anthropic-call", name: "op_tool", input: { minutes: 5 } }] }), { status: 200 });
  } });
  const anthropicResponse = await anthropic.generate({ messages: [
    { role: "system", content: "Fixed host rules." },
    { role: "system", content: "Curated context." },
    { role: "system", content: "Personality style." },
    { role: "assistant", content: "Previous thought.", toolCalls: [{ id: "previous", name: "op_tool", arguments: {} }] },
    { role: "tool", toolCallId: "previous", name: "op_tool", result: { status: "completed", result: { started: true } } },
  ], tools: [] }, new AbortController().signal);
  assert.deepEqual(anthropicResponse, { type: "tool-calls", text: "Preparing.", toolCalls: [{ id: "anthropic-call", name: "op_tool", arguments: { minutes: 5 } }] });
  const anthropicBody = JSON.parse(String(calls[0]?.init?.body)) as { system: string; messages: Array<{ content: Array<{ tool_use_id?: string; text?: string }> }> };
  assert.equal(anthropicBody.system, "Fixed host rules.\n\nCurated context.\n\nPersonality style.");
  assert.equal(anthropicBody.messages[0]?.content[0]?.text, "Previous thought.");
  assert.equal(anthropicBody.messages[1]?.content[0]?.tool_use_id, "previous");

  const malformed = new TextModelClient(secrets, { fetchImpl: async () => new Response(JSON.stringify({ content: [{ type: "tool_use", id: "", name: "op_tool", input: {} }] }), { status: 200 }) });
  await assert.rejects(() => malformed.generate({ messages: [{ role: "user", content: "start" }], tools: [] }, new AbortController().signal), /missing or duplicate tool-call ids/);

  const failed = new TextModelClient(secrets, { fetchImpl: async () => new Response("no", { status: 503 }) });
  await assert.rejects(() => failed.generate({ messages: [{ role: "user", content: "start" }], tools: [] }, new AbortController().signal), /HTTP 503/);

  const oversized = new TextModelClient(secrets, { maxRequestBytes: 10 });
  await assert.rejects(() => oversized.generate({ messages: [{ role: "user", content: "start" }], tools: [] }, new AbortController().signal), /request is too large/);

  const caller = new AbortController();
  const cancelled = new TextModelClient(secrets, { fetchImpl: async () => new Promise<Response>(() => undefined) });
  const pending = cancelled.generate({ messages: [{ role: "user", content: "start" }], tools: [] }, caller.signal);
  caller.abort();
  await assert.rejects(() => pending, /cancelled/);

  const timedOut = new TextModelClient(secrets, { timeoutMs: 5, fetchImpl: async () => new Promise<Response>(() => undefined) });
  await assert.rejects(() => timedOut.generate({ messages: [{ role: "user", content: "start" }], tools: [] }, new AbortController().signal), /timed out/);

  const atlasPreset = providerPresets.find((preset) => preset.id === "atlascloud");
  assert.ok(atlasPreset);
  configureProvider({ ...atlasPreset, id: "atlas-text", secretRef: "atlas-test" }, "text");
  const atlasRequest = { messages: [{ role: "user" as const, content: "hello" }], tools: [] };
  let atlasRequests = 0;
  const atlasFetch: typeof fetch = async (input, init) => {
    atlasRequests += 1;
    assert.equal(String(input), "https://api.atlascloud.ai/v1/chat/completions");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
    assert.equal(JSON.parse(String(init?.body)).model, "openai/gpt-4.1-mini");
    return new Response(JSON.stringify({ choices: [{ message: { content: "Hello." } }] }), { status: 200 });
  };
  const noCredential = { get: async () => undefined } as unknown as PluginSecretsStore;
  const atlasWithoutKey = new TextModelClient(noCredential, { fetchImpl: atlasFetch });
  await assert.rejects(() => atlasWithoutKey.generate(atlasRequest, new AbortController().signal), /no credential/);
  assert.equal(atlasRequests, 0, "missing Atlas credentials must fail before fetching");
  const atlas = new TextModelClient(secrets, { fetchImpl: atlasFetch });
  assert.deepEqual(await atlas.generate(atlasRequest, new AbortController().signal), { type: "text", text: "Hello." });
  assert.equal(atlasRequests, 1);
} finally {
  rmSync(userDataPath, { recursive: true, force: true });
}

console.log("text-model-client tests passed.");
