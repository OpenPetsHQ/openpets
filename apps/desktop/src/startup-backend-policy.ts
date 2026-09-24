import type { EventEmitter } from "node:events";

export type LinuxBackendBootstrapPlan =
  | { action: "launch"; args: string[]; backend: "system" | "x11" | "wayland"; reason: string }
  | { action: "relaunch"; args: string[]; backend: "x11" | "wayland"; reason: string };

export type ReplacementProcessMode = "detached" | "supervised";

export function selectReplacementProcessMode(isPackaged: boolean): ReplacementProcessMode {
  return isPackaged ? "detached" : "supervised";
}

const ozoneSwitchPrefix = "--ozone-platform";
export const replacementBootstrapTimeoutMs = 15_000;

type SupervisedChild = EventEmitter & { kill: (signal?: NodeJS.Signals) => boolean };

/** Keep an attached replacement under its bootstrap parent's lifetime. */
export function superviseReplacement(child: SupervisedChild, parent: EventEmitter): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = (): void => {
      parent.removeListener("SIGINT", onSigint);
      parent.removeListener("SIGTERM", onSigterm);
      child.removeListener("exit", onExit);
    };

    const onExit = (code: number | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(code ?? 1);
    };

    const onSigint = (): void => {
      child.kill("SIGINT");
    };
    const onSigterm = (): void => {
      child.kill("SIGTERM");
    };

    child.once("exit", onExit);
    parent.on("SIGINT", onSigint);
    parent.on("SIGTERM", onSigterm);
  });
}

/** Wait for a replacement's explicit ready acknowledgement with bounded ownership. */
export function waitForReplacementBootstrap(
  child: EventEmitter,
  terminate: () => void,
  timeoutMs = replacementBootstrapTimeoutMs,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let hasSpawned = false;
    let readyMessageReceived = false;
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timeout);
      child.removeListener("spawn", onSpawn);
      child.removeListener("message", onMessage);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.removeListener("disconnect", onDisconnect);
    };

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        terminate();
        reject(error);
      } else {
        resolve();
      }
    };

    const finishIfReady = (): void => {
      if (hasSpawned && readyMessageReceived) finish();
    };

    const onSpawn = (): void => {
      hasSpawned = true;
      finishIfReady();
    };

    const onMessage = (message: unknown): void => {
      if (!isBootstrapHandoffMessage(message)) return;
      if (message.type === "openpets-bootstrap-failed") {
        finish(new Error(`Replacement startup failed: ${message.message}`));
        return;
      }
      readyMessageReceived = true;
      finishIfReady();
    };

    const onError = (error: Error): void => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(new Error(`Replacement exited before completing startup (code=${code}, signal=${signal}).`));
    };
    const onDisconnect = (): void => finish(new Error("Replacement IPC channel disconnected before startup completed."));
    const timeout = setTimeout(() => finish(new Error(`Replacement startup timed out after ${timeoutMs}ms.`)), timeoutMs);

    child.once("spawn", onSpawn);
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
    child.once("disconnect", onDisconnect);
  });
}

type BootstrapHandoffMessage = { type: "openpets-bootstrap-ready" } | { type: "openpets-bootstrap-failed"; message: string };

function isBootstrapHandoffMessage(message: unknown): message is BootstrapHandoffMessage {
  if (typeof message !== "object" || message === null || !("type" in message)) return false;
  const type = message.type;
  if (type === "openpets-bootstrap-ready") return true;
  return type === "openpets-bootstrap-failed" && "message" in message && typeof message.message === "string";
}

/** Read an Ozone value only from Electron's option area, before `--`. */
export function readOzonePlatformSwitch(args: readonly string[]): string | null {
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") break;
    if (argument === ozoneSwitchPrefix) return args[index + 1] ?? "";
    if (argument.startsWith(`${ozoneSwitchPrefix}=`)) return argument.slice(ozoneSwitchPrefix.length + 1);
  }
  return null;
}

/**
 * Plan the initial Linux Ozone backend before importing the side-effectful main
 * process. A relaunch is required because Chromium reads these switches before
 * Electron evaluates the app's JavaScript entry point.
 */
export function planLinuxBackendBootstrap(
  platform: NodeJS.Platform | string,
  originalArgv: readonly string[],
  env: Record<string, string | undefined>,
): LinuxBackendBootstrapPlan {
  const args = [...originalArgv];
  if (platform !== "linux") {
    return { action: "launch", args, backend: "system", reason: "non-linux" };
  }

  const explicitOzone = readOzonePlatformSwitch(args);
  const layerShell = env.OPENPETS_NATIVE_WAYLAND === "1";
  if (layerShell && explicitOzone !== null) {
    return { action: "launch", args, backend: explicitOzone === "wayland" ? "wayland" : "system", reason: "layer-shell-explicit-ozone" };
  }
  if (!layerShell && env.OPENPETS_ALLOW_WAYLAND === "1") {
    return { action: "launch", args, backend: explicitOzone === null ? "system" : explicitOzone === "wayland" ? "wayland" : "x11", reason: "wayland-opt-out" };
  }

  const backend = layerShell ? "wayland" : "x11";
  const normalizedArgs = normalizeOzonePlatformArgs(args, backend);
  const reason = layerShell ? "layer-shell-default" : "positioning-default";
  return normalizedArgs.every((argument, index) => argument === args[index]) && normalizedArgs.length === args.length
    ? { action: "launch", args, backend, reason: `${reason}-already-effective` }
    : { action: "relaunch", args: normalizedArgs, backend, reason };
}

function normalizeOzonePlatformArgs(args: readonly string[], backend: "x11" | "wayland"): string[] {
  const separatorIndex = args.indexOf("--", 1);
  const optionsEnd = separatorIndex === -1 ? args.length : separatorIndex;
  const result = [args[0] ?? ""];
  let insertionIndex: number | null = null;

  for (let index = 1; index < optionsEnd; index += 1) {
    const argument = args[index];
    if (argument === ozoneSwitchPrefix) {
      insertionIndex ??= result.length;
      if (index + 1 < optionsEnd) index += 1;
      continue;
    }
    if (argument.startsWith(`${ozoneSwitchPrefix}=`)) {
      insertionIndex ??= result.length;
      continue;
    }
    result.push(argument);
  }

  const ozoneArg = `${ozoneSwitchPrefix}=${backend}`;
  result.splice(insertionIndex ?? result.length, 0, ozoneArg);
  if (separatorIndex !== -1) result.push(...args.slice(separatorIndex));
  return result;
}
