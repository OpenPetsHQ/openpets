import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CATALOGS, ALERT_COOLDOWN_MS, SCHEDULE_ID, clampPercent, collectSnapshot, hottestMetric, hudSpec, mergeSnapshot, readConfig, register, resolveLanguage, resourcesResult, snapshotCopy, staleSnapshot, tick, toneFor } from "./index.js";

let createTestHarness;
try {
  ({ createTestHarness } = await import("@open-pets/plugin-sdk/testing"));
} catch {
  throw new Error("Install @open-pets/plugin-sdk to run plugin tests.");
}

const PERMISSIONS = [
  "pet:speak",
  "pet:reaction",
  "pet:pin",
  "schedule",
  "storage",
  "commands",
  "status",
  "events",
  "system:metrics",
];
const LOCALES = {
  en: JSON.parse(await readFile(new URL("./locales/en.json", import.meta.url), "utf8")),
  nl: JSON.parse(await readFile(new URL("./locales/nl.json", import.meta.url), "utf8")),
  fr: JSON.parse(await readFile(new URL("./locales/fr.json", import.meta.url), "utf8")),
  de: JSON.parse(await readFile(new URL("./locales/de.json", import.meta.url), "utf8")),
};

const requiredKeys = Object.keys(LOCALES.en);
for (const [lang, catalog] of Object.entries(LOCALES)) {
  assert.deepEqual(Object.keys(catalog).sort(), requiredKeys.slice().sort(), `${lang} locale keys`);
  assert.deepEqual(catalog, CATALOGS[lang], `${lang} catalog matches locale file`);
}

assert.equal(resolveLanguage("auto", "fr-FR"), "fr");
assert.equal(resolveLanguage("de", "en-US"), "de");
assert.equal(resolveLanguage("nope", "nl-NL"), "nl");
assert.equal(CATALOGS.fr["plugin.name"], "Ressources système");
assert.equal(CATALOGS.de["speech.alert"].replace("{label}", "CPU").replace("{value}", "96"), "CPU liegt bei 96 Prozent.");

assert.equal(clampPercent(12.4), 12);
assert.equal(clampPercent(0), 0);
assert.equal(clampPercent(null), null);
assert.equal(clampPercent(undefined), null);
assert.equal(clampPercent(140), 100);
assert.equal(clampPercent("nope"), null);
assert.equal(toneFor(40), "green");
assert.equal(toneFor(75), "amber");
assert.equal(toneFor(95), "red");
assert.equal(toneFor(null), "slate");

const merged = mergeSnapshot({ cpuPercent: 11, memUsedPercent: 64, gpuPercent: 0, diskUsedPercent: 30 }, 1234);
assert.equal(merged.freshness, "fresh");
assert.equal(merged.cpu, 11);
assert.equal(merged.ram, 64);
assert.equal(merged.gpu, 0);
assert.equal(merged.disk, 30);
assert.equal(merged.extendedMetricsAvailable, true);
assert.equal(hottestMetric(merged).key, "ram");
assert.equal(staleSnapshot(merged, 999).sampledAt, 1234);
assert.equal(staleSnapshot(merged, 999).freshness, "stale");
const unavailable = mergeSnapshot({ cpuPercent: null, memUsedPercent: undefined, gpuPercent: null, diskUsedPercent: undefined }, 1234);
assert.equal(unavailable.freshness, "unavailable");
assert.deepEqual(unavailable, {
  freshness: "unavailable",
  cpu: null,
  ram: null,
  gpu: null,
  disk: null,
  extendedMetricsAvailable: false,
  batteryPercent: null,
  batteryCharging: null,
  batteryAvailable: false,
  networkDownloadBytesPerSecond: null,
  networkUploadBytesPerSecond: null,
  networkAvailable: false,
  extendedMetricsSampledAt: null,
  sampledAt: 1234,
  attemptedAt: 1234,
});
assert.equal(mergeSnapshot({}, 1234).cpu, null, "missing CPU stays unavailable");
assert.equal(mergeSnapshot({}, 1234).ram, null, "missing RAM stays unavailable");
const genuineZeros = mergeSnapshot({ cpuPercent: 0, memUsedPercent: 0, gpuPercent: 0, diskUsedPercent: 0 }, 1234);
assert.equal(genuineZeros.freshness, "fresh");
assert.deepEqual([genuineZeros.cpu, genuineZeros.ram, genuineZeros.gpu, genuineZeros.disk], [0, 0, 0, 0]);

