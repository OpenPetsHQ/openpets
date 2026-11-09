import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";

import { handleLocalIpcSocket } from "../src/local-ipc-transport.js";
import type { LocalIpcRequestHandler } from "../src/local-ipc-request-handler.js";

async function openSocket(handleRequest: LocalIpcRequestHandler, processingMs = 500) {
  let acceptSocket!: (socket: net.Socket) => void;
  const acceptedSocket = new Promise<net.Socket>((resolve) => { acceptSocket = resolve; });
  const server = net.createServer((socket) => {
    handleLocalIpcSocket(socket, "token", handleRequest, () => {}, {
      readIdleMs: 30,
      processingMs,
    });
    acceptSocket(socket);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = net.connect(address.port, "127.0.0.1");
  await once(client, "connect");
  const accepted = await acceptedSocket;
  return { client, server, accepted };
}

test("a dispatched request survives read idle and ignores further requests", async () => {
  let resolveRequest!: (response: { id: string; ok: boolean }) => void;
  let calls = 0;
  const { client, server } = await openSocket(async () => {
    calls += 1;
    return new Promise((resolve) => { resolveRequest = resolve; });
  });
  try {
    client.write('{"id":"first","version":1,"token":"token","method":"hello"}\n');
    await new Promise((resolve) => setTimeout(resolve, 70));
    client.write("second\n");
    resolveRequest({ id: "first", ok: true });
    const [data] = await once(client, "data");
    assert.equal(data.toString(), '{"id":"first","ok":true}\n');
    assert.equal(calls, 1);
  } finally {
    client.destroy();
    server.close();
  }
});

test("an oversized frame is rejected before dispatch even when it contains a newline", async () => {
  let called = false;
  const { client, server } = await openSocket(async () => {
    called = true;
    return { id: null, ok: true };
  });
  try {
    client.write(`${"x".repeat(16 * 1024)}\n`);
    const [data] = await once(client, "data");
    assert.deepEqual(JSON.parse(data.toString()), {
      id: null,
      ok: false,
      error: { code: "invalid_request", message: "IPC request is too large." },
    });
    assert.equal(called, false);
  } finally {
    client.destroy();
    server.close();
  }
});

test("an incomplete request is closed after read idle", async () => {
  let called = false;
  const { client, server } = await openSocket(async () => {
    called = true;
    return { id: null, ok: true };
  });
  try {
    client.write("partial");
    await once(client, "close");
    assert.equal(called, false);
  } finally {
    client.destroy();
    server.close();
  }
});

test("processing has an absolute socket deadline", async () => {
  const { client, server } = await openSocket(() => new Promise(() => {}), 60);
  try {
    client.write("request\n");
    await once(client, "close");
  } finally {
    client.destroy();
    server.close();
  }
});

test("disconnect closes the socket before a late handler completes", async () => {
  let resolveRequest!: (response: { id: string; ok: boolean }) => void;
  const { client, server, accepted } = await openSocket(async () =>
    new Promise((resolve) => { resolveRequest = resolve; }),
  );
  try {
    client.write("request\n");
    await once(accepted, "data");
    const closed = once(accepted, "close");
    client.destroy();
    await closed;
    resolveRequest({ id: "late", ok: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(accepted.destroyed, true);
  } finally {
    client.destroy();
    server.close();
  }
});
