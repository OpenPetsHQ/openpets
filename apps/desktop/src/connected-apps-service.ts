import type { SafePluginRecord, PluginServiceSnapshot } from "./plugin-service.js";
import type { CalendarPluginConsentStore } from "./calendar-plugin-consent.js";
import type { OpenPetsCalendarConnectionStatus } from "@open-pets/plugin-sdk";
import { CalendarBrokerError } from "./plugin-calendar-broker-client.js";
import type {
  ConnectedAppsProvider,
  ConnectedAppsProviderSnapshot,
  ConnectedAppsSnapshot,
} from "./connected-apps-contract.js";

export const CONNECTED_APPS_PROVIDERS: readonly ConnectedAppsProvider[] = ["google", "outlook"];
// The broker deliberately rejects OAuth and connection-status routes until it
// can authenticate the person completing Composio OAuth independently of the
// local profile ID. Do not make this user-configurable or enable it by env var.
export const CONNECTED_APPS_CONNECT_ENABLED = false;

export type ConnectedAppsCalendarManager = {
  status(pluginId: string, provider: ConnectedAppsProvider): Promise<OpenPetsCalendarConnectionStatus>;
  connect(pluginId: string, provider: ConnectedAppsProvider): Promise<{ readonly state: string }>;
  disconnect(pluginId: string, provider: ConnectedAppsProvider): Promise<void>;
};

export async function buildConnectedAppsSnapshot(
  pluginSnapshot: PluginServiceSnapshot,
  consentStore: Pick<CalendarPluginConsentStore, "hasAccess">,
  calendar: Pick<ConnectedAppsCalendarManager, "status">,
): Promise<ConnectedAppsSnapshot> {
  const requests = pluginSnapshot.plugins.filter(requestsCalendarAccess);
  const providers = await Promise.all(CONNECTED_APPS_PROVIDERS.map(async (provider) => {
    const connections = await Promise.all(requests.map(async (plugin) => {
      const [accessGranted, state] = await Promise.all([
        consentStore.hasAccess(plugin.id, provider),
        CONNECTED_APPS_CONNECT_ENABLED
          ? calendar.status(plugin.id, provider).then((status) => status.state).catch((error: unknown) =>
            error instanceof CalendarBrokerError && error.status === 503 ? "unavailable" as const : "failed" as const,
          )
          : Promise.resolve("unavailable" as const),
      ]);
      return {
        pluginId: plugin.id,
        pluginName: plugin.name ?? plugin.id,
        pluginEnabled: plugin.enabled,
        permissionRequested: true as const,
        accessGranted,
        state,
        // Composio's connection owner ID is not a verified account identity.
        // Keep identity and sync metadata out of the UI until verified.
        accountLabel: null,
        lastSyncAt: null,
      };
    }));
    return {
      provider,
      connectAllowed: CONNECTED_APPS_CONNECT_ENABLED,
      blockerCode: CONNECTED_APPS_CONNECT_ENABLED ? null : "calendar_identity_verification_unavailable" as const,
      connections,
    } satisfies ConnectedAppsProviderSnapshot;
  }));
  return { providers };
}

export async function connectConnectedAppsAccount(
  pluginSnapshot: PluginServiceSnapshot,
  calendar: Pick<ConnectedAppsCalendarManager, "connect">,
  pluginId: string,
  provider: ConnectedAppsProvider,
): Promise<void> {
  requireInstalledCalendarPlugin(pluginSnapshot, pluginId);
  if (!CONNECTED_APPS_CONNECT_ENABLED) {
    throw new Error("Calendar connection is unavailable until the OAuth identity handoff is independently verified.");
  }
  await calendar.connect(pluginId, provider);
}

export function requireInstalledCalendarPlugin(
  pluginSnapshot: PluginServiceSnapshot,
  pluginId: string,
): SafePluginRecord {
  const plugin = pluginSnapshot.plugins.find((candidate) => candidate.id === pluginId);
  if (!plugin || !requestsCalendarAccess(plugin)) throw new Error("Plugin has not requested calendar access.");
  return plugin;
}

export function isConnectedAppsProvider(value: unknown): value is ConnectedAppsProvider {
  return value === "google" || value === "outlook";
}

export function isPluginId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(value);
}

function requestsCalendarAccess(plugin: SafePluginRecord): boolean {
  return plugin.requestedPermissions?.includes("calendar:connect") === true;
}
