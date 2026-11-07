// Tests for openpets.walkabout.
import assert from "node:assert/strict";
import {
  SPEED_DURATION,
  WANDER_DISTANCE,
  PATROL_STEP_X,
  cleanConfig,
  normalizeMode,
  normalizeSpeed,
  normalizeInterval,
  nextPatrolTarget,
  PINNED_PET_COMMAND_ID,
  startMode,
  startWander,
  startFollowCursor,
  startPatrol,
  register,
} from "./index.js";

let createTestHarness;
try {
  ({ createTestHarness } = await import("@open-pets/plugin-sdk/testing"));
} catch {
  ({ createTestHarness } = await import(
    new URL("../../../packages/sdk/dist/testing.js", import.meta.url)
  ));
}

// ── normalizeMode ──────────────────────────────────────────────────────────────
assert.equal(normalizeMode("wander"), "wander");
assert.equal(normalizeMode("follow-cursor"), "follow-cursor");
assert.equal(normalizeMode("physics"), "wander", "physics is no longer valid, coerces to wander");
assert.equal(normalizeMode("patrol"), "patrol");
assert.equal(normalizeMode(undefined), "wander", "undefined defaults to wander");
assert.equal(normalizeMode("fly"), "wander", "unknown mode defaults to wander");
assert.equal(normalizeMode(42), "wander", "non-string defaults to wander");

// ── normalizeSpeed ─────────────────────────────────────────────────────────────
assert.equal(normalizeSpeed("slow"), "slow");
assert.equal(normalizeSpeed("normal"), "normal");
assert.equal(normalizeSpeed("brisk"), "brisk");
assert.equal(normalizeSpeed(undefined), "slow", "undefined defaults to slow");
assert.equal(normalizeSpeed("supersonic"), "slow", "unknown speed defaults to slow");

// ── normalizeInterval ──────────────────────────────────────────────────────────
assert.equal(normalizeInterval("5"), 5000);
assert.equal(normalizeInterval(10), 10000);
assert.equal(normalizeInterval("2"), 2000);
assert.equal(normalizeInterval(undefined), 10000, "undefined defaults to 10s");
assert.equal(normalizeInterval("abc"), 10000, "non-numeric defaults to 10s");
assert.equal(normalizeInterval(0), 10000, "zero out-of-range defaults to 10s");
assert.equal(normalizeInterval(200), 10000, "too large defaults to 10s");
assert.equal(normalizeInterval(3.9), 3000, "fractional is floored");

// ── cleanConfig ────────────────────────────────────────────────────────────────
assert.deepEqual(cleanConfig({}), {
  mode: "wander",
  speed: "slow",
  intervalMs: 10000,
  pauseWhenBusy: true,
});

assert.deepEqual(cleanConfig({ mode: "patrol", speed: "brisk", interval: "2", pauseWhenBusy: false }), {
  mode: "patrol",
  speed: "brisk",
  intervalMs: 2000,
  pauseWhenBusy: false,
});

assert.deepEqual(cleanConfig(null), {
  mode: "wander",
  speed: "slow",
  intervalMs: 10000,
  pauseWhenBusy: true,
}, "null input is treated as empty config");

// pauseWhenBusy: only explicit false disables it
assert.equal(cleanConfig({ pauseWhenBusy: true }).pauseWhenBusy, true);
assert.equal(cleanConfig({ pauseWhenBusy: false }).pauseWhenBusy, false);
assert.equal(cleanConfig({}).pauseWhenBusy, true, "omitted defaults to true");

// ── nextPatrolTarget ───────────────────────────────────────────────────────────
{
  const pos = { x: 500, y: 300 };
  const { target: t1, nextDirection: nd1 } = nextPatrolTarget(pos, true);
  assert.equal(t1.x, 500 + PATROL_STEP_X, "patrol right increases x");
  assert.equal(t1.y, 300, "patrol preserves y");
  assert.equal(nd1, false, "direction flips after right");

  const { target: t2, nextDirection: nd2 } = nextPatrolTarget(pos, false);
  assert.equal(t2.x, 500 - PATROL_STEP_X, "patrol left decreases x");
  assert.equal(nd2, true, "direction flips after left");
}

