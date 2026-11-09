import assert from "node:assert/strict";
import { it } from "node:test";
import type { MotionBodyDescriptor, PetBodySnapshot } from "../src/pet-body-contract.js";
import { createPetBodyState, createPetBodyVisibility, effectivePetBodyContext, isCurrentPetContentCommit, replacePluginSpriteWithReaction, updateLoadedPetDocument } from "../src/pet-body-state.js";

it("suspends a hidden pet, discards events, and resumes its latest context", () => {
  const snapshots: PetBodySnapshot[] = [];
  const commits: string[] = [];
  const state = createPetBodyState((snapshot) => snapshots.push(snapshot), (id) => commits.push(id));
  state.setMotion({ snapshotId: "one" } as MotionBodyDescriptor);
  state.react("working");
  state.react("success");
  const previous = snapshots.at(-1)!.input;
  state.setSuspended(true);
  assert.equal(snapshots.at(-1)!.input.suspended, true);
  assert.equal(snapshots.at(-1)!.input.event, undefined);
  state.react("waiting");
  state.react("error");
  state.result({ epoch: previous.epoch, snapshotId: "one", playbackId: 1, outcome: "started" });
  state.setSuspended(false);
  assert.equal(snapshots.at(-1)!.input.suspended, false);
  assert.equal(snapshots.at(-1)!.input.context, "waiting");
  assert.equal(snapshots.at(-1)!.input.event, undefined);
  assert.deepEqual(commits, []);
});

it("uses logical layer visibility even when its offscreen document is hidden", () => {
  const changes: boolean[] = [];
  const offscreen = { documentHidden: true };
  const visibility = createPetBodyVisibility(false, (suspended) => changes.push(suspended));
  visibility.setVisible(true);
  assert.equal(offscreen.documentHidden, true);
  assert.equal(changes.at(-1), false);
  visibility.setSystemSuspended(true);
  assert.equal(changes.at(-1), true);
  visibility.setVisible(false);
  visibility.setSystemSuspended(false);
  assert.equal(changes.at(-1), true);
  visibility.setVisible(true);
  assert.equal(changes.at(-1), false);
});

it("tracks host show and hide, not a native occlusion notification", () => {
  const snapshots: PetBodySnapshot[] = [];
  const state = createPetBodyState((snapshot) => snapshots.push(snapshot), () => {});
  const visibility = createPetBodyVisibility(false, (suspended) => state.setSuspended(suspended));
  state.ready();
  assert.equal(snapshots.at(-1)!.input.suspended, true, "unshown gated window remains suspended");
  let shown = false;
  visibility.show(() => { shown = true; });
  assert.equal(shown, true);
  assert.equal(snapshots.at(-1)!.input.suspended, false);
  visibility.syncNative(() => ({ visible: true, minimized: false }), "native-hide");
  assert.equal(snapshots.at(-1)!.input.suspended, false, "occlusion does not hide a visible pet");
  visibility.hide(() => { shown = false; });
  assert.equal(shown, false);
  assert.equal(snapshots.at(-1)!.input.suspended, true);
});

it("does not mark a pet shown when the native show fails", () => {
  const changes: boolean[] = [];
  const visibility = createPetBodyVisibility(false, (suspended) => changes.push(suspended));
  assert.throws(() => visibility.show(() => { throw new Error("show failed"); }));
  assert.deepEqual(changes, [true]);
});

it("admits a named reaction when it replaces a plugin sprite", () => {
  let pluginSpriteActive = true;
  let admitted = false;
  replacePluginSpriteWithReaction(
    () => { pluginSpriteActive = false; },
    () => { admitted = !pluginSpriteActive; },
  );
  assert.equal(admitted, true);
});

it("updates loaded documents rather than navigating for appearance changes", () => {
  const applied: string[] = [];
  let navigations = 0;
  for (const change of ["pause", "scale", "motion replacement"]) {
    if (!updateLoadedPetDocument(true, 4, 4, "file:///pet.html", () => applied.push(change))) navigations += 1;
  }
  assert.deepEqual(applied, ["pause", "scale", "motion replacement"]);
  assert.equal(navigations, 0);
  assert.equal(updateLoadedPetDocument(true, 5, 4, "file:///pet.html", () => assert.fail("stale update")), false);
  assert.equal(updateLoadedPetDocument(true, 4, 4, "https://example.com", () => assert.fail("untrusted document")), false);
  assert.equal(updateLoadedPetDocument(false, 4, 4, "file:///pet.html", () => assert.fail("unready document")), false);
});

it("rejects stale content acknowledgements", () => {
  assert.equal(isCurrentPetContentCommit("2:5", 5, 5, "2:5"), true);
  assert.equal(isCurrentPetContentCommit("2:5", 5, 6, "2:5"), false);
  assert.equal(isCurrentPetContentCommit("2:5", 5, 5, "2:4"), false);
});

