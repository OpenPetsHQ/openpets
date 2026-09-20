import { createStaleLeaseStatus, type LeaseSnapshot } from "./lease-manager.js";
import { errorResponse, IpcProtocolError, isRecord, maxMediaFileBytes, okResponse, parseIpcRequest, validateInstallLocalKind, validateInstallLocalPath, validateInstallPetId, validateMediaClickUrl, validateMediaDurationMs, validateMediaPath, validateOptionalLeaseId, validateReaction, validateRequestedPetId, validateSayMessage, validateSessionNonce, type OpenPetsIpcRequest, type OpenPetsReaction, type OpenPetsIpcResponse } from "./local-ipc-protocol.js";

export interface LocalIpcPet {
  readonly id: string;
  readonly displayName: string;
  readonly builtIn: boolean;
  readonly broken?: boolean;
}

export interface LocalIpcStateSnapshot {
  readonly preferences: {
    readonly defaultPetId: string;
    readonly openDefaultPetOnLaunch: boolean;
    readonly speechBubblesEnabled: boolean;
  };
  readonly pets: {
    readonly installed: readonly LocalIpcPet[];
  };
}

export interface LocalIpcInstallResult {
  readonly state: LocalIpcStateSnapshot;
  readonly petId: string;
}

export interface LocalIpcMediaOptions {
  readonly mediaPath: string;
  readonly message?: string;
  readonly reaction?: OpenPetsReaction;
  readonly durationMs?: number;
  readonly clickUrl?: string;
}

export interface LocalIpcAppliedEffect {
  readonly shown: boolean;
  readonly reason?: string;
}

export type LocalIpcActivity =
  | { readonly kind: "say"; readonly reaction?: OpenPetsReaction; readonly petId?: string; readonly surface?: "default" | "agent" }
  | { readonly kind: "react"; readonly reaction: OpenPetsReaction; readonly petId?: string; readonly surface?: "default" | "agent" };

export interface LocalIpcRequestHandlerDeps {
  readonly getAppVersion: () => string;
  readonly getAppStateSnapshot: () => LocalIpcStateSnapshot;
  readonly builtInPet: LocalIpcPet;
  readonly getDefaultPetPaused: () => boolean;
  readonly isDefaultPetVisible: () => boolean;
  readonly installPet: (petId: string) => Promise<LocalIpcStateSnapshot>;
  readonly installPetFromFolderWithResult: (path: string) => Promise<LocalIpcInstallResult>;
  readonly installPetFromZipFileWithResult: (path: string) => Promise<LocalIpcInstallResult>;
  readonly stat: (path: string) => Promise<LocalIpcFileStat>;
  readonly acquireLease: (requestedPetId: string | undefined, clientPid: number | undefined, sessionNonce: string | undefined) => LeaseSnapshot;
  readonly getLease: (leaseId: string) => LeaseSnapshot | null;
  readonly heartbeatLease: (leaseId: string) => { readonly leaseId: string; readonly expiresAt: number };
  readonly releaseLease: (leaseId: string) => { readonly released: boolean };
  readonly onLeaseAcquired: (requestedPetId: string | undefined, lease: LeaseSnapshot, clientPid: number | undefined) => void;
  readonly applyAgentPetReaction: (petId: string, reaction: OpenPetsReaction) => LocalIpcAppliedEffect;
  readonly applyAgentPetSay: (petId: string, message: string, reaction?: OpenPetsReaction) => LocalIpcAppliedEffect;
  readonly applyAgentPetShowMedia: (petId: string, options: LocalIpcMediaOptions) => LocalIpcAppliedEffect;
  readonly applyExternalPetReaction: (reaction: OpenPetsReaction) => LocalIpcAppliedEffect;
  readonly applyExternalPetSay: (message: string, reaction?: OpenPetsReaction) => LocalIpcAppliedEffect;
  readonly applyExternalPetShowMedia: (options: LocalIpcMediaOptions) => LocalIpcAppliedEffect;
  readonly broadcastLanPetActivity: (reaction: OpenPetsReaction) => void;
  readonly recordOpenPetsActivity: (activity: LocalIpcActivity) => void;
  readonly debug: (message: string, fields?: Record<string, unknown>) => void;
  readonly logError: (error: unknown, requestId: string | null) => void;
}

export interface LocalIpcFileStat {
  readonly size: number;
  readonly isDirectory: () => boolean;
  readonly isFile: () => boolean;
}

export type LocalIpcRequestHandler = (raw: string, token: string) => Promise<OpenPetsIpcResponse>;

export function createLocalIpcRequestHandler(deps: LocalIpcRequestHandlerDeps): LocalIpcRequestHandler {
  return async function handleRawRequest(raw: string, token: string): Promise<OpenPetsIpcResponse> {
    let requestId: string | null = null;
    try {
      const request = parseIpcRequest(raw, token);
      requestId = request.id;
      deps.debug("request received", { requestId, method: request.method });
      return okResponse(request.id, await handleRequest(request, deps));
    } catch (error) {
      deps.logError(error, requestId);
      return errorResponse(requestId, error);
    }
  };
}

