import { useState } from "react";
import { useI18n } from "../../i18n.js";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, TrashIcon } from "./icons.js";
import {
  getDefaultAuthHeader,
  getDefaultAuthStrategy,
  type ProviderAdapter,
  type ProviderAuth,
} from "./types.js";

export type HeaderDraft = {
  readonly key: string;
  readonly originalName?: string;
  readonly name: string;
  readonly value: string;
  readonly deleted?: boolean;
};

export type AdvancedConnectionSettingsProps = {
  readonly profileId: string;
  readonly onProfileIdChange: (id: string) => void;
  readonly isEditing: boolean;
  readonly adapter: ProviderAdapter;
  readonly customAuth: ProviderAuth | null;
  readonly onCustomAuthChange: (auth: ProviderAuth | null) => void;
  readonly headers: readonly HeaderDraft[];
  readonly onHeadersChange: (headers: readonly HeaderDraft[]) => void;
  readonly disabled?: boolean;
};

export function AdvancedConnectionSettings({
  profileId,
  onProfileIdChange,
  isEditing,
  adapter,
  customAuth,
  onCustomAuthChange,
  headers,
  onHeadersChange,
  disabled = false,
}: AdvancedConnectionSettingsProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(Boolean(customAuth || headers.length > 0));

  const isSystem = adapter === "system-tts";

  function handleAddHeader() {
    onHeadersChange([
      ...headers,
      { key: `new-${Date.now()}-${headers.length}`, name: "", value: "" },
    ]);
  }

  function handleUpdateHeaderName(key: string, name: string) {
    onHeadersChange(
      headers.map((h) => (h.key === key ? { ...h, name } : h)),
    );
  }

  function handleUpdateHeaderValue(key: string, value: string) {
    onHeadersChange(
      headers.map((h) => (h.key === key ? { ...h, value } : h)),
    );
  }

  function handleDeleteHeader(key: string) {
    onHeadersChange(
      headers
        .map((h) => (h.key === key && h.originalName ? { ...h, deleted: true } : h))
        .filter((h) => h.key !== key || Boolean(h.originalName)),
    );
  }

  const activeHeaders = headers.filter((h) => !h.deleted);

  return (
    <div className="border-t border-blue-50 dark:border-slate-800 pt-2">
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs font-bold text-slatecopy hover:text-navy dark:hover:text-slate-100 cursor-pointer py-1"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDownIcon className="w-3.5 h-3.5" />
        ) : (
          <ChevronRightIcon className="w-3.5 h-3.5" />
        )}
        <span>{t("settings.providers.modal.advanced")}</span>
      </button>

      {isOpen && (
        <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-blue-100/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-4">
          {/* Profile Slug ID */}
          <div>
            <label
              htmlFor="modal-provider-slug"
              className="block text-[11px] font-bold text-navy dark:text-slate-100 mb-1"
            >
              {t("settings.providers.modal.advanced.slug")}
            </label>
            <input
              id="modal-provider-slug"
              type="text"
              className="settings-select w-full text-xs font-mono"
              placeholder="e.g. openrouter-primary"
              value={profileId}
              maxLength={64}
              disabled={isEditing || disabled}
              onChange={(e) => onProfileIdChange(e.target.value)}
            />
          </div>

          {/* Custom Auth Header Scheme */}
          {!isSystem && (
            <div className="flex flex-col gap-2">
              <label
                htmlFor="modal-provider-auth-scheme"
                className="text-[11px] font-bold text-navy dark:text-slate-100"
              >
                {t("settings.providers.modal.advanced.authScheme")}
              </label>
              <select
                id="modal-provider-auth-scheme"
                className="settings-select w-full text-xs"
                value={customAuth ? "custom" : "default"}
                disabled={disabled}
                onChange={(e) => {
                  if (e.target.value === "default") {
                    onCustomAuthChange(null);
                  } else {
                    onCustomAuthChange({
                      headerName: getDefaultAuthHeader(adapter),
                      strategy: getDefaultAuthStrategy(adapter),
                    });
                  }
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
                    disabled={disabled}
                    onChange={(e) =>
                      onCustomAuthChange({ ...customAuth, headerName: e.target.value })
                    }
                  />
                  <select
                    className="settings-select text-xs"
                    value={customAuth.strategy}
                    disabled={disabled}
                    onChange={(e) =>
                      onCustomAuthChange({
                        ...customAuth,
                        strategy: e.target.value as "bearer" | "raw",
                      })
                    }
                  >
                    <option value="bearer">Bearer &lt;token&gt;</option>
                    <option value="raw">Raw &lt;token&gt;</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Custom Request Headers */}
          {!isSystem && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-navy dark:text-slate-100">
                  {t("settings.providers.modal.advanced.headers", { count: activeHeaders.length })}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact text-[11px] flex items-center gap-1"
                  disabled={disabled || activeHeaders.length >= 16}
                  onClick={handleAddHeader}
                >
                  <PlusIcon className="w-3 h-3" />
                  <span>{t("settings.providers.modal.advanced.addHeader")}</span>
                </button>
              </div>

              {activeHeaders.map((hdr) => (
                <div key={hdr.key} className="flex gap-2 items-center">
                  <input
                    type="text"
                    className="settings-select flex-1 text-xs font-mono"
                    placeholder={t("settings.providers.modal.advanced.headerName")}
                    value={hdr.name}
                    disabled={disabled}
                    onChange={(e) => handleUpdateHeaderName(hdr.key, e.target.value)}
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
                    disabled={disabled}
                    onChange={(e) => handleUpdateHeaderValue(hdr.key, e.target.value)}
                  />
                  <button
                    type="button"
                    className="text-slatecopy hover:text-red-600 p-1 cursor-pointer"
                    disabled={disabled}
                    onClick={() => handleDeleteHeader(hdr.key)}
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
  );
}
