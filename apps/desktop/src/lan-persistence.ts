import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { normalizeLanHost, type LanState } from "./lan-contract.js";

const persistedLanStateVersion = 1;

export type PersistedLanState = {
  readonly version: 1;
  readonly currentHost: string | null;
  readonly updatedAt: number;
};

export function getPersistedLanStatePath(userDataPath: string): string {
  return join(userDataPath, "lan-state.json");
}

export function readPersistedLanState(userDataPath: string): PersistedLanState | null {
  const path = getPersistedLanStatePath(userDataPath);
  if (!existsSync(path)) return null;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const currentHost = normalizeLanHost(parsed.currentHost);
    const updatedAt = Number(parsed.updatedAt);
    return {
      version: persistedLanStateVersion,
      currentHost,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function writePersistedLanState(userDataPath: string, state: LanState): void {
  const path = getPersistedLanStatePath(userDataPath);
  mkdirSync(dirname(path), { recursive: true });
  const payload: PersistedLanState = {
    version: persistedLanStateVersion,
    currentHost: state.currentHost,
    updatedAt: state.updatedAt,
  };
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}
