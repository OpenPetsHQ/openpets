import { useState, useEffect } from "react";
import {
  BrainIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  KeyIcon,
  MicIcon,
  OpenRouterLogo,
  PlusIcon,
  ShieldCheckIcon,
  SpeakerIcon,
  TrashIcon,
} from "./icons.js";
import {
  PROVIDER_PRESETS,
  getPresetById,
  generateRandomProfileId,
  type ProviderPresetItem,
} from "./presets.js";
import {
  getAdapterExplainer,
  getAdapterFriendlyLabel,
  getDefaultAuthHeader,
  getDefaultAuthStrategy,
  isLocalOrSystemProvider,
  profileSupportsRole,
  type ProviderAdapter,
  type ProviderAuth,
  type ProviderHeaderPatch,
  type ProviderConfigurationSaveInput,
  type ProviderProfileInput,
  type ProviderProfilePatch,
  type ProviderProfileSummary,
  type ProviderRole,
  type ProviderSelections,
} from "./types.js";

export type ProviderModalProps = {
  readonly isOpen: boolean;
  readonly editingProfile: ProviderProfileSummary | null;
  readonly initialPresetId?: string;
  readonly currentSelections: ProviderSelections;
  readonly busy: string;
  readonly onClose: () => void;
  readonly onSave: (params: ProviderConfigurationSaveInput) => Promise<void>;
};

type HeaderDraft = {
  readonly key: string;
  readonly originalName?: string;
  readonly name: string;
  readonly value: string;
  readonly deleted?: boolean;
};

