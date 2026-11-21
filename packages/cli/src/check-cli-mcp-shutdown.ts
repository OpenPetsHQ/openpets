import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
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

const wrapper = spawnCliWrapper(port, environment);

let gracefulShutdownPassed = false;
try {
  await waitForListeningMessage(wrapper);

  if (process.platform === "win32") wrapper.stdin?.end();
  else wrapper.kill("SIGTERM");

  const exit = await waitForExit(wrapper, 5_000);
  assert.equal(exit.signal, null, "the CLI wrapper exits after its MCP child shuts down");
  assert.equal(exit.code, 0, "graceful HTTP shutdown exits successfully");
  await assertPortClosed(port);
  gracefulShutdownPassed = true;
} finally {
  if (!gracefulShutdownPassed) await stopWrapperTree(wrapper);
}

const occupiedPortServer = createServer();
await new Promise<void>((resolve, reject) => {
  occupiedPortServer.once("error", reject);
  occupiedPortServer.listen(0, "127.0.0.1", resolve);
});
const occupiedAddress = occupiedPortServer.address();
if (!occupiedAddress || typeof occupiedAddress === "string") throw new Error("Could not reserve a loopback port for the CLI startup-failure check.");
const occupiedPort = occupiedAddress.port;
const failureEnvironment: NodeJS.ProcessEnv = { ...environment, OPENPETS_MCP_WRAPPER_SHUTDOWN: "stdin-eof" };
const failingWrapper = spawnCliWrapper(occupiedPort, failureEnvironment);
failingWrapper.stderr?.resume();
let occupiedPortFailurePassed = false;
try {
  const exit = await waitForExit(failingWrapper, 20_000);
  assert.equal(exit.signal, null, "the CLI wrapper exits normally when its MCP child cannot bind");
  assert.equal(exit.code, 1, "HTTP startup failure propagates through the CLI wrapper");
  occupiedPortFailurePassed = true;
} finally {
  try {
    if (!occupiedPortFailurePassed) await stopWrapperTree(failingWrapper);
  } finally {
    await new Promise<void>((resolve, reject) => occupiedPortServer.close((error) => error ? reject(error) : resolve()));
  }
}

console.log("OpenPets CLI MCP wrapper shutdown passed.");

function spawnCliWrapper(port: number, env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [cliEntrypoint, "mcp", "--transport", "http", "--port", String(port)], {
    stdio: ["pipe", "ignore", "pipe"],
    env,
    detached: process.platform !== "win32",
  });
}

async function stopWrapperTree(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32") child.stdin?.end();
    else child.kill("SIGTERM");
    try {
      await waitForExit(child, 3_000);
    } catch {
      // The process-group kill below covers the wrapper and its MCP child.
    }
  }

  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  } else if (child.pid !== undefined) {
    const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    if (result.error) throw result.error;
  }

  if (child.exitCode === null && child.signalCode === null) await waitForExit(child, 3_000);
}

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
    const timeout = setTimeout(() => finish(new Error(`CLI wrapper did not start HTTP mode. Output: ${output}`)), 20_000);
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
