import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const validator = resolve("web/studio/tools/plugin-validator.cjs");
const publisher = resolve("scripts/marketplace-publish.mjs");
const source = resolve("plugins/official/openpets.calendar-airmail");

async function fixture(t, mutate, sourceDir = source) {
  const root = await mkdtemp(join(tmpdir(), "openpets-marketplace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "plugin");
  await cp(sourceDir, folder, { recursive: true });
  await writeFile(join(folder, "spare.txt"), "extra file");
  if (mutate) await mutate(folder);
  const archive = join(root, "plugin.zip");
  execFileSync("zip", ["-qr", archive, "."], { cwd: folder });
  return archive;
}

function run(path) {
  return spawnSync(process.execPath, [validator, path], { encoding: "utf8" });
}

test("official package with sprites validates and resolves listing metadata", async (t) => {
  execFileSync(process.execPath, [resolve("scripts/build-marketplace-validator.mjs"), "--check"]);
  const result = run(await fixture(t));
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.manifest.id, "openpets.calendar-airmail");
  assert.ok(report.resolvedName && !report.resolvedName.startsWith("$t:"));
  assert.ok(report.resolvedDescription);
  assert.equal(report.validation.valid, true);
  assert.match(report.iconDataUrl, /^data:image\/svg\+xml;base64,/);
});

test("rejects malformed archives and invalid archive paths", async (t) => {
  const archive = await fixture(t);
  const original = await readFile(archive);
  await writeFile(archive, Buffer.from("not a zip"));
  assert.notEqual(run(archive).status, 0);
  const validPath = Buffer.from("spare.txt");
  const badPath = Buffer.from("../BAD.md");
  assert.equal(validPath.length, badPath.length);
  assert.notEqual(original.indexOf(validPath), -1);
  let offset = 0;
  while ((offset = original.indexOf(validPath, offset)) !== -1) {
    badPath.copy(original, offset);
    offset += badPath.length;
  }
  await writeFile(archive, original);
  assert.notEqual(run(archive).status, 0);
});

test("rejects invalid manifests, missing assets, bad sprites and invalid locales", async (t) => {
  const cases = [
    async (dir) => writeFile(join(dir, "openpets.plugin.json"), "{}"),
    async (dir) => rm(join(dir, "assets/calendar.svg")),
    async (dir) => writeFile(join(dir, "assets/couriers/courier-airdog.webp"), "invalid image"),
    async (dir) => writeFile(join(dir, "locales/en.json"), '{"plugin.name": 7}'),
  ];
  for (const mutate of cases) {
    const result = run(await fixture(t, mutate));
    assert.notEqual(result.status, 0, result.stdout);
    assert.ok(JSON.parse(result.stderr).error);
  }
});

test("catalog projection accepts network hosts with network permission and rejects inconsistent declarations", async (t) => {
  assert.equal(run(await fixture(t)).status, 0);
  for (const change of [
    (manifest) => { delete manifest.network; },
    (manifest) => { manifest.permissions = manifest.permissions.filter((permission) => permission !== "network"); },
  ]) {
    const archive = await fixture(t, async (dir) => {
      const path = join(dir, "openpets.plugin.json");
      const manifest = JSON.parse(await readFile(path, "utf8"));
      change(manifest);
      await writeFile(path, JSON.stringify(manifest));
    });
    const result = run(archive);
    assert.notEqual(result.status, 0, result.stdout);
    assert.ok(JSON.parse(result.stderr).error);
  }
});

test("every official package validates for marketplace catalog publication", async (t) => {
  const official = resolve("plugins/official");
  const entries = await readdir(official, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory() && item.name.startsWith("openpets."))) {
    const archive = await fixture(t, undefined, join(official, entry.name));
    const result = run(archive);
    assert.equal(result.status, 0, `${entry.name}: ${result.stderr}`);
  }
});

test("publisher submits and imports the validated ID with bearer session and multipart metadata", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "openpets-publish-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const archive = join(dir, "plugin.zip");
  const prepared = spawnSync(process.execPath, [publisher, "prepare", source, archive], { encoding: "utf8" });
  assert.equal(prepared.status, 0, prepared.stderr);
  const metadata = join(dir, "metadata.json");
  await writeFile(metadata, JSON.stringify({ name: "Example", description: "Test", sourceUrl: "https://example.test/source" }));
  let request;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    request = { url: req.url, authorization: req.headers.authorization, contentType: req.headers["content-type"], body: Buffer.concat(chunks).toString("latin1") };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "pending" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function invoke(command) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [publisher, command, archive, "--metadata", metadata], {
        env: { ...process.env, OPENPETS_STUDIO_API_URL: `http://127.0.0.1:${server.address().port}`, OPENPETS_STUDIO_TOKEN: "test-session" },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
  }
  const result = await invoke("submit");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "pending");
  assert.equal(request.url, "/api/marketplace/publisher/plugins/openpets.calendar-airmail/releases");
  assert.equal(request.authorization, "Bearer test-session");
  assert.match(request.contentType, /^multipart\/form-data;/);
  assert.match(request.body, /name="package"/);
  assert.match(request.body, /name="metadata"/);
  const imported = await invoke("import");
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(request.url, "/api/marketplace/admin/import/openpets.calendar-airmail");
  assert.equal(request.authorization, "Bearer test-session");
  assert.match(request.body, /name="package"/);
  assert.match(request.body, /https:\/\/example\.test\/source/);
});

test("publisher rejects an oversized API response", async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("x".repeat(1024 * 1024 + 1));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [publisher, "reserve", "openpets.test"], {
      env: { ...process.env, OPENPETS_STUDIO_API_URL: `http://127.0.0.1:${server.address().port}`, OPENPETS_STUDIO_TOKEN: "test-session" },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr }));
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /response is too large/);
});
