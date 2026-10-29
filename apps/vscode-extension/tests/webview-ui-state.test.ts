import assert from "node:assert/strict";
import { test } from "node:test";
import { validateWebviewUiState } from "../src/webview/backend.js";

test("restores only valid temporary UI choices", () => {
  const saved = {
    activeTab: "gallery",
    searchQuery: "cat",
    catalogPage: 3,
    dragOffset: { x: 12.5, y: 40 },
    snapshot: { selectedPetId: "stale" },
  };
  assert.deepEqual(validateWebviewUiState(saved), {
    activeTab: "gallery",
    searchQuery: "cat",
    catalogPage: 3,
    dragOffset: { x: 12.5, y: 40 },
  });
});

test("invalid saved values fall back without discarding valid fields", () => {
  assert.deepEqual(validateWebviewUiState({
    activeTab: "invalid",
    searchQuery: "dogs",
    catalogPage: -1,
    dragOffset: { x: Infinity, y: 8 },
  }), {
    activeTab: "companion",
    searchQuery: "dogs",
    catalogPage: 0,
    dragOffset: { x: 0, y: 8 },
  });
  assert.deepEqual(validateWebviewUiState(null), {
    activeTab: "companion",
    searchQuery: "",
    catalogPage: 0,
    dragOffset: { x: 0, y: 0 },
  });
});
