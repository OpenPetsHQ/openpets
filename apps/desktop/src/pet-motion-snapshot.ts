import { app, type BrowserWindow, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { readInstalledPetPackage } from "./installed-pet-layout.js";
import { validateDesktopPetPackageAssets } from "./pet-atlas-validation.js";
import type { MotionBodyDescriptor } from "./pet-body-contract.js";
import { withPetInstallLock } from "./pet-install-transaction.js";
import { getPetDir } from "./pet-paths.js";
import { warn } from "./logger.js";

export type InstalledPetSourceKind = "personal" | "team";

interface Snapshot {
  readonly descriptor: MotionBodyDescriptor;
  readonly directory: string;
  readonly revision: string;
  readonly owners: Set<WebContents>;
  expiry?: ReturnType<typeof setTimeout>;
}

interface WindowSnapshots {
  readonly contents: WebContents;
  readonly onDestroyed: () => void;
  current?: string;
  pending?: string;
}

const snapshots = new Map<string, Snapshot>();
const revisions = new Map<string, Snapshot>();
const windows = new Map<BrowserWindow, WindowSnapshots>();
const preparations = new Set<Promise<MotionBodyDescriptor>>();
const removals = new Set<Promise<void>>();
let snapshotRoot: string | undefined;
let initialization: Promise<string> | undefined;
let generation = 0;
let shuttingDown = false;

/** Clean abandoned directories before any window can create a session snapshot. */
function initializeSnapshotRoot(): Promise<string> {
  if (initialization) return initialization;
  initialization = (async () => {
    const userData = await realpath(app.getPath("userData"));
    const root = join(userData, "motion-snapshots");
    try {
      await mkdir(root, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const rootInfo = await lstat(root);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || await realpath(root) !== root) {
      throw new Error("Motion snapshot root must be a real directory under user data.");
    }
    for (const entry of await readdir(root, { withFileTypes: true })) {
      // mkdtemp appends exactly six random alphanumeric characters. Never
      // follow links or remove unrelated user-data entries.
      if (!/^snapshot-[a-zA-Z0-9]{6}$/.test(entry.name) || !entry.isDirectory()) continue;
      const path = join(root, entry.name);
      const info = await lstat(path);
      if (!info.isSymbolicLink() && info.isDirectory()) {
        await rm(path, { recursive: true, force: true });
      }
    }
    snapshotRoot = root;
    return root;
  })();
  return initialization;
}

function removeSnapshot(snapshot: Snapshot): void {
  if (snapshot.owners.size > 0 || !snapshots.delete(snapshot.descriptor.snapshotId)) return;
  if (snapshot.expiry) clearTimeout(snapshot.expiry);
  if (revisions.get(snapshot.revision) === snapshot) revisions.delete(snapshot.revision);
  const removal = rm(snapshot.directory, { recursive: true, force: true }).catch((error: unknown) => {
    warn("pet.window", "motion snapshot cleanup failed", { error: String(error) });
  });
  removals.add(removal);
  void removal.finally(() => removals.delete(removal));
}

function release(windowState: WindowSnapshots, id: string | undefined): void {
  if (!id) return;
  const snapshot = snapshots.get(id);
  if (!snapshot) return;
  snapshot.owners.delete(windowState.contents);
  removeSnapshot(snapshot);
}

/** Prepare a validated private copy under the same lock as installation. */
export function prepareInstalledMotionSnapshot(
  petId: string,
  source: InstalledPetSourceKind = "personal",
): Promise<MotionBodyDescriptor> {
  if (shuttingDown) return Promise.reject(new Error("Motion snapshot service is shutting down."));
  const expectedGeneration = generation;
  const preparation = withPetInstallLock(petId, async () => {
    if (generation !== expectedGeneration) throw new Error("Motion snapshot preparation was cancelled.");
    const root = await initializeSnapshotRoot();
    if (generation !== expectedGeneration) throw new Error("Motion snapshot preparation was cancelled.");
    const directory = getPetDir(petId, source);
    const petPackage = await readInstalledPetPackage(petId, source);
    if (petPackage.format !== "motion") throw new Error("Installed pet is not a Motion package.");

    // The install transaction promotes a new directory. Include file identities as
    // well so direct edits to an installed package also invalidate the cache.
    const paths = [directory, join(directory, "pet.json"), ...Object.values(petPackage.metadata.clips).map((clip) => join(directory, clip.file))];
    const identities = await Promise.all(paths.map(async (path) => {
      const value = await stat(path, { bigint: true });
      return `${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}`;
    }));
    const revision = JSON.stringify([source, petId, identities]);
    const cached = revisions.get(revision);
    if (cached) {
      if (cached.expiry) {
        clearTimeout(cached.expiry);
        cached.expiry = setTimeout(() => removeSnapshot(cached), 30_000);
        cached.expiry.unref();
      }
      return cached.descriptor;
    }

    const target = await mkdtemp(join(root, "snapshot-"));
    try {
      const validated = await validateDesktopPetPackageAssets(directory, petPackage, { copyTo: target });
      if (validated.package.format !== "motion" || !("verifiedClips" in validated)) {
        throw new Error("Motion package validation returned a Classic package.");
      }
      if (generation !== expectedGeneration) throw new Error("Motion snapshot preparation was cancelled.");
      const urls: Record<string, string> = Object.create(null);
      for (const [id, clip] of Object.entries(petPackage.metadata.clips)) {
        urls[id] = pathToFileURL(join(target, clip.file)).toString();
      }
      const descriptor: MotionBodyDescriptor = {
        snapshotId: randomUUID(),
        metadata: petPackage.metadata,
        urls,
        verifiedClips: validated.verifiedClips,
      };
      const snapshot: Snapshot = { descriptor, directory: target, revision, owners: new Set() };
      snapshots.set(descriptor.snapshotId, snapshot);
      revisions.set(revision, snapshot);
      // A prepared snapshot that is never adopted must not leak for the session.
      snapshot.expiry = setTimeout(() => removeSnapshot(snapshot), 30_000);
      snapshot.expiry.unref();
      return descriptor;
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      throw error;
    }
  });
  preparations.add(preparation);
  void preparation.then(() => preparations.delete(preparation), () => preparations.delete(preparation));
  return preparation;
}

/** Keep the committed snapshot and at most one replacement per window. */
export function retainWindowSnapshot(window: BrowserWindow, descriptor: MotionBodyDescriptor): void {
  const snapshot = snapshots.get(descriptor.snapshotId);
  if (!snapshot || snapshot.descriptor !== descriptor || window.isDestroyed()) {
    throw new Error("Cannot retain an unavailable Motion snapshot.");
  }
  let state = windows.get(window);
  if (!state) {
    const contents = window.webContents;
    if (contents.isDestroyed()) throw new Error("Cannot retain an unavailable Motion snapshot.");
    state = { contents, onDestroyed: () => releaseWindowSnapshots(window) };
    windows.set(window, state);
    contents.once("destroyed", state.onDestroyed);
  }
  if (state.contents.isDestroyed()) throw new Error("Cannot retain an unavailable Motion snapshot.");
  if (state.current === descriptor.snapshotId || state.pending === descriptor.snapshotId) return;
  release(state, state.pending);
  state.pending = descriptor.snapshotId;
  snapshot.owners.add(state.contents);
  if (snapshot.expiry) clearTimeout(snapshot.expiry);
  snapshot.expiry = undefined;
}

/** Commit only after the renderer reports that the first frame was presented. */
export function releaseSupersededWindowSnapshots(window: BrowserWindow, snapshotId: string): void {
  const state = windows.get(window);
  if (!state || (state.current !== snapshotId && state.pending !== snapshotId)) return;
  if (state.pending === snapshotId) {
    release(state, state.current);
    state.current = snapshotId;
    state.pending = undefined;
  }
}

export function releaseWindowSnapshots(window: BrowserWindow): void {
  const state = windows.get(window);
  if (!state) return;
  windows.delete(window);
  state.contents.removeListener("destroyed", state.onDestroyed);
  release(state, state.current);
  release(state, state.pending);
}

/** Used by the existing byte IPC after canonicalizing the requested file. */
export async function isMotionSnapshotPath(path: string): Promise<boolean> {
  let root = snapshotRoot;
  if (!root) {
    try {
      root = await realpath(join(app.getPath("userData"), "motion-snapshots"));
    } catch {
      return false;
    }
  }
  return path === root || path.startsWith(`${root}${sep}`);
}

export function isWindowMotionSnapshotUrlAuthorized(contents: WebContents, url: string): boolean {
  for (const snapshot of snapshots.values()) {
    if (snapshot.owners.has(contents) && Object.values(snapshot.descriptor.urls).includes(url)) return true;
  }
  return false;
}

export async function cleanupAllMotionSnapshots(): Promise<void> {
  shuttingDown = true;
  generation += 1;
  if (initialization) await Promise.allSettled([initialization]);
  await Promise.allSettled([...preparations]);
  for (const window of [...windows.keys()]) releaseWindowSnapshots(window);
  for (const snapshot of [...snapshots.values()]) removeSnapshot(snapshot);
  await Promise.all([...removals]);
}