async function handleRequest(request: OpenPetsIpcRequest, deps: LocalIpcRequestHandlerDeps): Promise<unknown> {
  if (request.method === "hello") {
    return {
      ok: true,
      protocol: "openpets-ipc",
      protocolVersion: 1,
      appVersion: deps.getAppVersion(),
    };
  }

  if (request.method === "status") {
    const params = isRecord(request.params) ? request.params : {};
    const leaseId = validateOptionalLeaseId(params.leaseId);
    if (leaseId) {
      const lease = deps.getLease(leaseId);
      if (!lease) return createStaleLeaseStatus(leaseId);
      return { ok: true, appRunning: true, ...lease };
    }

    const state = deps.getAppStateSnapshot();
    const defaultPet = state.pets.installed.find((pet) => pet.id === state.preferences.defaultPetId) ?? deps.builtInPet;
    return {
      ok: true,
      appRunning: true,
      protocolVersion: 1,
      appVersion: deps.getAppVersion(),
      defaultPet: {
        id: defaultPet.id,
        displayName: defaultPet.displayName,
        builtIn: defaultPet.builtIn,
        broken: "broken" in defaultPet && defaultPet.broken === true,
      },
      paused: deps.getDefaultPetPaused(),
      defaultPetVisible: deps.isDefaultPetVisible(),
      openDefaultPetOnLaunch: state.preferences.openDefaultPetOnLaunch,
      speechBubblesEnabled: state.preferences.speechBubblesEnabled,
    };
  }

  if (request.method === "pets.list") {
    const state = deps.getAppStateSnapshot();
    return {
      ok: true,
      pets: state.pets.installed.map((pet) => ({
        id: pet.id,
        displayName: pet.displayName,
        builtIn: pet.builtIn,
        broken: pet.broken === true,
      })),
      defaultPetId: state.preferences.defaultPetId,
    };
  }

  if (request.method === "pets.install") {
    const params = isRecord(request.params) ? request.params : {};
    const petId = validateInstallPetId(params.petId);
    const state = await deps.installPet(petId);
    const installed = state.pets.installed.find((pet) => pet.id === petId);
    if (!installed) throw new IpcProtocolError("install_failed", "Pet install did not complete.");
    return { ok: true, petId: installed.id, displayName: installed.displayName, installed: true };
  }

  if (request.method === "pets.install-local") {
    const params = isRecord(request.params) ? request.params : {};
    const localPath = validateInstallLocalPath(params.path);
    const kind = validateInstallLocalKind(params.kind);
    const stats = await deps.stat(localPath);
    let installResult: LocalIpcInstallResult;
    if (kind === "folder") {
      if (!stats.isDirectory()) throw new IpcProtocolError("invalid_params", "Local pet path must be a folder.");
      installResult = await deps.installPetFromFolderWithResult(localPath);
    } else {
      if (!stats.isFile()) throw new IpcProtocolError("invalid_params", "Local pet path must be a zip file.");
      installResult = await deps.installPetFromZipFileWithResult(localPath);
    }
    const installedPet = installResult.state.pets.installed.find((pet) => pet.id === installResult.petId);
    if (!installedPet) throw new IpcProtocolError("install_failed", "Local pet install did not complete.");
    return { ok: true, petId: installedPet.id, displayName: installedPet.displayName, installed: true };
  }

  if (request.method === "lease.acquire") {
    const params = isRecord(request.params) ? request.params : {};
    const requestedPetId = validateRequestedPetId(params.requestedPetId);
    const clientPid = typeof params.clientPid === "number" && params.clientPid > 0 ? params.clientPid : undefined;
    const sessionNonce = validateSessionNonce(params.sessionNonce);
    deps.debug("lease acquire requested", { requestId: request.id, requestedPetId, clientPid, sessionNonce });
    const lease = deps.acquireLease(requestedPetId, clientPid, sessionNonce);
    deps.onLeaseAcquired(requestedPetId, lease, clientPid);
    return lease;
  }

  if (request.method === "lease.heartbeat") {
    const params = isRecord(request.params) ? request.params : {};
    const leaseId = validateRequiredLeaseId(params.leaseId);
    deps.debug("lease heartbeat requested", { requestId: request.id, leaseId });
    try {
      return deps.heartbeatLease(leaseId);
    } catch {
      throw new IpcProtocolError("unknown_lease", "Unknown or expired lease.");
    }
  }

  if (request.method === "lease.release") {
    const params = isRecord(request.params) ? request.params : {};
    const leaseId = validateRequiredLeaseId(params.leaseId);
    deps.debug("lease release requested", { requestId: request.id, leaseId });
    return deps.releaseLease(leaseId);
  }

  if (request.method === "pet.react") {
    const params = isRecord(request.params) ? request.params : {};
    const reaction = validateReaction(params.reaction);
    const lease = getLeaseTarget(params.leaseId, deps);
    const petId = lease?.actualTargetPetId ?? getCurrentDefaultPet(deps).id;
    deps.debug("pet react requested", { requestId: request.id, reaction, leaseId: lease?.leaseId, targetKind: lease?.targetKind, actualPetId: lease?.actualTargetPetId });
    if (lease?.targetKind === "explicit") {
      const applied = deps.applyAgentPetReaction(lease.actualTargetPetId, reaction);
      safeRecordOpenPetsActivity(deps, { kind: "react", reaction, petId, surface: "agent" });
      return { ok: true, reaction, shown: applied.shown, reason: applied.reason, leaseId: lease.leaseId };
    }
    const applied = deps.applyExternalPetReaction(reaction);
    deps.broadcastLanPetActivity(reaction);
    safeRecordOpenPetsActivity(deps, { kind: "react", reaction, petId, surface: "default" });
    return { ok: true, reaction, shown: applied.shown, reason: applied.reason };
  }

  if (request.method === "pet.showMedia") {
    const params = isRecord(request.params) ? request.params : {};
    const mediaPath = validateMediaPath(params.path);
    const message = params.message === undefined ? undefined : validateSayMessage(params.message);
    const reaction = params.reaction === undefined ? undefined : validateReaction(params.reaction);
    const durationMs = validateMediaDurationMs(params.durationMs);
    const clickUrl = validateMediaClickUrl(params.clickUrl);
    let mediaStat: LocalIpcFileStat;
    try {
      mediaStat = await deps.stat(mediaPath);
    } catch {
      throw new IpcProtocolError("invalid_params", "Media path does not exist or is not readable.");
    }
    if (!mediaStat.isFile()) throw new IpcProtocolError("invalid_params", "Media path is not a file.");
    if (mediaStat.size > maxMediaFileBytes) throw new IpcProtocolError("invalid_params", "Media file is too large.");
    const lease = getLeaseTarget(params.leaseId, deps);
    const petId = lease?.actualTargetPetId ?? getCurrentDefaultPet(deps).id;
    deps.debug("pet showMedia requested", { requestId: request.id, reaction, mediaBytes: mediaStat.size, durationMs, leaseId: lease?.leaseId, targetKind: lease?.targetKind, actualPetId: lease?.actualTargetPetId });
    const options = { mediaPath, message, reaction, durationMs, clickUrl };
    if (lease?.targetKind === "explicit") {
      const applied = deps.applyAgentPetShowMedia(lease.actualTargetPetId, options);
      safeRecordOpenPetsActivity(deps, { kind: "say", reaction, petId, surface: "agent" });
      return { ok: true, shown: applied.shown, reason: applied.reason, reaction, leaseId: lease.leaseId };
    }
    const applied = deps.applyExternalPetShowMedia(options);
    safeRecordOpenPetsActivity(deps, { kind: "say", reaction, petId, surface: "default" });
    return { ok: true, shown: applied.shown, reason: applied.reason, reaction };
  }

  const params = isRecord(request.params) ? request.params : {};
  const message = validateSayMessage(params.message);
  const reaction = params.reaction === undefined ? undefined : validateReaction(params.reaction);
  const lease = getLeaseTarget(params.leaseId, deps);
  const petId = lease?.actualTargetPetId ?? getCurrentDefaultPet(deps).id;
  deps.debug("pet say requested", { requestId: request.id, reaction, messageLength: message.length, leaseId: lease?.leaseId, targetKind: lease?.targetKind, actualPetId: lease?.actualTargetPetId });
  if (lease?.targetKind === "explicit") {
    const applied = deps.applyAgentPetSay(lease.actualTargetPetId, message, reaction);
    safeRecordOpenPetsActivity(deps, { kind: "say", reaction, petId, surface: "agent" });
    return { ok: true, shown: applied.shown, reason: applied.reason, reaction, leaseId: lease.leaseId };
  }
  const applied = deps.applyExternalPetSay(message, reaction);
  safeRecordOpenPetsActivity(deps, { kind: "say", reaction, petId, surface: "default" });
  return { ok: true, shown: applied.shown, reason: applied.reason, reaction };
}

function safeRecordOpenPetsActivity(deps: LocalIpcRequestHandlerDeps, activity: LocalIpcActivity): void {
  try {
    deps.recordOpenPetsActivity(activity);
  } catch (error) {
    deps.debug("activity record failed", { error: error instanceof Error ? error.message : String(error), kind: activity.kind, reaction: activity.reaction, petId: activity.petId });
  }
}

function validateRequiredLeaseId(value: unknown): string {
  const leaseId = validateOptionalLeaseId(value);
  if (!leaseId) throw new IpcProtocolError("invalid_params", "Lease id is required.");
  return leaseId;
}

function getLeaseTarget(value: unknown, deps: LocalIpcRequestHandlerDeps): LeaseSnapshot | null {
  const leaseId = validateOptionalLeaseId(value);
  if (!leaseId) return null;
  const lease = deps.getLease(leaseId);
  if (!lease) throw new IpcProtocolError("unknown_lease", "Unknown or expired lease.");
  return lease;
}

function getCurrentDefaultPet(deps: LocalIpcRequestHandlerDeps): LocalIpcPet {
  const state = deps.getAppStateSnapshot();
  return state.pets.installed.find((pet) => pet.id === state.preferences.defaultPetId && !pet.broken) ?? deps.builtInPet;
}
