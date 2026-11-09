import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { digest } from './marketplace-migrate.mjs';

const cli = resolve('scripts/marketplace-migrate.mjs');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'marketplace-migrate-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sources = ['openpets.calendar-airmail', 'openpets.day-routine'];
  const entries = [];
  const packages = new Map();
  for (const id of sources) {
    const source = resolve('plugins/official', id);
    const archive = join(dir, `${id}.zip`);
    execFileSync('zip', ['-qr', archive, '.'], { cwd: source });
    const bytes = await readFile(archive);
    const manifest = JSON.parse(await readFile(join(source, 'openpets.plugin.json')));
    packages.set(id, bytes);
    entries.push({ id, version: manifest.version, runtime: manifest.runtime, sdkVersion: manifest.sdkVersion, permissions: manifest.permissions, network: manifest.network, name: id, description: 'Reviewed', sha256: sha(bytes) });
  }
  let posts = [];
  let failId;
  let current = '99.0.0';
  let missing = false;
  let withdrawn = false;
  let incompatible = false;
  const server = createServer(async (req, res) => {
    const id = sources.find((item) => req.url.includes(item));
    const entry = entries.find((item) => item.id === id);
    const snapshot = entry && { name: id, description: 'Reviewed', category: 'Other', tags: [], readme: '', changelog: '', license: '', sourceUrl: null, homepageUrl: null, packageDigest: entry.sha256, manifest: { id, version: entry.version, runtime: entry.runtime, sdkVersion: entry.sdkVersion, permissions: entry.permissions, network: entry.network } };
    const release = entry && { id: `release-${id}`, pluginId: id, version: entry.version, status: withdrawn ? 'withdrawn' : 'approved', sha256: entry.sha256, snapshotDigest: digest(snapshot), runtime: entry.runtime, sdkVersion: entry.sdkVersion, permissions: entry.permissions, network: entry.network, ...(incompatible ? { minOpenPetsVersion: '9.0.0' } : {}) };
    if (req.method === 'POST') {
      for await (const chunk of req) { /* drain */ }
      posts.push(id);
      res.writeHead(id === failId ? 500 : 200);
      return res.end(JSON.stringify({ ...release, snapshot }));
    }
    if (req.url.startsWith('/source/')) return res.end(packages.get(id));
    if (req.url.endsWith('/download')) return res.end(packages.get(id));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id, version: current, releases: missing ? [] : [release] }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const entry of entries) entry.downloadUrl = `${origin}/source/${entry.id}`;
  const catalog = join(dir, 'catalog.json');
  const provenance = join(dir, 'provenance.json');
  const inventoryPath = join(dir, 'inventory.json');
  const frozen = entries.map(({ id, version, sha256 }) => ({ id, version, sha256 }));
  const out = join(dir, 'plan');
  async function writeCatalog() { await writeFile(catalog, JSON.stringify({ plugins: entries })); }
  await writeCatalog();
  async function writeInventory() { await writeFile(inventoryPath, JSON.stringify(frozen)); }
  await writeInventory();
  await writeFile(provenance, '{}');
  async function invoke(...args) {
    return new Promise((done, reject) => {
      const child = spawn(process.execPath, [cli, ...args], { env: { ...process.env, OPENPETS_STUDIO_API_URL: origin, OPENPETS_STUDIO_TOKEN: 'local-test' } });
      let stdout = '', stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (status) => done({ status, stdout, stderr }));
    });
  }
  return { dir, entries, packages, frozen, out, writeCatalog, writeInventory, invoke, plan: () => invoke('plan', '--catalog', catalog, '--provenance', provenance, '--inventory', inventoryPath, '--out', out), path: join(out, 'plan.json'), posts: () => posts, fail: (id) => { failId = id; }, current: (version) => { current = version; }, missing: (value) => { missing = value; }, withdrawn: (value) => { withdrawn = value; }, incompatible: (value) => { incompatible = value; } };
}

test('planning rejects wrong hashes and corrupt packages without writing remotely', async (t) => {
  const f = await setup(t);
  f.entries[0].sha256 = '0'.repeat(64);
  f.frozen[0].sha256 = f.entries[0].sha256;
  await f.writeCatalog();
  await f.writeInventory();
  assert.notEqual((await f.plan()).status, 0);
  const bad = Buffer.from('not a zip');
  f.packages.set(f.entries[0].id, bad);
  f.entries[0].sha256 = sha(bad);
  f.frozen[0].sha256 = f.entries[0].sha256;
  await f.writeCatalog();
  await f.writeInventory();
  assert.notEqual((await f.plan()).status, 0);
  assert.deepEqual(f.posts(), []);
});

test('preflight checks the entire batch before import; check never posts', async (t) => {
  const f = await setup(t);
  let result = await f.plan();
  assert.equal(result.status, 0, result.stderr);
  result = await f.invoke('check', '--plan', f.path);
  assert.equal(result.status, 0, result.stderr);
  await writeFile(join(f.out, `${f.entries[1].id}.zip`), 'corrupt');
  result = await f.invoke('import', '--plan', f.path);
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.posts(), []);
});

