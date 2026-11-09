import assert from "node:assert/strict";
import { PetActivityService, type PetActivityCarrier } from "../src/pet-activity-service.js";
import { normalizePetActivityPreferences } from "../src/pet-activity-policy.js";

const activities = ["read", "stretch"].map((id) => ({ id, displayName: id, durationMs: 2000 }));

function fixture(enabled: readonly string[] = ["read", "stretch"]) {
  let now = 0;
  let busy: string | null = null;
  const played: Array<{ id: string; generation: number; windowId: number }> = [];
  const stopped: number[] = [];
  const failed: string[] = [];
  let variations = 0;
  const service = new PetActivityService({
    now: () => now, random: () => 0, enabledIds: () => enabled,
    onFailure: (_pet, id, outfit, revision) => failed.push(`${id}:${outfit}:${revision}`),
  });
  const carrier = (id = 1, outfitId = "default", revision = "v1"): PetActivityCarrier => ({
    id, petId: "cat", outfitId, revision, failureRevision: revision,
    activities: outfitId === "pajamas" ? [activities[1]!] : activities,
    availabilityReason: () => busy,
    play: (activity, generation) => played.push({ id: activity.id, generation, windowId: id }),
    stop: (_activity, generation) => stopped.push(generation),
    variation: () => { variations += 1; },
  });
  service.register(carrier());
  return {
    service, played, stopped, failed, carrier,
    at(value: number) { now = value; service.tick(); },
    busy(value: string | null) { busy = value; },
    get variations() { return variations; },
    result(index: number, outcome: "started" | "completed" | "cancelled" | "failed") {
      const item = played[index]!;
      service.result(item.windowId, item.generation, item.id, outcome);
    },
  };
}

// Quiet opportunities are opt-in, bounded, and can trigger neutral variation.
{
  const f = fixture([]);
  f.at(0); f.at(119_999); assert.equal(f.played.length, 0);
  f.at(120_000); assert.equal(f.played.length, 0); assert.equal(f.variations, 1);
}

// Busy interruption resets the opportunity and does not quarantine an asset.
{
  const f = fixture();
  f.at(0); f.at(120_000); assert.equal(f.played[0]?.id, "read");
  f.busy("working"); f.at(120_001);
  assert.equal(f.service.getPlayingActivityId("cat"), null);
  assert.deepEqual(f.failed, []); assert.equal(f.stopped.length, 1);
  f.busy(null); f.at(120_002); f.at(240_001); assert.equal(f.played.length, 1);
}

// Only a first-frame acknowledgement consumes cooldown; cancellation before it does not.
{
  const f = fixture();
  f.service.play("cat", "read", 1);
  assert.throws(() => f.service.play("cat", "stretch", 1), /already playing/);
  f.service.cancel(1);
  f.result(0, "started");
  f.at(0); f.at(120_000); assert.equal(f.played[1]?.id, "read");
  f.result(1, "started"); f.result(1, "completed");
  f.service.register(f.carrier(1, "pajamas"));
  f.at(120_000); f.at(240_000); assert.equal(f.played[2]?.id, "stretch");
  f.result(2, "started"); f.result(2, "completed");
  f.service.register(f.carrier());
  f.at(240_000); f.at(360_000); assert.equal(f.played.length, 3);
  f.at(480_000); assert.equal(f.played[3]?.id, "read");
}

// Wrong identity and stale generations cannot complete or fail a replacement.
{
  const f = fixture();
  f.service.play("cat", "read", 1);
  const first = f.played[0]!;
  f.service.register(f.carrier()); // HUD-only refresh retains the active reservation.
  assert.equal(f.service.isCurrent(1, first.generation), true);
  f.service.result(1, first.generation, "stretch", "failed");
  assert.deepEqual(f.failed, []);
  f.service.register(f.carrier(1, "pajamas"));
  f.service.play("cat", "stretch", 1);
  f.result(0, "failed");
  assert.equal(f.service.getPlayingActivityId("cat"), "stretch");
  f.result(1, "failed");
  assert.deepEqual(f.failed, ["stretch:pajamas:v1"]);
  assert.throws(() => f.service.play("cat", "stretch", 1), /unavailable/);
  f.service.register(f.carrier(1, "default", "v2"));
  f.service.play("cat", "stretch", 1);
}

// A nonresponsive renderer cannot retain the reservation indefinitely.
{
  const f = fixture();
  f.service.play("cat", "read", 1);
  f.at(7001);
  assert.equal(f.service.getPlayingActivityId("cat"), null);
  assert.deepEqual(f.failed, ["read:default:v1"]);
}

assert.deepEqual(normalizePetActivityPreferences({ cat: ["read", "read", "cat_nap", false, "../bad"], dog: [] }), { cat: ["read", "cat_nap"] });
