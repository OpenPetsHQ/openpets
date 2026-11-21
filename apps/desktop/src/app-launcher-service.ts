import { randomUUID } from "node:crypto";

import type { AppLauncherSnapshotEntry } from "./app-launcher-types.js";

export const maxAppLaunchers = 20;
const maxAppLauncherNameLength = 80;
const appLauncherIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const appLauncherTargetRevisionBrand: unique symbol = Symbol("AppLauncherTargetRevision");

export type AppLauncherTargetRevision = { readonly [appLauncherTargetRevisionBrand]: true };

export interface AppLauncherMenuEntry {
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
  readonly targetRevision: AppLauncherTargetRevision;
}

export interface AppLauncherStoredEntry {
  readonly id: string;
  readonly name: string;
  readonly targetPath: string;
}

export interface AppLauncherStorage {
  load(): Promise<unknown>;
  save(entries: readonly AppLauncherStoredEntry[]): Promise<void>;
}

export interface AppLauncherServiceOptions {
  readonly storage: AppLauncherStorage;
  readonly isTargetAvailable: (targetPath: string) => boolean | Promise<boolean>;
  readonly getIconDataUrl: (targetPath: string) => string | undefined | Promise<string | undefined>;
  readonly launchTarget: (targetPath: string) => Promise<void>;
  readonly createId?: () => string;
}

export interface AppLauncherService {
  list(): Promise<readonly AppLauncherSnapshotEntry[]>;
  listForMenu(): Promise<readonly AppLauncherMenuEntry[]>;
  add(name: unknown, targetPath: unknown): Promise<readonly AppLauncherSnapshotEntry[]>;
  rename(id: unknown, name: unknown): Promise<readonly AppLauncherSnapshotEntry[]>;
  replaceTarget(id: unknown, targetPath: unknown): Promise<readonly AppLauncherSnapshotEntry[]>;
  move(id: unknown, direction: unknown): Promise<readonly AppLauncherSnapshotEntry[]>;
  remove(id: unknown): Promise<readonly AppLauncherSnapshotEntry[]>;
  launch(id: unknown, expectedTargetRevision?: AppLauncherTargetRevision): Promise<void>;
}

export function normalizeAppLauncherName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Enter a display name between 1 and 80 characters.");
  }

  const name = value.trim();
  if (!name || name.length > maxAppLauncherNameLength || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("Enter a display name between 1 and 80 characters.");
  }

  return name;
}

