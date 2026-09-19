import type { ProviderGates } from "./types.js";

export type ProviderGatesSectionProps = {
  readonly gates: ProviderGates;
  readonly busy: string;
  readonly onUpdateGate: (patch: Partial<ProviderGates>) => void;
};

export function ProviderGatesSection({
  gates,
  busy,
  onUpdateGate,
}: ProviderGatesSectionProps) {
  const isBusy = Boolean(busy);

  return (
    <div className="rounded-[24px] border border-blue-100/70 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 shadow-xs mt-6 flex flex-col gap-4">
      <div className="border-b border-blue-50 dark:border-slate-800 pb-3">
        <strong className="block text-sm font-bold text-navy dark:text-slate-100">
          Audio & Microphone Permissions
        </strong>
        <p className="text-xs text-slatecopy m-0">
          System-level host permissions for companion sound effects, voice generation, and microphone access.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {/* Plugin Audio */}
        <label className="flex items-center justify-between gap-4 text-xs font-medium cursor-pointer">
          <div>
            <strong className="block text-navy dark:text-slate-200">Allow Plugin Audio</strong>
            <span className="text-slatecopy block text-[11px]">
              Permit plugins to play sound effects and ambient audio.
            </span>
          </div>
          <input
            type="checkbox"
            className="toggle-switch"
            checked={gates.allowPluginAudio}
            disabled={isBusy}
            onChange={(e) => onUpdateGate({ allowPluginAudio: e.target.checked })}
          />
        </label>

        {/* Plugin Voice Output */}
        <label className="flex items-center justify-between gap-4 text-xs font-medium cursor-pointer">
          <div>
            <strong className="block text-navy dark:text-slate-200">Allow Plugin Voice Output</strong>
            <span className="text-slatecopy block text-[11px]">
              Permit plugins to trigger host speech synthesis for spoken announcements.
            </span>
          </div>
          <input
            type="checkbox"
            className="toggle-switch"
            checked={gates.allowPluginVoice}
            disabled={isBusy}
            onChange={(e) => onUpdateGate({ allowPluginVoice: e.target.checked })}
          />
        </label>

        {/* Dynamic Speech */}
        <label className="flex items-center justify-between gap-4 text-xs font-medium cursor-pointer">
          <div>
            <strong className="block text-navy dark:text-slate-200">Allow Dynamic Speech Generation</strong>
            <span className="text-slatecopy block text-[11px]">
              Permit plugins to synthesize custom arbitrary text using your active speech provider.
            </span>
          </div>
          <input
            type="checkbox"
            className="toggle-switch"
            checked={gates.allowDynamicSpeech}
            disabled={isBusy}
            onChange={(e) => onUpdateGate({ allowDynamicSpeech: e.target.checked })}
          />
        </label>

        {/* Microphone */}
        <label className="flex items-center justify-between gap-4 text-xs font-medium cursor-pointer">
          <div>
            <strong className="block text-navy dark:text-slate-200">Allow Microphone Access</strong>
            <span className="text-slatecopy block text-[11px]">
              Permit host audio capture for Speech-to-Text and voice conversations.
            </span>
          </div>
          <input
            type="checkbox"
            className="toggle-switch"
            checked={gates.allowMicrophone}
            disabled={isBusy}
            onChange={(e) => onUpdateGate({ allowMicrophone: e.target.checked })}
          />
        </label>

        {/* Quiet Hours */}
        <div className="pt-3 border-t border-blue-50 dark:border-slate-800 flex flex-col gap-2">
          <label className="flex items-center justify-between gap-4 text-xs font-medium cursor-pointer">
            <div>
              <strong className="block text-navy dark:text-slate-200">Quiet Hours</strong>
              <span className="text-slatecopy block text-[11px]">
                Automatically mute audio playback and spoken replies during designated hours.
              </span>
            </div>
            <input
              type="checkbox"
              className="toggle-switch"
              checked={gates.quietHours.enabled}
              disabled={isBusy}
              onChange={(e) =>
                onUpdateGate({
                  quietHours: { ...gates.quietHours, enabled: e.target.checked },
                })
              }
            />
          </label>

          {gates.quietHours.enabled && (
            <div className="flex items-center gap-2 pl-2 mt-1">
              <span className="text-xs text-slatecopy font-semibold">Active from</span>
              <input
                type="time"
                className="settings-select text-xs"
                value={gates.quietHours.start}
                disabled={isBusy}
                onChange={(e) =>
                  onUpdateGate({
                    quietHours: { ...gates.quietHours, start: e.target.value },
                  })
                }
              />
              <span className="text-xs text-slatecopy">to</span>
              <input
                type="time"
                className="settings-select text-xs"
                value={gates.quietHours.end}
                disabled={isBusy}
                onChange={(e) =>
                  onUpdateGate({
                    quietHours: { ...gates.quietHours, end: e.target.value },
                  })
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
