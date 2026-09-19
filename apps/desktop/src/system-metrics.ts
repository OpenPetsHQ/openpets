import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const commandTimeoutMs = 2_500;

export type ExtendedSystemMetrics = {
  /** Aggregate GPU utilisation when the platform exposes it. */
  gpuPercent?: number;
  /** Used capacity of the system volume, not a per-app or per-file measurement. */
  diskUsedPercent?: number;
  /** Battery state when the host exposes a physical battery. */
  battery?: { percent: number; charging: boolean };
  /** Aggregate network throughput from the previous valid counter sample. */
  network?: { downloadBytesPerSecond: number; uploadBytesPerSecond: number };
  /** Monotonic identity for the successful extended-metrics collection. */
  sampledAt?: number;
  /** False means the values are only the expired cache while a refresh is pending. */
  extendedMetricsFresh?: boolean;
};

export type NetworkCounters = { receivedBytes: number; sentBytes: number };
export type NetworkThroughput = { downloadBytesPerSecond: number; uploadBytesPerSecond: number };

export function createStaleWhileRevalidateCache(
  read: () => Promise<ExtendedSystemMetrics>,
  options: { ttlMs: number; now?: () => number },
): () => ExtendedSystemMetrics {
  const clock = options.now ?? Date.now;
  let cached: { expiresAt: number; value: ExtendedSystemMetrics } | undefined;
  let inFlight: Promise<void> | undefined;

  return () => {
    if (cached && cached.expiresAt > clock()) return { ...cached.value, extendedMetricsFresh: true };
    if (!inFlight) {
      inFlight = read()
        .then((value) => {
          cached = { value, expiresAt: clock() + options.ttlMs };
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = undefined;
        });
    }
    if (!cached) return {};
    return { ...cached.value, extendedMetricsFresh: cached.expiresAt > clock() };
  };
}

type CommandRunner = (command: string, args: string[], timeoutMs?: number) => Promise<string>;
type StatFsReader = (path: string) => Promise<{ blocks: number | bigint; bfree: number | bigint }>;
type TextFileReader = (path: string) => Promise<string>;
type DirectoryReader = (path: string) => Promise<string[]>;

function clampPercent(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseIoregPercent(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0 || value > 100) return undefined;
  return Math.round(value);
}

function averagePercentFromText(text: string): number | undefined {
  const values = text.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) ?? [];
  if (values.length === 0) return undefined;
  return clampPercent(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function gpuPercentFromIoreg(text: string): number | undefined {
  // Apple silicon commonly reports per-engine values as `Device Unit N
  // Utilization %`; older builds may expose an aggregate `Device Utilization
  // %` or `Renderer Utilization %`. Ignore the p-state field, which is a
  // frequency-related value rather than a utilisation measurement.
  const values = [...text.matchAll(/"(?:Device(?: Unit \d+)?|Renderer) Utilization %"\s*=\s*(\d+(?:\.\d+)?)/g)]
    .map((match) => parseIoregPercent(Number(match[1])))
    .filter((value): value is number => value !== undefined);
  return values.length > 0 ? clampPercent(values.reduce((sum, value) => sum + value, 0) / values.length) : undefined;
}

export function diskUsedPercentFromStatFs(stat: { blocks: number | bigint; bfree: number | bigint }): number | undefined {
  const blocks = Number(stat.blocks);
  const free = Number(stat.bfree);
  if (!Number.isFinite(blocks) || !Number.isFinite(free) || blocks <= 0) return undefined;
  return clampPercent(((blocks - free) / blocks) * 100);
}

async function defaultRun(command: string, args: string[], timeoutMs = commandTimeoutMs): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 });
  return String(stdout ?? "");
}

async function linuxGpuPercent(readFile: TextFileReader, readDirectory: DirectoryReader): Promise<number | undefined> {
  try {
    const percents = await Promise.all(
      (await readDirectory("/sys/class/drm"))
        .filter((entry) => /^card\d+$/.test(entry))
        .map((entry) => readFile(`/sys/class/drm/${entry}/device/gpu_busy_percent`).then(averagePercentFromText).catch(() => undefined)),
    );
    const available = percents.filter((percent): percent is number => percent !== undefined);
    return available.length > 0 ? Math.round(available.reduce((sum, percent) => sum + percent, 0) / available.length) : undefined;
  } catch {
    return undefined;
  }
}

