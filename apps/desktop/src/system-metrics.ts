import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";

import {
  averagePercentFromText,
  batteryMetricsFromIoreg,
  batteryMetricsFromWindowsJson,
  diskUsedPercentFromStatFs,
  gpuPercentFromIoreg,
  networkCountersFromNetstat,
  networkCountersFromWindowsJson,
  parseCounter,
  type ExtendedSystemMetrics,
  type NetworkCounters,
  type NetworkInterfaceCounters,
  type NetworkThroughput,
} from "./system-metrics-core.js";

const execFileAsync = promisify(execFile);
const commandTimeoutMs = 2_500;

type CommandRunner = (command: string, args: string[], timeoutMs?: number) => Promise<string>;
type StatFsReader = (path: string) => Promise<{ blocks: number | bigint; bfree: number | bigint }>;
type TextFileReader = (path: string) => Promise<string>;
type DirectoryReader = (path: string) => Promise<string[]>;

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
      return receivedBytes === undefined || sentBytes === undefined
        ? undefined
        : { id: `name:${name.toLowerCase()}`, receivedBytes, sentBytes };
    } catch {
      return undefined;
    }
  }));
  const available = samples.filter((sample): sample is NetworkInterfaceCounters => sample !== undefined);
  if (interfaces.length === 0) return { interfaces: [] };
  if (available.length === 0) return undefined;
  return { interfaces: available };
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
    const command = [
      "$adapters = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up';",
      "$adapters | ForEach-Object {",
      "$adapter = $_;",
      "$stats = Get-NetAdapterStatistics -Name $adapter.Name -ErrorAction SilentlyContinue;",
      "if ($stats) { [pscustomobject]@{ Name = $adapter.Name; InterfaceGuid = $adapter.InterfaceGuid; MacAddress = $adapter.MacAddress; ifIndex = $adapter.ifIndex; ReceivedBytes = $stats.ReceivedBytes; SentBytes = $stats.SentBytes } }",
      "} | ConvertTo-Json -Compress",
    ].join(" ");
    return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]).then(networkCountersFromWindowsJson).catch(() => undefined);
  }
  if (platform === "linux") return linuxNetworkCounters(readFile, readDirectory);
  return undefined;
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
