import assert from "node:assert/strict";

import { calculatePetInteractiveShape, isRectangleContained } from "../src/pet-window-shape.js";
import { defaultPetWindowSize } from "../src/display.js";
import { defaultPetChatPanelLayout, expandedPetWindowSize } from "../src/default-pet-chat-geometry.js";

// --- Collapsed Pet Interactive Shape ---

{
  const shapeInfo = calculatePetInteractiveShape({
    windowWidth: defaultPetWindowSize.width,
    windowHeight: defaultPetWindowSize.height,
    spriteWidth: 32,
    spriteHeight: 32,
    scale: 3,
    hasBubble: false,
    isExpanded: false,
  });

  assert.equal(shapeInfo.shape.length, 1);
  assert.equal(shapeInfo.chatPanel, undefined);
  assert.ok(shapeInfo.petHitbox.width > 0);
  assert.ok(shapeInfo.petHitbox.height > 0);
  assert.ok(isRectangleContained(shapeInfo.companionLauncher, shapeInfo.petHitbox));
}

// --- Collapsed Pet with Bubble ---

{
  const shapeWithBubble = calculatePetInteractiveShape({
    windowWidth: defaultPetWindowSize.width,
    windowHeight: defaultPetWindowSize.height,
    spriteWidth: 32,
    spriteHeight: 32,
    scale: 3,
    hasBubble: true,
    isExpanded: false,
  });

  assert.equal(shapeWithBubble.shape.length, 2);
  assert.equal(shapeWithBubble.chatPanel, undefined);
}

// --- Expanded Pet Interactive Shape (with In-Pet Attached Chat Panel) ---

{
  const expandedShapeInfo = calculatePetInteractiveShape({
    windowWidth: expandedPetWindowSize.width,
    windowHeight: expandedPetWindowSize.height,
    spriteWidth: 32,
    spriteHeight: 32,
    scale: 3,
    hasBubble: false,
    isExpanded: true,
    panelWidth: defaultPetChatPanelLayout.width,
    panelHeight: defaultPetChatPanelLayout.height,
    panelTop: defaultPetChatPanelLayout.top,
  });

  // Should include both pet hitbox and chat panel
  assert.equal(expandedShapeInfo.shape.length, 2);
  assert.notEqual(expandedShapeInfo.chatPanel, undefined);
  assert.equal(expandedShapeInfo.chatPanel?.width, defaultPetChatPanelLayout.width);
  assert.equal(expandedShapeInfo.chatPanel?.height, defaultPetChatPanelLayout.height);
  assert.equal(expandedShapeInfo.chatPanel?.y, defaultPetChatPanelLayout.top);

  // Chat panel should be centered in the expanded window
  const expectedPanelX = Math.round((expandedPetWindowSize.width - defaultPetChatPanelLayout.width) / 2);
  assert.equal(expandedShapeInfo.chatPanel?.x, expectedPanelX);

  // Pet hitbox remains anchored at the bottom
  assert.ok(expandedShapeInfo.petHitbox.y > (expandedShapeInfo.chatPanel?.y ?? 0));
}

console.log("pet-window-shape tests passed.");
