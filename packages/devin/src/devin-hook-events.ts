/**
 * Pure mapping from Devin hook payloads to OpenPets reactions. Two payload
 * families exist:
 *
 * - Devin CLI (Devin Local agent) lifecycle hooks: Claude Code-compatible
 *   `hook_event_name` payloads with Devin tool names (`edit`, `exec`, ...).
 * - Devin Desktop (Cascade) hooks: `agent_action_name` payloads with a
 *   `tool_info` object.
 *
 * Only event names, tool names, and a bounded slice of a shell command (to
 * spot test runs) are inspected. Prompt, code, and output text never leave
 * this function.
 */

export type DevinHookReaction = "thinking" | "waiting" | "success" | "editing" | "testing";
export type DevinHookSpeechCategory = "permission";

export interface DevinHookDecision {
  readonly eventName: string;
  readonly reaction?: DevinHookReaction;
  readonly speechCategory?: DevinHookSpeechCategory;
}

/** Devin CLI lifecycle events OpenPets subscribes to. */
export const devinCliHookEvents = ["UserPromptSubmit", "PreToolUse", "PermissionRequest", "Stop"] as const;

/** Devin CLI tools that map to a reaction; PreToolUse hooks only match these. */
export const devinCliReactiveToolPattern = "^(edit|write|apply_patch|notebook_edit|exec)$";

/** Devin Desktop (Cascade) events OpenPets subscribes to. */
export const devinDesktopHookEvents = ["pre_user_prompt", "post_write_code", "pre_run_command", "post_cascade_response"] as const;

const devinCliEditTools = new Set(["edit", "write", "apply_patch", "notebook_edit"]);
const testCommandPattern = /\b(test|vitest|jest|pytest|npm\s+test|pnpm\s+test|yarn\s+test|cargo\s+test|go\s+test)\b/i;
const maxInspectedCommandLength = 300;

export function mapDevinHookPayload(payload: Record<string, unknown>): DevinHookDecision | null {
  if (typeof payload.hook_event_name === "string") {
    return mapDevinCliEvent(payload.hook_event_name, payload);
  }
  if (typeof payload.agent_action_name === "string") {
    return mapDevinDesktopEvent(payload.agent_action_name, payload);
  }
  return null;
}

function mapDevinCliEvent(eventName: string, payload: Record<string, unknown>): DevinHookDecision {
  switch (eventName) {
    case "UserPromptSubmit":
      return { eventName, reaction: "thinking" };
    case "PermissionRequest":
      return { eventName, reaction: "waiting", speechCategory: "permission" };
    case "Stop":
      return { eventName, reaction: "success" };
    case "PreToolUse":
      return { eventName, reaction: classifyDevinCliTool(payload) };
    default:
      return { eventName };
  }
}

function mapDevinDesktopEvent(eventName: string, payload: Record<string, unknown>): DevinHookDecision {
  switch (eventName) {
    case "pre_user_prompt":
      return { eventName, reaction: "thinking" };
    case "post_write_code":
      return { eventName, reaction: "editing" };
    case "pre_run_command":
      return { eventName, reaction: isTestCommand(readString(payload.tool_info, "command_line")) ? "testing" : undefined };
    case "post_cascade_response":
      return { eventName, reaction: "success" };
    default:
      return { eventName };
  }
}

function classifyDevinCliTool(payload: Record<string, unknown>): DevinHookReaction | undefined {
  const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "";
  if (devinCliEditTools.has(toolName)) return "editing";
  if (toolName !== "exec") return undefined;

  const command = readString(payload.tool_input, "command") ?? readString(payload.tool_input, "cmd");
  return isTestCommand(command) ? "testing" : undefined;
}

function isTestCommand(command: string | undefined): boolean {
  if (!command) return false;
  return testCommandPattern.test(command.slice(0, maxInspectedCommandLength));
}

function readString(container: unknown, key: string): string | undefined {
  if (typeof container !== "object" || container === null) return undefined;
  const value = (container as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
