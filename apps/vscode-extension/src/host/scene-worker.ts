import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import { applySceneCommand, createDefaultScene, parseStoredScene, type StoredScene } from "./scene-state.js";
import { parseReceipt, type AssetReferenceListing, type AssetReferenceProblem, type Receipt } from "./asset-reference.js";

if (!parentPort) throw new Error("Scene worker requires a parent port.");
const port = parentPort;
const databasePath: unknown = workerData?.databasePath;
if (typeof databasePath !== "string" || !isAbsolute(databasePath)) {
  throw new Error("Scene database path must be absolute.");
}

let database: DatabaseSync | undefined;
let initialized = false;

class InvalidSceneError extends Error {}
class ConnectionFailedError extends Error {}
class AssetConflictError extends Error {}

function validate<T>(callback: () => T): T {
  try {
    return callback();
  } catch (error) {
    throw new InvalidSceneError(error instanceof Error ? error.message : "Invalid scene data.");
  }
}

function readScene(db: DatabaseSync): StoredScene {
  const row = db.prepare("SELECT json FROM scene WHERE id = 1").get();
  if (!row || typeof row.json !== "string") throw new InvalidSceneError("Scene record is missing or invalid.");
  return validate(() => parseStoredScene(JSON.parse(row.json as string) as unknown));
}

function transaction<T>(db: DatabaseSync, callback: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      const original = error instanceof Error ? error.message : String(error);
      throw new ConnectionFailedError(`${original} (rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`);
    }
    throw error;
  }
}

function initialize(recovery = false): StoredScene {
  if (!database) {
    if (recovery) {
      const fd = openSync(databasePath as string, "r+");
      closeSync(fd);
    } else {
      mkdirSync(dirname(databasePath as string), { recursive: true });
    }
    const opened = new DatabaseSync(databasePath as string);
    try {
      opened.exec("PRAGMA busy_timeout = 1000");
      database = opened;
    } catch (error) {
      opened.close();
      throw error;
    }
  }
  const db = database;
  const scene = transaction(db, () => {
    if (recovery) return readScene(db);
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scene'").get();
    if (existing) return readScene(db);
    db.exec("CREATE TABLE IF NOT EXISTS scene (id INTEGER PRIMARY KEY, json TEXT NOT NULL)");
    const seed = createDefaultScene(randomUUID());
    db.prepare("INSERT INTO scene (id, json) VALUES (1, ?)").run(JSON.stringify(seed));
    return seed;
  });
  initialized = true;
  return scene;
}

function assetId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) throw new InvalidSceneError("Invalid asset ID.");
  return value;
}

function assetRecord(row: Record<string, unknown> | undefined): Receipt | null {
  if (!row) return null;
  if (typeof row.json !== "string" || typeof row.id !== "string") throw new InvalidSceneError("Invalid asset record.");
  const receipt = validate(() => parseReceipt(JSON.parse(row.json as string) as unknown));
  if (receipt.id !== row.id) throw new InvalidSceneError("Asset record identity mismatch.");
  return receipt;
}

function assetsInitialized(db: DatabaseSync): boolean {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'asset_migration'").get()) return false;
  const marker = db.prepare("SELECT initialized FROM asset_migration WHERE id = 1").get();
  if (!marker) return false;
  if (marker.initialized !== 1) throw new InvalidSceneError("Invalid asset migration marker.");
  return true;
}

function requireAssets(db: DatabaseSync): void {
  if (!assetsInitialized(db)) throw new InvalidSceneError("Asset references are not initialized.");
}

function parseProblem(value: unknown): AssetReferenceProblem {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidSceneError("Invalid asset problem.");
  const input = value as Record<string, unknown>;
  const id = assetId(input.id);
  if (Object.keys(input).length !== 2 || typeof input.message !== "string" || !input.message.trim() || input.message.length > 500) throw new InvalidSceneError("Invalid asset problem.");
  return { id, message: input.message };
}

function listAssets(db: DatabaseSync): AssetReferenceListing {
  requireAssets(db);
  const references: Receipt[] = [];
  const problems: AssetReferenceProblem[] = [];
  for (const row of db.prepare("SELECT id, json FROM asset_references ORDER BY id").all()) {
    try {
      references.push(assetRecord(row)!);
    } catch (error) {
      if (!(error instanceof InvalidSceneError)) throw error;
      const id = assetId(row.id);
      let message = error.message;
      try {
        const blocked: unknown = typeof row.json === "string" ? JSON.parse(row.json) : null;
        if (blocked && typeof blocked === "object" && "blocked" in blocked) {
          const problem = parseProblem(blocked.blocked);
          if (problem.id === id) message = problem.message;
        }
      } catch { /* Report the corrupt record rather than discarding it. */ }
      problems.push({ id, message: message.slice(0, 500) });
    }
  }
  return { references, problems };
}

