import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginJsHost, PluginJsHostStartOptions } from "../src/plugin-js-host.js";
import { PluginService } from "../src/plugin-service.js";
import type { PluginStateRecord } from "../src/plugin-state.js";

const catalogId = "upgrade.catalog";
const localId = "upgrade.local";
const bundledId = "openpets.reminders";
const fixtureRoot = join(process.env.OPENPETS_DESKTOP_ROOT ?? process.cwd(), "tests", "fixtures");

// Protect installed pre-marketplace profiles against startup data loss, API outages,
// marketplace replacement, and a declined permission escalation.
for (const outage of ["offline", 404, 500] as const) {
  const userDataPath = mkdtempSync(join(tmpdir(), "openpets-marketplace-upgrade-"));
  const starts: Array<{ record: PluginStateRecord; stored: unknown }> = [];
  const requests: string[] = [];
  let releaseVersion: "2.0.0" | "3.0.0" | undefined;
  let prompts = 0;
  const jsHost: PluginJsHost = {
    async startPlugin(options: PluginJsHostStartOptions) {
      assert.ok(options.sdk);
      starts.push({ record: options.record, stored: options.sdk.storage.get("saved") });
      return { stop() {} };
    },
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.equal(init?.credentials, "omit");
    if (!releaseVersion) {
      if (outage === "offline") throw new Error("offline");
      return new Response("unavailable", { status: outage });
    }
    const zip = readFileSync(join(fixtureRoot, `marketplace-upgrade-${releaseVersion}.zip`));
    const downloadUrl = `https://studio-api.openpets.dev/api/marketplace/plugins/${catalogId}/releases/${releaseVersion}/download`;
    if (url === downloadUrl) return new Response(new Uint8Array(zip));
    assert.equal(url, `https://studio-api.openpets.dev/api/marketplace/plugins/${catalogId}`);
    const permissions = releaseVersion === "2.0.0" ? ["network", "storage"] : ["network", "storage", "pet:speak"];
    const release = {
      id: `release-${releaseVersion}`, pluginId: catalogId, version: releaseVersion,
      status: "approved", runtime: "javascript", sdkVersion: "3.0.0", permissions,
      network: { hosts: ["api.example.com"] }, downloadUrl,
      sha256: createHash("sha256").update(zip).digest("hex"),
    };
    return Response.json({
      ...release, id: catalogId, releaseId: release.id, name: "Upgrade Catalog",
      description: "Existing catalog plugin", category: "tools", tags: [],
      publisher: { id: "author", username: "author", displayName: "Author", publisherType: "community" },
      iconUrl: null, heartCount: 0, ratingAverage: null, ratingCount: 0, downloadCount: 0,
      hearted: false, myRating: null, readme: "", screenshots: [], sourceUrl: null,
      homepageUrl: null, license: null, changelog: "", releases: [release],
    });
  };
  const service = new PluginService({
    userDataPath, seedBundledPlugins: false, jsHost, fetchImpl, currentAppVersion: "2.0.0",
    petApi: { speak() {}, react() {}, moveBy() {}, wander() {}, moveToHome() {} },
    confirmPermissions: async () => { prompts += 1; return false; },
  });
  try {
    const records: PluginStateRecord[] = [
      makeRecord(userDataPath, catalogId, "catalog", true),
      makeRecord(userDataPath, localId, "local", false),
      { ...makeRecord(userDataPath, bundledId, "catalog", true), bundled: true },
    ];
    for (const record of records) writePackageAndStorage(userDataPath, record);
    writeFileSync(join(userDataPath, "openpets-plugin-state.json"), JSON.stringify({ version: 1, plugins: Object.fromEntries(records.map((record) => [record.id, record])) }));
    const sentinels = ["openpets-state.json", "pets.json", "openpets-plugin-platform-settings.json"];
    for (const name of sentinels) writeFileSync(join(userDataPath, name), `sentinel ${name}\n`);
    const sentinelBytes = sentinels.map((name) => readFileSync(join(userDataPath, name)));

    await service.start();
    assert.deepEqual(requests, [], "startup must not require marketplace or authentication");
    assert.deepEqual(service.stateStore.listRecords(), [...records].sort((a, b) => a.id.localeCompare(b.id)));
    assert.deepEqual(starts.map(({ record }) => record.id).sort(), [bundledId, catalogId].sort());
    for (const observation of starts) {
      assert.deepEqual(observation.record, records.find((record) => record.id === observation.record.id));
      assert.deepEqual(observation.stored, { owner: observation.record.id, count: 17 });
      assert.equal(service.runtime.isPluginActive(observation.record.id, "1.0.0"), true);
    }
    assert.equal(service.runtime.isPluginActive(localId, "1.0.0"), false);
    await assert.rejects(() => service.getMarketplacePlugin(catalogId));

    releaseVersion = "2.0.0";
    const updated = await service.updateCatalog(catalogId);
    assert.equal(updated.ok, true, updated.ok ? undefined : updated.error);
    const updatedRecord = service.stateStore.getRecord(catalogId);
    assert.ok(updatedRecord);
    assert.equal(updatedRecord.version, "2.0.0");
    assert.equal(updatedRecord.enabled, true);
    assert.deepEqual(updatedRecord.config, records[0].config);
    assert.deepEqual(updatedRecord.approvedPermissions, records[0].approvedPermissions);
    assert.deepEqual(updatedRecord.approvedNetworkHosts, records[0].approvedNetworkHosts);
    assert.deepEqual(starts.at(-1)?.stored, { owner: catalogId, count: 17 });
    assert.equal(starts.at(-1)?.record.version, "2.0.0");
    assert.equal(prompts, 0);

    const manifestPath = updatedRecord.manifestPath;
    const entryPath = join(updatedRecord.installPath, "index.js");
    const beforeManifest = readFileSync(manifestPath);
    const beforeEntry = readFileSync(entryPath);
    releaseVersion = "3.0.0";
    const canceled = await service.updateCatalog(catalogId);
    assert.equal(canceled.ok, true);
    assert.equal(prompts, 1);
    assert.deepEqual(service.stateStore.getRecord(catalogId), updatedRecord);
    assert.deepEqual(readFileSync(manifestPath), beforeManifest);
    assert.deepEqual(readFileSync(entryPath), beforeEntry);
    for (const record of records) {
      assert.deepEqual(JSON.parse(readFileSync(join(userDataPath, "plugin-storage", `${record.id}.json`), "utf8")), { saved: { owner: record.id, count: 17 } });
    }
    for (const [index, name] of sentinels.entries()) assert.deepEqual(readFileSync(join(userDataPath, name)), sentinelBytes[index]);
    console.log(`upgrade profile: ${outage}; startup and update preserved installed data`);
  } finally {
    await service.stop();
    rmSync(userDataPath, { recursive: true, force: true });
  }
}

