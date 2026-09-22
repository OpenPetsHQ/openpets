import type {
  AgentSetupAction,
  AgentSetupCommandPaths,
  AgentSetupSnapshot,
} from "./agent-setup.js";

export type ControlCenterAgentSetupIpcChannel =
  | "openpets:agent-setup-snapshot"
  | "openpets:agent-setup-action"
  | "openpets:agent-setup-command-paths";

export type ControlCenterAgentSetupIpcEvent = {
  readonly sender: { readonly id: number };
};

export type ControlCenterAgentSetupIpcHandler = (
  event: ControlCenterAgentSetupIpcEvent,
  ...args: unknown[]
) => unknown | Promise<unknown>;

export type ControlCenterAgentSetupIpcHandleRegistrar = (
  channel: ControlCenterAgentSetupIpcChannel,
  handler: ControlCenterAgentSetupIpcHandler,
) => void;

export type ControlCenterAgentSetupIpcDependencies = {
  readonly registerHandle: ControlCenterAgentSetupIpcHandleRegistrar;
  readonly authorizeSender: (event: ControlCenterAgentSetupIpcEvent) => void;
  readonly getAgentSetupSnapshot: (
    selectedPetId?: unknown,
    commandModeInput?: unknown,
  ) => Promise<AgentSetupSnapshot>;
  readonly runAgentSetupAction: (
    action: AgentSetupAction,
    selectedPetId?: unknown,
    commandModeInput?: unknown,
  ) => Promise<AgentSetupSnapshot>;
  readonly updateAgentSetupCommandPaths: (patch: unknown) => AgentSetupCommandPaths;
};

const supportedAgentSetupActions: readonly AgentSetupAction[] = [
  "configure",
  "replace",
  "remove",
  "install-memory",
  "doctor-hooks",
  "install-hooks",
  "uninstall-hooks",
  "opencode-install",
  "opencode-remove",
  "cursor-install",
  "cursor-replace",
  "cursor-remove",
  "openclaw-install",
  "openclaw-update",
  "openclaw-remove",
  "zed-install",
  "zed-replace",
  "zed-remove",
];

export function installControlCenterAgentSetupIpcHandlers({
  registerHandle,
  authorizeSender,
  getAgentSetupSnapshot,
  runAgentSetupAction,
  updateAgentSetupCommandPaths,
}: ControlCenterAgentSetupIpcDependencies): void {
  registerHandle("openpets:agent-setup-snapshot", async (event, selectedPetId: unknown, commandMode: unknown) => {
    authorizeSender(event);
    return getAgentSetupSnapshot(selectedPetId, commandMode);
  });

  registerHandle("openpets:agent-setup-action", async (event, action: unknown, selectedPetId: unknown, commandMode: unknown) => {
    authorizeSender(event);
    if (!isSupportedAgentSetupAction(action)) {
      throw new Error("Invalid agent setup action.");
    }

    return runAgentSetupAction(action, selectedPetId, commandMode);
  });

  registerHandle("openpets:agent-setup-command-paths", (event, patch: unknown) => {
    authorizeSender(event);
    return updateAgentSetupCommandPaths(patch);
  });
}

function isSupportedAgentSetupAction(value: unknown): value is AgentSetupAction {
  return typeof value === "string" && supportedAgentSetupActions.includes(value as AgentSetupAction);
}
