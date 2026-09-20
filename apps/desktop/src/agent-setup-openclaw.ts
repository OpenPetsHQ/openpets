import {
  buildOpenClawCommand,
  classifyOpenClawStatus,
  parseOpenClawVersion,
  planOpenClawMutation,
  type OpenClawCommandAction,
  type OpenClawPluginStatus,
} from "@open-pets/openclaw/management";

export type { OpenClawPluginStatus } from "@open-pets/openclaw/management";

export interface OpenClawSetupPreview {
  readonly command: string;
  readonly install: readonly string[];
  readonly enable: readonly string[];
  readonly update: readonly string[];
  readonly remove: readonly string[];
  readonly targetVersion: string;
}

export interface OpenClawCommandResult {
  readonly ok: boolean;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly overflow?: boolean;
}

export interface OpenClawSetupDependencies {
  readonly preferredCommand: string;
  readonly targetVersion: string;
  readonly platform: NodeJS.Platform;
  readonly managementDisabled: boolean;
  readonly statusTimeoutMs: number;
  readonly mutationTimeoutMs: number;
  readonly runCommand: (
    action: OpenClawCommandAction,
    targetVersion?: string,
    timeoutMs?: number,
  ) => Promise<OpenClawCommandResult>;
}

export type OpenClawSetupMutation = "configure" | "update" | "remove";

export interface OpenClawSetupActionResult {
  readonly ok: boolean;
  readonly action: "openclaw-install" | "openclaw-update" | "openclaw-remove";
  readonly message: string;
  readonly changed: boolean;
}

export async function getOpenClawSetup(
  dependencies: OpenClawSetupDependencies,
): Promise<{ readonly status: OpenClawPluginStatus; readonly preview: OpenClawSetupPreview }> {
  const preview = buildPreview(dependencies);
  if (dependencies.managementDisabled) {
    return {
      status: {
        state: "management-disabled",
        label: "Managed externally",
        details: "OpenClaw is running in Nix mode; plugin management is disabled in OpenPets.",
        canInstall: false,
        canUpdate: false,
        canEnable: false,
        canRemove: false,
      },
      preview,
    };
  }

  if (!["darwin", "linux", "win32"].includes(dependencies.platform)) {
    return {
      status: classifyOpenClawStatus({
        version: dependencies.targetVersion,
        list: {},
        inspect: {},
        hostSupported: false,
      }),
      preview,
    };
  }

  const versionResult = await dependencies.runCommand("version", undefined, dependencies.statusTimeoutMs);
  const version = parseOpenClawVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  if (!versionResult.ok || !version) {
    return {
      status: classifyOpenClawStatus({
        version: undefined,
        list: {},
        inspect: {},
        hostSupported: true,
      }),
      preview,
    };
  }

  const list = await dependencies.runCommand("list", undefined, dependencies.statusTimeoutMs);
  if (!list.ok || list.overflow) {
    return {
      status: {
        state: "indeterminate",
        label: "Status unavailable",
        details: "OpenClaw was detected, but plugin status could not be read.",
        version,
        canInstall: false,
        canUpdate: false,
        canEnable: false,
        canRemove: false,
      },
      preview,
    };
  }

  const listPayload = parseJsonOutput(list.stdout);
  const inspect = await dependencies.runCommand("inspect", undefined, dependencies.statusTimeoutMs);
  if (inspect.overflow) {
    return {
      status: {
        state: "indeterminate",
        label: "Status unavailable",
        details: "OpenClaw returned more plugin status data than OpenPets can safely inspect.",
        version,
        canInstall: false,
        canUpdate: false,
        canEnable: false,
        canRemove: false,
      },
      preview,
    };
  }

  if (!inspect.ok) {
    const status = classifyOpenClawStatus({
      version,
      list: listPayload,
      inspect: undefined,
      inspectMissing: true,
      hostSupported: true,
    });
    if (status.state === "not-installed") return { status, preview };
    return {
      status: {
        state: "indeterminate",
        label: "Status unavailable",
        details: "OpenClaw was detected, but plugin status could not be read.",
        version,
        canInstall: false,
        canUpdate: false,
        canEnable: false,
        canRemove: false,
      },
      preview,
    };
  }

  const inspectPayload = parseJsonOutput(inspect.stdout);
  if (inspectPayload === undefined) {
    return {
      status: {
        state: "indeterminate",
        label: "Status unavailable",
        details: "OpenClaw returned malformed plugin status.",
        version,
        canInstall: false,
        canUpdate: false,
        canEnable: false,
        canRemove: false,
      },
      preview,
    };
  }

  return {
    status: classifyOpenClawStatus({ version, list: listPayload, inspect: inspectPayload, hostSupported: true }),
    preview,
  };
}

