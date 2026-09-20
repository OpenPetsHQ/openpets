import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n.js";
import { Button } from "../components/ui/Button.js";
import { GlassCard } from "../components/ui/GlassCard.js";
import { StatusPill } from "../components/ui/StatusPill.js";
import { IntegrationIcon } from "./IntegrationIcon.js";
import { PathField } from "./PathField.js";
import {
  CloseIcon,
  ConfigureIcon,
  HookIcon,
  InstallIcon,
  MemoryIcon,
  NextIcon,
  RefreshIcon,
  RemoveIcon,
  ReplaceIcon,
} from "./icons.js";
import type {
  AgentSetupAction,
  AgentSetupCommandPaths,
  AgentSetupSnapshot,
  ClaudeCodeStatus,
  CursorSetupStatus,
  IntegrationsApi,
  IntegrationsViewProps,
  IntegrationStatusTone,
  OpenClawPluginStatus,
  OpenClawSetupState,
  OpenCodeSetupStatus,
  ZedSetupStatus,
} from "./types.js";

export const commandModeLabelKeys: Record<AgentSetupSnapshot["commandMode"], string> = {
  published: "integrations.commandMode.published",
  bundled: "integrations.commandMode.bundled",
  local: "integrations.commandMode.local",
};

export function claudeStatusTone(state: ClaudeCodeStatus["state"]): IntegrationStatusTone {
  if (state === "configured") return "green";
  if (state === "error") return "red";
  if (state === "needs_setup" || state === "detected") return "blue";
  return "slate";
}

export function opencodeStatusTone(state: OpenCodeSetupStatus["state"]): IntegrationStatusTone {
  if (state === "configured") return "green";
  if (state === "error") return "red";
  if (state === "needs_setup") return "blue";
  return "slate";
}

export function cursorStatusTone(state: CursorSetupStatus["state"]): IntegrationStatusTone {
  if (state === "configured") return "green";
  if (state === "error" || state === "conflict") return "red";
  if (state === "needs_update") return "orange";
  if (state === "needs_setup") return "blue";
  return "slate";
}

export function openclawStatusTone(state: OpenClawSetupState): IntegrationStatusTone {
  if (state === "installed-enabled") return "green";
  if (state === "installed-disabled") return "yellow";
  if (state === "not-installed") return "blue";
  if (state === "invalid" || state === "conflict") return "red";
  if (state === "indeterminate") return "orange";
  return "slate";
}

export function openclawStatusLabel(state: OpenClawSetupState, t: (key: string) => string): string {
  return t(`integrations.openclaw.state.${state}`);
}

export function openclawSourceLabel(source: OpenClawPluginStatus["trackedSource"], t: (key: string) => string): string {
  return source ? t(`integrations.openclaw.source.${source}`) : t("integrations.openclaw.source.none");
}

export function zedStatusTone(state: ZedSetupStatus["state"]): IntegrationStatusTone {
  if (state === "configured") return "green";
  if (state === "error" || state === "conflict") return "red";
  if (state === "disabled" || state === "needs_update") return "orange";
  if (state === "needs_setup") return "blue";
  return "slate";
}

