import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createOpenPetsMcpServer } from "./server.js";
import type { ToolContext } from "./tools.js";

const defaultShutdownGraceMs = 5_000;
const maximumRequestBytes = 1_048_576;
const route = "/mcp";

export interface SharedMcpHttpServerOptions {
  readonly context: ToolContext;
  readonly port: number;
  readonly token: string;
  /** Test override; production shutdown allows five seconds for active requests. */
  readonly shutdownGraceMs?: number;
}

export interface SharedMcpHttpServer {
  readonly endpoint: string;
  close(): Promise<void>;
}

export function createMcpHttpBearerToken(): string {
  return randomBytes(32).toString("base64url");
}

export function resolveMcpHttpBearerToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[A-Za-z0-9._~-]{32,128}$/.test(value)) {
    throw new Error("OPENPETS_MCP_HTTP_TOKEN must be 32 to 128 URL-safe characters.");
  }
  return value;
}

export function isAuthorizedMcpHttpRequest(header: string | readonly string[] | undefined, token: string): boolean {
  if (typeof header !== "string") return false;
  const match = /^Bearer ([A-Za-z0-9._~-]{32,128})$/i.exec(header);
  if (!match?.[1]) return false;
  const presented = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export async function startSharedMcpHttpServer(options: SharedMcpHttpServerOptions): Promise<SharedMcpHttpServer> {
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error("HTTP port must be a number between 1 and 65535.");
  }
  if (!/^[A-Za-z0-9._~-]{32,128}$/.test(options.token)) {
    throw new Error("HTTP bearer token must be 32 to 128 URL-safe characters.");
  }

  let closing = false;
  const server = createServer((request, response) => {
    void handleRequest(request, response, options, () => closing);
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: "127.0.0.1", port: options.port });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server, defaultShutdownGraceMs, () => { closing = true; });
    throw new Error("HTTP server did not bind to a TCP address.");
  }
  const endpoint = `http://127.0.0.1:${address.port}${route}`;
  let closePromise: Promise<void> | undefined;

  return {
    endpoint,
    close: () => {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = closeServer(server, options.shutdownGraceMs ?? defaultShutdownGraceMs, () => { closing = true; });
      return closePromise;
    },
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: SharedMcpHttpServerOptions,
  isClosing: () => boolean,
): Promise<void> {
  if (request.url !== route) {
    sendError(response, 404, "Not found.");
    request.resume();
    return;
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendError(response, 405, "Method not allowed.");
    request.resume();
    return;
  }
  if (!isAllowedHost(request.headers.host, options.port, request.socket.localPort)) {
    sendError(response, 403, "Request rejected.");
    request.resume();
    return;
  }
  if (!isAuthorizedMcpHttpRequest(request.headers.authorization, options.token)) {
    sendError(response, 401, "Unauthorized.");
    request.resume();
    return;
  }
  if (!isAllowedOrigin(request.headers.origin, request.headers.host)) {
    sendError(response, 403, "Request rejected.");
    request.resume();
    return;
  }
  if (isClosing()) {
    sendError(response, 503, "Server is shutting down.");
    request.resume();
    return;
  }
  if (!isJsonContentType(request.headers["content-type"])) {
    sendError(response, 415, "Content type must be application/json.");
    request.resume();
    return;
  }
  const contentEncoding = request.headers["content-encoding"];
  if (contentEncoding !== undefined && contentEncoding.toLowerCase() !== "identity") {
    sendError(response, 415, "Content encoding is not supported.");
    request.resume();
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendError(response, error instanceof RequestBodyTooLargeError ? 413 : 400, "Invalid request.");
    return;
  }

  const server = createOpenPetsMcpServer(options.context);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  } catch {
    if (!response.headersSent) sendError(response, 500, "Request could not be handled.");
    else if (!response.writableEnded) response.end();
  } finally {
    try { await server.close(); } catch { /* best-effort cleanup for this stateless request */ }
  }
}

function isAllowedHost(host: string | undefined, configuredPort: number, localPort: number | undefined): boolean {
  if (!host || !localPort) return false;
  const normalized = host.toLowerCase();
  const expectedPort = String(localPort);
  if (configuredPort === 80 && (normalized === "127.0.0.1" || normalized === "localhost")) return true;
  return normalized === `127.0.0.1:${expectedPort}`
    || normalized === `localhost:${expectedPort}`
    || normalized === `[::1]:${expectedPort}`;
}

function isAllowedOrigin(originHeader: string | readonly string[] | undefined, host: string | undefined): boolean {
  if (originHeader === undefined) return true;
  if (typeof originHeader !== "string" || !host) return false;
  try {
    const origin = new URL(originHeader);
    return origin.protocol === "http:"
      && !origin.username
      && !origin.password
      && origin.host.toLowerCase() === host.toLowerCase()
      && (origin.pathname === "" || origin.pathname === "/")
      && origin.search === ""
      && origin.hash === "";
  } catch {
    return false;
  }
}

function isJsonContentType(value: string | readonly string[] | undefined): boolean {
  if (typeof value !== "string") return false;
  return /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(value.trim());
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const rawLength = request.headers["content-length"];
  if (rawLength !== undefined) {
    const contentLength = Number(rawLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) throw new Error("Invalid content length.");
    if (contentLength > maximumRequestBytes) throw new RequestBodyTooLargeError();
  }

  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    byteLength += bytes.length;
    if (byteLength > maximumRequestBytes) throw new RequestBodyTooLargeError();
    chunks.push(bytes);
  }
  if (byteLength === 0) throw new Error("Request body is empty.");
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendError(response: ServerResponse, statusCode: number, message: string): void {
  if (response.headersSent || response.writableEnded) return;
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify({ error: message }));
}

async function closeServer(server: Server, graceMs: number, publishClosing: () => void): Promise<void> {
  publishClosing();
  if (!server.listening) return;

  const closed = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  server.closeIdleConnections();

  let forceTimer: NodeJS.Timeout | undefined;
  const forceAfterGrace = new Promise<void>((resolve) => {
    forceTimer = setTimeout(() => {
      server.closeAllConnections();
      resolve();
    }, Math.max(0, graceMs));
  });
  await Promise.race([closed, forceAfterGrace]);
  if (forceTimer) clearTimeout(forceTimer);

  // Do not hold up lease teardown forever if a connection cannot be drained.
  if (server.listening) server.closeAllConnections();
  await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 250))]);
}

class RequestBodyTooLargeError extends Error {}
