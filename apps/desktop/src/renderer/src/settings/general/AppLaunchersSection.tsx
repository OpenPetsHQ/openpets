import React, { useEffect, useState } from "react";

import type { AppLauncherSnapshotEntry } from "../../../../app-launcher-types.js";
import { useI18n } from "../../i18n.js";
import { Button } from "../../components/ui/Button.js";

export interface AppLauncherControlCenterApi {
  getAppLaunchers(): Promise<readonly AppLauncherSnapshotEntry[]>;
  addAppLauncher(name: string): Promise<readonly AppLauncherSnapshotEntry[]>;
  renameAppLauncher(id: string, name: string): Promise<readonly AppLauncherSnapshotEntry[]>;
  changeAppLauncherTarget(id: string): Promise<readonly AppLauncherSnapshotEntry[]>;
  moveAppLauncher(id: string, direction: -1 | 1): Promise<readonly AppLauncherSnapshotEntry[]>;
  removeAppLauncher(id: string): Promise<readonly AppLauncherSnapshotEntry[]>;
}

export function AppLaunchersSection({ api }: { readonly api: AppLauncherControlCenterApi }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<readonly AppLauncherSnapshotEntry[]>([]);
  const [newName, setNewName] = useState("");
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void api.getAppLaunchers().then((next) => {
      if (active) setEntries(next);
    }).catch(() => {
      if (active) setError(t("settings.launchers.error"));
    });
    return () => { active = false; };
  }, [api, t]);

  async function run(operation: () => Promise<readonly AppLauncherSnapshotEntry[]>): Promise<readonly AppLauncherSnapshotEntry[] | undefined> {
    setBusy(true);
    setError("");
    try {
      const next = await operation();
      setEntries(next);
      setDraftNames(Object.fromEntries(next.map((entry) => [entry.id, entry.name])));
      return next;
    } catch {
      setError(t("settings.launchers.error"));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function addLauncher(): Promise<void> {
    const next = await run(() => api.addAppLauncher(newName));
    if (next && next.length > entries.length) setNewName("");
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">{t("settings.launchers.title")}</h2>
      <p className="mb-4 max-w-3xl text-sm leading-relaxed text-slatecopy">{t("settings.launchers.description")}</p>

      <div className="settings-group">
        <div className="settings-row flex-wrap">
          <div className="settings-row-info">
            <label htmlFor="app-launcher-new-name"><strong>{t("settings.launchers.displayName")}</strong></label>
            <small>{t("settings.launchers.supportedTypes")}</small>
          </div>
          <div className="flex w-full max-w-xl flex-wrap items-center gap-2 sm:w-auto">
            <input
              id="app-launcher-new-name"
              className="settings-text-input min-w-0 flex-1"
              value={newName}
              maxLength={80}
              placeholder={t("settings.launchers.displayNamePlaceholder")}
              disabled={busy || entries.length >= 20}
              onChange={(event) => setNewName(event.target.value)}
            />
            <Button
              variant="primary"
              size="compact"
              disabled={busy || entries.length >= 20 || !newName.trim()}
              onClick={() => void addLauncher()}
            >
              {t("settings.launchers.add")}
            </Button>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="settings-row">
            <div className="settings-row-info"><small>{t("settings.launchers.empty")}</small></div>
          </div>
        ) : entries.map((entry, index) => {
          const draftName = draftNames[entry.id] ?? entry.name;
          const nameChanged = draftName.trim() !== entry.name;
          return (
            <div key={entry.id} className="settings-row flex-wrap">
              <div className="settings-row-info flex min-w-0 items-center gap-3">
                {entry.iconDataUrl && <img className="h-8 w-8 shrink-0 object-contain" src={entry.iconDataUrl} alt="" />}
                <div className="min-w-0 flex-1">
                  <label htmlFor={`app-launcher-name-${entry.id}`}><strong>{entry.name}</strong></label>
                  <small>{entry.available ? t("settings.launchers.available") : t("settings.launchers.unavailable")}</small>
                  <input
                    id={`app-launcher-name-${entry.id}`}
                    className="settings-text-input mt-2 w-full"
                    value={draftName}
                    maxLength={80}
                    disabled={busy}
                    aria-label={`${t("settings.launchers.displayName")} — ${entry.name}`}
                    onChange={(event) => setDraftNames((current) => ({ ...current, [entry.id]: event.target.value }))}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="compact"
                  ariaLabel={`${t("settings.launchers.moveUp")} — ${entry.name}`}
                  disabled={busy || index === 0}
                  onClick={() => void run(() => api.moveAppLauncher(entry.id, -1))}
                >
                  {t("settings.launchers.moveUp")}
                </Button>
                <Button
                  variant="secondary"
                  size="compact"
                  ariaLabel={`${t("settings.launchers.moveDown")} — ${entry.name}`}
                  disabled={busy || index === entries.length - 1}
                  onClick={() => void run(() => api.moveAppLauncher(entry.id, 1))}
                >
                  {t("settings.launchers.moveDown")}
                </Button>
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={busy}
                  onClick={() => void run(() => api.changeAppLauncherTarget(entry.id))}
                >
                  {t("settings.launchers.choose")}
                </Button>
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={busy || !nameChanged || !draftName.trim()}
                  onClick={() => void run(() => api.renameAppLauncher(entry.id, draftName))}
                >
                  {t("settings.launchers.save")}
                </Button>
                <Button
                  variant="danger"
                  size="compact"
                  disabled={busy}
                  onClick={() => void run(() => api.removeAppLauncher(entry.id))}
                >
                  {t("settings.launchers.remove")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
    </div>
  );
}
