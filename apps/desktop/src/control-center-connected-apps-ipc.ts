import type { PluginService } from "./plugin-service.js";
import type { CalendarPluginConsentStore } from "./calendar-plugin-consent.js";
import {
  buildConnectedAppsSnapshot,
  connectConnectedAppsAccount,
  isConnectedAppsProvider,
  isPluginId,
  requireInstalledCalendarPlugin,
} from "./connected-apps-service.js";
import type { ConnectedAppsProvider } from "./connected-apps-contract.js";

export type ControlCenterConnectedAppsChannel =
  | "openpets:connected-apps-snapshot"
  | "openpets:connected-apps-connect"
  | "openpets:connected-apps-set-plugin-access"
  | "openpets:connected-apps-disconnect";

export type ControlCenterConnectedAppsEvent = { readonly sender: { readonly id: number } };
export type ControlCenterConnectedAppsHandler = (event: ControlCenterConnectedAppsEvent, ...args: unknown[]) => unknown | Promise<unknown>;
export type CalendarConsentManager = Pick<CalendarPluginConsentStore, "hasAccess" | "setAccess">;
export type ControlCenterConnectedAppsDependencies = {
  readonly registerHandle: (channel: ControlCenterConnectedAppsChannel, handler: ControlCenterConnectedAppsHandler) => void;
  readonly authorizeSender: (event: ControlCenterConnectedAppsEvent) => void;
  readonly getPluginService: () => Pick<PluginService, "getSnapshot">;
  readonly getConsentStore: () => CalendarConsentManager;
  readonly getCalendarManager: () => {
    status(pluginId: string, provider: ConnectedAppsProvider): Promise<import("@open-pets/plugin-sdk").OpenPetsCalendarConnectionStatus>;
    connect(pluginId: string, provider: ConnectedAppsProvider): Promise<{ readonly state: string }>;
    disconnect(pluginId: string, provider: ConnectedAppsProvider): Promise<void>;
  };
};

export function installControlCenterConnectedAppsIpcHandlers({
  registerHandle,
  authorizeSender,
  getPluginService,
  getConsentStore,
  getCalendarManager,
}: ControlCenterConnectedAppsDependencies): void {
  const snapshot = async () => buildConnectedAppsSnapshot(await getPluginService().getSnapshot(), getConsentStore(), getCalendarManager());

  registerHandle("openpets:connected-apps-snapshot", async (event) => {
    authorizeSender(event);
    return snapshot();
  });

  registerHandle("openpets:connected-apps-connect", async (event, pluginIdInput: unknown, providerInput: unknown) => {
    authorizeSender(event);
    const { pluginId, provider } = validateScope(pluginIdInput, providerInput);
    await connectConnectedAppsAccount(await getPluginService().getSnapshot(), getCalendarManager(), pluginId, provider);
    return snapshot();
  });

  registerHandle("openpets:connected-apps-set-plugin-access", async (event, pluginIdInput: unknown, providerInput: unknown, enabled: unknown) => {
    authorizeSender(event);
    const { pluginId, provider } = validateScope(pluginIdInput, providerInput);
    if (typeof enabled !== "boolean") throw new Error("Invalid calendar access approval request.");
    requireInstalledCalendarPlugin(await getPluginService().getSnapshot(), pluginId);
    await getConsentStore().setAccess(pluginId, provider, enabled);
    return snapshot();
  });

  registerHandle("openpets:connected-apps-disconnect", async (event, pluginIdInput: unknown, providerInput: unknown) => {
    authorizeSender(event);
    const { pluginId, provider } = validateScope(pluginIdInput, providerInput);
    requireInstalledCalendarPlugin(await getPluginService().getSnapshot(), pluginId);
    await getCalendarManager().disconnect(pluginId, provider);
    return snapshot();
  });
}

function validateScope(pluginIdInput: unknown, providerInput: unknown): { pluginId: string; provider: ConnectedAppsProvider } {
  if (!isPluginId(pluginIdInput) || !isConnectedAppsProvider(providerInput)) {
    throw new Error("Invalid calendar connection scope.");
  }
  return { pluginId: pluginIdInput, provider: providerInput };
}
