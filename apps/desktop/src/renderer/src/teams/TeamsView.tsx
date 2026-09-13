import React, { useEffect, useState, useCallback } from "react";
import { useI18n } from "../i18n.js";
import defaultThumbUrl from "../../../../assets/default-pet-thumbnail.png";
import type { TeamsApi, TeamsSnapshot, TeamPetEntry, TeamPluginEntry, TeamsViewProps } from "./teams-types.js";
import { emptyTeamsSnapshot, formatDate, formatTeamsError, isTeamsSnapshot, validateDisplayName } from "./teams-state.js";

// Dedicated clean SVGs matching the app-wide 2px stroke icon style
const RefreshIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

const BuildingIcon = () => (
  <svg className="w-5 h-5 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
    <path d="M9 22v-4h6v4" />
    <path d="M8 6h.01" />
    <path d="M16 6h.01" />
    <path d="M8 10h.01" />
    <path d="M16 10h.01" />
    <path d="M8 14h.01" />
    <path d="M16 14h.01" />
  </svg>
);

const ShieldCheckIcon = () => (
  <svg className="w-5 h-5 text-emerald-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const AlertCircleIcon = () => (
  <svg className="w-5 h-5 text-red-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const WarningIcon = () => (
  <svg className="w-5 h-5 text-amber-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const LogOutIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const LaptopIcon = () => (
  <svg className="w-5 h-5 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <line x1="2" y1="20" x2="22" y2="20" />
  </svg>
);

const PetIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="4" r="2" />
    <circle cx="18" cy="8" r="2" />
    <circle cx="20" cy="16" r="2" />
    <path d="M9 10a5 5 0 0 1 5 5v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4a5 5 0 0 1 5-5z" />
  </svg>
);

const PluginIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
);

