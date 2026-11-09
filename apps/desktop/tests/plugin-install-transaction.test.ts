import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitPluginInstall } from "../src/plugin-install-transaction.js";
import { PluginService } from "../src/plugin-service.js";
import { PluginStateStore, type PluginStateRecord } from "../src/plugin-state.js";

const id = "transaction-plug";
const token = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
function fixture() {
  const userDataPath = mkdtempSync(join(tmpdir(), "openpets-plugin-transaction-"));
  const root = join(userDataPath, "plugins");
  mkdirSync(root);
  mkdirSync(join(userDataPath, "plugins-dev"));
  const store = new PluginStateStore({ userDataPath });
  store.initialize();
  const target = join(root, id);
  const stage = join(root, `.tmp-${id}-${token}`);
  const backup = join(root, `.openpets-backup-${token}`);
  const record = (version: string, permissions: PluginStateRecord["approvedPermissions"]): PluginStateRecord => ({ id, version, source: "catalog", installPath: target, manifestPath: join(target, "openpets.plugin.json"), enabled: true, approvedPermissions: permissions, config: { preserved: true } });
  const old = record("1.0.0", ["timer"]);
  const next = record("2.0.0", ["pet:speak", "timer"]);
  const writePackage = (path: string, value: PluginStateRecord) => {
    mkdirSync(path);
    writeFileSync(join(path, "openpets.plugin.json"), JSON.stringify({ manifestVersion: 1, id, name: "Test", version: value.version, runtime: "declarative", permissions: value.approvedPermissions, triggers: [{ on: "timer", everyMinutes: 5, actions: [] }] }));
  };
  writePackage(target, old);
  writePackage(stage, next);
  store.upsertRecord(old);
  return { userDataPath, root, target, stage, backup, old, next, store, writePackage };
}

for (const failure of ["rename", "state", "activation"] as const) {
  const f = fixture();
  await assert.rejects(() => commitPluginInstall({
    userDataPath: f.userDataPath, id, stagePath: f.stage, previous: f.old, store: f.store,
    promote: failure === "rename" ? async () => { throw new Error("injected rename failure"); } : undefined,
    activate: async () => {
      if (failure === "state") throw new Error("injected state failure");
      f.store.upsertRecord(f.next);
      if (failure === "activation") throw new Error("injected activation failure");
    },
  }));
  assert.equal(f.store.getRecord(id)?.version, "1.0.0");
  assert.deepEqual(f.store.getRecord(id)?.approvedPermissions, ["timer"]);
  assert.equal(JSON.parse(readFileSync(join(f.target, "openpets.plugin.json"), "utf8")).version, "1.0.0");
}