async function gpuPercentForPlatform(
  platform: NodeJS.Platform,
  run: CommandRunner,
  readFile: TextFileReader,
  readDirectory: DirectoryReader,
): Promise<number | undefined> {
  if (platform === "darwin") {
    const [ioGpu, ioAccelerator] = await Promise.all([
      run("ioreg", ["-r", "-d", "2", "-w", "0", "-c", "IOGPU"]).then(gpuPercentFromIoreg).catch(() => undefined),
      run("ioreg", ["-r", "-d", "2", "-w", "0", "-c", "IOAccelerator"]).then(gpuPercentFromIoreg).catch(() => undefined),
    ]);
    return ioGpu ?? ioAccelerator;
  }

  const nvidia = run("nvidia-smi", ["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"])
    .then(averagePercentFromText)
    .catch(() => undefined);

  if (platform === "win32") {
    const command = [
      "$c = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue;",
      "if (-not $c) { exit 0 };",
      "$samples = $c.CounterSamples | Where-Object { $_.InstanceName -match 'engtype_3D' };",
      "if (-not $samples) { $samples = $c.CounterSamples };",
      "($samples | Measure-Object -Property CookedValue -Average).Average",
    ].join(" ");
    const windows = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command])
      .then(averagePercentFromText)
      .catch(() => undefined);
    const [nvidiaPercent, windowsPercent] = await Promise.all([nvidia, windows]);
    return nvidiaPercent ?? windowsPercent;
  }

  if (platform !== "linux") return undefined;
  const [nvidiaPercent, linuxPercent] = await Promise.all([nvidia, linuxGpuPercent(readFile, readDirectory)]);
  return nvidiaPercent ?? linuxPercent;
}

function parseCounter(value: unknown): number | undefined {
  if (value == null || (typeof value === "string" && value.trim() === "")) return undefined;
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replaceAll(",", ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Parse `netstat -ib`, counting each interface's link row once. */
export function networkCountersFromNetstat(text: string): NetworkCounters | undefined {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => /^Name\s+/i.test(line));
  if (headerIndex < 0) return undefined;
  const headers = lines[headerIndex].split(/\s+/).map((value) => value.toLowerCase());
  const nameIndex = headers.indexOf("name");
  const networkIndex = headers.indexOf("network");
  const receivedIndex = headers.indexOf("ibytes");
  const sentIndex = headers.indexOf("obytes");
  if ([nameIndex, networkIndex, receivedIndex, sentIndex].some((index) => index < 0)) return undefined;

  const seen = new Set<string>();
  let receivedBytes = 0;
  let sentBytes = 0;
  for (const line of lines.slice(headerIndex + 1)) {
    const fields = line.split(/\s+/);
    const name = fields[nameIndex];
    const network = fields[networkIndex];
    if (!name || name === "lo0" || seen.has(name) || !network?.toLowerCase().startsWith("<link#")) continue;
    const received = parseCounter(fields[receivedIndex]);
    const sent = parseCounter(fields[sentIndex]);
    if (received === undefined || sent === undefined) continue;
    seen.add(name);
    receivedBytes += received;
    sentBytes += sent;
  }
  return seen.size > 0 ? { receivedBytes, sentBytes } : undefined;
}

/** Parse the JSON emitted by the Windows Get-NetAdapterStatistics command. */
export function networkCountersFromWindowsJson(text: string): NetworkCounters | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return undefined; }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  let receivedBytes = 0;
  let sentBytes = 0;
  let count = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    const received = parseCounter(value.ReceivedBytes ?? value.receivedBytes);
    const sent = parseCounter(value.SentBytes ?? value.sentBytes);
    if (received === undefined || sent === undefined) continue;
    receivedBytes += received;
    sentBytes += sent;
    count += 1;
  }
  return count > 0 ? { receivedBytes, sentBytes } : undefined;
}

async function linuxNetworkCounters(readFile: TextFileReader, readDirectory: DirectoryReader): Promise<NetworkCounters | undefined> {
  let entries: string[];
  try { entries = await readDirectory("/sys/class/net"); } catch { return undefined; }
  const interfaces = entries.filter((entry) => entry !== "lo");
  const samples = await Promise.all(interfaces.map(async (name) => {
    try {
      const [received, sent] = await Promise.all([
        readFile(`/sys/class/net/${name}/statistics/rx_bytes`),
        readFile(`/sys/class/net/${name}/statistics/tx_bytes`),
      ]);
      const receivedBytes = parseCounter(received.trim());
      const sentBytes = parseCounter(sent.trim());
      return receivedBytes === undefined || sentBytes === undefined ? undefined : { receivedBytes, sentBytes };
    } catch {
      return undefined;
    }
  }));
  const available = samples.filter((sample): sample is NetworkCounters => sample !== undefined);
  if (available.length === 0) return undefined;
  return available.reduce((total, sample) => ({
    receivedBytes: total.receivedBytes + sample.receivedBytes,
    sentBytes: total.sentBytes + sample.sentBytes,
  }), { receivedBytes: 0, sentBytes: 0 });
}

export async function readNetworkCountersForPlatform(
  platform: NodeJS.Platform,
  options: { run?: CommandRunner; readFile?: TextFileReader; readDirectory?: DirectoryReader } = {},
): Promise<NetworkCounters | undefined> {
  const run = options.run ?? defaultRun;
  const readFile = options.readFile ?? ((path) => fs.readFile(path, "utf8"));
  const readDirectory = options.readDirectory ?? ((path) => fs.readdir(path));
  if (platform === "darwin") {
    return run("netstat", ["-ib"]).then(networkCountersFromNetstat).catch(() => undefined);
  }
  if (platform === "win32") {
    const command = "Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | Get-NetAdapterStatistics -ErrorAction SilentlyContinue | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress";
    return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]).then(networkCountersFromWindowsJson).catch(() => undefined);
  }
  if (platform === "linux") return linuxNetworkCounters(readFile, readDirectory);
  return undefined;
}

