import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import { applySceneCommand, createDefaultScene, parseStoredScene, type StoredScene } from "./scene-state.js";

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

function execute(operation: string, command: unknown): StoredScene | undefined {
  if (operation === "close") {
    database?.close();
    database = undefined;
    initialized = false;
    return undefined;
  }
  if (operation === "initialize") return initialize();
  if (operation === "recover") return initialize(true);
  if (!initialized || !database) throw new Error("Scene worker is not initialized.");
  if (operation === "read") return readScene(database);
  if (operation === "mutate") {
    const db = database;
    return transaction(db, () => {
      const next = validate(() => parseStoredScene(applySceneCommand(readScene(db), command)));
      db.prepare("UPDATE scene SET json = ? WHERE id = 1").run(JSON.stringify(next));
      return next;
    });
  }
  throw new InvalidSceneError("Unknown scene worker operation.");
}

port.on("message", (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const request = value as Record<string, unknown>;
  if (!Number.isSafeInteger(request.id) || typeof request.operation !== "string") return;
  try {
    const scene = execute(request.operation, request.command);
    port.postMessage({ id: request.id, ok: true, ...(scene ? { scene } : {}) });
    if (request.operation === "close") port.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = error instanceof ConnectionFailedError ? "connection-failed" : error instanceof InvalidSceneError ? "invalid" : /\b(database is locked|database is busy|SQLITE_BUSY)\b/i.test(message) ? "busy" : undefined;
    port.postMessage({ id: request.id, ok: false, error: { message, ...(kind ? { kind } : {}) } });
    if (error instanceof ConnectionFailedError) {
      try { database?.close(); } catch { /* Termination releases a poisoned connection. */ }
      database = undefined;
      initialized = false;
      port.close();
    }
  }
});
