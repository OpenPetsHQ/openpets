import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n.js";
import { Button } from "../components/ui/Button.js";
import { GlassCard } from "../components/ui/GlassCard.js";
import { StatusPill } from "../components/ui/StatusPill.js";
import type {
  ConnectedAppsApi,
  ConnectedAppsPluginConnection,
  ConnectedAppsProvider,
  ConnectedAppsProviderSnapshot,
  ConnectedAppsSnapshot,
} from "../../../connected-apps-contract.js";
import {
  canDisconnectConnectedApp,
  connectedAppsConnectionActionKey,
  connectedAppsStateLabelKey,
  connectedAppsStateTone,
} from "./connected-apps-state.js";

type ConnectedAppsViewProps = { readonly api: ConnectedAppsApi };
type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function ConnectedAppsView({ api }: ConnectedAppsViewProps) {
  const { t, locale } = useI18n();
  const [snapshot, setSnapshot] = useState<ConnectedAppsSnapshot | null>(null);
  const [busy, setBusy] = useState("");
  const [errorKey, setErrorKey] = useState("");
  const [disconnectTarget, setDisconnectTarget] = useState<{ pluginId: string; provider: ConnectedAppsProvider } | null>(null);

  useEffect(() => {
    let active = true;
    void api.getConnectedAppsSnapshot().then((next) => {
      if (active) {
        setSnapshot(next);
        setErrorKey("");
      }
    }).catch(() => {
      if (active) setErrorKey("connectedApps.loadError");
    });
    return () => { active = false; };
  }, [api]);

  const setPluginAccess = async (pluginId: string, provider: ConnectedAppsProvider, enabled: boolean) => {
    const action = `${pluginId}:${provider}`;
    try {
      setBusy(action);
      setErrorKey("");
      setSnapshot(await api.setConnectedAppsPluginAccess(pluginId, provider, enabled));
    } catch {
      setErrorKey("connectedApps.permissionUpdateError");
    } finally {
      setBusy("");
    }
  };

  const connectAccount = async (pluginId: string, provider: ConnectedAppsProvider) => {
    const action = `${pluginId}:${provider}`;
    try {
      setBusy(action);
      setErrorKey("");
      setSnapshot(await api.connectConnectedAppsAccount(pluginId, provider));
    } catch {
      setErrorKey("connectedApps.connectError");
    } finally {
      setBusy("");
    }
  };

  const disconnectAccount = async () => {
    if (!disconnectTarget) return;
    const { pluginId, provider } = disconnectTarget;
    try {
      setBusy(`${pluginId}:${provider}`);
      setErrorKey("");
      setSnapshot(await api.disconnectConnectedAppsAccount(pluginId, provider));
      setDisconnectTarget(null);
    } catch {
      setErrorKey("connectedApps.disconnectError");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="connected-apps-view flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="eyebrow">{t("connectedApps.eyebrow")}</p>
        <h2 className="text-xl font-semibold text-navy">{t("connectedApps.title")}</h2>
        <p className="text-sm text-slatecopy">{t("connectedApps.description")}</p>
      </header>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">
        <strong className="block mb-1">{t("connectedApps.blockerTitle")}</strong>
        <p>{t("connectedApps.blockerDescription")}</p>
      </div>

      {errorKey && <div className="error" role="alert">{t(errorKey)}</div>}

      {!snapshot ? (
        <GlassCard className="flex h-40 items-center justify-center text-sm text-slatecopy">
          {errorKey ? t("connectedApps.loadRetry") : t("connectedApps.loading")}
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {snapshot.providers.map((provider) => (
            <ConnectedAppsProviderCard
              key={provider.provider}
              snapshot={provider}
              busy={busy}
              locale={locale}
              t={t}
              onSetAccess={(pluginId, enabled) => void setPluginAccess(pluginId, provider.provider, enabled)}
              onConnect={(pluginId) => void connectAccount(pluginId, provider.provider)}
              onDisconnect={(pluginId) => setDisconnectTarget({ pluginId, provider: provider.provider })}
            />
          ))}
        </div>
      )}

      {disconnectTarget && (
        <div className="plugin-config-overlay" role="presentation">
          <button
            type="button"
            className="plugin-config-backdrop"
            aria-label={t("common.cancel")}
            onClick={() => setDisconnectTarget(null)}
          />
          <GlassCard className="plugin-inspector" role="alertdialog" aria-modal="true" aria-labelledby="connected-apps-disconnect-title">
            <h2 id="connected-apps-disconnect-title" className="text-lg font-semibold text-navy">
              {t("connectedApps.confirmDisconnectTitle")}
            </h2>
            <p className="mt-3 text-sm text-slatecopy">
              {t("connectedApps.confirmDisconnectDescription", {
                plugin: disconnectTarget.pluginId,
                provider: t(`connectedApps.provider.${disconnectTarget.provider}`),
              })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDisconnectTarget(null)}>{t("common.cancel")}</Button>
              <Button variant="danger" disabled={Boolean(busy)} onClick={() => void disconnectAccount()}>
                {t("connectedApps.disconnect")}
              </Button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}

export function ConnectedAppsProviderCard({
  snapshot,
  busy,
  locale,
  t,
  onSetAccess,
  onConnect,
  onDisconnect,
}: {
  readonly snapshot: ConnectedAppsProviderSnapshot;
  readonly busy: string;
  readonly locale: string;
  readonly t: Translate;
  readonly onSetAccess: (pluginId: string, enabled: boolean) => void;
  readonly onConnect: (pluginId: string) => void;
  readonly onDisconnect: (pluginId: string) => void;
}) {
  const providerTitle = t(`connectedApps.provider.${snapshot.provider}`);
  const connectedPlugins = snapshot.connections.filter((connection) => connection.permissionRequested);

  return (
    <GlassCard className="flex flex-col gap-4 p-4" aria-labelledby={`connected-apps-${snapshot.provider}-title`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-bold ${snapshot.provider === "google" ? "bg-white text-[#4285f4] ring-1 ring-slate-200" : "bg-[#2563eb] text-white"}`} aria-hidden="true">
          {snapshot.provider === "google" ? "G" : "O"}
        </div>
        <div className="min-w-0 flex-1">
          <h3 id={`connected-apps-${snapshot.provider}-title`} className="text-base font-semibold text-navy">{providerTitle}</h3>
          <p className="mt-1 text-xs text-slatecopy">{t("connectedApps.accountScope")}</p>
        </div>
      </div>

      <section className="border-t border-navy/10 pt-3">
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-navy">{t("connectedApps.pluginAccessTitle")}</h4>
          <p className="mt-1 text-xs text-slatecopy">{t("connectedApps.pluginAccessDescription")}</p>
        </div>
        {connectedPlugins.length === 0 ? (
          <p className="rounded-xl bg-navy/5 p-3 text-xs text-slatecopy">{t("connectedApps.noPluginRequests")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {connectedPlugins.map((connection) => (
              <PluginCalendarAccessRow
                key={connection.pluginId}
                connection={connection}
                provider={snapshot.provider}
                busy={busy === `${connection.pluginId}:${snapshot.provider}`}
                connectAllowed={snapshot.connectAllowed}
                accountLabel={connection.accountLabel}
                lastSyncAt={connection.lastSyncAt}
                state={connection.state}
                t={t}
                onChange={onSetAccess}
                onConnect={onConnect}
                onDisconnect={onDisconnect}
                locale={locale}
              />
            ))}
          </div>
        )}
      </section>
    </GlassCard>
  );
}

function PluginCalendarAccessRow({
  connection,
  provider,
  busy,
  connectAllowed,
  accountLabel,
  lastSyncAt,
  state,
  t,
  onChange,
  onConnect,
  onDisconnect,
  locale,
}: {
  readonly connection: ConnectedAppsPluginConnection;
  readonly provider: ConnectedAppsProvider;
  readonly busy: boolean;
  readonly connectAllowed: boolean;
  readonly accountLabel: string | null;
  readonly lastSyncAt: string | null;
  readonly state: ConnectedAppsPluginConnection["state"];
  readonly t: Translate;
  readonly onChange: (pluginId: string, enabled: boolean) => void;
  readonly onConnect: (pluginId: string) => void;
  readonly onDisconnect: (pluginId: string) => void;
  readonly locale: string;
}) {
  const inputId = `calendar-access-${provider}-${connection.pluginId.replace(/[^a-z0-9_-]/gi, "-")}`;
  return (
    <div className="rounded-xl border border-navy/10 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-navy">{connection.pluginName}</span>
          <StatusPill tone={connectedAppsStateTone(state)}>{t(connectedAppsStateLabelKey(state))}</StatusPill>
        </div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="compact"
            disabled={!connectAllowed || busy || state === "pending"}
            title={connectAllowed ? undefined : t("connectedApps.blocker.calendar_identity_verification_unavailable")}
            onClick={() => onConnect(connection.pluginId)}
          >
            {t(connectedAppsConnectionActionKey(state))}
          </Button>
          {canDisconnectConnectedApp(state) && (
            <Button
              variant="danger"
              size="compact"
              disabled={busy}
              onClick={() => onDisconnect(connection.pluginId)}
              ariaLabel={t("connectedApps.disconnectPluginAria", { plugin: connection.pluginName, provider: t(`connectedApps.provider.${provider}`) })}
            >
              {t("connectedApps.disconnect")}
            </Button>
          )}
        </div>
      </div>
      <dl className="mb-3 grid grid-cols-1 gap-2 rounded-lg bg-navy/5 p-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-slatecopy">{t("connectedApps.account")}</dt>
          <dd className="mt-0.5 text-navy">{accountLabel ?? t("connectedApps.notAvailable")}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slatecopy">{t("connectedApps.lastSync")}</dt>
          <dd className="mt-0.5 text-navy">{formatLastSync(lastSyncAt, locale, t)}</dd>
        </div>
      </dl>
      <label htmlFor={inputId} className="flex cursor-pointer items-start gap-3">
        <input
          id={inputId}
          type="checkbox"
          checked={connection.accessGranted}
          disabled={busy}
          onChange={(event) => onChange(connection.pluginId, (event.currentTarget as unknown as { readonly checked: boolean }).checked)}
          className="mt-0.5 h-4 w-4 accent-brand"
        />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-semibold text-navy">{t("connectedApps.pluginPermissionLabel", { plugin: connection.pluginName })}</span>
          <span className="text-xs leading-relaxed text-slatecopy">{t("connectedApps.readOnlyScope")}</span>
          {!connection.pluginEnabled && <span className="text-xs text-amber-800">{t("connectedApps.pluginDisabled")}</span>}
        </span>
      </label>
    </div>
  );
}

function formatLastSync(timestamp: string | null, locale: string, t: Translate): string {
  if (!timestamp) return t("connectedApps.notAvailable");
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return t("connectedApps.notAvailable");
  return new Date(value).toLocaleString(locale);
}
