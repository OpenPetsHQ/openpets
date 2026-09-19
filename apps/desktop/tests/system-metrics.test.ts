import assert from "node:assert/strict";

import {
  batteryMetricsFromIoreg,
  batteryMetricsFromWindowsJson,
  createNetworkRateSampler,
  createStaleWhileRevalidateCache,
  diskUsedPercentFromStatFs,
  gpuPercentFromIoreg,
  networkCountersFromNetstat,
  networkCountersFromWindowsJson,
  readExtendedSystemMetrics,
  readNetworkCountersForPlatform,
  type ExtendedSystemMetrics,
} from "../src/system-metrics.js";

// The SDK exposes aggregate, bounded values only: unavailable hardware omits a metric.
assert.equal(diskUsedPercentFromStatFs({ blocks: 100, bfree: 25 }), 75);
assert.equal(diskUsedPercentFromStatFs({ blocks: 0, bfree: 0 }), undefined);
// macOS APFS statfs("/") reports shared System/Data container capacity, not
// the sealed System snapshot's per-volume `df` usage.
const apfsVolumeGroupStat = {
  type: 26,
  bsize: 4096,
  blocks: 122_061_322,
  bfree: 59_471_280,
  bavail: 59_471_280,
};
assert.equal(diskUsedPercentFromStatFs(apfsVolumeGroupStat), 51);
assert.equal(gpuPercentFromIoreg('"Device Utilization %" = 41'), 41);
assert.equal(gpuPercentFromIoreg('"Device Utilization %" = 20, "Renderer Utilization %" = 40'), 30);
assert.equal(gpuPercentFromIoreg('"Device Utilization %" = 201'), undefined);
assert.equal(gpuPercentFromIoreg('"Device Utilization % at cur p-state" = 68'), undefined);
assert.equal(gpuPercentFromIoreg('"Device Unit 0 Utilization %" = 68, "Device Unit 1 Utilization %" = 32'), 50);
assert.equal(gpuPercentFromIoreg("unavailable"), undefined);
assert.deepEqual(batteryMetricsFromIoreg('"CurrentCapacity" = 42, "MaxCapacity" = 84, "IsCharging" = Yes'), { percent: 50, charging: true });
assert.equal(batteryMetricsFromIoreg('"CurrentCapacity" = 42, "IsCharging" = No'), undefined);
assert.deepEqual(batteryMetricsFromWindowsJson('{"EstimatedChargeRemaining":73,"BatteryStatus":2}'), { percent: 73, charging: false });
assert.deepEqual(batteryMetricsFromWindowsJson('{"EstimatedChargeRemaining":73,"BatteryStatus":6}'), { percent: 73, charging: true });
assert.equal(batteryMetricsFromWindowsJson("{}"), undefined);

assert.deepEqual(networkCountersFromNetstat(`Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
en0 1500 <Link#4> aa:bb 10 0 1000 20 0 2000 0
en0 1500 192.0.2 192.0.2.2 10 0 1000 20 0 2000 0
lo0 16384 <Link#1> 00:00 10 0 9999 10 0 9999 0
en1 1500 <Link#5> cc:dd 10 0 3000 20 0 4000 0`), { receivedBytes: 4000, sentBytes: 6000 });
assert.deepEqual(networkCountersFromWindowsJson('[{"Name":"Wi-Fi","ReceivedBytes":100,"SentBytes":200},{"Name":"Ethernet","ReceivedBytes":300,"SentBytes":400}]'), { receivedBytes: 400, sentBytes: 600 });
assert.deepEqual(networkCountersFromWindowsJson('{"Name":"Wi-Fi","ReceivedBytes":100,"SentBytes":200}'), { receivedBytes: 100, sentBytes: 200 });
assert.equal(networkCountersFromWindowsJson('{"Name":"Wi-Fi","ReceivedBytes":null,"SentBytes":null}'), undefined);
assert.equal(networkCountersFromWindowsJson('{"Name":"Wi-Fi"}'), undefined);

{
  let now = 0;
  const samples = [
    { receivedBytes: 100, sentBytes: 200 },
    { receivedBytes: 1_100, sentBytes: 700 },
    { receivedBytes: 100, sentBytes: 50 },
    { receivedBytes: 600, sentBytes: 550 },
  ];
  const sampler = createNetworkRateSampler(async () => samples.shift(), { now: () => now, maxGapMs: 5_000 });
  assert.equal(await sampler(), undefined, "the first counter sample establishes a baseline");
  now = 1_000;
  assert.deepEqual(await sampler(), { downloadBytesPerSecond: 1000, uploadBytesPerSecond: 500 });
  now = 2_000;
  assert.equal(await sampler(), undefined, "counter resets establish a new baseline");
  now = 8_000;
  assert.equal(await sampler(), undefined, "a sleep-sized gap does not fabricate throughput");
}

