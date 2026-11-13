import type net from "node:net";

import { errorResponse, IpcProtocolError, maxIpcMessageBytes } from "./local-ipc-protocol.js";
import type { LocalIpcRequestHandler } from "./local-ipc-request-handler.js";

const readIdleTimeoutMs = 3_000;
const processingTimeoutMs = 150_000;

/** Owns one request socket, including its read-idle and processing deadlines. */
export function handleLocalIpcSocket(
  socket: net.Socket,
  token: string,
  handleRequest: LocalIpcRequestHandler,
  onTooLarge: (bytes: number) => void,
  timeouts = { readIdleMs: readIdleTimeoutMs, processingMs: processingTimeoutMs },
): void {
  socket.setEncoding("utf8");
  socket.setTimeout(timeouts.readIdleMs, () => socket.destroy());

  let buffer = "";
  let handled = false;
  let processingTimer: NodeJS.Timeout | undefined;
  socket.once("close", () => {
    if (processingTimer) clearTimeout(processingTimer);
  });

  socket.on("data", (chunk) => {
    if (handled) return;
    buffer += chunk;

    const bytes = Buffer.byteLength(buffer, "utf8");
    if (bytes > maxIpcMessageBytes) {
      handled = true;
      onTooLarge(bytes);
      writeResponse(socket, errorResponse(null, new IpcProtocolError("invalid_request", "IPC request is too large.")));
      return;
    }

    const newline = buffer.indexOf("\n");
    if (newline === -1) return;

    handled = true;
    const raw = buffer.slice(0, newline);
    buffer = "";
    socket.setTimeout(0);
    processingTimer = setTimeout(() => socket.destroy(), timeouts.processingMs);
    processingTimer.unref();
    void handleRequest(raw, token).then((response) => writeResponse(socket, response));
  });
}

function writeResponse(socket: net.Socket, response: unknown): void {
  if (socket.destroyed || !socket.writable) return;
  socket.end(`${JSON.stringify(response)}\n`);
}
