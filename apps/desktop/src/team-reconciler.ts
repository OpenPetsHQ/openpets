import type { TeamPack, TeamPackItem } from "./team-protocol.js";

export type TeamOwnedItem = {
  readonly type: TeamPackItem["type"];
  readonly id: string;
  readonly source: "team" | "personal";
  readonly organizationId: string;
  readonly itemId: string;
  readonly artifactVersionId: string;
  readonly releaseId: string;
  readonly version: string;
  readonly enabled?: boolean;
  readonly policy?: "required" | "optional";
  readonly config?: Record<string, unknown>;
  readonly pendingApproval?: boolean;
};
export type TeamReconcileAdapter<TStage = unknown> = {
  readonly stage: (item: TeamPackItem) => Promise<TStage>;
  readonly apply: (
    item: TeamPackItem,
    staged: TStage,
  ) => Promise<{ readonly pendingApproval?: boolean } | void>;
  readonly remove: (item: TeamOwnedItem) => Promise<void>;
  readonly discard?: (staged: TStage) => Promise<void>;
  readonly needsApply?: (
    item: TeamPackItem,
    previous: TeamOwnedItem,
  ) => boolean | Promise<boolean>;
};
export type TeamReconcileResult = {
  readonly applied: boolean;
  readonly pendingApproval?: boolean;
  readonly failedItemId?: string;
  readonly failureCode?: "stage_failed" | "apply_failed" | "remove_failed";
  /** Diagnostic detail for logs; not shown to the user. */
  readonly failureReason?: string;
  readonly removed: readonly string[];
};

/** Serializes the full Team operation, including network and filesystem work. */
export class TeamOperationQueue {
  #tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(operation, operation);
    this.#tail = next.then(() => undefined, () => undefined);
    return next;
  }

  wait(): Promise<void> {
    return this.#tail;
  }
}

export function resolveTeamPluginPolicy(
  policy: "required" | "optional",
  existingEnabled: boolean | undefined,
  permissions: readonly string[],
  approvedPermissions: readonly string[],
  networkHosts: readonly string[] = [],
  approvedNetworkHosts: readonly string[] = [],
): { readonly enabled: boolean; readonly permissionBlocked: boolean } {
  const approved = new Set(approvedPermissions);
  const approvedHosts = new Set(approvedNetworkHosts);
  const permissionBlocked = permissions.some(
    (permission) => !approved.has(permission),
  ) || networkHosts.some((host) => !approvedHosts.has(host));
  return {
    enabled: permissionBlocked
      ? false
      : policy === "required"
        ? true
        : existingEnabled ?? false,
    permissionBlocked,
  };
}

/** Stage every changed artifact before touching active Team content. */
export async function reconcileTeamPack<TStage>(
  pack: TeamPack,
  current: readonly TeamOwnedItem[],
  adapter: TeamReconcileAdapter<TStage>,
): Promise<TeamReconcileResult> {
  const currentByKey = new Map(current.map((item) => [`${item.type}:${item.itemId}`, item]));
  const desiredByKey = new Map(pack.items.map((item) => [`${item.type}:${item.id}`, item]));
  const staged = new Map<string, TStage>();
  const applyKeys = new Set<string>();
  let pendingApproval = false;
  for (const item of pack.items) {
    const previous = currentByKey.get(`${item.type}:${item.id}`);
    if (previous?.source !== undefined && previous.source !== "team") {
      await discardStaged(staged, adapter);
      return {
        applied: false,
        failedItemId: item.id,
        failureCode: "stage_failed",
        failureReason: "The item id is already used by personal content.",
        removed: [],
      };
    }
    let needsApply: boolean;
    try {
      needsApply = previous === undefined
        || previous.artifactVersionId !== item.versionId
        || (
          previous.type === "plugin"
          && await adapter.needsApply?.(item, previous) === true
        );
    } catch (error) {
      await discardStaged(staged, adapter);
      return {
        applied: false,
        failedItemId: item.id,
        failureCode: "stage_failed",
        failureReason: describeFailure(error),
        removed: [],
      };
    }
    if (!needsApply) continue;
    applyKeys.add(`${item.type}:${item.id}`);
    try {
      staged.set(`${item.type}:${item.id}`, await adapter.stage(item));
    } catch (error) {
      await discardStaged(staged, adapter);
      return {
        applied: false,
        failedItemId: item.id,
        failureCode: "stage_failed",
        failureReason: describeFailure(error),
        removed: [],
      };
    }
  }
  for (const item of pack.items) {
    const key = `${item.type}:${item.id}`;
    const previous = currentByKey.get(key);
    if (previous?.source !== undefined && previous.source !== "team") {
      await discardStaged(staged, adapter);
      return {
        applied: false,
        failedItemId: item.id,
        failureCode: "apply_failed",
        removed: [],
      };
    }
    if (!applyKeys.has(key)) {
      if (previous?.type === "plugin" && previous.pendingApproval === true) pendingApproval = true;
      continue;
    }
    try {
      const result = await adapter.apply(item, staged.get(key)!);
      if (result?.pendingApproval) pendingApproval = true;
    } catch (error) {
      await discardStaged(staged, adapter);
      return {
        applied: false,
        failedItemId: item.id,
        failureCode: "apply_failed",
        failureReason: describeFailure(error),
        removed: [],
      };
    }
  }
  const removed: string[] = [];
  for (const item of current) {
    if (
      item.source === "team"
      && item.organizationId !== ""
      && !desiredByKey.has(`${item.type}:${item.itemId}`)
    ) {
      try {
        await adapter.remove(item);
        removed.push(item.itemId);
      } catch (error) {
        return {
          applied: false,
          failedItemId: item.itemId,
          failureCode: "remove_failed",
          failureReason: describeFailure(error),
          removed,
        };
      }
    }
  }
  return {
    applied: true,
    pendingApproval: pendingApproval || undefined,
    removed,
  };
}

async function discardStaged<TStage>(
  staged: ReadonlyMap<string, TStage>,
  adapter: TeamReconcileAdapter<TStage>,
): Promise<void> {
  if (!adapter.discard) return;
  await Promise.all(
    [...staged.values()].map((value) => adapter.discard!(value).catch(() => undefined)),
  );
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