export function IntegrationsView({ api: injectedApi }: IntegrationsViewProps) {
  const { t } = useI18n();
  const api = injectedApi ?? (window as unknown as { openPetsControlCenter: IntegrationsApi }).openPetsControlCenter;

  const [snapshot, setSnapshot] = useState<AgentSetupSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingAction, setConfirmingAction] = useState<"remove" | "update" | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async (selectedPetId?: string, commandMode?: AgentSetupSnapshot["commandMode"]) => {
    try {
      const petId = selectedPetId === undefined ? snapshot?.selectedPetId : selectedPetId;
      const mode = commandMode === undefined ? snapshot?.commandMode : commandMode;
      const next = await api.getIntegrationsState(petId, mode);
      setSnapshot(next);
      setError("");
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const run = async (label: string, action: AgentSetupAction) => {
    try {
      setBusy(label);
      setError("");
      setMessage("");
      const next = await api.runIntegrationAction(action, snapshot?.selectedPetId, snapshot?.commandMode);
      setSnapshot(next);
      if (next.lastAction) {
        if (next.lastAction.ok) setMessage(next.lastAction.message);
        else setError(next.lastAction.message);
      }
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy("");
    }
  };

  const updatePath = async (key: keyof AgentSetupCommandPaths, value: string) => {
    try {
      setBusy(t("integrations.busy.savingPath"));
      await api.updateIntegrationCommandPaths({ [key]: value });
      await load();
      setMessage(t("integrations.toast.pathSaved"));
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy("");
    }
  };

  const changeCommandMode = (mode: AgentSetupSnapshot["commandMode"]) => {
    void load(snapshot?.selectedPetId, mode);
  };

  if (!snapshot) {
    return (
      <GlassCard className="flex h-64 flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm font-semibold text-slatecopy">{error || t("integrations.loading")}</p>
        {error && (
          <Button variant="secondary" size="compact" icon={<RefreshIcon />} onClick={() => void load()}>
            {t("common.retry")}
          </Button>
        )}
      </GlassCard>
    );
  }

  const isBusy = Boolean(busy) || snapshot.busy;
  const integrationDialogTitleId = selectedId ? `integration-detail-title-${selectedId}` : undefined;

  const integrations = [
    {
      id: "claude",
      name: t("integrations.claude.name"),
      icon: "claude",
      status: snapshot.status.label,
      tone: claudeStatusTone(snapshot.status.state),
      description: t("integrations.claude.description"),
    },
    {
      id: "opencode",
      name: t("integrations.opencode.name"),
      icon: "opencode",
      status: snapshot.opencodeStatus.label,
      tone: opencodeStatusTone(snapshot.opencodeStatus.state),
      description: t("integrations.opencode.description"),
    },
    {
      id: "cursor",
      name: t("integrations.cursor.name"),
      icon: "cursor",
      status: snapshot.cursorStatus.label,
      tone: cursorStatusTone(snapshot.cursorStatus.state),
      description: t("integrations.cursor.description"),
    },
    {
      id: "openclaw",
      name: t("integrations.openclaw.name"),
      icon: "openclaw",
      status: snapshot.openclawStatus.label,
      tone: openclawStatusTone(snapshot.openclawStatus.state),
      description: t("integrations.openclaw.description"),
    },
    {
      id: "zed",
      name: t("integrations.zed.name"),
      icon: "zed",
      status: snapshot.zedStatus.label,
      tone: zedStatusTone(snapshot.zedStatus.state),
      description: t("integrations.zed.description"),
    },
    {
      id: "pi",
      name: t("integrations.pi.name"),
      icon: "pi",
      status: t("integrations.pi.status"),
      tone: "blue" satisfies IntegrationStatusTone,
      description: t("integrations.pi.description"),
    },
  ] as const;

  const soon = [
    { name: t("integrations.soon.vscode"), icon: "vscode" },
    { name: t("integrations.soon.windsurf"), icon: "windsurf" },
  ];

  const selectedIntegrationName =
    selectedId === "pi"
      ? t("integrations.pi.name")
      : integrations.find((item) => item.id === selectedId)?.name;

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2">
      {error && <div className="error">{error}</div>}
      {message && <div className="settings-success settings-message">{message}</div>}

      <div className="integration-grid">
        {integrations.map((item) => (
          <article
            key={item.id}
            className={`integration-card ${selectedId === item.id ? "border-brand ring-4 ring-brand/15" : ""}`}
          >
            <div className="plugin-card-body">
              <div className="integration-icon">
                <IntegrationIcon id={item.icon} />
              </div>
              <div className="plugin-card-content">
                <div className="flex items-center justify-between">
                  <strong>{item.name}</strong>
                  <StatusPill tone={item.tone}>{item.status}</StatusPill>
                </div>
                <small>{item.description}</small>
              </div>
            </div>
            <div className="plugin-card-footer">
              <div className="flex gap-2 w-full">
                {item.id === "claude" && snapshot.status.canConfigure && (
                  <Button
                    variant="primary"
                    size="compact"
                    icon={<InstallIcon />}
                    disabled={isBusy}
                    onClick={() => run(t("integrations.busy.installing"), "configure")}
                  >
                    {t("integrations.install")}
                  </Button>
                )}
                {item.id === "opencode" && snapshot.opencodeStatus.canInstall && (
                  <Button
                    variant="primary"
                    size="compact"
                    icon={<InstallIcon />}
                    disabled={isBusy}
                    onClick={() => run(t("integrations.busy.installing"), "opencode-install")}
                  >
                    {t("integrations.install")}
                  </Button>
                )}
                {item.id === "cursor" && snapshot.cursorStatus.canInstall && (
                  <Button
                    variant="primary"
                    size="compact"
                    icon={<InstallIcon />}
                    disabled={isBusy}
                    onClick={() => run(t("integrations.busy.installing"), "cursor-install")}
                  >
                    {t("integrations.install")}
                  </Button>
                )}
                {item.id === "openclaw" && (snapshot.openclawStatus.canInstall || snapshot.openclawStatus.canEnable) && (
                  <Button
                    variant="primary"
                    size="compact"
                    icon={<InstallIcon />}
                    disabled={isBusy}
                    onClick={() =>
                      run(
                        snapshot.openclawStatus.canEnable && !snapshot.openclawStatus.canInstall
                          ? "Enabling"
                          : t("integrations.busy.installing"),
                        "openclaw-install",
                      )
                    }
                  >
                    {snapshot.openclawStatus.canEnable && !snapshot.openclawStatus.canInstall
                      ? "Enable"
                      : t("integrations.install")}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="compact"
                  icon={<ConfigureIcon />}
                  fullWidth={item.id === "pi"}
                  onClick={() => {
                    setSelectedId(item.id);
                    setConfirmingAction(null);
                  }}
                >
                  {item.id === "pi" ? t("integrations.viewSetup") : t("integrations.configure")}
                </Button>
                {item.id === "zed" && snapshot.zedStatus.canInstall && (
                  <Button
                    variant="primary"
                    size="compact"
                    icon={<InstallIcon />}
                    disabled={isBusy}
                    onClick={() => run(t("integrations.busy.installing"), "zed-install")}
                  >
                    {t("integrations.install")}
                  </Button>
                )}
              </div>
            </div>
          </article>
        ))}
        {soon.map((item) => (
          <article key={item.name} className="integration-card opacity-60">
            <div className="plugin-card-body">
              <div className="integration-icon grayscale">
                <IntegrationIcon id={item.icon} />
              </div>
              <div className="plugin-card-content">
                <div className="flex items-center justify-between">
                  <strong>{item.name}</strong>
                  <StatusPill tone="slate">{t("integrations.soon.status")}</StatusPill>
                </div>
                <small>{t("integrations.soon.description")}</small>
              </div>
            </div>
            <div className="plugin-card-footer">
              <Button variant="secondary" size="compact" fullWidth disabled>
                {t("integrations.soon.button")}
              </Button>
            </div>
          </article>
        ))}
      </div>

      {selectedId && (
        <div
          className="plugin-config-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={integrationDialogTitleId}
        >
          <button
            className="plugin-config-backdrop"
            type="button"
            aria-label={t("integrations.closeAria")}
            onClick={() => {
              setSelectedId(null);
              setConfirmingAction(null);
            }}
          />
          <GlassCard className="plugin-inspector">
            <div className="plugin-inspector-head">
              <div className="plugin-inspector-icon">
                <IntegrationIcon id={selectedId} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="eyebrow">{t("integrations.detail")}</p>
                <h2 id={integrationDialogTitleId}>{selectedIntegrationName}</h2>
              </div>
              <Button
                variant="secondary"
                size="compact"
                icon={<CloseIcon />}
                onClick={() => {
                  setSelectedId(null);
                  setConfirmingAction(null);
                }}
              >
                {t("integrations.close")}
              </Button>
            </div>

            <div className="flex flex-col gap-5 mt-4">
              {selectedId !== "pi" && selectedId !== "openclaw" && (
                <section className="plugin-section">
                  <div className="plugin-section-title">
                    <small>{t("integrations.commandSource")}</small>
                    <strong>{t("integrations.cliMode")}</strong>
                  </div>
                  <select
                    className="settings-select w-full"
                    value={snapshot.commandMode}
                    disabled={isBusy}
                    onChange={(event) =>
                      changeCommandMode(event.target.value as AgentSetupSnapshot["commandMode"])
                    }
                  >
                    <option value="published">{t(commandModeLabelKeys.published)}</option>
                    <option value="bundled">{t(commandModeLabelKeys.bundled)}</option>
                    <option value="local" disabled={!snapshot.localDevAvailable}>
                      {t(commandModeLabelKeys.local)}
                      {snapshot.localDevAvailable ? "" : t("integrations.localUnavailable")}
                    </option>
                  </select>
                  <p className="text-xs text-slatecopy mt-2">{t("integrations.commandModeHelp")}</p>
                </section>
              )}

              {selectedId === "claude" && (
                <>
                  <section className="plugin-section">
                    <div className="plugin-section-title">
                      <small>{t("integrations.connection")}</small>
                      <strong>{t("integrations.statusRouting")}</strong>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-blue-50/50 border border-blue-100/50">
                      <div className="flex flex-col">
                        <strong className="text-sm text-navy">{snapshot.status.label}</strong>
                        <small className="text-xs text-slatecopy">{snapshot.status.details}</small>
                      </div>
                      <StatusPill tone={claudeStatusTone(snapshot.status.state)}>{snapshot.status.state}</StatusPill>
                    </div>
                    <div className="mt-2">
                      <label className="text-xs font-bold text-slatecopy uppercase tracking-wider mb-1 block">
                        {t("integrations.petRouting")}
                      </label>
                      <select
                        className="settings-select w-full"
                        value={snapshot.selectedPetId || ""}
                        onChange={(e) => void load(e.target.value)}
                        disabled={isBusy}
                      >
                        <option value="">{t("integrations.defaultPet")}</option>
                        {snapshot.petOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.displayName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </section>

                  <section className="plugin-section">
                    <div className="plugin-section-title">
                      <small>{t("integrations.configuration")}</small>
                      <strong>{t("integrations.commandPaths")}</strong>
                    </div>
                    <div className="flex flex-col gap-3">
                      <PathField
                        label={t("integrations.claudeCommand")}
                        value={snapshot.commandPaths.claude}
                        placeholder="claude"
                        onSave={(v) => updatePath("claude", v)}
                        disabled={isBusy}
                      />
                      <PathField
                        label={t("integrations.nodeCommand")}
                        value={snapshot.commandPaths.node}
                        placeholder="node"
                        onSave={(v) => updatePath("node", v)}
                        disabled={isBusy}
                      />
                    </div>
                  </section>

                  <div className="grid grid-cols-2 gap-3">
                    <section className="plugin-section">
                      <div className="plugin-section-title">
                        <small>{t("integrations.optional")}</small>
                        <strong>{t("integrations.claudeHooks")}</strong>
                      </div>
                      <div className="flex items-center justify-between mb-2">
                        <StatusPill tone={snapshot.hookStatus.status === "installed" ? "green" : "blue"}>
                          {snapshot.hookStatus.status}
                        </StatusPill>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Button
                          variant="primary"
                          size="compact"
                          icon={<HookIcon />}
                          disabled={isBusy}
                          onClick={() => run(t("integrations.busy.installingHooks"), "install-hooks")}
                        >
                          {t("integrations.installHooks")}
                        </Button>
                        <Button
                          variant="danger"
                          size="compact"
                          icon={<RemoveIcon />}
                          disabled={isBusy || snapshot.hookStatus.status === "needs_setup"}
                          onClick={() => run(t("integrations.busy.removingHooks"), "uninstall-hooks")}
                        >
                          {t("integrations.removeHooks")}
                        </Button>
                      </div>
                    </section>
                    <section className="plugin-section">
                      <div className="plugin-section-title">
                        <small>{t("integrations.included")}</small>
                        <strong>{t("integrations.instructions")}</strong>
                      </div>
                      <div className="flex items-center justify-between mb-2">
                        <StatusPill tone={snapshot.memoryStatus.state === "installed" ? "green" : "blue"}>
                          {snapshot.memoryStatus.state}
                        </StatusPill>
                      </div>
                      <Button
                        variant="secondary"
                        size="compact"
                        icon={<MemoryIcon />}
                        disabled={isBusy}
                        onClick={() => run(t("integrations.busy.updatingInstructions"), "install-memory")}
                      >
                        {t("integrations.updateInstructions")}
                      </Button>
                    </section>
                  </div>

                  <section className="plugin-section">
                    <div className="plugin-section-title">
                      <small>{t("integrations.actions")}</small>
                      <strong>{t("integrations.management")}</strong>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {snapshot.status.canConfigure && (
                        <Button
                          variant="primary"
                          icon={<InstallIcon />}
                          disabled={isBusy}
                          onClick={() => run(t("integrations.busy.installing"), "configure")}
                        >
                          {t("integrations.installMcp")}
                        </Button>
                      )}
                      {snapshot.status.canReplace && (
                        <Button
                          variant="warning"
                          icon={<ReplaceIcon />}
                          disabled={isBusy}
                          onClick={() => run(t("integrations.busy.replacing"), "replace")}
                        >
                          {t("integrations.replaceMcp")}
                        </Button>
                      )}
                      {snapshot.status.canRemove && (
                        <Button
                          variant="danger"
                          icon={<RemoveIcon />}
                          disabled={isBusy}
                          onClick={() => run(t("integrations.busy.removing"), "remove")}
                        >
                          {t("integrations.removeMcp")}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        icon={<RefreshIcon />}
                        disabled={isBusy}
                        onClick={() => void load()}
                      >
                        {t("integrations.refreshStatus")}
                      </Button>
                    </div>
                  </section>

                  <details className="plugin-section group">
                    <summary className="cursor-pointer list-none flex items-center justify-between">
                      <div className="plugin-section-title">
                        <small>{t("integrations.advanced")}</small>
                        <strong>{t("integrations.mcpJsonPreview")}</strong>
                      </div>
                      <span className="text-brand group-open:rotate-180 transition-transform">
                        <NextIcon />
                      </span>
                    </summary>
                    <pre className="mt-3 p-3 rounded-xl bg-navy/5 text-[10px] font-mono overflow-x-auto border border-navy/5">
                      {JSON.stringify(snapshot.preview.mcpJson, null, 2)}
                    </pre>
                  </details>
                </>
              )}

              {selectedId === "opencode" && (
                <>
                  <section className="plugin-section">
                    <div className="plugin-section-title">
                      <small>{t("integrations.connection")}</small>
                      <strong>{t("integrations.globalSetup")}</strong>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-blue-50/50 border border-blue-100/50">
                      <div className="flex flex-col">
                        <strong className="text-sm text-navy">{snapshot.opencodeStatus.label}</strong>
                        <small className="text-xs text-slatecopy">{snapshot.opencodeStatus.details}</small>
                      </div>
                      <StatusPill tone={opencodeStatusTone(snapshot.opencodeStatus.state)}>
                        {snapshot.opencodeStatus.state}
                      </StatusPill>
                    </div>
                    <div className="mt-2">
                      <label className="text-xs font-bold text-slatecopy uppercase tracking-wider mb-1 block">
                        {t("integrations.petRouting")}
                      </label>
                      <select
                        className="settings-select w-full"
                        value={snapshot.selectedPetId || ""}
                        onChange={(e) => void load(e.target.value)}
                        disabled={isBusy}
                      >
                        <option value="">{t("integrations.defaultPet")}</option>
                        {snapshot.petOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.displayName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </section>

                  <section className="plugin-section">
                    <div className="plugin-section-title">
                      <small>{t("integrations.configuration")}</small>
                      <strong>{t("integrations.commandPaths")}</strong>
                    </div>
                    <div className="flex flex-col gap-3">
                      <PathField
                        label={t("integrations.opencodeCommand")}
                        value={snapshot.commandPaths.opencode}
                        placeholder="opencode"
                        onSave={(v) => updatePath("opencode", v)}
                        disabled={isBusy}
                      />
                      <PathField
                        label={t("integrations.nodeCommand")}
                        value={snapshot.commandPaths.node}
                        placeholder="node"
                        onSave={(v) => updatePath("node", v)}
                        disabled={isBusy}
                      />
                    </div>
                  </section>

                  <section className="plugin-section">
                    <div className="plugin-section-title">
                      <small>{t("integrations.actions")}</small>
                      <strong>{t("integrations.management")}</strong>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {snapshot.opencodeStatus.canInstall && (
                        <Button
                          variant="primary"
                          icon={<InstallIcon />}
                          disabled={isBusy}
                          onClick={() => run(t("integrations.busy.installing"), "opencode-install")}
                        >
                          {t("integrations.installGlobal")}
                        </Button>
                      )}
                      {snapshot.opencodeStatus.canRemove && (
                        <Button
                          variant="danger"
                          icon={<RemoveIcon />}
                          disabled={isBusy}
                          onClick={() => run(t("integrations.busy.removing"), "opencode-remove")}
                        >
                          {t("integrations.removeGlobal")}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        icon={<RefreshIcon />}
                        disabled={isBusy}
                        onClick={() => void load()}
                      >
                        {t("integrations.refreshStatus")}
                      </Button>
                    </div>
                  </section>

                  <details className="plugin-section group">
                    <summary className="cursor-pointer list-none flex items-center justify-between">
                      <div className="plugin-section-title">
                        <small>{t("integrations.advanced")}</small>
                        <strong>{t("integrations.configPreview")}</strong>
                      </div>
                      <span className="text-brand group-open:rotate-180 transition-transform">
                        <NextIcon />
                      </span>
                    </summary>
                    <pre className="mt-3 p-3 rounded-xl bg-navy/5 text-[10px] font-mono overflow-x-auto border border-navy/5">
                      {JSON.stringify(snapshot.opencodePreview.configPreview, null, 2)}
                    </pre>
                  </details>
                </>
              )}

              {selectedId === "cursor" && (
                <>
                  <section className="plugin-section">
                    <div className="plugin-section-title">
                      <small>{t("integrations.connection")}</small>
                      <strong>{t("integrations.globalMcp")}</strong>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-blue-50/50 border border-blue-100/50">
                      <div className="flex flex-col">
                        <strong className="text-sm text-navy">{snapshot.cursorStatus.label}</strong>
                        <small className="text-xs text-slatecopy">{snapshot.cursorStatus.details}</small>
                      </div>
                      <StatusPill tone={cursorStatusTone(snapshot.cursorStatus.state)}>
                        {snapshot.cursorStatus.state}
                      </StatusPill>
                    </div>
                    <div className="mt-2">
                      <label className="text-xs font-bold text-slatecopy uppercase tracking-wider mb-1 block">
                        {t("integrations.petRouting")}
                      </label>
                      <select
                        className="settings-select w-full"
                        value={snapshot.selectedPetId || ""}
                        onChange={(e) => void load(e.target.value)}
                        disabled={isBusy}
                      >
                        <option value="">{t("integrations.defaultPet")}</option>
                        {snapshot.petOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.displayName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </section>

                  <section className="plugin-section">
                    <div className="plugin-section-title">
                      <small>{t("integrations.actions")}</small>
                      <strong>{t("integrations.management")}</strong>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {snapshot.cursorStatus.canInstall && (
                        <Button
                          variant="primary"
                          icon={<InstallIcon />}
                          disabled={isBusy}
                          onClick={() => run(t("integrations.busy.installing"), "cursor-install")}
                        >
                          {t("integrations.installMcp")}
                        </Button>
                      )}
                      {snapshot.cursorStatus.canReplace && (
                        <Button
                          variant="warning"
                          icon={<ReplaceIcon />}
                          disabled={isBusy}
                          onClick={() => run(t("integrations.busy.replacing"), "cursor-replace")}
                        >
                          {t("integrations.replaceMcp")}
                        </Button>
                      )}
                      {snapshot.cursorStatus.canRemove && (
                        <Button
                          variant="danger"
                          icon={<RemoveIcon />}
                          disabled={isBusy}
                          onClick={() => run(t("integrations.busy.removing"), "cursor-remove")}
                        >
                          {t("integrations.removeMcp")}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        icon={<RefreshIcon />}
                        disabled={isBusy}
                        onClick={() => void load()}
                      >
                        {t("integrations.refreshStatus")}
                      </Button>
                    </div>
                  </section>

                  <details className="plugin-section group">
                    <summary className="cursor-pointer list-none flex items-center justify-between">
                      <div className="plugin-section-title">
                        <small>{t("integrations.advanced")}</small>
                        <strong>{t("integrations.mcpEntryPreview")}</strong>
                      </div>
                      <span className="text-brand group-open:rotate-180 transition-transform">
                        <NextIcon />
                      </span>
                    </summary>
                    <pre className="mt-3 p-3 rounded-xl bg-navy/5 text-[10px] font-mono overflow-x-auto border border-navy/5">
                      {JSON.stringify({ mcpServers: snapshot.cursorPreview.mcpEntry }, null, 2)}
                    </pre>
                  </details>

                  <details className="plugin-section group">
                    <summary className="cursor-pointer list-none flex items-center justify-between">
                      <div className="plugin-section-title">
                        <small>{t("integrations.advanced")}</small>
                        <strong>{t("integrations.rulesPreview")}</strong>
                      </div>
                      <span className="text-brand group-open:rotate-180 transition-transform">
                        <NextIcon />
                      </span>
                    </summary>
                    <p className="mt-3 text-xs text-slatecopy">{snapshot.cursorPreview.rulesPath}</p>
                    <pre className="mt-3 p-3 rounded-xl bg-navy/5 text-[10px] font-mono overflow-x-auto border border-navy/5">
                      {snapshot.cursorPreview.rulesContent}
                    </pre>
                  </details>
                </>
              )}

              {selectedId === "openclaw" && (
                <>
                  <div className="p-3.5 rounded-2xl bg-blue-50/60 border border-blue-100/70 text-xs text-slatecopy leading-relaxed">
                    <strong className="text-navy font-semibold block mb-1">
                      {t("integrations.openclaw.localTitle")}
                    </strong>
                    {t("integrations.openclaw.localDescription")}
                  </div>

                  <section className="plugin-section">
                    <div className="plugin-section-title">
                      <small>{t("integrations.connection")}</small>
                      <strong>{t("integrations.statusRouting")}</strong>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-blue-50/50 border border-blue-100/50">
                      <div className="flex flex-col">
                        <strong className="text-sm text-navy">{snapshot.openclawStatus.label}</strong>
                        <small className="text-xs text-slatecopy">{snapshot.openclawStatus.details}</small>
                      </div>
                      <StatusPill tone={openclawStatusTone(snapshot.openclawStatus.state)}>
                        {openclawStatusLabel(snapshot.openclawStatus.state, t)}
                      </StatusPill>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2.5 rounded-xl bg-navy/5 border border-navy/5 flex flex-col">
                        <span className="text-[10px] font-bold text-slatecopy uppercase tracking-wider">
                          {t("integrations.openclaw.hostVersion")}
                        </span>
                        <span className="font-mono text-navy font-semibold">
                          {snapshot.openclawStatus.version || t("integrations.openclaw.notDetected")}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-navy/5 border border-navy/5 flex flex-col">
                        <span className="text-[10px] font-bold text-slatecopy uppercase tracking-wider">
                          {t("integrations.openclaw.installedPlugin")}
                        </span>
                        <span className="font-mono text-navy font-semibold">
                          {snapshot.openclawStatus.installedVersion || t("integrations.openclaw.notInstalled")}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-navy/5 border border-navy/5 flex flex-col">
                        <span className="text-[10px] font-bold text-slatecopy uppercase tracking-wider">
                          {t("integrations.openclaw.installationSource")}
                        </span>
                        <span className="font-mono text-navy font-semibold">
                          {openclawSourceLabel(snapshot.openclawStatus.trackedSource, t)}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-navy/5 border border-navy/5 flex flex-col">
                        <span className="text-[10px] font-bold text-slatecopy uppercase tracking-wider">
                          {t("integrations.openclaw.targetVersion")}
                        </span>
                        <span className="font-mono text-navy font-semibold">
                          v{snapshot.openclawPreview.targetVersion}
                        </span>
                      </div>
                    </div>
                  </section>

                  {snapshot.openclawStatus.state === "management-disabled" && (
                    <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                      <strong>{t("integrations.openclaw.nixTitle")}</strong> {t("integrations.openclaw.nixDescription")}
                    </div>
                  )}

                  {snapshot.openclawStatus.state === "conflict" && (
                    <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-900">
                      <strong>{t("integrations.openclaw.conflictTitle")}</strong> {t("integrations.openclaw.conflictDescription")}
                    </div>
                  )}

                  {(snapshot.openclawStatus.state === "indeterminate" || snapshot.openclawStatus.state === "invalid") && (
                    <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                      <strong>{t("integrations.openclaw.unverifiedTitle")}</strong> {snapshot.openclawStatus.details}{" "}
                      {t("integrations.openclaw.unverifiedDescription")}
                    </div>
                  )}

                  <section className="plugin-section">
                    <div className="plugin-section-title">
                      <small>{t("integrations.configuration")}</small>
                      <strong>{t("integrations.commandPaths")}</strong>
                    </div>
                    <div className="flex flex-col gap-3">
                      <PathField
                        label={t("integrations.openclaw.command")}
                        value={snapshot.commandPaths.openclaw}
                        placeholder="openclaw"
                        onSave={(v) => updatePath("openclaw", v)}
                        disabled={isBusy}
                      />
                    </div>
                  </section>

                  <section className="plugin-section">
                    <div className="plugin-section-title">
                      <small>{t("integrations.actions")}</small>
                      <strong>{t("integrations.management")}</strong>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {(snapshot.openclawStatus.canInstall || snapshot.openclawStatus.canEnable) && (
                        <Button
                          variant="primary"
                          icon={<InstallIcon />}
                          disabled={isBusy}
                          onClick={() =>
                            run(
                              snapshot.openclawStatus.canEnable && !snapshot.openclawStatus.canInstall
                                ? t("integrations.openclaw.busy.enabling")
                                : t("integrations.openclaw.busy.installing"),
                              "openclaw-install",
                            )
                          }
                        >
                          {snapshot.openclawStatus.canEnable && !snapshot.openclawStatus.canInstall
                            ? t("integrations.openclaw.enable")
                            : t("integrations.openclaw.install")}
                        </Button>
                      )}

                      {snapshot.openclawStatus.canUpdate && !snapshot.openclawStatus.canInstall && (
                        confirmingAction === "update" ? (
                          <Button
                            variant="warning"
                            icon={<ReplaceIcon />}
                            disabled={isBusy}
                            onClick={() => {
                              setConfirmingAction(null);
                              void run(t("integrations.openclaw.busy.updating"), "openclaw-update");
                            }}
                          >
                            {t("integrations.openclaw.confirmUpdate")}
                          </Button>
                        ) : (
                          <Button
                            variant="warning"
                            icon={<ReplaceIcon />}
                            disabled={isBusy}
                            onClick={() => setConfirmingAction("update")}
                          >
                            {t("integrations.openclaw.update")}
                          </Button>
                        )
                      )}

                      {snapshot.openclawStatus.canRemove && (
                        confirmingAction === "remove" ? (
                          <Button
                            variant="danger"
                            icon={<RemoveIcon />}
                            disabled={isBusy}
                            onClick={() => {
                              setConfirmingAction(null);
                              void run(t("integrations.openclaw.busy.removing"), "openclaw-remove");
                            }}
                          >
                            {t("integrations.openclaw.confirmRemove")}
                          </Button>
                        ) : (
                          <Button
                            variant="danger"
                            icon={<RemoveIcon />}
                            disabled={isBusy}
                            onClick={() => setConfirmingAction("remove")}
                          >
                            {t("integrations.openclaw.remove")}
                          </Button>
                        )
                      )}

                      {confirmingAction && (
                        <Button variant="secondary" disabled={isBusy} onClick={() => setConfirmingAction(null)}>
                          {t("common.cancel")}
                        </Button>
                      )}

                      <Button
                        variant="secondary"
                        icon={<RefreshIcon />}
                        disabled={isBusy}
                        onClick={() => {
                          setConfirmingAction(null);
                          void load();
                        }}
                      >
                        {t("integrations.refreshStatus")}
                      </Button>
                    </div>
                  </section>

                  <details className="plugin-section group">
                    <summary className="cursor-pointer list-none flex items-center justify-between">
                      <div className="plugin-section-title">
                        <small>{t("integrations.advanced")}</small>
                        <strong>{t("integrations.openclaw.commandPreviews")}</strong>
                      </div>
                      <span className="text-brand group-open:rotate-180 transition-transform">
                        <NextIcon />
                      </span>
                    </summary>
                    <div className="mt-3 flex flex-col gap-2 text-xs font-mono">
                      <div className="p-2.5 rounded-xl bg-navy/5 border border-navy/5 flex flex-col gap-1">
                        <span className="text-[10px] font-sans font-bold text-slatecopy uppercase tracking-wider">
                          {t("integrations.install")}
                        </span>
                        <code className="text-brand overflow-x-auto whitespace-pre">
                          {snapshot.openclawPreview.command} {snapshot.openclawPreview.install.join(" ")}
                        </code>
                      </div>
                      <div className="p-2.5 rounded-xl bg-navy/5 border border-navy/5 flex flex-col gap-1">
                        <span className="text-[10px] font-sans font-bold text-slatecopy uppercase tracking-wider">
                          {t("integrations.openclaw.enable")}
                        </span>
                        <code className="text-brand overflow-x-auto whitespace-pre">
                          {snapshot.openclawPreview.command} {snapshot.openclawPreview.enable.join(" ")}
                        </code>
                      </div>
                      <div className="p-2.5 rounded-xl bg-navy/5 border border-navy/5 flex flex-col gap-1">
                        <span className="text-[10px] font-sans font-bold text-slatecopy uppercase tracking-wider">
                          {t("integrations.openclaw.update")}
                        </span>
                        <code className="text-brand overflow-x-auto whitespace-pre">
                          {snapshot.openclawPreview.command} {snapshot.openclawPreview.update.join(" ")}
                        </code>
                      </div>
                      <div className="p-2.5 rounded-xl bg-navy/5 border border-navy/5 flex flex-col gap-1">
                        <span className="text-[10px] font-sans font-bold text-slatecopy uppercase tracking-wider">
                          {t("integrations.openclaw.remove")}
                        </span>
                        <code className="text-brand overflow-x-auto whitespace-pre">
                          {snapshot.openclawPreview.command} {snapshot.openclawPreview.remove.join(" ")}
                        </code>
                      </div>
                    </div>
                  </details>
                </>
              )}

              {selectedId === "zed" && (
                <>
                  <section className="plugin-section">
                    <div className="plugin-section-title">
                      <small>{t("integrations.connection")}</small>
                      <strong>{t("integrations.globalMcp")}</strong>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-blue-50/50 border border-blue-100/50">
                      <div className="flex flex-col">
                        <strong className="text-sm text-navy">{snapshot.zedStatus.label}</strong>
                        <small className="text-xs text-slatecopy">{snapshot.zedStatus.details}</small>
                      </div>
                      <StatusPill tone={zedStatusTone(snapshot.zedStatus.state)}>
                        {snapshot.zedStatus.state}
                      </StatusPill>
                    </div>
                    <div className="mt-2">
                      <label className="text-xs font-bold text-slatecopy uppercase tracking-wider mb-1 block">
                        {t("integrations.petRouting")}
                      </label>
                      <select
                        className="settings-select w-full"
                        value={snapshot.selectedPetId || ""}
                        onChange={(e) => void load(e.target.value)}
                        disabled={isBusy}
                      >
                        <option value="">{t("integrations.defaultPet")}</option>
                        {snapshot.petOptions.map((pet) => (
                          <option key={pet.id} value={pet.id}>
                            {pet.displayName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-3 flex flex-col gap-1">
                      <span className="text-xs font-bold text-slatecopy uppercase tracking-wider">
                        {t("integrations.zed.settingsPath")}
                      </span>
                      <code className="text-xs text-brand break-all">{snapshot.zedStatus.settingsPath}</code>
                    </div>
                  </section>

                  <section className="plugin-section">
                    <div className="plugin-section-title">
                      <small>{t("integrations.actions")}</small>
                      <strong>{t("integrations.management")}</strong>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {snapshot.zedStatus.canInstall && (
                        <Button
                          variant="primary"
                          icon={<InstallIcon />}
                          disabled={isBusy}
                          onClick={() => run(t("integrations.busy.installing"), "zed-install")}
                        >
                          {t("integrations.installMcp")}
                        </Button>
                      )}
                      {snapshot.zedStatus.canReplace && (
                        <Button
                          variant="warning"
                          icon={<ReplaceIcon />}
                          disabled={isBusy}
                          onClick={() => run(t("integrations.busy.replacing"), "zed-replace")}
                        >
                          {t("integrations.replaceMcp")}
                        </Button>
                      )}
                      {snapshot.zedStatus.canRemove && (
                        <Button
                          variant="danger"
                          icon={<RemoveIcon />}
                          disabled={isBusy}
                          onClick={() => run(t("integrations.busy.removing"), "zed-remove")}
                        >
                          {t("integrations.removeMcp")}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        icon={<RefreshIcon />}
                        disabled={isBusy}
                        onClick={() => void load()}
                      >
                        {t("integrations.refreshStatus")}
                      </Button>
                    </div>
                  </section>

                  <details className="plugin-section group">
                    <summary className="cursor-pointer list-none flex items-center justify-between">
                      <div className="plugin-section-title">
                        <small>{t("integrations.advanced")}</small>
                        <strong>{t("integrations.zed.mcpEntryPreview")}</strong>
                      </div>
                      <span className="text-brand group-open:rotate-180 transition-transform">
                        <NextIcon />
                      </span>
                    </summary>
                    <pre className="mt-3 p-3 rounded-xl bg-navy/5 text-[10px] font-mono overflow-x-auto border border-navy/5">
                      {JSON.stringify({ context_servers: { openpets: snapshot.zedPreview.mcpEntry } }, null, 2)}
                    </pre>
                  </details>
                </>
              )}

              {selectedId === "pi" && (
                <section className="plugin-section">
                  <div className="plugin-section-title">
                    <small>{t("integrations.pi.manualSetup")}</small>
                    <strong>{t("integrations.pi.extension")}</strong>
                  </div>
                  <p className="text-sm text-slatecopy leading-relaxed">{t("integrations.pi.intro")}</p>
                  <div className="mt-3 p-4 rounded-2xl bg-navy/5 border border-navy/5 flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slatecopy uppercase tracking-wider">
                        {t("integrations.pi.globalInstall")}
                      </span>
                      <code className="bg-white px-2 py-1 rounded border border-blue-100 text-brand text-xs">
                        pi install npm:@open-pets/pi
                      </code>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slatecopy uppercase tracking-wider">
                        {t("integrations.pi.projectInstall")}
                      </span>
                      <code className="bg-white px-2 py-1 rounded border border-blue-100 text-brand text-xs">
                        pi install -l npm:@open-pets/pi
                      </code>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slatecopy uppercase tracking-wider">
                        {t("integrations.pi.remove")}
                      </span>
                      <code className="bg-white px-2 py-1 rounded border border-blue-100 text-brand text-xs">
                        pi remove npm:@open-pets/pi
                      </code>
                    </div>
                  </div>
                  <div className="mt-3 p-4 rounded-2xl bg-blue-50/50 border border-blue-100/60 flex flex-col gap-2">
                    <span className="text-[10px] font-bold text-slatecopy uppercase tracking-wider">
                      {t("integrations.pi.slashCommands")}
                    </span>
                    <code className="bg-white px-2 py-1 rounded border border-blue-100 text-brand text-xs">
                      /openpets status
                    </code>
                    <code className="bg-white px-2 py-1 rounded border border-blue-100 text-brand text-xs">
                      /openpets test
                    </code>
                    <code className="bg-white px-2 py-1 rounded border border-blue-100 text-brand text-xs">
                      /openpets react &lt;reaction&gt;
                    </code>
                    <code className="bg-white px-2 py-1 rounded border border-blue-100 text-brand text-xs">
                      /openpets say &lt;message&gt;
                    </code>
                  </div>
                  <p className="text-xs text-slatecopy mt-2">{t("integrations.pi.outro")}</p>
                </section>
              )}
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
