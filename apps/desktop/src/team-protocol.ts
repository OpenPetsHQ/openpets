export const teamsProtocolScheme = "openpets";
export const teamsEnrollHost = "teams";
export const teamsEnrollPath = "/enroll";

const intentPattern = /^[A-Za-z0-9_-]{1,128}$/;

export type TeamEnrollmentLink = {
  readonly intentId: string;
};

/** Decode only the URL shape emitted by the Teams dashboard. */
export function parseTeamEnrollmentLink(value: unknown): TeamEnrollmentLink | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== `${teamsProtocolScheme}:`
    || url.hostname !== teamsEnrollHost
    || url.pathname !== teamsEnrollPath
    || url.hash
    || url.username
    || url.password
    || url.port
  ) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "intent") return null;
  const intentId = url.searchParams.get("intent");
  return intentId && intentPattern.test(intentId) ? { intentId } : null;
}

export function findTeamEnrollmentLink(argv: readonly unknown[]): TeamEnrollmentLink | null {
  for (const value of argv) {
    const parsed = parseTeamEnrollmentLink(value);
    if (parsed) return parsed;
  }
  return null;
}

export type TeamPackItem = {
  readonly id: string;
  readonly type: "pet" | "plugin";
  readonly name: string;
  readonly versionId: string;
  readonly version: string;
  readonly sha256: string;
  readonly size: number;
  readonly itemId: string;
  readonly releaseId: string;
  readonly policy?: "required" | "optional";
  readonly config?: Record<string, unknown>;
};

export type TeamPack = {
  readonly version: 1;
  readonly revision: number;
  readonly digest?: string | null;
  readonly items: readonly TeamPackItem[];
};

const idPattern = /^[A-Za-z0-9_-]{1,160}$/;
const itemIdPattern = /^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$/;
const shaPattern = /^[a-f0-9]{64}$/;
const semverPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function validateTeamPack(value: unknown): TeamPack {
  if (
    !isRecord(value)
    || value.version !== 1
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 0
    || (value.revision as number) > Number.MAX_SAFE_INTEGER
    || !Array.isArray(value.items)
    || value.items.length > 256
  ) throw new Error("Team Pack is invalid.");
  if (
    Object.keys(value).some(
      (key) => !["version", "revision", "digest", "items"].includes(key),
    )
  ) throw new Error("Team Pack contains unsupported fields.");
  const revision = value.revision as number;
  const seen = new Set<string>();
  const items = value.items.map((raw) => {
    if (
      isRecord(raw)
      && Object.keys(raw).some(
        (key) => ![
          "id",
          "type",
          "name",
          "versionId",
          "version",
          "sha256",
          "size",
          "itemId",
          "releaseId",
          "policy",
          "config",
        ].includes(key),
      )
    ) throw new Error("Team Pack item contains unsupported fields.");
    if (
      !isRecord(raw)
      || (raw.type !== "pet" && raw.type !== "plugin")
      || typeof raw.id !== "string"
      || !itemIdPattern.test(raw.id)
      || (raw.type === "pet" && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(raw.id))
      || raw.id !== raw.itemId
      || typeof raw.itemId !== "string"
      || typeof raw.name !== "string"
      || raw.name.length === 0
      || raw.name.length > 200
      || typeof raw.versionId !== "string"
      || !idPattern.test(raw.versionId)
      || typeof raw.releaseId !== "string"
      || !idPattern.test(raw.releaseId)
      || typeof raw.version !== "string"
      || !semverPattern.test(raw.version)
      || typeof raw.sha256 !== "string"
      || !shaPattern.test(raw.sha256)
      || !Number.isSafeInteger(raw.size)
      || (raw.size as number) < 1
      || (raw.size as number) > 50 * 1024 * 1024
    ) throw new Error("Team Pack item is invalid.");
    const size = raw.size as number;
    const key = `${raw.type}:${raw.id}`;
    if (seen.has(key)) throw new Error("Team Pack contains duplicate items.");
    seen.add(key);
    if (
      raw.type === "plugin"
      && raw.policy !== "required"
      && raw.policy !== "optional"
    ) throw new Error("Team plugin policy is invalid.");
    if (
      raw.type === "pet"
      && (raw.policy !== undefined || raw.config !== undefined)
    ) throw new Error("Team pet item contains plugin fields.");
    if (
      raw.config !== undefined
      && (
        !isJsonObject(raw.config)
        || JSON.stringify(raw.config).length > 128 * 1024
        || !boundedJson(raw.config, 0)
      )
    ) throw new Error("Team plugin configuration is invalid.");
    return {
      id: raw.id,
      type: raw.type,
      name: raw.name,
      versionId: raw.versionId,
      version: raw.version,
      sha256: raw.sha256,
      size,
      itemId: raw.itemId,
      releaseId: raw.releaseId,
      ...(raw.policy ? { policy: raw.policy } : {}),
      ...(raw.config ? { config: cloneJson(raw.config) } : {}),
    } as TeamPackItem;
  });
  if (
    value.digest !== undefined
    && value.digest !== null
    && (typeof value.digest !== "string" || !shaPattern.test(value.digest))
  ) throw new Error("Team Pack digest is invalid.");
  return {
    version: 1,
    revision,
    digest: typeof value.digest === "string"
      ? value.digest
      : value.digest === null
        ? null
        : undefined,
    items,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  try {
    JSON.stringify(value);
    return isRecord(value);
  } catch {
    return false;
  }
}

function cloneJson(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}

function boundedJson(value: unknown, depth: number): boolean {
  if (depth > 8) return false;
  if (Array.isArray(value)) {
    return value.length <= 128
      && value.every((item) => boundedJson(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.keys(value).length <= 128
      && Object.entries(value).every(
        ([key, item]) => key.length <= 128 && boundedJson(item, depth + 1),
      );
  }
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}
