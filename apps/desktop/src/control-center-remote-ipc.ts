import {
  validateRemoteScopeList,
  type RemoteControlScope,
} from "./remote-control-protocol.js";
import type {
  RemoteControlClientSummary,
  RemoteControlConfigSnapshot,
  RemoteControlService,
} from "./remote-control-service.js";

export type ControlCenterRemoteIpcChannel =
  | "openpets:remote-get-snapshot"
  | "openpets:remote-configure"
  | "openpets:remote-pair-client"
  | "openpets:remote-rotate-client"
  | "openpets:remote-revoke-client";

export type ControlCenterRemoteIpcEvent = {
  readonly sender: { readonly id: number };
};

export type ControlCenterRemoteIpcHandler = (
  event: ControlCenterRemoteIpcEvent,
  ...args: unknown[]
) => unknown | Promise<unknown>;

export type ControlCenterRemoteIpcHandleRegistrar = (
  channel: ControlCenterRemoteIpcChannel,
  handler: ControlCenterRemoteIpcHandler,
) => void;

export type ControlCenterRemoteIpcService = Pick<
  RemoteControlService,
  "getConfiguration" | "listClients" | "configure" | "pairClient" | "rotateClient" | "revokeClient"
>;

export type ControlCenterRemoteIpcDependencies = {
  readonly registerHandle: ControlCenterRemoteIpcHandleRegistrar;
  readonly authorizeSender: (event: ControlCenterRemoteIpcEvent) => void;
  readonly getRemoteControlService: () => ControlCenterRemoteIpcService;
};

export function installControlCenterRemoteIpcHandlers({
  registerHandle,
  authorizeSender,
  getRemoteControlService,
}: ControlCenterRemoteIpcDependencies): void {
  registerHandle("openpets:remote-get-snapshot", async (event) => {
    authorizeSender(event);
    const service = getRemoteControlService();
    return composeRemoteSnapshot(service.getConfiguration(), service.listClients());
  });

  registerHandle("openpets:remote-configure", async (event, input: unknown) => {
    authorizeSender(event);
    if (!isPlainObject(input) || typeof input.enabled !== "boolean") {
      throw new Error("Invalid remote control configuration request.");
    }
    const { enabled, address, port } = input as { enabled: boolean; address?: unknown; port?: unknown };
    if (address !== undefined && typeof address !== "string") {
      throw new Error("Invalid remote control configuration request.");
    }
    if (port !== undefined && typeof port !== "number") {
      throw new Error("Invalid remote control configuration request.");
    }
    const service = getRemoteControlService();
    const config = await service.configure({
      enabled,
      ...(typeof address === "string" ? { address } : {}),
      ...(typeof port === "number" ? { port } : {}),
    });
    return composeRemoteSnapshot(config, service.listClients());
  });

  registerHandle("openpets:remote-pair-client", async (event, input: unknown) => {
    authorizeSender(event);
    if (!isPlainObject(input) || typeof input.name !== "string" || !Array.isArray(input.scopes)) {
      throw new Error("Invalid remote client pair request.");
    }
    const { name, scopes } = input as { name: string; scopes: unknown[] };
    let normalizedScopes: RemoteControlScope[];
    try {
      normalizedScopes = validateRemoteScopeList(scopes);
    } catch {
      throw new Error("Invalid remote client pair request.");
    }
    const service = getRemoteControlService();
    return service.pairClient({ name, scopes: normalizedScopes });
  });

  registerHandle("openpets:remote-rotate-client", async (event, clientId: unknown) => {
    authorizeSender(event);
    if (typeof clientId !== "string" || !clientId) {
      throw new Error("Invalid remote client rotate request.");
    }
    const service = getRemoteControlService();
    return service.rotateClient(clientId);
  });

  registerHandle("openpets:remote-revoke-client", async (event, clientId: unknown) => {
    authorizeSender(event);
    if (typeof clientId !== "string" || !clientId) {
      throw new Error("Invalid remote client revoke request.");
    }
    const service = getRemoteControlService();
    return service.revokeClient(clientId);
  });
}

function composeRemoteSnapshot(
  config: RemoteControlConfigSnapshot,
  clients: readonly RemoteControlClientSummary[],
): { readonly config: RemoteControlConfigSnapshot; readonly clients: readonly RemoteControlClientSummary[] } {
  return { config, clients };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
