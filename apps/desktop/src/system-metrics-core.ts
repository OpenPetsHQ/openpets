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

export type NetworkInterfaceCounters = {
  /** Stable platform-provided identity, not an array position or aggregate total. */
  id: string;
  receivedBytes: number;
  sentBytes: number;
};
export type NetworkCounters = { interfaces: NetworkInterfaceCounters[] };
export type NetworkThroughput = { downloadBytesPerSecond: number; uploadBytesPerSecond: number };

function clampPercent(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseIoregPercent(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0 || value > 100) return undefined;
  return Math.round(value);
}

export function averagePercentFromText(text: string): number | undefined {
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

export function parseCounter(value: unknown): number | undefined {
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
  const addressIndex = headers.indexOf("address");
  const receivedIndex = headers.indexOf("ibytes");
  const sentIndex = headers.indexOf("obytes");
  if ([nameIndex, networkIndex, addressIndex, receivedIndex, sentIndex].some((index) => index < 0)) return undefined;

  const interfaces = new Map<string, NetworkInterfaceCounters>();
  for (const line of lines.slice(headerIndex + 1)) {
    const fields = line.split(/\s+/);
    const name = fields[nameIndex];
    const network = fields[networkIndex];
    if (!name || name.toLowerCase() === "lo0" || !network?.toLowerCase().startsWith("<link#")) continue;
    const received = parseCounter(fields[receivedIndex]);
    const sent = parseCounter(fields[sentIndex]);
    if (received === undefined || sent === undefined) continue;
    const address = fields[addressIndex]?.trim().toLowerCase();
    const id = address && address !== "-" ? `mac:${address.replaceAll("-", ":")}` : `name:${name.toLowerCase()}`;
    if (interfaces.has(id)) continue;
    interfaces.set(id, { id, receivedBytes: received, sentBytes: sent });
  }
  return { interfaces: [...interfaces.values()] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizedIdentityPart(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim().toLowerCase();
  return normalized && normalized !== "-" ? normalized : undefined;
}

function windowsNetworkInterfaceId(value: Record<string, unknown>): string | undefined {
  const guid = normalizedIdentityPart(value.InterfaceGuid ?? value.interfaceGuid ?? value.InterfaceGUID);
  if (guid) return `guid:${guid}`;

  const mac = normalizedIdentityPart(value.MacAddress ?? value.macAddress);
  if (mac) return `mac:${mac.replaceAll("-", ":")}`;

  const index = parseCounter(value.ifIndex ?? value.IfIndex ?? value.InterfaceIndex ?? value.interfaceIndex);
  if (index !== undefined) return `index:${index}`;

  const name = normalizedIdentityPart(value.Name ?? value.name);
  return name ? `name:${name}` : undefined;
}

/** Parse the JSON emitted by the Windows Get-NetAdapterStatistics command. */
export function networkCountersFromWindowsJson(text: string): NetworkCounters | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return undefined; }
  const parsedArray = Array.isArray(parsed);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const interfaces = new Map<string, NetworkInterfaceCounters>();
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const id = windowsNetworkInterfaceId(entry);
    const received = parseCounter(entry.ReceivedBytes ?? entry.receivedBytes);
    const sent = parseCounter(entry.SentBytes ?? entry.sentBytes);
    if (!id || received === undefined || sent === undefined || interfaces.has(id)) continue;
    interfaces.set(id, { id, receivedBytes: received, sentBytes: sent });
  }
  return interfaces.size > 0 || (parsedArray && entries.length === 0) ? { interfaces: [...interfaces.values()] } : undefined;
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

export function createNetworkRateSampler(
  read: () => Promise<NetworkCounters | undefined>,
  options: { now?: () => number; maxGapMs?: number } = {},
): () => Promise<NetworkThroughput | undefined> {
  const clock = options.now ?? Date.now;
  const maxGapMs = options.maxGapMs ?? 5 * 60_000;
  let previous: { interfaces: Map<string, NetworkInterfaceCounters>; sampledAt: number } | undefined;
  return async () => {
    const counters = await read();
    const sampledAt = clock();
    if (!counters) {
      previous = undefined;
      return undefined;
    }
    const current = new Map<string, NetworkInterfaceCounters>();
    for (const entry of counters.interfaces) {
      if (!entry.id || current.has(entry.id)) continue;
      current.set(entry.id, entry);
    }
    const prior = previous;
    previous = { interfaces: current, sampledAt };
    if (!prior) return undefined;
    const elapsedMs = sampledAt - prior.sampledAt;
    if (elapsedMs <= 0 || elapsedMs > maxGapMs) return undefined;

    let receivedBytes = 0;
    let sentBytes = 0;
    let validInterfaces = 0;
    for (const [id, currentInterface] of current) {
      const previousInterface = prior.interfaces.get(id);
      if (!previousInterface) continue;
      if (currentInterface.receivedBytes < previousInterface.receivedBytes || currentInterface.sentBytes < previousInterface.sentBytes) continue;
      receivedBytes += currentInterface.receivedBytes - previousInterface.receivedBytes;
      sentBytes += currentInterface.sentBytes - previousInterface.sentBytes;
      validInterfaces += 1;
    }
    if (validInterfaces === 0) return undefined;
    const seconds = elapsedMs / 1_000;
    return {
      downloadBytesPerSecond: Math.max(0, Math.round((receivedBytes / seconds) * 100) / 100),
      uploadBytesPerSecond: Math.max(0, Math.round((sentBytes / seconds) * 100) / 100),
    };
  };
}

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
