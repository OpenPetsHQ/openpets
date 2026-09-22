import { useI18n } from "../i18n.js";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GlobeIcon,
  NetworkPinIcon,
  PluginIcon,
  RefreshIcon,
  ShieldCheckIcon,
  ShieldLockIcon,
} from "./teams-icons.js";
import {
  getPermissionDescription,
  getPermissionLabel,
  getPermissionTone,
  isSensitivePermission,
  statusPillToneClass,
} from "./teams-state.js";
import type { TeamPluginEntry } from "./teams-types.js";

export type TeamPluginCardProps = {
  readonly plugin: TeamPluginEntry;
  readonly isApproving: boolean;
  readonly isToggling?: boolean;
  readonly isBusy: boolean;
  readonly isExpanded: boolean;
  readonly onApprove: (pluginId: string, approvalToken?: string) => void;
  readonly onSetEnabled?: (pluginId: string, enabled: boolean) => void;
  readonly onToggleDetails: (pluginId: string) => void;
};

export function TeamPluginCard({
  plugin,
  isApproving,
  isToggling,
  isBusy,
  isExpanded,
  onApprove,
  onSetEnabled,
  onToggleDetails,
}: TeamPluginCardProps) {
  const { t } = useI18n();
  const isBlocked = Boolean(plugin.permissionBlocked);
  const requestedPermissions = plugin.requestedPermissions ?? [];
  const requestedNetworkHosts = plugin.requestedNetworkHosts ?? [];

  const cardStyle = isBlocked
    ? "border-amber-300 bg-amber-50/30 dark:border-amber-700/70 dark:bg-amber-950/20"
    : "border-blue-100/70 bg-white/75 hover:border-brand/40 hover:bg-white dark:border-slate-700/60 dark:bg-slate-900/60 dark:hover:border-slate-600 dark:hover:bg-slate-900/90";

  const iconContainerStyle = isBlocked
    ? "bg-amber-100/80 border-amber-200 text-amber-700 dark:bg-amber-900/40 dark:border-amber-800 dark:text-amber-300"
    : "bg-blue-50 border-blue-100/70 text-brand dark:bg-slate-800 dark:border-slate-700";

  const policyBadgeStyle =
    plugin.policy === "required"
      ? "bg-purple-50 text-purple-700 border-purple-100/60 dark:bg-purple-950/60 dark:border-purple-800 dark:text-purple-300"
      : "bg-slate-50 text-slate-700 border-slate-200/60 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300";

  return (
    <article
      className={`rounded-2xl border p-4 transition-[border-color,background-color] shadow-sm flex flex-col justify-between gap-3.5 ${cardStyle}`}
    >
      {/* Plugin Header */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border shadow-sm ${iconContainerStyle}`}
          >
            <PluginIcon />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <strong className="text-sm font-bold text-navy dark:text-slate-100 truncate block">
                {plugin.id}
              </strong>
              <span className="text-[11px] font-mono text-slatecopy/80 dark:text-slate-400">
                v{plugin.version}
              </span>
            </div>

            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border ${policyBadgeStyle}`}
              >
                {plugin.policy === "required" ? "Required by Org" : "Optional"}
              </span>

              {isBlocked ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200/80 dark:bg-amber-950/80 dark:border-amber-700 dark:text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span>Needs Approval</span>
                </span>
              ) : plugin.enabled ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-100/60 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span>Active</span>
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">
                  <span>Disabled</span>
                </span>
              )}

              <span className="inline-flex items-center text-brand font-semibold text-[10px]">
                Team Managed
              </span>
            </div>
          </div>
        </div>

        {/* Toggle control for approved optional plugins only */}
        {!isBlocked && plugin.policy === "optional" && onSetEnabled && (
          <div className="shrink-0 flex items-center">
            {plugin.enabled ? (
              <button
                type="button"
                className="btn btn-compact btn-secondary text-xs font-bold px-3 py-1.5 shadow-sm"
                disabled={isBusy}
                onClick={() => onSetEnabled(plugin.id, false)}
                title={`Disable ${plugin.id}`}
              >
                {isToggling ? (
                  <>
                    <RefreshIcon className="w-3.5 h-3.5 animate-spin" />
                    <span>Disabling...</span>
                  </>
                ) : (
                  <span>Disable</span>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-compact btn-primary text-xs font-bold px-3 py-1.5 shadow-sm"
                disabled={isBusy}
                onClick={() => onSetEnabled(plugin.id, true)}
                title={`Enable ${plugin.id}`}
              >
                {isToggling ? (
                  <>
                    <RefreshIcon className="w-3.5 h-3.5 animate-spin" />
                    <span>Enabling...</span>
                  </>
                ) : (
                  <span>Enable</span>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Case A: BLOCKED - Explicit in-place approval panel */}
      {isBlocked ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200/80 bg-white/90 p-3.5 shadow-sm dark:bg-slate-950/70 dark:border-slate-800">
          {/* Policy Disclaimer */}
          <div className="flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-300/90 leading-relaxed bg-amber-50/60 dark:bg-amber-950/30 p-2.5 rounded-lg border border-amber-200/50 dark:border-amber-800/40">
            <ShieldLockIcon />
            <div className="flex-1 min-w-0 text-[11px]">
              <strong className="block font-bold text-amber-950 dark:text-amber-200 mb-0.5">
                Device Approval Required
              </strong>
              This plugin is{" "}
              {plugin.policy === "required"
                ? "required by your organization"
                : "offered by your organization"}
              , but organization policy never automatically grants permissions. You must review
              and grant permission on this computer before it can run.
            </div>
          </div>

          {/* Requested Capabilities Breakdown */}
          <div className="flex flex-col gap-1.5">
            <span className="font-monoDisplay text-[10px] font-black uppercase tracking-wider text-slatecopy/80 dark:text-slate-400">
              Requested Capabilities ({requestedPermissions.length})
            </span>

            {requestedPermissions.length === 0 ? (
              <span className="text-xs text-slatecopy italic">
                No system permissions requested.
              </span>
            ) : (
              <div className="flex flex-col gap-1.5">
                {requestedPermissions.map((perm) => {
                  const label = getPermissionLabel(perm, t);
                  const desc = getPermissionDescription(perm);
                  const tone = getPermissionTone(perm);
                  const sensitive = isSensitivePermission(perm);

                  return (
                    <div
                      key={perm}
                      className="flex items-start justify-between gap-2 rounded-lg border border-blue-100/50 bg-blue-50/20 px-2.5 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/40"
                    >
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <span className={`pill mt-0.5 shrink-0 ${statusPillToneClass[tone]}`}>
                          {label}
                        </span>
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-[11px] text-slatecopy dark:text-slate-300 leading-snug">
                            {desc}
                          </span>
                          <span className="text-[10px] font-mono text-slatecopy/60 dark:text-slate-500">
                            {perm}
                          </span>
                        </div>
                      </div>
                      {sensitive && (
                        <span className="inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-700 dark:bg-red-950 dark:text-red-300 shrink-0">
                          Sensitive
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Requested Network Hosts */}
          {requestedNetworkHosts.length > 0 && (
            <div className="flex flex-col gap-1.5 pt-1.5 border-t border-blue-50 dark:border-slate-800">
              <span className="font-monoDisplay text-[10px] font-black uppercase tracking-wider text-slatecopy/80 dark:text-slate-400 flex items-center gap-1.5">
                <GlobeIcon />
                <span>Allowed Network Destinations ({requestedNetworkHosts.length})</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {requestedNetworkHosts.map((host) => (
                  <span
                    key={host}
                    className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-800 border border-blue-100/60 dark:bg-blue-950/60 dark:border-blue-900 dark:text-blue-300"
                  >
                    <NetworkPinIcon />
                    <span>{host}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* In-Place Action Bar */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-amber-200/60 dark:border-slate-800">
            <span className="text-[11px] text-slatecopy dark:text-slate-400 leading-tight">
              Approval applies only to this device.
            </span>
            <button
              type="button"
              className="btn btn-compact btn-primary text-xs font-bold px-3.5 py-2 shrink-0 shadow-sm"
              disabled={isBusy}
              onClick={() => onApprove(plugin.id, plugin.approvalToken)}
            >
              {isApproving ? (
                <>
                  <RefreshIcon className="w-3.5 h-3.5 animate-spin" />
                  <span>Approving...</span>
                </>
              ) : (
                <>
                  <ShieldCheckIcon />
                  <span>
                    {plugin.policy === "required"
                      ? "Approve & Activate"
                      : "Approve Permissions"}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* Case B: NOT BLOCKED - Active/Disabled plugin with inspectable details */
        <div className="flex flex-col gap-2">
          {requestedPermissions.length > 0 || requestedNetworkHosts.length > 0 ? (
            <>
              <div className="flex items-center justify-between text-[11px] text-slatecopy dark:text-slate-400 pt-1 border-t border-blue-50/80 dark:border-slate-800">
                <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold">
                  <ShieldCheckIcon />
                  <span>Permissions approved on this device</span>
                </div>
                <button
                  type="button"
                  className="text-brand hover:underline cursor-pointer font-bold text-[11px] flex items-center gap-1"
                  onClick={() => onToggleDetails(plugin.id)}
                >
                  <span>
                    {isExpanded
                      ? "Hide Details"
                      : `View Permissions (${requestedPermissions.length})`}
                  </span>
                  {isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
                </button>
              </div>

              {isExpanded && (
                <div className="flex flex-col gap-2 rounded-xl border border-blue-100/60 bg-blue-50/20 p-3 mt-1 dark:bg-slate-950/40 dark:border-slate-800">
                  {requestedPermissions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {requestedPermissions.map((perm) => (
                        <span
                          key={perm}
                          className={`pill ${statusPillToneClass[getPermissionTone(perm)]}`}
                          title={getPermissionDescription(perm)}
                        >
                          {getPermissionLabel(perm, t)}
                        </span>
                      ))}
                    </div>
                  )}

                  {requestedNetworkHosts.length > 0 && (
                    <div className="flex flex-col gap-1 pt-1.5 border-t border-blue-100/40 dark:border-slate-800">
                      <span className="text-[10px] font-monoDisplay uppercase font-bold text-slatecopy/70">
                        Network Destinations
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {requestedNetworkHosts.map((host) => (
                          <span
                            key={host}
                            className="font-mono text-[10px] bg-white/80 px-2 py-0.5 rounded border border-blue-100 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300"
                          >
                            {host}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-between border-t border-blue-50/80 dark:border-slate-800 pt-2 text-[11px] text-slatecopy">
              <span className="text-slatecopy/70">Configuration centrally managed</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-semibold text-[10px] flex items-center gap-1">
                <CheckIcon />
                <span>No Extra Permissions</span>
              </span>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