{
  const calls: Array<{ command: string; args: string[] }> = [];
  let volumePath = "";
  const metrics = await readExtendedSystemMetrics({
    platform: "darwin",
    run: async (command, args) => {
      calls.push({ command, args });
      return args.at(-1) === "IOGPU" ? "no aggregate utilization" : '"Renderer Utilization %" = 37';
    },
    statfs: async (path) => {
      volumePath = path;
      return { blocks: 100, bfree: 23 };
    },
    readDirectory: async () => [],
    readFile: async () => "",
    now: () => 1234,
  });
  assert.deepEqual(metrics, { gpuPercent: 37, diskUsedPercent: 77, sampledAt: 1234 });
  assert.deepEqual(calls, [
    { command: "ioreg", args: ["-r", "-d", "2", "-w", "0", "-c", "IOGPU"] },
    { command: "ioreg", args: ["-r", "-d", "2", "-w", "0", "-c", "IOAccelerator"] },
    { command: "ioreg", args: ["-r", "-c", "AppleSmartBattery", "-w", "0"] },
  ]);
  assert.equal(volumePath, "/");
}

{
  const metrics = await readExtendedSystemMetrics({
    platform: "darwin",
    run: async (_, args) => args.at(-1) === "IOGPU"
      ? ""
      : '"Device Utilization % at cur p-state" = 68, "Device Unit 0 Utilization %" = 68, "Device Utilization %" = 201',
    statfs: async () => ({ blocks: 100, bfree: 23 }),
    readDirectory: async () => [],
    readFile: async () => "",
    now: () => 1234,
  });
  assert.deepEqual(metrics, { gpuPercent: 68, diskUsedPercent: 77, sampledAt: 1234 });
}

{
  const metrics = await readExtendedSystemMetrics({
    platform: "linux",
    run: async () => { throw new Error("nvidia-smi is unavailable"); },
    statfs: async () => ({ blocks: 200, bfree: 50 }),
    readDirectory: async () => ["card0", "card1", "renderD128"],
    readFile: async (path) => {
      if (path === "/sys/class/drm/card0/device/gpu_busy_percent") return "37\n";
      if (path === "/sys/class/drm/card1/device/gpu_busy_percent") return "63\n";
      throw new Error(`Unexpected path: ${path}`);
    },
    now: () => 1234,
  });
  assert.deepEqual(metrics, { gpuPercent: 50, diskUsedPercent: 75, sampledAt: 1234 });
}

{
  let volumePath = "";
  const metrics = await readExtendedSystemMetrics({
    platform: "win32",
    run: async (command, args) => {
      if (command === "nvidia-smi") {
        assert.deepEqual(args, ["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"]);
        return "61\n";
      }
      assert.equal(command, "powershell.exe");
      return "{}";
    },
    statfs: async (path) => {
      volumePath = path;
      return { blocks: 100, bfree: 40 };
    },
    readDirectory: async () => [],
    readFile: async () => "",
    now: () => 1234,
  });
  assert.deepEqual(metrics, { gpuPercent: 61, diskUsedPercent: 60, sampledAt: 1234 });
  assert.equal(volumePath, `${process.env.SystemDrive || "C:"}\\`);
}

{
  assert.deepEqual(await readNetworkCountersForPlatform("darwin", {
    run: async (command, args) => {
      assert.equal(command, "netstat");
      assert.deepEqual(args, ["-ib"]);
      return "Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\nen0 1500 <Link#4> aa 1 0 100 1 0 200 0";
    },
  }), { receivedBytes: 100, sentBytes: 200 });
  assert.deepEqual(await readNetworkCountersForPlatform("win32", {
    run: async (command, args) => {
      assert.equal(command, "powershell.exe");
      assert.equal(args[0], "-NoProfile");
      return '{"ReceivedBytes":100,"SentBytes":200}';
    },
  }), { receivedBytes: 100, sentBytes: 200 });
}

{
  const metrics = await readExtendedSystemMetrics({
    platform: "darwin",
    run: async (_command, args) => args.includes("AppleSmartBattery")
      ? '"CurrentCapacity" = 84, "MaxCapacity" = 100, "IsCharging" = No'
      : "",
    statfs: async () => { throw new Error("disk unavailable"); },
    readNetworkRate: async () => ({ downloadBytesPerSecond: 12_345, uploadBytesPerSecond: 678 }),
    now: () => 5678,
  });
  assert.deepEqual(metrics, {
    battery: { percent: 84, charging: false },
    network: { downloadBytesPerSecond: 12_345, uploadBytesPerSecond: 678 },
    sampledAt: 5678,
  });
}

