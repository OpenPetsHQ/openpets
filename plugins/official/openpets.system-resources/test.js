import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ALERT_COOLDOWN_MS,
  DEFAULT_ALERT_PERCENT,
  DEFAULT_POLL_SECONDS,
  SCHEDULE_ID,
  clampPercent,
  collectSnapshot,
  hottestMetric,
  hudSpec,
  mergeSnapshot,
  readConfig,
  register,
  toneFor,
} from "./index.js";

let createTestHarness;
try {
  ({ createTestHarness } = await import("@open-pets/plugin-sdk/testing"));
} catch {
  ({ createTestHarness } = await import(new URL("../../../packages/sdk/dist/testing.js", import.meta.url)));
}

const realDateNow = Date.now;
let activeClock;
function createHarness(...args) {
  const harness = createTestHarness(...args);
  activeClock = harness.clock;
  return harness;
}
Date.now = () => activeClock?.now() ?? realDateNow();

const PERMISSIONS = [
  "pet:speak",
  "pet:reaction",
  "pet:pin",
  "schedule",
  "storage",
  "commands",
  "status",
  "system:metrics",
];

const LOCALES = {
  en: JSON.parse(await readFile(new URL("./locales/en.json", import.meta.url), "utf8")),
  "es-419": JSON.parse(await readFile(new URL("./locales/es-419.json", import.meta.url), "utf8")),
  ja: JSON.parse(await readFile(new URL("./locales/ja.json", import.meta.url), "utf8")),
  ko: JSON.parse(await readFile(new URL("./locales/ko.json", import.meta.url), "utf8")),
  "pt-BR": JSON.parse(await readFile(new URL("./locales/pt-BR.json", import.meta.url), "utf8")),
  "zh-Hans": JSON.parse(await readFile(new URL("./locales/zh-Hans.json", import.meta.url), "utf8")),
  "zh-Hant": JSON.parse(await readFile(new URL("./locales/zh-Hant.json", import.meta.url), "utf8")),
  de: JSON.parse(await readFile(new URL("./locales/de.json", import.meta.url), "utf8")),
  fr: JSON.parse(await readFile(new URL("./locales/fr.json", import.meta.url), "utf8")),
  nl: JSON.parse(await readFile(new URL("./locales/nl.json", import.meta.url), "utf8")),
};

// 1. Pure helper behavior
{
  assert.equal(clampPercent(12.4), 12);
  assert.equal(clampPercent(140), 100);
  assert.equal(clampPercent(-10), 0);
  assert.equal(clampPercent("invalid"), null);

  assert.equal(toneFor(40), "green");
  assert.equal(toneFor(75), "amber");
  assert.equal(toneFor(95), "red");
  assert.equal(toneFor(null), "slate");

  const merged = mergeSnapshot({ cpuPercent: 18, memUsedPercent: 55, gpuPercent: 22, diskUsedPercent: 71 });
  assert.equal(merged.cpu, 18);
  assert.equal(merged.ram, 55);
  assert.equal(merged.gpu, 22);
  assert.equal(merged.disk, 71);
  assert.equal(hottestMetric(merged).key, "disk");

  const cfg = readConfig({ pollSeconds: 3, alertPercent: 120, showHud: false });
  assert.equal(cfg.pollSeconds, 5);
  assert.equal(cfg.alertPercent, 99);
  assert.equal(cfg.showHud, false);
}

// 2. Metric-to-HUD behavior with standard and optional metrics
{
  const h = createHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 1_000_000 });
  h.system.setMetrics({ cpuPercent: 20, memUsedPercent: 65, gpuPercent: 15, diskUsedPercent: 40 });
  await h.start();

  h.expectScheduled(SCHEDULE_ID);
  h.expectBubble({ sticky: true, pin: true });

  const bubble = h.calls.bubbles.at(-1);
  assert.ok(bubble, "A pinned HUD bubble must be created");
  assert.equal(bubble.petId, "default", "Pinned HUD bubble must attach to default pet");
  assert.ok(bubble.spec.hud, "Bubble spec must contain a hud descriptor");
  assert.equal(bubble.spec.hud.items.length, 4);

  const [cpuItem, ramItem, gpuItem, diskItem] = bubble.spec.hud.items;
  assert.equal(cpuItem.icon.name, "cpu");
  assert.equal(cpuItem.value, 20);
  assert.equal(cpuItem.tone, "green");

  assert.equal(ramItem.icon.name, "ram");
  assert.equal(ramItem.value, 65);
  assert.equal(ramItem.tone, "green");

  assert.equal(gpuItem.icon.name, "gpu");
  assert.equal(gpuItem.value, 15);

  assert.equal(diskItem.icon.name, "disk");
  assert.equal(diskItem.value, 40);

  assert.match(String(h.calls.status.at(-1).text), /CPU 20% · RAM 65% · GPU 15% · Disk 40%/);
  h.expectNoErrors();
  await h.stop();
}

// 3. Optional metric omission when GPU/Disk are unsupported
{
  const h = createHarness(register, { permissions: PERMISSIONS, locales: LOCALES, nowMs: 1_200_000 });
  h.system.setMetrics({ cpuPercent: 30, memUsedPercent: 50 });
  await h.start();

  const bubble = h.calls.bubbles.at(-1);
  assert.equal(bubble.spec.hud.items.length, 2);
  assert.equal(bubble.spec.hud.items[0].icon.name, "cpu");
  assert.equal(bubble.spec.hud.items[1].icon.name, "ram");
  assert.match(String(h.calls.status.at(-1).text), /CPU 30% · RAM 50%/);

  h.expectNoErrors();
  await h.stop();
}