function assetOperation(db: DatabaseSync, operation: string, command: unknown): { references?: Receipt[]; problems?: AssetReferenceProblem[]; reference?: Receipt | null; initialized?: boolean } {
  const input = command && typeof command === "object" && !Array.isArray(command) ? command as Record<string, unknown> : {};
  if (operation === "assetReferencesInitialized") return { initialized: assetsInitialized(db) };
  if (operation === "initializeAssets") return transaction(db, () => {
    db.exec("CREATE TABLE IF NOT EXISTS asset_references (id TEXT PRIMARY KEY, json TEXT NOT NULL)");
    db.exec("CREATE TABLE IF NOT EXISTS asset_migration (id INTEGER PRIMARY KEY, initialized INTEGER NOT NULL)");
    const marker = db.prepare("SELECT initialized FROM asset_migration WHERE id = 1").get();
    if (marker) return listAssets(db);
    if (!Array.isArray(input.records)) throw new InvalidSceneError("Invalid initial asset records.");
    const records = input.records.map((value: unknown) => validate(() => parseReceipt(value)));
    if (input.problems !== undefined && !Array.isArray(input.problems)) throw new InvalidSceneError("Invalid asset problems.");
    const problems = (input.problems ?? []).map((value: unknown) => parseProblem(value));
    const ids = [...records.map((record) => record.id), ...problems.map((problem) => problem.id)];
    if (new Set(ids).size !== ids.length) throw new InvalidSceneError("Duplicate asset records.");
    const existing = db.prepare("SELECT id FROM asset_references LIMIT 1").get();
    if (existing) throw new InvalidSceneError("Unmarked asset references already exist.");
    const insert = db.prepare("INSERT INTO asset_references (id, json) VALUES (?, ?)");
    for (const record of records) insert.run(record.id, JSON.stringify(record));
    for (const problem of problems) insert.run(problem.id, JSON.stringify({ blocked: problem }));
    db.prepare("INSERT INTO asset_migration (id, initialized) VALUES (1, 1)").run();
    return listAssets(db);
  });
  if (operation === "listAssetReferences") return listAssets(db);
  if (operation === "readAssetReference") {
    requireAssets(db);
    return { reference: assetRecord(db.prepare("SELECT id, json FROM asset_references WHERE id = ?").get(assetId(input.assetId))) };
  }
  if (operation === "compareAndSwapAssetReference") return transaction(db, () => {
    requireAssets(db);
    const id = assetId(input.assetId);
    const receipt = validate(() => parseReceipt(input.receipt));
    if (receipt.id !== id || !(input.expectedGeneration === null || (typeof input.expectedGeneration === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.expectedGeneration)))) throw new InvalidSceneError("Invalid asset comparison.");
    const current = assetRecord(db.prepare("SELECT id, json FROM asset_references WHERE id = ?").get(id));
    if ((current?.generation ?? null) !== input.expectedGeneration) throw new AssetConflictError("Asset changed; review and retry the replacement.");
    db.prepare("INSERT INTO asset_references (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(id, JSON.stringify(receipt));
    return { reference: receipt };
  });
  throw new InvalidSceneError("Unknown asset operation.");
}

function execute(operation: string, command: unknown): { scene?: StoredScene; references?: Receipt[]; problems?: AssetReferenceProblem[]; reference?: Receipt | null; initialized?: boolean } {
  if (operation === "close") {
    database?.close();
    database = undefined;
    initialized = false;
    return {};
  }
  if (operation === "initialize") return { scene: initialize() };
  if (operation === "recover") return { scene: initialize(true) };
  if (!initialized || !database) throw new Error("Scene worker is not initialized.");
  if (operation === "read") return { scene: readScene(database) };
  if (operation === "mutate") {
    const db = database;
    return { scene: transaction(db, () => {
      const next = validate(() => parseStoredScene(applySceneCommand(readScene(db), command)));
      db.prepare("UPDATE scene SET json = ? WHERE id = 1").run(JSON.stringify(next));
      return next;
    }) };
  }
  return assetOperation(database, operation, command);
}

port.on("message", (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const request = value as Record<string, unknown>;
  if (!Number.isSafeInteger(request.id) || typeof request.operation !== "string") return;
  try {
    const result = execute(request.operation, request.operation === "mutate" ? request.command : request);
    port.postMessage({ id: request.id, ok: true, ...result });
    if (request.operation === "close") port.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = error instanceof ConnectionFailedError ? "connection-failed" : error instanceof AssetConflictError ? "conflict" : error instanceof InvalidSceneError ? "invalid" : /\b(database is locked|database is busy|SQLITE_BUSY)\b/i.test(message) ? "busy" : undefined;
    port.postMessage({ id: request.id, ok: false, error: { message, ...(kind ? { kind } : {}) } });
    if (error instanceof ConnectionFailedError) {
      try { database?.close(); } catch { /* Termination releases a poisoned connection. */ }
      database = undefined;
      initialized = false;
      port.close();
    }
  }
});
