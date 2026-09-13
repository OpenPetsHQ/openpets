import { promises as fs } from "node:fs";
import { join } from "node:path";

import { getAppStateSnapshot, installTeamPetState, removeTeamPetState, type TeamPetOwnership } from "./app-state.js";
import { validatePluginConfigReplacement } from "./plugin-config.js";
import type { PluginService } from "./plugin-service.js";
import type { TeamPluginOwnership } from "./plugin-state.js";
import { TeamApiClient } from "./team-api-client.js";
import { activateTeamArtifact, removeTeamArtifact, stageTeamArtifact, type StagedTeamArtifact } from "./team-package.js";
import { findTeamEnrollmentLink, type TeamEnrollmentLink, type TeamPack, type TeamPackItem } from "./team-protocol.js";
import { ElectronTeamCredentialStore, TeamStateStore, type SecureCredentialStore, type TeamEnrollmentState } from "./team-state.js";
import { reconcileTeamPack, resolveTeamPluginPolicy, type TeamOwnedItem } from "./team-reconciler.js";

export type TeamServiceSnapshot = {
  readonly enrolled: boolean;
  readonly organizationId: string | null;
  readonly organizationName: string | null;
  readonly pendingEnrollment: boolean;
  readonly installationId: string | null;
  readonly pendingRevision: number;
  readonly appliedRevision: number;
  readonly lastSyncAt?: string;
  readonly lastError?: string;
  readonly teamPets: readonly { readonly id: string; readonly displayName: string; readonly source: "team" }[];
  readonly teamPlugins: readonly { readonly id: string; readonly version: string; readonly enabled: boolean; readonly policy: "required" | "optional"; readonly source: "team" }[];
};

export type TeamServiceOptions = {
  readonly userDataPath: string;
  readonly apiClient?: TeamApiClient;
  readonly stateStore?: TeamStateStore;
  readonly credentialStore?: SecureCredentialStore;
  readonly pluginService: PluginService;
  readonly log?: (level: "info" | "warn" | "error", message: string, fields?: Record<string, unknown>) => void;
  readonly pollMs?: number;
};

let appTeamService: TeamService | null = null;

export class TeamService {
  readonly stateStore: TeamStateStore;
  readonly credentialStore: SecureCredentialStore;
  readonly apiClient: TeamApiClient;
  readonly #userDataPath: string;
  readonly #pluginService: PluginService;
  readonly #log: NonNullable<TeamServiceOptions["log"]>;
  readonly #pollMs: number;
  #timer: NodeJS.Timeout | null = null;
  #started = false;
  #syncing: Promise<TeamServiceSnapshot> | null = null;

  constructor(options: TeamServiceOptions) {
    this.#userDataPath = options.userDataPath;
    this.#pluginService = options.pluginService;
    this.stateStore = options.stateStore ?? new TeamStateStore({ userDataPath: options.userDataPath });
    this.credentialStore = options.credentialStore ?? new ElectronTeamCredentialStore(options.userDataPath);
    this.apiClient = options.apiClient ?? new TeamApiClient();
    this.#log = options.log ?? (() => undefined);
    this.#pollMs = Math.max(60_000, Math.min(options.pollMs ?? 15 * 60_000, 24 * 60 * 60_000));
  }

