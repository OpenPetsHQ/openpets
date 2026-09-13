import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

import { validateTeamPack, type TeamEnrollmentLink, type TeamPack } from "./team-protocol.js";

export const teamStateFileName = "openpets-team-state.json";
export const teamCredentialFileName = "openpets-team-credential.bin";
export type TeamEnrollmentState = { readonly version: 1; readonly installationId: string; readonly organizationId: string; readonly organizationName?: string; readonly deviceId?: string; readonly pendingIntent?: TeamEnrollmentLink; readonly pendingRevision: number; readonly appliedRevision: number; readonly etag?: string; readonly lastSyncAt?: string; readonly lastError?: string; readonly desiredPack?: TeamPack };

export type TeamStateStoreOptions = { readonly userDataPath?: string; readonly statePath?: string };

export class TeamStateStore {
  readonly statePath: string;
  readonly installationId: string;
  #state: TeamEnrollmentState | null = null;
  constructor(options: TeamStateStoreOptions) {
    this.statePath = options.statePath ?? join(options.userDataPath ?? "", teamStateFileName);
    const old = readState(this.statePath);
    this.installationId = old?.installationId ?? `desktop-${crypto.randomUUID()}`;
    this.#state = old ? { ...old, installationId: this.installationId } : null;
  }
  initialize(): TeamEnrollmentState | null { if (!this.#state && existsSync(this.statePath)) this.#state = readState(this.statePath); return this.snapshot(); }
  snapshot(): TeamEnrollmentState | null { return this.#state ? structuredClone(this.#state) : null; }
  enroll(input: { organizationId: string; organizationName?: string; deviceId?: string }): TeamEnrollmentState { if (this.#state?.organizationId) throw new Error("This desktop is already enrolled. Leave the current organization before re-enrolling."); return this.commit({ version: 1, installationId: this.installationId, organizationId: input.organizationId, organizationName: input.organizationName, deviceId: input.deviceId, pendingRevision: 0, appliedRevision: 0 }); }
  setPending(pack: TeamPack, etag?: string): TeamEnrollmentState { const current = this.require(); return this.commit({ ...current, pendingRevision: pack.revision, desiredPack: pack, etag: etag ?? current.etag, lastError: undefined }); }
  setApplied(revision: number): TeamEnrollmentState { const current = this.require(); return this.commit({ ...current, appliedRevision: revision, pendingRevision: revision, lastSyncAt: new Date().toISOString(), lastError: undefined }); }
  setError(error: string): TeamEnrollmentState { const current = this.require(); return this.commit({ ...current, lastError: error.slice(0, 500) }); }
  setPendingIntent(intent: TeamEnrollmentLink): TeamEnrollmentState { const current = this.#state ?? { version: 1, installationId: this.installationId, organizationId: "", pendingRevision: 0, appliedRevision: 0 }; return this.commit({ ...current, pendingIntent: intent }); }
  clearPendingIntent(): TeamEnrollmentState { const current = this.require(); const { pendingIntent: _, ...next } = current; return this.commit(next); }
  leave(): void { this.commit({ version: 1, installationId: this.installationId, organizationId: "", pendingRevision: 0, appliedRevision: 0 }); }
  require(): TeamEnrollmentState { if (!this.#state?.organizationId) throw new Error("This desktop is not enrolled in Teams."); return this.#state; }
  private commit(state: TeamEnrollmentState): TeamEnrollmentState { writeAtomic(this.statePath, state); this.#state = state; return this.snapshot()!; }
}

export interface SecureCredentialStore { load(): string | null; save(value: string): void; clear(): void; }
export class ElectronTeamCredentialStore implements SecureCredentialStore {
  readonly path: string;
  constructor(userDataPath: string) { this.path = join(userDataPath, teamCredentialFileName); }
  load(): string | null { if (!existsSync(this.path)) return null; const safeStorage = getSafeStorage(); if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure Teams credential storage is unavailable."); return safeStorage.decryptString(readFileSync(this.path)); }
  save(value: string): void { const safeStorage = getSafeStorage(); if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure Teams credential storage is unavailable."); writeAtomicBytes(this.path, safeStorage.encryptString(value)); }
  clear(): void { try { require("node:fs").rmSync(this.path, { force: true }); } catch { /* cleanup is best effort */ } }
}

function getSafeStorage(): typeof import("electron").safeStorage { const electron = createRequire(import.meta.url)("electron") as typeof import("electron"); return electron.safeStorage; }
function readState(path: string): TeamEnrollmentState | null { if (!existsSync(path)) return null; try { const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; if (raw.version !== 1 || typeof raw.installationId !== "string" || !/^desktop-[0-9a-f-]{36}$/.test(raw.installationId) || typeof raw.organizationId !== "string" || raw.organizationId.length > 160 || !Number.isSafeInteger(raw.pendingRevision) || !Number.isSafeInteger(raw.appliedRevision) || (raw.pendingRevision as number) < 0 || (raw.appliedRevision as number) < 0) return null; if (raw.desiredPack !== undefined) validateTeamPack(raw.desiredPack); return raw as unknown as TeamEnrollmentState; } catch { return null; } }
function writeAtomic(path: string, value: unknown): void { writeAtomicBytes(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`)); }
function writeAtomicBytes(path: string, bytes: Buffer): void { mkdirSync(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.tmp`; writeFileSync(temp, bytes, { mode: 0o600 }); renameSync(temp, path); }
