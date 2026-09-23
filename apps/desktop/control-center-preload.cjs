const { contextBridge, ipcRenderer } = require("electron");

const api = {
  getPetsState: () => ipcRenderer.invoke("openpets:get-pets-state"),
  getDashboardSnapshot: () => ipcRenderer.invoke("openpets:get-dashboard-snapshot"),
  getTeamsSnapshot: () => ipcRenderer.invoke("openpets:teams-snapshot"),
  submitTeamsEnrollment: (displayName) =>
    ipcRenderer.invoke("openpets:teams-enroll", displayName),
  syncTeamsNow: () => ipcRenderer.invoke("openpets:teams-sync"),
  approveTeamPluginPermissions: (id, approvalToken) =>
    ipcRenderer.invoke(
      "openpets:teams-approve-plugin-permissions",
      id,
      approvalToken,
    ),
  setTeamPluginEnabled: (id, enabled) =>
    ipcRenderer.invoke(
      "openpets:teams-set-plugin-enabled",
      id,
      enabled,
    ),
  leaveTeams: () => ipcRenderer.invoke("openpets:teams-leave"),
  getManagerCheckInsSnapshot: () => {
    return ipcRenderer.invoke("openpets:manager-check-ins-snapshot");
  },
  syncManagerCheckIns: () => {
    return ipcRenderer.invoke("openpets:manager-check-ins-sync");
  },
  getManagerCheckInsHistory: (cursor) => {
    return ipcRenderer.invoke("openpets:manager-check-ins-history", cursor);
  },
  setManagerCheckInDevicePaused: (paused) => {
    return ipcRenderer.invoke("openpets:manager-check-ins-set-device-paused", paused);
  },
  getSettingsState: () => ipcRenderer.invoke("openpets:get-settings-state"),
  getVoiceDevices: () => ipcRenderer.invoke("openpets:voice-devices-get"),
  refreshVoiceDevices: () => ipcRenderer.invoke("openpets:voice-devices-refresh"),
  saveVoiceDevicePreferences: (preferences) => ipcRenderer.invoke("openpets:voice-devices-save-preferences", preferences),
  getConversationHistory: () => ipcRenderer.invoke("openpets:get-conversation-history"),
  deleteConversationHistoryMessage: (id) => ipcRenderer.invoke("openpets:delete-conversation-history-message", id),
  clearConversationHistory: () => ipcRenderer.invoke("openpets:clear-conversation-history"),
  getLanStatus: () => ipcRenderer.invoke("openpets:get-lan-status"),
  getI18n: () => ipcRenderer.invoke("openpets:get-i18n"),
  updatePreferences: (patch) => ipcRenderer.invoke("openpets:update-preferences", patch),
  getReactionAnimationSettings: () => ipcRenderer.invoke("openpets:get-reaction-animation-settings"),
  getLaunchAtLogin: () => ipcRenderer.invoke("openpets:get-launch-at-login"),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke("openpets:set-launch-at-login", enabled),
  getUpdateStatus: () => ipcRenderer.invoke("openpets:get-update-status"),
  checkForUpdates: () => ipcRenderer.invoke("openpets:check-for-updates"),
  openUpdateReleasePage: () => ipcRenderer.invoke("openpets:open-update-release-page"),
  resetDefaultPetPosition: () => ipcRenderer.invoke("openpets:reset-default-pet-position"),
  getPluginsSnapshot: () => ipcRenderer.invoke("openpets:plugins-snapshot"),
  getPluginCatalogSnapshot: (refresh) => ipcRenderer.invoke("openpets:plugins-catalog-snapshot", refresh),
  setPluginEnabled: (id, enabled) => ipcRenderer.invoke("openpets:plugins-set-enabled", id, enabled),
  savePluginConfig: (id, config) => ipcRenderer.invoke("openpets:plugins-save-config", id, config),
  pickPluginConfigSound: (id) => ipcRenderer.invoke("openpets:plugins-pick-config-sound", id),
  reloadPlugin: (id) => ipcRenderer.invoke("openpets:plugins-reload", id),
  refreshLocalPlugin: (id) => ipcRenderer.invoke("openpets:plugins-refresh-local", id),
  executePluginCommand: (id, commandId, args) => ipcRenderer.invoke("openpets:plugins-execute-command", id, commandId, args),
  loadLocalPlugin: () => ipcRenderer.invoke("openpets:plugins-load-local"),
  installCatalogPlugin: (id) => ipcRenderer.invoke("openpets:plugins-install-catalog", id),
  updateCatalogPlugin: (id) => ipcRenderer.invoke("openpets:plugins-update-catalog", id),
  uninstallPlugin: (id) => ipcRenderer.invoke("openpets:plugins-uninstall", id),
  getPluginInspector: (id) => ipcRenderer.invoke("openpets:plugins-inspector", id),
  getProviderProfiles: () => ipcRenderer.invoke("openpets:provider-profiles-get"),
  saveProviderConfiguration: (input) => ipcRenderer.invoke("openpets:provider-profile-save", input),
  testProviderConfiguration: (input) => ipcRenderer.invoke("openpets:provider-profile-test", input),
  beginProviderTranscriptionTest: (input) => ipcRenderer.invoke("openpets:provider-profile-test-begin", input),
  finishProviderTranscriptionTest: (sessionId) => ipcRenderer.invoke("openpets:provider-profile-test-finish", sessionId),
  cancelProviderTranscriptionTest: (sessionId) => ipcRenderer.invoke("openpets:provider-profile-test-cancel", sessionId),
  playProviderPreview: (bytes, mimeType) => ipcRenderer.invoke("openpets:provider-preview-play", bytes, mimeType),
  stopProviderPreview: () => ipcRenderer.invoke("openpets:provider-preview-stop"),
  createProviderProfile: (profile) => ipcRenderer.invoke("openpets:provider-profile-create", profile),
  updateProviderProfile: (id, patch) => ipcRenderer.invoke("openpets:provider-profile-update", id, patch),
  deleteProviderProfile: (id) => ipcRenderer.invoke("openpets:provider-profile-delete", id),
  selectProviderProfile: (role, id) => ipcRenderer.invoke("openpets:provider-profile-select", role, id),
  updateProviderGates: (patch) => ipcRenderer.invoke("openpets:provider-gates-update", patch),
  setProviderProfileCredential: (id, value) => ipcRenderer.invoke("openpets:provider-profile-credential-set", id, value),
  getProviderProfileCredentialStatus: (id) => ipcRenderer.invoke("openpets:provider-profile-credential-status", id),
  deleteProviderProfileCredential: (id) => ipcRenderer.invoke("openpets:provider-profile-credential-delete", id),
  getCatalog: () => ipcRenderer.invoke("openpets:get-catalog"),
  getCatalogPage: (page) => ipcRenderer.invoke("openpets:get-catalog-page", page),
  getCatalogSearch: () => ipcRenderer.invoke("openpets:get-catalog-search"),
  getCodexPets: () => ipcRenderer.invoke("openpets:get-codex-pets"),
  setDefaultPet: (petId) => ipcRenderer.invoke("openpets:set-default-pet", petId),
  setPetPoolOrder: (ids) => ipcRenderer.invoke("openpets:set-pet-pool-order", ids),
  installPet: (petId) => ipcRenderer.invoke("openpets:install-pet", petId),
  installLocalPet: () => ipcRenderer.invoke("openpets:install-local-pet"),
  importCodexPet: (petId) => ipcRenderer.invoke("openpets:import-codex-pet", petId),
  openGallery: () => ipcRenderer.invoke("openpets:open-gallery"),
  openOrganizationsPage: () => ipcRenderer.invoke("openpets:open-organizations-page"),
  removePet: (petId) => ipcRenderer.invoke("openpets:remove-pet", petId),
  onRouteChange: (callback) => {
    const listener = (_event, route) => callback(route);
    ipcRenderer.on("openpets:control-center-route", listener);
    return () => ipcRenderer.removeListener("openpets:control-center-route", listener);
  },
  onPluginsRefresh: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("openpets:plugins-refresh", listener);
    return () => ipcRenderer.removeListener("openpets:plugins-refresh", listener);
  },
  onDashboardRefresh: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("openpets:dashboard-refresh", listener);
    return () => ipcRenderer.removeListener("openpets:dashboard-refresh", listener);
  },
  getIntegrationsState: (selectedPetId, commandMode) => ipcRenderer.invoke("openpets:agent-setup-snapshot", selectedPetId, commandMode),
  runIntegrationAction: (action, selectedPetId, commandMode) => ipcRenderer.invoke("openpets:agent-setup-action", action, selectedPetId, commandMode),
  updateIntegrationCommandPaths: (patch) => ipcRenderer.invoke("openpets:agent-setup-command-paths", patch),
  getConnectedAppsSnapshot: () => ipcRenderer.invoke("openpets:connected-apps-snapshot"),
  connectConnectedAppsAccount: (pluginId, provider) => ipcRenderer.invoke("openpets:connected-apps-connect", pluginId, provider),
  setConnectedAppsPluginAccess: (pluginId, provider, enabled) => ipcRenderer.invoke("openpets:connected-apps-set-plugin-access", pluginId, provider, enabled),
  disconnectConnectedAppsAccount: (pluginId, provider) => ipcRenderer.invoke("openpets:connected-apps-disconnect", pluginId, provider),
  getRemoteSnapshot: () => ipcRenderer.invoke("openpets:remote-get-snapshot"),
  configureRemote: (input) => ipcRenderer.invoke("openpets:remote-configure", input),
  pairRemoteClient: (input) => ipcRenderer.invoke("openpets:remote-pair-client", input),
  rotateRemoteClient: (clientId) => ipcRenderer.invoke("openpets:remote-rotate-client", clientId),
  revokeRemoteClient: (clientId) => ipcRenderer.invoke("openpets:remote-revoke-client", clientId),
};

contextBridge.exposeInMainWorld("openPetsControlCenter", api);