const cfg = readConfig({ pollSeconds: 3, alertPercent: 140, showHud: false });
assert.equal(cfg.pollSeconds, 5);
assert.equal(cfg.alertPercent, 99);
assert.equal(cfg.showHud, false);
assert.equal(cfg.showCpu, true);
assert.equal(cfg.showRam, true);
assert.equal(cfg.showGpu, true);
assert.equal(cfg.showDisk, true);
assert.equal(cfg.showBattery, true);
assert.equal(cfg.showNetwork, true);
assert.equal(cfg.alertCpu, true);
assert.equal(cfg.alertRam, true);
assert.equal(cfg.alertGpu, true);
assert.equal(cfg.alertDisk, true);
assert.equal(cfg.language, "en");
assert.equal(readConfig({ language: "fr" }, "de").language, "fr");
assert.equal(readConfig({ language: "auto" }, "de-DE").language, "de");
const selectiveCfg = readConfig({ showCpu: false, showRam: false, showGpu: true, showDisk: false, alertCpu: false, alertRam: false, alertGpu: false, alertDisk: true });
assert.deepEqual(
  [selectiveCfg.showCpu, selectiveCfg.showRam, selectiveCfg.showGpu, selectiveCfg.showDisk],
  [false, false, true, false],
  "display preferences are independently parsed",
);
assert.deepEqual(
  [selectiveCfg.alertCpu, selectiveCfg.alertRam, selectiveCfg.alertGpu, selectiveCfg.alertDisk],
  [false, false, false, true],
  "alert preferences are independently parsed",
);

const zeroSpec = hudSpec({ assets: { icon: (name) => ({ kind: "icon", name }) } }, mergeSnapshot({ cpuPercent: 0, memUsedPercent: 0, diskUsedPercent: 0 }, 1));
assert.deepEqual(zeroSpec.hud.items.map((item) => item.value), [0, 0, 0]);
assert.deepEqual(zeroSpec.hud.items.map((item) => item.icon.name), ["cpu", "ram", "disk"]);
assert.equal(hudSpec({ assets: { icon: (name) => ({ kind: "icon", name }) } }, mergeSnapshot({}, 1)), null);
const allMetrics = mergeSnapshot({ cpuPercent: 10, memUsedPercent: 20, gpuPercent: 30, diskUsedPercent: 40 }, 1);
const selectiveSpec = hudSpec({ assets: { icon: (name) => ({ kind: "icon", name }) } }, allMetrics, "en", selectiveCfg);
assert.deepEqual(selectiveSpec.hud.items.map((item) => item.icon.name), ["gpu"]);
assert.equal(selectiveSpec.hud.items.length <= 4, true, "HUD respects the host's four-item limit");
assert.equal(
  hudSpec({ assets: { icon: (name) => ({ kind: "icon", name }) } }, allMetrics, "en", readConfig({ showCpu: false, showRam: false, showGpu: false, showDisk: false })),
  null,
  "all disabled indicators produce no invalid empty HUD",
);
assert.match(snapshotCopy("en", staleSnapshot(merged, 2000), "status"), /stale/);
assert.equal(resourcesResult(staleSnapshot(merged, 2000)).freshness, "stale");
const batterySnapshot = mergeSnapshot({ cpuPercent: 1, memUsedPercent: 2, battery: { percent: 84, charging: true } }, 1234);
assert.equal(batterySnapshot.batteryPercent, 84);
assert.equal(batterySnapshot.batteryCharging, true);
assert.equal(resourcesResult(batterySnapshot).batteryPercent, 84);
assert.equal(resourcesResult(batterySnapshot).batteryCharging, true);
const unavailableBattery = mergeSnapshot({ cpuPercent: 1, memUsedPercent: 2, battery: { percent: null, charging: false } }, 1234);
assert.equal(unavailableBattery.batteryPercent, null, "missing battery percentage stays unavailable");
assert.equal(unavailableBattery.batteryCharging, false, "charging state is preserved independently");
assert.equal(unavailableBattery.batteryAvailable, false, "partial battery data is not presented as available");
const networkSnapshot = mergeSnapshot({ cpuPercent: 1, memUsedPercent: 2, network: { downloadBytesPerSecond: 2048, uploadBytesPerSecond: 512 } }, 1234);
assert.equal(networkSnapshot.networkAvailable, true);
assert.equal(networkSnapshot.extendedMetricsAvailable, true, "network availability is included in extended metrics");
assert.equal(resourcesResult(networkSnapshot).networkDownloadBytesPerSecond, 2048);
assert.equal(resourcesResult(networkSnapshot).networkUploadBytesPerSecond, 512);
assert.match(snapshotCopy("en", networkSnapshot, "status"), /Network/);
assert.match(snapshotCopy("en", networkSnapshot, "speech"), /download/);
const unavailableNetwork = mergeSnapshot({ cpuPercent: 1, memUsedPercent: 2, network: { downloadBytesPerSecond: null, uploadBytesPerSecond: null } }, 1234);
assert.deepEqual([unavailableNetwork.networkDownloadBytesPerSecond, unavailableNetwork.networkUploadBytesPerSecond, unavailableNetwork.networkAvailable], [null, null, false], "explicitly unavailable network readings stay null");
const staleExtended = mergeSnapshot({ cpuPercent: 12, memUsedPercent: 34, gpuPercent: 90, diskUsedPercent: 80, battery: { percent: 50, charging: false }, network: { downloadBytesPerSecond: 100, uploadBytesPerSecond: 50 }, extendedMetricsFresh: false, extendedMetricsSampledAt: 77 }, 1234);
assert.deepEqual([staleExtended.gpu, staleExtended.disk, staleExtended.batteryPercent, staleExtended.networkDownloadBytesPerSecond], [null, null, null, null], "expired optional metrics stay unavailable");

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function makeHarness(options = {}) {
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES, ...options });
  const capabilities = new Map();
  h.ctx.assistant = {
    registerCapability: async (capability, handler) => {
      capabilities.set(capability.id, { capability, handler });
    },
    unregisterCapability: async (id) => { capabilities.delete(id); },
  };
  h.__capabilities = capabilities;
  return h;
}

