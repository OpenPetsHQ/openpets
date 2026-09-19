// Golden test for openpets.virtual-pet.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  cleanState,
  getMood,
  addXp,
  applyDecay,
  register,
  SCHEDULE_ID,
} from "./index.js";

let createTestHarness;
try {
  ({ createTestHarness } = await import("@open-pets/plugin-sdk/testing"));
} catch {
  ({ createTestHarness } = await import(new URL("../../../packages/sdk/dist/testing.js", import.meta.url)));
}

let activeHarness = null;
const originalDateNow = Date.now;
Object.defineProperty(Date, "now", {
  value: () => {
    if (activeHarness && activeHarness.clock) {
      return activeHarness.clock.now();
    }
    return 1000000;
  },
  configurable: true,
});

// 1) Test Pure Helpers
{
  // cleanState
  const defaultState = cleanState(null);
  assert.equal(defaultState.hunger, 80);
  assert.equal(defaultState.energy, 80);
  assert.equal(defaultState.happiness, 80);
  assert.equal(defaultState.affection, 50);
  assert.equal(defaultState.level, 1);
  assert.equal(defaultState.xp, 0);

  const customState = cleanState({ hunger: 20, level: 3, careCounts: { fed: 5 } });
  assert.equal(customState.hunger, 20);
  assert.equal(customState.level, 3);
  assert.equal(customState.careCounts.fed, 5);

  // getMood
  assert.equal(getMood({ hunger: 80, energy: 80, happiness: 80, affection: 80, sleptUntil: 0 }, 1000), "happy");
  assert.equal(getMood({ hunger: 80, energy: 80, happiness: 80, affection: 80, sleptUntil: 5000 }, 1000), "sleeping");
  assert.equal(getMood({ hunger: 20, energy: 80, happiness: 80, affection: 50, sleptUntil: 0 }, 1000), "hungry");
  assert.equal(getMood({ hunger: 80, energy: 10, happiness: 80, affection: 50, sleptUntil: 0 }, 1000), "tired");
  assert.equal(getMood({ hunger: 80, energy: 80, happiness: 15, affection: 50, sleptUntil: 0 }, 1000), "bored");

  // addXp
  const levelUp = addXp({ xp: 45, level: 1 }, 10);
  assert.equal(levelUp.xp, 5);
  assert.equal(levelUp.level, 2);
  assert.equal(levelUp.leveledUp, true);

  const normalXp = addXp({ xp: 10, level: 1 }, 10);
  assert.equal(normalXp.xp, 20);
  assert.equal(normalXp.level, 1);
  assert.equal(normalXp.leveledUp, false);

  // applyDecay
  // 2 hours awake decay: hunger -4, energy -6, happiness -4, affection -2
  const stateDecayed = applyDecay({ hunger: 80, energy: 80, happiness: 80, affection: 50, sleptUntil: 0, lastSeenAt: 1000 }, 2 * 3600_000, 1000 + 2 * 3600_000);
  assert.equal(stateDecayed.hunger, 76);
  assert.equal(stateDecayed.energy, 74);
  assert.equal(stateDecayed.happiness, 76);
  assert.equal(stateDecayed.affection, 48);

  // 1 hour sleep decay: hunger -2, energy +15, happiness -0.5, affection same
  const stateSlept = applyDecay({ hunger: 80, energy: 50, happiness: 80, affection: 50, sleptUntil: 1000 + 3600_000, lastSeenAt: 1000 }, 3600_000, 1000 + 3600_000);
  assert.equal(stateSlept.hunger, 78);
  assert.equal(stateSlept.energy, 65);
  assert.equal(stateSlept.happiness, 79.5);
  assert.equal(stateSlept.affection, 50);
}

const PERMISSIONS = ["pet:speak", "pet:interact", "pet:pin", "pet:reaction", "schedule", "storage", "commands", "audio", "events"];
const LOCALES = { en: JSON.parse(await readFile(new URL("./locales/en.json", import.meta.url), "utf8")) };

