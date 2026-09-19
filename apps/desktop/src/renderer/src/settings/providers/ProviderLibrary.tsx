import { useState } from "react";
import {
  BrainIcon,
  CheckIcon,
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
  getAdapterFriendlyLabel,
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
  const profiles = snapshot?.profiles ?? [];
  const selections = snapshot?.selections ?? { text: null, stt: null, tts: null };
  const presets = snapshot?.presets ?? [];

  const [activeKeyDrawerId, setActiveKeyDrawerId] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [keySaving, setKeySaving] = useState(false);

  const isBusy = Boolean(busy) || keySaving;

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

  return (
    <div className="flex flex-col gap-4 mt-2">
      {/* Library Header & Quick Add */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-monoDisplay text-lg font-black text-navy dark:text-slate-100 m-0">
            Configured Providers ({profiles.length})
          </h3>
          <p className="text-xs text-slatecopy m-0">
            Manage your saved AI model configurations and API credentials.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-compact flex items-center gap-1.5"
          disabled={isBusy}
          onClick={() => onOpenCreate()}
        >
          <PlusIcon className="w-4 h-4" />
          <span>Add Provider</span>
        </button>
      </div>

      {/* Quick Add Presets Bar */}
      <div className="rounded-2xl border border-blue-100/70 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-3.5 shadow-xs">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold text-slatecopy uppercase tracking-wider">
            Quick Add Templates
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => {
            const isFeatured = preset.id === "openrouter";
            return (
              <button
                key={preset.id}
                type="button"
                className={`provider-preset-chip text-xs ${
                  isFeatured
                    ? "border-purple-200 bg-purple-50/80 text-purple-900 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-200 font-bold hover:border-purple-400"
                    : ""
                }`}
                disabled={isBusy}
                onClick={() => onOpenCreate(preset.id)}
              >
                {isFeatured && <OpenRouterLogo className="w-3.5 h-3.5" />}
                <span>+ {preset.label}</span>
                <span className="opacity-60 text-[10px] font-mono">
                  ({preset.credentialMode === "none" ? "Local" : "Cloud"})
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Profiles List */}
      {profiles.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-blue-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/40 p-8 text-center flex flex-col items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 dark:bg-slate-800 text-brand">
            <CloudIcon className="w-6 h-6" />
          </div>
          <div>
            <strong className="block text-sm font-bold text-navy dark:text-slate-100">
              No Provider Profiles Configured
            </strong>
            <p className="text-xs text-slatecopy max-w-md mt-1">
              Add your first AI model or voice provider using one of the templates above or by creating a custom endpoint.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-compact mt-1"
            disabled={isBusy}
            onClick={() => onOpenCreate("openrouter")}
          >
            Add OpenRouter (Recommended)
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

            const supportsText = profileSupportsRole(profile, "text");
            const supportsStt = profileSupportsRole(profile, "stt");
            const supportsTts = profileSupportsRole(profile, "tts");

            return (
              <div
                key={profile.id}
                className="provider-profile-card rounded-[22px] border border-blue-100/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4.5 shadow-xs transition-all hover:border-blue-200 dark:hover:border-slate-700"
              >
                {/* Main Card Header */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50/70 dark:bg-slate-800 border border-blue-100/50 dark:border-slate-700">
                      {getProfileIcon(profile)}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm font-bold text-navy dark:text-slate-100">
                          {profile.label}
                        </strong>
                        <span className="pill pill-slate font-mono text-[10px] py-0.5">
                          {profile.id}
                        </span>
                        <span className="pill pill-blue text-[10px] py-0.5">
                          {getAdapterFriendlyLabel(profile.adapter)}
                        </span>
                        {profile.adapter === "openai-realtime" && (
                          <span className="pill pill-purple text-[10px] py-0.5">
                            Realtime Voice
                          </span>
                        )}
                      </div>

                      {/* Model & Endpoint Subtitle */}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slatecopy mt-1 font-medium">
                        {profile.model && (
                          <span>
                            Model: <code className="font-mono text-navy dark:text-slate-200 font-semibold">{profile.model}</code>
                          </span>
                        )}
                        {profile.baseUrl && (
                          <span>
                            Endpoint: <code className="font-mono text-navy dark:text-slate-200 opacity-80">{profile.baseUrl}</code>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Toolbar */}
                  <div className="flex items-center gap-1.5">
                    {/* Quick Assign Buttons */}
                    {supportsText && (
                      <button
                        type="button"
                        className={`btn btn-compact text-xs flex items-center gap-1 ${
                          isSelectedText ? "btn-success" : "btn-secondary"
                        }`}
                        disabled={isBusy}
                        title={isSelectedText ? "Currently active as Pet Brain (Click to unassign)" : "Set as active Pet Brain"}
                        onClick={() => onSelectRole("text", isSelectedText ? null : profile.id)}
                      >
                        <BrainIcon className="w-3.5 h-3.5" />
                        <span>{isSelectedText ? "Brain ✓" : "Set Brain"}</span>
                      </button>
                    )}
                    {supportsStt && (
                      <button
                        type="button"
                        className={`btn btn-compact text-xs flex items-center gap-1 ${
                          isSelectedStt ? "btn-success" : "btn-secondary"
                        }`}
                        disabled={isBusy}
                        title={isSelectedStt ? "Currently active as Hearing (Click to unassign)" : "Set as active Hearing"}
                        onClick={() => onSelectRole("stt", isSelectedStt ? null : profile.id)}
                      >
                        <MicIcon className="w-3.5 h-3.5" />
                        <span>{isSelectedStt ? "Hearing ✓" : "Set Hearing"}</span>
                      </button>
                    )}
                    {supportsTts && (
                      <button
                        type="button"
                        className={`btn btn-compact text-xs flex items-center gap-1 ${
                          isSelectedTts ? "btn-success" : "btn-secondary"
                        }`}
                        disabled={isBusy}
                        title={isSelectedTts ? "Currently active as Speech (Click to unassign)" : "Set as active Speech"}
                        onClick={() => onSelectRole("tts", isSelectedTts ? null : profile.id)}
                      >
                        <SpeakerIcon className="w-3.5 h-3.5" />
                        <span>{isSelectedTts ? "Speech ✓" : "Set Speech"}</span>
                      </button>
                    )}

                    {/* Edit Profile */}
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact text-xs flex items-center gap-1"
                      disabled={isBusy}
                      onClick={() => onOpenEdit(profile)}
                      title="Edit profile settings"
                    >
                      <EditIcon className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>

                    {/* Delete Profile */}
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact text-xs text-red-600 hover:text-red-700 hover:border-red-200"
                      disabled={isBusy || isSelectedAny}
                      title={
                        isSelectedAny
                          ? "Cannot delete profile while assigned to active roles. Unassign first."
                          : "Delete this provider profile"
                      }
                      onClick={() => onDeleteProfile(profile.id)}
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Status Bar / Key info */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-blue-50/70 dark:border-slate-800 text-xs">
                  {/* Left: Active Role Badges */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slatecopy uppercase tracking-wider mr-1">
                      Role:
                    </span>
                    {isSelectedText && (
                      <span className="pill pill-green flex items-center gap-1 text-[11px]">
                        <BrainIcon className="w-3 h-3 text-emerald-700 dark:text-emerald-300" />
                        Pet Brain
                      </span>
                    )}
                    {isSelectedStt && (
                      <span className="pill pill-green flex items-center gap-1 text-[11px]">
                        <MicIcon className="w-3 h-3 text-emerald-700 dark:text-emerald-300" />
                        Hearing
                      </span>
                    )}
                    {isSelectedTts && (
                      <span className="pill pill-green flex items-center gap-1 text-[11px]">
                        <SpeakerIcon className="w-3 h-3 text-emerald-700 dark:text-emerald-300" />
                        Speech
                      </span>
                    )}
                    {!isSelectedAny && (
                      <span className="pill pill-slate text-[11px]">Not assigned</span>
                    )}
                  </div>

                  {/* Right: Key Status & Fast Key Affordance */}
                  <div className="flex items-center gap-2">
                    {isLocal ? (
                      <span className="inline-flex items-center gap-1 text-xs text-slatecopy font-semibold">
                        <ShieldCheckIcon className="w-3.5 h-3.5 text-emerald-600" />
                        Local / System (No key needed)
                      </span>
                    ) : profile.hasCredential ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
                          <ShieldCheckIcon className="w-3.5 h-3.5" />
                          API Key Saved
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
                          {isKeyDrawerOpen ? "Close" : "Change Key"}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 font-semibold">
                          <ShieldAlertIcon className="w-3.5 h-3.5" />
                          Key Missing
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
                          Set Key
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
                        {profile.hasCredential ? "Update API Credential" : "Enter API Credential"}
                      </strong>
                      <span className="text-[11px] font-mono text-slatecopy">
                        ref: {profile.secretRef}
                      </span>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        type="password"
                        className="settings-select flex-1 text-xs font-mono"
                        placeholder="Paste secret API key (e.g. sk-or-v1-...)"
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
                        {keySaving ? "Saving..." : "Save Key"}
                      </button>
                      {profile.hasCredential && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact text-xs text-red-600 hover:text-red-700"
                          disabled={isBusy}
                          onClick={() => void handleInlineKeyDelete(profile.id)}
                        >
                          Remove Key
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact text-xs"
                        disabled={isBusy}
                        onClick={() => setActiveKeyDrawerId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="text-[11px] text-slatecopy m-0">
                      Keys are stored securely in your OS keychain / host secret store and never exposed in snapshots.
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
