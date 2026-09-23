import type { ConnectedAppsConnectionState } from "../../../connected-apps-contract.js";
import type { IntegrationStatusTone } from "./types.js";

export function connectedAppsStateLabelKey(state: ConnectedAppsConnectionState): string {
  return `connectedApps.status.${state}`;
}

export function connectedAppsStateTone(state: ConnectedAppsConnectionState): IntegrationStatusTone {
  if (state === "connected") return "green";
  if (state === "pending") return "yellow";
  if (state === "reauth_required" || state === "failed") return "red";
  if (state === "offline" || state === "unavailable") return "orange";
  return "slate";
}

export function connectedAppsConnectionActionKey(state: ConnectedAppsConnectionState): string {
  if (state === "pending") return "connectedApps.status.pending";
  return state === "connected" || state === "reauth_required" || state === "offline"
    || state === "failed"
    ? "connectedApps.reconnect"
    : "connectedApps.connect";
}

export function canDisconnectConnectedApp(state: ConnectedAppsConnectionState): boolean {
  return state === "connected" || state === "pending" || state === "reauth_required" || state === "offline" || state === "failed";
}
