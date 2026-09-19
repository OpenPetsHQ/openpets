import { useState, type ReactNode } from "react";
import { useI18n } from "../../i18n.js";
import {
  BrainIcon,
  CloudIcon,
  EditIcon,
  KeyIcon,
  MicIcon,
  OpenRouterLogo,
  PlusIcon,
  ServerIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SpeakerIcon,
  TrashIcon,
} from "./icons.js";
import {
  isLocalOrSystemProvider,
  profileSupportsRole,
  type ProviderControlCenterSnapshot,
  type ProviderProfileSummary,
  type ProviderRole,
} from "./types.js";

export type ProviderLibraryProps = {
  readonly snapshot: ProviderControlCenterSnapshot | null;
  readonly busy: string;
  readonly onOpenCreate: (presetId?: string) => void;
  readonly onOpenEdit: (profile: ProviderProfileSummary) => void;
  readonly onDeleteProfile: (profileId: string) => void;
  readonly onSelectRole: (role: ProviderRole, profileId: string | null) => void;
  readonly onSaveCredential: (profileId: string, credentialValue: string) => Promise<void>;
  readonly onDeleteCredential: (profileId: string) => Promise<void>;
};

export function ProviderLibrary({
  snapshot,
  busy,
  onOpenCreate,
  onOpenEdit,
  onDeleteProfile,
  onSelectRole,
  onSaveCredential,
  onDeleteCredential,
}: ProviderLibraryProps) {
  const { t } = useI18n();
  const profiles = snapshot?.profiles ?? [];
  const selections = snapshot?.selections ?? { text: null, stt: null, tts: null };

  const [activeKeyDrawerId, setActiveKeyDrawerId] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [keySaving, setKeySaving] = useState(false);

  const isBusy = Boolean(busy) || keySaving;

  function roleName(role: ProviderRole): string {
    return t(`settings.providers.role.${role}.name`);
  }

  async function handleInlineKeySubmit(profileId: string) {
    if (!keyDraft.trim()) return;
    setKeySaving(true);
    try {
      await onSaveCredential(profileId, keyDraft.trim());
      setKeyDraft("");
      setActiveKeyDrawerId(null);
    } finally {
      setKeySaving(false);
    }
  }

  async function handleInlineKeyDelete(profileId: string) {
    setKeySaving(true);
    try {
      await onDeleteCredential(profileId);
      setActiveKeyDrawerId(null);
    } finally {
      setKeySaving(false);
    }
  }

  function getProfileIcon(profile: ProviderProfileSummary) {
    if (profile.id.includes("openrouter") || profile.baseUrl?.includes("openrouter.ai")) {
      return <OpenRouterLogo className="w-5 h-5 text-purple-600 dark:text-purple-400" />;
    }
    if (profile.adapter === "system-tts") {
      return <SpeakerIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />;
    }
    if (isLocalOrSystemProvider(profile)) {
      return <ServerIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />;
    }
    return <CloudIcon className="w-5 h-5 text-brand" />;
  }

  function renderAssignButton(profile: ProviderProfileSummary, role: ProviderRole, icon: ReactNode) {
    const isSelected = selections[role] === profile.id;
    return (
      <button
        type="button"
        className={`btn btn-compact text-xs flex items-center gap-1 ${
          isSelected ? "btn-success" : "btn-secondary"
        }`}
        disabled={isBusy}
        title={
          isSelected
            ? t("settings.providers.library.assignHintActive", { role: roleName(role) })
            : t("settings.providers.library.assignHintInactive", { role: roleName(role) })
        }
        onClick={() => onSelectRole(role, isSelected ? null : profile.id)}
      >
        {icon}
        <span>
          {isSelected
            ? t("settings.providers.library.assigned", { role: roleName(role) })
            : t("settings.providers.library.assign", { role: roleName(role) })}
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4 mt-2">
      {/* Library Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-monoDisplay text-lg font-black text-navy dark:text-slate-100 m-0">
            {t("settings.providers.library.title", { count: profiles.length })}
          </h3>
          <p className="text-xs text-slatecopy m-0">
            {t("settings.providers.library.subtitle")}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-compact flex items-center gap-1.5"
          disabled={isBusy}
          onClick={() => onOpenCreate()}
        >
          <PlusIcon className="w-4 h-4" />
          <span>{t("settings.providers.library.add")}</span>
        </button>
      </div>

      {/* Profiles List */}
      {profiles.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-blue-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/40 p-8 text-center flex flex-col items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 dark:bg-slate-800 text-brand">
            <CloudIcon className="w-6 h-6" />
          </div>
          <div>
            <strong className="block text-sm font-bold text-navy dark:text-slate-100">
              {t("settings.providers.library.empty.title")}
            </strong>
            <p className="text-xs text-slatecopy max-w-md mt-1">
              {t("settings.providers.library.empty.body")}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-compact mt-1"
            disabled={isBusy}
            onClick={() => onOpenCreate("openrouter")}
          >
            {t("settings.providers.library.empty.cta")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {profiles.map((profile) => {
            const isSelectedText = selections.text === profile.id;
            const isSelectedStt = selections.stt === profile.id;
            const isSelectedTts = selections.tts === profile.id;
            const isSelectedAny = isSelectedText || isSelectedStt || isSelectedTts;
            const isLocal = isLocalOrSystemProvider(profile);
            const isKeyDrawerOpen = activeKeyDrawerId === profile.id;

            return (
              <div
                key={profile.id}
                className="provider-profile-card rounded-[22px] border border-blue-100/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4.5 shadow-xs transition-all hover:border-blue-200 dark:hover:border-slate-700"
              >
                {/* Header: identity on the left, manage actions on the right */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50/70 dark:bg-slate-800 border border-blue-100/50 dark:border-slate-700">
                      {getProfileIcon(profile)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm font-bold text-navy dark:text-slate-100">
                          {profile.label}
                        </strong>
                        <span className="pill pill-blue text-[10px] py-0.5">
                          {t(`settings.providers.adapter.${profile.adapter}`)}
                        </span>
                      </div>

                      {/* Model & Endpoint Subtitle */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slatecopy mt-1 font-medium">
                        {profile.model && (
                          <span className="truncate max-w-full">
                            {t("settings.providers.library.model")}{" "}
                            <code className="font-mono text-navy dark:text-slate-200 font-semibold">{profile.model}</code>
                          </span>
                        )}
                        {profile.baseUrl && (
                          <span className="truncate max-w-full">
                            {t("settings.providers.library.endpoint")}{" "}
                            <code className="font-mono text-navy dark:text-slate-200 opacity-80">{profile.baseUrl}</code>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact text-xs flex items-center gap-1"
                      disabled={isBusy}
                      onClick={() => onOpenEdit(profile)}
                      title={t("settings.providers.library.editHint")}
                    >
                      <EditIcon className="w-3.5 h-3.5" />
                      <span>{t("settings.providers.library.edit")}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact text-xs text-red-600 hover:text-red-700 hover:border-red-200"
                      disabled={isBusy || isSelectedAny}
                      title={
                        isSelectedAny
                          ? t("settings.providers.library.deleteBlocked")
                          : t("settings.providers.library.deleteHint")
                      }
                      onClick={() => onDeleteProfile(profile.id)}
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Footer: role assignment toggles (they show and switch state) + key status */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-blue-50/70 dark:border-slate-800 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {profileSupportsRole(profile, "text") &&
                      renderAssignButton(profile, "text", <BrainIcon className="w-3.5 h-3.5" />)}
                    {profileSupportsRole(profile, "stt") &&
                      renderAssignButton(profile, "stt", <MicIcon className="w-3.5 h-3.5" />)}
                    {profileSupportsRole(profile, "tts") &&
                      renderAssignButton(profile, "tts", <SpeakerIcon className="w-3.5 h-3.5" />)}
                  </div>

                  {/* Right: Key Status & Fast Key Affordance */}
                  <div className="flex items-center gap-2">
                    {isLocal ? (
                      <span className="inline-flex items-center gap-1 text-xs text-slatecopy font-semibold">
                        <ShieldCheckIcon className="w-3.5 h-3.5 text-emerald-600" />
                        {t("settings.providers.library.localNoKey")}
                      </span>
                    ) : profile.hasCredential ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
                          <ShieldCheckIcon className="w-3.5 h-3.5" />
                          {t("settings.providers.library.keySaved")}
                        </span>
                        <button
                          type="button"
                          className="text-[11px] font-bold text-brand hover:underline cursor-pointer"
                          disabled={isBusy}
                          onClick={() => {
                            setActiveKeyDrawerId(isKeyDrawerOpen ? null : profile.id);
                            setKeyDraft("");
                          }}
                        >
                          {isKeyDrawerOpen
                            ? t("settings.providers.library.closeKey")
                            : t("settings.providers.library.changeKey")}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 font-semibold">
                          <ShieldAlertIcon className="w-3.5 h-3.5" />
                          {t("settings.providers.library.keyMissing")}
                        </span>
                        <button
                          type="button"
                          className="btn btn-compact btn-warning text-xs py-0.5"
                          disabled={isBusy}
                          onClick={() => {
                            setActiveKeyDrawerId(isKeyDrawerOpen ? null : profile.id);
                            setKeyDraft("");
                          }}
                        >
                          {t("settings.providers.library.setKey")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Inline Fast Key Drawer */}
                {isKeyDrawerOpen && profile.secretRef && (
                  <div className="mt-3 rounded-xl border border-blue-200/80 dark:border-slate-700 bg-blue-50/40 dark:bg-slate-800/60 p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <strong className="text-xs font-bold text-navy dark:text-slate-100 flex items-center gap-1.5">
                        <KeyIcon className="w-3.5 h-3.5 text-brand" />
                        {profile.hasCredential
                          ? t("settings.providers.library.drawer.update")
                          : t("settings.providers.library.drawer.enter")}
                      </strong>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        type="password"
                        className="settings-select flex-1 text-xs font-mono"
                        placeholder={t("settings.providers.library.drawer.placeholder")}
                        value={keyDraft}
                        disabled={isBusy}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleInlineKeySubmit(profile.id);
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-compact text-xs"
                        disabled={isBusy || !keyDraft.trim()}
                        onClick={() => void handleInlineKeySubmit(profile.id)}
                      >
                        {keySaving
                          ? t("settings.providers.library.drawer.saving")
                          : t("settings.providers.library.drawer.save")}
                      </button>
                      {profile.hasCredential && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact text-xs text-red-600 hover:text-red-700"
                          disabled={isBusy}
                          onClick={() => void handleInlineKeyDelete(profile.id)}
                        >
                          {t("settings.providers.library.drawer.remove")}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact text-xs"
                        disabled={isBusy}
                        onClick={() => setActiveKeyDrawerId(null)}
                      >
                        {t("settings.providers.library.drawer.cancel")}
                      </button>
                    </div>
                    <p className="text-[11px] text-slatecopy m-0">
                      {t("settings.providers.library.drawer.note")}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
