import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { access, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserWindow, WebContents } from "electron";

const root = await mkdtemp(join(tmpdir(), "openpets-motion-snapshot-test-"));
const mock = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;
const electron = mock(`
  export const app = { getPath: () => ${JSON.stringify(root)}, getAppPath: () => ${JSON.stringify(root)} };
  export const ipcMain = { handle: (_channel, handler) => { globalThis.motionByteHandler = handler; } };
`);
const paths = mock(`export function getPetDir(id) { return ${JSON.stringify(root)} + '/pets/' + id; }`);
const installed = mock(`export async function readInstalledPetPackage(id) {
  return { format: 'motion', metadata: { id, clips: { idle: { file: 'clips/idle.webp' } } } };
}`);
const validator = mock(`
  import { mkdir, copyFile } from 'node:fs/promises';
  export async function validateDesktopPetPackageAssets(dir, petPackage, options) {
    await mkdir(options.copyTo + '/clips');
    await copyFile(dir + '/clips/idle.webp', options.copyTo + '/clips/idle.webp');
    return { package: petPackage, verifiedClips: { idle: { frameDurationsMs: [100], durationMs: 100 } } };
  }
`);
const lock = mock(`
  const locks = new Map();
  export async function withPetInstallLock(id, fn) {
    const previous = locks.get(id) ?? Promise.resolve();
    const result = previous.then(fn);
    locks.set(id, result.catch(() => {}));
    return result;
  }
`);
const logger = mock(`export function warn() {}`);
const filesystem = mock(`
  export * from 'node:fs/promises';
  import { rm as originalRemove } from 'node:fs/promises';
  export function rm(...args) {
    const operation = originalRemove(...args);
    globalThis.snapshotRemovalPromises.push(operation);
    return operation;
  }
`);
(globalThis as typeof globalThis & { snapshotRemovalPromises: Promise<void>[] }).snapshotRemovalPromises = [];
register(mock(`
  const mocks = new Map([
    ['electron', ${JSON.stringify(electron)}],
    ['./pet-paths.js', ${JSON.stringify(paths)}],
    ['./installed-pet-layout.js', ${JSON.stringify(installed)}],
    ['./pet-atlas-validation.js', ${JSON.stringify(validator)}],
    ['./pet-install-transaction.js', ${JSON.stringify(lock)}],
    ['./logger.js', ${JSON.stringify(logger)}],
  ]);
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'node:fs/promises' && /pet-motion-snapshot\.(js|ts)(\\?|$)/.test(context.parentURL)) {
      return { url: ${JSON.stringify(filesystem)}, shortCircuit: true };
    }
    if (mocks.has(specifier)) return { url: mocks.get(specifier), shortCircuit: true };
    if (specifier.endsWith('.ts') && mocks.has(specifier.slice(0, -3) + '.js')) {
      return { url: mocks.get(specifier.slice(0, -3) + '.js'), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
`), import.meta.url);

class FakeContents extends EventEmitter {
  destroyed = false;
  isDestroyed(): boolean { return this.destroyed; }
}

class FakeWindow extends EventEmitter {
  readonly contents = new FakeContents();
  private destroyed = false;
  get webContents(): WebContents {
    if (this.destroyed) throw new Error("BrowserWindow has been destroyed");
    return this.contents as unknown as WebContents;
  }
  isDestroyed(): boolean { return this.destroyed; }
  destroy(): void {
    this.destroyed = true;
    this.contents.destroyed = true;
    this.contents.emit("destroyed");
    this.emit("closed");
  }
}

