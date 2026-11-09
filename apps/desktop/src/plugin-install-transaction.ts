import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { readSafePluginManifest } from "./plugin-manifest-reader.js";
import { OPENPETS_PLUGIN_MANIFEST_FILENAME } from "./plugin-manifest.js";
import type { PluginStateRecord, PluginStateStore } from "./plugin-state.js";

type Marker = {
  version: 1;
  id: string;
  token: string;
  stage: string;
  previous: PluginStateRecord | null;
  committed: boolean;
  rolledBack?: boolean;
};

async function syncDirectory(path: string): Promise<void> {
  // Windows does not expose directory handles through Node's fs.open.
  if (process.platform === "win32") return;
  const handle = await fs.open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncFile(path: string): Promise<void> {
  const handle = await fs.open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Invalid staged plugin file.");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncStagedTree(path: string, syncStagedFile: (path: string) => Promise<void>): Promise<void> {
  const stat = await fs.lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid staged plugin directory.");
  for (const entry of await fs.readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    const childStat = await fs.lstat(child);
    if (childStat.isSymbolicLink()) throw new Error("Staged plugin contains a symlink.");
    if (childStat.isDirectory()) {
      await syncStagedTree(child, syncStagedFile);
    } else if (childStat.isFile()) {
      await syncStagedFile(child);
    } else {
      throw new Error("Staged plugin contains an unsupported file.");
    }
  }
  await syncDirectory(path);
}

async function writeMarker(path: string, marker: Marker): Promise<void> {
  const temporary = `${path}.tmp`;
  const file = await fs.open(temporary, "w", 0o600);
  try {
    await file.writeFile(JSON.stringify(marker));
    await file.sync();
  } finally {
    await file.close();
  }
  await fs.rename(temporary, path);
  await syncDirectory(dirname(path));
}

async function exists(path: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid plugin transaction directory.");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function syncState(store: PluginStateStore): Promise<void> {
  const file = await fs.open(store.statePath, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
  await syncDirectory(dirname(store.statePath));
}

function paths(root: string, marker: Marker) {
  return {
    target: join(root, marker.id),
    stage: join(root, marker.stage),
    backup: join(root, `.openpets-backup-${marker.token}`),
    journal: join(root, `.openpets-transaction-${marker.token}.json`),
  };
}

async function validateInstalled(root: string, record: PluginStateRecord): Promise<void> {
  const manifest = await readSafePluginManifest({
    installPath: record.installPath,
    manifestPath: record.manifestPath,
    allowedPluginRoots: [root],
    expectedId: record.id,
    expectedVersion: record.version,
  });
  if (manifest.permissions.some((permission) => !record.approvedPermissions.includes(permission))) {
    throw new Error("Recovered plugin permissions are not approved.");
  }
  const hosts = "network" in manifest ? manifest.network?.hosts ?? [] : [];
  if (hosts.some((host) => !record.approvedNetworkHosts?.includes(host))) {
    throw new Error("Recovered plugin network hosts are not approved.");
  }
}

async function validateCommitted(root: string, marker: Marker, store: PluginStateStore): Promise<void> {
  const { target } = paths(root, marker);
  const record = store.getRecord(marker.id);
  if (!record || record.source !== "catalog" || record.installPath !== target) {
    throw new Error("Committed plugin transaction state is missing.");
  }
  await validateInstalled(root, record);
}

async function cleanup(root: string, marker: Marker): Promise<void> {
  const { stage, backup, journal } = paths(root, marker);
  if (await exists(stage)) await fs.rm(stage, { recursive: true });
  if (await exists(backup)) await fs.rm(backup, { recursive: true });
  await syncDirectory(root);
  await fs.rm(journal);
  await syncDirectory(root);
}

async function cleanupRecoverably(
  root: string,
  marker: Marker,
  warning: (error: unknown) => void,
  cleanupAttempt?: () => Promise<void>,
): Promise<boolean> {
  const { journal } = paths(root, marker);
  try {
    if (cleanupAttempt) await cleanupAttempt();
    await cleanup(root, marker);
    return true;
  } catch (error) {
    try {
      await fs.lstat(journal);
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      await writeMarker(journal, marker);
    }
    warning(error);
    return false;
  }
}

async function recover(
  root: string,
  marker: Marker,
  store: PluginStateStore,
  warning: (error: unknown) => void,
  cleanupAttempt?: () => Promise<void>,
): Promise<boolean> {
  const { target, stage, backup } = paths(root, marker);
  if (marker.committed) {
    await validateCommitted(root, marker, store);
  } else if (marker.rolledBack) {
    const current = store.getRecord(marker.id);
    if (marker.previous) {
      if (!current || current.source !== "catalog" || current.installPath !== target || current.version !== marker.previous.version) {
        throw new Error("Rolled-back plugin transaction state is invalid.");
      }
      await validateInstalled(root, current);
    } else if (current || await exists(target)) {
      throw new Error("Rolled-back plugin transaction still has an installed package.");
    }
  } else if (marker.previous) {
    if (await exists(backup)) {
      if (await exists(target)) await fs.rm(target, { recursive: true });
      await fs.rename(backup, target);
      await syncDirectory(root);
    } else if (!(await exists(target))) {
      throw new Error("Plugin transaction lost its previous package.");
    }
    await validateInstalled(root, marker.previous);
    store.upsertRecord(marker.previous);
    await syncState(store);
  } else {
    if (!(await exists(stage)) && await exists(target)) {
      await fs.rm(target, { recursive: true });
    }
    store.removeRecord(marker.id);
    await syncState(store);
  }
  const settled = marker.committed || marker.rolledBack ? marker : { ...marker, rolledBack: true };
  if (settled !== marker) await writeMarker(paths(root, marker).journal, settled);
  return cleanupRecoverably(root, settled, warning, cleanupAttempt);
}

function parseMarker(value: unknown, root: string, filename: string): Marker {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid plugin transaction marker.");
  }
  const marker = value as Partial<Marker>;
  if (
    marker.version !== 1
    || typeof marker.id !== "string"
    || !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(marker.id)
    || typeof marker.token !== "string"
    || !/^[a-f0-9-]{36}$/.test(marker.token)
    || filename !== `.openpets-transaction-${marker.token}.json`
    || typeof marker.stage !== "string"
    || !marker.stage.startsWith(`.tmp-${marker.id}-`)
    || basename(marker.stage) !== marker.stage
    || typeof marker.committed !== "boolean"
    || (marker.rolledBack !== undefined && typeof marker.rolledBack !== "boolean")
    || (marker.committed && marker.rolledBack)
    || marker.previous === undefined
  ) {
    throw new Error("Invalid plugin transaction marker.");
  }
  if (marker.previous !== null) {
    const previous = marker.previous;
    const target = join(root, marker.id);
    if (
      !previous
      || previous.id !== marker.id
      || previous.source !== "catalog"
      || previous.bundled
      || previous.installPath !== target
      || previous.manifestPath !== join(target, OPENPETS_PLUGIN_MANIFEST_FILENAME)
      || !Array.isArray(previous.approvedPermissions)
    ) {
      throw new Error("Invalid previous plugin transaction state.");
    }
  }
  return marker as Marker;
}

export async function recoverPluginInstallTransactions(
  userDataPath: string,
  store: PluginStateStore,
  log: (id: string, error?: unknown) => void,
  cleanupAttempt?: () => Promise<void>,
): Promise<void> {
  const root = join(userDataPath, "plugins");
  for (const name of await fs.readdir(root)) {
    if (!name.startsWith(".openpets-transaction-") || !name.endsWith(".json")) continue;
    const journal = join(root, name);
    const stat = await fs.lstat(journal);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error("Invalid plugin transaction marker file.");
    const marker = parseMarker(JSON.parse(await fs.readFile(journal, "utf8")) as unknown, root, name);
    log(marker.id);
    await recover(root, marker, store, (error) => log(marker.id, error), cleanupAttempt);
  }
}

export async function settlePluginInstallTransactionsForId(options: {
  userDataPath: string;
  id: string;
  store: PluginStateStore;
  onCleanupWarning?: (error: unknown) => void;
  cleanupAttempt?: () => Promise<void>;
}): Promise<void> {
  const root = join(options.userDataPath, "plugins");
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const name of names) {
    if (!name.startsWith(".openpets-transaction-") || !name.endsWith(".json")) continue;
    const journal = join(root, name);
    const stat = await fs.lstat(journal);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
      throw new Error("Invalid plugin transaction marker file.");
    }
    const pending = parseMarker(JSON.parse(await fs.readFile(journal, "utf8")) as unknown, root, name);
    if (pending.id !== options.id) continue;
    const cleaned = await recover(root, pending, options.store, (error) => options.onCleanupWarning?.(error), options.cleanupAttempt);
    if (!cleaned) throw new Error("Plugin installation recovery is pending; try the operation again later.");
  }
}

