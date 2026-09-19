import type React from "react";
import {
  ArrowUpRightIcon,
  BuildingIcon,
  LaptopIcon,
  RefreshIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UsersIcon,
} from "./teams-icons.js";
import { formatDate, isEnrollmentActionable } from "./teams-state.js";
import type { TeamsSnapshot } from "./teams-types.js";

export type TeamEnrollmentSectionProps = {
  readonly snapshot: TeamsSnapshot;
  readonly busy: string;
  readonly loading: boolean;
  readonly displayNameInput: string;
  readonly onDisplayNameChange: (value: string) => void;
  readonly onEnrollSubmit: (e?: React.FormEvent) => void;
  readonly onRefreshStatus: () => void;
  readonly onDiscardEnrollment: () => void;
  readonly onOpenOrganizationsPage?: () => void;
};

export function TeamEnrollmentSection({
  snapshot,
  busy,
  loading,
  displayNameInput,
  onDisplayNameChange,
  onEnrollSubmit,
  onRefreshStatus,
  onDiscardEnrollment,
  onOpenOrganizationsPage,
}: TeamEnrollmentSectionProps) {
  const isBusy = Boolean(busy);
  const isSubmitDisabled = isBusy || !isEnrollmentActionable(snapshot, displayNameInput);

  if (snapshot.pendingEnrollment && !snapshot.enrolled) {
    return (
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
              An invitation to join an organization was opened on this computer. Set a friendly
              display name so your organization administrator can identify this device.
            </p>
            {(snapshot.pendingOrganizationName || snapshot.pendingOrganizationId) && (
              <p className="m-0 mt-2 text-xs font-semibold text-navy dark:text-slate-100">
                Organization: {snapshot.pendingOrganizationName || snapshot.pendingOrganizationId}
                {snapshot.pendingOrganizationName && snapshot.pendingOrganizationId
                  ? ` (${snapshot.pendingOrganizationId})`
                  : ""}
              </p>
            )}
            {snapshot.pendingEnrollmentExpiresAt && (
              <p className="m-0 mt-1 text-xs text-slatecopy">
                Invitation expires: {formatDate(snapshot.pendingEnrollmentExpiresAt)}
              </p>
            )}
          </div>
        </div>

        <form
          onSubmit={onEnrollSubmit}
          className="mt-2 flex flex-col gap-3 rounded-2xl border border-blue-100/70 bg-white/90 p-4 shadow-inner dark:bg-slate-950/60 dark:border-slate-800"
        >
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="team-device-name"
              className="text-xs font-bold text-navy flex items-center justify-between"
            >
              <span>Device Display Name</span>
              <span className="text-[11px] font-mono text-slatecopy/70">
                {displayNameInput.length}/80
              </span>
            </label>
            <input
              id="team-device-name"
              type="text"
              maxLength={80}
              value={displayNameInput}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              placeholder="e.g., Work Laptop, Devbox, or MacBook Pro"
              disabled={isBusy}
              className="team-input"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <span className="text-[11px] text-slatecopy leading-snug">
              This connects your device to your team’s private catalog. Personal pets and plugins
              remain completely separate.
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="submit"
                disabled={isSubmitDisabled}
                className="btn btn-primary px-5 shrink-0"
              >
                {busy ? "Enrolling..." : "Accept & Enroll"}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={onDiscardEnrollment}
                className="btn btn-compact btn-secondary text-xs shrink-0"
              >
                Discard Invitation
              </button>
              <button
                type="button"
                disabled={isBusy || loading}
                onClick={onRefreshStatus}
                className="btn btn-compact btn-secondary text-xs shrink-0"
              >
                <RefreshIcon />
                Refresh Invitation
              </button>
            </div>
          </div>
        </form>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Distinct Compact Marketing CTA Card */}
      <section className="team-marketing-card">
        {/* Subtle decorative atmosphere glow */}
        <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-blue-400/10 blur-2xl dark:bg-blue-600/15" />

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex items-start gap-4 max-w-xl">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-sm ring-4 ring-brand/10">
              <UsersIcon className="h-6 w-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-monoDisplay text-[10px] font-black uppercase tracking-[.2em] text-brand dark:text-blue-400">
                  Organizations & Fleets
                </span>
              </div>
              <h2 className="m-0 font-monoDisplay text-xl md:text-2xl font-black text-navy dark:text-slate-50 leading-tight">
                Your team. Your pets. Your server.
              </h2>
              <p className="m-0 mt-1.5 text-xs text-slatecopy dark:text-slate-300 leading-relaxed">
                Deploy a private OpenPets server for your company. Give your team its own pets, ship internal plugins,
                and let the pets deliver what matters: code reviews, standups, birthdays, vacation approvals, and announcements.
              </p>

              {/* Feature highlight tags */}
              <div className="flex flex-wrap items-center gap-2 mt-3.5">
                <span className="team-pill">
                  <BuildingIcon className="w-3.5 h-3.5 text-brand dark:text-blue-400" />
                  Private Pet Fleet
                </span>
                <span className="team-pill">
                  <SparklesIcon className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                  Internal Plugins
                </span>
                <span className="team-pill">
                  <ShieldCheckIcon className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  Isolated Workspaces
                </span>
              </div>
            </div>
          </div>

          {/* Marketing CTA Button & External Link Hint */}
          <div className="flex flex-col items-start md:items-end gap-2 shrink-0 pt-2 md:pt-0">
            <button
              type="button"
              className="btn btn-primary gap-2 px-5 py-2.5 text-xs shadow-md"
              onClick={onOpenOrganizationsPage}
            >
              <span>Explore Organizations</span>
              <ArrowUpRightIcon className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
            <button
              type="button"
              className="group inline-flex items-center gap-1 font-mono text-[11px] text-brand/80 dark:text-blue-400 hover:text-brand dark:hover:text-blue-300 transition-colors"
              onClick={onOpenOrganizationsPage}
            >
              <span className="underline decoration-dotted underline-offset-2">openpets.dev/organizations</span>
            </button>
          </div>
        </div>
      </section>

      {/* Member Enrollment Guidance Card */}
      <section className="team-card">
        <div className="flex items-start gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-brand border border-blue-100/60 shadow-sm dark:bg-slate-800 dark:border-slate-700">
            <LaptopIcon />
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-monoDisplay text-[10px] font-black uppercase tracking-[.18em] text-brand block mb-0.5">
              Joining An Existing Organization
            </span>
            <h3 className="m-0 font-monoDisplay text-lg font-black text-navy dark:text-slate-100 leading-tight">
              Have an invitation from your team?
            </h3>
            <p className="m-0 mt-1 text-xs text-slatecopy dark:text-slate-300 leading-relaxed">
              If your workplace already uses OpenPets Teams, your administrator can provide an enrollment link to connect this desktop client.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mt-2">
          <div className="team-guide-step">
            <span className="font-monoDisplay text-[11px] font-black uppercase tracking-wider text-brand">
              1. Get Invitation
            </span>
            <p className="m-0 text-xs text-slatecopy leading-relaxed">
              Ask your team administrator for a deep-link invitation URL.
            </p>
          </div>

          <div className="team-guide-step">
            <span className="font-monoDisplay text-[11px] font-black uppercase tracking-wider text-brand">
              2. Open Link
            </span>
            <p className="m-0 text-xs text-slatecopy leading-relaxed">
              Click the link (
              <code className="font-mono text-[10px] bg-blue-100/70 px-1 py-0.5 rounded dark:bg-slate-800 dark:text-slate-200">
                openpets://teams/enroll...
              </code>
              ) on this computer.
            </p>
          </div>

          <div className="team-guide-step">
            <span className="font-monoDisplay text-[11px] font-black uppercase tracking-wider text-brand">
              3. Auto Sync
            </span>
            <p className="m-0 text-xs text-slatecopy leading-relaxed">
              Your organization’s companions and plugins will appear here automatically.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-blue-50/60 dark:border-slate-800 pt-4 mt-2">
          <span className="text-xs text-slatecopy dark:text-slate-400">Waiting for an enrollment link...</span>
          <button
            type="button"
            className="btn btn-compact btn-secondary text-xs"
            disabled={loading}
            onClick={onRefreshStatus}
          >
            <RefreshIcon />
            <span>Refresh Status</span>
          </button>
        </div>
      </section>

      {/* Privacy Guarantee Card */}
      <div className="flex items-start gap-3.5 rounded-2xl border border-emerald-100/70 bg-emerald-50/40 p-4 text-emerald-900 shadow-sm dark:bg-emerald-950/30 dark:border-emerald-800/40 dark:text-emerald-300">
        <div className="pt-0.5">
          <ShieldCheckIcon />
        </div>
        <div className="flex-1 min-w-0">
          <strong className="block text-xs font-black uppercase tracking-wide text-emerald-950 dark:text-emerald-200">
            Personal Content Isolation Guarantee
          </strong>
          <p className="m-0 mt-0.5 text-xs text-emerald-800 leading-relaxed dark:text-emerald-300">
            Your personal companions from the public catalog, Codex pets, and local developer
            plugins reside in an isolated lane. Joining an organization will never overwrite,
            modify, or delete any of your personal content.
          </p>
        </div>
      </div>
    </div>
  );
}