async function runCapability(h, id) {
  const entry = h.__capabilities.get(id);
  assert.ok(entry, `assistant capability ${id} is registered`);
  return entry.handler({});
}

{
  const h = makeHarness({ nowMs: 1_000_000 });
  await h.start();
  h.expectScheduled(SCHEDULE_ID);
  h.expectBubble({ sticky: true, pin: true });
  const bubble = h.calls.bubbles.at(-1);
  assert.equal(bubble.petId, "default", "resource HUD must use the existing default pet");
  assert.deepEqual(h.calls.spawnedPets, [], "integrated HUD must not create a satellite pet");
  assert.equal(bubble.spec.priority, "low", "background resource refresh yields to the normal-priority Virtual Pet HUD");
  assert.deepEqual(bubble.spec.hud.items.map((item) => item.value), [5, 40]);
  assert.match(String(h.calls.status.at(-1).text), /CPU 5% · RAM 40%/);
  assert.doesNotMatch(String(h.calls.status.at(-1).text), /SSD|satellite|sidecar/i);
  h.expectNoErrors();
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 2_000_000 });
  h.system.setMetrics({ cpuPercent: 0, memUsedPercent: 0, gpuPercent: 0 });
  await h.start();
  const items = h.calls.bubbles.at(-1).spec.hud.items;
  assert.deepEqual(items.map((item) => item.value), [0, 0, 0]);
  assert.deepEqual(items.map((item) => item.icon.name), ["cpu", "ram", "gpu"]);
  h.system.setMetrics({ cpuPercent: 0, memUsedPercent: 0, diskUsedPercent: 44 });
  await tick(h.ctx, Date.now() + 1_000);
  const diskItems = h.calls.bubbles.at(-1).spec.hud.items;
  assert.deepEqual(diskItems.map((item) => item.icon.name), ["cpu", "ram", "disk"]);
  assert.equal(diskItems.at(-1).value, 44);
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 3_000_000, config: { showHud: false } });
  await h.start();
  assert.equal(h.calls.bubbles.length, 0, "HUD stays off when the setting is false");
  await h.runCommand("show");
  assert.equal(h.calls.bubbles.at(-1).petId, "default", "Show works even when the setting was false");
  assert.equal(h.calls.bubbles.at(-1).spec.priority, "normal", "explicit Show can claim the shared pinned slot");
  await h.runCommand("hide");
  const countAfterHide = h.calls.bubbles.length;
  await tick(h.ctx, Date.now() + 30_000);
  assert.equal(h.calls.bubbles.length, countAfterHide, "polling cannot resurrect a hidden HUD");
  await h.setConfig({ showHud: true });
  assert.ok(h.calls.bubbles.length > countAfterHide, "changing the visibility setting restores the HUD");
  await h.setConfig({ showHud: false });
  assert.equal(h.calls.bubbles.at(-1).dismissed, true, "changing the setting hides the HUD");
  await h.stop();
}