export function batteryMetricsFromIoreg(text: string): { percent: number; charging: boolean } | undefined {
  const current = Number(text.match(/"CurrentCapacity"\s*=\s*(\d+)/)?.[1]);
  const maximum = Number(text.match(/"MaxCapacity"\s*=\s*(\d+)/)?.[1]);
  const chargingText = text.match(/"IsCharging"\s*=\s*(Yes|No)/i)?.[1];
  if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0 || !chargingText) return undefined;
  const percent = clampPercent((current / maximum) * 100);
  return percent === undefined ? undefined : { percent, charging: chargingText.toLowerCase() === "yes" };
}

export function batteryMetricsFromWindowsJson(text: string): { percent: number; charging: boolean } | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return undefined; }
  const value = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const percent = clampPercent(Number(record.EstimatedChargeRemaining ?? record.estimatedChargeRemaining));
  const status = Number(record.BatteryStatus ?? record.batteryStatus);
  if (percent === undefined || !Number.isFinite(status)) return undefined;
  return { percent, charging: [6, 7, 8, 9].includes(status) };
}

export async function readBatteryForPlatform(platform: NodeJS.Platform, run: CommandRunner = defaultRun): Promise<{ percent: number; charging: boolean } | undefined> {
  if (platform === "darwin") {
    return run("ioreg", ["-r", "-c", "AppleSmartBattery", "-w", "0"]).then(batteryMetricsFromIoreg).catch(() => undefined);
  }
  if (platform === "win32") {
    const command = "Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress";
    return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]).then(batteryMetricsFromWindowsJson).catch(() => undefined);
  }
  return undefined;
}

export function createNetworkRateSampler(
  read: () => Promise<NetworkCounters | undefined>,
  options: { now?: () => number; maxGapMs?: number } = {},
): () => Promise<NetworkThroughput | undefined> {
  const clock = options.now ?? Date.now;
  const maxGapMs = options.maxGapMs ?? 5 * 60_000;
  let previous: { counters: NetworkCounters; sampledAt: number } | undefined;
  return async () => {
    const counters = await read();
    const sampledAt = clock();
    if (!counters) {
      previous = undefined;
      return undefined;
    }
    const prior = previous;
    previous = { counters, sampledAt };
    if (!prior) return undefined;
    const elapsedMs = sampledAt - prior.sampledAt;
    if (elapsedMs <= 0 || elapsedMs > maxGapMs || counters.receivedBytes < prior.counters.receivedBytes || counters.sentBytes < prior.counters.sentBytes) return undefined;
    const seconds = elapsedMs / 1_000;
    return {
      downloadBytesPerSecond: Math.max(0, Math.round(((counters.receivedBytes - prior.counters.receivedBytes) / seconds) * 100) / 100),
      uploadBytesPerSecond: Math.max(0, Math.round(((counters.sentBytes - prior.counters.sentBytes) / seconds) * 100) / 100),
    };
  };
}

export async function readExtendedSystemMetrics(
  options: {
    platform?: NodeJS.Platform;
    run?: CommandRunner;
    statfs?: StatFsReader;
    readFile?: TextFileReader;
    readDirectory?: DirectoryReader;
    readNetworkRate?: () => Promise<NetworkThroughput | undefined>;
    now?: () => number;
  } = {},
): Promise<ExtendedSystemMetrics> {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? defaultRun;
  const statfs = options.statfs ?? ((path) => fs.statfs(path));
  const readFile = options.readFile ?? ((path) => fs.readFile(path, "utf8"));
  const readDirectory = options.readDirectory ?? ((path) => fs.readdir(path));
  const volumePath = platform === "win32" ? `${process.env.SystemDrive || "C:"}\\` : "/";

  const [gpu, disk, battery, network] = await Promise.all([
    gpuPercentForPlatform(platform, run, readFile, readDirectory),
    statfs(volumePath).then(diskUsedPercentFromStatFs).catch(() => undefined),
    readBatteryForPlatform(platform, run),
    options.readNetworkRate?.() ?? Promise.resolve(undefined),
  ]);

  const metrics: ExtendedSystemMetrics = {
    ...(gpu === undefined ? {} : { gpuPercent: gpu }),
    ...(disk === undefined ? {} : { diskUsedPercent: disk }),
    ...(battery === undefined ? {} : { battery }),
    ...(network === undefined ? {} : { network }),
  };
  return Object.keys(metrics).length === 0 ? metrics : { ...metrics, sampledAt: (options.now ?? Date.now)() };
}