it("restores the underlying work context after voice clears", () => {
  assert.equal(effectivePetBodyContext("working", "waiting"), "waiting");
  assert.equal(effectivePetBodyContext("working", null), "working");
});

it("invalidates playback after navigation without replaying the event", () => {
  const snapshots: PetBodySnapshot[] = [];
  const commits: string[] = [];
  const state = createPetBodyState((snapshot) => snapshots.push(snapshot), (id) => commits.push(id));
  state.setMotion({ snapshotId: "one" } as MotionBodyDescriptor);
  state.react("working");
  state.react("success");
  const old = snapshots.at(-1)!.input;
  state.documentLost();
  state.result({ epoch: old.epoch, snapshotId: "one", playbackId: 1, outcome: "started", intentId: old.event?.id });
  state.ready();
  assert.notEqual(snapshots.at(-1)!.input.epoch, old.epoch);
  assert.equal(snapshots.at(-1)!.input.context, "working");
  assert.equal(snapshots.at(-1)!.input.event, undefined);
  assert.deepEqual(commits, []);
});

it("does not mint a new event during an appearance or pause refresh", () => {
  const snapshots: PetBodySnapshot[] = [];
  const state = createPetBodyState((snapshot) => snapshots.push(snapshot), () => {});
  const motion = { snapshotId: "one" } as MotionBodyDescriptor;
  state.setMotion(motion);
  state.react("success");
  const event = snapshots.at(-1)!.input.event!;
  state.setMotion(motion);
  state.setPaused(true);
  state.ready();
  assert.equal(snapshots.at(-1)!.input.event?.id, event.id);
});

it("retains context through transient event completion and ignores stale playback", () => {
  const snapshots: PetBodySnapshot[] = [];
  const commits: string[] = [];
  const state = createPetBodyState((snapshot) => snapshots.push(snapshot), (id) => commits.push(id));
  const motion = { snapshotId: "package-1" } as MotionBodyDescriptor;
  state.setMotion(motion);
  state.react("working");
  state.react("success");
  const event = snapshots.at(-1)!.input.event!;
  const epoch = snapshots.at(-1)!.input.epoch;
  state.react("waiting");
  state.result({ epoch, snapshotId: "package-1", playbackId: 3, outcome: "started", intentId: event.id });
  state.result({ epoch, snapshotId: "package-1", playbackId: 2, outcome: "completed", intentId: "older-event" });
  assert.equal(snapshots.at(-1)!.input.event?.id, event.id);
  state.result({ epoch, snapshotId: "package-1", playbackId: 3, outcome: "completed", intentId: event.id });
  assert.equal(snapshots.at(-1)!.input.context, "waiting");
  assert.equal(snapshots.at(-1)!.input.event, undefined);
  assert.deepEqual(commits, ["package-1"]);
});

it("commits a presented frame after a newer event attempt was declined", () => {
  const snapshots: PetBodySnapshot[] = [];
  const commits: string[] = [];
  const state = createPetBodyState((snapshot) => snapshots.push(snapshot), (id) => commits.push(id));
  state.setMotion({ snapshotId: "one" } as MotionBodyDescriptor);
  state.react("success");
  const input = snapshots.at(-1)!.input;
  state.result({ epoch: input.epoch, snapshotId: "one", playbackId: 2, intentId: input.event!.id, outcome: "cancelled" });
  assert.equal(snapshots.at(-1)!.input.event, undefined);
  state.result({ epoch: "old-epoch", snapshotId: "one", playbackId: 1, outcome: "started" });
  state.result({ epoch: input.epoch, snapshotId: "old-snapshot", playbackId: 1, outcome: "started" });
  assert.deepEqual(commits, []);
  state.result({ epoch: input.epoch, snapshotId: "one", playbackId: 1, outcome: "started" });
  assert.deepEqual(commits, ["one"]);
});

it("does not let a stale package or event clear a newer event", () => {
  const snapshots: PetBodySnapshot[] = [];
  const state = createPetBodyState((snapshot) => snapshots.push(snapshot), () => {});
  state.setMotion({ snapshotId: "one" } as MotionBodyDescriptor);
  state.react("success");
  const old = snapshots.at(-1)!.input.event!;
  state.react("error");
  const current = snapshots.at(-1)!.input;
  state.setMotion({ snapshotId: "two" } as MotionBodyDescriptor);
  state.react("waving");
  const replacement = snapshots.at(-1)!.input.event!;
  state.result({ epoch: current.epoch, snapshotId: "one", playbackId: 1, intentId: old.id, outcome: "cancelled" });
  assert.equal(snapshots.at(-1)!.input.event?.id, replacement.id);
  state.result({ epoch: current.epoch, snapshotId: "two", playbackId: 2, intentId: replacement.id, outcome: "cancelled" });
  assert.equal(snapshots.at(-1)!.input.event, undefined);
});