test('partial imports report failure and a retry resubmits idempotently', async (t) => {
  const f = await setup(t);
  assert.equal((await f.plan()).status, 0);
  f.fail(f.entries[1].id);
  let result = await f.invoke('import', '--plan', f.path);
  assert.notEqual(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout).results.map((item) => item.status), ['completed', 'failed']);
  f.fail(undefined);
  result = await f.invoke('import', '--plan', f.path);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.posts().length, 4);
  assert.equal(JSON.parse(await readFile(join(f.out, 'import-report.json'))).complete, true);
});

test('verification requires each release and permits newer current versions, never older', async (t) => {
  const f = await setup(t);
  assert.equal((await f.plan()).status, 0);
  assert.equal((await f.invoke('import', '--plan', f.path)).status, 0);
  const count = f.posts().length;
  assert.equal((await f.invoke('verify', '--plan', f.path)).status, 0);
  f.missing(true);
  assert.notEqual((await f.invoke('verify', '--plan', f.path)).status, 0);
  f.missing(false);
  f.current('0.0.1');
  assert.notEqual((await f.invoke('verify', '--plan', f.path)).status, 0);
  assert.equal(f.posts().length, count);
});

test('withdrawn import is recorded but cannot pass initial verification', async (t) => {
  const f = await setup(t);
  assert.equal((await f.plan()).status, 0);
  f.withdrawn(true);
  const result = await f.invoke('import', '--plan', f.path);
  assert.notEqual(result.status, 0);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.results[0].status, 'withdrawn');
  assert.ok(receipt.results[0].releaseId && receipt.results[0].snapshotDigest);
  assert.notEqual((await f.invoke('verify', '--plan', f.path)).status, 0);
});

test('rejects mismatched release compatibility and missing receipts', async (t) => {
  const f = await setup(t);
  assert.equal((await f.plan()).status, 0);
  assert.notEqual((await f.invoke('verify', '--plan', f.path)).status, 0);
  f.incompatible(true);
  assert.notEqual((await f.invoke('import', '--plan', f.path)).status, 0);
  f.incompatible(false);
  assert.equal((await f.invoke('import', '--plan', f.path)).status, 0);
  f.incompatible(true);
  assert.notEqual((await f.invoke('verify', '--plan', f.path)).status, 0);
});

test('replacement requires exact frozen authorization, increased version, and pinned local bytes', async (t) => {
  const f = await setup(t);
  const entry = f.entries[0];
  const frozen = f.frozen[0];
  const bytes = f.packages.get(entry.id);
  const replacementVersion = entry.version;
  entry.version = '1.2.2';
  entry.sha256 = 'a'.repeat(64);
  frozen.version = replacementVersion;
  frozen.sha256 = sha(bytes);
  frozen.packagePath = 'replacement.zip';
  frozen.replacementFor = { version: entry.version, sha256: entry.sha256, reason: 'Owner approved rebuild' };
  await f.writeCatalog();
  const authorization = frozen.replacementFor;
  delete frozen.replacementFor;
  await f.writeInventory();
  assert.notEqual((await f.plan()).status, 0, 'missing replacement authorization must fail');
  frozen.replacementFor = authorization;
  await f.writeInventory();
  assert.notEqual((await f.plan()).status, 0, 'missing local package must fail');
  await writeFile(join(f.dir, 'replacement.zip'), 'bad');
  assert.notEqual((await f.plan()).status, 0, 'wrong local package hash must fail');
  await writeFile(join(f.dir, 'replacement.zip'), bytes);
  frozen.replacementFor.sha256 = 'b'.repeat(64);
  await f.writeInventory();
  assert.notEqual((await f.plan()).status, 0, 'wrong baseline must fail');
  frozen.replacementFor.sha256 = entry.sha256;
  frozen.version = entry.version;
  await f.writeInventory();
  assert.notEqual((await f.plan()).status, 0, 'replacement must increase version');
  frozen.version = replacementVersion;
  f.frozen[1].sha256 = 'c'.repeat(64);
  await f.writeInventory();
  assert.notEqual((await f.plan()).status, 0, 'unreplaced entries must match catalog');
  f.frozen[1].sha256 = f.entries[1].sha256;
  await f.writeInventory();
  const result = await f.plan();
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(await readFile(f.path));
  assert.equal(plan.entries[0].version, replacementVersion);
  assert.equal(plan.entries[0].sha256, sha(bytes));
  assert.deepEqual(plan.entries[0].replacementFor, frozen.replacementFor);
  assert.equal(plan.inventoryDigest, digest(f.frozen));
  assert.equal((await f.invoke('check', '--plan', f.path)).status, 0);
  assert.deepEqual(f.posts(), []);
});
