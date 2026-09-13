import type { TeamPack, TeamPackItem } from "./team-protocol.js";

export type TeamOwnedItem = { readonly type: TeamPackItem["type"]; readonly id: string; readonly source: "team" | "personal"; readonly organizationId: string; readonly itemId: string; readonly artifactVersionId: string; readonly releaseId: string; readonly version: string; readonly enabled?: boolean };
export type TeamReconcileAdapter<TStage = unknown> = {
  readonly stage: (item: TeamPackItem) => Promise<TStage>;
  readonly apply: (item: TeamPackItem, staged: TStage) => Promise<void>;
  readonly remove: (item: TeamOwnedItem) => Promise<void>;
};
export type TeamReconcileResult = { readonly applied: boolean; readonly failedItemId?: string; readonly failureCode?: "stage_failed" | "apply_failed" | "remove_failed"; readonly removed: readonly string[] };

export function resolveTeamPluginPolicy(policy: "required" | "optional", existingEnabled: boolean | undefined, permissions: readonly string[], approvedPermissions: readonly string[]): { readonly enabled: boolean; readonly permissionBlocked: boolean } {
  const approved = new Set(approvedPermissions);
  const permissionBlocked = permissions.some((permission) => !approved.has(permission));
  return { enabled: policy === "required" ? !permissionBlocked : existingEnabled ?? false, permissionBlocked };
}

/** Stage every changed artifact before touching active Team content. */
export async function reconcileTeamPack<TStage>(pack: TeamPack, current: readonly TeamOwnedItem[], adapter: TeamReconcileAdapter<TStage>): Promise<TeamReconcileResult> {
  const currentByKey = new Map(current.map((item) => [`${item.type}:${item.itemId}`, item]));
  const desiredByKey = new Map(pack.items.map((item) => [`${item.type}:${item.id}`, item]));
  const staged = new Map<string, TStage>();
  for (const item of pack.items) {
    const previous = currentByKey.get(`${item.type}:${item.id}`);
    if (previous?.source !== undefined && previous.source !== "team") return { applied: false, failedItemId: item.id, failureCode: "stage_failed", removed: [] };
    if (previous?.artifactVersionId === item.versionId) continue;
    try { staged.set(`${item.type}:${item.id}`, await adapter.stage(item)); }
    catch { return { applied: false, failedItemId: item.id, failureCode: "stage_failed", removed: [] }; }
  }
  for (const item of pack.items) {
    const key = `${item.type}:${item.id}`;
    const previous = currentByKey.get(key);
    if (previous?.source !== undefined && previous.source !== "team") return { applied: false, failedItemId: item.id, failureCode: "apply_failed", removed: [] };
    if (previous?.artifactVersionId === item.versionId) continue;
    try { await adapter.apply(item, staged.get(key)!); }
    catch { return { applied: false, failedItemId: item.id, failureCode: "apply_failed", removed: [] }; }
  }
  const removed: string[] = [];
  for (const item of current) {
    if (item.source === "team" && item.organizationId !== "" && !desiredByKey.has(`${item.type}:${item.itemId}`)) {
      try { await adapter.remove(item); removed.push(item.itemId); }
      catch { return { applied: false, failedItemId: item.itemId, failureCode: "remove_failed", removed }; }
    }
  }
  return { applied: true, removed };
}