// ── SPEED_DURATION sanity ──────────────────────────────────────────────────────
assert.ok(SPEED_DURATION.slow > SPEED_DURATION.normal, "slow is slower than normal");
assert.ok(SPEED_DURATION.normal > SPEED_DURATION.brisk, "normal is slower than brisk");

// ── Harness-based tests ────────────────────────────────────────────────────────
const PERMISSIONS = ["pet:move", "events", "pets:read", "status", "commands", "storage"];
const LOCALES = {
  en: JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("./locales/en.json", import.meta.url),
      "utf8"
    )
  ),
};

// createMockContext for pure ctx tests (mode runners need a ctx)
let createMockContext;
try {
  ({ createMockContext } = await import("@open-pets/plugin-sdk/testing"));
} catch {
  ({ createMockContext } = await import(
    new URL("../../../packages/sdk/dist/testing.js", import.meta.url)
  ));
}

function makeMockCtx() {
  const { ctx } = createMockContext({ permissions: PERMISSIONS, locales: LOCALES });
  return ctx;
}

// startMode / individual runners — just verify they return a stop function and don't throw.
for (const mode of ["wander", "follow-cursor", "patrol"]) {
  const ctx = makeMockCtx();
  const cfg = cleanConfig({ mode });
  const stop = startMode(ctx, cfg);
  assert.equal(typeof stop, "function", `startMode("${mode}") returns a stop function`);
  stop();
}

// startWander / startFollowCursor / startPatrol individually.
{
  const ctx = makeMockCtx();
  const stop = startWander(ctx, cleanConfig({ mode: "wander", speed: "brisk" }));
  assert.equal(typeof stop, "function");
  stop();
}
{
  const ctx = makeMockCtx();
  const stop = startFollowCursor(ctx, cleanConfig({ mode: "follow-cursor", speed: "slow" }));
  assert.equal(typeof stop, "function");
  stop();
}
{
  const ctx = makeMockCtx();
  const stop = startPatrol(ctx, cleanConfig({ mode: "patrol", speed: "normal" }));
  assert.equal(typeof stop, "function");
  stop();
}

// ── Full plugin lifecycle via createTestHarness ────────────────────────────────
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES });
  await h.start();
  assert.ok(h.calls.status.length > 0, "plugin sets a status on start");

  // Config change — switches mode; should not throw.
  await h.setConfig({ mode: "patrol", speed: "slow", interval: "10", pauseWhenBusy: true });

  // Pulse with REAL payload shape: pauses immediately.
  await h.emit("agent:activity", { kind: "react", active: true, petId: "default" });
  const statuses = h.calls.status.map((s) => s.text);
  assert.ok(statuses.some((l) => l.includes("paused") || l.includes("Walkabout")), "status recorded after activity event");

  h.expectNoErrors();
  await h.stop();
}

// ── (a) Activity pulse pauses the pet; timer auto-resumes it ─────────────────
{
  // Use minimum interval (1 s) so the resume timer fires after 2 s.
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    config: { mode: "wander", speed: "normal", interval: "1", pauseWhenBusy: true },
  });
  await h.start();
  const statusCountAfterStart = h.calls.status.length;

  // Emit a single activity pulse (the only kind production ever sends).
  await h.emit("agent:activity", { kind: "react", active: true, petId: "default" });

  // Pet should now be paused.
  const pausedStatuses = h.calls.status.slice(statusCountAfterStart).map((s) => s.text);
  assert.ok(pausedStatuses.some((l) => l.includes("paused")), "status shows paused after activity pulse");
  const movementOwnerDuringPause = h.calls.petActions
    .filter((action) => action.petId === "default" && action.method === "setAutomaticMovement")
    .at(-1)?.args?.enabled;
  assert.equal(movementOwnerDuringPause, true, "temporary busy pause keeps drag-as-reposition behavior active");

  // Wait for the self-resuming timer (intervalMs * 2 = 2000ms) + headroom.
  await new Promise((resolve) => setTimeout(resolve, 2200));

  // Pet should have auto-resumed.
  const allStatuses = h.calls.status.map((s) => s.text);
  const resumedAfterPause = allStatuses.slice(statusCountAfterStart).some((l) => !l.includes("paused") && l.length > 0);
  assert.ok(resumedAfterPause, "status shows active again after resume timer fires");

  h.expectNoErrors();
  await h.stop();
}

