import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "../src/i18n/locales/en.js";

import type { ConnectedAppsPluginConnection, ConnectedAppsProviderSnapshot } from "../src/connected-apps-contract.js";
import { ConnectedAppsProviderCard } from "../src/renderer/src/integrations/ConnectedAppsView.js";
import {
  canDisconnectConnectedApp,
  connectedAppsConnectionActionKey,
  connectedAppsStateTone,
} from "../src/renderer/src/integrations/connected-apps-state.js";

const messages: Readonly<Record<string, string>> = en;
const translate = (key: string, vars?: Record<string, string | number>) =>
  (messages[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(vars?.[name] ?? `{${name}}`));

const callbacks = {
  onSetAccess: () => undefined,
  onConnect: () => undefined,
  onDisconnect: () => undefined,
};

function connection(overrides: Partial<ConnectedAppsPluginConnection> = {}): ConnectedAppsPluginConnection {
  return {
    pluginId: "openpets.deadline-buddy",
    pluginName: "Deadline Buddy",
    pluginEnabled: true,
    permissionRequested: true,
    accessGranted: false,
    state: "unavailable",
    accountLabel: null,
    lastSyncAt: null,
    ...overrides,
  };
}

function renderProvider(snapshot: ConnectedAppsProviderSnapshot): string {
  return renderToStaticMarkup(React.createElement(ConnectedAppsProviderCard, {
    snapshot,
    busy: "",
    locale: "en-GB",
    t: translate,
    ...callbacks,
  }));
}

{
  const markup = renderProvider({
    provider: "google",
    connectAllowed: false,
    blockerCode: "calendar_identity_verification_unavailable",
    connections: [connection()],
  });
  assert.match(markup, /Google Calendar/);
  assert.match(markup, /Unavailable/);
  assert.equal([...markup.matchAll(/cannot independently verify the person completing calendar sign-in/g)].length, 1, "the disabled action keeps its accessible reason without adding a repeated blocker paragraph");
  assert.match(markup, /<button[^>]*disabled=""[^>]*>.*Connect/s, "OAuth connect is visibly disabled while identity verification is unavailable");
  assert.doesNotMatch(markup, />Disconnect</, "unknown account status does not offer an unverified disconnect action");
  assert.match(markup, /Read calendar names, event titles, dates, all-day status, and time zones/);
}

{
  const markup = renderProvider({
    provider: "outlook",
    connectAllowed: true,
    blockerCode: null,
    connections: [connection({
      state: "connected",
      accessGranted: true,
      accountLabel: "calendar@example.test",
      lastSyncAt: "2026-09-23T12:00:00.000Z",
    })],
  });
  assert.match(markup, />Reconnect</);
  assert.match(markup, />Disconnect</);
  assert.match(markup, /calendar@example\.test/);
  assert.match(markup, /id="calendar-access-outlook-openpets-deadline-buddy"[^>]*checked=""/);
}

assert.equal(connectedAppsConnectionActionKey("reauth_required"), "connectedApps.reconnect");
assert.equal(connectedAppsConnectionActionKey("offline"), "connectedApps.reconnect");
assert.equal(connectedAppsConnectionActionKey("pending"), "connectedApps.status.pending");
assert.equal(connectedAppsStateTone("failed"), "red");
assert.equal(canDisconnectConnectedApp("unavailable"), false);
assert.equal(canDisconnectConnectedApp("not_connected"), false);
assert.equal(canDisconnectConnectedApp("connected"), true);
