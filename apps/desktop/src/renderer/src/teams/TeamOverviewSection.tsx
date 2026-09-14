import { BuildingIcon, LogOutIcon, RefreshIcon, ShieldAlertIcon } from "./teams-icons.js";
import { formatDate } from "./teams-state.js";
import type { TeamsSnapshot } from "./teams-types.js";

export type TeamOverviewSectionProps = {
  readonly snapshot: TeamsSnapshot;
  readonly busy: string;
  readonly pendingApprovalsCount: number;
  readonly onSyncNow: () => void;
  readonly onOpenLeaveModal: () => void;
};

export function TeamOverviewSection({
  snapshot,
  busy,
  pendingApprovalsCount,
  onSyncNow,
  onOpenLeaveModal,
}: TeamOverviewSectionProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* Organization Overview Card */}
      <section className="team-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200/50 text-brand shadow-sm dark:bg-slate-800 dark:border-slate-700">
              <BuildingIcon />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-sans text-[11px] font-semibold text-emerald-700 border border-emerald-100/50 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300">
                  Enrolled
                </span>
                <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 font-sans text-[11px] font-semibold text-blue-700 border border-blue-100/50 dark:bg-blue-950/60 dark:border-blue-800 dark:text-blue-300">
                  Revision {snapshot.appliedRevision}
                </span>
                {snapshot.pendingRevision > snapshot.appliedRevision && (
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 font-sans text-[11px] font-semibold text-amber-700 border border-amber-100/50 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-300">
                    Update Pending (Rev {snapshot.pendingRevision})
                  </span>
                )}
              </div>
              <h2 className="m-0 font-monoDisplay text-2xl font-black text-navy leading-tight">
                {snapshot.organizationName || snapshot.organizationId}
              </h2>
            </div>
          </div>

          {/* Action Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="btn btn-compact btn-secondary text-xs"
              disabled={Boolean(busy)}
              onClick={onSyncNow}
            >
              <RefreshIcon />
              <span>{busy === "Synchronizing Team Pack..." ? "Syncing..." : "Sync Now"}</span>
            </button>
            <button
              type="button"
              className="btn btn-compact btn-danger text-xs"
              disabled={Boolean(busy)}
              onClick={onOpenLeaveModal}
            >
              <LogOutIcon />
              <span>Leave Organization</span>
            </button>
          </div>
        </div>

        {/* Organization Metadata Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-blue-50/80 dark:border-slate-800 pt-4">
          <div className="flex flex-col gap-0.5">
            <span className="font-monoDisplay text-[10px] font-black uppercase tracking-wider text-slatecopy/70">
              Organization ID
            </span>
            <span className="font-mono text-xs font-semibold text-navy dark:text-slate-100 truncate" title={snapshot.organizationId || ""}>
              {snapshot.organizationId || "—"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-monoDisplay text-[10px] font-black uppercase tracking-wider text-slatecopy/70">
              Installation ID
            </span>
            <span className="font-mono text-xs font-semibold text-navy dark:text-slate-100 truncate" title={snapshot.installationId || ""}>
              {snapshot.installationId ? snapshot.installationId.slice(0, 16) + "..." : "—"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-monoDisplay text-[10px] font-black uppercase tracking-wider text-slatecopy/70">
              Last Synchronized
            </span>
            <span className="text-xs font-semibold text-navy dark:text-slate-100">
              {formatDate(snapshot.lastSyncAt)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-monoDisplay text-[10px] font-black uppercase tracking-wider text-slatecopy/70">
              Managed Assets
            </span>
            <span className="text-xs font-semibold text-navy dark:text-slate-100">
              {snapshot.teamPets.length} pets · {snapshot.teamPlugins.length} plugins
            </span>
          </div>
        </div>
      </section>

      {/* Explicit Permission Approval Attention Banner (if any team plugin is blocked) */}
      {pendingApprovalsCount > 0 && (
        <div className="rounded-2xl border border-amber-300/80 bg-amber-50/80 p-4 shadow-sm dark:bg-amber-950/40 dark:border-amber-700/60 flex items-start gap-3.5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
            <ShieldAlertIcon />
          </div>
          <div className="flex-1 min-w-0">
            <strong className="block text-sm font-black uppercase tracking-wide text-amber-950 dark:text-amber-200">
              {pendingApprovalsCount === 1
                ? "1 Team Plugin Awaiting Permission Approval"
                : `${pendingApprovalsCount} Team Plugins Awaiting Permission Approval`}
            </strong>
            <p className="m-0 mt-1 text-xs text-amber-900 leading-relaxed dark:text-amber-300/90">
              Your organization has provisioned plugins for your team. Under the OpenPets security model, organization policy <strong>never automatically grants permissions</strong> on your device. Review the requested capabilities and approve them below to enable each tool on your device.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
