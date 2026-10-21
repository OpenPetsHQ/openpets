import assert from "node:assert/strict";
import { installControlCenterPetActivitiesIpcHandlers } from "../src/control-center-pet-activities-ipc.js";
import type { PetActivitiesSnapshot } from "../src/pet-activities-types.js";

type Event = { readonly sender: { readonly id: number } };
type Handler = (event: Event, payload: unknown) => Promise<PetActivitiesSnapshot>;
const handlers = new Map<string, Handler>();
const calls: unknown[][] = [];
const snapshot: PetActivitiesSnapshot = {
  petId: "cat", activities: [], availabilityReason: null, playingActivityId: null,
};
installControlCenterPetActivitiesIpcHandlers({
  registerHandle: (channel, handler) => { handlers.set(channel, handler); },
  authorizeSender: (event) => {
    if (event.sender.id !== 1) throw new Error("Not authorized.");
  },
  getPetActivities: async (petId) => { calls.push(["get", petId]); return snapshot; },
  setPetActivityEnabled: async (petId, activityId, enabled) => { calls.push(["enable", petId, activityId, enabled]); return snapshot; },
  playPetActivity: async (petId, activityId) => { calls.push(["play", petId, activityId]); return snapshot; },
});
const allowed = { sender: { id: 1 } };
const denied = { sender: { id: 2 } };
const get = handlers.get("openpets:get-pet-activities")!;
const enable = handlers.get("openpets:set-pet-activity-enabled")!;
const play = handlers.get("openpets:play-pet-activity")!;

// Untrusted windows cannot discover or mutate native activity state.
for (const handler of [get, enable, play]) {
  await assert.rejects(handler(denied, { petId: "cat", activityId: "read", enabled: true }), /Not authorized/);
}
assert.deepEqual(calls, []);

// Boundary validation rejects malformed preference mutations before the persistence owner sees them.
await assert.rejects(enable(allowed, { petId: "cat", activityId: "read", enabled: "yes" }), /Invalid/);
await assert.rejects(play(allowed, { petId: "cat" }), /Invalid/);
await assert.rejects(get(allowed, {}), /Invalid/);
assert.deepEqual(calls, []);

assert.equal(await get(allowed, "cat"), snapshot);
assert.equal(await enable(allowed, { petId: "cat", activityId: "read", enabled: true }), snapshot);
assert.equal(await play(allowed, { petId: "cat", activityId: "read" }), snapshot);
assert.deepEqual(calls, [["get", "cat"], ["enable", "cat", "read", true], ["play", "cat", "read"]]);
console.log("Control Center native activity authorization and preference boundary behavior passed.");
