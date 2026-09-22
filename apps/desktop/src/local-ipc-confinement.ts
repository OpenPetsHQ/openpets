import { resolveAndSubscribe, type ConfinementPollerDeps } from "./confinement-poller.js";
import type { ConfinementState } from "./confinement-manager.js";
import type { PetLease } from "./lease-manager.js";
import type { TerminalWindowInfo } from "./window-tracker.js";

export interface LocalIpcConfinementCoordinatorDeps {
  readonly getRawLease: (leaseId: string) => PetLease | null;
  readonly findTerminalWindow: (clientPid: number) => Promise<TerminalWindowInfo | null>;
  readonly subscribeWindowTracking: ConfinementPollerDeps["subscribe"];
  readonly setTerminalIdentity: (leaseId: string, info: TerminalWindowInfo) => void;
  readonly setConfinementState: (petId: string, state: ConfinementState) => void;
  readonly repositionConfinedPet: (petId: string) => void;
  readonly clearConfinementState: (petId: string) => void;
  readonly getScreenPermissionStatus: () => string;
  readonly promptScreenPermission: () => void;
  readonly notifyScreenPermission: (leaseId: string, onAction: () => void) => void;
  readonly log: (message: string, fields: Record<string, unknown>) => void;
}

export interface LocalIpcConfinementCoordinator {
  readonly trackLease: (leaseId: string, clientPid: number) => Promise<void>;
  readonly stopLease: (leaseId: string) => void;
  readonly clearPetConfinement: (petId: string) => void;
}

export function createLocalIpcConfinementCoordinator(
  deps: LocalIpcConfinementCoordinatorDeps,
): LocalIpcConfinementCoordinator {
  const unsubscribers = new Map<string, () => void>();

  function stopLease(leaseId: string): void {
    const unsubscribe = unsubscribers.get(leaseId);
    if (!unsubscribe) return;
    try {
      unsubscribe();
    } finally {
      unsubscribers.delete(leaseId);
    }
  }

  async function trackLease(leaseId: string, clientPid: number): Promise<void> {
    // This lookup and pet-id capture must remain before the first await. The
    // raw lease is intentional: LeaseManager.get() can remove expired leases.
    const lease = deps.getRawLease(leaseId);
    if (!lease || lease.targetKind !== "explicit") return;
    const petId = lease.actualPetId;

    const pollerDeps: ConfinementPollerDeps = {
      findTerminal: async (pid) => {
        const terminalInfo = await deps.findTerminalWindow(pid);
        if (!terminalInfo) {
          deps.log("terminal identity first resolve returned null — poller will self-heal", {
            leaseId,
            clientPid: pid,
          });
        } else {
          deps.log("terminal identity resolved", {
            leaseId,
            clientPid: pid,
            terminalPid: terminalInfo.terminalPid,
            appName: terminalInfo.appName,
            isMinimized: terminalInfo.isMinimized,
            isOccluded: terminalInfo.isOccluded,
          });
        }
        return terminalInfo;
      },
      subscribe: deps.subscribeWindowTracking,
      setIdentity: (terminalInfo) => deps.setTerminalIdentity(leaseId, terminalInfo),
      applyUpdate: (terminalInfo) => {
        deps.setConfinementState(petId, {
          terminalBounds: terminalInfo.window?.bounds ?? null,
          terminalMinimized: terminalInfo.isMinimized,
          terminalOccluded: terminalInfo.isOccluded,
          terminalOwnerPid: terminalInfo.terminalPid,
          appName: terminalInfo.appName,
        });
        deps.repositionConfinedPet(petId);
      },
      isAlive: () => Boolean(deps.getRawLease(leaseId)),
      onDead: () => stopLease(leaseId),
      getScreenPermissionStatus: deps.getScreenPermissionStatus,
      promptScreenPermission: deps.promptScreenPermission,
      notifyScreenPermission: (onAction) => deps.notifyScreenPermission(leaseId, onAction),
      reportError: (error) => {
        deps.log("confinement poller resilience failure", {
          leaseId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    };

    try {
      await resolveAndSubscribe(leaseId, clientPid, pollerDeps, unsubscribers);
    } catch (error) {
      deps.log("terminal identity resolution error", { leaseId, clientPid, error: String(error) });
    }
  }

  return {
    trackLease,
    stopLease,
    clearPetConfinement: deps.clearConfinementState,
  };
}
