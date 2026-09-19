import assert from "node:assert/strict";

import { calculatePetInteractiveShape, compactComposerGeometry, isRectangleContained } from "../src/pet-window-shape.js";
import { defaultPetWindowSize } from "../src/display.js";
import { calculateChatPanelBottom, defaultPetChatPanelLayout, expandedPetWindowSize } from "../src/default-pet-chat-geometry.js";

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

// --- Expanded Pet Interactive Shape (Bottom-Anchored Upward Growth) ---

{
  const scaledHeight = 32 * 3; // 96px
  const petBottom = 22;
  const expectedPanelBottom = calculateChatPanelBottom(scaledHeight, petBottom, defaultPetChatPanelLayout.gap);

  for (const panelHeight of [defaultPetChatPanelLayout.minHeight, 350, defaultPetChatPanelLayout.maxHeight]) {
    const shapeInfo = calculatePetInteractiveShape({
      windowWidth: expandedPetWindowSize.width,
      windowHeight: expandedPetWindowSize.height,
      spriteWidth: 32,
      spriteHeight: 32,
      scale: 3,
      hasBubble: true, // Should be suppressed when isExpanded: true
      isExpanded: true,
      panelWidth: defaultPetChatPanelLayout.width,
      panelHeight,
    });

    assert.equal(shapeInfo.shape.length, 2, "shape must contain pet hitbox and chat panel only (no bubble)");
    assert.notEqual(shapeInfo.chatPanel, undefined);
    assert.equal(shapeInfo.chatPanel?.width, defaultPetChatPanelLayout.width);
    assert.equal(shapeInfo.chatPanel?.height, panelHeight);

    // Invariant: The panel bottom edge is anchored exactly above the pet sprite
    assert.equal(shapeInfo.chatPanel!.y + shapeInfo.chatPanel!.height, expandedPetWindowSize.height - expectedPanelBottom);

    // Gap between top of pet sprite and bottom of chat panel is exactly 10px
    const petSpriteTop = expandedPetWindowSize.height - petBottom - scaledHeight;
    const panelBottomEdge = shapeInfo.chatPanel!.y + shapeInfo.chatPanel!.height;
    assert.equal(petSpriteTop - panelBottomEdge, defaultPetChatPanelLayout.gap);
  }
}

// --- Compact composer input shape ---

{
  const compactShapeInfo = calculatePetInteractiveShape({
    windowWidth: defaultPetWindowSize.width,
    windowHeight: defaultPetWindowSize.height,
    spriteWidth: 32,
    spriteHeight: 32,
    scale: 3,
    hasBubble: false,
    isExpanded: false,
    isCompactOpen: true,
  });

  assert.equal(compactShapeInfo.shape.length, 2, "open compact chat adds a second input region");
  assert.notEqual(compactShapeInfo.compactComposer, undefined);
  const composer = compactShapeInfo.compactComposer!;
  assert.equal(composer.width, compactComposerGeometry.maxWidth);
  assert.equal(composer.height, compactComposerGeometry.maxHeight);
  const expectedComposerY = defaultPetWindowSize.height - Math.ceil(22 + 32 * 3 + 8) - compactComposerGeometry.maxHeight;
  assert.equal(composer.y, expectedComposerY, "the input mask follows the composer's absolute bottom anchor");

  const contentX = composer.x + compactComposerGeometry.borderWidth;
  const contentWidth = composer.width - compactComposerGeometry.borderWidth * 2;
  const header = {
    x: contentX,
    y: composer.y + compactComposerGeometry.borderWidth,
    width: contentWidth,
    height: compactComposerGeometry.headerHeight,
  };
  const error = {
    x: contentX,
    y: header.y + header.height + compactComposerGeometry.gap,
    width: contentWidth,
    height: compactComposerGeometry.errorMaxHeight,
  };
  const form = {
    x: contentX,
    y: error.y + error.height + compactComposerGeometry.gap,
    width: contentWidth,
    height: compactComposerGeometry.textareaMaxHeight,
  };
  const textarea = { ...form, width: form.width - compactComposerGeometry.controlHeight - 5 };
  const controls = {
    x: textarea.x + textarea.width + 5,
    y: form.y + form.height - compactComposerGeometry.controlHeight,
    width: compactComposerGeometry.controlHeight,
    height: compactComposerGeometry.controlHeight,
  };

  for (const [name, part] of Object.entries({ header, error, textarea, controls })) {
    assert.ok(isRectangleContained(part, composer), `${name} must remain clickable inside the compact shape`);
  }
}

// --- Collapsed Pet with Pinned HUD ---

{
  const shapeWithPinned = calculatePetInteractiveShape({
    windowWidth: defaultPetWindowSize.width,
    windowHeight: defaultPetWindowSize.height,
    spriteWidth: 32,
    spriteHeight: 32,
    scale: 1,
    hasBubble: false,
    hasPinned: true,
    hudScale: 1.4,
    isExpanded: false,
  });

  assert.equal(shapeWithPinned.shape.length, 2, "pinned HUD adds an interactive HUD region");
  const hudRect = shapeWithPinned.shape[1];
  assert.ok(hudRect.width > 0 && hudRect.width <= defaultPetWindowSize.width);
  assert.ok(hudRect.height > 0);
  assert.equal(hudRect.y + hudRect.height, defaultPetWindowSize.height);
}

console.log("pet-window-shape tests passed.");