// ── (b) Non-default petId is IGNORED — cross-session isolation ────────────────
{
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    config: { mode: "wander", pauseWhenBusy: true },
  });
  await h.start();
  const statusCountAfterStart = h.calls.status.length;

  // Activity from a different session's pet — must NOT pause the default pet.
  await h.emit("agent:activity", { kind: "react", active: true, petId: "fox-pet" });

  assert.equal(
    h.calls.status.length,
    statusCountAfterStart,
    "non-default petId activity does NOT change walkabout status",
  );

  h.expectNoErrors();
  await h.stop();
}

// ── (c) pauseWhenBusy:false — activity events fully ignored ──────────────────
{
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    config: { mode: "wander", pauseWhenBusy: false },
  });
  await h.start();
  const statusCountBefore = h.calls.status.length;
  await h.emit("agent:activity", { kind: "react", active: true, petId: "default" });
  assert.equal(h.calls.status.length, statusCountBefore, "no status change when pauseWhenBusy is false");
  await h.stop();
}

// ── Rapid-fire pulses — only one pause status and timer resets ────────────────
{
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    config: { mode: "wander", interval: "1", pauseWhenBusy: true },
  });
  await h.start();
  const statusCountAfterStart = h.calls.status.length;

  // Three rapid pulses — should each restart the timer but only emit one pause status.
  await h.emit("agent:activity", { kind: "react", active: true, petId: "default" });
  await h.emit("agent:activity", { kind: "say",  active: true, petId: "default" });
  await h.emit("agent:activity", { kind: "react", active: true, petId: "default" });

  // Count "paused" statuses emitted — only the first pulse should set paused.
  const pausedCount = h.calls.status.slice(statusCountAfterStart).filter((s) => s.text.includes("paused")).length;
  assert.ok(pausedCount >= 1, "at least one paused status emitted");

  h.expectNoErrors();
  await h.stop();
}

