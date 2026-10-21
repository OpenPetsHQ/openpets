import assert from "node:assert/strict";
import { PetActivityService, type PetActivityCarrier } from "../src/pet-activity-service.js";
import { normalizePetActivityPreferences } from "../src/pet-activity-policy.js";
import type { PetActivity } from "../src/pet-activities-core.js";

const activities: readonly PetActivity[] = ["read", "stretch"].map((id) => ({
  id, displayName: id, outfitId: "default", spritesheetPath: `activities/${id}.webp`, frameCount: 8, fps: 4,
}));

function fixture(enabled: readonly string[] = ["read", "stretch"]) {
  let now = 0;
  let busy: string | null = null;
  const played: Array<{ id: string; generation: number; windowId: number }> = [];
  const stopped: number[] = [];
  const failed: string[] = [];
  const service = new PetActivityService({
    now: () => now,
    random: () => 0,
    enabledIds: () => enabled,
    onFailure: (_petId, activityId) => failed.push(activityId),
  });
  const carrier = (id = 1, outfitId = "default"): PetActivityCarrier => ({
    id, petId: "cat", activities, outfitId,
    availabilityReason: () => busy,
    play: (activity, generation) => played.push({ id: activity.id, generation, windowId: id }),
    stop: (generation) => stopped.push(generation),
  });
  service.register(carrier());
  return {
    service, played, stopped, failed, carrier,
    at(value: number) { now = value; service.tick(); },
    busy(value: string | null) { busy = value; },
  };
}

// Automatic playback is opt-in and cannot begin before continuous idle plus a random opportunity.
{
  const f = fixture([]);
  f.at(0);
  f.at(120_000);
  assert.equal(f.played.length, 0);
  const enabled = fixture();
  enabled.at(0);
  enabled.at(119_999);
  assert.equal(enabled.played.length, 0);
  enabled.at(120_000);
  assert.equal(enabled.played[0]?.id, "read");
}

// Raw busy signals/movement cancel playback and reset idle; there is no missed-work backlog.
{
  const f = fixture();
  f.at(0);
  f.at(119_000);
  f.service.cancel(1);
  f.at(120_000);
  assert.equal(f.played.length, 0);
  f.at(240_000);
  assert.equal(f.played.length, 1);
  f.busy("agent is working even if its mapped sprite is idle");
  f.at(240_001);
  assert.equal(f.service.getPlayingActivityId("cat"), null);
  assert.equal(f.stopped.length, 1);
  f.busy(null);
  f.at(1_000_000);
  assert.equal(f.played.length, 1);
}

// Cooldowns and repeat history are per pet, even when another carrier performs the next activity.
{
  const f = fixture();
  f.service.register(f.carrier(2));
  f.service.play("cat", "read");
  assert.throws(() => f.service.play("cat", "stretch"), /already playing/);
  const first = f.played[0]!;
  f.service.complete(first.windowId, first.generation);
  f.service.remove(1);
  f.at(0);
  f.at(120_000);
  assert.equal(f.played[1]?.id, "stretch");
  assert.equal(f.played[1]?.windowId, 2);
  const second = f.played[1]!;
  f.service.complete(second.windowId, second.generation);
  f.at(120_000);
  f.at(240_000);
  assert.equal(f.played.length, 2, "the previous read is still cooling down");
  f.at(360_000);
  assert.equal(f.played[2]?.id, "read");
}

// A sole enabled activity can repeat later, but cannot become a continuous playlist.
{
  const f = fixture(["read"]);
  f.service.play("cat", "read");
  const first = f.played[0]!;
  f.service.complete(1, first.generation);
  f.at(0);
  f.at(120_000);
  f.at(240_000);
  assert.equal(f.played.length, 1);
  f.at(360_000);
  assert.equal(f.played.length, 2);
}

// Manual ignores timing/preferences, but not appearance, busy state or missing windows.
{
  const f = fixture([]);
  f.service.play("cat", "read");
  const first = f.played[0]!;
  f.service.complete(1, first.generation);
  f.service.play("cat", "read");
  assert.equal(f.played.length, 2);
  f.service.cancel(1);
  f.service.register(f.carrier(1, "pajamas"));
  assert.throws(() => f.service.play("cat", "read"), /default outfit/);
  f.service.register(f.carrier());
  f.busy("chat is open");
  assert.throws(() => f.service.play("cat", "read"), /chat is open/);
  f.service.remove(1);
  assert.throws(() => f.service.play("cat", "read"), /Show this pet/);
}

// Stale completion never stops a replacement; renderer failures disable only the optional activity.
{
  const f = fixture();
  f.service.play("cat", "read");
  const first = f.played[0]!;
  f.service.register(f.carrier());
  f.service.play("cat", "stretch");
  const second = f.played[1]!;
  f.service.complete(1, first.generation, true);
  assert.equal(f.service.getPlayingActivityId("cat"), "stretch");
  assert.deepEqual(f.failed, []);
  f.service.complete(1, second.generation, true);
  assert.deepEqual(f.failed, ["stretch"]);
  assert.throws(() => f.service.play("cat", "stretch"), /unavailable/);
  f.service.play("cat", "read");
  f.service.stop();
  assert.equal(f.service.getPlayingActivityId("cat"), null);
}

// A renderer that never completes cannot retain playback ownership indefinitely.
{
  const f = fixture();
  f.service.play("cat", "read");
  f.at(7_001);
  assert.equal(f.service.getPlayingActivityId("cat"), null);
  assert.deepEqual(f.failed, ["read"]);
  assert.equal(f.stopped.length, 1);
}

assert.equal(normalizePetActivityPreferences(undefined), undefined);
assert.deepEqual(normalizePetActivityPreferences({ cat: ["read", "read", "cat_nap", false, "../bad"], dog: [] }), { cat: ["read", "cat_nap"] });
console.log("Native activity scheduling, interruption, appearance and ownership behavior passed.");