{
  const h = makeHarness({
    nowMs: 3_250_000,
    config: { showCpu: false, showRam: true, showGpu: true, showDisk: false },
  });
  h.system.setMetrics({ cpuPercent: 10, memUsedPercent: 20, gpuPercent: 30, diskUsedPercent: 40 });
  await h.start();
  assert.deepEqual(h.calls.bubbles.at(-1).spec.hud.items.map((item) => item.icon.name), ["ram", "gpu"]);
  await h.setConfig({ showCpu: true, showRam: false, showGpu: false, showDisk: false });
  assert.deepEqual(h.calls.bubbles.at(-1).spec.hud.items.map((item) => item.icon.name), ["cpu"], "display changes update the running HUD immediately");
  await h.setConfig({ showCpu: false, showRam: false, showGpu: false, showDisk: false });
  assert.equal(h.calls.bubbles.at(-1).dismissed, true, "disabling every indicator dismisses the existing HUD");
  const countAfterDisable = h.calls.bubbles.length;
  await h.runCommand("show");
  assert.equal(h.calls.bubbles.length, countAfterDisable, "Show does not create an empty HUD");
  await h.setConfig({ showCpu: false, showRam: false, showGpu: false, showDisk: true });
  assert.deepEqual(h.calls.bubbles.at(-1).spec.hud.items.map((item) => item.icon.name), ["disk"]);
  await h.stop();
  await h.start();
  assert.deepEqual(h.calls.bubbles.at(-1).spec.hud.items.map((item) => item.icon.name), ["disk"], "display preferences survive a plugin restart");
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 3_500_000 });
  await h.start();
  const bubble = h.calls.bubbles.at(-1);
  const countAfterStart = h.calls.bubbles.length;
  await h.dismissBubble(bubble.handle.id, "replaced");
  await tick(h.ctx, Date.now() + 30_000);
  assert.equal(h.calls.bubbles.length, countAfterStart, "a replaced pinned slot is not repeatedly re-evicted");
  await h.runCommand("show");
  assert.ok(h.calls.bubbles.length > countAfterStart, "explicit Show can restore a HUD after another plugin replaced it");
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 3_600_000 });
  h.calls.storage.set("snapshot", {
    freshness: "fresh",
    cpu: null,
    ram: 0,
    gpu: null,
    disk: undefined,
    batteryPercent: 72,
    batteryCharging: true,
    sampledAt: 3_500_000,
  });
  h.ctx.system.metrics = async () => { throw new Error("temporary metrics outage"); };
  await h.start();
  const restoredItems = h.calls.bubbles.at(-1).spec.hud.items;
  assert.deepEqual(restoredItems.map((item) => item.icon.name), ["ram"]);
  assert.equal(restoredItems[0].value, 0, "restored genuine zero remains zero");
  const restored = await runCapability(h, "resources.get");
  assert.equal(restored.cpuPercent, null, "restored explicit null remains null");
  assert.equal(restored.ramPercent, 0, "restored zero remains zero");
  assert.equal(restored.gpuPercent, null, "restored missing GPU remains null");
  assert.equal(restored.diskUsedPercent, null, "restored missing disk remains null");
  assert.equal(restored.batteryPercent, 72, "restored battery percentage remains available");
  assert.equal(restored.batteryCharging, true, "restored charging state remains available");
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 3_750_000 });
  await h.start();
  await Promise.all([
    h.setConfig({ pollSeconds: 5 }),
    h.setConfig({ pollSeconds: 6 }),
    h.setConfig({ pollSeconds: 7 }),
  ]);
  assert.equal(h.calls.schedules.size, 1, "rapid configuration changes keep one active schedule");
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 4_000_000, config: { showHud: true } });
  h.calls.storage.set("hudVisible", false);
  h.calls.storage.set("hudConfigValue", true);
  await h.start();
  assert.equal(h.calls.bubbles.length, 0, "stored Hide survives a restart");
  await h.stop();
  await h.start();
  assert.equal(h.calls.bubbles.length, 0, "stored visibility remains hidden after a second start");
  await h.runCommand("show");
  assert.ok(h.calls.bubbles.length > 0);
  assert.equal(h.calls.storage.get("hudVisible"), true);
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 5_000_000 });
  await h.start();
  let resolveMetrics;
  h.ctx.system.metrics = () => new Promise((resolve) => { resolveMetrics = resolve; });
  const countBefore = h.calls.bubbles.length;
  const pending = tick(h.ctx, Date.now() + 2_000);
  await flush();
  await h.runCommand("hide");
  resolveMetrics({ cpuPercent: 80, memUsedPercent: 80 });
  await pending;
  assert.equal(h.calls.bubbles.length, countBefore, "late metrics cannot recreate a hidden HUD");
  assert.equal(h.calls.bubbles.at(-1).dismissed, true);
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 6_000_000 });
  await h.start();
  let resolveMetrics;
  h.ctx.system.metrics = () => new Promise((resolve) => { resolveMetrics = resolve; });
  const poll = tick(h.ctx, Date.now() + 3_000);
  await flush();
  const stop = h.stop();
  resolveMetrics({ cpuPercent: 90, memUsedPercent: 90 });
  await Promise.all([poll, stop]);
  assert.equal(h.calls.schedules.size, 0, "shutdown cancels the polling schedule");
  assert.equal(h.calls.bubbles.at(-1).dismissed, true);
}