try {
  const snapshotRoot = join(root, "motion-snapshots");
  await writeFile(snapshotRoot, "not a directory");
  const failedModulePath = "../src/pet-motion-snapshot.js?initialization-failure";
  const failedService: typeof import("../src/pet-motion-snapshot.js") = await import(failedModulePath);
  await assert.rejects(failedService.prepareInstalledMotionSnapshot("test"));
  await rm(snapshotRoot);
  await mkdir(join(snapshotRoot, "snapshot-ABC123"), { recursive: true });
  await assert.rejects(failedService.prepareInstalledMotionSnapshot("test"), "failed initialization must not be retried");
  await access(join(snapshotRoot, "snapshot-ABC123"));
  await failedService.cleanupAllMotionSnapshots();

  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "keep"), "outside");
  await writeFile(join(snapshotRoot, "unrelated"), "keep");
  await mkdir(join(snapshotRoot, "other-directory"));
  await symlink(outside, join(snapshotRoot, "snapshot-DEF456"));
  const petDir = join(root, "pets", "test");
  await mkdir(join(petDir, "clips"), { recursive: true });
  await writeFile(join(petDir, "pet.json"), "{}");
  await writeFile(join(petDir, "clips", "idle.webp"), "old");
  const otherPetDir = join(root, "pets", "other");
  await mkdir(join(otherPetDir, "clips"), { recursive: true });
  await writeFile(join(otherPetDir, "pet.json"), "{}");
  await writeFile(join(otherPetDir, "clips", "idle.webp"), "other");
  const snapshots = await import("../src/pet-motion-snapshot.js");
  const bytes = await import("../src/pet-sprite-bytes.js");
  const [first, same, otherPet] = await Promise.all([
    snapshots.prepareInstalledMotionSnapshot("test"),
    snapshots.prepareInstalledMotionSnapshot("test"),
    snapshots.prepareInstalledMotionSnapshot("other"),
  ]);
  await assert.rejects(access(join(snapshotRoot, "snapshot-ABC123")), "abandoned snapshot is removed");
  await access(join(snapshotRoot, "unrelated"));
  await access(join(snapshotRoot, "other-directory"));
  await access(join(outside, "keep"));
  await access(join(snapshotRoot, "snapshot-DEF456"));
  assert.equal((await readFile(fileURLToPath(first.urls.idle))).toString(), "old");
  assert.equal((await readFile(fileURLToPath(otherPet.urls.idle))).toString(), "other", "concurrent initialization must not delete active snapshots");
  assert.equal(first.snapshotId, same.snapshotId, "concurrent preparations share one revision");
  const window = new FakeWindow() as unknown as BrowserWindow;
  const other = new FakeWindow() as unknown as BrowserWindow;
  bytes.trackPetSpriteBytesWebContents(window.webContents);
  bytes.trackPetSpriteBytesWebContents(other.webContents);
  snapshots.retainWindowSnapshot(window, first);
  snapshots.releaseSupersededWindowSnapshots(window, first.snapshotId);
  const handler = (globalThis as typeof globalThis & { motionByteHandler: (event: { sender: WebContents }, url: string) => Promise<Buffer | null> }).motionByteHandler;
  assert.equal((await handler({ sender: window.webContents }, first.urls.idle))?.toString(), "old");
  assert.equal(await handler({ sender: other.webContents }, first.urls.idle), null, "another tracked window cannot read the snapshot");

  await rename(petDir, `${petDir}-old`);
  await mkdir(join(petDir, "clips"), { recursive: true });
  await writeFile(join(petDir, "pet.json"), "{}");
  await writeFile(join(petDir, "clips", "idle.webp"), "new");
  const second = await snapshots.prepareInstalledMotionSnapshot("test");
  snapshots.retainWindowSnapshot(window, second);
  assert.notEqual(first.snapshotId, second.snapshotId);
  assert.equal((await readFile(fileURLToPath(first.urls.idle))).toString(), "old", "replacement cannot mutate the old snapshot");
  assert.equal((await handler({ sender: window.webContents }, second.urls.idle))?.toString(), "new");
  snapshots.releaseSupersededWindowSnapshots(window, second.snapshotId);
  assert.equal(await handler({ sender: window.webContents }, first.urls.idle), null);
  snapshots.releaseWindowSnapshots(window);
  assert.equal(await handler({ sender: window.webContents }, second.urls.idle), null);

  const destroyedWindow = new FakeWindow();
  const destroyedBrowserWindow = destroyedWindow as unknown as BrowserWindow;
  const contents = destroyedWindow.webContents;
  const pending = await snapshots.prepareInstalledMotionSnapshot("test");
  snapshots.retainWindowSnapshot(destroyedBrowserWindow, otherPet);
  snapshots.releaseSupersededWindowSnapshots(destroyedBrowserWindow, otherPet.snapshotId);
  snapshots.retainWindowSnapshot(destroyedBrowserWindow, pending);
  assert.equal(destroyedWindow.contents.listenerCount("destroyed"), 1);
  const removalPromises = (globalThis as typeof globalThis & { snapshotRemovalPromises: Promise<void>[] }).snapshotRemovalPromises;
  removalPromises.length = 0;
  const latePreparation = snapshots.prepareInstalledMotionSnapshot("other");
  // A preceding closed listener can throw before later window listeners run.
  destroyedWindow.on("closed", () => { throw new Error("earlier closed listener"); });
  assert.throws(() => destroyedWindow.destroy(), /earlier closed listener/);
  assert.equal(destroyedWindow.contents.listenerCount("destroyed"), 0);
  assert.equal(snapshots.isWindowMotionSnapshotUrlAuthorized(contents, otherPet.urls.idle), false);
  assert.equal(snapshots.isWindowMotionSnapshotUrlAuthorized(contents, pending.urls.idle), false);
  assert.equal(removalPromises.length, 2, "destroy releases both owned snapshots immediately");
  await Promise.all(removalPromises);
  await assert.rejects(access(fileURLToPath(otherPet.urls.idle)));
  await assert.rejects(access(fileURLToPath(pending.urls.idle)));
  const late = await latePreparation;
  assert.throws(() => snapshots.retainWindowSnapshot(destroyedBrowserWindow, late), /unavailable/);
  snapshots.releaseWindowSnapshots(destroyedBrowserWindow);
  await snapshots.cleanupAllMotionSnapshots();
  await assert.rejects(access(fileURLToPath(otherPet.urls.idle)));
  await assert.rejects(access(fileURLToPath(pending.urls.idle)));
  await assert.rejects(access(fileURLToPath(late.urls.idle)));
  console.log("motion snapshot ownership and byte authorization passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