export function createAppLauncherService(options: AppLauncherServiceOptions): AppLauncherService {
  let loaded = false;
  let entries: AppLauncherStoredEntry[] = [];
  const targetRevisions = new Map<string, AppLauncherTargetRevision>();
  let operationTail: Promise<void> = Promise.resolve();

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;

    let stored: unknown;
    try {
      stored = await options.storage.load();
    } catch {
      throw new Error("Application launcher settings could not be loaded.");
    }

    entries = normalizeStoredEntries(stored);
    targetRevisions.clear();
    for (const entry of entries) targetRevisions.set(entry.id, createTargetRevision());
    loaded = true;
  }

  async function snapshot(source: readonly AppLauncherStoredEntry[]): Promise<readonly AppLauncherSnapshotEntry[]> {
    return Promise.all(source.map(async (entry) => {
      let available = false;
      if (await isAvailable(entry.targetPath)) available = true;

      let iconDataUrl: string | undefined;
      if (available) {
        try {
          const candidate = await options.getIconDataUrl(entry.targetPath);
          if (isSafeIconDataUrl(candidate)) iconDataUrl = candidate;
        } catch {
          // Icons are optional and must not make the launcher unavailable.
        }
      }

      return {
        id: entry.id,
        name: entry.name,
        available,
        ...(iconDataUrl ? { iconDataUrl } : {}),
      };
    }));
  }

  async function isAvailable(targetPath: string): Promise<boolean> {
    try {
      return await options.isTargetAvailable(targetPath);
    } catch {
      return false;
    }
  }

  async function mutate(
    change: (current: readonly AppLauncherStoredEntry[]) => AppLauncherStoredEntry[],
    afterCommit?: (previous: readonly AppLauncherStoredEntry[], next: readonly AppLauncherStoredEntry[]) => void,
  ): Promise<readonly AppLauncherSnapshotEntry[]> {
    return serialize(async () => {
      await ensureLoaded();
      const previous = entries;
      const next = change(previous);
      try {
        await options.storage.save(next);
      } catch {
        throw new Error("Application launcher settings could not be saved.");
      }
      entries = next;
      afterCommit?.(previous, next);
      return snapshot(entries);
    });
  }

  function findEntry(current: readonly AppLauncherStoredEntry[], id: unknown): AppLauncherStoredEntry {
    const safeId = normalizeAppLauncherId(id);
    const entry = current.find((candidate) => candidate.id === safeId);
    if (!entry) throw new Error("Application launcher entry was not found.");
    return entry;
  }

  return {
    list: () => serialize(async () => {
      await ensureLoaded();
      return snapshot(entries);
    }),

    listForMenu: () => serialize(async () => {
      await ensureLoaded();
      return Promise.all(entries.map(async (entry) => ({
        id: entry.id,
        name: entry.name,
        available: await isAvailable(entry.targetPath),
        targetRevision: ensureTargetRevision(entry.id),
      })));
    }),

    add: async (rawName, rawTargetPath) => {
      const name = normalizeAppLauncherName(rawName);
      const targetPath = normalizeAppLauncherTargetPath(rawTargetPath);
      if (!(await isAvailable(targetPath))) throw new Error("Choose a supported application.");
      return mutate((current) => {
        if (current.length >= maxAppLaunchers) throw new Error("The launcher can contain up to 20 applications.");
        const id = (options.createId ?? randomUUID)();
        if (!appLauncherIdPattern.test(id) || current.some((entry) => entry.id === id)) {
          throw new Error("Application launcher could not create a unique entry.");
        }
        return [...current, { id, name, targetPath }];
      });
    },

    rename: (rawId, rawName) => {
      const id = normalizeAppLauncherId(rawId);
      const name = normalizeAppLauncherName(rawName);
      return mutate((current) => {
        findEntry(current, id);
        return current.map((entry) => entry.id === id ? { ...entry, name } : entry);
      });
    },

    replaceTarget: async (rawId, rawTargetPath) => {
      const id = normalizeAppLauncherId(rawId);
      const targetPath = normalizeAppLauncherTargetPath(rawTargetPath);
      if (!(await isAvailable(targetPath))) throw new Error("Choose a supported application.");
      return mutate((current) => {
        findEntry(current, id);
        return current.map((entry) => entry.id === id ? { ...entry, targetPath } : entry);
      }, (previous) => {
        if (findEntry(previous, id).targetPath !== targetPath) {
          targetRevisions.set(id, createTargetRevision());
        }
      });
    },

    move: (rawId, rawDirection) => {
      const id = normalizeAppLauncherId(rawId);
      if (rawDirection !== -1 && rawDirection !== 1) throw new Error("Application order change is invalid.");
      return mutate((current) => {
        const index = current.findIndex((entry) => entry.id === id);
        if (index < 0) throw new Error("Application launcher entry was not found.");
        const nextIndex = index + rawDirection;
        if (nextIndex < 0 || nextIndex >= current.length) return [...current];
        const next = [...current];
        const [entry] = next.splice(index, 1);
        if (!entry) return [...current];
        next.splice(nextIndex, 0, entry);
        return next;
      });
    },

    remove: (rawId) => {
      const id = normalizeAppLauncherId(rawId);
      return mutate((current) => {
        findEntry(current, id);
        return current.filter((entry) => entry.id !== id);
      }, () => {
        targetRevisions.delete(id);
      });
    },

    launch: (rawId, expectedTargetRevision) => serialize(async () => {
      await ensureLoaded();
      const entry = findEntry(entries, rawId);
      if (expectedTargetRevision !== undefined && ensureTargetRevision(entry.id) !== expectedTargetRevision) {
        throw new Error("Application selection is stale. Open the menu again.");
      }
      if (!(await isAvailable(entry.targetPath))) throw new Error("Application is unavailable.");
      try {
        await options.launchTarget(entry.targetPath);
      } catch {
        throw new Error("Application could not be started.");
      }
    }),
  };

  function ensureTargetRevision(id: string): AppLauncherTargetRevision {
    const revision = targetRevisions.get(id);
    if (revision) return revision;
    const next = createTargetRevision();
    targetRevisions.set(id, next);
    return next;
  }
}

function createTargetRevision(): AppLauncherTargetRevision {
  const revision: AppLauncherTargetRevision = { [appLauncherTargetRevisionBrand]: true };
  return Object.freeze(revision);
}

export function normalizeAppLauncherId(value: unknown): string {
  if (typeof value !== "string" || !appLauncherIdPattern.test(value)) {
    throw new Error("Application launcher entry is invalid.");
  }
  return value;
}

function normalizeAppLauncherTargetPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || /[\u0000\r\n]/.test(value)) {
    throw new Error("Choose a supported application.");
  }
  return value;
}

function normalizeStoredEntries(value: unknown): AppLauncherStoredEntry[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.entries)) return [];

  const normalized: AppLauncherStoredEntry[] = [];
  const seenIds = new Set<string>();
  for (const candidate of record.entries.slice(0, maxAppLaunchers)) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
    const entry = candidate as Record<string, unknown>;
    if (!appLauncherIdPattern.test(typeof entry.id === "string" ? entry.id : "")) continue;
    if (seenIds.has(entry.id as string)) continue;
    if (typeof entry.targetPath !== "string" || entry.targetPath.length === 0 || entry.targetPath.length > 4096 || /[\u0000\r\n]/.test(entry.targetPath)) continue;
    let name: string;
    try {
      name = normalizeAppLauncherName(entry.name);
    } catch {
      continue;
    }
    seenIds.add(entry.id as string);
    normalized.push({ id: entry.id as string, name, targetPath: entry.targetPath });
  }
  return normalized;
}

function isSafeIconDataUrl(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 512_000
    && /^data:image\/(?:png|jpeg|webp|x-icon);base64,[a-z0-9+/]+=*$/i.test(value);
}
