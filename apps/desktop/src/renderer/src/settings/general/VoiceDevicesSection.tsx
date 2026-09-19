import { useI18n } from "../../i18n.js";
import {
  AlertCircleIcon,
  InfoIcon,
  MicIcon,
  RefreshIcon,
  SpeakerIcon,
} from "./icons.js";
import type { VoiceDevicesSnapshot } from "./types.js";

export type VoiceDevicesSectionProps = {
  readonly snapshot: VoiceDevicesSnapshot | null;
  readonly busy?: string;
  readonly isRefreshing?: boolean;
  readonly onSelectInputDevice: (deviceId: string | null) => void;
  readonly onSelectOutputDevice: (deviceId: string | null) => void;
  readonly onRefresh: () => void;
};

export function VoiceDevicesSection({
  snapshot,
  busy,
  isRefreshing = false,
  onSelectInputDevice,
  onSelectOutputDevice,
  onRefresh,
}: VoiceDevicesSectionProps) {
  const { t } = useI18n();

  const isBusy = Boolean(busy) || isRefreshing;
  const hasSnapshot = snapshot !== null;

  const inputDevices = snapshot?.input.devices ?? [];
  const outputDevices = snapshot?.output.devices ?? [];
  const inputStatus = snapshot?.input.status;
  const outputStatus = snapshot?.output.status;
  const outputSelectionStatus = snapshot?.outputSelectionStatus;
  const preferredInputDeviceId = snapshot?.preferredInputDeviceId ?? null;
  const preferredOutputDeviceId = snapshot?.preferredOutputDeviceId ?? null;
  const inputResolution = snapshot?.inputResolution;
  const outputResolution = snapshot?.outputResolution;

  const selectedInputValue = preferredInputDeviceId ?? "";
  const selectedOutputValue = preferredOutputDeviceId ?? "";

  function renderInputStatusPill() {
    if (!hasSnapshot) {
      if (isRefreshing) {
        return (
          <span className="pill pill-slate flex items-center gap-1 text-[11px] font-medium animate-pulse">
            {t("settings.voiceDevices.status.loading")}
          </span>
        );
      }
      return (
        <span className="pill pill-slate text-[11px] font-medium">
          {t("settings.voiceDevices.status.unavailable")}
        </span>
      );
    }

    if (inputResolution === "preferred-unavailable") {
      return (
        <span className="pill pill-yellow flex items-center gap-1 text-[11px] font-semibold">
          <AlertCircleIcon className="w-3.5 h-3.5 text-amber-600" />
          {t("settings.voiceDevices.status.disconnectedFallback")}
        </span>
      );
    }
    if (inputResolution === "preferred") {
      return (
        <span className="pill pill-green flex items-center gap-1 text-[11px] font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {t("settings.voiceDevices.status.custom")}
        </span>
      );
    }
    return null;
  }

  function renderOutputStatusPill() {
    if (!hasSnapshot) {
      if (isRefreshing) {
        return (
          <span className="pill pill-slate flex items-center gap-1 text-[11px] font-medium animate-pulse">
            {t("settings.voiceDevices.status.loading")}
          </span>
        );
      }
      return (
        <span className="pill pill-slate text-[11px] font-medium">
          {t("settings.voiceDevices.status.unavailable")}
        </span>
      );
    }

    if (outputSelectionStatus === "unsupported") {
      return (
        <span className="pill pill-slate text-[11px] font-medium">
          {t("settings.voiceDevices.status.osDefaultOnly")}
        </span>
      );
    }
    if (outputSelectionStatus === "unavailable") {
      return (
        <span className="pill pill-orange text-[11px] font-medium">
          {t("settings.voiceDevices.status.unavailable")}
        </span>
      );
    }
    if (outputResolution === "preferred-unavailable") {
      return (
        <span className="pill pill-yellow flex items-center gap-1 text-[11px] font-semibold">
          <AlertCircleIcon className="w-3.5 h-3.5 text-amber-600" />
          {t("settings.voiceDevices.status.disconnectedFallback")}
        </span>
      );
    }
    if (outputResolution === "preferred") {
      return (
        <span className="pill pill-green flex items-center gap-1 text-[11px] font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {t("settings.voiceDevices.status.custom")}
        </span>
      );
    }
    return null;
  }

  const isPreferredInputMissing =
    preferredInputDeviceId !== null &&
    !inputDevices.some((device) => device.deviceId === preferredInputDeviceId);

  const isPreferredOutputMissing =
    preferredOutputDeviceId !== null &&
    !outputDevices.some((device) => device.deviceId === preferredOutputDeviceId);

  return (
    <div className="flex flex-col gap-4 rounded-[24px] border border-blue-100/70 bg-white/70 p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60 transition-all">
      {/* Header with Title and Refresh Button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">{t("settings.voiceDevices.eyebrow")}</p>
          <h3 className="text-base font-bold text-navy dark:text-slate-100">
            {t("settings.voiceDevices.title")}
          </h3>
          <p className="text-xs text-slatecopy dark:text-slate-400 mt-0.5">
            {t("settings.voiceDevices.subtitle")}
          </p>
        </div>

        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          disabled={isBusy}
          onClick={onRefresh}
          aria-label={t("settings.voiceDevices.refresh")}
        >
          <RefreshIcon
            className={`w-3.5 h-3.5 text-slate-600 dark:text-slate-300 ${
              isRefreshing ? "animate-spin" : ""
            }`}
          />
          {isRefreshing
            ? t("settings.voiceDevices.refreshing")
            : t("settings.voiceDevices.refresh")}
        </button>
      </div>

      {/* 2-Column Device Routing Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left Column: Microphone (Input) */}
        <div className="flex flex-col justify-between gap-3.5 rounded-2xl border border-blue-100/60 bg-white/80 p-4 shadow-xs dark:border-slate-700/50 dark:bg-slate-950/40">
          <div className="flex flex-col gap-3">
            {/* Input Header */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-50/80 dark:bg-sky-950/50 border border-sky-100/80 dark:border-sky-800/40 shadow-2xs">
                  <MicIcon className="w-4.5 h-4.5 text-sky-600 dark:text-sky-400" />
                </div>
                <div>
                  <strong className="block text-xs font-bold text-navy dark:text-slate-100">
                    {t("settings.voiceDevices.inputTitle")}
                  </strong>
                  <span className="text-[11px] text-slatecopy dark:text-slate-400">
                    {t("settings.voiceDevices.inputSubtitle")}
                  </span>
                </div>
              </div>
              {renderInputStatusPill()}
            </div>

            {/* Input Content: Neutral fallback vs Truthful Device Controls */}
            {!hasSnapshot ? (
              <div className="flex flex-col gap-2 pt-1">
                {isRefreshing ? (
                  <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 text-xs text-slatecopy dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                    <RefreshIcon className="w-4 h-4 animate-spin text-slate-400 dark:text-slate-500 shrink-0" />
                    <span className="text-[11px]">{t("settings.voiceDevices.inputLoading")}</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 text-xs text-slatecopy dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                    <AlertCircleIcon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 mt-0.5" />
                    <div className="flex flex-col gap-0.5">
                      <strong className="text-navy dark:text-slate-200">
                        {t("settings.voiceDevices.inputUnavailableTitle")}
                      </strong>
                      <span className="text-[11px] leading-relaxed">
                        {t("settings.voiceDevices.inputUnavailableBody")}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Input Select Control */}
                <div className="flex flex-col gap-1.5 pt-1">
                  <label
                    htmlFor="voice-device-input-select"
                    className="text-xs font-semibold text-slatecopy dark:text-slate-400"
                  >
                    {t("settings.voiceDevices.inputLabel")}
                  </label>
                  <select
                    id="voice-device-input-select"
                    className="settings-select w-full text-xs font-medium"
                    value={selectedInputValue}
                    disabled={isBusy}
                    onChange={(event) => {
                      const val = event.target.value;
                      onSelectInputDevice(val ? val : null);
                    }}
                  >
                    <option value="">
                      {t("settings.voiceDevices.systemDefaultOption")}
                    </option>
                    {inputDevices.map((device, index) => {
                      const label = device.label.trim()
                        ? device.label
                        : `${t("settings.voiceDevices.microphone")} ${index + 1}`;
                      return (
                        <option key={device.deviceId} value={device.deviceId}>
                          {label}
                        </option>
                      );
                    })}
                    {isPreferredInputMissing && (
                      <option value={preferredInputDeviceId}>
                        {preferredInputDeviceId} ({t("settings.voiceDevices.disconnectedOption")})
                      </option>
                    )}
                  </select>
                </div>

                {/* Fallback Warning Notice */}
                {inputResolution === "preferred-unavailable" && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200/80 bg-amber-50/80 p-2.5 text-[11px] text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
                    <AlertCircleIcon className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                    <span>{t("settings.voiceDevices.inputDisconnectedNotice")}</span>
                  </div>
                )}

                {/* Permission / Status Notice */}
                {inputStatus === "requires-permission" && (
                  <div className="flex items-start gap-2 rounded-xl border border-blue-100/80 bg-blue-50/50 p-2.5 text-[11px] text-slatecopy dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-slate-400">
                    <InfoIcon className="w-3.5 h-3.5 shrink-0 text-brand dark:text-blue-400 mt-0.5" />
                    <span>{t("settings.voiceDevices.inputPermissionNotice")}</span>
                  </div>
                )}

                {inputStatus === "unavailable" && inputDevices.length === 0 && (
                  <p className="text-[11px] text-slate-500 italic">
                    {t("settings.voiceDevices.inputEmpty")}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Microphone Scope Note */}
          <p className="text-[11px] text-slatecopy dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800/60 pt-2.5">
            {t("settings.voiceDevices.inputNote")}
          </p>
        </div>

        {/* Right Column: Speaker (Output) */}
        <div className="flex flex-col justify-between gap-3.5 rounded-2xl border border-blue-100/60 bg-white/80 p-4 shadow-xs dark:border-slate-700/50 dark:bg-slate-950/40">
          <div className="flex flex-col gap-3">
            {/* Output Header */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50/80 dark:bg-emerald-950/50 border border-emerald-100/80 dark:border-emerald-800/40 shadow-2xs">
                  <SpeakerIcon className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <strong className="block text-xs font-bold text-navy dark:text-slate-100">
                    {t("settings.voiceDevices.outputTitle")}
                  </strong>
                  <span className="text-[11px] text-slatecopy dark:text-slate-400">
                    {t("settings.voiceDevices.outputSubtitle")}
                  </span>
                </div>
              </div>
              {renderOutputStatusPill()}
            </div>

            {/* Output Content: Neutral fallback vs Capability Gating vs Device Controls */}
            {!hasSnapshot ? (
              <div className="flex flex-col gap-2 pt-1">
                {isRefreshing ? (
                  <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 text-xs text-slatecopy dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                    <RefreshIcon className="w-4 h-4 animate-spin text-slate-400 dark:text-slate-500 shrink-0" />
                    <span className="text-[11px]">{t("settings.voiceDevices.outputLoading")}</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 text-xs text-slatecopy dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                    <AlertCircleIcon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 mt-0.5" />
                    <div className="flex flex-col gap-0.5">
                      <strong className="text-navy dark:text-slate-200">
                        {t("settings.voiceDevices.outputUnavailableTitle")}
                      </strong>
                      <span className="text-[11px] leading-relaxed">
                        {t("settings.voiceDevices.outputUnavailableBody")}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : outputSelectionStatus === "unsupported" ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50 p-3 text-xs text-slatecopy dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                <InfoIcon className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <strong className="text-navy dark:text-slate-200">
                    {t("settings.voiceDevices.outputUnsupportedTitle")}
                  </strong>
                  <span className="text-[11px] leading-relaxed">
                    {t("settings.voiceDevices.outputUnsupportedBody")}
                  </span>
                </div>
              </div>
            ) : outputSelectionStatus === "unavailable" ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/80 p-3 text-xs text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertCircleIcon className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <strong className="text-navy dark:text-slate-200">
                    {t("settings.voiceDevices.outputCapabilityUnavailableTitle")}
                  </strong>
                  <span className="text-[11px] leading-relaxed">
                    {t("settings.voiceDevices.outputCapabilityUnavailableBody")}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5 pt-1">
                  <label
                    htmlFor="voice-device-output-select"
                    className="text-xs font-semibold text-slatecopy dark:text-slate-400"
                  >
                    {t("settings.voiceDevices.outputLabel")}
                  </label>
                  <select
                    id="voice-device-output-select"
                    className="settings-select w-full text-xs font-medium"
                    value={selectedOutputValue}
                    disabled={isBusy}
                    onChange={(event) => {
                      const val = event.target.value;
                      onSelectOutputDevice(val ? val : null);
                    }}
                  >
                    <option value="">
                      {t("settings.voiceDevices.systemDefaultOption")}
                    </option>
                    {outputDevices.map((device, index) => {
                      const label = device.label.trim()
                        ? device.label
                        : `${t("settings.voiceDevices.speaker")} ${index + 1}`;
                      return (
                        <option key={device.deviceId} value={device.deviceId}>
                          {label}
                        </option>
                      );
                    })}
                    {isPreferredOutputMissing && (
                      <option value={preferredOutputDeviceId}>
                        {preferredOutputDeviceId} ({t("settings.voiceDevices.disconnectedOption")})
                      </option>
                    )}
                  </select>
                </div>

                {/* Fallback Warning Notice for Output */}
                {outputResolution === "preferred-unavailable" && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200/80 bg-amber-50/80 p-2.5 text-[11px] text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
                    <AlertCircleIcon className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                    <span>{t("settings.voiceDevices.outputDisconnectedNotice")}</span>
                  </div>
                )}

                {outputStatus === "unavailable" && outputDevices.length === 0 && (
                  <p className="text-[11px] text-slate-500 italic">
                    {t("settings.voiceDevices.outputEnumerationUnavailable")}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Crucial Speaker Scope & System TTS Boundary Note */}
          <p className="text-[11px] text-slatecopy dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800/60 pt-2.5">
            {t("settings.voiceDevices.outputNote")}
          </p>
        </div>
      </div>

      {/* Footer Informational Callout */}
      <div className="flex items-start gap-2 rounded-xl border border-blue-100/50 bg-blue-50/40 p-3 text-[11px] text-slatecopy dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
        <InfoIcon className="w-3.5 h-3.5 shrink-0 text-brand dark:text-blue-400 mt-0.5" />
        <span>{t("settings.voiceDevices.footerNote")}</span>
      </div>
    </div>
  );
}
