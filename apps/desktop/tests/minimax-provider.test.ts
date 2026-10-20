import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PluginAiGateway } from "../src/plugin-ai-gateway.js";
import { HostProviderService } from "../src/provider-service.js";
import { TextModelClient } from "../src/text-model-client.js";
import { createProviderProfile, getPluginPlatformSettings, initializePluginPlatformSettings, providerPresets, selectProviderProfile } from "../src/plugin-platform-settings.js";
import type { PluginSecretsStore } from "../src/plugin-secrets.js";

const directory = mkdtempSync(join(tmpdir(), "openpets-minimax-provider-"));
const secrets = { get: async () => "test-key" } as unknown as PluginSecretsStore;
let captures = 0;
try {
  initializePluginPlatformSettings(directory);
  const preset = providerPresets.find((item) => item.id === "minimax-chat");
  assert.equal(preset?.model, "MiniMax-M3.1-Flash");

  for (const host of ["api.minimax.io", "api.minimaxi.com"]) {
    for (const adapter of ["openai-compatible-text", "anthropic-text"] as const) {
      for (const model of ["MiniMax-M3.1-Flash", "MiniMax-M3", "MiniMax-M2.7", "custom-model"]) {
        const anthropic = adapter === "anthropic-text";
        const id = `profile-${captures}`;
        const baseUrl = `https://${host}/${anthropic ? "anthropic" : "v1"}`;
        createProviderProfile({ id, label: "MiniMax", adapter, model, baseUrl, secretRef: "minimax" });
        selectProviderProfile("text", id);
        // Reopening persisted profiles must not replace explicit model selections.
        initializePluginPlatformSettings(directory);
        assert.equal(getPluginPlatformSettings().profiles[id]?.model, model);
        const provider = new HostProviderService(secrets, { fetchImpl: async (input, init) => {
          captures += 1;
          assert.equal(String(input), `${baseUrl}${anthropic ? "/v1/messages" : "/chat/completions"}`);
          const headers = new Headers(init?.headers);
          assert.equal(headers.get(anthropic ? "x-api-key" : "authorization"), anthropic ? "test-key" : "Bearer test-key");
          const body = JSON.parse(String(init?.body));
          assert.equal(body.model, model);
          for (const field of ["thinking", "reasoning_effort", "output_config", "service_tier", "reasoning_split"]) {
            assert.equal(field in body, false, `${field} must use provider defaults`);
          }
          if (body.stream) {
            const event = anthropic ? { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } } : { choices: [{ delta: { content: "hello" } }] };
            return new Response(`data: ${JSON.stringify(event)}\n\n`, { status: 200 });
          }
          return new Response(JSON.stringify(anthropic
            ? { content: [{ type: "thinking", thinking: "private reasoning", signature: "test" }, { type: "redacted_thinking", data: "opaque" }, { type: "text", text: "hello" }] }
            : { choices: [{ message: { reasoning_content: "private reasoning", content: "hello" } }] }), { status: 200 });
        } });
        const gateway = new PluginAiGateway(provider);
        assert.equal((await gateway.complete({ messages: [{ role: "user", content: "hi" }] })).text, "hello");
        assert.equal((await gateway.stream({ messages: [{ role: "user", content: "hi" }] }, () => undefined)).text, "hello");
        const client = new TextModelClient(provider);
        assert.deepEqual(await client.generate({ messages: [{ role: "user", content: "hi" }], tools: [] }, new AbortController().signal), { type: "text", text: "hello" });
      }
    }
  }
  assert.equal(captures, 48);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log("MiniMax preset, persistence and 48 serialized provider requests verified.");
