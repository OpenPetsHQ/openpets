import { useState, useEffect, useRef } from "react";
import { useI18n } from "../../i18n.js";
import {
  BrainIcon,
  CloseIcon,
  KeyIcon,
  MicIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SpeakerIcon,
} from "./icons.js";
import {
  getPresetById,
  getPresetsByRole,
  getPresetCatalog,
  generateRandomProfileId,
  CUSTOM_TEMPLATE,
  type CustomProviderTemplate,
} from "./presets.js";
import {
  getProfileCredentialPolicy,
  profileSupportsRole,
  type ProviderAdapter,
  type ProviderAuth,
  type ProviderHeaderPatch,
  type ProviderConfigurationSaveInput,
  type ProviderConfigurationTestResult,
  type ProviderPreset,
  type ProviderProfileInput,
  type ProviderProfilePatch,
  type ProviderProfileSummary,
  type ProviderRole,
} from "./types.js";
import {
  getDefaultVoiceForAdapter,
  isKnownCuratedVoice,
  isTtsAdapter,
} from "./voice-options.js";
import { VoiceControl } from "./VoiceControl.js";
import { ModelControls } from "./ModelControls.js";
import {
  AdvancedConnectionSettings,
  type HeaderDraft,
} from "./AdvancedConnectionSettings.js";

export type ProviderModalProps = {
  readonly isOpen: boolean;
  readonly editingProfile: ProviderProfileSummary | null;
  readonly initialPresetId?: string;
  readonly presets?: readonly ProviderPreset[];
  readonly busy: string;
  readonly onClose: () => void;
  readonly onSave: (params: ProviderConfigurationSaveInput) => Promise<void>;
  readonly onTest: (
    params: ProviderConfigurationSaveInput,
  ) => Promise<ProviderConfigurationTestResult>;
  readonly onBeginTranscriptionTest: (params: ProviderConfigurationSaveInput) => Promise<{ readonly sessionId: string }>;
  readonly onFinishTranscriptionTest: (sessionId: string) => Promise<ProviderConfigurationTestResult>;
  readonly onCancelTranscriptionTest: (sessionId?: string) => Promise<void>;
  readonly onPlayPreview: (bytes: Uint8Array, mimeType: string) => Promise<{ readonly output: "selected" | "system-default"; readonly reason?: string }>;
  readonly onStopPreview: () => Promise<void>;
};

const ADAPTER_OPTIONS: readonly ProviderAdapter[] = [
  "openai-compatible-text",
  "openai-realtime",
  "anthropic-text",
  "openai-compatible-transcription",
  "elevenlabs-transcription",
  "system-tts",
  "elevenlabs-tts",
  "minimax-tts",
  "openai-compatible-speech",
];

const TEMPLATE_ROLE_GROUPS: readonly {
  readonly key: ProviderRole | "custom";
  readonly titleKey: string;
}[] = [
  { key: "text", titleKey: "settings.providers.modal.group.text" },
  { key: "stt", titleKey: "settings.providers.modal.group.stt" },
  { key: "tts", titleKey: "settings.providers.modal.group.tts" },
  { key: "custom", titleKey: "settings.providers.modal.group.custom" },
];

function getBaseUrlPlaceholder(adapter: ProviderAdapter): string {
  switch (adapter) {
    case "elevenlabs-tts":
      return "https://api.elevenlabs.io/v1";
    case "minimax-tts":
      return "https://api.minimax.io/v1";
    case "anthropic-text":
      return "https://api.anthropic.com";
    case "openai-compatible-text":
      return "https://openrouter.ai/api/v1";
    case "openai-realtime":
    case "openai-compatible-transcription":
    case "openai-compatible-speech":
    default:
      return "https://api.openai.com/v1";
  }
}