{
  const h = makeHarness({ nowMs: 7_000_000 });
  await h.start();
  let active = 0;
  let maximum = 0;
  const resolvers = [];
  h.ctx.system.metrics = () => new Promise((resolve) => {
    active += 1;
    maximum = Math.max(maximum, active);
    resolvers.push((metrics) => { active -= 1; resolve(metrics); });
  });
  const first = tick(h.ctx, Date.now() + 4_000);
  await flush();
  const second = tick(h.ctx, Date.now() + 5_000);
  await flush();
  assert.equal(maximum, 1, "poll requests share one metrics read");
  const firstResolver = resolvers.shift();
  assert.equal(typeof firstResolver, "function");
  firstResolver({ cpuPercent: 12, memUsedPercent: 34 });
  for (let attempt = 0; attempt < 20 && resolvers.length === 0; attempt += 1) await flush();
  assert.ok(resolvers.length > 0, "a queued poll starts after the first read completes");
  assert.equal(maximum, 1, "a queued poll waits for the active metrics read");
  resolvers.shift()({ cpuPercent: 13, memUsedPercent: 35 });
  await Promise.all([first, second]);
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 8_000_000 });
  await h.start();
  const initialBubbles = h.calls.bubbles.length;
  const originalMetrics = h.ctx.system.metrics;
  h.ctx.system.metrics = async () => { throw new Error("temporary metrics outage"); };
  const stale = await tick(h.ctx, Date.now() + 6_000);
  assert.equal(stale.freshness, "stale");
  assert.equal(h.calls.bubbles.length, initialBubbles, "stale metrics update the existing HUD");
  assert.match(String(h.calls.bubbles.at(-1).spec.hud.items.at(0).label), /stale/);
  assert.match(String(h.calls.status.at(-1).text), /stale/);
  assert.equal(h.calls.react.length, 0, "stale readings cannot create alerts");
  const staleCapability = await runCapability(h, "resources.get");
  assert.equal(staleCapability.freshness, "stale");
  assert.equal(staleCapability.cpuPercent, 5);
  h.ctx.system.metrics = originalMetrics;
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 9_000_000 });
  h.ctx.system.metrics = async () => { throw new Error("no metrics"); };
  await h.start();
  assert.equal(h.calls.bubbles.length, 0, "unavailable metrics do not create a zero-valued HUD");
  assert.match(String(h.calls.status.at(-1).text), /unavailable/i);
  const result = await runCapability(h, "resources.get");
  assert.equal(result.cpuPercent, null);
  assert.equal(result.ramPercent, null);
  assert.equal(result.gpuPercent, null);
  assert.equal(result.diskUsedPercent, null);
  assert.equal(result.freshness, "unavailable");
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 10_000_000 });
  h.system.setMetrics({ cpuPercent: 96, memUsedPercent: 40 });
  await h.start();
  const base = Date.now();
  assert.equal(h.calls.react.length, 0, "a single CPU spike does not alert");
  await tick(h.ctx, base + 1_000);
  assert.equal(h.calls.react.length, 0, "one scheduled high sample does not alert");
  await tick(h.ctx, base + 2_000);
  const firstAlertCount = h.calls.react.length;
  assert.equal(firstAlertCount, 1, "CPU alerts after two consecutive scheduled samples");
  h.system.setMetrics({ cpuPercent: 97, memUsedPercent: 40 });
  await tick(h.ctx, base + 60_000);
  assert.equal(h.calls.react.length, firstAlertCount, "alert cooldown suppresses repeated alerts");
  await tick(h.ctx, base + ALERT_COOLDOWN_MS + 3_000);
  assert.equal(h.calls.react.length, firstAlertCount + 1, "alert cooldown expires normally");
  await h.stop();
}

