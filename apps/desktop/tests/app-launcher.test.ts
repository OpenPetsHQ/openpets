import assert from "node:assert/strict";

import { createAppLauncherService, type AppLauncherStoredEntry } from "../src/app-launcher-service.js";

const availableTargets = new Set<string>(["/applications/editor", "/applications/calendar", "/applications/editor-v2"]);
const launches: string[] = [];
let persisted: unknown = { version: 1, entries: [] };
let nextId = 1;

function createId(): string {
  const suffix = String(nextId++).padStart(12, "0");
  return `00000000-0000-4000-8000-${suffix}`;
}

const service = createAppLauncherService({
  storage: {
    load: async () => structuredClone(persisted),
    save: async (entries: readonly AppLauncherStoredEntry[]) => {
      persisted = { version: 1, entries: structuredClone(entries) };
    },
  },
  isTargetAvailable: (targetPath) => availableTargets.has(targetPath),
  getIconDataUrl: async () => "data:image/png;base64,YQ==",
  launchTarget: async (targetPath) => { launches.push(targetPath); },
  createId,
});

const editor = await service.add("Code Editor", "/applications/editor");
const calendar = await service.add("Calendar", "/applications/calendar");

assert.equal(editor.length, 1);
assert.equal(calendar.length, 2);
assert.deepEqual(Object.keys(editor[0] ?? {}).sort(), ["available", "iconDataUrl", "id", "name"]);
assert.equal(JSON.stringify(editor).includes("/applications/editor"), false, "renderer snapshots do not expose target paths");

const editorId = editor[0]?.id;
const calendarId = calendar[1]?.id;
assert.ok(editorId);
assert.ok(calendarId);

const renamed = await service.rename(editorId, "  Editor  ");
assert.equal(renamed[0]?.name, "Editor");

const reordered = await service.move(editorId, 1);
assert.deepEqual(reordered.map((entry) => entry.name), ["Calendar", "Editor"]);

availableTargets.delete("/applications/calendar");
const unavailable = await service.list();
assert.equal(unavailable[0]?.available, false);
await assert.rejects(() => service.launch(calendarId), { message: "Application is unavailable." });
assert.deepEqual(launches, [], "unavailable targets are never launched");

const updated = await service.replaceTarget(calendarId, "/applications/editor-v2");
assert.equal(updated[0]?.available, true);
const staleMenuEntry = (await service.listForMenu()).find((entry) => entry.id === calendarId);
assert.ok(staleMenuEntry);
await service.replaceTarget(calendarId, "/applications/editor");
await assert.rejects(
  () => service.launch(calendarId, staleMenuEntry.targetRevision),
  { message: "Application selection is stale. Open the menu again." },
);
assert.deepEqual(launches, [], "a stale menu cannot launch a newly selected target");
const currentMenuEntry = (await service.listForMenu()).find((entry) => entry.id === calendarId);
assert.ok(currentMenuEntry);
await service.launch(calendarId, currentMenuEntry.targetRevision);
assert.deepEqual(launches, ["/applications/editor"]);

const removed = await service.remove(calendarId);
assert.deepEqual(removed.map((entry) => entry.name), ["Editor"]);
assert.deepEqual((persisted as { entries: AppLauncherStoredEntry[] }).entries.map((entry) => entry.name), ["Editor"]);

await assert.rejects(() => service.add("  ", "/applications/editor"), /display name/i);
assert.throws(() => service.rename(editorId, "bad\nname"), /display name/i);
assert.throws(() => service.move(editorId, 2), /order change/i);
assert.throws(() => service.remove("/applications/editor"), /entry is invalid/i);

const failingService = createAppLauncherService({
  storage: {
    load: async () => ({ version: 1, entries: [] }),
    save: async () => { throw new Error("write failed: C:\\private\\path"); },
  },
  isTargetAvailable: () => true,
  getIconDataUrl: () => undefined,
  launchTarget: async () => undefined,
  createId,
});
await assert.rejects(
  () => failingService.add("Editor", "C:\\private\\path\\editor.exe"),
  { message: "Application launcher settings could not be saved." },
);

console.log("App launcher service behavior passed.");
