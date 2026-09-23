export type ConnectedAppsProvider = "google" | "outlook";

export type ConnectedAppsConnectionState =
  | "unavailable"
  | "not_connected"
  | "pending"
  | "connected"
  | "reauth_required"
  | "offline"
  | "failed";

export type ConnectedAppsPluginConnection = {
  readonly pluginId: string;
  readonly pluginName: string;
  readonly pluginEnabled: boolean;
  readonly permissionRequested: true;
  readonly accessGranted: boolean;
  readonly state: ConnectedAppsConnectionState;
  readonly accountLabel: string | null;
  readonly lastSyncAt: string | null;
};

export type ConnectedAppsProviderSnapshot = {
  readonly provider: ConnectedAppsProvider;
  readonly connectAllowed: boolean;
  readonly blockerCode: "calendar_identity_verification_unavailable" | null;
  readonly connections: readonly ConnectedAppsPluginConnection[];
};

export type ConnectedAppsSnapshot = {
  readonly providers: readonly ConnectedAppsProviderSnapshot[];
};

export type ConnectedAppsApi = {
  getConnectedAppsSnapshot(): Promise<ConnectedAppsSnapshot>;
  connectConnectedAppsAccount(pluginId: string, provider: ConnectedAppsProvider): Promise<ConnectedAppsSnapshot>;
  setConnectedAppsPluginAccess(pluginId: string, provider: ConnectedAppsProvider, enabled: boolean): Promise<ConnectedAppsSnapshot>;
  disconnectConnectedAppsAccount(pluginId: string, provider: ConnectedAppsProvider): Promise<ConnectedAppsSnapshot>;
};