export async function commitPluginInstall(options: {
  userDataPath: string;
  id: string;
  stagePath: string;
  previous?: PluginStateRecord;
  store: PluginStateStore;
  activate: () => Promise<void>;
  promote?: (source: string, target: string) => Promise<void>;
  syncStagedFile?: (path: string) => Promise<void>;
  cleanupCommitted?: () => Promise<void>;
  onCleanupWarning?: (error: unknown) => void;
}): Promise<void> {
  const root = join(options.userDataPath, "plugins");
  const stageName = basename(options.stagePath);
  if (join(root, stageName) !== options.stagePath || !stageName.startsWith(`.tmp-${options.id}-`) || !(await exists(options.stagePath))) {
    throw new Error("Invalid plugin staging directory.");
  }
  try {
    await settlePluginInstallTransactionsForId({
      userDataPath: options.userDataPath,
      id: options.id,
      store: options.store,
      onCleanupWarning: options.onCleanupWarning,
      cleanupAttempt: options.cleanupCommitted,
    });
  } catch (error) {
    await fs.rm(options.stagePath, { recursive: true });
    await syncDirectory(root);
    throw error;
  }
  const marker: Marker = {
    version: 1,
    id: options.id,
    token: randomUUID(),
    stage: basename(options.stagePath),
    previous: options.previous ?? null,
    committed: false,
  };
  const { target, stage, backup, journal } = paths(root, marker);
  if (stage !== options.stagePath || !(await exists(stage))) throw new Error("Invalid plugin staging directory.");
  if (Boolean(options.previous) !== await exists(target)) throw new Error("Plugin package state changed during installation.");
  try {
    await syncStagedTree(stage, options.syncStagedFile ?? syncFile);
    await syncDirectory(root);
  } catch (error) {
    try {
      await fs.rm(stage, { recursive: true });
      await syncDirectory(root);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Plugin staging synchronization and cleanup failed.");
    }
    throw error;
  }
  await writeMarker(journal, marker);
  try {
    if (options.previous) await fs.rename(target, backup);
    await (options.promote ?? fs.rename)(stage, target);
    await syncDirectory(root);
    await options.activate();
    await syncState(options.store);
    await writeMarker(journal, { ...marker, committed: true });
  } catch (error) {
    try {
      await recover(root, marker, options.store, (cleanupError) => options.onCleanupWarning?.(cleanupError));
    } catch (recoveryError) {
      throw new AggregateError([error, recoveryError], "Plugin installation failed; transaction recovery is required.");
    }
    throw error;
  }
  const committed: Marker = { ...marker, committed: true };
  await validateCommitted(root, committed, options.store);
  await cleanupRecoverably(root, committed, (error) => options.onCleanupWarning?.(error), options.cleanupCommitted);
}
