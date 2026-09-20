import assert from "node:assert/strict";

import {
  clearConversationHistory,
  deleteConversationHistoryMessage,
  getConversationHistory,
} from "../src/pet-assistant-history-ipc.js";
import type { PetAssistantArchivedMessage } from "../src/pet-assistant-archive.js";

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

console.log("control-center archive behavior tests passed.");
