import { PluginIcon } from "./teams-icons.js";
import { TeamPluginCard } from "./TeamPluginCard.js";
import type { TeamPluginEntry } from "./teams-types.js";

export type TeamPluginsSectionProps = {
  readonly plugins: readonly TeamPluginEntry[];
  readonly pendingApprovalsCount: number;
  readonly busy: string;
  readonly approvingPluginId: string | null;
  readonly togglingPluginId?: string | null;
  readonly expandedPluginDetails: Record<string, boolean>;
  readonly onApprovePluginPermissions: (pluginId: string, approvalToken?: string) => void;
  readonly onSetPluginEnabled?: (pluginId: string, enabled: boolean) => void;
  readonly onTogglePluginDetails: (pluginId: string) => void;
};

export function TeamPluginsSection({
  plugins,
  pendingApprovalsCount,
  busy,
  approvingPluginId,
  togglingPluginId,
  expandedPluginDetails,
  onApprovePluginPermissions,
  onSetPluginEnabled,
  onTogglePluginDetails,
}: TeamPluginsSectionProps) {
  const isBusy = Boolean(busy);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="m-0 font-monoDisplay text-lg font-black text-navy dark:text-slate-100 flex items-center gap-2">
            <PluginIcon />
            <span>Team Plugins</span>
            <span className="inline-flex items-center rounded-full bg-blue-100/60 dark:bg-blue-950 dark:text-blue-300 px-2 py-0.5 text-[11px] font-bold text-brand">
              {plugins.length}
            </span>
            {pendingApprovalsCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200 dark:bg-amber-950/80 dark:border-amber-700 dark:text-amber-300">
                {pendingApprovalsCount} Awaiting Approval
              </span>
            )}
          </h3>
          <p className="m-0 mt-0.5 text-xs text-slatecopy">
            Workplace tools and integrations provisioned and configured by your organization.
          </p>
        </div>
      </div>

      {plugins.length === 0 ? (
        <div className="flex min-h-24 flex-col items-center justify-center rounded-2xl border border-dashed border-blue-200/80 bg-blue-50/20 dark:border-slate-800 dark:bg-slate-900/40 p-5 text-center text-xs text-slatecopy">
          <span>No team plugins are currently deployed in your organization’s pack.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {plugins.map((plugin: TeamPluginEntry) => (
            <TeamPluginCard
              key={plugin.id}
              plugin={plugin}
              isApproving={approvingPluginId === plugin.id}
              isToggling={togglingPluginId === plugin.id}
              isBusy={isBusy}
              isExpanded={Boolean(expandedPluginDetails[plugin.id])}
              onApprove={onApprovePluginPermissions}
              onSetEnabled={onSetPluginEnabled}
              onToggleDetails={onTogglePluginDetails}
            />
          ))}
        </div>
      )}
    </section>
  );
}