function makeRecord(userDataPath: string, id: string, source: "catalog" | "local", enabled: boolean): PluginStateRecord {
  const installPath = join(userDataPath, source === "local" ? "plugins-dev" : "plugins", id);
  return {
    id, version: "1.0.0", source, installPath, manifestPath: join(installPath, "openpets.plugin.json"),
    ...(source === "local" ? { sourcePath: join(userDataPath, "developer-source", id) } : {}),
    manifestVersion: 3, runtime: "javascript", sdkVersion: "3.0.0", enabled,
    approvedPermissions: ["storage", "network"], approvedNetworkHosts: ["api.example.com"],
    config: { message: `custom ${id}` },
  };
}

function writePackageAndStorage(userDataPath: string, record: PluginStateRecord): void {
  mkdirSync(record.installPath, { recursive: true });
  writeFileSync(record.manifestPath, JSON.stringify({
    manifestVersion: 3, id: record.id, name: record.id, version: record.version,
    runtime: "javascript", sdkVersion: "3.0.0", entry: "index.js", permissions: record.approvedPermissions,
    network: { hosts: record.approvedNetworkHosts }, configSchema: { message: { type: "text", default: "default" } },
  }));
  writeFileSync(join(record.installPath, "index.js"), "OpenPetsPlugin.register({ start() {} });\n");
  const storageRoot = join(userDataPath, "plugin-storage");
  mkdirSync(storageRoot, { recursive: true });
  writeFileSync(join(storageRoot, `${record.id}.json`), JSON.stringify({ saved: { owner: record.id, count: 17 } }));
}
