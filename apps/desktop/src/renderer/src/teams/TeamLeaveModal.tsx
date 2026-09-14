import { CloseIcon, LogOutIcon } from "./teams-icons.js";

export type TeamLeaveModalProps = {
  readonly isOpen: boolean;
  readonly organizationName: string;
  readonly teamPetsCount: number;
  readonly teamPluginsCount: number;
  readonly busy: string;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
};

export function TeamLeaveModal({
  isOpen,
  organizationName,
  teamPetsCount,
  teamPluginsCount,
  busy,
  onClose,
  onConfirm,
}: TeamLeaveModalProps) {
  if (!isOpen) return null;

  const isBusy = Boolean(busy);

  return (
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
        onClick={() => !isBusy && onClose()}
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
            disabled={isBusy}
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <p className="m-0 text-xs text-slatecopy leading-relaxed">
          Are you sure you want to disconnect this computer from{" "}
          <strong className="text-navy dark:text-slate-100">{organizationName}</strong>?
        </p>

        <div className="rounded-xl border border-red-100 bg-red-50/50 dark:bg-red-950/30 dark:border-red-900/50 p-3 text-xs text-red-900 dark:text-red-300 leading-relaxed">
          <ul className="m-0 pl-4 list-disc space-y-1">
            <li>
              All <strong>{teamPetsCount} team pets</strong> and{" "}
              <strong>{teamPluginsCount} team plugins</strong> will be cleanly removed from this
              machine.
            </li>
            <li>
              Your personal catalog pets, Codex pets, and local developer plugins will{" "}
              <strong>not</strong> be affected.
            </li>
            <li>You can re-enroll at any time with a new invitation link.</li>
          </ul>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            className="btn btn-compact btn-secondary text-xs"
            disabled={isBusy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-compact btn-danger text-xs"
            disabled={isBusy}
            onClick={onConfirm}
          >
            {busy ? "Leaving..." : "Yes, Leave Organization"}
          </button>
        </div>
      </div>
    </div>
  );
}