for (const damage of ["missing", "invalid"] as const) {
  const f = fixture();
  const manifestPath = join(f.target, "openpets.plugin.json");
  if (damage === "missing") rmSync(manifestPath);
  else writeFileSync(manifestPath, "{invalid json");
  const previous = { ...f.old, approvedNetworkHosts: ["example.com"], config: { preserved: "local" } };
  f.store.upsertRecord(previous);
  const storagePath = join(f.userDataPath, "plugin-storage", `${id}.json`);
  mkdirSync(join(f.userDataPath, "plugin-storage"));
  writeFileSync(storagePath, '{"saved":"value"}');

  await assert.rejects(() => commitPluginInstall({
    userDataPath: f.userDataPath,
    id,
    stagePath: f.stage,
    previous,
    store: f.store,
    activate: async () => {
      f.store.upsertRecord(f.next);
      throw new Error("replacement activation failed");
    },
  }), /replacement activation failed/);
  assert.deepEqual(f.store.getRecord(id), previous);
  assert.equal(readdirSync(f.root).some((name) => name.startsWith(".openpets-transaction-")), false);

  // Simulate interruption after replacement promotion and before rollback.
  f.writePackage(f.stage, f.next);
  renameSync(f.target, f.backup);
  renameSync(f.stage, f.target);
  f.store.upsertRecord(f.next);
  const markerPath = join(f.root, `.openpets-transaction-${token}.json`);
  writeFileSync(markerPath, JSON.stringify({ version: 1, id, token, stage: `.tmp-${id}-${token}`, previous, committed: false }));

  const healthyId = "healthy-plugin";
  const healthyPath = join(f.root, healthyId);
  mkdirSync(healthyPath);
  writeFileSync(join(healthyPath, "openpets.plugin.json"), JSON.stringify({ manifestVersion: 1, id: healthyId, name: "Healthy", version: "1.0.0", runtime: "declarative", permissions: ["timer"], triggers: [{ on: "timer", everyMinutes: 5, actions: [] }] }));
  f.store.upsertRecord({ ...f.old, id: healthyId, installPath: healthyPath, manifestPath: join(healthyPath, "openpets.plugin.json"), config: {} });
  let deferCleanup = true;
  const service = new PluginService({
    userDataPath: f.userDataPath,
    petApi: { speak() {}, react() {}, moveBy() {}, wander() {}, moveToHome() {} },
    seedBundledPlugins: false,
    pluginInstallRecoveryCleanup: async () => { if (deferCleanup) throw new Error("cleanup deferred"); },
  });
  try {
    await service.start();
    assert.equal(service.runtime.isPluginActive(healthyId, "1.0.0"), true);
    const restored = service.stateStore.getRecord(id);
    assert.ok(restored?.brokenReason);
    const { brokenReason: _brokenReason, ...restoredRecord } = restored;
    assert.deepEqual(restoredRecord, previous);
    assert.equal(readFileSync(storagePath, "utf8"), '{"saved":"value"}');
    assert.equal(JSON.parse(readFileSync(markerPath, "utf8")).rolledBack, true);
    deferCleanup = false;
    await service.stop();
    await service.start();
    assert.equal(service.runtime.isPluginActive(healthyId, "1.0.0"), true);
    assert.ok(service.stateStore.getRecord(id)?.brokenReason);
    assert.equal(existsSync(markerPath), false);
  } finally {
    await service.stop();
    rmSync(f.userDataPath, { recursive: true, force: true });
  }
}

{
  const f = fixture();
  let activated = false;
  await assert.rejects(() => commitPluginInstall({
    userDataPath: f.userDataPath,
    id,
    stagePath: f.stage,
    previous: f.old,
    store: f.store,
    syncStagedFile: async () => { throw new Error("injected fsync failure"); },
    activate: async () => { activated = true; },
  }), /injected fsync failure/);
  assert.equal(activated, false);
  assert.equal(existsSync(f.stage), false);
  assert.equal(f.store.getRecord(id)?.version, "1.0.0");
  assert.equal(JSON.parse(readFileSync(join(f.target, "openpets.plugin.json"), "utf8")).version, "1.0.0");
  assert.equal(readdirSync(f.root).some((name) => name.startsWith(".openpets-transaction-")), false);
}

if (process.platform !== "win32") {
  const f = fixture();
  symlinkSync(join(f.target, "openpets.plugin.json"), join(f.stage, "link"));
  await assert.rejects(() => commitPluginInstall({
    userDataPath: f.userDataPath,
    id,
    stagePath: f.stage,
    previous: f.old,
    store: f.store,
    activate: async () => { throw new Error("Must not activate"); },
  }), /symlink/);
  assert.equal(existsSync(f.stage), false);
  assert.equal(f.store.getRecord(id)?.version, "1.0.0");
}

{
  const f = fixture();
  let activeVersion = "1.0.0";
  let warning = false;
  await commitPluginInstall({
    userDataPath: f.userDataPath,
    id,
    stagePath: f.stage,
    previous: f.old,
    store: f.store,
    activate: async () => { f.store.upsertRecord(f.next); activeVersion = "2.0.0"; },
    cleanupCommitted: async () => { throw new Error("injected cleanup failure"); },
    onCleanupWarning: () => { warning = true; },
  });
  assert.equal(warning, true);
  assert.equal(activeVersion, "2.0.0");
  assert.equal(f.store.getRecord(id)?.version, "2.0.0");
  assert.equal(JSON.parse(readFileSync(join(f.target, "openpets.plugin.json"), "utf8")).version, "2.0.0");
  assert.equal(readdirSync(f.root).some((name) => name.startsWith(".openpets-transaction-")), true);
  const runtime = { async start() { assert.equal(f.store.getRecord(id)?.version, "2.0.0"); } };
  const service = new PluginService({ userDataPath: f.userDataPath, stateStore: f.store, runtime: runtime as never, seedBundledPlugins: false });
  await service.start();
  assert.equal(readdirSync(f.root).some((name) => name.startsWith(".openpets-transaction-")), false);
  assert.equal(readdirSync(f.root).some((name) => name.startsWith(".openpets-backup-")), false);
}

