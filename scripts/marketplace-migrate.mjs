#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const validator = fileURLToPath(new URL('../web/studio/tools/plugin-validator.cjs', import.meta.url));
const defaultInventory = fileURLToPath(new URL('../web/studio/studio/marketplace/original_inventory.json', import.meta.url));
const zipLimit = 16 * 1024 * 1024;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const canonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const digest = (value) => hash(Buffer.from(canonical(value)));
const planDigest = (entries) => digest(entries.map(({ id, version, sha256, minOpenPetsVersion, maxOpenPetsVersion, metadataSha256, provenance, replacementFor }) => ({ id, version, sha256, minOpenPetsVersion, maxOpenPetsVersion, metadataSha256, provenance, replacementFor })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

async function readBounded(path, limit) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error(`Invalid or oversized file: ${path}`);
    const bytes = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset > limit) throw new Error(`Oversized file: ${path}`);
    return bytes.subarray(0, offset);
  } finally { await file.close(); }
}

async function request(url, options = {}, limit = 1024 * 1024) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid HTTP URL');
  const response = await fetch(parsed, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body unavailable');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Response exceeds size limit');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks, size);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${bytes.toString('utf8').slice(0, 1024)}`);
  return bytes;
}

function validatePackage(path, entry) {
  const child = spawnSync(process.execPath, [validator, path], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  if (child.error || child.status !== 0) throw new Error(`Package validation failed: ${child.error?.message || child.stderr}`);
  const manifest = JSON.parse(child.stdout).manifest;
  for (const key of ['id', 'version', 'runtime', 'sdkVersion']) {
    if (manifest[key] !== entry[key]) throw new Error(`Catalog/package ${key} mismatch`);
  }
  const sorted = (values) => JSON.stringify([...values].sort());
  if (!Array.isArray(entry.permissions) || sorted(manifest.permissions || []) !== sorted(entry.permissions)) throw new Error('Catalog/package permissions mismatch');
  if (sorted(manifest.network?.hosts || []) !== sorted(entry.network?.hosts || [])) throw new Error('Catalog/package network hosts mismatch');
  return manifest;
}

function inventory(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 64) throw new Error('Invalid catalog inventory (maximum 64 plugins)');
  const ids = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(entry.id) || ids.has(entry.id)) throw new Error(`Invalid or duplicate plugin ID: ${entry?.id}`);
    ids.add(entry.id);
    if (!semver.test(entry.version) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`${entry.id}: invalid version or SHA-256`);
    let url;
    try { url = new URL(entry.downloadUrl); } catch { throw new Error(`${entry.id}: invalid download URL`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`${entry.id}: invalid download URL`);
    for (const key of ['minOpenPetsVersion', 'maxOpenPetsVersion']) {
      if (entry[key] !== undefined && !semver.test(entry[key])) throw new Error(`${entry.id}: invalid ${key}`);
    }
    if (typeof entry.name !== 'string' || !entry.name.trim() || typeof entry.description !== 'string') throw new Error(`${entry.id}: invalid listing`);
  }
}

function validateMetadata(metadata, entry) {
  const limits = { name: 120, description: 1000, category: 80, readme: 50000, changelog: 10000, license: 120 };
  const allowed = new Set([...Object.keys(limits), 'tags', 'sourceUrl', 'homepageUrl', 'minOpenPetsVersion', 'maxOpenPetsVersion']);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || Object.keys(metadata).some((key) => !allowed.has(key))) throw new Error('Invalid metadata fields');
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof metadata[key] !== 'string' || metadata[key].length > limit || (['name', 'category'].includes(key) && !metadata[key].trim())) throw new Error(`Invalid metadata ${key}`);
  }
  if (!Array.isArray(metadata.tags) || metadata.tags.length > 20 || metadata.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 40)) throw new Error('Invalid metadata tags');
  for (const key of ['sourceUrl', 'homepageUrl']) {
    if (metadata[key] == null || metadata[key] === '') continue;
    let url;
    try { url = new URL(metadata[key]); } catch { throw new Error(`Invalid metadata ${key}`); }
    if (metadata[key].length > 2048 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`Invalid metadata ${key}`);
  }
  for (const key of ['minOpenPetsVersion', 'maxOpenPetsVersion']) {
    if (metadata[key] !== entry[key]) throw new Error(`Metadata ${key} differs from reviewed catalog`);
  }
  if (metadata.minOpenPetsVersion && metadata.maxOpenPetsVersion && !versionAtLeast(metadata.maxOpenPetsVersion, metadata.minOpenPetsVersion)) throw new Error('Invalid compatibility range');
  if (metadata.name !== entry.name || metadata.description !== entry.description) throw new Error('Metadata listing differs from reviewed catalog');
}

async function plan(opts) {
  const catalog = JSON.parse((await readBounded(opts.catalog, 16 * 1024 * 1024)).toString());
  const provenance = JSON.parse((await readBounded(opts.provenance, 1024 * 1024)).toString());
  const inventoryPath = resolve(opts.inventory || defaultInventory);
  const frozen = JSON.parse((await readBounded(inventoryPath, 1024 * 1024)).toString());
  inventory(catalog.plugins);
  const selected = selectInventory(catalog.plugins, frozen);
  const target = resolve(opts.out);
  await mkdir(dirname(target), { recursive: true });
  try {
    await lstat(target);
    throw new Error(`Output already exists: ${target}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temp = await mkdtemp(join(dirname(target), '.marketplace-migration-'));
  try {
    const entries = [];
    const failures = [];
    for (const entry of selected) {
      try {
        const source = frozen.find((item) => item.id === entry.id);
        const bytes = source.packagePath
          ? await readBounded(await safePath(dirname(inventoryPath), source.packagePath), zipLimit)
          : await request(entry.downloadUrl, {}, zipLimit);
        const actualHash = hash(bytes);
        if (actualHash !== entry.sha256) throw new Error(`SHA-256 mismatch (expected ${entry.sha256}, received ${actualHash}); retrieve the original reviewed ZIP`);
        const packagePath = `${entry.id}.zip`;
        await writeFile(join(temp, packagePath), bytes);
        const manifest = validatePackage(join(temp, packagePath), entry);
        const metadata = {
          name: entry.name, description: entry.description,
          category: entry.category || manifest.category || 'Other', tags: [], readme: '', changelog: '', license: '',
          ...(provenance[entry.id]?.sourceUrl ? { sourceUrl: provenance[entry.id].sourceUrl } : {}),
          ...(entry.minOpenPetsVersion ? { minOpenPetsVersion: entry.minOpenPetsVersion } : {}),
          ...(entry.maxOpenPetsVersion ? { maxOpenPetsVersion: entry.maxOpenPetsVersion } : {}),
        };
        validateMetadata(metadata, entry);
        const metadataPath = `${entry.id}.json`;
        const metadataBytes = Buffer.from(json(metadata));
        await writeFile(join(temp, metadataPath), metadataBytes);
        entries.push({ ...entry, packagePath, metadataPath, metadataSha256: hash(metadataBytes), provenance: provenance[entry.id] || null });
      } catch (error) { failures.push(`${entry.id}: ${error.message}`); }
    }
    if (failures.length) throw new Error(`Planning failed:\n${failures.join('\n')}`);
    await writeFile(join(temp, 'plan.json'), json({ version: 3, inventoryDigest: digest(frozen), planDigest: planDigest(entries), frozenInventory: frozen, entries }));
    await rename(temp, target);
    return { plan: join(target, 'plan.json'), count: entries.length };
  } finally { await rm(temp, { recursive: true, force: true }); }
}