export function ProviderModal({
  isOpen,
  editingProfile,
  initialPresetId,
  currentSelections,
  busy,
  onClose,
  onSave,
}: ProviderModalProps) {
  if (!isOpen) return null;

  const isEditing = Boolean(editingProfile);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    initialPresetId ?? (isEditing ? "" : "openrouter")
  );

  // Form State
  const [profileId, setProfileId] = useState("");
  const [label, setLabel] = useState("");
  const [adapter, setAdapter] = useState<ProviderAdapter>("openai-compatible-text");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [secretRef, setSecretRef] = useState<string | undefined>(undefined);
  const [inlineKey, setInlineKey] = useState("");

  // Role activations
  const [activateBrain, setActivateBrain] = useState(false);
  const [activateHearing, setActivateHearing] = useState(false);
  const [activateSpeech, setActivateSpeech] = useState(false);

  // Advanced section
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customAuth, setCustomAuth] = useState<ProviderAuth | null>(null);
  const [authEdited, setAuthEdited] = useState(false);
  const [headers, setHeaders] = useState<HeaderDraft[]>([]);
  const [headersEdited, setHeadersEdited] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize draft when modal opens or editingProfile changes
  useEffect(() => {
    if (editingProfile) {
      setProfileId(editingProfile.id);
      setLabel(editingProfile.label);
      setAdapter(editingProfile.adapter);
      setModel(editingProfile.model);
      setBaseUrl(editingProfile.baseUrl ?? "");
      setSecretRef(editingProfile.secretRef);
      setCustomAuth(editingProfile.auth ?? null);
      setAuthEdited(false);
      setHeaders(editingProfile.headerNames.map((name) => ({ key: `existing-${name}`, originalName: name, name, value: "" })));
      setHeadersEdited(false);
      setInlineKey("");

      setActivateBrain(currentSelections.text === editingProfile.id);
      setActivateHearing(currentSelections.stt === editingProfile.id);
      setActivateSpeech(currentSelections.tts === editingProfile.id);
      setShowAdvanced(Boolean(editingProfile.auth || editingProfile.headerNames?.length > 0));
    } else {
      const preset = getPresetById(selectedPresetId) ?? PROVIDER_PRESETS[0];
      applyPreset(preset);
    }
  }, [editingProfile, isOpen]);

  function applyPreset(preset: ProviderPresetItem) {
    const id = generateRandomProfileId(preset.id);
    setSelectedPresetId(preset.id);
    setProfileId(id);
    setLabel(preset.label);
    setAdapter(preset.adapter);
    setModel(preset.model);
    setBaseUrl(preset.baseUrl ?? "");
    setSecretRef(preset.credentialMode === "required" ? `${id}-credential` : undefined);
    setCustomAuth(null);
    setAuthEdited(false);
    setInlineKey("");

    if (preset.suggestedHeaders && preset.suggestedHeaders.length > 0) {
      setHeaders(preset.suggestedHeaders.map((header, index) => ({ ...header, key: `suggested-${index}` })));
      setHeadersEdited(true);
    } else {
      setHeaders([]);
      setHeadersEdited(false);
    }

    // Default role activation
    setActivateBrain(preset.defaultRoles.includes("text"));
    setActivateHearing(preset.defaultRoles.includes("stt"));
    setActivateSpeech(preset.defaultRoles.includes("tts"));
  }

  const supportsText = profileSupportsRole({ adapter }, "text");
  const supportsStt = profileSupportsRole({ adapter }, "stt");
  const supportsTts = profileSupportsRole({ adapter }, "tts");
  const isLocal = isLocalOrSystemProvider({ adapter, baseUrl, secretRef });

  async function handleSubmit(shouldActivateRoles: boolean) {
    setFormError(null);

    const trimmedId = profileId.trim();
    const trimmedLabel = label.trim();
    const trimmedModel = model.trim();
    const trimmedBaseUrl = baseUrl.trim();

    if (!trimmedId) {
      setFormError("Profile ID is required.");
      return;
    }
    if (!trimmedLabel) {
      setFormError("Display Label is required.");
      return;
    }
    if (adapter !== "system-tts" && !trimmedModel) {
      setFormError("Model Identifier is required.");
      return;
    }
    if (adapter !== "system-tts" && !trimmedBaseUrl) {
      setFormError("Base Endpoint URL is required.");
      return;
    }

    const headerPatch: ProviderHeaderPatch[] = [];
    if (isEditing && headersEdited) {
      for (const header of headers) {
        if (header.deleted) {
          if (header.originalName) headerPatch.push({ op: "delete", name: header.originalName });
          continue;
        }
        const name = header.name.trim();
        const value = header.value.trim();
        if (header.originalName) {
          if (name !== header.originalName || value) {
            headerPatch.push({ op: "replace", oldName: header.originalName, name, value });
          }
        } else if (name || value) {
          headerPatch.push({ op: "add", name, value });
        }
      }
    }

    const payload: ProviderProfileInput | ProviderProfilePatch = isEditing
      ? {
          id: trimmedId,
          label: trimmedLabel,
          adapter,
          model: trimmedModel,
          baseUrl: adapter === "system-tts" ? null : trimmedBaseUrl || null,
          secretRef: adapter === "system-tts" ? null : secretRef?.trim() || null,
          auth: adapter === "system-tts" ? null : authEdited ? customAuth : undefined,
          ...(adapter === "system-tts"
            ? { headers: [] }
            : headersEdited
              ? { headerPatch }
              : {}),
        }
      : {
          id: trimmedId,
          label: trimmedLabel,
          adapter,
          model: trimmedModel,
          ...(adapter === "system-tts"
            ? {}
            : {
                baseUrl: trimmedBaseUrl || undefined,
                secretRef: secretRef?.trim() || undefined,
                auth: customAuth ?? undefined,
                headers: headers
                  .filter((header) => !header.deleted)
                  .map(({ name, value }) => ({ name, value })),
              }),
        };

    const activatedRoles: ProviderRole[] = [];
    const deactivatedRoles: ProviderRole[] = [];

    if (shouldActivateRoles) {
      if (supportsText) {
        if (activateBrain) activatedRoles.push("text");
        else if (isEditing && currentSelections.text === trimmedId) deactivatedRoles.push("text");
      }
      if (supportsStt) {
        if (activateHearing) activatedRoles.push("stt");
        else if (isEditing && currentSelections.stt === trimmedId) deactivatedRoles.push("stt");
      }
      if (supportsTts) {
        if (activateSpeech) activatedRoles.push("tts");
        else if (isEditing && currentSelections.tts === trimmedId) deactivatedRoles.push("tts");
      }
    }

    setIsSaving(true);
    try {
      await onSave({
        isEditing,
        profileId: trimmedId,
        payload,
        credentialValue: inlineKey.trim() || undefined,
        activatedRoles,
        deactivatedRoles,
      });
      onClose();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to save profile.");
    } finally {
      setIsSaving(false);
    }
  }

  const isBusy = Boolean(busy) || isSaving;

  return (
    <div
      className="plugin-config-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? `Edit Provider ${profileId}` : "Add AI & Voice Provider"}
    >
      <button
        className="plugin-config-backdrop"
        type="button"
        aria-label="Close dialog"
        onClick={() => !isBusy && onClose()}
      />
      <div className="relative z-10 flex max-h-[calc(100vh-4rem)] w-[min(640px,calc(100vw-3rem))] flex-col gap-4 rounded-[28px] border border-blue-100/80 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 border-b border-blue-50 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand">
              <BrainIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="m-0 font-monoDisplay text-xl font-black text-navy dark:text-slate-100">
                {isEditing ? `Edit Provider (${profileId})` : "Add AI & Voice Provider"}
              </h3>
              <p className="text-xs text-slatecopy m-0">
                Configure model endpoints, API keys, and active companion roles.
              </p>
            </div>
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

        {/* Template Selector (Shown when creating new profile) */}
        {!isEditing && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold text-slatecopy uppercase tracking-wider">
              Choose Provider Template
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PROVIDER_PRESETS.map((preset) => {
                const isSelected = selectedPresetId === preset.id;
                const isFeatured = preset.id === "openrouter";
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`flex flex-col items-start gap-1 rounded-xl p-2.5 text-left border transition-all cursor-pointer ${
                      isSelected
                        ? "border-brand bg-blue-50/80 dark:bg-blue-950/40 dark:border-brand shadow-xs"
                        : "border-blue-100/70 dark:border-slate-800 bg-white/80 dark:bg-slate-800/60 hover:border-blue-300"
                    }`}
                    disabled={isBusy}
                    onClick={() => applyPreset(preset)}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs font-bold text-navy dark:text-slate-100 flex items-center gap-1">
                        {isFeatured && <OpenRouterLogo className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />}
                        {preset.label}
                      </span>
                      {preset.badge && (
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                            isFeatured
                              ? "bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200"
                              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200"
                          }`}
                        >
                          {preset.badge}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slatecopy line-clamp-1">
                      {preset.model || getAdapterFriendlyLabel(preset.adapter)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Error Alert */}
        {formError && (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/40 dark:border-red-900 p-3 text-xs text-red-800 dark:text-red-300">
            {formError}
          </div>
        )}

        {/* Basic Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="modal-provider-label" className="block text-xs font-bold text-navy dark:text-slate-100 mb-1">
              Display Label
            </label>
            <input
              id="modal-provider-label"
              type="text"
              className="settings-select w-full text-xs font-medium"
              placeholder="e.g. OpenRouter GPT-4o-mini"
              value={label}
              maxLength={160}
              disabled={isBusy}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="modal-provider-adapter" className="block text-xs font-bold text-navy dark:text-slate-100 mb-1">
              Provider Type
            </label>
            <select
              id="modal-provider-adapter"
              className="settings-select w-full text-xs"
              value={adapter}
              disabled={isBusy}
              onChange={(e) => {
                const nextAdapter = e.target.value as ProviderAdapter;
                setAdapter(nextAdapter);
                if (nextAdapter === "system-tts") {
                  setModel("");
                  setBaseUrl("");
                  setSecretRef(undefined);
                } else if (!secretRef && !nextAdapter.includes("system")) {
                  setSecretRef(`${profileId || "profile"}-credential`);
                }
              }}
            >
              <option value="openai-compatible-text">Cloud / Local Text (OpenRouter, OpenAI, Ollama)</option>
              <option value="openai-realtime">OpenAI Realtime Voice & Text (WebRTC)</option>
              <option value="anthropic-text">Anthropic Messages API (Claude)</option>
              <option value="openai-compatible-transcription">Speech-to-Text Transcription (Whisper)</option>
              <option value="system-tts">System Voice (Local built-in TTS)</option>
              <option value="elevenlabs-tts">ElevenLabs Neural Voice (TTS)</option>
              <option value="minimax-tts">MiniMax Speech (TTS)</option>
              <option value="openai-compatible-speech">OpenAI Speech (TTS)</option>
            </select>
          </div>
        </div>

        {/* Model & Base URL (For Non-System-TTS) */}
        {adapter !== "system-tts" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="modal-provider-model" className="block text-xs font-bold text-navy dark:text-slate-100 mb-1">
                Model Identifier
              </label>
              <input
                id="modal-provider-model"
                type="text"
                className="settings-select w-full text-xs font-mono"
                placeholder="e.g. openai/gpt-4o-mini, llama3.2, whisper-1"
                value={model}
                maxLength={256}
                disabled={isBusy}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="modal-provider-baseurl" className="block text-xs font-bold text-navy dark:text-slate-100 mb-1">
                Base Endpoint URL
              </label>
              <input
                id="modal-provider-baseurl"
                type="text"
                className="settings-select w-full text-xs font-mono"
                placeholder="https://openrouter.ai/api/v1"
                value={baseUrl}
                maxLength={512}
                disabled={isBusy}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
          </div>
        )}

        <p className="text-[11px] text-slatecopy -mt-2 m-0">
          {getAdapterExplainer(adapter)}
        </p>

        {/* Credential / Key Input */}
        <div className="rounded-2xl border border-blue-100/80 dark:border-slate-800 bg-blue-50/30 dark:bg-slate-800/40 p-3.5 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="modal-provider-key" className="text-xs font-bold text-navy dark:text-slate-100 flex items-center gap-1.5">
              <KeyIcon className="w-4 h-4 text-brand" />
              API Key / Credential
            </label>
            {isLocal ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                <ShieldCheckIcon className="w-3.5 h-3.5" />
                Local Provider (No key needed)
              </span>
            ) : editingProfile?.hasCredential ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                <ShieldCheckIcon className="w-3.5 h-3.5" />
                Credential Stored
              </span>
            ) : (
              <span className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold">
                Required for cloud requests
              </span>
            )}
          </div>

          {!isLocal ? (
            <div>
              <input
                id="modal-provider-key"
                type="password"
                className="settings-select w-full text-xs font-mono"
                placeholder={
                  editingProfile?.hasCredential
                    ? "Enter new API key to replace existing credential (or leave empty)..."
                    : "Paste API key (e.g. sk-or-v1-...)"
                }
                value={inlineKey}
                disabled={isBusy}
                onChange={(e) => {
                  setInlineKey(e.target.value);
                  if (!secretRef) {
                    setSecretRef(`${profileId || "profile"}-credential`);
                  }
                }}
              />
              <span className="text-[10px] text-slatecopy block mt-1">
                Keys are stored securely in your OS keychain / encrypted host store.
              </span>
            </div>
          ) : (
            <p className="text-xs text-slatecopy m-0">
              This provider runs locally on your computer or uses built-in OS capabilities. No network API key is required.
            </p>
          )}
        </div>

        {/* Activate for Roles Section */}
        <div className="rounded-2xl border border-blue-100/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 flex flex-col gap-2">
          <strong className="text-xs font-bold text-navy dark:text-slate-100 block">
            Activate for Pet Roles
          </strong>
          <p className="text-[11px] text-slatecopy -mt-1 m-0">
            Check the roles you want this provider to power immediately upon saving:
          </p>

          <div className="flex flex-wrap gap-2.5 mt-1">
            {supportsText && (
              <label className="flex items-center gap-2 rounded-xl border border-blue-100/70 dark:border-slate-800 bg-blue-50/30 dark:bg-slate-800/50 px-3 py-2 text-xs font-semibold text-navy dark:text-slate-200 cursor-pointer hover:bg-blue-50">
                <input
                  type="checkbox"
                  className="rounded text-brand"
                  checked={activateBrain}
                  disabled={isBusy}
                  onChange={(e) => setActivateBrain(e.target.checked)}
                />
                <BrainIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Pet Brain (Text & Reasoning)</span>
              </label>
            )}

            {supportsStt && (
              <label className="flex items-center gap-2 rounded-xl border border-blue-100/70 dark:border-slate-800 bg-blue-50/30 dark:bg-slate-800/50 px-3 py-2 text-xs font-semibold text-navy dark:text-slate-200 cursor-pointer hover:bg-blue-50">
                <input
                  type="checkbox"
                  className="rounded text-brand"
                  checked={activateHearing}
                  disabled={isBusy}
                  onChange={(e) => setActivateHearing(e.target.checked)}
                />
                <MicIcon className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <span>Hearing (Speech-to-Text)</span>
              </label>
            )}

            {supportsTts && (
              <label className="flex items-center gap-2 rounded-xl border border-blue-100/70 dark:border-slate-800 bg-blue-50/30 dark:bg-slate-800/50 px-3 py-2 text-xs font-semibold text-navy dark:text-slate-200 cursor-pointer hover:bg-blue-50">
                <input
                  type="checkbox"
                  className="rounded text-brand"
                  checked={activateSpeech}
                  disabled={isBusy}
                  onChange={(e) => setActivateSpeech(e.target.checked)}
                />
                <SpeakerIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Speech (Text-to-Speech)</span>
              </label>
            )}
          </div>
        </div>

        {/* Collapsible Advanced Options */}
        <div className="border-t border-blue-50 dark:border-slate-800 pt-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-bold text-slatecopy hover:text-navy dark:hover:text-slate-100 cursor-pointer py-1"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />}
            <span>Advanced Configuration (Headers, Custom Auth, Slug ID)</span>
          </button>

          {showAdvanced && (
            <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-blue-100/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="modal-provider-slug" className="block text-[11px] font-bold text-navy dark:text-slate-100 mb-1">
                    Profile ID (Slug)
                  </label>
                  <input
                    id="modal-provider-slug"
                    type="text"
                    className="settings-select w-full text-xs font-mono"
                    placeholder="e.g. openrouter-primary"
                    value={profileId}
                    maxLength={64}
                    disabled={isEditing || isBusy}
                    onChange={(e) => setProfileId(e.target.value)}
                  />
                </div>

                <div>
                  <label htmlFor="modal-provider-secret-ref" className="block text-[11px] font-bold text-navy dark:text-slate-100 mb-1">
                    Secret Reference Key
                  </label>
                  <input
                    id="modal-provider-secret-ref"
                    type="text"
                    className="settings-select w-full text-xs font-mono"
                    placeholder="e.g. openrouter-key"
                    value={secretRef ?? ""}
                    maxLength={160}
                    disabled={isBusy || adapter === "system-tts"}
                    onChange={(e) => setSecretRef(e.target.value || undefined)}
                  />
                </div>
              </div>

              {/* Custom Auth Configuration */}
              {secretRef && (
                <div className="flex flex-col gap-2">
                  <label htmlFor="modal-provider-auth-scheme" className="text-[11px] font-bold text-navy dark:text-slate-100">
                    Authentication Header Scheme
                  </label>
                  <select
                    id="modal-provider-auth-scheme"
                    className="settings-select w-full text-xs"
                    value={customAuth ? "custom" : "default"}
                    disabled={isBusy}
                    onChange={(e) => {
                      if (e.target.value === "default") {
                        setCustomAuth(null);
                      } else {
                        setCustomAuth({
                          headerName: getDefaultAuthHeader(adapter),
                          strategy: getDefaultAuthStrategy(adapter),
                        });
                      }
                      setAuthEdited(true);
                    }}
                  >
                    <option value="default">
                      Standard Default ({getDefaultAuthHeader(adapter)}: {getDefaultAuthStrategy(adapter)})
                    </option>
                    <option value="custom">Custom Auth Header Placement</option>
                  </select>

                  {customAuth && (
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <input
                        type="text"
                        className="settings-select text-xs font-mono"
                        placeholder="Header Name"
                        value={customAuth.headerName}
                        disabled={isBusy}
                        onChange={(e) => {
                          setCustomAuth({ ...customAuth, headerName: e.target.value });
                          setAuthEdited(true);
                        }}
                      />
                      <select
                        className="settings-select text-xs"
                        value={customAuth.strategy}
                        disabled={isBusy}
                        onChange={(e) => {
                          setCustomAuth({
                            ...customAuth,
                            strategy: e.target.value as "bearer" | "raw",
                          });
                          setAuthEdited(true);
                        }}
                      >
                        <option value="bearer">Bearer &lt;token&gt;</option>
                        <option value="raw">Raw &lt;token&gt;</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Custom Request Headers */}
              {adapter !== "system-tts" && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-navy dark:text-slate-100">
                      Static Request Headers ({headers.length}/16)
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact text-[11px] flex items-center gap-1"
                      disabled={isBusy || headers.filter((header) => !header.deleted).length >= 16}
                      onClick={() => {
                        setHeaders([...headers, { key: `new-${Date.now()}-${headers.length}`, name: "", value: "" }]);
                        setHeadersEdited(true);
                      }}
                    >
                      <PlusIcon className="w-3 h-3" />
                      <span>Add Header</span>
                    </button>
                  </div>

                  {headers.filter((header) => !header.deleted).map((hdr) => (
                    <div key={hdr.key} className="flex gap-2 items-center">
                      <input
                        type="text"
                        className="settings-select flex-1 text-xs font-mono"
                        placeholder="Header Name (e.g. HTTP-Referer)"
                        value={hdr.name}
                        disabled={isBusy}
                        onChange={(e) => {
                          setHeaders(headers.map((header) => header.key === hdr.key ? { ...header, name: e.target.value } : header));
                          setHeadersEdited(true);
                        }}
                      />
                      <input
                        type="text"
                        className="settings-select flex-1 text-xs font-mono"
                        placeholder={hdr.originalName ? "Leave blank to keep stored value" : "Header Value"}
                        value={hdr.value}
                        disabled={isBusy}
                        onChange={(e) => {
                          setHeaders(headers.map((header) => header.key === hdr.key ? { ...header, value: e.target.value } : header));
                          setHeadersEdited(true);
                        }}
                      />
                      <button
                        type="button"
                        className="text-slatecopy hover:text-red-600 p-1 cursor-pointer"
                        disabled={isBusy}
                        onClick={() => {
                          setHeaders(headers
                            .map((header) => header.key === hdr.key && header.originalName ? { ...header, deleted: true } : header)
                            .filter((header) => header.key !== hdr.key || Boolean(header.originalName)));
                          setHeadersEdited(true);
                        }}
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-blue-50 dark:border-slate-800">
          <button
            type="button"
            className="btn btn-secondary btn-compact text-xs"
            disabled={isBusy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-compact text-xs"
            disabled={isBusy}
            onClick={() => void handleSubmit(false)}
          >
            Save to Library
          </button>
          <button
            type="button"
            className="btn btn-primary btn-compact text-xs font-bold"
            disabled={isBusy}
            onClick={() => void handleSubmit(true)}
          >
            {isSaving ? "Saving..." : "Save & Activate"}
          </button>
        </div>
      </div>
    </div>
  );
}