// 2) Start / Reconcile logic
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 100_000_000_000 });
  activeHarness = h;
  await h.start();
  // Expect state to be initialized is storage
  h.expectStored("state", (s) => s.lastSeenAt === 100_000_000_000 && s.hunger === 80);
  // Expect schedules to contain tick schedule
  assert.ok(h.calls.schedules.has(SCHEDULE_ID));
  // Expect pinned status bubble to show HUD
  h.expectBubble({ sticky: true, pin: true });
  assert.deepEqual(h.calls.bubbles[0].spec.dismissOn, [], "HUD must not dismiss when clicked or when the pet is clicked");
  
  // Verify that the bubble contains the correct HUD items/values rather than text
  const lastBubble = h.calls.bubbles[h.calls.bubbles.length - 1];
  assert.ok(lastBubble, "Should have a bubble");
  assert.ok(lastBubble.spec.hud, "Bubble should have a HUD spec");
  assert.equal(lastBubble.spec.hud.items.length, 4);
  
  const [food, energy, play, bond] = lastBubble.spec.hud.items;
  assert.equal(food.icon, "food");
  assert.equal(food.value, 80);
  assert.equal(food.tone, "amber");
  assert.equal(food.label, "Food");
  
  assert.equal(energy.icon, "zap");
  assert.equal(energy.value, 80);
  assert.equal(energy.tone, "blue");
  assert.equal(energy.label, "Energy");
  
  assert.equal(play.icon, "play");
  assert.equal(play.value, 80);
  assert.equal(play.tone, "green");
  assert.equal(play.label, "Play");
  
  assert.equal(bond.icon, "heart");
  assert.equal(bond.value, 50);
  assert.equal(bond.tone, "pink");
  assert.equal(bond.label, "Bond");

  h.expectNoErrors();
}

// 2b) With showStats disabled, no HUD bubble is pinned
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 100_000_000_000, config: { showStats: false } });
  activeHarness = h;
  await h.start();
  // No pinned status bubble should be created when stats are hidden
  assert.equal(h.calls.bubbles.length, 0, "Should not create a HUD bubble when showStats is false");
  h.expectNoErrors();
}

// 3) Reconcile with wall-clock decay catch-up
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 101_000_000_000 });
  activeHarness = h;
  // Set old state manually in storage. Last seen 2 hours ago.
  const oldState = cleanState({ hunger: 100, energy: 100, happiness: 100, affection: 100, lastSeenAt: 101_000_000_000 - 2 * 3600_000 });
  await h.ctx.storage.set("state", oldState);
  await h.start();
  
  // 2 hours elapsed = hunger -4 (96), energy -6 (94), happiness -4 (96), affection -2 (98)
  h.expectStored("state", (s) => s.hunger === 96 && s.energy === 94 && s.happiness === 96 && s.affection === 98);
  h.expectNoErrors();
}

// 4) Commands / actions mutate stats
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 102_000_000_000 });
  activeHarness = h;
  await h.start();
  
  // Feed command: hunger +25, xp +5
  await h.runCommand("feed");
  h.expectStored("state", (s) => s.hunger === 100 && s.xp === 5 && s.careCounts.fed === 1);
  h.expectSpoke(/food|munch|tasty|delicious/);
  h.expectReacted("celebrating");

  // Play command: happiness +25, energy -15, xp +5
  await h.runCommand("play");
  h.expectStored("state", (s) => s.happiness === 100 && s.energy === 65 && s.xp === 10 && s.careCounts.played === 1);
  h.expectSpoke(/fun|Yay|games|Again/);

  // Pet command: affection +15, happiness +10, xp +3
  await h.runCommand("pet");
  h.expectStored("state", (s) => s.affection === 65 && s.happiness === 100 && s.xp === 13 && s.careCounts.petted === 1);
  h.expectSpoke(/Purr|nuzzles|Warm|soft/);

  // Nap command: energy +40, sleptUntil is set
  await h.runCommand("nap");
  h.expectStored("state", (s) => s.energy === 100 && s.sleptUntil === 102_000_000_000 + 15 * 60_000 && s.careCounts.napped === 1);
  h.expectSpoke(/Zzz|curls|Sleepy|Resting/);
  h.expectReacted("waiting");

  // Show status command
  await h.runCommand("status");
  h.expectSpoke(/resting|hungry|sleepy|play|great|content/);

  h.expectNoErrors();
}

