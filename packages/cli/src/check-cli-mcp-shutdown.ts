import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const cliEntrypoint = fileURLToPath(new URL("./index.js", import.meta.url));
const discoveryFile = join(tmpdir(), `openpets-missing-discovery-${process.pid}.json`);
const port = await getAvailablePort();
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  OPENPETS_DISCOVERY_FILE: discoveryFile,
  OPENPETS_MCP_HTTP_TOKEN: "A".repeat(43),
};
delete environment.OPENPETS_REMOTE_ENDPOINT;
delete environment.OPENPETS_REMOTE_TOKEN;
delete environment.OPENPETS_REMOTE_CLIENT_ID;
delete environment.OPENPETS_MCP_WRAPPER_SHUTDOWN;
if (process.platform === "win32") environment.OPENPETS_MCP_WRAPPER_SHUTDOWN = "stdin-eof";

const wrapper = spawn(process.execPath, [cliEntrypoint, "mcp", "--transport", "http", "--port", String(port)], {
  stdio: ["pipe", "ignore", "pipe"],
  env: environment,
});

try {
  await waitForListeningMessage(wrapper);

  if (process.platform === "win32") wrapper.stdin?.end();
  else wrapper.kill("SIGTERM");

  const exit = await waitForExit(wrapper, 5_000);
  assert.equal(exit.signal, null, "the CLI wrapper exits after its MCP child shuts down");
  assert.equal(exit.code, 0, "graceful HTTP shutdown exits successfully");
  await assertPortClosed(port);
} finally {
  if (wrapper.exitCode === null && wrapper.signalCode === null) {
    if (process.platform === "win32") wrapper.stdin?.end();
    else wrapper.kill("SIGTERM");
    try {
      await waitForExit(wrapper, 3_000);
    } catch {
      wrapper.kill("SIGKILL");
      await waitForExit(wrapper, 3_000);
    }
  }
}

console.log("OpenPets CLI MCP wrapper shutdown passed.");

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a loopback port for the CLI shutdown check.");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function waitForListeningMessage(child: ChildProcess): Promise<void> {
  const stderr = child.stderr;
  if (!stderr) throw new Error("CLI wrapper did not expose stderr.");
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => finish(new Error(`CLI wrapper did not start HTTP mode. Output: ${output}`)), 10_000);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (output.includes("OpenPets MCP HTTP listening at http://127.0.0.1:")) finish();
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(new Error(`CLI wrapper exited before listening (code=${code}, signal=${signal}). Output: ${output}`));
    };
    const onError = (error: Error): void => finish(error);
    const finish = (error?: Error): void => {
      clearTimeout(timeout);
      stderr.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    stderr.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error("CLI wrapper did not exit before the timeout."));
    }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      clearTimeout(timeout);
      resolve({ code, signal });
    };
    child.once("exit", onExit);
  });
}

async function assertPortClosed(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("MCP child still accepts connections after the wrapper exited."));
    }, 1_000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.destroy();
      reject(new Error("MCP child still accepts connections after the wrapper exited."));
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (error.code === "ECONNREFUSED") resolve();
      else reject(error);
    });
  });
}