function deferred<T>() {
  let resolveValue!: (value: T) => void;
  let rejectValue!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
}

async function settlePromises() {
  await Promise.resolve();
  await Promise.resolve();
}

{
  let now = 0;
  let calls = 0;
  const first = deferred<ExtendedSystemMetrics>();
  const cache = createStaleWhileRevalidateCache(
    () => {
      calls += 1;
      return first.promise;
    },
    { ttlMs: 5, now: () => now },
  );

  assert.deepEqual(cache(), {});
  assert.equal(calls, 1);
  first.resolve({ diskUsedPercent: 51 });
  await first.promise;
  await settlePromises();
}

{
  let now = 0;
  let calls = 0;
  const refresh = deferred<ExtendedSystemMetrics>();
  const cache = createStaleWhileRevalidateCache(
    () => {
      calls += 1;
      return calls === 1 ? Promise.resolve({ diskUsedPercent: 51 }) : refresh.promise;
    },
    { ttlMs: 5, now: () => now },
  );

  assert.deepEqual(cache(), {});
  await settlePromises();
  now = 6;
  assert.deepEqual(cache(), { diskUsedPercent: 51, extendedMetricsFresh: false });
  assert.equal(calls, 2);
  refresh.resolve({ diskUsedPercent: 52 });
  await refresh.promise;
  await settlePromises();
}

{
  let now = 0;
  let calls = 0;
  const refresh = deferred<ExtendedSystemMetrics>();
  const cache = createStaleWhileRevalidateCache(
    () => {
      calls += 1;
      return calls === 1 ? Promise.resolve({ gpuPercent: 42, sampledAt: 10 }) : refresh.promise;
    },
    { ttlMs: 5, now: () => now },
  );

  cache();
  await settlePromises();
  assert.deepEqual(cache(), { gpuPercent: 42, sampledAt: 10, extendedMetricsFresh: true }, "cache hits keep the original sample identity");
  now = 6;
  assert.deepEqual(cache(), { gpuPercent: 42, sampledAt: 10, extendedMetricsFresh: false }, "stale cache reads keep the original identity while marked stale");
  refresh.resolve({ gpuPercent: 43, sampledAt: 20 });
  await refresh.promise;
  await settlePromises();
  assert.deepEqual(cache(), { gpuPercent: 43, sampledAt: 20, extendedMetricsFresh: true }, "a completed refresh gets a new sample identity");
}

{
  let now = 0;
  let calls = 0;
  const refresh = deferred<ExtendedSystemMetrics>();
  const cache = createStaleWhileRevalidateCache(
    () => {
      calls += 1;
      return calls === 1 ? Promise.resolve({ diskUsedPercent: 51 }) : refresh.promise;
    },
    { ttlMs: 5, now: () => now },
  );

  cache();
  await settlePromises();
  now = 6;
  cache();
  refresh.resolve({ diskUsedPercent: 49 });
  await refresh.promise;
  await settlePromises();
  assert.deepEqual(cache(), { diskUsedPercent: 49, extendedMetricsFresh: true });
}

{
  let now = 0;
  let calls = 0;
  const failedRefresh = deferred<ExtendedSystemMetrics>();
  const cache = createStaleWhileRevalidateCache(
    () => {
      calls += 1;
      return calls === 1 ? Promise.resolve({ diskUsedPercent: 51 }) : failedRefresh.promise;
    },
    { ttlMs: 5, now: () => now },
  );

  cache();
  await settlePromises();
  now = 6;
  assert.deepEqual(cache(), { diskUsedPercent: 51, extendedMetricsFresh: false });
  failedRefresh.reject(new Error("probe failed"));
  await failedRefresh.promise.catch(() => undefined);
  await settlePromises();
  assert.deepEqual(cache(), { diskUsedPercent: 51, extendedMetricsFresh: false });
}

{
  let now = 0;
  const cache = createStaleWhileRevalidateCache(
    () => Promise.resolve({ diskUsedPercent: 51 }),
    { ttlMs: 5, now: () => now },
  );

  cache();
  await settlePromises();
  assert.deepEqual(cache(), { diskUsedPercent: 51, extendedMetricsFresh: true });
  assert.equal(cache().gpuPercent, undefined);
  now = 6;
  assert.deepEqual(cache(), { diskUsedPercent: 51, extendedMetricsFresh: false });
}

console.log("system metrics: all checks passed.");
