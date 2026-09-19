import { useI18n } from "../../i18n.js";
import { BrainIcon, MicIcon, SpeakerIcon, WaveformIcon, ShieldAlertIcon, ShieldCheckIcon } from "./icons.js";
import {
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

const ROLE_DEFAULT_PRESET: Record<ProviderRole, string> = {
  text: "openrouter",
  stt: "whisper",
  tts: "system-tts",
};

export function ProviderRoleOverview({
  snapshot,
  busy,
  onSelectRole,
  onOpenCreate,
  onOpenEdit,
}: ProviderRoleOverviewProps) {
  const { t } = useI18n();
  const profiles = snapshot?.profiles ?? [];
  const selections = snapshot?.selections ?? { text: null, stt: null, tts: null };
  const statuses = snapshot?.statuses ?? {
    text: { role: "text", state: "disabled", code: "", message: "No text provider selected." },
    stt: { role: "stt", state: "disabled", code: "", message: "No STT provider selected." },
    tts: { role: "tts", state: "disabled", code: "", message: "No TTS provider selected." },
    realtime: { role: "realtime", state: "disabled", code: "", message: "Realtime disabled." },
  };

  const isBusy = Boolean(busy);

  function roleName(role: ProviderRole): string {
    return t(`settings.providers.role.${role}.name`);
  }

  function renderStatusPill(status: ProviderStatus) {
    switch (status.state) {
      case "ready":
        return (
          <span className="pill pill-green flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {t("settings.providers.status.ready")}
          </span>
        );
      case "missing-secret":
        return (
          <span className="pill pill-yellow flex items-center gap-1 font-semibold">
            <ShieldAlertIcon className="w-3.5 h-3.5 text-amber-600" />
            {t("settings.providers.status.needsKey")}
          </span>
        );
      case "disabled":
        return <span className="pill pill-slate">{t("settings.providers.status.off")}</span>;
      case "unsupported":
        return <span className="pill pill-orange">{t("settings.providers.status.unsupported")}</span>;
      case "invalid":
        return <span className="pill pill-red">{t("settings.providers.status.invalid")}</span>;
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

  function renderRoleContextLine(
    role: ProviderRole,
    activeProfile: ProviderProfileSummary | undefined,
    compatibleProfileCount: number,
  ) {
    if (activeProfile) {
      const isLocal = isLocalOrSystemProvider(activeProfile);
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className="font-semibold text-slatecopy truncate max-w-[260px]">
            {activeProfile.model || activeProfile.label}
          </span>
          {isLocal ? (
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
              <ShieldCheckIcon className="w-3.5 h-3.5" />
              {t("settings.providers.role.local")}
            </span>
          ) : activeProfile.hasCredential ? (
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
              <ShieldCheckIcon className="w-3.5 h-3.5" />
              {t("settings.providers.role.keyStored")}
            </span>
          ) : (
            <button
              type="button"
              className="font-bold text-amber-700 hover:text-amber-800 underline cursor-pointer"
              disabled={isBusy}
              onClick={() => onOpenEdit(activeProfile)}
            >
              {t("settings.providers.role.setKey")}
            </button>
          )}
        </div>
      );
    }

    if (compatibleProfileCount === 0) {
      return (
        <button
          type="button"
          className="self-start text-[11px] font-bold text-brand hover:underline cursor-pointer"
          disabled={isBusy}
          onClick={() => onOpenCreate(ROLE_DEFAULT_PRESET[role])}
        >
          {t("settings.providers.role.addFirst", { role: roleName(role) })}
        </button>
      );
    }

    return (
      <span className="text-[11px] text-slatecopy">
        {t("settings.providers.role.choose")}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* One full-width row per companion role: identity → profile picker → status */}
      {roles.map((role) => {
        const activeProfileId = selections[role];
        const activeProfile = profiles.find((p) => p.id === activeProfileId);
        const status = statuses[role];
        const compatibleProfiles = profiles.filter((p) => profileSupportsRole(p, role));

        return (
          <div
            key={role}
            className={`provider-role-card sm:flex-row sm:items-center sm:gap-5 ${
              activeProfile ? "border-blue-200/80 bg-white dark:bg-slate-900/80" : "bg-white/60"
            }`}
          >
            {/* Role identity */}
            <div className="flex items-center gap-3 sm:w-56 shrink-0">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-blue-50/80 dark:bg-slate-800/80 border border-blue-100/60 dark:border-slate-700/60 shadow-xs">
                {getRoleIcon(role)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <strong className="text-sm font-bold text-navy dark:text-slate-100">
                    {roleName(role)}
                  </strong>
                  <span className="sm:hidden">{renderStatusPill(status)}</span>
                </div>
                <span className="block text-[11px] text-slatecopy leading-tight">
                  {t(`settings.providers.role.${role}.subtitle`)}
                </span>
              </div>
            </div>

            {/* Active profile picker + context */}
            <div className="flex flex-1 min-w-0 flex-col gap-1.5">
              <label htmlFor={`select-role-${role}`} className="sr-only">
                {t("settings.providers.role.selectLabel", { role: roleName(role) })}
              </label>
              <select
                id={`select-role-${role}`}
                className="settings-select w-full text-xs font-medium"
                value={activeProfileId ?? ""}
                disabled={isBusy}
                onChange={(e) => onSelectRole(role, e.target.value || null)}
              >
                <option value="">{t("settings.providers.role.selectNone")}</option>
                {compatibleProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} {p.model ? `(${p.model})` : ""}
                  </option>
                ))}
              </select>
              {renderRoleContextLine(role, activeProfile, compatibleProfiles.length)}
            </div>

            {/* Status */}
            <div className="hidden sm:block shrink-0">{renderStatusPill(status)}</div>
          </div>
        );
      })}

      {/* Realtime Voice: derived from the Pet Brain profile, shown as a compact footnote row */}
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-blue-200/70 dark:border-slate-700 bg-blue-50/40 dark:bg-slate-900/40 px-4 py-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
          <WaveformIcon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <strong className="text-sm font-bold text-navy dark:text-slate-100">
              {t("settings.providers.realtime.title")}
            </strong>
            <span className="pill pill-purple text-[10px] py-0.5 px-1.5">
              {t("settings.providers.realtime.badge")}
            </span>
          </div>
          <span className="block text-[11px] text-slatecopy leading-tight">
            {statuses.realtime.state === "ready"
              ? t("settings.providers.realtime.active")
              : t("settings.providers.realtime.hint")}
          </span>
        </div>
        <div className="shrink-0">{renderStatusPill(statuses.realtime)}</div>
      </div>
    </div>
  );
}
