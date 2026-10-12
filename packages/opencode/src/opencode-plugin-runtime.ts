import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { createOpenPetsClient, type OpenPetsClient, type OpenPetsReaction } from "@open-pets/client";
import { pickHookSpeech, type HookSpeechCategory, validateHookSpeech } from "@open-pets/agent-events";

import { sanitizeOpenCodeExcludedReactions, validateOpenPetsPetArg } from "./opencode-previews.js";

export interface OpenCodePluginOptions {
  readonly pet?: string;
  readonly debug?: boolean;
  /** Reactions the user wants suppressed. Excluded reactions are silently dropped before any IPC or throttle work. */
  readonly excludeReactions?: readonly OpenPetsReaction[];
}

export interface OpenCodePluginRuntimeOptions extends OpenCodePluginOptions {
  readonly clientFactory?: () => OpenPetsClient;
  readonly schedule?: (work: () => Promise<void>) => void;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly throttlePath?: string;
  readonly debugLog?: (message: string) => void;
}

export interface OpenCodePluginDecision {
  readonly reaction?: OpenPetsReaction;
  readonly speechCategory?: HookSpeechCategory;
}

export interface OpenCodePluginRuntime {
  readonly event: (event: unknown) => void;
  readonly prompt: () => void;
  readonly toolBefore: (tool: string, input: unknown) => void;
  readonly toolAfter: (event: unknown) => void;
  readonly reportError: (scope: string, error: unknown) => void;
  readonly cleanup: () => Promise<void>;
}

const speechCooldownMs = 20_000;
const permissionCooldownMs = 3_000;
const reactionCooldownMs = 10_000;

export function isReactionExcluded(reaction: OpenPetsReaction, excludedSet: ReadonlySet<string>): boolean {
  return excludedSet.has(reaction);
}

export function createOpenPetsOpenCodeRuntime(options: OpenCodePluginRuntimeOptions = {}): OpenCodePluginRuntime {
  const pet = options.pet === undefined ? undefined : validateOpenPetsPetArg(options.pet);
  const clientFactory = options.clientFactory ?? (() => createOpenPetsClient({ connectTimeoutMs: 500, responseTimeoutMs: 500 }));
  const schedule = options.schedule ?? defaultSchedule;
  const debug = options.debug === true || process.env.OPENPETS_DEBUG === "1";
  const debugLog = options.debugLog ?? ((message) => { if (debug) process.stderr.write(`${message}\n`); });
  const excludedReactions = buildExcludedReactionsSet(options.excludeReactions);
  let client: OpenPetsClient | undefined;
  let lease: { readonly leaseId: string; readonly expiresAt?: number } | undefined;
  let closed = false;
  let cleanupPromise: Promise<void> | undefined;
  let dispatchTail: Promise<void> = Promise.resolve();
  const activeWork = new Set<Promise<void>>();

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const run = dispatchTail.then(task, task);
    dispatchTail = run.then(() => undefined, () => undefined);
    return run;
  };

  const run = (decision: OpenCodePluginDecision | undefined): void => {
    if (closed || !decision?.reaction) return;
    if (isReactionExcluded(decision.reaction, excludedReactions)) return;
    const reaction = decision.reaction;
    try {
      schedule(() => {
        if (closed) return Promise.resolve();
        const pending = enqueue(() => dispatchReaction(decision, reaction));
        activeWork.add(pending);
        void pending.finally(() => activeWork.delete(pending));
        return pending;
      });
    } catch (error) {
      debugLog(`OpenPets OpenCode plugin scheduling ignored error: ${sanitizeDebugError(error)}`);
    }
  };

  const dispatchReaction = async (decision: OpenCodePluginDecision, reaction: OpenPetsReaction): Promise<void> => {
    if (closed) return;
    try {
      const shouldSpeak = decision.speechCategory ? shouldSendSpeech(decision.speechCategory, options) : false;
      const shouldReact = shouldSendReaction(reaction, options);
      if (!shouldSpeak && !shouldReact) return;

      client ??= clientFactory();
      const leaseId = pet ? await getLeaseId(client, pet) : undefined;
      if (closed) return;
      if (decision.speechCategory && shouldSpeak) {
        await client.say(validateHookSpeech(pickHookSpeech(decision.speechCategory, options.random)), { reaction, leaseId });
        return;
      }
      await client.react(reaction, { leaseId });
    } catch (error) {
      debugLog(`OpenPets OpenCode plugin ignored error: ${sanitizeDebugError(error)}`);
    }
  };

  const getLeaseId = async (hit: OpenPetsClient, requestedPetId: string): Promise<string | undefined> => {
    if (closed) return undefined;
    if (lease && (!lease.expiresAt || lease.expiresAt - Date.now() > 2_000)) return lease.leaseId;
    const previous = lease;
    let next: { readonly leaseId: string; readonly expiresAt?: number };
    try {
      next = await hit.acquireLease({ requestedPetId });
    } catch (error) {
      debugLog(`OpenPets OpenCode lease unavailable: ${sanitizeDebugError(error)}`);
      return undefined;
    }
    lease = { leaseId: next.leaseId, expiresAt: next.expiresAt };
    if (previous && previous.leaseId !== next.leaseId) {
      await releaseLease(hit, previous.leaseId);
    }
    if (closed) return undefined;
    return next.leaseId;
  };

  const releaseLease = async (hit: OpenPetsClient, leaseId: string): Promise<void> => {
    try {
      await hit.releaseLease(leaseId);
    } catch (error) {
      debugLog(`OpenPets OpenCode lease release failed: ${sanitizeDebugError(error)}`);
    }
  };

  const finishCleanup = async (): Promise<void> => {
    await Promise.allSettled([...activeWork]);
    await dispatchTail;
    const activeLease = lease;
    const activeClient = client;
    lease = undefined;
    if (!activeLease || !activeClient) return;
    await releaseLease(activeClient, activeLease.leaseId);
  };

  return {
    event(event) {
      try {
        run(classifyOpenCodeBusEvent(event));
      } catch (error) {
        debugLog(`OpenPets OpenCode event ignored error: ${sanitizeDebugError(error)}`);
      }
    },
    prompt() {
      run({ reaction: "thinking" });
    },
    toolBefore(tool, input) {
      if (shouldIgnoreOpenPetsTool(tool)) return;
      run({ reaction: classifyOpenCodeToolReaction(tool, input) });
    },
    toolAfter(event) {
      if (!isRecord(event) || event.status !== "error") return;
      const tool = typeof event.tool === "string" ? event.tool : "";
      if (tool && shouldIgnoreOpenPetsTool(tool)) return;
      run({ reaction: "error", speechCategory: "error" });
    },
    reportError(scope, error) {
      process.stderr.write(`OpenPets OpenCode ${scope}: ${sanitizeDebugError(error)}\n`);
    },
    cleanup() {
      if (cleanupPromise) return cleanupPromise;
      closed = true;
      cleanupPromise = finishCleanup();
      return cleanupPromise;
    },
  };
}