export function ProviderModal({
  isOpen,
  editingProfile,
  initialPresetId,
  presets: rawPresets,
  busy,
  onClose,
  onSave,
  onTest,
  onBeginTranscriptionTest,
  onFinishTranscriptionTest,
  onCancelTranscriptionTest,
  onPlayPreview,
  onStopPreview,
}: ProviderModalProps) {
  const { t } = useI18n();
  const presets = getPresetCatalog(rawPresets ? { presets: rawPresets } : null);
  const isEditing = Boolean(editingProfile);

  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    initialPresetId ?? (isEditing ? "" : CUSTOM_TEMPLATE.id),
  );

  // Form State
  const [profileId, setProfileId] = useState("");
  const [label, setLabel] = useState("");
  const [adapter, setAdapter] = useState<ProviderAdapter>("openai-compatible-text");
  const [model, setModel] = useState("");
  const [realtimeModel, setRealtimeModel] = useState("");
  const [voice, setVoice] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [inlineKey, setInlineKey] = useState("");

  // Advanced section
  const [customAuth, setCustomAuth] = useState<ProviderAuth | null>(null);
  const [authEdited, setAuthEdited] = useState(false);
  const [headers, setHeaders] = useState<readonly HeaderDraft[]>([]);
  const [headersEdited, setHeadersEdited] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [testStage, setTestStage] = useState<"idle" | "recording" | "testing">("idle");
  const [testResult, setTestResult] = useState<string | null>(null);
  const testSessionIdRef = useRef<string | null>(null);
  const transcriptionStartGenerationRef = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    if (editingProfile) {
      setProfileId(editingProfile.id);
      setLabel(editingProfile.label);
      setAdapter(editingProfile.adapter);
      setModel(editingProfile.model);
      setRealtimeModel(
        editingProfile.realtimeModel ??
          (editingProfile.adapter === "openai-realtime" ? "gpt-realtime-2.1" : ""),
      );
      setVoice(
        editingProfile.voice ??
          (isTtsAdapter(editingProfile.adapter)
            ? getDefaultVoiceForAdapter(editingProfile.adapter)
            : ""),
      );
      setBaseUrl(editingProfile.baseUrl ?? "");
      setCustomAuth(editingProfile.auth ?? null);
      setAuthEdited(false);
      setHeaders(
        editingProfile.headerNames.map((name) => ({
          key: `existing-${name}`,
          originalName: name,
          name,
          value: "",
        })),
      );
      setHeadersEdited(false);
      setInlineKey("");
    } else {
      const targetPresetId = initialPresetId ?? selectedPresetId;
      const preset = getPresetById(targetPresetId, presets) ?? presets[0];
      if (preset) {
        applyPreset(preset);
      } else {
        applyCustomTemplate();
      }
    }
  }, [editingProfile, isOpen, initialPresetId]);

  function applyCustomTemplate() {
    setSelectedPresetId(CUSTOM_TEMPLATE.id);
    setProfileId(generateRandomProfileId("custom"));
    setLabel("");
    setAdapter("openai-compatible-text");
    setModel("");
    setRealtimeModel("");
    setVoice("");
    setBaseUrl("");
    setCustomAuth(null);
    setAuthEdited(false);
    setInlineKey("");
    setHeaders([]);
    setHeadersEdited(false);
  }

  function applyPreset(preset: ProviderPreset) {
    const id = generateRandomProfileId(preset.id);
    setSelectedPresetId(preset.id);
    setProfileId(id);
    setLabel(preset.label);
    setAdapter(preset.adapter);
    setModel(preset.model);
    setRealtimeModel(
      preset.realtimeModel ??
        (preset.adapter === "openai-realtime" ? "gpt-realtime-2.1" : ""),
    );
    setVoice(
      preset.voice ??
        (isTtsAdapter(preset.adapter) ? getDefaultVoiceForAdapter(preset.adapter) : ""),
    );
    setBaseUrl(preset.baseUrl ?? "");
    setCustomAuth(null);
    setAuthEdited(false);
    setInlineKey("");

    if (preset.suggestedHeaders && preset.suggestedHeaders.length > 0) {
      setHeaders(
        preset.suggestedHeaders.map((header, index) => ({
          ...header,
          key: `suggested-${index}`,
        })),
      );
      setHeadersEdited(true);
    } else {
      setHeaders([]);
      setHeadersEdited(false);
    }
  }

  function handleAdapterChange(nextAdapter: ProviderAdapter) {
    setAdapter(nextAdapter);
    if (nextAdapter === "system-tts") {
      setModel("");
      setRealtimeModel("");
      setVoice("");
      setBaseUrl("");
      setCustomAuth(null);
      setHeaders([]);
    } else {
      if (nextAdapter === "openai-realtime" && !realtimeModel) {
        setRealtimeModel("gpt-realtime-2.1");
      }
      if (isTtsAdapter(nextAdapter)) {
        if (!voice || isKnownCuratedVoice(adapter, voice)) {
          setVoice(getDefaultVoiceForAdapter(nextAdapter));
        }
      }
    }
  }

  const credentialPolicy = getProfileCredentialPolicy({ adapter, baseUrl });
  const isSystem = adapter === "system-tts";

  useEffect(() => {
    if (isOpen) return;
    const sessionId = testSessionIdRef.current;
    testSessionIdRef.current = null;
    void onCancelTranscriptionTest(sessionId ?? undefined).catch(() => undefined);
    void onStopPreview().catch(() => undefined);
  }, [isOpen]);

  useEffect(() => () => {
    transcriptionStartGenerationRef.current += 1;
    const sessionId = testSessionIdRef.current;
    testSessionIdRef.current = null;
    void onCancelTranscriptionTest(sessionId ?? undefined).catch(() => undefined);
    void onStopPreview().catch(() => undefined);
  }, []);

  async function handleClose(): Promise<void> {
    transcriptionStartGenerationRef.current += 1;
    const sessionId = testSessionIdRef.current;
    testSessionIdRef.current = null;
    await onCancelTranscriptionTest(sessionId ?? undefined).catch(() => undefined);
    await onStopPreview().catch(() => undefined);
    onClose();
  }

  function buildConfigurationInput(shouldActivateRoles: boolean): ProviderConfigurationSaveInput | null {
    setFormError(null);

    const trimmedId = profileId.trim();
    const trimmedLabel = label.trim();
    const trimmedModel = model.trim();
    const trimmedRealtimeModel = realtimeModel.trim();
    const trimmedVoice = voice.trim();
    const trimmedBaseUrl = baseUrl.trim();

    if (!trimmedId) {
      setFormError(t("settings.providers.modal.error.id"));
      return null;
    }
    if (!trimmedLabel) {
      setFormError(t("settings.providers.modal.error.label"));
      return null;
    }
    if (!isSystem && !trimmedModel) {
      setFormError(t("settings.providers.modal.error.model"));
      return null;
    }
    if (isTtsAdapter(adapter) && !isSystem && !trimmedVoice) {
      setFormError(t("settings.providers.modal.error.voice"));
      return null;
    }
    if (!isSystem && !trimmedBaseUrl) {
      setFormError(t("settings.providers.modal.error.baseUrl"));
      return null;
    }

    const headerPatch: ProviderHeaderPatch[] = [];
    if (isEditing && headersEdited) {
      for (const header of headers) {
        if (header.deleted) {
          if (header.originalName) {
            headerPatch.push({ op: "delete", name: header.originalName });
          }
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
          model: isSystem ? "" : trimmedModel,
          realtimeModel:
            adapter === "openai-realtime" ? trimmedRealtimeModel || null : null,
          voice: isTtsAdapter(adapter) ? trimmedVoice || null : null,
          baseUrl: isSystem ? null : trimmedBaseUrl || null,
          auth: isSystem ? null : authEdited ? customAuth : undefined,
          ...(isSystem
            ? { headers: [] }
            : headersEdited
              ? { headerPatch }
              : {}),
        }
      : {
          id: trimmedId,
          label: trimmedLabel,
          adapter,
          model: isSystem ? "" : trimmedModel,
          ...(adapter === "openai-realtime" && trimmedRealtimeModel
            ? { realtimeModel: trimmedRealtimeModel }
            : {}),
          ...(isTtsAdapter(adapter) && trimmedVoice ? { voice: trimmedVoice } : {}),
          ...(isSystem
            ? {}
            : {
                baseUrl: trimmedBaseUrl || undefined,
                auth: customAuth ?? undefined,
                headers: headers
                  .filter((header) => !header.deleted)
                  .map(({ name, value }) => ({ name, value })),
              }),
        };

    const activatedRoles: ProviderRole[] = [];
    if (shouldActivateRoles) {
      if (profileSupportsRole({ adapter }, "text")) activatedRoles.push("text");
      if (profileSupportsRole({ adapter }, "stt")) activatedRoles.push("stt");
      if (profileSupportsRole({ adapter }, "tts")) activatedRoles.push("tts");
    }

    return {
      isEditing,
      profileId: trimmedId,
      payload,
      credentialValue: inlineKey.trim() || undefined,
      activatedRoles,
      deactivatedRoles: [],
    };
  }

  async function handleSubmit(shouldActivateRoles: boolean) {
    const input = buildConfigurationInput(shouldActivateRoles);
    if (!input) return;
    setIsSaving(true);
    try {
      await onSave(input);
      onClose();
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : t("settings.providers.modal.error.generic"),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function runProviderTest(
    input: ProviderConfigurationSaveInput,
  ) {
    setTestStage("testing");
    setFormError(null);
    setTestResult(null);
    try {
      const result = await onTest(input);
      if (result.kind === "tts") {
        const playback = await onPlayPreview(result.bytes, result.mimeType);
        setTestResult(
          playback.output === "selected"
            ? t("settings.providers.modal.test.voicePreviewReady")
            : `${t("settings.providers.modal.test.voicePreviewReady")} Output fallback: ${playback.reason ?? "system default"}.`,
        );
      } else if (result.kind === "system-tts") {
        playSystemVoicePreview(voice);
        setTestResult(t("settings.providers.modal.test.voicePreviewReady"));
      } else {
        setTestResult(result.detail);
      }
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : t("settings.providers.modal.test.failed"));
    } finally {
      setTestStage("idle");
    }
  }

  async function startTranscriptionTest(input: ProviderConfigurationSaveInput) {
    const generation = ++transcriptionStartGenerationRef.current;
    try {
      const { sessionId } = await onBeginTranscriptionTest(input);
      if (generation !== transcriptionStartGenerationRef.current || !isOpen) {
        await onCancelTranscriptionTest(sessionId).catch(() => undefined);
        return;
      }
      testSessionIdRef.current = sessionId;
      setTestStage("recording");
      setTestResult(t("settings.providers.modal.test.recording"));
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : t("settings.providers.modal.test.recordingUnavailable"));
    }
  }

  function handleTest() {
    if (testStage === "recording") {
      const sessionId = testSessionIdRef.current;
      if (!sessionId) return;
      testSessionIdRef.current = null;
      setTestStage("testing");
      void onFinishTranscriptionTest(sessionId).then((result) => {
        setTestResult(result.kind === "stt" ? result.detail : t("settings.providers.modal.test.failed"));
      }).catch((error: unknown) => {
        setFormError(error instanceof Error ? error.message : t("settings.providers.modal.test.failed"));
      }).finally(() => setTestStage("idle"));
      return;
    }
    const input = buildConfigurationInput(false);
    if (!input) return;
    if (adapter === "openai-compatible-transcription" || adapter === "elevenlabs-transcription") {
      void startTranscriptionTest(input);
      return;
    }
    void runProviderTest(input);
  }

  function playSystemVoicePreview(selectedVoice: string) {
    const voiceName = selectedVoice.trim();
    const systemVoice = voiceName
      ? speechSynthesis.getVoices().find((candidate) => candidate.name === voiceName)
      : undefined;
    if (voiceName && !systemVoice) {
      throw new Error(t("settings.providers.modal.test.systemVoiceUnavailable"));
    }
    const utterance = new SpeechSynthesisUtterance("This is your OpenPets voice preview.");
    if (systemVoice) utterance.voice = systemVoice;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  const isBusy = Boolean(busy) || isSaving || testStage === "testing";
  const testButtonDisabled = Boolean(busy) || isSaving || testStage === "testing";

  if (!isOpen) return null;

  function renderTemplateChip(preset: ProviderPreset | CustomProviderTemplate) {
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
        onClick={() => {
          if ("adapter" in preset) {
            applyPreset(preset);
          } else {
            applyCustomTemplate();
          }
        }}
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
        onClick={() => !Boolean(busy) && !isSaving && void handleClose()}
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
            disabled={Boolean(busy) || isSaving}
            onClick={() => void handleClose()}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Template Selector (Creating Only) */}
        {!isEditing && (
          <div className="flex flex-col gap-3 border-b border-blue-100 dark:border-slate-800 pb-4">
            <span className="text-xs font-black text-navy dark:text-slate-100 uppercase tracking-wider">
              {t("settings.providers.modal.templateLabel")}
            </span>
            {TEMPLATE_ROLE_GROUPS.map((group) => {
                const groupPresets =
                  group.key === "custom"
                  ? [CUSTOM_TEMPLATE]
                  : getPresetsByRole(presets, group.key);
              if (groupPresets.length === 0) return null;
              return (
                <div key={group.key} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    {group.key === "text" && (
                      <BrainIcon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    )}
                    {group.key === "stt" && (
                      <MicIcon className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    )}
                    {group.key === "tts" && (
                      <SpeakerIcon className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <span className="text-[11px] font-bold text-navy/80 dark:text-slate-200 uppercase tracking-wider">
                      {t(group.titleKey as any)}
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

        {/* Basic Fields: Label & Adapter */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label
              htmlFor="modal-provider-label"
              className="block text-xs font-bold text-navy dark:text-slate-100 mb-1"
            >
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
            <label
              htmlFor="modal-provider-adapter"
              className="block text-xs font-bold text-navy dark:text-slate-100 mb-1"
            >
              {t("settings.providers.modal.field.adapter")}
            </label>
            <select
              id="modal-provider-adapter"
              className="settings-select w-full text-xs"
              value={adapter}
              disabled={isBusy}
              onChange={(e) => handleAdapterChange(e.target.value as ProviderAdapter)}
            >
              {ADAPTER_OPTIONS.map((adapterOption) => (
                <option key={adapterOption} value={adapterOption}>
                  {t(`settings.providers.adapter.${adapterOption}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Model Controls (Distinct Text/Realtime for realtime, single for others, hidden for system-tts) */}
        <ModelControls
          adapter={adapter}
          model={model}
          realtimeModel={realtimeModel}
          onModelChange={setModel}
          onRealtimeModelChange={setRealtimeModel}
          disabled={isBusy}
        />

        {/* Contextual Voice Control for TTS */}
        {isTtsAdapter(adapter) && (
          <VoiceControl
            adapter={adapter}
            voice={voice}
            onChange={setVoice}
            disabled={isBusy}
          />
        )}

        {/* Base URL (For Non-System-TTS) */}
        {!isSystem && (
          <div>
            <label
              htmlFor="modal-provider-baseurl"
              className="block text-xs font-bold text-navy dark:text-slate-100 mb-1"
            >
              {t("settings.providers.modal.field.baseUrl")}
            </label>
            <input
              id="modal-provider-baseurl"
              type="text"
              className="settings-select w-full text-xs font-mono"
              placeholder={getBaseUrlPlaceholder(adapter)}
              value={baseUrl}
              maxLength={512}
              disabled={isBusy}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
        )}

        <p className="text-[11px] text-slatecopy -mt-2 m-0">
          {t(`settings.providers.adapterHint.${adapter}`)}
        </p>

        {/* Credential / Key Input (Rendered based on actual credential policy) */}
        {!isSystem && (
          <div className="rounded-2xl border border-blue-200/80 dark:border-slate-700 bg-blue-50/60 dark:bg-slate-800/60 p-3.5 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="modal-provider-key"
                className="text-xs font-bold text-navy dark:text-slate-100 flex items-center gap-1.5"
              >
                <KeyIcon className="w-4 h-4 text-brand" />
                {t("settings.providers.modal.key.label")}
              </label>
              {credentialPolicy === "optional" ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  <ShieldCheckIcon className="w-3.5 h-3.5" />
                  {t("settings.providers.modal.key.optional")}
                </span>
              ) : editingProfile?.hasCredential ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  <ShieldCheckIcon className="w-3.5 h-3.5" />
                  {t("settings.providers.modal.key.stored")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400 font-semibold">
                  <ShieldAlertIcon className="w-3.5 h-3.5" />
                  {t("settings.providers.modal.key.required")}
                </span>
              )}
            </div>

            <div>
              <input
                id="modal-provider-key"
                type="password"
                className="settings-select w-full text-xs font-mono"
                placeholder={
                  credentialPolicy === "optional"
                    ? t("settings.providers.modal.key.optionalPlaceholder")
                    : editingProfile?.hasCredential
                      ? t("settings.providers.modal.key.placeholderReplace")
                      : t("settings.providers.modal.key.placeholderNew")
                }
                value={inlineKey}
                disabled={isBusy}
                onChange={(e) => setInlineKey(e.target.value)}
              />
              <span className="text-[10px] text-slatecopy block mt-1">
                {credentialPolicy === "optional"
                  ? t("settings.providers.modal.key.optionalBody")
                  : t("settings.providers.modal.key.note")}
              </span>
              {(adapter === "elevenlabs-tts" || adapter === "elevenlabs-transcription") && (
                <a
                  href="https://try.elevenlabs.io/vvhacwny8vmg"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-block text-[11px] text-brand hover:underline font-medium"
                >
                  {t("settings.providers.modal.key.elevenlabsReferral")}
                </a>
              )}
            </div>
          </div>
        )}

        {/* Collapsible Advanced Options: Profile ID, Custom Auth & Custom Headers */}
        <AdvancedConnectionSettings
          profileId={profileId}
          onProfileIdChange={setProfileId}
          isEditing={isEditing}
          adapter={adapter}
          customAuth={customAuth}
          onCustomAuthChange={(auth) => {
            setCustomAuth(auth);
            setAuthEdited(true);
          }}
          headers={headers}
          onHeadersChange={(nextHeaders) => {
            setHeaders(nextHeaders);
            setHeadersEdited(true);
          }}
          disabled={isBusy}
        />

        {/* Test Result Status */}
        {testResult && (
          <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
            {testResult}
          </div>
        )}

        {/* Modal Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-blue-50 dark:border-slate-800">
          <button
            type="button"
            className="btn btn-secondary btn-compact text-xs"
            disabled={testButtonDisabled}
            onClick={handleTest}
          >
            {testStage === "recording"
              ? t("settings.providers.modal.test.stopRecording")
              : adapter === "openai-compatible-transcription" || adapter === "elevenlabs-transcription"
                ? t("settings.providers.modal.test.startRecording")
                : t("settings.providers.modal.test.button")}
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <button
              type="button"
              className="btn btn-secondary btn-compact text-xs"
              disabled={Boolean(busy) || isSaving}
              onClick={() => void handleClose()}
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
    </div>
  );
}
