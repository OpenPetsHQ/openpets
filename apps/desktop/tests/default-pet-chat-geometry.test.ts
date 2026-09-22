import assert from "node:assert/strict";

import {
  calculateChatPanelBottom,
  calculateChatPanelY,
  calculateCollapsedCarrierBounds,
  calculateExpandedCarrierBounds,
  defaultPetChatPanelLayout,
  expandedPetWindowSize,
  toCollapsedPosition,
  toExpandedPosition,
} from "../src/default-pet-chat-geometry.js";
import { defaultPetWindowSize } from "../src/display.js";

// --- Bijective anchor coordinate transformation tests -------------------------

{
  const collapsedPos = { x: 500, y: 700 };
  const expandedPos = toExpandedPosition(collapsedPos, defaultPetWindowSize, expandedPetWindowSize);

  // Expanding shifts x to left by half the width delta, and y up by height delta
  const expectedX = Math.round(500 + (defaultPetWindowSize.width - expandedPetWindowSize.width) / 2);
  const expectedY = Math.round(700 + (defaultPetWindowSize.height - expandedPetWindowSize.height));

  assert.equal(expandedPos.x, expectedX);
  assert.equal(expandedPos.y, expectedY);

  // Round trip restores exact coordinates
  const restoredCollapsed = toCollapsedPosition(expandedPos, expandedPetWindowSize, defaultPetWindowSize);
  assert.equal(restoredCollapsed.x, collapsedPos.x);
  assert.equal(restoredCollapsed.y, collapsedPos.y);

  // Invariant: The pet bottom-center anchor on screen remains identical
  const collapsedAnchorX = collapsedPos.x + defaultPetWindowSize.width / 2;
  const collapsedAnchorY = collapsedPos.y + defaultPetWindowSize.height;
  const expandedAnchorX = expandedPos.x + expandedPetWindowSize.width / 2;
  const expandedAnchorY = expandedPos.y + expandedPetWindowSize.height;

  assert.equal(collapsedAnchorX, expandedAnchorX);
  assert.equal(collapsedAnchorY, expandedAnchorY);
}

// --- Work-area clamping tests ------------------------------------------------

{
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

  // 1. Normal position within work area
  const normalPos = { x: 800, y: 800 };
  const expandedBounds = calculateExpandedCarrierBounds(normalPos, defaultPetWindowSize, expandedPetWindowSize, workArea);
  assert.equal(expandedBounds.width, expandedPetWindowSize.width);
  assert.equal(expandedBounds.height, expandedPetWindowSize.height);
  assert.ok(expandedBounds.x >= workArea.x && expandedBounds.x + expandedBounds.width <= workArea.x + workArea.width);
  assert.ok(expandedBounds.y >= workArea.y && expandedBounds.y + expandedBounds.height <= workArea.y + workArea.height);

  // 2. Position near top-left edge that would overflow left/top when expanded
  const nearOrigin = { x: 10, y: 50 };
  const clampedBounds = calculateExpandedCarrierBounds(nearOrigin, defaultPetWindowSize, expandedPetWindowSize, workArea);
  assert.equal(clampedBounds.x, workArea.x);
  assert.equal(clampedBounds.y, workArea.y);

  // 3. Collapsing bounds clamping
  const expandedFarRight = { x: 1800, y: 900 };
  const collapsedBounds = calculateCollapsedCarrierBounds(expandedFarRight, expandedPetWindowSize, defaultPetWindowSize, workArea);
  assert.equal(collapsedBounds.width, defaultPetWindowSize.width);
  assert.equal(collapsedBounds.height, defaultPetWindowSize.height);
  assert.ok(collapsedBounds.x <= workArea.x + workArea.width - defaultPetWindowSize.width);
}

// --- Panel layout geometry constants -----------------------------------------

{
  assert.ok(defaultPetChatPanelLayout.width > 0);
  assert.ok(defaultPetChatPanelLayout.height > 0);
  assert.ok(defaultPetChatPanelLayout.minHeight > 0);
  assert.ok(defaultPetChatPanelLayout.maxHeight >= defaultPetChatPanelLayout.minHeight);
  assert.equal(defaultPetChatPanelLayout.gap, 10);
  assert.ok(defaultPetChatPanelLayout.width <= expandedPetWindowSize.width);
  assert.ok(defaultPetChatPanelLayout.height <= expandedPetWindowSize.height);
  assert.equal(defaultPetChatPanelLayout.insetX, Math.round((expandedPetWindowSize.width - defaultPetChatPanelLayout.width) / 2));
}

// --- Bottom-relative panel geometry & upward growth -------------------------

{
  const scaledSpriteHeight = 96; // 32px frame at 3x scale
  const petBottom = 22;
  const gap = 10;
  const panelBottom = calculateChatPanelBottom(scaledSpriteHeight, petBottom, gap);

  // Panel bottom edge is petBottom + scaledSpriteHeight + gap
  assert.equal(panelBottom, 22 + 96 + 10);

  // When panel height varies (e.g. 220px compact vs 500px maximum), bottom edge remains invariant
  const heights = [220, 300, 420, 500];
  const windowHeight = expandedPetWindowSize.height;

  for (const height of heights) {
    const y = calculateChatPanelY(windowHeight, height, panelBottom);
    // Invariant: The bottom edge of the panel inside the window (y + height) is always windowHeight - panelBottom
    assert.equal(y + height, windowHeight - panelBottom);
    // Panel top moves upward as height increases
    assert.equal(y, windowHeight - panelBottom - height);
  }

  // Pinned lift offsets panel bottom while preserving the exact 10px gap above the lifted pet
  const pinnedLift = 39; // e.g. HUD scale 1.4
  const panelBottomWithPinned = calculateChatPanelBottom(scaledSpriteHeight, petBottom, gap, pinnedLift);
  assert.equal(panelBottomWithPinned, panelBottom + pinnedLift);
}

console.log("default-pet-chat-geometry tests passed.");