export function classifyOpenCodeToolReaction(toolName: string, args?: unknown): OpenPetsReaction | undefined {
  const normalized = toolName.toLowerCase();
  if (/edit|write|patch|apply_patch/.test(normalized)) return "editing";
  if (/bash|shell|terminal/.test(normalized)) return isTestLikeToolArgs(args) ? "testing" : undefined;
  return undefined;
}

export function classifyOpenCodeBusEvent(event: unknown): OpenCodePluginDecision | undefined {
  const type = getEventType(event);
  if (type === "permission.asked") return getEventPermissions(event).some(shouldIgnoreOpenPetsTool) ? undefined : { reaction: "waiting", speechCategory: "permission" };
  if (type === "session.execution.failed") return { reaction: "error", speechCategory: "error" };
  if (type === "session.idle") return { reaction: "success" };
  return undefined;
}

export function shouldIgnoreOpenPetsTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
  return /(?:^|[_:-])openpets_(?:openpets_)?(?:status|say|react)$/.test(normalized) || /^openpets_(?:status|say|react)$/.test(normalized);
}

export function getDefaultOpenCodeThrottlePath(): string {
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "OpenPets", "opencode-hook-throttle.json");
  const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  if (stateHome) return join(stateHome, "openpets", "opencode-hook-throttle.json");
  return join(tmpdir(), `openpets-${safeUid()}`, "opencode-hook-throttle.json");
}

function shouldSendSpeech(category: HookSpeechCategory, options: OpenCodePluginRuntimeOptions): boolean {
  const now = options.now?.() ?? Date.now();
  const cooldown = category === "permission" ? permissionCooldownMs : speechCooldownMs;
  return shouldSendThrottleKey(category, cooldown, now, options.throttlePath ?? getDefaultOpenCodeThrottlePath());
}

function shouldSendReaction(reaction: OpenPetsReaction, options: OpenCodePluginRuntimeOptions): boolean {
  const now = options.now?.() ?? Date.now();
  return shouldSendThrottleKey(`reaction:${reaction}`, reactionCooldownMs, now, options.throttlePath ?? getDefaultOpenCodeThrottlePath());
}

function shouldSendThrottleKey(key: string, cooldown: number, now: number, path: string): boolean {
  const state = readThrottleState(path);
  const previous = typeof state[key] === "number" ? state[key] : 0;
  if (now - previous < cooldown) return false;
  state[key] = now;
  writeThrottleState(path, state);
  return true;
}

function buildExcludedReactionsSet(excludeReactions?: readonly OpenPetsReaction[]): ReadonlySet<string> {
  const valid = sanitizeOpenCodeExcludedReactions(excludeReactions);
  return valid.length > 0 ? new Set(valid) : emptySet;
}

const emptySet: ReadonlySet<string> = new Set();

function isTestLikeToolArgs(args: unknown): boolean {
  const command = isRecord(args) && typeof args.command === "string" ? args.command.slice(0, 300) : "";
  return /\b(test|vitest|jest|pytest|npm\s+test|pnpm\s+test|yarn\s+test|cargo\s+test|go\s+test)\b/i.test(command);
}

function getEventType(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  if (typeof event.type === "string") return event.type;
  return undefined;
}

function getEventPermissions(event: unknown): readonly string[] {
  if (!isRecord(event)) return [];
  const data = isRecord(event.data) ? event.data : undefined;
  const permissions = typeof data?.action === "string" ? [data.action] : [];
  if (Array.isArray(data?.resources)) {
    permissions.push(...data.resources.filter((resource): resource is string => typeof resource === "string"));
  }
  return permissions;
}

function readThrottleState(path: string): Record<string, number> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(parsed)) return {};
    const state: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if ((key === "thinking" || key === "success" || key === "error" || key === "permission" || key.startsWith("reaction:")) && typeof value === "number" && Number.isFinite(value)) state[key] = value;
    }
    return state;
  } catch {
    return {};
  }
}

function writeThrottleState(path: string, state: Record<string, number>): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tempPath = `${path}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, path);
  } catch {
    // Best effort only; throttling must never break hooks.
  }
}

function defaultSchedule(work: () => Promise<void>): void {
  queueMicrotask(() => { void work(); });
}

function sanitizeDebugError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"']{2,}/g, "<path>")
    .replace(/\b(api[_-]?key|secret|password|token)\s*[:=]\s*\S+/gi, "$1=<redacted>")
    .slice(0, 200);
}

function safeUid(): string {
  try { return String(userInfo().uid); } catch { return "user"; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