// 5) Play wakes up pet if sleeping
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 103_000_000_000 });
  activeHarness = h;
  await h.start();
  await h.runCommand("nap"); // sleeping until 103B + 15M
  h.expectStored("state", (s) => s.sleptUntil > 0);
  
  // Running play should wake up pet
  await h.runCommand("play");
  h.expectStored("state", (s) => s.sleptUntil === 0);
  h.expectNoErrors();
}

// 5b) Assistant capabilities reuse care mutations without command speech.
{
  const now = 103_500_000_000;
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    config: { sound: "care-chime" },
    nowMs: now,
  });
  activeHarness = h;
  await h.start();

  assert.deepEqual(
    [...h.calls.assistantCapabilities.keys()],
    [
      "virtual-pet.status",
      "virtual-pet.feed",
      "virtual-pet.play",
      "virtual-pet.pet",
      "virtual-pet.nap",
    ],
  );

  const status = await h.runCapability("virtual-pet.status", {});
  assert.equal(status.ok, true);
  assert.equal(status.action, "status");
  assert.equal(status.state.hunger, 80);
  assert.equal(status.mood, "content");

  const fed = await h.runCapability("virtual-pet.feed", {});
  assert.equal(fed.state.hunger, 100);
  assert.equal(fed.state.careCounts.fed, 1);
  h.expectStored("state", (state) => state.hunger === 100 && state.careCounts.fed === 1);

  const played = await h.runCapability("virtual-pet.play", {});
  assert.equal(played.state.happiness, 100);
  assert.equal(played.state.energy, 65);
  assert.equal(played.state.careCounts.played, 1);

  const petted = await h.runCapability("virtual-pet.pet", {});
  assert.equal(petted.state.affection, 65);
  assert.equal(petted.state.careCounts.petted, 1);

  const napped = await h.runCapability("virtual-pet.nap", {});
  assert.equal(napped.state.energy, 100);
  assert.equal(napped.state.careCounts.napped, 1);
  assert.equal(napped.state.sleptUntil, now + 15 * 60_000);

  assert.equal(h.calls.speak.length, 0, "assistant care actions must not use command speech");
  assert.deepEqual(h.calls.react, ["celebrating", "celebrating", "waving", "waiting"]);
  assert.equal(h.calls.sounds.length, 4, "assistant care actions must preserve action sounds");
  assert.ok(h.calls.bubbles[0].updates.length >= 5, "assistant care actions must update the pinned HUD");
  h.expectNoErrors();
}

// 6) Click event triggers petting
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 104_000_000_000 });
  activeHarness = h;
  await h.start();
  
  // Emit click event
  await h.emit("pet:clicked", {});
  h.expectStored("state", (s) => s.affection === 65 && s.careCounts.petted === 1);
  h.expectSpoke(/Purr|nuzzles|Warm|soft/);
  h.expectNoErrors();
}

// 7) Nudge neglected
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 105_000_000_000 });
  activeHarness = h;
  // Set neglected state
  const neglectedState = cleanState({ hunger: 10, lastSeenAt: 105_000_000_000 - 15 * 60_000 });
  await h.ctx.storage.set("state", neglectedState);
  await h.start();
  
  // check if nudge triggered
  h.expectSpoke(/hungry/);
  h.expectStored("state", (s) => s.lastNudgeAt === 105_000_000_000);

  // If we advance clock by 5 mins, nudge should NOT fire again (cooldown)
  const previousSpeakCount = h.calls.speak.length;
  await h.clock.advance("5m");
  assert.equal(h.calls.speak.length, previousSpeakCount, "nudge should not spam");
  
  h.expectNoErrors();
}

Object.defineProperty(Date, "now", {
  value: originalDateNow,
  configurable: true,
});

console.log("openpets.virtual-pet: all checks passed.");