{
  const interactions = [
    ["resources.get", async (h) => {
      await runCapability(h, "resources.get");
      await runCapability(h, "resources.get");
      await h.runCommand("show");
    }],
    ["Show", async (h) => {
      await h.runCommand("show");
    }],
    ["display-setting changes", async (h) => {
      await h.setConfig({
        showHud: true,
        showCpu: false,
        showRam: true,
        showGpu: true,
        showDisk: true,
        alertPercent: 90,
        alertCpu: true,
        alertRam: false,
        alertGpu: true,
        alertDisk: false,
      });
      await h.setConfig({
        showHud: true,
        showCpu: true,
        showRam: true,
        showGpu: true,
        showDisk: true,
        alertPercent: 90,
        alertCpu: true,
        alertRam: false,
        alertGpu: true,
        alertDisk: false,
      });
    }],
  ];
  for (const [label, interact] of interactions) {
    const h = makeHarness({
      nowMs: 10_250_000,
      config: { alertPercent: 90, alertCpu: true, alertRam: false, alertGpu: true, alertDisk: false },
    });
    h.system.setMetrics({ cpuPercent: 96, memUsedPercent: 40, gpuPercent: 96 });
    await h.start();
    const alertsBeforeInteraction = h.calls.react.length;
    await interact(h);
    assert.equal(h.calls.react.length, alertsBeforeInteraction, `${label} cannot manufacture a sustained CPU/GPU alert`);
    await h.stop();
  }
}