export function TeamsView({ api, onNavigate }: TeamsViewProps) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<TeamsSnapshot>(() => emptyTeamsSnapshot());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  const loadSnapshot = useCallback(async (clearErrors = false) => {
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
  }, [api]);

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
      setActionError(err instanceof Error ? err.message : "Failed to complete Teams enrollment.");
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
      setActionError(err instanceof Error ? err.message : "Failed to synchronize Team Pack.");
    } finally {
      setBusy("");
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
      setActionError(err instanceof Error ? err.message : "Failed to leave organization.");
    } finally {
      setBusy("");
    }
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
        <div className={`rounded-2xl border p-4 shadow-sm flex flex-col gap-2.5 ${activeError.isPermissionBlock ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-900"}`}>
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
            {activeError.isPermissionBlock && onNavigate && (
              <button
                type="button"
                className="btn btn-compact btn-secondary text-xs"
                onClick={() => onNavigate("plugins")}
              >
                Open Plugins
              </button>
            )}
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

      {/* CASE 1: Pending Deep-Link Enrollment */}
      {snapshot.pendingEnrollment && !snapshot.enrolled && (
        <section className="team-card border-brand/30 bg-blue-50/50">
          <div className="flex items-start gap-3.5">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-sm">
              <LaptopIcon />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-monoDisplay text-[10px] font-black uppercase tracking-[.18em] text-brand block mb-0.5">
                Invitation Received
              </span>
              <h2 className="m-0 font-monoDisplay text-2xl font-black text-navy leading-tight">
                Complete Team Enrollment
              </h2>
              <p className="m-0 mt-1 text-xs text-slatecopy leading-relaxed">
                An invitation to join an organization was opened on this computer. Set a friendly display name so your organization administrator can identify this device.
              </p>
            </div>
          </div>

          <form onSubmit={handleEnrollSubmit} className="mt-2 flex flex-col gap-3 rounded-2xl border border-blue-100/70 bg-white/90 p-4 shadow-inner dark:bg-slate-950/60 dark:border-slate-800">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="team-device-name" className="text-xs font-bold text-navy flex items-center justify-between">
                <span>Device Display Name</span>
                <span className="text-[11px] font-mono text-slatecopy/70">{displayNameInput.length}/120</span>
              </label>
              <input
                id="team-device-name"
                type="text"
                maxLength={120}
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                placeholder="e.g., Work Laptop, Devbox, or MacBook Pro"
                disabled={Boolean(busy)}
                className="team-input"
                autoFocus
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <span className="text-[11px] text-slatecopy leading-snug">
                This connects your device to your team’s private catalog. Personal pets and plugins remain completely separate.
              </span>
              <button
                type="submit"
                disabled={Boolean(busy) || !displayNameInput.trim()}
                className="btn btn-primary px-5 shrink-0"
              >
                {busy ? "Enrolling..." : "Accept & Enroll"}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* CASE 2: Not Enrolled & No Pending Enrollment */}
      {!snapshot.enrolled && !snapshot.pendingEnrollment && (
        <div className="flex flex-col gap-5">
          <section className="team-card">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-brand border border-blue-100/60 shadow-sm dark:bg-slate-800 dark:border-slate-700">
                <BuildingIcon />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-monoDisplay text-[10px] font-black uppercase tracking-[.18em] text-brand block mb-0.5">
                  Private Catalog & Fleet
                </span>
                <h2 className="m-0 font-monoDisplay text-2xl font-black text-navy leading-tight">
                  Join an Organization
                </h2>
                <p className="m-0 mt-1 text-xs text-slatecopy leading-relaxed">
                  OpenPets Teams allows engineering teams and organizations to securely distribute company-curated companions, shared workflow plugins, and team configurations directly to your desktop.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mt-2">
              <div className="team-guide-step">
                <span className="font-monoDisplay text-[11px] font-black uppercase tracking-wider text-brand">1. Get Invitation</span>
                <p className="m-0 text-xs text-slatecopy leading-relaxed">
                  Ask your team administrator for a deep-link invitation URL.
                </p>
              </div>
              <div className="team-guide-step">
                <span className="font-monoDisplay text-[11px] font-black uppercase tracking-wider text-brand">2. Open Link</span>
                <p className="m-0 text-xs text-slatecopy leading-relaxed">
                  Click the link (<code className="font-mono text-[10px] bg-blue-100/70 px-1 py-0.5 rounded dark:bg-slate-800 dark:text-slate-200">openpets://teams/enroll...</code>) on this computer.
                </p>
              </div>
              <div className="team-guide-step">
                <span className="font-monoDisplay text-[11px] font-black uppercase tracking-wider text-brand">3. Auto Sync</span>
                <p className="m-0 text-xs text-slatecopy leading-relaxed">
                  Your organization’s companions and plugins will appear here automatically.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-blue-50/60 dark:border-slate-800 pt-4 mt-2">
              <span className="text-xs text-slatecopy">Waiting for an enrollment link...</span>
              <button
                type="button"
                className="btn btn-compact btn-secondary text-xs"
                disabled={loading}
                onClick={() => void loadSnapshot(true)}
              >
                <RefreshIcon />
                <span>Refresh Status</span>
              </button>
            </div>
          </section>

          {/* Privacy Guarantee Card */}
          <div className="flex items-start gap-3.5 rounded-2xl border border-emerald-100/70 bg-emerald-50/40 p-4 text-emerald-900 shadow-sm dark:bg-emerald-950/30 dark:border-emerald-800/40 dark:text-emerald-300">
            <ShieldCheckIcon />
            <div className="flex-1 min-w-0">
              <strong className="block text-xs font-black uppercase tracking-wide text-emerald-950 dark:text-emerald-200">
                Personal Content Isolation Guarantee
              </strong>
              <p className="m-0 mt-0.5 text-xs text-emerald-800 leading-relaxed dark:text-emerald-300">
                Your personal companions from the public catalog, Codex pets, and local developer plugins reside in an isolated lane. Joining an organization will never overwrite, modify, or delete any of your personal content.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* CASE 3: Enrolled State (Active Organization) */}
      {snapshot.enrolled && (
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
                  onClick={() => void handleSyncNow()}
                >
                  <RefreshIcon />
                  <span>{busy === "Synchronizing Team Pack..." ? "Syncing..." : "Sync Now"}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-compact btn-danger text-xs"
                  disabled={Boolean(busy)}
                  onClick={() => setShowLeaveModal(true)}
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

          {/* Section 1: Team Pets (Separated from personal) */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="m-0 font-monoDisplay text-lg font-black text-navy dark:text-slate-100 flex items-center gap-2">
                  <PetIcon />
                  <span>Team Pets</span>
                  <span className="inline-flex items-center rounded-full bg-blue-100/60 dark:bg-blue-950 dark:text-blue-300 px-2 py-0.5 text-[11px] font-bold text-brand">
                    {snapshot.teamPets.length}
                  </span>
                </h3>
                <p className="m-0 mt-0.5 text-xs text-slatecopy">
                  Company-curated companions installed from your organization’s Team Pack.
                </p>
              </div>
            </div>

            {snapshot.teamPets.length === 0 ? (
              <div className="flex min-h-24 flex-col items-center justify-center rounded-2xl border border-dashed border-blue-200/80 bg-blue-50/20 dark:border-slate-800 dark:bg-slate-900/40 p-5 text-center text-xs text-slatecopy">
                <span>No team pets are currently deployed in your organization’s pack.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {snapshot.teamPets.map((pet: TeamPetEntry) => (
                  <article
                    key={pet.id}
                    className="team-item-card flex items-center gap-3.5"
                  >
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-white to-blue-50 border border-blue-100 overflow-hidden dark:bg-slate-800 dark:border-slate-700">
                      <img
                        src={`openpets-installed://spritesheet/${encodeURIComponent(pet.id)}`}
                        alt={pet.displayName}
                        className="h-10 w-10 object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = defaultThumbUrl;
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 justify-between">
                        <strong className="text-sm font-bold text-navy dark:text-slate-100 truncate block">
                          {pet.displayName}
                        </strong>
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-brand border border-blue-100/60 shrink-0 dark:bg-blue-950/60 dark:border-blue-800 dark:text-blue-300">
                          Team Managed
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slatecopy block truncate mt-0.5">
                        {pet.id}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Section 2: Team Plugins (Separated from personal) */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="m-0 font-monoDisplay text-lg font-black text-navy dark:text-slate-100 flex items-center gap-2">
                  <PluginIcon />
                  <span>Team Plugins</span>
                  <span className="inline-flex items-center rounded-full bg-blue-100/60 dark:bg-blue-950 dark:text-blue-300 px-2 py-0.5 text-[11px] font-bold text-brand">
                    {snapshot.teamPlugins.length}
                  </span>
                </h3>
                <p className="m-0 mt-0.5 text-xs text-slatecopy">
                  Workplace tools and integrations provisioned and configured by your organization.
                </p>
              </div>
            </div>

            {snapshot.teamPlugins.length === 0 ? (
              <div className="flex min-h-24 flex-col items-center justify-center rounded-2xl border border-dashed border-blue-200/80 bg-blue-50/20 dark:border-slate-800 dark:bg-slate-900/40 p-5 text-center text-xs text-slatecopy">
                <span>No team plugins are currently deployed in your organization’s pack.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {snapshot.teamPlugins.map((plugin: TeamPluginEntry) => (
                  <article
                    key={plugin.id}
                    className="team-item-card flex flex-col justify-between gap-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <strong className="text-sm font-bold text-navy dark:text-slate-100 truncate block">
                          {plugin.id}
                        </strong>
                        <span className="text-[11px] font-mono text-slatecopy/80">
                          v{plugin.version}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border ${plugin.policy === "required" ? "bg-purple-50 text-purple-700 border-purple-100/60 dark:bg-purple-950/60 dark:border-purple-800 dark:text-purple-300" : "bg-slate-50 text-slate-700 border-slate-200/60 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300"}`}>
                          {plugin.policy === "required" ? "Required" : "Optional"}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border ${plugin.enabled ? "bg-emerald-50 text-emerald-700 border-emerald-100/60 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300" : "bg-amber-50 text-amber-700 border-amber-100/60 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-300"}`}>
                          {plugin.enabled ? "Active" : "Disabled"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-blue-50/80 dark:border-slate-800 pt-2 text-[11px] text-slatecopy">
                      <span className="text-slatecopy/70">Configuration centrally managed</span>
                      <span className="inline-flex items-center text-brand font-semibold text-[10px]">
                        Team Managed
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Privacy Guarantee Note */}
          <div className="flex items-start gap-3.5 rounded-2xl border border-blue-100/70 bg-blue-50/30 p-4 text-slatecopy shadow-sm dark:bg-slate-900/40 dark:border-slate-800">
            <ShieldCheckIcon />
            <div className="flex-1 min-w-0 text-xs leading-relaxed">
              <strong className="block font-bold text-navy dark:text-slate-100 mb-0.5">
                Personal Content Isolation
              </strong>
              Your personal catalog pets, Codex pets, and local plugins remain completely untouched in your local storage. Organization updates only synchronize assets under the team namespace.
            </div>
          </div>
        </div>
      )}

      {/* Leave Organization Confirmation Modal */}
      {showLeaveModal && (
        <div
          className="plugin-config-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Leave Organization"
        >
          <button
            className="plugin-config-backdrop"
            type="button"
            aria-label="Close dialog"
            onClick={() => !busy && setShowLeaveModal(false)}
          />
          <div className="team-modal">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400">
                  <LogOutIcon />
                </div>
                <h3 className="m-0 font-monoDisplay text-xl font-black text-navy dark:text-slate-100">
                  Leave Organization?
                </h3>
              </div>
              <button
                type="button"
                className="text-slatecopy hover:text-navy dark:hover:text-slate-100 cursor-pointer p-1"
                disabled={Boolean(busy)}
                onClick={() => setShowLeaveModal(false)}
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>

            <p className="m-0 text-xs text-slatecopy leading-relaxed">
              Are you sure you want to disconnect this computer from <strong className="text-navy dark:text-slate-100">{snapshot.organizationName || snapshot.organizationId}</strong>?
            </p>

            <div className="rounded-xl border border-red-100 bg-red-50/50 dark:bg-red-950/30 dark:border-red-900/50 p-3 text-xs text-red-900 dark:text-red-300 leading-relaxed">
              <ul className="m-0 pl-4 list-disc space-y-1">
                <li>All <strong>{snapshot.teamPets.length} team pets</strong> and <strong>{snapshot.teamPlugins.length} team plugins</strong> will be cleanly removed from this machine.</li>
                <li>Your personal catalog pets, Codex pets, and local developer plugins will <strong>not</strong> be affected.</li>
                <li>You can re-enroll at any time with a new invitation link.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                className="btn btn-compact btn-secondary text-xs"
                disabled={Boolean(busy)}
                onClick={() => setShowLeaveModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-compact btn-danger text-xs"
                disabled={Boolean(busy)}
                onClick={() => void handleLeaveConfirm()}
              >
                {busy ? "Leaving..." : "Yes, Leave Organization"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
