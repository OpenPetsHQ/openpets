// Deterministic SDK v3 harness checks for openpets.simple-timer.
import assert from "node:assert/strict";
import {
  ADD_MINUTES,
  EXPIRY_SCHEDULE_ID,
  HUD_REFRESH_SCHEDULE_ID,
  MAX_DURATION_MS,
  PRESET_MINUTES,
  SNOOZE_MS,
  cleanLabel,
  durationForValues,
  formatRemaining,
  parseStoredTimer,
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

const LOCALES = {
  en: JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("./locales/en.json", import.meta.url),
      "utf8",
    ),
  ),
};

const PERMISSIONS = [
  "pet:speak",
  "pet:interact",
  "pet:pin",
  "audio",
  "schedule",
  "storage",
  "commands",
  "status",
  "notify",
];

function options(nowMs, config = {}) {
  return { permissions: PERMISSIONS, config, locales: LOCALES, nowMs };
}

async function advanceTo(harness, scheduleId) {
  const schedule = harness.calls.schedules.get(scheduleId);
  assert.ok(schedule, `expected schedule ${scheduleId}`);
  const delta = Math.max(1, schedule.dueMs - harness.clock.now() + 1);
  await harness.clock.advance(delta);
}

// Pure boundary helpers reject malformed input before it reaches timer logic.
assert.deepEqual(PRESET_MINUTES, [5, 15, 25, 30, 60]);
assert.equal(durationForValues({ preset: "15", customMinutes: 0 }), 15 * 60_000);
assert.equal(durationForValues({ preset: "15", customMinutes: 90 }), 90 * 60_000);
assert.equal(durationForValues({ preset: "15", customMinutes: 1441 }), null);
assert.equal(durationForValues({ preset: "bogus", customMinutes: 0 }), null);
assert.equal(cleanLabel("  deep\n  work  block "), "deep work block");
assert.equal(cleanLabel(" "), null);
assert.equal(formatRemaining(0), "0:00");
assert.equal(formatRemaining(65_000), "1:05");
assert.equal(formatRemaining(3_661_000), "1:01:01");
assert.equal(parseStoredTimer({ version: 1, timerId: "timer-a", label: null, startedAt: 1_000, durationMs: 60_000, phase: "running", endsAt: 61_000 }).phase, "running");
assert.equal(parseStoredTimer({ version: 1, timerId: "timer-b", label: null, startedAt: 1_000, durationMs: 60_000, phase: "running", endsAt: "61_000" }), null);
assert.equal(parseStoredTimer({ version: 1, timerId: "timer-c", label: null, startedAt: 1_000, durationMs: 60_000, phase: "paused", remainingMs: 60_001 }), null);

// 1) The form stores a custom duration, uses an absolute expiry schedule, and
// renders the active timer as a pinned pet HUD with the requested controls.
{
  const now = Date.now();
  const h = createTestHarness(register, options(now, { soundEnabled: true, osNotification: true, customSound: "gong" }));
  await h.start();
  await h.runCommand("start-timer", { preset: "25", customMinutes: 7, label: "  Deep\nwork  " });

  h.expectStored("timer", (value) => value.phase === "running" && value.label === "Deep work" && value.durationMs === 7 * 60_000);
  const expiry = h.calls.schedules.get(EXPIRY_SCHEDULE_ID);
  assert.equal(expiry?.type, "at", "timer expiry must use an absolute schedule");
  assert.equal(h.calls.schedules.get(HUD_REFRESH_SCHEDULE_ID)?.type, "once");
  const hud = h.calls.bubbles.at(-1);
  assert.ok(hud?.pinned, "active timer must pin its HUD");
  assert.deepEqual(hud?.spec.actions?.map((action) => action.id), ["toggle", "add-5", "cancel"]);
  assert.equal(hud?.spec.hud?.items.length, 1);
  h.expectNoErrors();
  await h.stop();
}