export async function mutateOpenClaw(
  mutation: OpenClawSetupMutation,
  dependencies: OpenClawSetupDependencies,
): Promise<OpenClawSetupActionResult> {
  const action = mutation === "configure"
    ? "openclaw-install"
    : mutation === "update"
      ? "openclaw-update"
      : "openclaw-remove";
  const setup = await getOpenClawSetup(dependencies);
  const actions = planOpenClawMutation(setup.status, mutation, setup.preview.targetVersion);
  if (actions.length === 0) {
    const noOp = (mutation === "remove" && setup.status.state === "not-installed")
      || (mutation !== "remove" && setup.status.state === "installed-enabled" && setup.status.installedVersion === setup.preview.targetVersion);
    return {
      ok: noOp,
      action,
      message: noOp ? "OpenClaw OpenPets setup is already in the requested state." : setup.status.details,
      changed: false,
    };
  }

  for (const commandAction of actions) {
    const result = await dependencies.runCommand(commandAction, setup.preview.targetVersion, dependencies.mutationTimeoutMs);
    const refreshed = await getOpenClawSetup(dependencies);
    if (refreshed.status.state === "indeterminate") {
      return {
        ok: false,
        action,
        message: "OpenClaw management completed without a verifiable status refresh; the outcome is indeterminate. Refresh status before retrying.",
        changed: false,
      };
    }

    const commandReached = commandAction === "remove"
      ? refreshed.status.state === "not-installed"
      : commandAction === "enable"
        ? refreshed.status.state === "installed-enabled" && refreshed.status.installedVersion === setup.preview.targetVersion
        : (refreshed.status.state === "installed-disabled" || refreshed.status.state === "installed-enabled") && refreshed.status.installedVersion === setup.preview.targetVersion;
    if (!result.ok && !commandReached) {
      return {
        ok: false,
        action,
        message: result.timedOut ? "OpenClaw management timed out; the final state is indeterminate. Refresh status before retrying." : `OpenClaw ${commandAction} failed.`,
        changed: false,
      };
    }
    if (mutation === "remove" && commandReached) {
      return { ok: true, action, message: "Removed OpenPets from OpenClaw.", changed: true };
    }
    if (mutation !== "remove" && commandAction === "enable" && commandReached) {
      return { ok: true, action, message: "OpenPets is installed and enabled in OpenClaw.", changed: true };
    }
  }

  return { ok: false, action, message: "OpenClaw management did not establish its target postcondition.", changed: false };
}

function buildPreview(dependencies: OpenClawSetupDependencies): OpenClawSetupPreview {
  const paths = { openclaw: dependencies.preferredCommand };
  return {
    command: dependencies.preferredCommand,
    install: buildOpenClawCommand("install", dependencies.targetVersion, paths).args,
    enable: buildOpenClawCommand("enable", dependencies.targetVersion, paths).args,
    update: buildOpenClawCommand("update", dependencies.targetVersion, paths).args,
    remove: buildOpenClawCommand("remove", dependencies.targetVersion, paths).args,
    targetVersion: dependencies.targetVersion,
  };
}

function parseJsonOutput(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
