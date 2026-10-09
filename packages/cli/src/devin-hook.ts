import { dispatchHookDecision } from "@open-pets/claude";
import { mapDevinHookPayload } from "@open-pets/devin";

export interface DevinHookRunOptions {
  readonly configuredPetId?: string;
  readonly debug?: boolean;
}

// Devin Desktop write/response payloads carry edit and response text we never
// read; allow them through without buffering unbounded input.
const maxDevinHookInputBytes = 4 * 1024 * 1024;

/**
 * Runs one Devin CLI or Devin Desktop hook invocation. It always exits 0 so a
 * missing desktop app, a malformed payload, or an IPC failure never blocks or
 * fails the agent's action.
 */
export async function runDevinHookFromStdin(stdin: NodeJS.ReadableStream, options: DevinHookRunOptions = {}): Promise<number> {
  try {
    const raw = await readBoundedStdin(stdin, maxDevinHookInputBytes);
    if (raw === undefined) return 0;

    const payload = JSON.parse(raw || "{}") as unknown;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return 0;

    const decision = mapDevinHookPayload(payload as Record<string, unknown>);
    if (!decision?.reaction) return 0;

    await dispatchHookDecision(decision, { configuredPetId: options.configuredPetId, debug: options.debug });
  } catch (error) {
    if (options.debug) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`OpenPets Devin hook ignored error: ${message.slice(0, 200)}\n`);
    }
  }
  return 0;
}

/** Resolves `undefined` for oversized input, after draining the stream. */
function readBoundedStdin(stdin: NodeJS.ReadableStream, maxBytes: number): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;

    stdin.on("data", (chunk: Buffer | string) => {
      if (oversized) return;
      const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      size += buffer.length;
      if (size > maxBytes) {
        oversized = true;
        chunks.length = 0;
        return;
      }
      chunks.push(buffer);
    });
    stdin.on("error", reject);
    stdin.on("end", () => resolve(oversized ? undefined : Buffer.concat(chunks).toString("utf8")));
  });
}
