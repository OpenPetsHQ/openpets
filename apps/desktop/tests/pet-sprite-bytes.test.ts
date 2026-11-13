import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, truncate, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import type { WebContents } from "electron";
import { motionMaxClipBytes } from "@open-pets/pet-format/motion";

const root = await mkdtemp(join(tmpdir(), "openpets-sprite-bytes-"));
const mock = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;
const electron = mock(`
  export const app = { getPath: () => ${JSON.stringify(root)}, getAppPath: () => ${JSON.stringify(root)} };
  export const ipcMain = { handle: (_channel, handler) => { globalThis.spriteByteHandler = handler; } };
`);
const snapshots = mock(`
  export async function isMotionSnapshotPath(path) { return path.includes('/motion-snapshots/'); }
  export function isWindowMotionSnapshotUrlAuthorized(sender) { return sender.authorized; }
`);
const logger = mock("export function warn() {};");
register(mock(`
  const mocks = new Map([['electron', ${JSON.stringify(electron)}], ['./pet-motion-snapshot.js', ${JSON.stringify(snapshots)}], ['./logger.js', ${JSON.stringify(logger)}]]);
  export async function resolve(specifier, context, nextResolve) {
    if (mocks.has(specifier)) return { url: mocks.get(specifier), shortCircuit: true };
    return nextResolve(specifier, context);
  }
`), import.meta.url);

test("authorized Motion IPC accepts large clips and rejects oversized files before reading", async () => {
  try {
    const directory = join(root, "motion-snapshots", "snapshot");
    await mkdir(directory, { recursive: true });
    const path = join(directory, "clip.webp");
    await writeFile(path, "");
    await truncate(path, 101 * 1024 * 1024);
    const contents = Object.assign(new EventEmitter(), { authorized: true });
    const { trackPetSpriteBytesWebContents } = await import("../src/pet-sprite-bytes.js");
    trackPetSpriteBytesWebContents(contents as unknown as WebContents);
    const handler = (globalThis as typeof globalThis & { spriteByteHandler: (event: { sender: unknown }, url: string) => Promise<Buffer | null> }).spriteByteHandler;
    const url = pathToFileURL(path).href;
    assert.equal((await handler({ sender: contents }, url))?.byteLength, 101 * 1024 * 1024);
    contents.authorized = false;
    assert.equal(await handler({ sender: contents }, url), null);
    contents.authorized = true;
    await truncate(path, motionMaxClipBytes + 1);
    assert.equal(await handler({ sender: contents }, url), null);
    contents.emit("destroyed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