{
  const h = makeHarness({ nowMs: 10_500_000, config: { alertPercent: 90, alertCpu: false, alertRam: true, alertGpu: true, alertDisk: false } });
  h.system.setMetrics({ cpuPercent: 99, memUsedPercent: 95, gpuPercent: 95, diskUsedPercent: 95 });
  await h.start();
  assert.equal(h.calls.react.length, 1, "RAM usage remains an individually configurable immediate alert");
  assert.match(h.calls.speak.at(-1), /RAM usage/);
  await tick(h.ctx, Date.now() + 1_000);
  assert.equal(h.calls.react.length, 1, "GPU needs a second sustained sample but cooldown does not create another alert");
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 10_700_000, config: { alertPercent: 90, alertCpu: false, alertRam: false, alertGpu: true, alertDisk: false } });
  h.system.setMetrics({ cpuPercent: 10, memUsedPercent: 20, gpuPercent: 95 });
  await h.start();
  assert.equal(h.calls.react.length, 0, "disabled alert metrics stay silent");
  await tick(h.ctx, Date.now() + 1_000);
  assert.equal(h.calls.react.length, 0, "one scheduled GPU sample is not sustained");
  await tick(h.ctx, Date.now() + 2_000);
  assert.equal(h.calls.react.length, 1, "GPU alerts after consecutive scheduled samples");
  h.system.setMetrics({ cpuPercent: 10, memUsedPercent: 20, gpuPercent: 20 });
  await tick(h.ctx, Date.now() + 2_000);
  h.system.setMetrics({ cpuPercent: 10, memUsedPercent: 20, gpuPercent: 95 });
  await tick(h.ctx, Date.now() + ALERT_COOLDOWN_MS + 3_000);
  assert.equal(h.calls.react.length, 1, "recovery resets the GPU sustained counter");
  await tick(h.ctx, Date.now() + ALERT_COOLDOWN_MS + 4_000);
  assert.equal(h.calls.react.length, 2, "GPU alerts again only after another sustained crossing");
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 10_800_000, config: { alertPercent: 90, alertCpu: false, alertRam: false, alertGpu: true, alertDisk: false } });
  h.system.setMetrics({ cpuPercent: 10, memUsedPercent: 20, gpuPercent: 95, extendedMetricsSampledAt: 1 });
  await h.start();
  await tick(h.ctx, Date.now() + 1_000);
  assert.equal(h.calls.react.length, 0, "one fresh GPU sample starts but does not finish the streak");
  await runCapability(h, "resources.get");
  await h.runCommand("show");
  await h.setConfig({ showCpu: false, showRam: true, showGpu: true, showDisk: true, alertPercent: 90, alertCpu: false, alertRam: false, alertGpu: true, alertDisk: false });
  await tick(h.ctx, Date.now() + 2_000);
  assert.equal(h.calls.react.length, 0, "assistant and UI reads of a cached GPU sample cannot advance the streak");
  h.system.setMetrics({ cpuPercent: 10, memUsedPercent: 20, gpuPercent: 95, extendedMetricsSampledAt: 2 });
  await tick(h.ctx, Date.now() + 3_000);
  assert.equal(h.calls.react.length, 1, "two distinct scheduled GPU samples trigger the alert");
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 10_900_000, config: { alertPercent: 90, alertCpu: true, alertRam: true, alertGpu: true, alertDisk: true } });
  h.system.setMetrics({ cpuPercent: 10, memUsedPercent: 20, gpuPercent: null, diskUsedPercent: null });
  await h.start();
  h.system.setMetrics({ cpuPercent: 10, memUsedPercent: 20, gpuPercent: null, diskUsedPercent: null });
  await tick(h.ctx, Date.now() + 1_000);
  assert.equal(h.calls.react.length, 0, "missing optional metrics cannot alert");
  h.ctx.system.metrics = async () => { throw new Error("stale readings"); };
  await tick(h.ctx, Date.now() + 2_000);
  assert.equal(h.calls.react.length, 0, "stale readings cannot alert");
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 11_000_000, config: { alertPercent: 90, alertCpu: false, alertRam: false, alertGpu: false, alertDisk: true } });
  h.system.setMetrics({ cpuPercent: 10, memUsedPercent: 20, diskUsedPercent: 95 });
  await h.start();
  assert.equal(h.calls.react.length, 1, "disk capacity has its own alert switch");
  assert.match(h.calls.speak.at(-1), /Disk capacity/);
  await h.stop();
  await h.start();
  assert.equal(h.calls.react.length, 1, "the alert cooldown survives a plugin restart");
  await h.setConfig({ alertPercent: 95, alertCpu: false, alertRam: false, alertGpu: false, alertDisk: true });
  assert.equal(h.calls.react.length, 1, "changing alert settings does not clear the persisted cooldown");
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 11_000_000 });
  await h.start();
  const originalStorageSet = h.ctx.storage.set;
  h.ctx.storage.set = async () => { throw new Error("temporary storage outage"); };
  await h.runCommand("hide");
  await h.runCommand("show");
  h.ctx.storage.set = originalStorageSet;
  const originalOnce = h.ctx.schedule.once;
  h.ctx.schedule.once = async () => { throw new Error("temporary scheduler outage"); };
  await h.setConfig({ pollSeconds: 5 });
  assert.equal(h.calls.schedules.size, 0, "failed scheduling does not leave an untracked operation");
  h.ctx.schedule.once = originalOnce;
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 11_500_000 });
  const originalOnce = h.ctx.schedule.once;
  let scheduleAttempts = 0;
  h.ctx.schedule.once = async (...args) => {
    scheduleAttempts += 1;
    if (scheduleAttempts === 1) throw new Error("temporary scheduler outage");
    return originalOnce(...args);
  };
  await h.start();
  assert.equal(scheduleAttempts, 2, "schedule registration retries once after a failure");
  assert.equal(h.calls.schedules.size, 1, "recovered registration leaves one active schedule");
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 11_600_000 });
  const originalOnce = h.ctx.schedule.once;
  let schedulerAvailable = false;
  let scheduleAttempts = 0;
  h.ctx.schedule.once = async (...args) => {
    scheduleAttempts += 1;
    if (!schedulerAvailable) throw new Error("host scheduler unavailable");
    return originalOnce(...args);
  };
  await h.start();
  assert.equal(scheduleAttempts, 2, "persistent scheduler failure is bounded");
  assert.equal(h.calls.schedules.size, 0, "failed registration leaves no schedule");
  await tick(h.ctx, Date.now() + 5_000);
  assert.equal(scheduleAttempts, 2, "polling does not create an uncontrolled retry loop");
  schedulerAvailable = true;
  await h.setConfig({ pollSeconds: 5 });
  assert.equal(scheduleAttempts, 3, "a later configuration change retries registration");
  assert.equal(h.calls.schedules.size, 1, "configuration recovery arms one schedule");
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 11_700_000 });
  const hostBubble = h.ctx.ui.bubble;
  let bubbleAttempts = 0;
  let higherPriorityOwner = true;
  h.ctx.ui.bubble = async (spec) => {
    bubbleAttempts += 1;
    if (!higherPriorityOwner) return hostBubble(spec);
    return {
      id: `rejected-pinned-${bubbleAttempts}`,
      // The arbiter has already dismissed this entry before the SDK bridge
      // returns its public handle. The later bridge update therefore rejects.
      update: async () => { throw new Error("Plugin bubble is no longer live."); },
      dismiss: async () => undefined,
      pin: async () => undefined,
      unpin: async () => undefined,
      onAction: () => undefined,
      onSubmit: () => undefined,
      // The bridge's bubbleSubscribe sees no live slot and the preload
      // silently ignores its { ok: false } response.
      onDismiss: () => undefined,
    };
  };
  await h.start();
  await tick(h.ctx, Date.now() + 5_000);
  assert.equal(bubbleAttempts, 1, "a higher-priority pinned owner is not reclaimed on every poll");
  await tick(h.ctx, Date.now() + 10_000);
  assert.equal(bubbleAttempts, 1, "an inactive handle remains suppressed on later polls");
  higherPriorityOwner = false;
  await h.runCommand("show");
  assert.equal(bubbleAttempts, 2, "explicit Show can retry after the pinned slot is available");
  assert.equal(h.calls.bubbles.at(-1).petId, "default");
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 11_800_000 });
  await h.start();
  const firstBubble = h.calls.bubbles.at(-1);
  firstBubble.handle.update = async () => { throw new Error("temporary host update outage"); };
  await tick(h.ctx, Date.now() + 5_000);
  assert.equal(h.calls.bubbles.length, 2, "recoverable update failures can recreate the HUD");
  await tick(h.ctx, Date.now() + 10_000);
  assert.equal(h.calls.bubbles.length, 2, "a recovered HUD is updated in place");
  await h.stop();
}

