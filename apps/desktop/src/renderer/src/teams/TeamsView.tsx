import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { TeamEnrollmentSection } from "./TeamEnrollmentSection.js";
import { TeamLeaveModal } from "./TeamLeaveModal.js";
import { TeamOverviewSection } from "./TeamOverviewSection.js";
import { TeamPetsSection } from "./TeamPetsSection.js";
import { TeamPluginsSection } from "./TeamPluginsSection.js";
import {
  AlertCircleIcon,
  CheckIcon,
  CloseIcon,
  RefreshIcon,
  ShieldCheckIcon,
  WarningIcon,
} from "./teams-icons.js";
import {
  countPendingPluginApprovals,
  emptyTeamsSnapshot,
  formatTeamsError,
  isTeamsSnapshot,
  validateDisplayName,
} from "./teams-state.js";
import type { TeamsSnapshot, TeamsViewProps } from "./teams-types.js";

export function TeamsView({ api }: TeamsViewProps) {
  const [snapshot, setSnapshot] = useState<TeamsSnapshot>(() => emptyTeamsSnapshot());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [approvingPluginId, setApprovingPluginId] = useState<string | null>(null);
  const [togglingPluginId, setTogglingPluginId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [expandedPluginDetails, setExpandedPluginDetails] = useState<Record<string, boolean>>({});

  const loadSnapshot = useCallback(
    async (clearErrors = false) => {
      if (clearErrors) {
        setActionError("");
      }
      setLoading(true);
      try {
        const next = await api.getTeamsSnapshot();
        if (isTeamsSnapshot(next)) {
          setSnapshot(next);
        } else {
          throw new Error("Invalid Teams snapshot received.");
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to load Teams status.");
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = window.setTimeout(() => setSuccessMessage(""), 3500);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  const handleEnrollSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const validation = validateDisplayName(displayNameInput);
    if (!validation.ok) {
      setActionError(validation.error);
      return;
    }

    setBusy("Enrolling this device...");
    setActionError("");
    setSuccessMessage("");
    try {
      const next = await api.submitTeamsEnrollment(validation.name);
      setSnapshot(next);
      setDisplayNameInput("");
      setSuccessMessage(`Enrolled successfully in ${next.organizationName || "team"}!`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to complete Teams enrollment.",
      );
    } finally {
      setBusy("");
    }
  };

  const handleSyncNow = async () => {
    setBusy("Synchronizing Team Pack...");
    setActionError("");
    setSuccessMessage("");
    try {
      const next = await api.syncTeamsNow();
      setSnapshot(next);
      setSuccessMessage("Team Pack synchronized successfully.");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to synchronize Team Pack.",
      );
    } finally {
      setBusy("");
    }
  };

  const handleApprovePluginPermissions = async (pluginId: string, approvalToken?: string) => {
    setBusy(`Approving permissions for ${pluginId}...`);
    setApprovingPluginId(pluginId);
    setActionError("");
    setSuccessMessage("");
    try {
      if (!api.approveTeamPluginPermissions) {
        throw new Error("Plugin permission approval API is not available on this host.");
      }
      const next = await api.approveTeamPluginPermissions(pluginId, approvalToken);
      if (isTeamsSnapshot(next)) {
        setSnapshot(next);
      }
      const updatedPlugin = next?.teamPlugins?.find((p) => p.id === pluginId);
      if (updatedPlugin?.enabled) {
        setSuccessMessage(`Permissions approved for ${pluginId}. Plugin is now active.`);
      } else {
        setSuccessMessage(`Permissions approved for ${pluginId}.`);
      }
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : `Failed to approve permissions for ${pluginId}.`,
      );
    } finally {
      setBusy("");
      setApprovingPluginId(null);
    }
  };

  const handleSetPluginEnabled = async (pluginId: string, enabled: boolean) => {
    setBusy(enabled ? `Enabling ${pluginId}...` : `Disabling ${pluginId}...`);
    setTogglingPluginId(pluginId);
    setActionError("");
    setSuccessMessage("");
    try {
      if (!api.setTeamPluginEnabled) {
        throw new Error("Plugin enable/disable API is not available on this host.");
      }
      const next = await api.setTeamPluginEnabled(pluginId, enabled);
      if (isTeamsSnapshot(next)) {
        setSnapshot(next);
      }
      setSuccessMessage(
        enabled ? `Plugin ${pluginId} enabled.` : `Plugin ${pluginId} disabled.`,
      );
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : `Failed to ${enabled ? "enable" : "disable"} ${pluginId}.`,
      );
    } finally {
      setBusy("");
      setTogglingPluginId(null);
    }
  };

  const handleLeaveConfirm = async () => {
    setBusy("Leaving organization...");
    setActionError("");
    setSuccessMessage("");
    try {
      const next = await api.leaveTeams();
      setSnapshot(next);
      setShowLeaveModal(false);
      setSuccessMessage("Successfully disconnected from organization.");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to leave organization.",
      );
    } finally {
      setBusy("");
    }
  };

  const togglePluginDetails = (pluginId: string) => {
    setExpandedPluginDetails((prev) => ({
      ...prev,
      [pluginId]: !prev[pluginId],
    }));
  };

  if (loading && !snapshot.organizationId && !snapshot.pendingEnrollment) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-4 text-center rounded-[28px] border border-blue-100/70 bg-white/75 p-6 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold text-slatecopy">
          <RefreshIcon />
          <span>Loading Teams status...</span>
        </div>
      </div>
    );
  }

  const activeError = formatTeamsError(snapshot.lastError || actionError);
  const pendingApprovalsCount = countPendingPluginApprovals(snapshot.teamPlugins);

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2 pb-8">
      {/* Toast Feedback */}
      {successMessage && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckIcon />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            className="text-emerald-700 hover:text-emerald-900 cursor-pointer p-1"
            onClick={() => setSuccessMessage("")}
            aria-label="Dismiss message"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {/* Synchronous Error Banner (if any API call failed directly) */}
      {actionError && !snapshot.lastError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 shadow-sm flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertCircleIcon />
            <div>
              <strong className="block font-bold text-red-900">Action Error</strong>
              <p className="m-0 text-xs text-red-800 mt-0.5">{actionError}</p>
            </div>
          </div>
          <button
            type="button"
            className="text-red-700 hover:text-red-900 cursor-pointer p-1 shrink-0"
            onClick={() => setActionError("")}
            aria-label="Dismiss error"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {/* Snapshot Error / Permission Block Banner */}
      {activeError && (
        <div
          className={`rounded-2xl border p-4 shadow-sm flex flex-col gap-2.5 ${
            activeError.isPermissionBlock
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          <div className="flex items-start gap-3">
            {activeError.isPermissionBlock ? <WarningIcon /> : <AlertCircleIcon />}
            <div className="flex-1 min-w-0">
              <strong className="block font-monoDisplay text-sm font-black uppercase tracking-wide">
                {activeError.title}
              </strong>
              <p className="m-0 text-xs leading-relaxed mt-1 opacity-90">
                {activeError.description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-black/5 justify-end">
            {activeError.canRetry && (
              <button
                type="button"
                className="btn btn-compact btn-primary text-xs"
                disabled={Boolean(busy)}
                onClick={() => void handleSyncNow()}
              >
                <RefreshIcon />
                <span>Retry Sync</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Enrollment Views (Unenrolled or Pending Deep-Link Invitation) */}
      {!snapshot.enrolled ? (
        <TeamEnrollmentSection
          snapshot={snapshot}
          busy={busy}
          loading={loading}
          displayNameInput={displayNameInput}
          onDisplayNameChange={setDisplayNameInput}
          onEnrollSubmit={(e) => void handleEnrollSubmit(e)}
          onRefreshStatus={() => void loadSnapshot(true)}
        />
      ) : (
        /* Enrolled State (Active Organization) */
        <div className="flex flex-col gap-6">
          <TeamOverviewSection
            snapshot={snapshot}
            busy={busy}
            pendingApprovalsCount={pendingApprovalsCount}
            onSyncNow={() => void handleSyncNow()}
            onOpenLeaveModal={() => setShowLeaveModal(true)}
          />

          <TeamPetsSection pets={snapshot.teamPets} />

          <TeamPluginsSection
            plugins={snapshot.teamPlugins}
            pendingApprovalsCount={pendingApprovalsCount}
            busy={busy}
            approvingPluginId={approvingPluginId}
            togglingPluginId={togglingPluginId}
            expandedPluginDetails={expandedPluginDetails}
            onApprovePluginPermissions={(id, token) =>
              void handleApprovePluginPermissions(id, token)
            }
            onSetPluginEnabled={
              api.setTeamPluginEnabled
                ? (id, enabled) => void handleSetPluginEnabled(id, enabled)
                : undefined
            }
            onTogglePluginDetails={togglePluginDetails}
          />

          {/* Privacy Guarantee Note */}
          <div className="flex items-start gap-3.5 rounded-2xl border border-blue-100/70 bg-blue-50/30 p-4 text-slatecopy shadow-sm dark:bg-slate-900/40 dark:border-slate-800">
            <div className="pt-0.5">
              <ShieldCheckIcon />
            </div>
            <div className="flex-1 min-w-0 text-xs leading-relaxed">
              <strong className="block font-bold text-navy dark:text-slate-100 mb-0.5">
                Personal Content Isolation
              </strong>
              Your personal catalog pets, Codex pets, and local plugins remain completely untouched
              in your local storage. Organization updates only synchronize assets under the team
              namespace.
            </div>
          </div>
        </div>
      )}

      {/* Leave Organization Confirmation Modal */}
      <TeamLeaveModal
        isOpen={showLeaveModal}
        organizationName={snapshot.organizationName || snapshot.organizationId || "organization"}
        teamPetsCount={snapshot.teamPets.length}
        teamPluginsCount={snapshot.teamPlugins.length}
        busy={busy}
        onClose={() => setShowLeaveModal(false)}
        onConfirm={() => void handleLeaveConfirm()}
      />
    </div>
  );
}