for (const phase of ["prepared", "before-promotion", "after-promotion", "state-written", "committed"] as const) {
  const f = fixture();
  const marker = { version: 1, id, token, stage: `.tmp-${id}-${token}`, previous: f.old, committed: phase === "committed" };
  writeFileSync(join(f.root, `.openpets-transaction-${token}.json`), JSON.stringify(marker));
  if (phase !== "prepared") renameSync(f.target, f.backup);
  if (phase !== "prepared" && phase !== "before-promotion") renameSync(f.stage, f.target);
  if (phase === "state-written" || phase === "committed") f.store.upsertRecord(f.next);
  let started = false;
  const expected = phase === "committed" ? f.next : f.old;
  const runtime = {
    async start() {
      started = true;
      assert.equal(f.store.getRecord(id)?.version, expected.version);
      assert.deepEqual(f.store.getRecord(id)?.approvedPermissions, expected.approvedPermissions);
      assert.equal(JSON.parse(readFileSync(join(f.target, "openpets.plugin.json"), "utf8")).version, expected.version);
    },
  };
  const service = new PluginService({ userDataPath: f.userDataPath, stateStore: f.store, runtime: runtime as never, seedBundledPlugins: false });
  await service.start();
  assert.equal(started, true);
}

for (const committed of [true, false]) {
  const f = fixture();
  const markerPath = join(f.root, `.openpets-transaction-${token}.json`);
  writeFileSync(markerPath, JSON.stringify({ version: 1, id, token, stage: `.tmp-${id}-${token}`, previous: f.old, committed }));
  renameSync(f.target, f.backup);
  renameSync(f.stage, f.target);
  f.store.upsertRecord(f.next);
  const expected = committed ? f.next : f.old;
  let starts = 0;
  let warnings = 0;
  const runtime = {
    async start() {
      starts += 1;
      assert.equal(f.store.getRecord(id)?.version, expected.version);
      assert.equal(JSON.parse(readFileSync(join(f.target, "openpets.plugin.json"), "utf8")).version, expected.version);
    },
    log(_level: string, message: string) {
      if (message === "Plugin recovery cleanup deferred.") warnings += 1;
    },
  };
  const service = new PluginService({
    userDataPath: f.userDataPath,
    stateStore: f.store,
    runtime: runtime as never,
    seedBundledPlugins: false,
    pluginInstallRecoveryCleanup: async () => { throw new Error("persistent deletion failure"); },
  });
  await service.start();
  if (!committed) {
    f.store.upsertRecord({
      ...expected,
      enabled: false,
      approvedPermissions: ["pet:speak", "timer"],
      config: { changedAfterRecovery: true },
    });
  }
  await service.start();
  assert.equal(starts, 2);
  assert.equal(warnings, 2);
  assert.equal(existsSync(markerPath), true);
  if (!committed) {
    assert.deepEqual(f.store.getRecord(id)?.config, { changedAfterRecovery: true });
    assert.equal(f.store.getRecord(id)?.enabled, false);
    assert.deepEqual(f.store.getRecord(id)?.approvedPermissions, ["pet:speak", "timer"]);
  }

  const previous = f.store.getRecord(id);
  assert.ok(previous);
  const next = { ...previous, version: "3.0.0" };
  const newStage = join(f.root, `.tmp-${id}-next`);
  f.writePackage(newStage, next);
  let activated = false;
  await assert.rejects(() => commitPluginInstall({
    userDataPath: f.userDataPath,
    id,
    stagePath: newStage,
    previous,
    store: f.store,
    cleanupCommitted: async () => { throw new Error("persistent deletion failure"); },
    activate: async () => { activated = true; },
  }), /recovery is pending/);
  assert.equal(activated, false);
  assert.equal(f.store.getRecord(id)?.version, expected.version);
  assert.equal(existsSync(markerPath), true);
  assert.equal(existsSync(newStage), false);

  f.writePackage(newStage, next);
  await commitPluginInstall({
    userDataPath: f.userDataPath,
    id,
    stagePath: newStage,
    previous,
    store: f.store,
    activate: async () => { f.store.upsertRecord(next); },
  });
  assert.equal(f.store.getRecord(id)?.version, "3.0.0");
  assert.equal(existsSync(markerPath), false);
}