{
  const h = makeHarness({ nowMs: 12_000_000 });
  await h.start();
  await h.emit("pet:clicked", {});
  assert.ok(h.calls.speak.some((message) => message.includes("CPU 5%")), "existing click-to-read behavior remains");
  const capabilitySpeechCount = h.calls.speak.length;
  const result = await runCapability(h, "resources.get");
  assert.equal(result.cpuPercent, 5);
  assert.equal(result.ramPercent, 40);
  assert.equal(h.calls.speak.length, capabilitySpeechCount, "resources.get does not speak");
  await h.stop();
}

const manifest = JSON.parse(await readFile(new URL("./openpets.plugin.json", import.meta.url), "utf8"));
assert.equal(manifest.id, "openpets.system-resources");
assert.equal(manifest.version, "2.1.0");
assert.deepEqual(manifest.permissions.slice().sort(), PERMISSIONS.slice().sort());
assert.equal(manifest.assets.icons.disk, "assets/disk.svg");
assert.equal(manifest.assets.icons.ssd, undefined);
for (const key of ["showCpu", "showRam", "showGpu", "showDisk", "alertCpu", "alertRam", "alertGpu", "alertDisk"]) {
  assert.equal(manifest.configSchema[key].type, "boolean", `${key} is a boolean setting`);
  assert.equal(manifest.configSchema[key].default, true, `${key} keeps the default-on behavior`);
}
for (const key of ["showBattery", "showNetwork"]) {
  assert.equal(manifest.configSchema[key].type, "boolean", `${key} is a boolean setting`);
  assert.equal(manifest.configSchema[key].default, true, `${key} keeps the default-on behavior`);
}
for (const field of Object.values(manifest.configSchema)) {
  for (const property of ["label", "description"]) {
    const reference = field[property];
    assert.equal(typeof reference, "string");
    assert.equal(reference.startsWith("$t:"), true);
    assert.equal(Object.hasOwn(LOCALES.en, reference.slice(3)), true, `${property} resolves in English`);
  }
}

console.log("openpets.system-resources: all checks passed.");
