import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import {
  clearConversationHistory,
  deleteConversationHistoryMessage,
  getConversationHistory,
} from "../src/pet-assistant-history-ipc.js";
import type { PetAssistantArchivedMessage } from "../src/pet-assistant-archive.js";

const desktopRoot = process.env.OPENPETS_DESKTOP_ROOT ?? new URL("../..", import.meta.url).pathname;

// 1. Test Control Center archive lifecycle state transitions (list -> delete single entry -> clear all)
{
  const storedMessages: PetAssistantArchivedMessage[] = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      conversationId: "openpets-control-center-current",
      turnId: "turn-1",
      role: "user",
      text: "First turn",
      createdAt: 1000,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      conversationId: "openpets-control-center-current",
      turnId: "turn-1",
      role: "assistant",
      text: "First answer",
      createdAt: 1001,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      conversationId: "openpets-control-center-current",
      turnId: "turn-2",
      role: "user",
      text: "Second turn",
      createdAt: 2000,
    },
  ];

  let currentStore = [...storedMessages];
  const controller = {
    getConversationHistory: () => [...currentStore],
    deleteConversationHistoryMessage: (id: string) => {
      const index = currentStore.findIndex((m) => m.id === id);
      if (index === -1) return false;
      currentStore.splice(index, 1);
      return true;
    },
    clearConversationHistory: () => {
      currentStore = [];
    },
  };

  // Initial list
  const initial = getConversationHistory(controller);
  assert.equal(initial.length, 3);
  assert.equal(initial[0]?.id, "11111111-1111-4111-8111-111111111111");

  // Invalid delete does not mutate
  const invalidDelete = deleteConversationHistoryMessage(controller, "non-existent-id");
  assert.deepEqual(invalidDelete, { deleted: false });
  assert.equal(getConversationHistory(controller).length, 3);

  // Single entry delete
  const deleteOne = deleteConversationHistoryMessage(controller, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(deleteOne, { deleted: true });
  const afterDelete = getConversationHistory(controller);
  assert.equal(afterDelete.length, 2);
  assert.equal(afterDelete[0]?.id, "22222222-2222-4222-8222-222222222222");

  // Clear all
  const clearResult = clearConversationHistory(controller);
  assert.deepEqual(clearResult, { cleared: true });
  const afterClear = getConversationHistory(controller);
  assert.deepEqual(afterClear, []);
}

// 2. Test Control Center preload bridge exposure
{
  const source = readFileSync(join(desktopRoot, "control-center-preload.cjs"), "utf8");
  let exposed: Record<string, (...args: any[]) => any> | undefined;
  const invoked: Array<{ channel: string; args: unknown[] }> = [];
  const ipcRenderer = {
    invoke: async (channel: string, ...args: unknown[]) => {
      invoked.push({ channel, args });
      return undefined;
    },
    on: () => {},
    removeListener: () => {},
    send: () => {},
  };

  runInNewContext(source, {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (_name: string, api: Record<string, (...args: any[]) => any>) => {
          exposed = api;
        },
      },
      ipcRenderer,
    }),
  });

  assert.ok(exposed);
  assert.equal(typeof exposed.getConversationHistory, "function");
  assert.equal(typeof exposed.deleteConversationHistoryMessage, "function");
  assert.equal(typeof exposed.clearConversationHistory, "function");

  // Pet chat events are NOT on Control Center preload
  assert.equal(exposed.onConversationEvent, undefined);

  // Test that bridge methods dispatch the correct IPC channels
  await exposed.getConversationHistory();
  await exposed.deleteConversationHistoryMessage("test-msg-id");
  await exposed.clearConversationHistory();

  assert.deepEqual(invoked.map((i) => i.channel), [
    "openpets:get-conversation-history",
    "openpets:delete-conversation-history-message",
    "openpets:clear-conversation-history",
  ]);
  assert.deepEqual(invoked[1]?.args, ["test-msg-id"]);
}

console.log("control-center archive behavior tests passed.");