{
  const f = fixture();
  const markerPath = join(f.root, `.openpets-transaction-${token}.json`);
  rmSync(f.target, { recursive: true });
  renameSync(f.stage, f.target);
  f.store.upsertRecord(f.next);
  writeFileSync(markerPath, JSON.stringify({ version: 1, id, token, stage: `.tmp-${id}-${token}`, previous: null, committed: false }));
  let starts = 0;
  const runtime = { async start() { starts += 1; assert.equal(f.store.getRecord(id), undefined); assert.equal(existsSync(f.target), false); } };
  const service = new PluginService({
    userDataPath: f.userDataPath,
    stateStore: f.store,
    runtime: runtime as never,
    seedBundledPlugins: false,
    pluginInstallRecoveryCleanup: async () => { throw new Error("persistent deletion failure"); },
  });
  await service.start();
  await service.start();
  assert.equal(starts, 2);
  assert.equal(existsSync(markerPath), true);
  assert.equal(JSON.parse(readFileSync(markerPath, "utf8")).rolledBack, true);
}

{
  const f = fixture();
  const markerPath = join(f.root, `.openpets-transaction-${token}.json`);
  renameSync(f.target, f.backup);
  renameSync(f.stage, f.target);
  f.store.upsertRecord(f.next);
  writeFileSync(markerPath, JSON.stringify({ version: 1, id, token, stage: `.tmp-${id}-${token}`, previous: f.old, committed: true }));
  let blocked = true;
  let reloads = 0;
  let fetches = 0;
  const runtime = { async start() {}, async reloadPlugin() { reloads += 1; } };
  const service = new PluginService({
    userDataPath: f.userDataPath,
    stateStore: f.store,
    runtime: runtime as never,
    seedBundledPlugins: false,
    fetchImpl: async () => { fetches += 1; throw new Error("Marketplace should not be contacted"); },
    pluginInstallRecoveryCleanup: async () => { if (blocked) throw new Error("persistent deletion failure"); },
  });
  await service.start();
  assert.equal((await service.updateCatalog(id)).ok, false);
  assert.equal(fetches, 0);
  assert.equal(readdirSync(f.root).some((name) => name.startsWith(`.tmp-${id}-`)), false);
  assert.equal((await service.uninstall(id)).ok, false);
  assert.equal(f.store.getRecord(id)?.version, "2.0.0");
  assert.equal(existsSync(f.target), true);
  assert.equal(reloads, 0);
  await service.start();
  assert.equal(f.store.getRecord(id)?.version, "2.0.0");
  blocked = false;
  assert.equal((await service.uninstall(id)).ok, true);
  assert.equal(f.store.getRecord(id), undefined);
  assert.equal(existsSync(f.target), false);
  assert.equal(existsSync(markerPath), false);
}

{
  const f = fixture();
  const markerPath = join(f.root, `.openpets-transaction-${token}.json`);
  rmSync(f.target, { recursive: true });
  renameSync(f.stage, f.target);
  f.store.upsertRecord(f.next);
  writeFileSync(markerPath, JSON.stringify({ version: 1, id, token, stage: `.tmp-${id}-${token}`, previous: null, committed: false }));
  const source = join(f.userDataPath, "local-source");
  f.writePackage(source, f.old);
  let blocked = true;
  let reloads = 0;
  const runtime = { async start() {}, async reloadPlugin() { reloads += 1; } };
  const service = new PluginService({
    userDataPath: f.userDataPath,
    stateStore: f.store,
    runtime: runtime as never,
    seedBundledPlugins: false,
    pluginInstallRecoveryCleanup: async () => { if (blocked) throw new Error("persistent deletion failure"); },
  });
  await service.start();
  assert.equal((await service.loadLocalPath(source, { autoApprove: true })).ok, false);
  assert.equal(f.store.getRecord(id), undefined);
  assert.equal(existsSync(join(f.userDataPath, "plugins-dev", id)), false);
  assert.equal(reloads, 0);
  await service.start();
  assert.equal(f.store.getRecord(id), undefined);
  blocked = false;
  assert.equal((await service.loadLocalPath(source, { autoApprove: true })).ok, true);
  assert.equal(f.store.getRecord(id)?.source, "local");
  assert.equal(existsSync(markerPath), false);
}
