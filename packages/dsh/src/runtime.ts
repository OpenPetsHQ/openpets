import { pickHookSpeech, validateHookSpeech, type HookSpeechCategory } from "@open-pets/agent-events";
import { createOpenPetsClient, type OpenPetsClient, type OpenPetsReaction } from "@open-pets/client";
import type { Context } from "@deepseek-ai/cordis";

export type DshEventName = "agent/status" | "agent/error" | "approval/request" | "agent/assistant-stream" | "tools/result";
export type DshAgentStatus = "running" | "idle";

export interface DshEventDecision {
  readonly reaction: OpenPetsReaction;
  readonly speechCategory: HookSpeechCategory;
}

export interface OpenPetsDshOptions {
  readonly clientFactory?: () => OpenPetsClient;
  readonly schedule?: (work: () => Promise<void>) => void | Promise<void>;
  readonly random?: () => number;
  readonly now?: () => number;
}

export interface OpenPetsDshRuntime {
  readonly handleStatus: (event: unknown) => void;
  readonly handleEvent: (eventName: DshEventName, event?: unknown) => void;
  readonly handleApproval: () => void;
  readonly handleStream: (payload: unknown) => void;
  readonly handleToolResult: (exec: unknown, result?: unknown) => void;
}

export type DshCordisApi = Pick<Context, "on">;

const automaticTimeoutMs = 500;
const errorSuccessSuppressionMs = 5_000;
const minSpeechIntervalMs = 1_200;

