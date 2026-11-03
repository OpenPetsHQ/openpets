import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseAnnouncementsFeed, selectAnnouncement } from "../src/announcements-core.js";
import { AnnouncementsService } from "../src/announcements-service.js";
import { installControlCenterAnnouncementsIpcHandlers } from "../src/control-center-announcements-ipc.js";

const announcement = {
  id: "first",
  startsAt: "2026-01-01T00:00:00Z",
  expiresAt: "2027-01-01T00:00:00Z",
  theme: "update",
  eyebrow: "News",
  title: "Hello",
  body: "News",
  cta: { label: "Visit", url: "https://openpets.dev/" },
};
const feed = (items: unknown[]) => ({ schemaVersion: 1, announcements: items });
const now = Date.parse("2026-06-01T00:00:00Z");

test("selects active compatible highest priority then newest", () => {
  const items = parseAnnouncementsFeed(feed([
    announcement,
    { ...announcement, id: "old", priority: 2 },
    {
      ...announcement,
      id: "new",
      priority: 2,
      startsAt: "2026-02-01T00:00:00Z",
      minVersion: "4.1.0",
      maxVersion: "4.1.0",
    },
    { ...announcement, id: "future", priority: 3, startsAt: "2026-12-01T00:00:00Z" },
  ]));
  assert.equal(selectAnnouncement(items, "4.1.0", now)?.id, "new");
  assert.equal(selectAnnouncement(items, "4.2.0", now)?.id, "old");
  assert.equal(selectAnnouncement(items, "4.1.0", Date.parse("2027-01-01T00:00:00Z")), null);
});

test("rejects invalid dates, duplicates and untrusted URLs", () => {
  for (const items of [
    [announcement, announcement],
    [{ ...announcement, startsAt: "2026-02-30T00:00:00Z" }],
    [{ ...announcement, startsAt: "2026-02-01T24:00:00Z" }],
    [{ ...announcement, cta: { label: "Visit", url: "https://openpets.dev.evil.test/" } }],
    [{ ...announcement, image: { url: "http://openpets.dev/image", alt: "art" } }],
    [{ ...announcement, minVersion: "broken" }],
    [{ ...announcement, minVersion: "v4.1.0" }],
    [{ ...announcement, maxVersion: "4.1.0-beta" }],
    [{ ...announcement, minVersion: "04.1.0" }],
  ]) {
    assert.throws(() => parseAnnouncementsFeed(feed(items)));
  }
});

test("dismissal survives restart and links are resolved by current ID", async () => {
  const userData = mkdtempSync(join(tmpdir(), "openpets-announcements-"));
  const opened: string[] = [];
  const options = {
    userData,
    version: "4.1.0",
    preview: false,
    now: () => now,
    log: () => {},
    openExternal: async (url: string) => {
      opened.push(url);
    },
    fetch: async () => new Response(JSON.stringify(feed([announcement]))),
  };
  try {
    const first = new AnnouncementsService(options);
    assert.equal((await first.get()).unseen, true);
    await first.dismiss("first");
    const restarted = new AnnouncementsService(options);
    assert.equal((await restarted.get()).unseen, false);
    await restarted.openLink("first");
    await assert.rejects(restarted.openLink("other"));
    assert.deepEqual(opened, ["https://openpets.dev/"]);
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

test("coalesces refresh, falls back on failure and never selects expired cache", async () => {
  let clock = now;
  let calls = 0;
  const service = new AnnouncementsService({
    userData: tmpdir(),
    version: "4.1.0",
    preview: false,
    now: () => clock,
    log: () => {},
    openExternal: async () => {},
    fetch: async () => {
      calls++;
      if (calls > 1) {
        throw new Error("offline");
      }
      return new Response(JSON.stringify(feed([announcement])));
    },
  });
  await Promise.all([service.get(), service.get()]);
  assert.equal(calls, 1);
  clock += 16 * 60 * 1000;
  assert.equal((await service.get()).announcement?.id, "first");
  clock = Date.parse("2027-01-01T00:00:00Z");
  assert.equal((await service.get()).announcement, null);
});

test("timeout fails quietly even when fetch does not settle", async () => {
  const service = new AnnouncementsService({
    userData: tmpdir(),
    version: "4.1.0",
    preview: false,
    log: () => {},
    openExternal: async () => {},
    timeoutMs: 5,
    fetch: async () => new Promise<Response>(() => {}),
  });
  assert.equal((await service.get()).announcement, null);
});

test("oversized response is cancelled without replacing the cached announcement", async () => {
  let clock = now;
  let calls = 0;
  let cancelled = false;
  const service = new AnnouncementsService({
    userData: tmpdir(),
    version: "4.1.0",
    preview: false,
    now: () => clock,
    log: () => {},
    openExternal: async () => {},
    fetch: async () => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify(feed([announcement])));
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(256 * 1024 + 1));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body);
    },
  });
  assert.equal((await service.get()).announcement?.id, "first");
  clock += 16 * 60 * 1000;
  assert.equal((await service.get()).announcement?.id, "first");
  assert.equal(cancelled, true);
});

test("timeout cancels a stalled response body", async () => {
  let cancelled = false;
  const service = new AnnouncementsService({
    userData: tmpdir(),
    version: "4.1.0",
    preview: false,
    log: () => {},
    openExternal: async () => {},
    timeoutMs: 5,
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    })),
  });
  assert.equal((await service.get()).announcement, null);
  assert.equal(cancelled, true);
});

test("IPC checks sender and validates IDs before actions", async () => {
  const handlers = new Map<string, (event: { sender: { id: number } }, ...args: unknown[]) => unknown>();
  const service = new AnnouncementsService({
    userData: tmpdir(),
    version: "4.1.0",
    preview: true,
    log: () => {},
    openExternal: async () => {},
  });
  installControlCenterAnnouncementsIpcHandlers({
    registerHandle: (channel, handler) => {
      handlers.set(channel, handler);
    },
    authorizeSender: (event) => {
      if (event.sender.id !== 1) {
        throw new Error("unauthorized");
      }
    },
    getService: () => service,
  });
  const open = handlers.get("openpets:announcements-open-link")!;
  assert.throws(() => open({ sender: { id: 2 } }, "preview-halloween"));
  assert.throws(() => open({ sender: { id: 1 } }, "https://evil.test/"));
  await assert.rejects(Promise.resolve(open({ sender: { id: 1 } }, "other")));
});