// 2) Pause freezes remaining time, +5m works while paused, resume creates a
// fresh absolute expiry, and cancel removes durable state and both schedules.
{
  const now = Date.now();
  const h = createTestHarness(register, options(now));
  await h.start();
  await h.runCommand("timer-15");
  const hud = h.calls.bubbles.at(-1);
  assert.ok(hud);
  await h.fireBubbleAction(hud.handle.id, "toggle");
  h.expectStored("timer", (value) => value.phase === "paused" && value.remainingMs > 0 && value.remainingMs <= 15 * 60_000);
  assert.equal(h.calls.schedules.size, 0, "paused timer must not keep schedules");
  assert.deepEqual(hud.spec.actions?.map((action) => action.id), ["toggle", "add-5", "cancel"]);

  const paused = h.calls.storage.get("timer");
  await h.fireBubbleAction(hud.handle.id, "add-5");
  h.expectStored("timer", (value) => value.phase === "paused" && value.remainingMs === paused.remainingMs + ADD_MINUTES * 60_000);
  await h.fireBubbleAction(hud.handle.id, "toggle");
  h.expectScheduled(EXPIRY_SCHEDULE_ID);
  assert.equal(h.calls.schedules.get(EXPIRY_SCHEDULE_ID)?.type, "at");
  await h.runCommand("cancel-timer");
  assert.equal(h.calls.storage.has("timer"), false, "cancel must clear durable state");
  assert.equal(h.calls.schedules.size, 0);
  h.expectNoErrors();
  await h.stop();
}

// 3) Expiry is delivered once with optional sound + OS notification. Snooze
// reuses the same timer id and dismiss clears the expired state.
{
  const now = Date.now();
  const h = createTestHarness(register, options(now, { soundEnabled: true, osNotification: true, customSound: "gong" }));
  await h.start();
  await h.runCommand("start-timer", { preset: "5", customMinutes: 1, label: "Tea" });
  await advanceTo(h, EXPIRY_SCHEDULE_ID);
  assert.equal(h.calls.alerts.length, 1);
  assert.deepEqual(h.calls.alerts[0].bubble.spec.actions?.map((action) => action.id), ["snooze", "dismiss"]);
  assert.ok(h.calls.sounds.some((sound) => sound.sound === "gong"));
  h.expectNotified("Tea");
  h.expectStored("timer", (value) => value.phase === "expired" && value.alertShownAt !== null);
  assert.equal(h.calls.schedules.size, 0);

  const alertBubble = h.calls.alerts[0].bubble;
  await h.fireBubbleAction(alertBubble.handle.id, "snooze");
  h.expectStored("timer", (value) => value.phase === "running" && value.endsAt > h.clock.now());
  assert.equal(h.calls.schedules.get(EXPIRY_SCHEDULE_ID)?.type, "at");
  assert.equal(h.calls.alerts.length, 1, "snooze must not create a duplicate alert");

  await advanceTo(h, EXPIRY_SCHEDULE_ID);
  assert.equal(h.calls.alerts.length, 2);
  await h.fireBubbleAction(h.calls.alerts[1].bubble.handle.id, "dismiss");
  assert.equal(h.calls.storage.has("timer"), false, "dismiss must clear expired state");
  assert.equal(h.calls.schedules.size, 0);
  h.expectNoErrors();
  await h.stop();
}

// 4) A persisted overdue timer is reconciled on startup, then remains marked
// delivered so a restart cannot fire the same expiry twice.
{
  const now = Date.now();
  const h = createTestHarness(register, options(now, { soundEnabled: false, osNotification: false }));
  await h.ctx.storage.set("timer", {
    version: 1,
    timerId: "timer-restart",
    label: "Restart recovery",
    startedAt: now - 10 * 60_000,
    durationMs: 5 * 60_000,
    phase: "running",
    endsAt: now - 5 * 60_000,
  });
  await h.start();
  assert.equal(h.calls.alerts.length, 1);
  assert.equal(h.calls.sounds.length, 0, "disabled sound must not be requested");
  assert.equal(h.calls.notifications.length, 0, "disabled OS notification must not be requested");
  h.expectStored("timer", (value) => value.phase === "expired" && value.alertShownAt !== null);
  const firstAlertCount = h.calls.alerts.length;
  await h.stop();
  await h.start();
  assert.equal(h.calls.alerts.length, firstAlertCount, "restart must not redeliver an acknowledged expiry");
  assert.equal(h.calls.schedules.size, 0);
  h.expectNoErrors();
  await h.stop();
}

// 5) A successful fallback speech delivery acknowledges expiry and does not
// speak again after a restart.
{
  const now = Date.now();
  const h = createTestHarness(register, options(now, { soundEnabled: false, osNotification: false }));
  const originalAlert = h.ctx.ui.alert;
  h.ctx.ui.alert = async () => {
    throw new Error("alert unavailable");
  };
  await h.ctx.storage.set("timer", {
    version: 1,
    timerId: "timer-speech-fallback",
    label: "Fallback delivery",
    startedAt: now - 10 * 60_000,
    durationMs: 5 * 60_000,
    phase: "running",
    endsAt: now - 5 * 60_000,
  });
  await h.start();
  assert.equal(h.calls.alerts.length, 0);
  h.expectSpoke("Fallback delivery is done.");
  h.expectStored("timer", (value) => value.phase === "expired" && value.alertShownAt !== null);
  const speechCount = h.calls.speak.length;
  h.ctx.ui.alert = originalAlert;
  await h.stop();
  await h.start();
  assert.equal(h.calls.speak.length, speechCount, "an acknowledged fallback must not redeliver on restart");
  assert.equal(h.calls.alerts.length, 0);
  h.expectNoErrors();
  await h.stop();
}