export function sanitizeStatusLine(text: string): string | null {
  if (!text || typeof text !== "string") return null;
  let s = text.replace(/[\r\n]+/g, " ").trim();
  s = s.replace(/https?:\/\/\S+/gi, "");
  s = s.replace(/[`{};]/g, "");
  s = s.replace(/(?:^|\s)(?:~|\.{1,2}|[A-Za-z]:)?[\\/]\S+\/([^\s/]+)/g, " $1");
  if (s.length > 100) s = s.slice(0, 97) + "...";
  s = s.trim();
  if (s.length === 0) return null;
  try {
    return validateHookSpeech(s);
  } catch {
    return null;
  }
}

/**
 * Map only the categorical values defined by DSH. Event payloads are
 * deliberately not inspected or forwarded. For agent/status, only the
 * categorical `status` property is read from the event envelope.
 */
export function classifyDshEvent(eventName: DshEventName | string, event?: unknown): DshEventDecision | undefined {
  if (eventName === "agent/status") {
    const status = typeof event === "string" ? event : getStatusCategory(event);
    if (status === "running") return { reaction: "thinking", speechCategory: "thinking" };
    if (status === "idle") return { reaction: "success", speechCategory: "success" };
    return undefined;
  }
  if (eventName === "agent/error") return { reaction: "error", speechCategory: "error" };
  if (eventName === "approval/request") return { reaction: "waiting", speechCategory: "permission" };
  return undefined;
}

export function createOpenPetsDshRuntime(options: OpenPetsDshOptions = {}): OpenPetsDshRuntime {
  const clientFactory = options.clientFactory ?? createOpenPetsDshClient;
  const schedule = options.schedule ?? defaultSchedule;
  let client: OpenPetsClient | undefined;
  let recentErrorAt = Number.NEGATIVE_INFINITY;
  let lastCustomSpeechAt = Number.NEGATIVE_INFINITY;
  let streamBuffer = "";
  let statusExtractedForTurn = false;

  const getClient = (): OpenPetsClient => {
    client ??= clientFactory();
    return client;
  };

  const dispatch = (decision: DshEventDecision | undefined): void => {
    if (!decision) return;

    const now = options.now?.() ?? Date.now();
    if (decision.reaction === "error") {
      recentErrorAt = now;
    } else if (decision.reaction === "success" && now - recentErrorAt < errorSuccessSuppressionMs) {
      return;
    }

    const work = async (): Promise<void> => {
      try {
        const speech = validateHookSpeech(pickHookSpeech(decision.speechCategory, options.random));
        await getClient().say(speech, { reaction: decision.reaction });
      } catch {
        // Automatic agent listeners must never affect the DSH operation.
      }
    };

    try {
      const scheduled = schedule(work);
      if (isPromiseLike(scheduled)) void scheduled.catch(() => undefined);
    } catch {
      // A scheduler supplied by the host is optional infrastructure.
    }
  };

  const dispatchCustom = (message: string, reaction: OpenPetsReaction): void => {
    const now = options.now?.() ?? Date.now();
    if (now - lastCustomSpeechAt < minSpeechIntervalMs) return;
    lastCustomSpeechAt = now;

    const work = async (): Promise<void> => {
      try {
        const validated = validateHookSpeech(message);
        await getClient().say(validated, { reaction });
      } catch {
        // Automatic agent listeners must never affect the DSH operation.
      }
    };

    try {
      const scheduled = schedule(work);
      if (isPromiseLike(scheduled)) void scheduled.catch(() => undefined);
    } catch {
      // Ignored
    }
  };

  return {
    handleStatus(event) {
      const status = typeof event === "string" ? event : getStatusCategory(event);
      if (status === "running") {
        streamBuffer = "";
        statusExtractedForTurn = false;
      }
      dispatch(classifyDshEvent("agent/status", event));
    },
    handleEvent(eventName, event) {
      dispatch(classifyDshEvent(eventName, event));
    },
    handleApproval() {
      dispatch(classifyDshEvent("approval/request"));
    },
    handleStream(payload) {
      if (!payload || typeof payload !== "object") return;
      const frame = (payload as { readonly frame?: unknown }).frame as {
        readonly type?: string;
        readonly chunk?: { readonly type?: string; readonly text?: string };
      } | undefined;
      if (!frame) return;

      if (frame.type === "start") {
        streamBuffer = "";
        statusExtractedForTurn = false;
        return;
      }

      if (frame.type === "end") {
        streamBuffer = "";
        return;
      }

      if (frame.type === "chunk" && frame.chunk?.type === "text-delta" && typeof frame.chunk.text === "string") {
        if (statusExtractedForTurn) return;
        streamBuffer += frame.chunk.text;

        const arrowIndex = streamBuffer.search(/[⏵▶]/);
        if (arrowIndex !== -1) {
          const newlineIndex = streamBuffer.indexOf("\n", arrowIndex);
          if (newlineIndex !== -1) {
            statusExtractedForTurn = true;
            const rawStatus = streamBuffer.slice(arrowIndex + 1, newlineIndex).trim();
            const clean = sanitizeStatusLine(rawStatus);
            if (clean) {
              dispatchCustom(clean, "working");
            }
          }
        }
      }
    },
    handleToolResult(exec) {
      if (!exec || typeof exec !== "object") return;
      const e = exec as { readonly name?: string; readonly params?: Record<string, unknown> };
      if (!e.name) return;

      if (e.name === "bash" && e.params?.description) {
        const clean = sanitizeStatusLine(String(e.params.description));
        if (clean) dispatchCustom(clean, "running");
      } else if (e.name === "edit" || e.name === "write") {
        const filePath = e.params?.file_path ? String(e.params.file_path).split(/[\\/]/).pop() : "";
        const action = e.name === "edit" ? "Chỉnh sửa" : "Ghi file";
        const clean = sanitizeStatusLine(filePath ? `${action} ${filePath}` : action);
        if (clean) dispatchCustom(clean, "editing");
      } else if (e.name === "read") {
        const filePath = e.params?.file_path ? String(e.params.file_path).split(/[\\/]/).pop() : "";
        const clean = sanitizeStatusLine(filePath ? `Đọc ${filePath}` : "Đang đọc file");
        if (clean) dispatchCustom(clean, "working");
      }
    },
  };
}

export function createOpenPetsDshClient(): OpenPetsClient {
  return createOpenPetsClient({
    remote: false,
    connectTimeoutMs: automaticTimeoutMs,
    responseTimeoutMs: automaticTimeoutMs,
  });
}

/** Register the DSH listeners without taking ownership of their flow. */
export function registerDshListeners(cordis: DshCordisApi, options: OpenPetsDshOptions = {}): OpenPetsDshRuntime {
  const runtime = createOpenPetsDshRuntime(options);
  const on = cordis.on as unknown as (eventName: string, listener: (...args: readonly unknown[]) => unknown) => unknown;
  on("agent/status", (event: unknown) => runtime.handleStatus(event));
  on("agent/error", () => runtime.handleEvent("agent/error"));
  on("approval/request", (_request: unknown, next: unknown) => {
    runtime.handleApproval();
    return typeof next === "function" ? next() : undefined;
  });
  on("agent/assistant-stream", (payload: unknown) => runtime.handleStream(payload));
  on("tools/result", (exec: unknown, result: unknown) => runtime.handleToolResult(exec, result));
  return runtime;
}

function defaultSchedule(work: () => Promise<void>): void {
  void Promise.resolve().then(work).catch(() => undefined);
}

function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return typeof value === "object" && value !== null && typeof value.then === "function";
}

function getStatusCategory(event: unknown): unknown {
  if (typeof event !== "object" || event === null) return undefined;
  return (event as { readonly status?: unknown }).status;
}
