import { BrainIcon, MicIcon, SpeakerIcon, WaveformIcon, SparklesIcon, ShieldAlertIcon, ShieldCheckIcon } from "./icons.js";
import {
  getRoleDisplayName,
  getRoleSubtitle,
  isLocalOrSystemProvider,
  profileSupportsRole,
  type ProviderControlCenterSnapshot,
  type ProviderProfileSummary,
  type ProviderRole,
  type ProviderStatus,
} from "./types.js";

export type ProviderRoleOverviewProps = {
  readonly snapshot: ProviderControlCenterSnapshot | null;
  readonly busy: string;
  readonly onSelectRole: (role: ProviderRole, profileId: string | null) => void;
  readonly onOpenCreate: (presetId?: string) => void;
  readonly onOpenEdit: (profile: ProviderProfileSummary) => void;
};

export function ProviderRoleOverview({
  snapshot,
  busy,
  onSelectRole,
  onOpenCreate,
  onOpenEdit,
}: ProviderRoleOverviewProps) {
  const profiles = snapshot?.profiles ?? [];
  const selections = snapshot?.selections ?? { text: null, stt: null, tts: null };
  const statuses = snapshot?.statuses ?? {
    text: { role: "text", state: "disabled", code: "", message: "No text provider selected." },
    stt: { role: "stt", state: "disabled", code: "", message: "No STT provider selected." },
    tts: { role: "tts", state: "disabled", code: "", message: "No TTS provider selected." },
    realtime: { role: "realtime", state: "disabled", code: "", message: "Realtime disabled." },
  };

  const isBusy = Boolean(busy);

  function renderStatusPill(status: ProviderStatus) {
    switch (status.state) {
      case "ready":
        return (
          <span className="pill pill-green flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Ready
          </span>
        );
      case "missing-secret":
        return (
          <span className="pill pill-yellow flex items-center gap-1 font-semibold">
            <ShieldAlertIcon className="w-3.5 h-3.5 text-amber-600" />
            Needs API Key
          </span>
        );
      case "disabled":
        return <span className="pill pill-slate">Disabled</span>;
      case "unsupported":
        return <span className="pill pill-orange">Unsupported</span>;
      case "invalid":
        return <span className="pill pill-red">Invalid Profile</span>;
      default:
        return <span className="pill pill-slate">{status.state}</span>;
    }
  }

  const roles: readonly ProviderRole[] = ["text", "stt", "tts"];

  function getRoleIcon(role: ProviderRole) {
    switch (role) {
      case "text":
        return <BrainIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />;
      case "stt":
        return <MicIcon className="w-6 h-6 text-sky-600 dark:text-sky-400" />;
      case "tts":
        return <SpeakerIcon className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 3 Primary Role Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {roles.map((role) => {
          const activeProfileId = selections[role];
          const activeProfile = profiles.find((p) => p.id === activeProfileId);
          const status = statuses[role];
          const compatibleProfiles = profiles.filter((p) => profileSupportsRole(p, role));
          const isLocal = activeProfile ? isLocalOrSystemProvider(activeProfile) : false;

          return (
            <div
              key={role}
              className={`provider-role-card relative flex flex-col justify-between ${
                activeProfile ? "border-blue-200/80 bg-white dark:bg-slate-900/80" : "bg-white/60 opacity-90"
              }`}
            >
              <div>
                {/* Header */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-50/80 dark:bg-slate-800/80 border border-blue-100/60 dark:border-slate-700/60 shadow-xs">
                      {getRoleIcon(role)}
                    </div>
                    <div>
                      <strong className="block text-sm font-bold text-navy dark:text-slate-100">
                        {getRoleDisplayName(role)}
                      </strong>
                      <span className="text-[11px] text-slatecopy block leading-tight">
                        {getRoleSubtitle(role)}
                      </span>
                    </div>
                  </div>
                  {renderStatusPill(status)}
                </div>

                {/* Profile Selector */}
                <div className="mt-2 mb-2">
                  <label htmlFor={`select-role-${role}`} className="block text-[11px] font-bold text-slatecopy uppercase tracking-wider mb-1">
                    Active Profile
                  </label>
                  <select
                    id={`select-role-${role}`}
                    className="settings-select w-full text-xs font-medium"
                    value={activeProfileId ?? ""}
                    disabled={isBusy}
                    onChange={(e) => onSelectRole(role, e.target.value || null)}
                  >
                    <option value="">Disabled / None</option>
                    {compatibleProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label} {p.model ? `(${p.model})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Metadata & Status Guidance */}
                {activeProfile ? (
                  <div className="rounded-xl border border-blue-100/60 dark:border-slate-800 bg-blue-50/30 dark:bg-slate-800/40 p-2.5 flex flex-col gap-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slatecopy font-semibold truncate max-w-[150px]">
                        {activeProfile.model || activeProfile.label}
                      </span>
                      {isLocal ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                          <ShieldCheckIcon className="w-3.5 h-3.5" />
                          Local (No Key)
                        </span>
                      ) : activeProfile.hasCredential ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                          <ShieldCheckIcon className="w-3.5 h-3.5" />
                          Key Stored
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="text-[11px] font-bold text-amber-700 hover:text-amber-800 underline cursor-pointer"
                          disabled={isBusy}
                          onClick={() => onOpenEdit(activeProfile)}
                        >
                          Set API Key →
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-2.5 text-center text-xs text-slatecopy">
                    {compatibleProfiles.length === 0 ? (
                      <button
                        type="button"
                        className="text-xs font-bold text-brand hover:underline cursor-pointer"
                        disabled={isBusy}
                        onClick={() => onOpenCreate(role === "text" ? "openrouter" : role === "stt" ? "whisper" : "system-tts")}
                      >
                        + Add {getRoleDisplayName(role)} Provider
                      </button>
                    ) : (
                      <span>Select a profile above to activate</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Derived Realtime Voice Callout */}
      <div className="provider-realtime-callout flex flex-col gap-2 rounded-2xl border border-blue-200/70 bg-gradient-to-r from-blue-50/90 via-indigo-50/40 to-purple-50/50 dark:border-slate-700 dark:from-slate-850 dark:to-slate-900 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-brand/10 text-brand">
              <WaveformIcon className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <strong className="text-sm font-bold text-navy dark:text-slate-100">
                  Realtime Voice Mode
                </strong>
                <span className="pill pill-purple text-[10px] py-0.5 px-1.5">Derived</span>
              </div>
              <span className="text-[11px] text-slatecopy">
                Low-latency bidirectional WebRTC voice conversation
              </span>
            </div>
          </div>
          {renderStatusPill(statuses.realtime)}
        </div>
        <p className="text-xs text-slatecopy m-0 pl-10 leading-relaxed">
          {statuses.realtime.state === "ready" ? (
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
              ✓ Active: Your selected Pet Brain profile provides native OpenAI Realtime audio.
            </span>
          ) : (
            <span>
              Realtime voice availability is derived automatically when your active <strong>Pet Brain</strong> profile uses the native OpenAI Realtime adapter. Standard speech recognition and text-to-speech work with all providers.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
