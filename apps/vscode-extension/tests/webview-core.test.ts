import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPetSprite } from "@open-pets/pet-format/animation";
import { codexV1SpriteLayout, codexV2SpriteLayout } from "@open-pets/pet-format/sprite-layout";
import { clampSpritePosition, getCompanionFrame, getSpriteSize, isDragMovement } from "../src/webview/companion-core.js";
import { acceptSnapshot, acceptSurface, projectCatalogInstallations } from "../src/webview/view-state.js";
import type { CatalogPetView, CompanionSnapshot, SurfaceState } from "../src/protocol.js";

test("both atlas versions animate idle and click completes before returning to idle", () => {
  const idle = defaultPetSprite.states.idle;
  const click = defaultPetSprite.states.jumping;
  const clickDuration = click.durationMs * click.iterations;
  for (const layout of [codexV1SpriteLayout, codexV2SpriteLayout]) {
    const first = getCompanionFrame(layout, 0);
    const later = getCompanionFrame(layout, idle.durationMs / 2);
    assert.equal(first.state, "idle");
    assert.notEqual(first.column, later.column);
    assert.equal(getCompanionFrame(layout, 0, true).state, "jumping");
    assert.equal(getCompanionFrame(layout, clickDuration - 1, true).state, "jumping");
    assert.deepEqual(getCompanionFrame(layout, clickDuration, true), first);
    assert.notEqual(getCompanionFrame(layout, clickDuration + idle.durationMs / 2, true).column, first.column);
  }
});

test("sprite sizes and containment handle small and changing stages", () => {
  const small = getSpriteSize(codexV1SpriteLayout, "small");
  const medium = getSpriteSize(codexV2SpriteLayout, "medium");
  const large = getSpriteSize(codexV2SpriteLayout, "large");
  assert.deepEqual(small, { width: 48, height: 52 });
  assert.deepEqual(medium, { width: 72, height: 78 });
  assert.deepEqual(large, { width: 96, height: 104 });
  for (const layout of [codexV1SpriteLayout, codexV2SpriteLayout]) {
    assert.deepEqual(getSpriteSize(layout, "small"), small);
    assert.deepEqual(getSpriteSize(layout, "medium"), medium);
    assert.deepEqual(getSpriteSize(layout, "large"), large);
  }
  assert.deepEqual(clampSpritePosition({ x: 999, y: -4 }, { width: 300, height: 250 }, large), { x: 204, y: 0 });
  assert.deepEqual(clampSpritePosition({ x: 30, y: 20 }, { width: 40, height: 45 }, small), { x: 0, y: 0 });
  assert.equal(isDragMovement({ x: 0, y: 0 }, { x: 2, y: 2 }, 4), false);
  assert.equal(isDragMovement({ x: 0, y: 0 }, { x: 3, y: 4 }, 4), true);
});

test("late ready and mutation results cannot overwrite newer event state", () => {
  const snapshot = (revision: number): CompanionSnapshot => ({
    revision,
    size: "medium",
    selectedPetId: "builtin",
    installedPets: [],
    active: { petId: "builtin", outfitId: "default", sprite: { uri: "pet", layout: codexV2SpriteLayout } },
  });
  const surface = (sequence: number): SurfaceState => ({ surfaceId: "view", kind: "view", visible: true, playbackEnabled: true, sequence });
  const newestSnapshot = snapshot(3);
  const newestSurface = surface(4);
  const afterReadySnapshot = acceptSnapshot(newestSnapshot, snapshot(1));
  const afterReadySurface = acceptSurface(newestSurface, surface(2));
  assert.equal(afterReadySnapshot, newestSnapshot);
  assert.equal(afterReadySurface, newestSurface);
  assert.equal(acceptSnapshot(afterReadySnapshot, snapshot(2)), newestSnapshot);
  assert.equal(acceptSurface(afterReadySurface, surface(3)), newestSurface);
  const newer = snapshot(5);
  assert.equal(acceptSnapshot(afterReadySnapshot, newer), newer);
});

test("cached gallery cards reflect current catalog installations, not old flags or bundled pets", () => {
  const sprite = { uri: "pet", layout: codexV2SpriteLayout };
  const card: CatalogPetView = {
    id: "hoodie-cat", displayName: "Hoodie Cat", description: "Cat", thumbnailUri: "thumbnail", sprite,
    category: "western", original: true, featured: true, installed: false, hasWardrobe: true, canInstall: true,
  };
  const builtin = { id: "builtin", displayName: "Hoodie Cat", description: "Cat", source: "builtin" as const, outfits: [], wardrobeAction: "none" as const };
  const snapshot: CompanionSnapshot = {
    revision: 1, size: "medium", selectedPetId: "builtin", installedPets: [builtin],
    active: { petId: "builtin", outfitId: "default", sprite },
  };
  assert.equal(projectCatalogInstallations([card], snapshot)[0]?.installed, false);
  const catalogPet = { ...builtin, id: "hoodie-cat", source: "catalog" as const };
  assert.equal(projectCatalogInstallations([card], { ...snapshot, revision: 2, installedPets: [builtin, catalogPet] })[0]?.installed, true);
  assert.equal(projectCatalogInstallations([{ ...card, installed: true }], snapshot)[0]?.installed, false);
  assert.equal(card.installed, false);
});