  async start(): Promise<void> { this.#started = true; this.stateStore.initialize(); if (this.stateStore.snapshot()?.organizationId) { try { if (this.credentialStore.load()) { await this.syncNow().catch(() => undefined); this.#schedule(); } else { this.stateStore.setError("secure_storage_unavailable"); this.#log("error", "Teams secure credential storage is unavailable", {}); } } catch { this.stateStore.setError("secure_storage_unavailable"); this.#log("error", "Teams secure credential storage is unavailable", {}); } } }
  async stop(): Promise<void> { this.#started = false; if (this.#timer) clearTimeout(this.#timer); this.#timer = null; await this.#syncing?.catch(() => undefined); }
  handleDeepLink(value: unknown): boolean { const link = typeof value === "string" ? findTeamEnrollmentLink([value]) : null; if (!link) return false; this.stateStore.setPendingIntent(link); this.#log("info", "Teams enrollment link received", {}); return true; }
  handleArgv(argv: readonly unknown[]): boolean { const link = findTeamEnrollmentLink(argv); return link ? this.handleDeepLink(`openpets://teams/enroll?intent=${encodeURIComponent(link.intentId)}`) : false; }

  async submitEnrollment(displayName: string): Promise<TeamServiceSnapshot> {
    if (typeof displayName !== "string" || displayName.trim().length === 0 || displayName.length > 120) throw new Error("A valid display name is required.");
    if (this.stateStore.snapshot()?.organizationId) throw new Error("Leave the current organization before re-enrolling this desktop.");
    const pending = this.stateStore.snapshot()?.pendingIntent;
    if (!pending) throw new Error("No pending Teams enrollment link.");
    const installationId = this.stateStore.installationId;
    // The browser confirmation token is deliberately never persisted. The API accepts
    // the opaque intent handoff and keeps the browser-side confirmation state server-side.
    await this.apiClient.requestEnrollment(pending.intentId, pending.intentId, installationId, displayName.trim());
    const enrollment = await this.apiClient.completeEnrollment(pending.intentId, pending.intentId);
    this.credentialStore.save(enrollment.deviceCredential);
    this.stateStore.enroll({ organizationId: enrollment.organization.id, organizationName: enrollment.organization.name, deviceId: enrollment.deviceId });
    this.stateStore.clearPendingIntent();
    this.#log("info", "Teams enrollment completed", { organizationId: enrollment.organization.id });
    await this.syncNow();
    return this.getSnapshot();
  }

  async syncNow(): Promise<TeamServiceSnapshot> {
    if (this.#syncing) return this.#syncing;
    this.#syncing = this.#syncNow().finally(() => { this.#syncing = null; });
    return this.#syncing;
  }
  async leave(): Promise<TeamServiceSnapshot> {
    const credential = this.credentialStore.load();
    if (!credential) { await this.cleanupTeamContent(); this.stateStore.leave(); return this.getSnapshot(); }
    try { await this.apiClient.leaveOrganization(credential); }
    catch (error) { this.stateStore.setError("leave_failed"); throw error; }
    await this.cleanupTeamContent(); this.credentialStore.clear(); this.stateStore.leave(); this.#log("info", "Teams enrollment left", {}); return this.getSnapshot();
  }
  getSnapshot(): TeamServiceSnapshot {
    const state = this.stateStore.snapshot(); const appState = getAppStateSnapshot(); const teamPets = appState.pets.installed.filter((pet) => pet.source?.kind === "team").map((pet) => ({ id: pet.id, displayName: pet.displayName, source: "team" as const }));
    const teamPlugins = this.#pluginService.stateStore.listRecords().filter((record) => record.source === "team").map((record) => ({ id: record.id, version: record.version, enabled: record.enabled, policy: record.teamPolicy ?? "optional" as const, source: "team" as const }));
    return { enrolled: Boolean(state?.organizationId), organizationId: state?.organizationId || null, organizationName: state?.organizationName ?? null, pendingEnrollment: Boolean(state?.pendingIntent), installationId: state?.organizationId ? state.installationId : null, pendingRevision: state?.pendingRevision ?? 0, appliedRevision: state?.appliedRevision ?? 0, lastSyncAt: state?.lastSyncAt, lastError: state?.lastError, teamPets, teamPlugins };
  }
  async #syncNow(): Promise<TeamServiceSnapshot> {
    const state = this.stateStore.require(); const credential = this.credentialStore.load(); if (!credential) throw new Error("Teams secure credential is unavailable.");
    try {
      const response = await this.apiClient.getTeamPack(credential, state.etag); const pack = response.notModified ? state.desiredPack : response.pack; if (!pack) throw new Error("Teams server did not return a Team Pack.");
      if (pack.revision < state.appliedRevision) throw new Error("Teams server returned an older Team Pack revision.");
      this.stateStore.setPending(pack, response.etag);
      const current = this.currentItems(state.organizationId);
      const result = await reconcileTeamPack(pack, current, { stage: (item) => this.stage(item, credential), apply: (item, staged) => this.apply(item, staged as StagedTeamArtifact, state.organizationId), remove: (item) => this.remove(item, state.organizationId) });
      if (!result.applied) { this.stateStore.setError(result.failureCode ?? "reconcile_failed"); await this.apiClient.reportDeployment(credential, pack.revision, "error").catch(() => undefined); return this.getSnapshot(); }
      this.stateStore.setApplied(pack.revision); await this.apiClient.reportDeployment(credential, pack.revision, "current"); this.#log("info", "Teams Pack reconciled", { revision: pack.revision, itemCount: pack.items.length }); return this.getSnapshot();
    } catch (error) { const reason = error instanceof Error ? error.message.slice(0, 200) : "sync_failed"; this.stateStore.setError(reason); this.#log("warn", "Teams sync failed", { reason }); throw error; }
    finally { if (this.#started) this.#schedule(); }
  }
  private async stage(item: TeamPackItem, credential: string): Promise<StagedTeamArtifact> { const bytes = await this.apiClient.downloadArtifact(credential, item.versionId, item.size, item.sha256); return stageTeamArtifact(this.#userDataPath, item, bytes); }
  private async apply(item: TeamPackItem, staged: StagedTeamArtifact, organizationId: string): Promise<void> {
    if (item.type === "pet") {
      const target = await activateTeamArtifact(this.#userDataPath, staged);
      const ownership: TeamPetOwnership = { kind: "team", organizationId, itemId: item.itemId, artifactVersionId: item.versionId, releaseId: item.releaseId };
      installTeamPetState({ id: item.id, displayName: staged.petMetadata!.displayName, description: staged.petMetadata!.description, source: ownership });
      return;
    }
    const manifest = staged.manifest!; const existing = this.#pluginService.stateStore.getRecord(item.id);
    if (existing?.source !== undefined && existing.source !== "team") throw new Error(`A personal plugin already uses this id: ${item.id}`);
    const previousApprovals = existing?.approvedPermissions ?? [];
    const policy = resolveTeamPluginPolicy(item.policy!, existing?.enabled, manifest.permissions, previousApprovals);
    if (policy.permissionBlocked && (existing || manifest.permissions.length > 0)) throw new Error("Team plugin permission approval is required.");
    const config = validatePluginConfigReplacement(manifest, item.config ?? {}); if (!config.ok) throw new Error("Team plugin configuration is invalid.");
    const ownership: TeamPluginOwnership = { organizationId, itemId: item.itemId, artifactVersionId: item.versionId, releaseId: item.releaseId };
    const target = await activateTeamArtifact(this.#userDataPath, staged);
    this.#pluginService.stateStore.upsertRecord({ id: item.id, version: item.version, source: "team", teamOwnership: ownership, teamPolicy: item.policy, installPath: target, manifestPath: join(target, "openpets.plugin.json"), manifestVersion: manifest.manifestVersion, runtime: manifest.runtime, sdkVersion: "sdkVersion" in manifest ? manifest.sdkVersion : undefined, enabled: policy.enabled, approvedPermissions: existing?.approvedPermissions ?? [], approvedNetworkHosts: existing?.approvedNetworkHosts, config: config.config });
    await this.#pluginService.runtime.reloadPlugin(item.id);
  }
  private async remove(item: TeamOwnedItem, organizationId: string): Promise<void> {
    if (item.organizationId !== organizationId) return;
    if (item.type === "pet") { removeTeamPetState({ kind: "team", organizationId, itemId: item.itemId, artifactVersionId: item.artifactVersionId, releaseId: item.releaseId }); await removeTeamArtifact(this.#userDataPath, "pet", item.id); return; }
    const record = this.#pluginService.stateStore.getRecord(item.id); if (!record || record.source !== "team" || record.teamOwnership?.organizationId !== organizationId || record.teamOwnership.itemId !== item.itemId) return;
    this.#pluginService.stateStore.removeRecord(item.id); await this.#pluginService.runtime.reloadPlugin(item.id); await Promise.all([fs.rm(join(this.#userDataPath, "team-plugins", item.id), { recursive: true, force: true }), fs.rm(join(this.#userDataPath, "plugin-user-sounds", item.id), { recursive: true, force: true }), fs.rm(join(this.#userDataPath, "plugin-storage", `${item.id}.json`), { force: true })]);
  }
  private currentItems(organizationId: string): TeamOwnedItem[] { const pets = getAppStateSnapshot().pets.installed.flatMap((pet) => { const source = pet.source; return source?.kind === "team" && source.organizationId === organizationId ? [{ type: "pet" as const, id: pet.id, source: "team" as const, organizationId, itemId: source.itemId, artifactVersionId: source.artifactVersionId, releaseId: source.releaseId, version: "0.0.0" }] : []; }); const plugins = this.#pluginService.stateStore.listRecords().flatMap((record) => { const ownership = record.teamOwnership; return record.source === "team" && ownership?.organizationId === organizationId ? [{ type: "plugin" as const, id: record.id, source: "team" as const, organizationId, itemId: ownership.itemId, artifactVersionId: ownership.artifactVersionId, releaseId: ownership.releaseId, version: record.version, enabled: record.enabled }] : []; }); return [...pets, ...plugins]; }
  private async cleanupTeamContent(): Promise<void> { const state = this.stateStore.snapshot(); if (!state?.organizationId) return; for (const item of this.currentItems(state.organizationId)) { try { await this.remove(item, state.organizationId); } catch (error) { this.#log("warn", "Teams local cleanup item failed", { itemId: item.itemId, reason: error instanceof Error ? error.message.slice(0, 160) : "cleanup_failed" }); } } await Promise.all([fs.rm(join(this.#userDataPath, "team-pets"), { recursive: true, force: true }), fs.rm(join(this.#userDataPath, "team-plugins"), { recursive: true, force: true })]); }
  #schedule(): void { if (!this.#started) return; if (this.#timer) clearTimeout(this.#timer); const jitter = Math.floor(this.#pollMs * (0.8 + Math.random() * 0.4)); this.#timer = setTimeout(() => { void this.syncNow().catch(() => undefined); }, jitter); this.#timer.unref?.(); }
}

export function initializeTeamService(options: TeamServiceOptions): TeamService { appTeamService = new TeamService(options); return appTeamService; }
export function getTeamService(): TeamService { if (!appTeamService) throw new Error("Teams service has not been initialized."); return appTeamService; }
export function queueTeamEnrollmentLink(value: unknown): boolean { return appTeamService?.handleDeepLink(value) ?? false; }
export function stopTeamService(): Promise<void> { return appTeamService?.stop() ?? Promise.resolve(); }
