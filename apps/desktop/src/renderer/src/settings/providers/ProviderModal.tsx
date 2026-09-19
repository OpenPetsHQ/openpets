import { useState, useEffect } from "react";
import { useI18n } from "../../i18n.js";
import {
  BrainIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  KeyIcon,
  MicIcon,
  PlusIcon,
  ShieldCheckIcon,
  SpeakerIcon,
  TrashIcon,
} from "./icons.js";
import {
  PROVIDER_PRESETS,
  getPresetById,
  generateRandomProfileId,
  type PresetCategory,
  type ProviderPresetItem,
} from "./presets.js";
import {
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
} from "./types.js";

export type ProviderModalProps = {
  readonly isOpen: boolean;
  readonly editingProfile: ProviderProfileSummary | null;
  readonly initialPresetId?: string;
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

// Templates are grouped by the companion role they serve so the picker reads
// as "what do you want to add" instead of a flat wall of vendor names.
const TEMPLATE_GROUPS: readonly {
  readonly key: "text" | "stt" | "tts" | "custom";
  readonly categories: readonly PresetCategory[];
}[] = [
  { key: "text", categories: ["cloud-text", "cloud-realtime", "local-text"] },
  { key: "stt", categories: ["cloud-stt"] },
  { key: "tts", categories: ["cloud-tts", "local-tts"] },
  { key: "custom", categories: ["custom"] },
];

const ADAPTER_OPTIONS: readonly ProviderAdapter[] = [
  "openai-compatible-text",
  "openai-realtime",
  "anthropic-text",
  "openai-compatible-transcription",
  "system-tts",
  "elevenlabs-tts",
  "minimax-tts",
  "openai-compatible-speech",
];

export function ProviderModal({
  isOpen,
  editingProfile,
  initialPresetId,
  busy,
  onClose,
  onSave,
}: ProviderModalProps) {
  const { t } = useI18n();
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

  // Advanced section
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customAuth, setCustomAuth] = useState<ProviderAuth | null>(null);
  const [authEdited, setAuthEdited] = useState(false);
  const [headers, setHeaders] = useState<HeaderDraft[]>([]);
  const [headersEdited, setHeadersEdited] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize the draft each time the modal opens (or the edited profile
  // changes while open). The component stays mounted while closed, so this
  // must not run on closed renders.
  useEffect(() => {
    if (!isOpen) return;
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
      setShowAdvanced(Boolean(editingProfile.auth || editingProfile.headerNames?.length > 0));
    } else {
      // Honor the preset the caller asked for (quick-add buttons), falling
      // back to the last picked template on plain reopens.
      const preset =
        getPresetById(initialPresetId ?? selectedPresetId) ?? PROVIDER_PRESETS[0];
      applyPreset(preset);
    }
  }, [editingProfile, isOpen, initialPresetId]);

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
      setFormError(t("settings.providers.modal.error.id"));
      return;
    }
    if (!trimmedLabel) {
      setFormError(t("settings.providers.modal.error.label"));
      return;
    }
    if (adapter !== "system-tts" && !trimmedModel) {
      setFormError(t("settings.providers.modal.error.model"));
      return;
    }
    if (adapter !== "system-tts" && !trimmedBaseUrl) {
      setFormError(t("settings.providers.modal.error.baseUrl"));
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

    // "Save & Activate" assigns the profile to every role its adapter supports
    // (each adapter maps to exactly one role today). Unassigning happens in the
    // role rows / library, not here.
    const activatedRoles: ProviderRole[] = [];
    if (shouldActivateRoles) {
      if (supportsText) activatedRoles.push("text");
      if (supportsStt) activatedRoles.push("stt");
      if (supportsTts) activatedRoles.push("tts");
    }

    setIsSaving(true);
    try {
      await onSave({
        isEditing,
        profileId: trimmedId,
        payload,
        credentialValue: inlineKey.trim() || undefined,
        activatedRoles,
        deactivatedRoles: [],
      });
      onClose();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t("settings.providers.modal.error.generic"));
    } finally {
      setIsSaving(false);
    }
  }

  const isBusy = Boolean(busy) || isSaving;

  if (!isOpen) return null;

  function renderTemplateChip(preset: ProviderPresetItem) {
    const isSelected = selectedPresetId === preset.id;
    return (
      <button
        key={preset.id}
        type="button"
        className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
          isSelected
            ? "border-brand bg-brand text-white shadow-sm"
            : "border-blue-200 bg-white text-navy shadow-xs hover:border-brand hover:text-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-brand dark:hover:text-blue-300"
        }`}
        disabled={isBusy}
        onClick={() => applyPreset(preset)}
      >
        {preset.label}
      </button>
    );
  }

  return (
    <div
      className="plugin-config-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={
        isEditing
          ? t("settings.providers.modal.titleEdit", { id: profileId })
          : t("settings.providers.modal.titleAdd")
      }
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
                {isEditing
                  ? t("settings.providers.modal.titleEdit", { id: profileId })
                  : t("settings.providers.modal.titleAdd")}
              </h3>
              <p className="text-xs text-slatecopy m-0">
                {t("settings.providers.modal.subtitle")}
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

        {/* Template Selector, grouped by companion role (creating only) */}
        {!isEditing && (
          <div className="flex flex-col gap-3 border-b border-blue-100 dark:border-slate-800 pb-4">
            <span className="text-xs font-black text-navy dark:text-slate-100 uppercase tracking-wider">
              {t("settings.providers.modal.templateLabel")}
            </span>
            {TEMPLATE_GROUPS.map((group) => {
              const groupPresets = PROVIDER_PRESETS.filter((preset) =>
                group.categories.includes(preset.category)
              );
              if (groupPresets.length === 0) return null;
              return (
                <div key={group.key} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    {group.key === "text" && <BrainIcon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
                    {group.key === "stt" && <MicIcon className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />}
                    {group.key === "tts" && <SpeakerIcon className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                    <span className="text-[11px] font-bold text-navy/80 dark:text-slate-200 uppercase tracking-wider">
                      {t(`settings.providers.modal.group.${group.key}`)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {groupPresets.map(renderTemplateChip)}
                  </div>
                </div>
              );
            })}
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
              {t("settings.providers.modal.field.label")}
            </label>
            <input
              id="modal-provider-label"
              type="text"
              className="settings-select w-full text-xs font-medium"
              placeholder={t("settings.providers.modal.field.labelPlaceholder")}
              value={label}
              maxLength={160}
              disabled={isBusy}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="modal-provider-adapter" className="block text-xs font-bold text-navy dark:text-slate-100 mb-1">
              {t("settings.providers.modal.field.adapter")}
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
              {ADAPTER_OPTIONS.map((adapterOption) => (
                <option key={adapterOption} value={adapterOption}>
                  {t(`settings.providers.adapter.${adapterOption}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Model & Base URL (For Non-System-TTS) */}
        {adapter !== "system-tts" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="modal-provider-model" className="block text-xs font-bold text-navy dark:text-slate-100 mb-1">
                {t("settings.providers.modal.field.model")}
              </label>
              <input
                id="modal-provider-model"
                type="text"
                className="settings-select w-full text-xs font-mono"
                placeholder={t("settings.providers.modal.field.modelPlaceholder")}
                value={model}
                maxLength={256}
                disabled={isBusy}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="modal-provider-baseurl" className="block text-xs font-bold text-navy dark:text-slate-100 mb-1">
                {t("settings.providers.modal.field.baseUrl")}
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
          {t(`settings.providers.adapterHint.${adapter}`)}
        </p>

        {/* Credential / Key Input */}
        <div className="rounded-2xl border border-blue-200/80 dark:border-slate-700 bg-blue-50/60 dark:bg-slate-800/60 p-3.5 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="modal-provider-key" className="text-xs font-bold text-navy dark:text-slate-100 flex items-center gap-1.5">
              <KeyIcon className="w-4 h-4 text-brand" />
              {t("settings.providers.modal.key.label")}
            </label>
            {isLocal ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                <ShieldCheckIcon className="w-3.5 h-3.5" />
                {t("settings.providers.modal.key.local")}
              </span>
            ) : editingProfile?.hasCredential ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                <ShieldCheckIcon className="w-3.5 h-3.5" />
                {t("settings.providers.modal.key.stored")}
              </span>
            ) : (
              <span className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold">
                {t("settings.providers.modal.key.required")}
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
                    ? t("settings.providers.modal.key.placeholderReplace")
                    : t("settings.providers.modal.key.placeholderNew")
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
                {t("settings.providers.modal.key.note")}
              </span>
            </div>
          ) : (
            <p className="text-xs text-slatecopy m-0">
              {t("settings.providers.modal.key.localBody")}
            </p>
          )}
        </div>

        {/* Collapsible Advanced Options */}
        <div className="border-t border-blue-50 dark:border-slate-800 pt-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-bold text-slatecopy hover:text-navy dark:hover:text-slate-100 cursor-pointer py-1"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />}
            <span>{t("settings.providers.modal.advanced")}</span>
          </button>

          {showAdvanced && (
            <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-blue-100/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="modal-provider-slug" className="block text-[11px] font-bold text-navy dark:text-slate-100 mb-1">
                    {t("settings.providers.modal.advanced.slug")}
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
                    {t("settings.providers.modal.advanced.secretRef")}
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
                    {t("settings.providers.modal.advanced.authScheme")}
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
                      {t("settings.providers.modal.advanced.authDefault", {
                        header: getDefaultAuthHeader(adapter),
                        strategy: getDefaultAuthStrategy(adapter),
                      })}
                    </option>
                    <option value="custom">{t("settings.providers.modal.advanced.authCustom")}</option>
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
                      {t("settings.providers.modal.advanced.headers", { count: headers.length })}
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
                      <span>{t("settings.providers.modal.advanced.addHeader")}</span>
                    </button>
                  </div>

                  {headers.filter((header) => !header.deleted).map((hdr) => (
                    <div key={hdr.key} className="flex gap-2 items-center">
                      <input
                        type="text"
                        className="settings-select flex-1 text-xs font-mono"
                        placeholder={t("settings.providers.modal.advanced.headerName")}
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
                        placeholder={
                          hdr.originalName
                            ? t("settings.providers.modal.advanced.headerKeep")
                            : t("settings.providers.modal.advanced.headerValue")
                        }
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
            {t("settings.providers.modal.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-compact text-xs"
            disabled={isBusy}
            onClick={() => void handleSubmit(false)}
          >
            {t("settings.providers.modal.saveLibrary")}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-compact text-xs font-bold"
            disabled={isBusy}
            onClick={() => void handleSubmit(true)}
          >
            {isSaving
              ? t("settings.providers.modal.saving")
              : t("settings.providers.modal.saveActivate")}
          </button>
        </div>
      </div>
    </div>
  );
}
