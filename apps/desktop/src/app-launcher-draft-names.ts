import type { AppLauncherSnapshotEntry } from "./app-launcher-types.js";

export function reconcileAppLauncherDraftNames(
  current: Readonly<Record<string, string>>,
  entries: readonly AppLauncherSnapshotEntry[],
  savedEntryId?: string,
): Record<string, string> {
  return Object.fromEntries(entries.map((entry) => [
    entry.id,
    entry.id === savedEntryId ? entry.name : current[entry.id] ?? entry.name,
  ]));
}
