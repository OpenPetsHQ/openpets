import assert from "node:assert/strict";
import { it } from "node:test";
import { commitRenderedOutfit, failOutfitRequest, forgetOutfitWindow, getRenderedOutfits, noteOutfitRequest, subscribeRenderedOutfits } from "../src/pet-wardrobe-render-state.js";

it("tracks each window independently through pending, failure, and cleanup", () => {
  const notifications: string[] = [];
  const unsubscribe = subscribeRenderedOutfits((petId) => notifications.push(petId));
  try {
    noteOutfitRequest(1, "cat", "default", "a", false, true);
    commitRenderedOutfit(1, "cat", "a");
    noteOutfitRequest(2, "cat", "night", "b", true, false);
    noteOutfitRequest(1, "cat", "night", "c", false, true);
    commitRenderedOutfit(1, "cat", "a");
    failOutfitRequest(1, "cat", "c", "failed", "decode failed");
    const windows = getRenderedOutfits("cat");
    assert.equal(windows.find((entry) => entry.windowId === 1)?.outfitId, "default");
    assert.equal(windows.find((entry) => entry.windowId === 1)?.isDefault, true);
    assert.equal(windows.find((entry) => entry.windowId === 1)?.status, "failed");
    assert.equal(windows.find((entry) => entry.windowId === 2)?.status, "deferred");
    commitRenderedOutfit(2, "cat", "b");
    assert.equal(getRenderedOutfits("cat").find((entry) => entry.windowId === 2)?.outfitId, "night");
    forgetOutfitWindow(1);
    assert.equal(getRenderedOutfits("cat").length, 1);
    assert.ok(notifications.includes("cat"));
  } finally {
    forgetOutfitWindow(1);
    forgetOutfitWindow(2);
    unsubscribe();
  }
});
