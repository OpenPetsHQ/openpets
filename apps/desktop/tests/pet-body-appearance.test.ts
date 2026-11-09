import assert from "node:assert/strict";
import { it } from "node:test";
import { createMotionAppearance, createPetBodyState } from "../src/pet-body-state.js";
import type { MotionBodyDescriptor, PetBodySnapshot } from "../src/pet-body-contract.js";

const assets = { snapshotId: "snapshot" } as MotionBodyDescriptor;

it("keeps the same appearance for HUD updates and allocates for explicit retry", () => {
  let next = 0;
  const allocate = () => String(++next);
  const first = createMotionAppearance(null, assets, "default", "initial", false, allocate);
  assert.equal(createMotionAppearance(first, assets, "default", "manual", false, allocate), first);
  assert.notEqual(createMotionAppearance(first, assets, "default", "manual", true, allocate).presentationId, first.presentationId);
  assert.notEqual(createMotionAppearance(first, assets, "night", "scheduled", false, allocate).presentationId, first.presentationId);
});

it("promotes a scheduled outfit once when the same outfit is manually chosen", () => {
  const snapshots: PetBodySnapshot[] = [];
  const state = createPetBodyState((snapshot) => snapshots.push(snapshot), () => {});
  const scheduled = state.prepareMotionAppearance(assets, "night", "scheduled", false);
  state.publishMotionAppearance(scheduled);
  const hud = state.prepareMotionAppearance(assets, "night", "manual", false);
  assert.equal(hud, scheduled);
  state.publishMotionAppearance(hud);
  const manual = state.prepareMotionAppearance(assets, "night", "manual", false, true);
  assert.notEqual(manual.presentationId, scheduled.presentationId);
  assert.equal(manual.reason, "manual");
  state.publishMotionAppearance(manual);
  assert.equal(state.prepareMotionAppearance(assets, "night", "manual", false), manual);
  assert.equal(snapshots.at(-1)!.motion, manual);
});

it("tracks a newly started event on the presented outfit while replacement is pending", () => {
  const snapshots: PetBodySnapshot[] = [];
  const results: string[] = [];
  const state = createPetBodyState((snapshot) => snapshots.push(snapshot), (appearance, outcome) => results.push(`${appearance.presentationId}:${outcome}`));
  const a = state.prepareMotionAppearance(assets, "default", "initial", false);
  state.publishMotionAppearance(a);
  const epoch = snapshots.at(-1)!.input.epoch;
  state.result({ epoch, snapshotId: "snapshot", presentationId: a.presentationId, outfitId: "default", playbackId: 1, outcome: "started" });
  const b = state.prepareMotionAppearance(assets, "night", "scheduled", false);
  state.publishMotionAppearance(b);
  state.react("success");
  const intentId = snapshots.at(-1)!.input.event!.id;
  state.result({ epoch, snapshotId: "snapshot", presentationId: a.presentationId, outfitId: "default", playbackId: 7, intentId, outcome: "started" });
  state.result({ epoch, snapshotId: "snapshot", presentationId: a.presentationId, outfitId: "default", playbackId: 8, intentId, outcome: "completed" });
  assert.equal(snapshots.at(-1)!.input.event?.id, intentId);
  state.result({ epoch, snapshotId: "snapshot", presentationId: a.presentationId, outfitId: "default", playbackId: 7, intentId, outcome: "completed" });
  assert.equal(snapshots.at(-1)!.input.event, undefined);
  state.result({ epoch, snapshotId: "snapshot", presentationId: b.presentationId, outfitId: "night", playbackId: 2, outcome: "started" });
  assert.deepEqual(results, [`${a.presentationId}:started`, `${b.presentationId}:started`]);
});

it("accepts old semantic completion while a new outfit is pending, rejecting stale presentations", () => {
  const snapshots: PetBodySnapshot[] = [];
  const results: string[] = [];
  const state = createPetBodyState((snapshot) => snapshots.push(snapshot), (appearance, outcome) => results.push(`${appearance.presentationId}:${outcome}`));
  const a = state.prepareMotionAppearance(assets, "default", "initial", false);
  assert.equal(state.publishMotionAppearance(a), true);
  const epoch = snapshots.at(-1)!.input.epoch;
  state.react("success");
  const intentId = snapshots.at(-1)!.input.event!.id;
  state.result({ epoch, snapshotId: "snapshot", presentationId: a.presentationId, outfitId: "default", playbackId: 1, intentId, outcome: "started" });
  const b = state.prepareMotionAppearance(assets, "night", "scheduled", false);
  state.publishMotionAppearance(b);
  state.result({ epoch, snapshotId: "snapshot", presentationId: b.presentationId, outfitId: "night", playbackId: 2, outcome: "deferred" });
  assert.equal(snapshots.at(-1)!.input.event?.id, intentId);
  state.result({ epoch, snapshotId: "snapshot", presentationId: a.presentationId, outfitId: "default", playbackId: 9, intentId, outcome: "completed" });
  assert.equal(snapshots.at(-1)!.input.event?.id, intentId);
  state.result({ epoch, snapshotId: "snapshot", presentationId: a.presentationId, outfitId: "default", playbackId: 1, intentId, outcome: "completed" });
  assert.equal(snapshots.at(-1)!.input.event, undefined);
  state.result({ epoch, snapshotId: "snapshot", presentationId: a.presentationId, outfitId: "default", playbackId: 3, outcome: "started" });
  state.result({ epoch, snapshotId: "snapshot", presentationId: b.presentationId, outfitId: "night", playbackId: 2, outcome: "started" });
  assert.deepEqual(results, [`${a.presentationId}:started`, `${b.presentationId}:deferred`, `${b.presentationId}:started`]);
});

it("rejects a candidate superseded before publication", () => {
  const state = createPetBodyState(() => {}, () => {});
  const a = state.prepareMotionAppearance(assets, "default", "initial", false);
  const b = state.prepareMotionAppearance(assets, "night", "manual", false);
  assert.equal(state.publishMotionAppearance(a), false);
  assert.equal(state.publishMotionAppearance(b), true);
});
