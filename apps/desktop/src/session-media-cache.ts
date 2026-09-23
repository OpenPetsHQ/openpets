import { app, type Protocol } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { debug, info, warn } from "./logger.js";
import { safeHttpFetchBytes, type NetworkDiagnostics } from "./plugin-sdk-network.js";

/**
 * Host-owned cache for practice session media (narration segments, sound
 * layers) that plugins reference by https URL. The host downloads a file the
 * first time a session needs it — under the plugin's approved network hosts
 * and the same guards as `ctx.net` — keeps it on disk, and serves it to the pet
 * window through the `openpets-session-media:` scheme. Plays offline after the
 * first listen; no remote media origin ever reaches the pet window's CSP.
 */

export const sessionMediaScheme = "openpets-session-media";

/** Per-file cap: meditation segments are ~0.2MB; the longest sound beds
 * (15-minute loops) reach ~28MB. */
const maxMediaFileBytes = 48 * 1024 * 1024;
/** Whole-cache cap; least-recently-used files are evicted past it. */
const maxCacheBytes = 1024 * 1024 * 1024;
const mediaExtensions = new Map<string, string>([
  [".mp3", "audio/mpeg"],
  [".m4a", "audio/mp4"],
  [".ogg", "audio/ogg"],
  [".wav", "audio/wav"],
]);
const cacheIdPattern = /^[a-f0-9]{64}\.(mp3|m4a|ogg|wav)$/;

const inFlight = new Map<string, Promise<string>>();

function cacheDir(): string {
  return join(app.getPath("userData"), "session-media");
}

function cacheIdFor(url: string): string {
  const extension = extname(new URL(url).pathname).toLowerCase();
  if (!mediaExtensions.has(extension)) throw new Error("Session media must be an mp3, m4a, ogg, or wav file.");
  return `${createHash("sha256").update(url).digest("hex")}${extension}`;
}

/** Renderer URL for a cached file id. */
export function sessionMediaUrl(cacheId: string): string {
  return `${sessionMediaScheme}://media/${cacheId}`;
}

/**
 * Resolve a remote media URL to a local `openpets-session-media:` URL,
 * downloading it once. Concurrent requests for the same URL share a download.
 */
export async function resolveSessionMedia(url: string, allowedHosts: ReadonlySet<string>, diagnostics: NetworkDiagnostics): Promise<string> {
  const cacheId = cacheIdFor(url);
  const path = join(cacheDir(), cacheId);
  try {
    const existing = await stat(path);
    if (existing.isFile() && existing.size > 0) {
      const now = new Date();
      await utimes(path, now, now).catch(() => undefined); // LRU touch; a failed touch only ages the entry
      return sessionMediaUrl(cacheId);
    }
  } catch {
    // Not cached yet.
  }

  let pending = inFlight.get(cacheId);
  if (!pending) {
    pending = downloadToCache(url, cacheId, allowedHosts, diagnostics).finally(() => inFlight.delete(cacheId));
    inFlight.set(cacheId, pending);
  }
  return pending;
}

async function downloadToCache(url: string, cacheId: string, allowedHosts: ReadonlySet<string>, diagnostics: NetworkDiagnostics): Promise<string> {
  const started = Date.now();
  const response = await safeHttpFetchBytes(url, allowedHosts, diagnostics, maxMediaFileBytes);
  if (!response.ok || response.body.byteLength === 0) {
    throw new Error(`Session media download failed (HTTP ${response.status}).`);
  }
  const dir = cacheDir();
  await mkdir(dir, { recursive: true });
  const finalPath = join(dir, cacheId);
  const tempPath = `${finalPath}.${process.pid}.${Date.now()}.part`;
  await writeFile(tempPath, response.body);
  await rename(tempPath, finalPath);
  info("pet.session", "session media cached", {
    pluginId: diagnostics.pluginId,
    host: new URL(url).hostname,
    sizeBytes: response.body.byteLength,
    durationMs: Date.now() - started,
  });
  void evictOverCap().catch((error: unknown) => {
    warn("pet.session", "session media eviction failed", { error: error instanceof Error ? error.message : String(error) });
  });
  return sessionMediaUrl(cacheId);
}

async function evictOverCap(): Promise<void> {
  const dir = cacheDir();
  const names = await readdir(dir);
  const entries: { path: string; size: number; used: number }[] = [];
  for (const name of names) {
    if (!cacheIdPattern.test(name)) continue;
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (info?.isFile()) entries.push({ path, size: info.size, used: info.mtimeMs });
  }
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= maxCacheBytes) return;
  entries.sort((a, b) => a.used - b.used);
  let evicted = 0;
  for (const entry of entries) {
    if (total <= maxCacheBytes) break;
    await unlink(entry.path).catch(() => undefined); // an entry removed concurrently is already gone
    total -= entry.size;
    evicted += 1;
  }
  debug("pet.session", "session media evicted", { evicted, remainingBytes: total });
}

/**
 * Serve cached files. The scheme is registered privileged with `stream` so
 * audio elements can seek; responses only ever come from the cache directory.
 */
export function registerSessionMediaProtocol(protocol: Protocol): void {
  protocol.handle(sessionMediaScheme, async (request) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
      const url = new URL(request.url);
      const cacheId = url.pathname.replace(/^\//, "");
      if (url.hostname !== "media" || url.search || url.hash || !cacheIdPattern.test(cacheId)) {
        return new Response(null, { status: 404 });
      }
      const body = await readFile(join(cacheDir(), cacheId));
      const contentType = mediaExtensions.get(extname(cacheId)) ?? "application/octet-stream";
      return new Response(body, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(body.byteLength),
          "Cache-Control": "private, max-age=3600",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
