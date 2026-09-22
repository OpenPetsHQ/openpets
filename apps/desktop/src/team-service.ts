import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import type {
  InstalledPetState,
  OpenPetsStateV1,
  TeamPetOwnership,
} from "./app-state.js";
import { validatePluginConfigReplacement } from "./plugin-config.js";
import type {
  PluginStateRecord,
  PluginStateStore,
  TeamPluginOwnership,
} from "./plugin-state.js";
import type { PluginRuntime } from "./plugin-runtime.js";
import {
  TeamApiClient,
  TeamApiError,
  teamDisplayNameMaxLength,
  type TeamEnrollmentPreview,
} from "./team-api-client.js";
import {
  activateTeamArtifact,
  discardStagedTeamArtifact,
  removeTeamArtifact,
  stageTeamArtifact,
  type ActivatedTeamArtifact,
  type StagedTeamArtifact,
} from "./team-package.js";
import { readSafePluginManifest } from "./plugin-manifest-reader.js";
import {
  findTeamEnrollmentLink,
  type TeamPack,
  type TeamPackItem,
} from "./team-protocol.js";
import {
  ElectronTeamCredentialStore,
  TeamStateStore,
  type SecureCredentialStore,
  type TeamEnrollmentState,
} from "./team-state.js";
import {
  reconcileTeamPack,
  resolveTeamPluginPolicy,
  TeamOperationQueue,
  type TeamOwnedItem,
} from "./team-reconciler.js";

export type TeamServiceSnapshot = {
  readonly enrolled: boolean;
  readonly organizationId: string | null;
  readonly organizationName: string | null;
  readonly pendingEnrollment: boolean;
  readonly pendingOrganizationId: string | null;
  readonly pendingOrganizationName: string | null;
  readonly pendingEnrollmentStatus: TeamEnrollmentPreview["status"] | null;
  readonly pendingEnrollmentExpiresAt: string | null;
  readonly installationId: string | null;
  readonly pendingRevision: number;
  readonly appliedRevision: number;
  readonly lastSyncAt?: string;
  readonly lastError?: string;
  readonly teamPets: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly source: "team";
  }[];
  readonly teamPlugins: readonly {
    readonly id: string;
    readonly version: string;
    readonly enabled: boolean;
    readonly policy: "required" | "optional";
    readonly source: "team";
    readonly permissionBlocked: boolean;
    readonly requestedPermissions: readonly string[];
    readonly requestedNetworkHosts: readonly string[];
    readonly approvalToken?: string;
  }[];
};

export type TeamServiceOptions = {
  readonly userDataPath: string;
  readonly apiClient?: TeamApiClientAdapter;
  readonly stateStore?: TeamStateStore;
  readonly credentialStore?: SecureCredentialStore;
  readonly pluginService: TeamPluginServiceAdapter;
  readonly petState?: TeamPetStateAdapter;
  readonly log?: (
    level: "info" | "warn" | "error",
    message: string,
    fields?: Record<string, unknown>,
  ) => void;
  readonly pollMs?: number;
};

type TeamApiClientAdapter = Pick<
  TeamApiClient,
  | "completeEnrollment"
  | "getEnrollmentPreview"
  | "getTeamPack"
  | "downloadArtifact"
  | "reportDeployment"
  | "leaveOrganization"
>;
type TeamPluginServiceAdapter = {
  readonly stateStore: Pick<
    PluginStateStore,
    "listRecords" | "getRecord" | "upsertRecord" | "removeRecord" | "setEnabled"
  >;
  readonly runtime: Pick<PluginRuntime, "reloadPlugin">;
};

type TeamPetStateAdapter = {
  readonly snapshot: () => OpenPetsStateV1;
  readonly install: (
    pet: Omit<InstalledPetState, "builtIn" | "protected" | "installed"> & {
      readonly source: TeamPetOwnership;
    },
  ) => OpenPetsStateV1;
  readonly remove: (ownership: TeamPetOwnership) => OpenPetsStateV1;
  readonly upsert: (
    pet: Omit<InstalledPetState, "builtIn" | "protected" | "installed">,
  ) => OpenPetsStateV1;
};

let appTeamService: TeamService | null = null;
const nodeRequire = createRequire(import.meta.url);