function selectInventory(catalog, frozen) {
  if (!Array.isArray(frozen) || frozen.length !== catalog.length) throw new Error('Frozen inventory does not match catalog inventory');
  const byId = new Map();
  for (const item of frozen) {
    if (!item || typeof item.id !== 'string' || byId.has(item.id) || !semver.test(item.version) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid or duplicate frozen inventory entry');
    byId.set(item.id, item);
  }
  return catalog.map((entry) => {
    const item = byId.get(entry.id);
    if (!item) throw new Error(`${entry.id}: missing frozen inventory entry`);
    for (const key of ['minOpenPetsVersion', 'maxOpenPetsVersion']) {
      if (item[key] !== entry[key]) throw new Error(`${entry.id}: frozen ${key} differs from catalog`);
    }
    const replacement = item.replacementFor;
    if (replacement || item.packagePath) {
      if (!replacement || typeof replacement !== 'object' || !semver.test(replacement.version) || !/^[a-f0-9]{64}$/.test(replacement.sha256) || typeof replacement.reason !== 'string' || !replacement.reason.trim() || typeof item.packagePath !== 'string' || !item.packagePath) throw new Error(`${entry.id}: invalid replacement authorization`);
      if (replacement.version !== entry.version || replacement.sha256 !== entry.sha256) throw new Error(`${entry.id}: replacement does not match catalog baseline`);
      if (item.version === entry.version || !versionAtLeast(item.version, entry.version)) throw new Error(`${entry.id}: replacement version must increase`);
      return { ...entry, version: item.version, sha256: item.sha256, replacementFor: replacement };
    }
    if (item.version !== entry.version || item.sha256 !== entry.sha256) throw new Error(`${entry.id}: frozen version or SHA-256 differs from catalog`);
    return entry;
  });
}

async function safePath(root, path) {
  if (typeof path !== 'string' || isAbsolute(path) || !path || path.split(/[\\/]/).some((part) => part === '..')) throw new Error('Unsafe plan path');
  const target = await realpath(join(root, path));
  const rel = relative(await realpath(root), target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Plan path escapes plan directory');
  return target;
}

async function preflight(path) {
  const root = dirname(resolve(path));
  const plan = JSON.parse((await readBounded(path, 16 * 1024 * 1024)).toString());
  if (plan.version !== 3 || plan.inventoryDigest !== digest(plan.frozenInventory) || plan.planDigest !== planDigest(plan.entries || [])) throw new Error('Unsupported or modified plan inventory');
  inventory(plan.entries);
  if (!Array.isArray(plan.frozenInventory) || plan.frozenInventory.length !== plan.entries.length) throw new Error('Plan frozen inventory mismatch');
  const frozenById = new Map(plan.frozenInventory.map((item) => [item.id, item]));
  if (frozenById.size !== plan.entries.length) throw new Error('Duplicate frozen inventory ID');
  for (const entry of plan.entries) {
    const item = frozenById.get(entry.id);
    if (!item || ['version', 'sha256', 'minOpenPetsVersion', 'maxOpenPetsVersion'].some((key) => item[key] !== entry[key]) || canonical(item.replacementFor) !== canonical(entry.replacementFor)) throw new Error(`${entry.id}: plan differs from frozen inventory`);
  }
  const prepared = [];
  for (const entry of plan.entries) {
    try {
      const packagePath = await safePath(root, entry.packagePath);
      const bytes = await readBounded(packagePath, zipLimit);
      if (hash(bytes) !== entry.sha256) throw new Error('Package SHA-256 mismatch');
      validatePackage(packagePath, entry);
      const metadata = await readBounded(await safePath(root, entry.metadataPath), 1024 * 1024);
      if (hash(metadata) !== entry.metadataSha256) throw new Error('Metadata SHA-256 mismatch');
      const listing = JSON.parse(metadata.toString());
      validateMetadata(listing, entry);
      prepared.push({ entry, bytes, metadata: metadata.toString() });
    } catch (error) { throw new Error(`${entry.id}: ${error.message}`); }
  }
  return { root, prepared, inventoryDigest: plan.inventoryDigest, planDigest: plan.planDigest };
}

function apiOrigin() {
  if (!process.env.OPENPETS_STUDIO_API_URL) throw new Error('OPENPETS_STUDIO_API_URL is required');
  return process.env.OPENPETS_STUDIO_API_URL;
}
function versionAtLeast(actual, expected) {
  if (!semver.test(actual)) return false;
  const a = actual.split('.').map(BigInt), b = expected.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return true;
}
async function report(root, command, results, inventoryDigest, planDigest) {
  const output = { command, inventoryDigest, planDigest, complete: results.every((item) => item.status === 'completed'), results };
  const file = join(root, `${command}-report.json`);
  const temporary = join(root, `.${command}-report-${process.pid}.tmp`);
  await writeFile(temporary, json(output));
  await rename(temporary, file);
  console.log(json(output));
  if (!output.complete) process.exitCode = 1;
}

async function run(command, path) {
  const { root, prepared, inventoryDigest, planDigest } = await preflight(path);
  if (command === 'check') return { valid: true, count: prepared.length };
  const origin = apiOrigin();
  const token = command === 'import' ? process.env.OPENPETS_STUDIO_TOKEN : undefined;
  if (command === 'import' && !token) throw new Error('OPENPETS_STUDIO_TOKEN is required for import');
  const results = [];
  let receipts;
  if (command === 'verify') {
    receipts = JSON.parse((await readBounded(join(root, 'import-report.json'), 1024 * 1024)).toString());
    if (receipts.inventoryDigest !== inventoryDigest || receipts.planDigest !== planDigest) throw new Error('Import receipt does not match plan inventory');
  }
  for (const { entry, bytes, metadata } of prepared) {
    const attribution = { provenance: entry.provenance, ...(entry.replacementFor ? { replacementFor: entry.replacementFor } : {}) };
    try {
      const base = `/api/marketplace/plugins/${encodeURIComponent(entry.id)}`;
      if (command === 'import') {
        const form = new FormData();
        form.append('package', new Blob([bytes], { type: 'application/zip' }), basename(entry.packagePath));
        form.append('metadata', metadata);
        const response = JSON.parse((await request(new URL(`/api/marketplace/admin/import/${encodeURIComponent(entry.id)}`, origin), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })).toString());
        checkRelease(response, entry);
        if (!response.snapshot) throw new Error('Missing private snapshot');
        if (response.snapshot.packageDigest !== entry.sha256 || !response.snapshot.manifest) throw new Error('Private snapshot package mismatch');
        for (const key of ['id', 'version', 'runtime', 'sdkVersion']) {
          if (response.snapshot.manifest[key] !== entry[key]) throw new Error(`Private snapshot manifest ${key} mismatch`);
        }
        for (const key of ['minOpenPetsVersion', 'maxOpenPetsVersion']) {
          const effective = response.snapshot.legacyCompatibility?.[key] ?? response.snapshot.manifest[key] ?? null;
          if (effective !== (entry[key] ?? null)) throw new Error(`Private snapshot ${key} mismatch`);
        }
        const sorted = (values) => JSON.stringify([...(values || [])].sort());
        if (sorted(response.snapshot.manifest.permissions) !== sorted(entry.permissions) || sorted(response.snapshot.manifest.network?.hosts) !== sorted(entry.network?.hosts)) throw new Error('Private snapshot permissions or hosts mismatch');
        const listing = JSON.parse(metadata);
        for (const key of ['name', 'description', 'category', 'tags', 'readme', 'changelog', 'license', 'sourceUrl', 'homepageUrl']) {
          if (canonical(response.snapshot[key] ?? (key.endsWith('Url') ? null : undefined)) !== canonical(listing[key] ?? (key.endsWith('Url') ? null : undefined))) throw new Error(`Private snapshot ${key} mismatch`);
        }
        if (!['approved', 'withdrawn'].includes(response.status)) throw new Error(`Import returned unexpected status: ${response.status}`);
        const status = response.status === 'approved' ? 'completed' : 'withdrawn';
        results.push({ id: entry.id, version: entry.version, status, ...attribution, releaseId: response.id, snapshotDigest: response.snapshotDigest });
        continue;
      } else {
        const detail = JSON.parse((await request(new URL(base, origin))).toString());
        const release = detail.releases?.find((item) => item.version === entry.version && item.status === 'approved');
        if (detail.id !== entry.id || !release || !versionAtLeast(detail.version, entry.version)) throw new Error('Missing approved release or current version is older');
        checkRelease(release, entry);
        const receipt = receipts.results?.find((item) => item.id === entry.id && item.version === entry.version);
        if (!receipt || receipt.status !== 'completed' || receipt.releaseId !== release.id || receipt.snapshotDigest !== release.snapshotDigest) throw new Error('Missing or mismatched immutable import receipt');
        if (detail.version === entry.version) {
          const listing = JSON.parse(metadata);
          for (const key of ['name', 'description', 'category', 'tags', 'readme', 'changelog', 'license', 'sourceUrl', 'homepageUrl']) {
            if (canonical(detail[key] ?? (key.endsWith('Url') ? null : undefined)) !== canonical(listing[key] ?? (key.endsWith('Url') ? null : undefined))) throw new Error(`Public listing ${key} mismatch`);
          }
        }
        const downloaded = await request(new URL(`${base}/releases/${encodeURIComponent(entry.version)}/download`, origin), {}, zipLimit);
        if (hash(downloaded) !== entry.sha256 || !downloaded.equals(bytes)) throw new Error('Downloaded package differs from original');
      }
      results.push({ id: entry.id, version: entry.version, status: 'completed', ...attribution });
    } catch (error) {
      const message = token ? error.message.replaceAll(token, '[redacted]') : error.message;
      results.push({ id: entry.id, version: entry.version, status: 'failed', ...attribution, error: message });
    }
  }
  await report(root, command, results, inventoryDigest, planDigest);
}

function checkRelease(release, entry) {
  if (release.pluginId !== entry.id || release.version !== entry.version || release.sha256 !== entry.sha256 || typeof release.id !== 'string' || !release.id || !/^[a-f0-9]{64}$/.test(release.snapshotDigest || '')) throw new Error('Release identity or snapshot digest mismatch');
  for (const key of ['runtime', 'sdkVersion', 'minOpenPetsVersion', 'maxOpenPetsVersion']) {
    if ((release[key] ?? null) !== (entry[key] ?? null)) throw new Error(`Release ${key} mismatch`);
  }
  const sorted = (v) => JSON.stringify([...(v || [])].sort());
  if (sorted(release.permissions) !== sorted(entry.permissions) || sorted(release.network?.hosts) !== sorted(entry.network?.hosts)) throw new Error('Release permissions or hosts mismatch');
}

async function main(args) {
  const command = args.shift();
  const opts = {};
  while (args.length) {
    const key = args.shift();
    const value = args.shift();
    if (!key?.startsWith('--') || !value || value.startsWith('--') || opts[key.slice(2)]) throw new Error('Invalid or repeated option');
    opts[key.slice(2)] = value;
  }
  const allowed = command === 'plan' ? ['catalog', 'provenance', 'out', 'inventory'] : ['plan'];
  const required = command === 'plan' ? ['catalog', 'provenance', 'out'] : ['plan'];
  if (!['plan', 'check', 'import', 'verify'].includes(command) || required.some((key) => !opts[key]) || Object.keys(opts).some((key) => !allowed.includes(key))) throw new Error('Usage: marketplace:migrate plan --catalog <file> --provenance <file> --out <new-dir> [--inventory <file>] | check|import|verify --plan <plan.json>');
  return command === 'plan' ? plan(opts) : run(command, opts.plan);
}
export { canonical, digest, preflight, request, run as runMigration, versionAtLeast, zipLimit };
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((result) => { if (result) console.log(json(result)); }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