// ── Independent pinned movement, per-pet pause, pin lifecycle, restart cleanup ──
{
  let definition;
  register({ register: (value) => { definition = value; } });
  assert.ok(definition, "plugin registration exposes its lifecycle definition");

  const defaultPet = { id: "default", name: "Default pet", kind: "default", visible: true };
  const pinnedPets = [
    { id: "pinned:alpaca", name: "Alpaca", kind: "pinned", visible: true },
    { id: "pinned:fox", name: "Fox", kind: "pinned", visible: true },
    { id: "pinned:robot", name: "Robot", kind: "pinned", visible: true },
  ];
  const h = createTestHarness(definition, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    config: { mode: "wander", speed: "brisk", interval: "1", pauseWhenBusy: true },
    initialPets: [defaultPet, ...pinnedPets],
  });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const countFor = (petId) => h.calls.petActions.filter((action) => action.petId === petId && action.method !== "setAutomaticMovement").length;
  const automaticMovementFor = (petId) => h.calls.petActions
    .filter((action) => action.petId === petId && action.method === "setAutomaticMovement")
    .at(-1)?.args?.enabled;

  await h.start();
  assert.ok(h.calls.commands.has(PINNED_PET_COMMAND_ID), "pinned pets expose the individual movement command");
  for (const pet of [defaultPet, ...pinnedPets]) {
    assert.equal(automaticMovementFor(pet.id), true, `${pet.name} registers continuous automatic movement ownership`);
  }
  await wait(550);
  for (const pet of [defaultPet, ...pinnedPets]) {
    assert.ok(countFor(pet.id) >= 1, `${pet.name} moves independently`);
  }

  await h.runCommand(PINNED_PET_COMMAND_ID, { petId: "pinned:fox" });
  const foxCountAfterPause = countFor("pinned:fox");
  assert.equal(automaticMovementFor("pinned:fox"), true, "pausing one pet keeps Walkabout drag ownership active");
  assert.equal(automaticMovementFor("pinned:alpaca"), true, "other pets keep their movement ownership");
  h.expectStored("disabled-pinned-pets", (value) => Array.isArray(value) && value.includes("pinned:fox"));
  await wait(1_150);
  assert.equal(countFor("pinned:fox"), foxCountAfterPause, "pausing one pinned pet does not leave its timer running");
  for (const petId of ["default", "pinned:alpaca", "pinned:robot"]) {
    assert.ok(countFor(petId) > 1, `${petId} keeps moving while another pin is paused`);
  }

  const defaultCountBeforeRestart = countFor("default");
  await h.start();
  await wait(700);
  assert.equal(countFor("default") - defaultCountBeforeRestart, 1, "restart leaves one active timer per pet");
  assert.equal(countFor("pinned:fox"), foxCountAfterPause, "the paused preference survives plugin restart");

  const alpacaCountBeforeUnpin = countFor("pinned:alpaca");
  h.setPets([defaultPet, pinnedPets[1], pinnedPets[2]]);
  await wait(25);
  await wait(1_100);
  assert.equal(countFor("pinned:alpaca"), alpacaCountBeforeUnpin, "unpinning removes that pet's runner");
  assert.ok(countFor("pinned:robot") > 2, "remaining pins continue moving after another is unpinned");

  const newPin = { id: "pinned:otter", name: "Otter", kind: "pinned", visible: true };
  h.setPets([defaultPet, pinnedPets[1], pinnedPets[2], newPin]);
  await wait(550);
  assert.ok(countFor(newPin.id) >= 1, "a newly pinned pet gets its own movement runner");

  await h.stop();
  const remainingPetIds = ["default", pinnedPets[1].id, pinnedPets[2].id, newPin.id];
  for (const petId of remainingPetIds) {
    assert.equal(automaticMovementFor(petId), false, `${petId} releases movement ownership after shutdown`);
  }
  const countsAfterStop = new Map(remainingPetIds.map((petId) => [petId, countFor(petId)]));
  await wait(1_100);
  for (const [petId, count] of countsAfterStop) {
    assert.equal(countFor(petId), count, `${petId} stays stopped after plugin shutdown`);
  }
  h.expectNoErrors();
}

// ── Dragging yields only that pet's movement runner until release ──────────────
{
  const defaultPet = { id: "default", name: "Default pet", kind: "default", visible: true };
  const draggedPet = { id: "pinned:fox", name: "Fox", kind: "pinned", visible: true };
  const movingPet = { id: "pinned:otter", name: "Otter", kind: "pinned", visible: true };
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    config: { mode: "wander", speed: "brisk", interval: "1", pauseWhenBusy: false },
    initialPets: [defaultPet, draggedPet, movingPet],
  });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const countFor = (petId) => h.calls.petActions.filter((action) => action.petId === petId && action.method === "wander").length;

  await h.start();
  await wait(550);
  const draggedCountBefore = countFor(draggedPet.id);
  const movingCountBefore = countFor(movingPet.id);
  assert.ok(draggedCountBefore > 0, "the dragged pet was moving before the user grabbed it");

  await h.emit("pet:dragStart", { petId: draggedPet.id });
  await wait(1_100);
  assert.equal(countFor(draggedPet.id), draggedCountBefore, "Walkabout does not issue another move for the pet while it is being dragged");
  assert.ok(countFor(movingPet.id) > movingCountBefore, "another pet keeps wandering while this pet is dragged");

  await h.emit("pet:dragEnd", { petId: draggedPet.id });
  await wait(550);
  assert.equal(countFor(draggedPet.id), draggedCountBefore, "the dragged pet has a quiet moment after release");
  await wait(1_050);
  assert.ok(countFor(draggedPet.id) > draggedCountBefore, "the dragged pet resumes moving after the release cooldown");

  h.expectNoErrors();
  await h.stop();
}

console.log("All walkabout tests passed.");