export class TeamService {
  readonly stateStore: TeamStateStore;
  readonly credentialStore: SecureCredentialStore;
  readonly apiClient: TeamApiClientAdapter;
  readonly #userDataPath: string;
  readonly #pluginService: TeamPluginServiceAdapter;
  readonly #petState: TeamPetStateAdapter;
  readonly #log: NonNullable<TeamServiceOptions["log"]>;
  readonly #pollMs: number;
  #timer: NodeJS.Timeout | null = null;
  #started = false;
  #syncing: Promise<TeamServiceSnapshot> | null = null;
  #syncSession: AbortController | null = null;
  readonly #operationQueue = new TeamOperationQueue();
  #leaveQueued = false;
  #enrollmentSession: {
    readonly controller: AbortController;
    proof: string;
  } | null = null;
  #enrollmentDone: Promise<void> | null = null;
  #enrollmentPreview: TeamEnrollmentPreview | null = null;
  readonly #enrollmentPreviewListeners = new Set<
    (snapshot: TeamServiceSnapshot) => void
  >();

  constructor(options: TeamServiceOptions) {
    this.#userDataPath = options.userDataPath;
    this.#pluginService = options.pluginService;
    this.#petState = options.petState ?? createDefaultPetStateAdapter();
    this.stateStore = options.stateStore ?? new TeamStateStore({
      userDataPath: options.userDataPath,
    });
    this.credentialStore = options.credentialStore
      ?? new ElectronTeamCredentialStore(options.userDataPath);
    this.apiClient = options.apiClient ?? new TeamApiClient();
    this.#log = options.log ?? (() => undefined);
    this.#pollMs = Math.max(60_000, Math.min(options.pollMs ?? 15 * 60_000, 24 * 60 * 60_000));
  }

  async start(): Promise<void> {
    this.#started = true;
    this.stateStore.initialize();
    const initialState = this.stateStore.snapshot();
    if (!initialState?.organizationId) {
      if (initialState?.pendingIntent) await this.syncNow().catch(() => undefined);
      return;
    }

    try {
      if (!this.credentialStore.load()) {
        this.stateStore.setError("secure_storage_unavailable");
        this.#log("error", "Teams secure credential storage is unavailable", {});
        return;
      }
      await this.syncNow().catch(() => undefined);
      this.#schedule();
    } catch {
      this.stateStore.setError("secure_storage_unavailable");
      this.#log("error", "Teams secure credential storage is unavailable", {});
    }
  }

  async stop(): Promise<void> {
    this.#started = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#abortEnrollment();
    this.#syncSession?.abort();
    await this.#enrollmentDone;
    await this.#operationQueue.wait().catch(() => undefined);
  }
  handleDeepLink(value: unknown): boolean {
    const link = typeof value === "string" ? findTeamEnrollmentLink([value]) : null;
    if (!link) return false;
    void this.#enqueueOperation(async () => {
      if (this.#leaveQueued) return;
      this.stateStore.setPendingIntent(link);
      this.#enrollmentPreview = null;
      this.#notifyEnrollmentPreviewChange();
      await this.#refreshEnrollmentPreview(link.intentId);
      this.#notifyEnrollmentPreviewChange();
      this.#log("info", "Teams enrollment link received", {});
    }).catch((error) => this.#log(
      "error",
      "Teams enrollment link preview could not be loaded",
      {
        reason: error instanceof Error
          ? error.message.slice(0, 160)
          : "state_write_failed",
      },
    ));
    return true;
  }

  subscribeToEnrollmentPreview(
    listener: (snapshot: TeamServiceSnapshot) => void,
  ): () => void {
    this.#enrollmentPreviewListeners.add(listener);
    return () => {
      this.#enrollmentPreviewListeners.delete(listener);
    };
  }
  handleArgv(argv: readonly unknown[]): boolean {
    const link = findTeamEnrollmentLink(argv);
    return link
      ? this.handleDeepLink(`openpets://teams/enroll?intent=${encodeURIComponent(link.intentId)}`)
      : false;
  }

  async submitEnrollment(displayName: string): Promise<TeamServiceSnapshot> {
    await this.#operationQueue.wait();
    if (
      typeof displayName !== "string"
      || displayName.trim().length === 0
      || displayName.length > teamDisplayNameMaxLength
    ) throw new Error("A valid display name is required.");
    if (this.stateStore.snapshot()?.organizationId) {
      throw new Error("Leave the current organization before re-enrolling this desktop.");
    }
    const pending = this.stateStore.snapshot()?.pendingIntent;
    if (!pending) throw new Error("No pending Teams enrollment link.");
    if (this.#enrollmentSession) throw new Error("Teams enrollment is already in progress.");
    const installationId = this.stateStore.installationId;
    const session = {
      controller: new AbortController(),
      proof: randomBytes(32).toString("base64url"),
    };
    this.#enrollmentSession = session;
    const work = (async () => {
      const preview = this.#enrollmentPreview?.intentId === pending.intentId
        ? this.#enrollmentPreview
        : await this.apiClient.getEnrollmentPreview(
          pending.intentId,
          session.controller.signal,
        );
      if (!preview || preview.status === "completed") {
        throw new Error("This Teams enrollment link is no longer available.");
      }
      const enrollment = await this.apiClient.completeEnrollment(
        pending.intentId,
        session.proof,
        installationId,
        displayName.trim(),
        preview.expiresAt,
        session.controller.signal,
      );
      await this.#enqueueOperation(async () => {
        if (session.controller.signal.aborted || this.#leaveQueued) {
          throw new Error("Teams enrollment was cancelled.");
        }
        session.proof = "";
        this.#enrollmentPreview = null;
        this.credentialStore.save(enrollment.deviceCredential);
        this.stateStore.enroll({
          organizationId: enrollment.organization.id,
          organizationName: enrollment.organization.name,
          deviceId: enrollment.deviceId,
        });
        this.stateStore.clearPendingIntent();
        this.#log(
          "info",
          "Teams enrollment completed",
          { organizationId: enrollment.organization.id },
        );
        return this.getSnapshot();
      });
      return await this.syncNow().catch(() => this.getSnapshot());
    })();
    this.#enrollmentDone = work.then(() => undefined, () => undefined);
    try {
      return await work;
    } finally {
      session.proof = "";
      if (this.#enrollmentSession === session) this.#enrollmentSession = null;
      this.#enrollmentDone = null;
    }
  }

  async syncNow(): Promise<TeamServiceSnapshot> {
    if (this.#syncing) return this.#syncing;
    const operation = this.#enqueueOperation(() => this.#syncNow());
    const tracked = operation.finally(() => {
      if (this.#syncing === tracked) this.#syncing = null;
    });
    this.#syncing = tracked;
    return this.#syncing;
  }

  async leave(): Promise<TeamServiceSnapshot> {
    this.#leaveQueued = true;
    this.#abortEnrollment();
    this.#syncSession?.abort();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    return this.#enqueueOperation(async () => {
      try {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = null;
        const credential = this.credentialStore.load();
        if (!credential) {
          await this.cleanupTeamContent();
          this.stateStore.leave();
          return this.getSnapshot();
        }
        try {
          await this.apiClient.leaveOrganization(credential);
        } catch (error) {
          this.stateStore.setError("leave_failed");
          throw error;
        }
        await this.cleanupTeamContent();
        this.credentialStore.clear();
        this.stateStore.leave();
        this.#log("info", "Teams enrollment left", {});
        return this.getSnapshot();
      } finally {
        this.#enrollmentPreview = null;
        this.#leaveQueued = false;
      }
    });
  }
  async approveTeamPluginPermissions(
    id: string,
    approvalToken: string,
  ): Promise<TeamServiceSnapshot> {
    return this.#enqueueOperation(async () => {
      const teamState = this.stateStore.require();
      const record = this.#requireCurrentTeamPlugin(id, teamState);
      if (
        typeof approvalToken !== "string"
        || approvalToken.length !== 43
        || record.teamApprovalToken !== approvalToken
        || !record.teamPendingApproval
      ) throw new Error("Team plugin approval is unavailable.");
      const manifest = await readSafePluginManifest({
        installPath: record.installPath,
        manifestPath: record.manifestPath,
        allowedPluginRoots: [join(this.#userDataPath, "team-plugins")],
        expectedId: record.id,
        expectedVersion: record.version,
      });
      const networkHosts = "network" in manifest ? manifest.network?.hosts ?? [] : [];
      if (
        !sameStringArray(record.teamPendingApproval.permissions, manifest.permissions)
        || !sameStringArray(record.teamPendingApproval.networkHosts, networkHosts)
      ) throw new Error("Team plugin approval is stale.");
      const policy = resolveTeamPluginPolicy(
        record.teamPolicy ?? "optional",
        record.teamPendingApproval.previousEnabled ?? record.enabled,
        manifest.permissions,
        manifest.permissions,
        networkHosts,
        networkHosts,
      );
      const approvedRecord = {
        ...record,
        enabled: policy.enabled,
        approvedPermissions: manifest.permissions,
        approvedNetworkHosts: networkHosts,
        teamPendingApproval: undefined,
        teamApprovalToken: undefined,
      };
      this.#pluginService.stateStore.upsertRecord(approvedRecord);
      try {
        await this.#pluginService.runtime.reloadPlugin(id);
        const reloaded = this.#pluginService.stateStore.getRecord(id);
        if (reloaded?.brokenReason) {
          throw new Error("Team plugin failed to reload after permission approval.");
        }
      } catch (error) {
        this.#pluginService.stateStore.upsertRecord(record);
        await this.#pluginService.runtime.reloadPlugin(id).catch(() => undefined);
        throw error;
      }
      const nextState = this.stateStore.snapshot();
      if (
        nextState?.desiredPack
        && nextState.reconciledRevision === nextState.pendingRevision
        && !this.#hasPendingApprovals(teamState.organizationId)
      ) {
        const credential = this.credentialStore.load();
        if (!credential) {
          throw new Error("Teams secure credential is unavailable.");
        }
        this.stateStore.setApplied(nextState.pendingRevision);
        await this.apiClient.reportDeployment(
          credential,
          nextState.pendingRevision,
          "current",
        ).catch(() => undefined);
      }
      return this.getSnapshot();
    });
  }

  async setTeamPluginEnabled(id: string, enabled: boolean): Promise<TeamServiceSnapshot> {
    return this.#enqueueOperation(async () => {
      if (typeof enabled !== "boolean") {
        throw new Error("Team plugin enabled state is invalid.");
      }
      const teamState = this.stateStore.require();
      const record = this.#requireCurrentTeamPlugin(id, teamState);
      if (record.teamPolicy !== "optional" || record.teamPendingApproval || record.teamApprovalToken) {
        throw new Error("Only fully approved optional Team plugins can be toggled.");
      }
      const manifest = await readSafePluginManifest({
        installPath: record.installPath,
        manifestPath: record.manifestPath,
        allowedPluginRoots: [join(this.#userDataPath, "team-plugins")],
        expectedId: record.id,
        expectedVersion: record.version,
      });
      const networkHosts = "network" in manifest ? manifest.network?.hosts ?? [] : [];
      const policy = resolveTeamPluginPolicy(
        "optional",
        record.enabled,
        manifest.permissions,
        record.approvedPermissions,
        networkHosts,
        record.approvedNetworkHosts ?? [],
      );
      if (policy.permissionBlocked) {
        throw new Error("Team plugin permissions are not fully approved.");
      }
      const nextRecord = { ...record, enabled };
      this.#pluginService.stateStore.upsertRecord(nextRecord);
      try {
        await this.#pluginService.runtime.reloadPlugin(id);
        const reloaded = this.#pluginService.stateStore.getRecord(id);
        if (reloaded?.brokenReason) {
          throw new Error("Team plugin failed to reload after enabled state change.");
        }
      } catch (error) {
        this.#pluginService.stateStore.upsertRecord(record);
        await this.#pluginService.runtime.reloadPlugin(id).catch(() => undefined);
        throw error;
      }
      return this.getSnapshot();
    });
  }
  getSnapshot(): TeamServiceSnapshot {
    const state = this.stateStore.snapshot();
    const organizationId = state?.organizationId || null;
    const appState = this.#petState.snapshot();
    const teamPets = appState.pets.installed
      .filter((pet) => pet.source?.kind === "team" && pet.source.organizationId === organizationId)
      .map((pet) => ({
        id: pet.id,
        displayName: pet.displayName,
        source: "team" as const,
      }));
    const teamPlugins = this.#pluginService.stateStore.listRecords()
      .filter(
        (record) => record.source === "team"
          && record.teamOwnership?.organizationId === organizationId,
      )
      .map((record) => ({
        id: record.id,
        version: record.version,
        enabled: record.enabled,
        policy: record.teamPolicy ?? "optional" as const,
        source: "team" as const,
        permissionBlocked: Boolean(record.teamPendingApproval),
        requestedPermissions: [...record.teamPendingApproval?.permissions ?? []],
        requestedNetworkHosts: [...record.teamPendingApproval?.networkHosts ?? []],
        ...(record.teamPendingApproval && record.teamApprovalToken
          ? { approvalToken: record.teamApprovalToken }
          : {}),
      }));
    return {
      enrolled: Boolean(state?.organizationId),
      organizationId: state?.organizationId || null,
      organizationName: state?.organizationName ?? null,
      pendingEnrollment: Boolean(state?.pendingIntent),
      pendingOrganizationId: this.#enrollmentPreview?.organization.id ?? null,
      pendingOrganizationName: this.#enrollmentPreview?.organization.name ?? null,
      pendingEnrollmentStatus: this.#enrollmentPreview?.status ?? null,
      pendingEnrollmentExpiresAt: this.#enrollmentPreview?.expiresAt ?? null,
      installationId: state?.organizationId ? state.installationId : null,
      pendingRevision: state?.pendingRevision ?? 0,
      appliedRevision: state?.appliedRevision ?? 0,
      lastSyncAt: state?.lastSyncAt,
      lastError: state?.lastError,
      teamPets,
      teamPlugins,
    };
  }
  async #syncNow(): Promise<TeamServiceSnapshot> {
    if (this.#leaveQueued) return this.getSnapshot();
    const state = this.stateStore.snapshot();
    if (!state?.organizationId) {
      const pendingIntent = state?.pendingIntent;
      if (!pendingIntent) return this.getSnapshot();
      try {
        await this.#refreshEnrollmentPreview(pendingIntent.intentId);
      } catch (error) {
        if (!isUnavailableEnrollmentPreviewError(error)) throw error;
        this.#enrollmentPreview = null;
        this.stateStore.leave();
        this.#log("info", "Teams enrollment intent was discarded after expiry", {});
      }
      return this.getSnapshot();
    }
    const credential = this.credentialStore.load();
    if (!credential) throw new Error("Teams secure credential is unavailable.");
    const syncController = new AbortController();
    this.#syncSession = syncController;
    try {
      const response = await this.apiClient.getTeamPack(
        credential,
        state.etag,
        syncController.signal,
      );
      if (this.#leaveQueued || syncController.signal.aborted) return this.getSnapshot();
      const pack = response.notModified ? state.desiredPack : response.pack;
      if (!pack) throw new Error("Teams server did not return a Team Pack.");
      if (pack.revision < state.appliedRevision) {
        throw new Error("Teams server returned an older Team Pack revision.");
      }
      this.stateStore.setPending(pack, response.etag);
      const current = this.currentItems(state.organizationId);
      const result = await reconcileTeamPack(pack, current, {
        stage: (item) => this.stage(item, credential, syncController.signal),
        apply: (item, staged) => this.apply(
          item,
          staged as StagedTeamArtifact,
          state.organizationId,
          syncController.signal,
        ),
        remove: (item) => this.remove(item, state.organizationId),
        discard: (staged) => discardStagedTeamArtifact(staged as StagedTeamArtifact),
        needsApply: (item, previous) => item.type === "plugin"
          && (
            previous.policy !== item.policy
            || JSON.stringify(previous.config ?? {}) !== JSON.stringify(item.config ?? {})
          ),
      });
      if (this.#leaveQueued || syncController.signal.aborted) return this.getSnapshot();
      if (!result.applied) {
        this.stateStore.setError(result.failureCode ?? "reconcile_failed");
        await this.apiClient.reportDeployment(
          credential,
          pack.revision,
          "error",
        ).catch(() => undefined);
        return this.getSnapshot();
      }
      this.stateStore.setReconciled(pack.revision);
      if (result.pendingApproval) {
        await this.apiClient.reportDeployment(
          credential,
          pack.revision,
          "out_of_date",
        ).catch(() => undefined);
        return this.getSnapshot();
      }
      this.stateStore.setApplied(pack.revision);
      await this.apiClient.reportDeployment(
        credential,
        pack.revision,
        "current",
      ).catch(() => undefined);
      this.#log("info", "Teams Pack reconciled", {
        revision: pack.revision,
        itemCount: pack.items.length,
      });
      return this.getSnapshot();
    } catch (error) {
      if (this.#leaveQueued || syncController.signal.aborted) return this.getSnapshot();
      const reason = error instanceof Error ? error.message.slice(0, 200) : "sync_failed";
      this.stateStore.setError(reason);
      this.#log("warn", "Teams sync failed", { reason });
      throw error;
    } finally {
      if (this.#syncSession === syncController) this.#syncSession = null;
      if (this.#started) this.#schedule();
    }
  }
  private async stage(
    item: TeamPackItem,
    credential: string,
    signal: AbortSignal,
  ): Promise<StagedTeamArtifact> {
    const bytes = await this.apiClient.downloadArtifact(
      credential,
      item.versionId,
      item.size,
      item.sha256,
      signal,
    );
    if (signal.aborted || this.#leaveQueued) throw new Error("Teams sync was cancelled.");
    return stageTeamArtifact(this.#userDataPath, item, bytes);
  }

  #requireCurrentTeamPlugin(id: string, teamState: TeamEnrollmentState): PluginStateRecord {
    const record = this.#pluginService.stateStore.getRecord(id);
    const desiredItem = teamState.desiredPack?.items.find(
      (item) => item.type === "plugin" && item.id === id,
    );
    const expectedInstallPath = join(this.#userDataPath, "team-plugins", id);
    if (
      !record
      || record.source !== "team"
      || !record.teamOwnership
      || record.teamOwnership.organizationId !== teamState.organizationId
      || !desiredItem
      || record.teamPolicy !== desiredItem.policy
      || record.teamOwnership.itemId !== desiredItem.itemId
      || record.teamOwnership.artifactVersionId !== desiredItem.versionId
      || record.teamOwnership.releaseId !== desiredItem.releaseId
      || record.version !== desiredItem.version
      || resolve(record.installPath) !== resolve(expectedInstallPath)
      || resolve(record.manifestPath) !== resolve(
        join(expectedInstallPath, "openpets.plugin.json"),
      )
    ) throw new Error("Team plugin action is unavailable.");
    return record;
  }

  private async apply(
    item: TeamPackItem,
    staged: StagedTeamArtifact,
    organizationId: string,
    signal: AbortSignal,
  ): Promise<{ readonly pendingApproval?: boolean } | void> {
    if (signal.aborted || this.#leaveQueued) throw new Error("Teams sync was cancelled.");
    let activation: ActivatedTeamArtifact | null = null;
    let previousRecord: PluginStateRecord | undefined;
    let replacementCommitted = false;
    let previousRuntimeStopped = false;
    let previousPet: InstalledPetState | undefined;
    let petStateChanged = false;
    try {
      if (item.type === "pet") {
        const existing = this.#petState.snapshot().pets.installed.find(
          (pet) => pet.id === item.id,
        );
        previousPet = existing;
        if (existing && existing.source?.kind !== "team") {
          throw new Error(`A personal pet already uses this id: ${item.id}`);
        }
        activation = await activateTeamArtifact(this.#userDataPath, staged);
        if (signal.aborted || this.#leaveQueued) throw new Error("Teams sync was cancelled.");
        const ownership: TeamPetOwnership = {
          kind: "team",
          organizationId,
          itemId: item.itemId,
          artifactVersionId: item.versionId,
          releaseId: item.releaseId,
        };
        this.#petState.install({
          id: item.id,
          displayName: staged.petMetadata!.displayName,
          description: staged.petMetadata!.description,
          source: ownership,
        });
        petStateChanged = true;
        await activation.commit();
        return;
      }
      const manifest = staged.manifest!;
      const existing = this.#pluginService.stateStore.getRecord(item.id);
      previousRecord = existing;
      if (existing?.source !== undefined && existing.source !== "team") {
        throw new Error(`A personal plugin already uses this id: ${item.id}`);
      }
      const previousApprovals = existing?.approvedPermissions ?? [];
      const previousHosts = existing?.approvedNetworkHosts ?? [];
      const networkHosts = "network" in manifest ? manifest.network?.hosts ?? [] : [];
      const policy = resolveTeamPluginPolicy(
        item.policy!,
        existing?.teamPendingApproval?.previousEnabled ?? existing?.enabled,
        manifest.permissions,
        previousApprovals,
        networkHosts,
        previousHosts,
      );
      const config = validatePluginConfigReplacement(manifest, item.config ?? {});
      if (!config.ok) throw new Error("Team plugin configuration is invalid.");
      if (policy.permissionBlocked && existing?.enabled) {
        this.#pluginService.stateStore.setEnabled(item.id, false);
        previousRuntimeStopped = true;
        await this.#pluginService.runtime.reloadPlugin(item.id);
      }
      const ownership: TeamPluginOwnership = {
        organizationId,
        itemId: item.itemId,
        artifactVersionId: item.versionId,
        releaseId: item.releaseId,
      };
      activation = await activateTeamArtifact(this.#userDataPath, staged);
      if (signal.aborted || this.#leaveQueued) throw new Error("Teams sync was cancelled.");
      const nextRecord = {
        id: item.id,
        version: item.version,
        source: "team" as const,
        teamOwnership: ownership,
        teamPolicy: item.policy,
        installPath: activation.target,
        manifestPath: join(activation.target, "openpets.plugin.json"),
        manifestVersion: manifest.manifestVersion,
        runtime: manifest.runtime,
        sdkVersion: "sdkVersion" in manifest ? manifest.sdkVersion : undefined,
        enabled: policy.enabled,
        approvedPermissions: manifest.permissions.filter(
          (permission) => previousApprovals.includes(permission),
        ),
        approvedNetworkHosts: networkHosts.filter((host) => previousHosts.includes(host)),
        teamPendingApproval: policy.permissionBlocked
          ? {
              permissions: manifest.permissions,
              networkHosts,
              previousEnabled: existing?.teamPendingApproval?.previousEnabled ?? existing?.enabled,
            }
          : undefined,
        teamApprovalToken: policy.permissionBlocked
          ? randomBytes(32).toString("base64url")
          : undefined,
        config: config.config,
      };
      this.#pluginService.stateStore.upsertRecord(nextRecord);
      replacementCommitted = true;
      await this.#pluginService.runtime.reloadPlugin(item.id);
      const reloaded = this.#pluginService.stateStore.getRecord(item.id);
      if (reloaded?.brokenReason) {
        throw new Error("Team plugin failed to reload after Team Pack activation.");
      }
      await activation.commit();
      return policy.permissionBlocked ? { pendingApproval: true } : undefined;
    } catch (error) {
      await activation?.rollback().catch(() => undefined);
      if (petStateChanged) {
        if (previousPet?.source?.kind === "team") {
          this.#petState.upsert({
            id: previousPet.id,
            displayName: previousPet.displayName,
            description: previousPet.description,
            source: previousPet.source,
            broken: previousPet.broken,
            brokenReason: previousPet.brokenReason,
          });
        } else {
          this.#petState.remove({
            kind: "team",
            organizationId,
            itemId: item.itemId,
            artifactVersionId: item.versionId,
            releaseId: item.releaseId,
          });
        }
      }
      if (replacementCommitted || previousRuntimeStopped) {
        if (previousRecord) this.#pluginService.stateStore.upsertRecord(previousRecord);
        else this.#pluginService.stateStore.removeRecord(item.id);
        await this.#pluginService.runtime.reloadPlugin(item.id).catch(() => undefined);
      }
      await discardStagedTeamArtifact(staged).catch(() => undefined);
      throw error;
    }
  }
  private async remove(item: TeamOwnedItem, organizationId: string): Promise<void> {
    if (item.organizationId !== organizationId) return;
    if (item.type === "pet") {
      await removeTeamArtifact(this.#userDataPath, "pet", item.id);
      this.#petState.remove({
        kind: "team",
        organizationId,
        itemId: item.itemId,
        artifactVersionId: item.artifactVersionId,
        releaseId: item.releaseId,
      });
      return;
    }
    const record = this.#pluginService.stateStore.getRecord(item.id);
    if (
      !record
      || record.source !== "team"
      || !sameTeamOwnership(record.teamOwnership, item)
    ) return;
    this.#pluginService.stateStore.setEnabled(item.id, false);
    await this.#pluginService.runtime.reloadPlugin(item.id);
    await Promise.all([
      removeTeamArtifact(this.#userDataPath, "plugin", item.id),
      fs.rm(join(this.#userDataPath, "plugin-user-sounds", item.id), {
        recursive: true,
        force: true,
      }),
      fs.rm(join(this.#userDataPath, "plugin-storage", `${item.id}.json`), {
        force: true,
      }),
    ]);
    this.#pluginService.stateStore.removeRecord(item.id);
  }
  private currentItems(organizationId: string): TeamOwnedItem[] {
    const pets = this.#petState.snapshot().pets.installed.flatMap((pet) => {
      const source = pet.source;
      return source?.kind === "team" && source.organizationId === organizationId
        ? [{
            type: "pet" as const,
            id: pet.id,
            source: "team" as const,
            organizationId,
            itemId: source.itemId,
            artifactVersionId: source.artifactVersionId,
            releaseId: source.releaseId,
            version: "0.0.0",
          }]
        : [];
    });
    const plugins = this.#pluginService.stateStore.listRecords().flatMap((record) => {
      const ownership = record.teamOwnership;
      return record.source === "team" && ownership?.organizationId === organizationId
        ? [{
            type: "plugin" as const,
            id: record.id,
            source: "team" as const,
            organizationId,
            itemId: ownership.itemId,
            artifactVersionId: ownership.artifactVersionId,
            releaseId: ownership.releaseId,
            version: record.version,
            enabled: record.enabled,
            policy: record.teamPolicy,
            config: record.config,
            pendingApproval: Boolean(record.teamPendingApproval),
          }]
        : [];
    });
    return [...pets, ...plugins];
  }

  private async cleanupTeamContent(): Promise<void> {
    const state = this.stateStore.snapshot();
    if (!state?.organizationId) return;
    let failure: unknown;
    for (const item of this.currentItems(state.organizationId)) {
      try {
        await this.remove(item, state.organizationId);
      } catch (error) {
        failure ??= error;
        this.#log("warn", "Teams local cleanup item failed", {
          itemId: item.itemId,
          reason: error instanceof Error
            ? error.message.slice(0, 160)
            : "cleanup_failed",
        });
      }
    }
    if (failure) throw failure;
    await Promise.all([
      fs.rm(join(this.#userDataPath, "team-pets"), {
        recursive: true,
        force: true,
      }),
      fs.rm(join(this.#userDataPath, "team-plugins"), {
        recursive: true,
        force: true,
      }),
    ]);
  }

  #schedule(): void {
    if (
      !this.#started
      || this.#leaveQueued
      || !this.stateStore.snapshot()?.organizationId
    ) return;
    if (this.#timer) clearTimeout(this.#timer);
    const jitter = Math.floor(this.#pollMs * (0.8 + Math.random() * 0.4));
    this.#timer = setTimeout(() => {
      void this.syncNow().catch(() => undefined);
    }, jitter);
    this.#timer.unref?.();
  }

  #abortEnrollment(): void {
    const session = this.#enrollmentSession;
    if (!session) return;
    session.proof = "";
    session.controller.abort();
  }

  #notifyEnrollmentPreviewChange(): void {
    const snapshot = this.getSnapshot();
    for (const listener of [...this.#enrollmentPreviewListeners]) {
      try {
        listener(snapshot);
      } catch (error) {
        this.#log("warn", "Teams enrollment preview listener failed", {
          reason: error instanceof Error ? error.message.slice(0, 160) : "listener_failed",
        });
      }
    }
  }

  async #refreshEnrollmentPreview(intentId: string): Promise<TeamEnrollmentPreview> {
    this.#enrollmentPreview = null;
    const preview = await this.apiClient.getEnrollmentPreview(intentId);
    const pending = this.stateStore.snapshot()?.pendingIntent;
    if (pending?.intentId === intentId) this.#enrollmentPreview = preview;
    return preview;
  }

  #hasPendingApprovals(organizationId: string): boolean {
    return this.#pluginService.stateStore.listRecords().some(
      (record) => record.source === "team"
        && record.teamOwnership?.organizationId === organizationId
        && record.teamPendingApproval !== undefined,
    );
  }

  #enqueueOperation<T>(task: () => Promise<T>): Promise<T> {
    return this.#operationQueue.run(task);
  }
}

