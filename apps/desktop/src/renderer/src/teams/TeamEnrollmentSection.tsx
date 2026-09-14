import type React from "react";
import { BuildingIcon, LaptopIcon, RefreshIcon, ShieldCheckIcon } from "./teams-icons.js";
import type { TeamsSnapshot } from "./teams-types.js";

export type TeamEnrollmentSectionProps = {
  readonly snapshot: TeamsSnapshot;
  readonly busy: string;
  readonly loading: boolean;
  readonly displayNameInput: string;
  readonly onDisplayNameChange: (value: string) => void;
  readonly onEnrollSubmit: (e?: React.FormEvent) => void;
  readonly onRefreshStatus: () => void;
};

export function TeamEnrollmentSection({
  snapshot,
  busy,
  loading,
  displayNameInput,
  onDisplayNameChange,
  onEnrollSubmit,
  onRefreshStatus,
}: TeamEnrollmentSectionProps) {
  const isBusy = Boolean(busy);
  const isSubmitDisabled = isBusy || !displayNameInput.trim();

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
                {displayNameInput.length}/120
              </span>
            </label>
            <input
              id="team-device-name"
              type="text"
              maxLength={120}
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
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="btn btn-primary px-5 shrink-0"
            >
              {busy ? "Enrolling..." : "Accept & Enroll"}
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
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
              OpenPets Teams allows engineering teams and organizations to securely distribute
              company-curated companions, shared workflow plugins, and team configurations directly
              to your desktop.
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
          <span className="text-xs text-slatecopy">Waiting for an enrollment link...</span>
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