// 4. Durable visibility: Hide command keeps HUD hidden across later polling ticks
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    nowMs: 2_000_000,
    config: { pollSeconds: 5 },
  });
  h.system.setMetrics({ cpuPercent: 10, memUsedPercent: 30 });
  await h.start();

  assert.equal(h.calls.bubbles.length, 1, "HUD shown initially");
  assert.equal(h.calls.dismissedBubbles.length, 0);

  // User hides HUD via command
  await h.runCommand("hide");
  assert.equal(h.calls.dismissedBubbles.length, 1, "HUD bubble dismissed on hide");

  // Advance clock through multiple polling intervals
  await h.clock.advance("5s");
  await h.clock.advance("5s");
  await h.clock.advance("5s");

  // Verify that no new bubble was created on subsequent ticks
  assert.equal(h.calls.bubbles.length, 1, "No new bubbles created while HUD is hidden");

  // Showing HUD restores the bubble
  await h.runCommand("show");
  assert.equal(h.calls.bubbles.length, 2, "HUD restored on show command");

  h.expectNoErrors();
  await h.stop();
}

// 5. Config showHud: false starts without HUD
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    nowMs: 2_500_000,
    config: { showHud: false },
  });
  await h.start();
  assert.equal(h.calls.bubbles.length, 0, "No bubble when showHud is false in config");
  h.expectNoErrors();
  await h.stop();
}

// 6. Resilient failure handling during metrics sampling
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    nowMs: 3_000_000,
    config: { pollSeconds: 5 },
  });
  h.system.setMetrics({ cpuPercent: 25, memUsedPercent: 50 });
  await h.start();

  // Next metrics sample fails unexpectedly
  let failMetrics = true;
  const originalMetrics = h.ctx.system.metrics;
  h.ctx.system.metrics = async () => {
    if (failMetrics) {
      failMetrics = false;
      throw new Error("Transient OS metrics read failure");
    }
    return originalMetrics();
  };

  await h.clock.advance("5s");

  // Bubble should still exist and retain valid state rather than dropping
  const bubble = h.calls.bubbles.at(-1);
  assert.ok(bubble, "HUD bubble retained during transient failure");
  assert.equal(bubble.spec.hud.items[0].value, 25);

  // Advance time again; polling should recover
  h.system.setMetrics({ cpuPercent: 35, memUsedPercent: 55 });
  await h.clock.advance("5s");
  assert.equal(h.calls.bubbles.at(-1).spec.hud.items[0].value, 35);

  h.expectNoErrors();
  await h.stop();
}

// 7. Threshold alert and cooldown behavior
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    nowMs: 4_000_000,
    config: { alertPercent: 90, speakAlerts: true, pollSeconds: 5 },
  });
  h.system.setMetrics({ cpuPercent: 95, memUsedPercent: 40 });
  await h.start();

  h.expectReacted("error");
  h.expectSpoke(/CPU is at 95 percent/);
  const initialSpeakCount = h.calls.speak.length;

  // Next tick within cooldown does not spam
  h.system.setMetrics({ cpuPercent: 96, memUsedPercent: 40 });
  await h.clock.advance("1m");
  assert.equal(h.calls.speak.length, initialSpeakCount, "Alert suppressed within cooldown period");

  // After cooldown expires (10 minutes total), alert triggers again
  h.system.setMetrics({ cpuPercent: 97, memUsedPercent: 40 });
  await h.clock.advance("10m");
  assert.equal(h.calls.speak.length, initialSpeakCount + 1, "Alert triggered after cooldown expires");

  h.expectNoErrors();
  await h.stop();
}

// 8. Assistant capability (resources.get) produces structured result with no speech
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    nowMs: 5_000_000,
  });
  h.system.setMetrics({ cpuPercent: 12, memUsedPercent: 48, gpuPercent: 33, diskUsedPercent: 62 });
  await h.start();

  assert.ok(h.calls.assistantCapabilities.has("resources.get"), "resources.get capability must be registered");

  const initialSpeakCount = h.calls.speak.length;
  const result = await h.runCapability("resources.get", {});

  assert.equal(result.cpuPercent, 12);
  assert.equal(result.ramPercent, 48);
  assert.equal(result.gpuPercent, 33);
  assert.equal(result.diskPercent, 62);
  assert.equal(h.calls.speak.length, initialSpeakCount, "Assistant capability must produce no spoken output");

  h.expectNoErrors();
  await h.stop();
}

// 9. Snapshot command makes the pet speak the current resources
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    nowMs: 6_000_000,
  });
  h.system.setMetrics({ cpuPercent: 15, memUsedPercent: 45 });
  await h.start();

  await h.runCommand("snapshot");
  h.expectSpoke("CPU 15%, RAM 45%.");

  h.expectNoErrors();
  await h.stop();
}

// 10. Clean stop teardown
{
  const h = createHarness(register, {
    permissions: PERMISSIONS,
    locales: LOCALES,
    nowMs: 7_000_000,
    config: { pollSeconds: 5 },
  });
  await h.start();
  assert.equal(h.calls.schedules.size, 1);

  await h.stop();
  assert.equal(h.calls.schedules.size, 0, "Schedule cancelled on stop");
  assert.equal(h.calls.dismissedBubbles.length, 1, "HUD bubble dismissed on stop");
}

Date.now = realDateNow;

console.log("openpets.system-resources: all tests passed.");
