import { randomUUID } from "node:crypto";

export type LeaseTargetKind = "default" | "explicit";
export type LeaseFallbackReason = "invalid_pet_id" | "pet_not_installed" | "pet_broken" | "default_broken_fallback_builtin";

export interface PetLease {
  readonly leaseId: string;
  readonly requestedPetId?: string;
  readonly targetKind: LeaseTargetKind;
  readonly actualPetId: string;
  readonly fallbackReason?: LeaseFallbackReason;
  readonly acquiredAt: number;
  readonly lastHeartbeatAt: number;
  readonly expiresAt: number;
  /** PID of the MCP client process (e.g. opencode) that acquired this lease. */
  readonly clientPid?: number;
  /**
   * Stable per-process UUID generated once at MCP startup (not per-call).
   * Used alongside clientPid to prevent OS PID-reuse collisions: a recycled
   * PID will carry a different nonce, preventing stale-lease reuse.
   */
  readonly sessionNonce?: string;
  /** PID of the terminal emulator process hosting the client (resolved async). */
  readonly terminalOwnerPid?: number;
  /** Human-readable terminal app name, e.g. "Ghostty" or "Terminal". */
  readonly terminalAppName?: string;
  /** Numeric window ID from CGWindowList for the terminal window. */
  readonly terminalWindowId?: number;
}

export interface LeaseSnapshot {
  readonly leaseId: string;
  readonly requestedPetId?: string;
  readonly targetKind: LeaseTargetKind;
  readonly actualTargetPetId: string;
  readonly actualTargetPetName: string;
  readonly usingDefaultPet: boolean;
  readonly fallbackReason?: LeaseFallbackReason;
  readonly expiresAt: number;
  readonly leaseActive: boolean;
  /** PID of the MCP client that acquired this lease. */
  readonly clientPid?: number;
  /** PID of the terminal emulator hosting the client (may be set async). */
  readonly terminalOwnerPid?: number;
  /** Terminal app name, e.g. "Ghostty". */
  readonly terminalAppName?: string;
}

export interface LeaseManagerOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly resolveTarget?: (requestedPetId: string | undefined) => { readonly targetKind: LeaseTargetKind; readonly actualPetId: string; readonly fallbackReason?: LeaseFallbackReason };
  readonly getDefaultPetId?: () => string;
  readonly getPetDisplayName?: (petId: string, targetKind: LeaseTargetKind) => string;
  readonly onFirstExplicitLease?: (petId: string) => void;
  readonly onLastExplicitLease?: (petId: string) => void;
  readonly onLeaseReleased?: (lease: PetLease) => void;
  readonly onLog?: (level: "debug" | "info", message: string, fields?: Record<string, unknown>) => void;
  /**
   * Optional seam to re-validate that an explicit target pet is still
   * serviceable at re-acquire time (Fix L1). If provided and returns false for
   * an explicit target during lease reuse, the old lease is released and a
   * fresh acquire (with full re-resolution) is performed instead.
   * Default leases are NOT re-validated — a session that landed on default
   * (e.g. pool exhausted) stays on default across re-acquires by design.
   */
  readonly isPetEligible?: (petId: string) => boolean;
}

const safePetIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class LeaseManager {
  readonly #leases = new Map<string, PetLease>();
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #resolveTarget: (requestedPetId: string | undefined) => { readonly targetKind: LeaseTargetKind; readonly actualPetId: string; readonly fallbackReason?: LeaseFallbackReason };
  readonly #getDefaultPetId: () => string;
  readonly #getPetDisplayName: (petId: string, targetKind: LeaseTargetKind) => string;
  readonly #onFirstExplicitLease: (petId: string) => void;
  readonly #onLastExplicitLease: (petId: string) => void;
  readonly #onLeaseReleased: (lease: PetLease) => void;
  readonly #onLog: (level: "debug" | "info", message: string, fields?: Record<string, unknown>) => void;
  readonly #isPetEligible: ((petId: string) => boolean) | undefined;

  constructor(options: LeaseManagerOptions = {}) {
    this.#ttlMs = options.ttlMs ?? 15_000;
    this.#now = options.now ?? Date.now;
    this.#resolveTarget = options.resolveTarget ?? (() => { throw new Error("Lease target resolver is not configured."); });
    this.#getDefaultPetId = options.getDefaultPetId ?? (() => { throw new Error("Default pet resolver is not configured."); });
    this.#getPetDisplayName = options.getPetDisplayName ?? ((petId) => petId);
    this.#onFirstExplicitLease = options.onFirstExplicitLease ?? (() => {});
    this.#onLastExplicitLease = options.onLastExplicitLease ?? (() => {});
    this.#onLeaseReleased = options.onLeaseReleased ?? (() => {});
    this.#onLog = options.onLog ?? (() => {});
    this.#isPetEligible = options.isPetEligible;
  }

  acquire(requestedPetId?: string, clientPid?: number, sessionNonce?: string): LeaseSnapshot {
    const now = this.#now();

    // Expired leases must be removed before resolving a fresh target so they
    // cannot continue occupying a pool slot, regardless of client identity.
    for (const existing of [...this.#leases.values()]) {
      if (existing.expiresAt <= now) this.release(existing.leaseId);
    }

    // FIX M1 + FIX 1: Idempotent per-clientPid lease reuse, guarded by sessionNonce.
    // sessionNonce is a stable per-process UUID generated once at MCP startup.
    // Requiring a matching nonce prevents OS PID-reuse collisions: a recycled PID
    // will carry a different nonce so it never collapses onto a stale lease.
    // If sessionNonce is absent → always fall through to a fresh acquire.
    // This scan MUST be synchronous and placed before any await to preserve the
    // no-await-between-resolve-and-set invariant.
    if (clientPid !== undefined && clientPid > 0 && sessionNonce !== undefined) {
      for (const existing of this.#leases.values()) {
        if (existing.clientPid !== clientPid) continue;
        if (existing.sessionNonce !== sessionNonce) continue; // different process — no reuse
        // For explicit --pet requests, only reuse when the stored requestedPetId
        // matches the incoming requestedPetId; otherwise release old and acquire fresh.
        if (existing.requestedPetId !== requestedPetId) {
          this.release(existing.leaseId);
          break; // fall through to fresh acquire below
        }
        // FIX L1: Re-validate that the explicit target pet is still serviceable.
        // Default leases are intentionally skipped — a session that landed on
        // default (e.g. pool exhausted) stays on default across re-acquires by design.
        if (existing.targetKind === "explicit" && this.#isPetEligible !== undefined && !this.#isPetEligible(existing.actualPetId)) {
          this.#onLog("info", "acquire reuse rejected — target pet no longer eligible", { leaseId: existing.leaseId, actualPetId: existing.actualPetId });
          this.release(existing.leaseId);
          break; // fall through to fresh acquire
        }
        // Same clientPid + nonce + requestedPetId, lease still valid — refresh and return.
        const refreshed: PetLease = { ...existing, lastHeartbeatAt: now, expiresAt: now + this.#ttlMs };
        this.#leases.set(refreshed.leaseId, refreshed);
        this.#onLog("debug", "acquire reused existing lease", { leaseId: refreshed.leaseId, clientPid, sessionNonce, requestedPetId, targetKind: refreshed.targetKind, actualPetId: refreshed.actualPetId, expiresAt: refreshed.expiresAt });
        return this.snapshot(refreshed);
      }
    }

    // INVARIANT: resolveTarget (which may call resolvePoolAssignment) and the
    // Map.set below MUST remain synchronous with no await between them.
    // Two concurrent acquire(undefined) calls could otherwise be assigned the
    // same pool slot before either is registered.
    const target = this.#resolveTarget(requestedPetId);
    const lease: PetLease = {
      leaseId: randomUUID(),
      requestedPetId,
      targetKind: target.targetKind,
      actualPetId: target.actualPetId,
      fallbackReason: target.fallbackReason,
      acquiredAt: now,
      lastHeartbeatAt: now,
      expiresAt: now + this.#ttlMs,
      clientPid,
      sessionNonce,
    };

    const hadExplicitLease = lease.targetKind === "explicit" && this.countExplicitLeases(lease.actualPetId) > 0;
    this.#leases.set(lease.leaseId, lease);
    this.#onLog("info", "acquired", { leaseId: lease.leaseId, requestedPetId, targetKind: lease.targetKind, actualPetId: lease.actualPetId, fallbackReason: lease.fallbackReason, clientPid, explicitLeaseCount: lease.targetKind === "explicit" ? this.countExplicitLeases(lease.actualPetId) : undefined, expiresAt: lease.expiresAt });
    if (lease.targetKind === "explicit" && !hadExplicitLease) this.#onFirstExplicitLease(lease.actualPetId);
    return this.snapshot(lease);
  }

  heartbeat(leaseId: string): { readonly leaseId: string; readonly expiresAt: number } {
    const lease = this.#leases.get(leaseId);
    if (!lease) throw new Error("unknown_lease");
    const now = this.#now();
    if (lease.expiresAt <= now) {
      this.#onLog("info", "heartbeat expired", { leaseId, actualPetId: lease.actualPetId, targetKind: lease.targetKind, expiresAt: lease.expiresAt, now });
      this.release(leaseId);
      throw new Error("unknown_lease");
    }
    const next: PetLease = { ...lease, lastHeartbeatAt: now, expiresAt: now + this.#ttlMs };
    this.#leases.set(leaseId, next);
    this.#onLog("debug", "heartbeat", { leaseId, targetKind: next.targetKind, actualPetId: next.actualPetId, expiresAt: next.expiresAt });
    return { leaseId, expiresAt: next.expiresAt };
  }

  release(leaseId: string): { readonly released: boolean } {
    const lease = this.#leases.get(leaseId);
    if (!lease) {
      this.#onLog("debug", "release skipped", { leaseId, reason: "unknown" });
      return { released: false };
    }
    this.#leases.delete(leaseId);
    const wasLastExplicitLease = lease.targetKind === "explicit" && this.countExplicitLeases(lease.actualPetId) === 0;
    this.#onLog("info", "released", { leaseId, targetKind: lease.targetKind, actualPetId: lease.actualPetId, remainingExplicitLeases: lease.targetKind === "explicit" ? this.countExplicitLeases(lease.actualPetId) : undefined });
    if (wasLastExplicitLease) {
      try {
        this.#onLastExplicitLease(lease.actualPetId);
      } catch (error) {
        try {
          this.#onLog("info", "last explicit lease callback failed", { leaseId, actualPetId: lease.actualPetId, error: error instanceof Error ? error.message : String(error) });
        } catch {
          // Lifecycle logging must not make release observable as a failure.
        }
      }
    }
    try {
      this.#onLeaseReleased(lease);
    } catch (error) {
      try {
        this.#onLog("info", "release callback failed", { leaseId, error: error instanceof Error ? error.message : String(error) });
      } catch {
        // Lifecycle logging must not make release observable as a failure.
      }
    }
    return { released: true };
  }

  get(leaseId: string): LeaseSnapshot | null {
    const lease = this.#leases.get(leaseId);
    if (lease && lease.expiresAt <= this.#now()) {
      this.release(leaseId);
      return null;
    }
    return lease ? this.snapshot(lease) : null;
  }

  cleanupExpired(): readonly LeaseSnapshot[] {
    const now = this.#now();
    const expired: LeaseSnapshot[] = [];
    for (const lease of [...this.#leases.values()]) {
      if (lease.expiresAt <= now) {
        expired.push(this.snapshot(lease));
        this.#onLog("info", "cleanup expired", { leaseId: lease.leaseId, targetKind: lease.targetKind, actualPetId: lease.actualPetId, expiresAt: lease.expiresAt, now });
        this.release(lease.leaseId);
      }
    }
    return expired;
  }

  /**
   * Check PID liveness for all leases that have a clientPid.
   * Releases leases whose client process has terminated.
   * Called from the cleanup loop (~every 5s).
   *
   * FIX 4: Also checks terminalOwnerPid when set — an orphaned-but-alive MCP
   * process (where clientPid is still running but the terminal that owns it has
   * died) would otherwise escape teardown. terminalOwnerPid is only resolved on
   * confinement-supported (macOS) platforms; Windows/Linux still rely on
   * clientPid + TTL.
   *
   * Uses process.kill(pid, 0) — throws ESRCH when process does not exist.
   * Only valid when clientPid is set (>0). Never throws; logs failures.
   */
  checkPidLiveness(): readonly LeaseSnapshot[] {
    const released: LeaseSnapshot[] = [];
    for (const lease of [...this.#leases.values()]) {
      if (!lease.clientPid || lease.clientPid <= 0) continue;

      // Determine which PID to check first. If terminalOwnerPid is resolved
      // (macOS confinement path), check the terminal process — a dead terminal
      // means the session is orphaned even if the MCP client PID still exists.
      const pidsToCheck: number[] = [];
      if (lease.terminalOwnerPid && lease.terminalOwnerPid > 0) {
        pidsToCheck.push(lease.terminalOwnerPid);
      }
      pidsToCheck.push(lease.clientPid);

      let shouldRelease = false;
      for (const pid of pidsToCheck) {
        try {
          process.kill(pid, 0);
          // Process is alive — continue to next PID check.
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ESRCH") {
            // Process does not exist — release lease.
            const pidRole = pid === lease.terminalOwnerPid ? "terminalOwnerPid" : "clientPid";
            this.#onLog("info", "pid dead — releasing lease", { leaseId: lease.leaseId, [pidRole]: pid, actualPetId: lease.actualPetId });
            shouldRelease = true;
          } else if (code === "EPERM") {
            // Process exists but we can't signal it — treat as alive.
            this.#onLog("debug", "pid liveness check EPERM — treating as alive", { leaseId: lease.leaseId, pid });
          }
          // Other errors: log and skip.
        }
        if (shouldRelease) break;
      }

      if (shouldRelease) {
        released.push(this.snapshot(lease));
        this.release(lease.leaseId);
      }
    }
    return released;
  }

  /** Return all current non-expired explicit leases as snapshots. Used by dispatchPoolToggle. */
  getExplicitLeaseSnapshots(): readonly LeaseSnapshot[] {
    const now = this.#now();
    const result: LeaseSnapshot[] = [];
    for (const lease of this.#leases.values()) {
      if (lease.targetKind === "explicit" && lease.expiresAt > now) {
        result.push(this.snapshot(lease));
      }
    }
    return result;
  }

  countExplicitLeases(petId: string): number {
    let count = 0;
    for (const lease of this.#leases.values()) {
      if (lease.targetKind === "explicit" && lease.actualPetId === petId) count += 1;
    }
    return count;
  }

  /**
   * Update the terminal window identity on an existing lease.
   * Called asynchronously after the PPID-walk resolves.
   */
  setTerminalIdentity(leaseId: string, info: { terminalOwnerPid: number; terminalAppName: string; terminalWindowId?: number }): void {
    const lease = this.#leases.get(leaseId);
    if (!lease) return;
    const updated: PetLease = { ...lease, ...info };
    this.#leases.set(leaseId, updated);
    this.#onLog("debug", "terminal identity set", { leaseId, terminalOwnerPid: info.terminalOwnerPid, terminalAppName: info.terminalAppName, terminalWindowId: info.terminalWindowId });
  }

  /** Return all active leases that have a resolved terminal PID (for confinement polling). */
  getConfinedLeases(): ReadonlyArray<PetLease & { terminalOwnerPid: number }> {
    const result: Array<PetLease & { terminalOwnerPid: number }> = [];
    for (const lease of this.#leases.values()) {
      if (lease.terminalOwnerPid !== undefined) result.push(lease as PetLease & { terminalOwnerPid: number });
    }
    return result;
  }

  /** Get the raw PetLease for a lease ID (returns null if not found/expired). */
  getRawLease(leaseId: string): PetLease | null {
    return this.#leases.get(leaseId) ?? null;
  }

  snapshot(lease: PetLease): LeaseSnapshot {
    const defaultPetId = this.#getDefaultPetId();
    const actualPetId = lease.targetKind === "default" ? defaultPetId : lease.actualPetId;
    const targetKind = lease.targetKind;
    return {
      leaseId: lease.leaseId,
      requestedPetId: lease.requestedPetId,
      targetKind,
      actualTargetPetId: actualPetId,
      actualTargetPetName: this.#getPetDisplayName(actualPetId, targetKind),
      usingDefaultPet: targetKind === "default",
      fallbackReason: lease.fallbackReason,
      expiresAt: lease.expiresAt,
      leaseActive: true,
      clientPid: lease.clientPid,
      terminalOwnerPid: lease.terminalOwnerPid,
      terminalAppName: lease.terminalAppName,
    };
  }
}

export function createStaleLeaseStatus(leaseId: string): { readonly ok: false; readonly appRunning: true; readonly leaseId: string; readonly leaseActive: false; readonly staleReason: "unknown_lease" } {
  return { ok: false, appRunning: true, leaseId, leaseActive: false, staleReason: "unknown_lease" };
}