// 6) If both delivery paths fail, expiry remains pending without a schedule
// retry loop; a later lifecycle recovery delivers it once and acknowledges it.
{
  const now = Date.now();
  const h = createTestHarness(register, options(now, { soundEnabled: false, osNotification: false }));
  const originalAlert = h.ctx.ui.alert;
  const originalSpeak = h.ctx.pet.speak;
  h.ctx.ui.alert = async () => {
    throw new Error("alert unavailable");
  };
  h.ctx.pet.speak = async () => {
    throw new Error("speech unavailable");
  };
  await h.ctx.storage.set("timer", {
    version: 1,
    timerId: "timer-pending-delivery",
    label: "Pending delivery",
    startedAt: now - 10 * 60_000,
    durationMs: 5 * 60_000,
    phase: "running",
    endsAt: now - 5 * 60_000,
  });
  await h.start();
  assert.equal(h.calls.alerts.length, 0);
  assert.equal(h.calls.bubbles.length, 0);
  h.expectStored("timer", (value) => value.phase === "expired" && value.alertShownAt === null);
  await h.clock.advance(60 * 60_000);
  assert.equal(h.calls.alerts.length, 0, "failed delivery must not self-schedule unbounded retries");
  assert.equal(h.calls.schedules.size, 0);

  await h.stop();
  h.ctx.ui.alert = originalAlert;
  h.ctx.pet.speak = originalSpeak;
  await h.start();
  assert.equal(h.calls.alerts.length, 1, "recovery must retry the pending expiry once");
  h.expectStored("timer", (value) => value.phase === "expired" && value.alertShownAt !== null);
  const firstAlertCount = h.calls.alerts.length;
  await h.stop();
  await h.start();
  assert.equal(h.calls.alerts.length, firstAlertCount, "a recovered expiry must not alert twice");
  assert.equal(h.calls.schedules.size, 0);
  h.expectNoErrors();
  await h.stop();
}

// 7) Stale duplicate callbacks from an old timer generation are ignored.
{
  const now = Date.now();
  const h = createTestHarness(register, options(now));
  await h.start();
  await h.runCommand("timer-5");
  const duplicateHandler = h.calls.schedules.get(EXPIRY_SCHEDULE_ID).handler;
  await Promise.all([duplicateHandler(), duplicateHandler()]);
  assert.equal(h.calls.alerts.length, 1, "duplicate expiry callbacks must create one alert");
  await h.runCommand("timer-15");
  await duplicateHandler();
  assert.equal(h.calls.alerts.length, 1, "stale callbacks must not expire the replacement timer");
  h.expectStored("timer", (value) => value.phase === "running" && value.durationMs === 15 * 60_000);
  h.expectNoErrors();
  await h.stop();
}

// 8) Invalid persisted data is ignored at the storage boundary and lifecycle
// cleanup leaves no schedules or registered commands behind.
{
  const h = createTestHarness(register, options(Date.now()));
  await h.ctx.storage.set("timer", { phase: "running", endsAt: "not-a-number" });
  await h.start();
  assert.equal(h.calls.schedules.size, 0);
  assert.equal(h.calls.commands.size, 10);
  await h.stop();
  assert.equal(h.calls.schedules.size, 0);
  assert.equal(h.calls.commands.size, 0);
  h.expectNoErrors();
}

// 9) Stopping with an active timer cancels both schedules, dismisses the HUD,
// and unregisters every command so reloads cannot leave live callbacks behind.
{
  const h = createTestHarness(register, options(Date.now()));
  await h.start();
  await h.runCommand("timer-5");
  assert.equal(h.calls.schedules.size, 2);
  await h.stop();
  assert.equal(h.calls.schedules.size, 0);
  assert.equal(h.calls.commands.size, 0);
  assert.equal(h.calls.bubbles.at(-1)?.dismissed, true);
  h.expectNoErrors();
}

assert.equal(MAX_DURATION_MS, 24 * 60 * 60_000);
assert.equal(SNOOZE_MS, 5 * 60_000);
console.log("openpets.simple-timer: all checks passed.");