function isUnavailableEnrollmentPreviewError(error: unknown): boolean {
  return error instanceof TeamApiError && (error.status === 401 || error.status === 404);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameTeamOwnership(record: TeamPluginOwnership | undefined, item: TeamOwnedItem): boolean {
  return record?.organizationId === item.organizationId
    && record.itemId === item.itemId
    && record.artifactVersionId === item.artifactVersionId
    && record.releaseId === item.releaseId;
}

function createDefaultPetStateAdapter(): TeamPetStateAdapter {
  const appState = nodeRequire("./app-state.js") as typeof import("./app-state.js");
  return {
    snapshot: appState.getAppStateSnapshot,
    install: appState.installTeamPetState,
    remove: appState.removeTeamPetState,
    upsert: appState.upsertPetState,
  };
}

export function initializeTeamService(options: TeamServiceOptions): TeamService {
  appTeamService = new TeamService(options);
  return appTeamService;
}

export function getTeamService(): TeamService {
  if (!appTeamService) throw new Error("Teams service has not been initialized.");
  return appTeamService;
}

export function queueTeamEnrollmentLink(value: unknown): boolean {
  return appTeamService?.handleDeepLink(value) ?? false;
}

export function stopTeamService(): Promise<void> {
  return appTeamService?.stop() ?? Promise.resolve();
}
