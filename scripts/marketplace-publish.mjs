#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, open, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const validator = fileURLToPath(new URL("../web/studio/tools/plugin-validator.cjs", import.meta.url));
const usage = `Usage:
  node scripts/marketplace-publish.mjs prepare <plugin-directory> <output.zip>
  node scripts/marketplace-publish.mjs validate <package.zip>
  node scripts/marketplace-publish.mjs reserve <plugin-id>
  node scripts/marketplace-publish.mjs submit <package.zip> --metadata <metadata.json> [--icon <image>] [--screenshot <image> ...]
  node scripts/marketplace-publish.mjs import <package.zip> --metadata <metadata.json> [--icon <image>] [--screenshot <image> ...]
Set OPENPETS_STUDIO_API_URL and OPENPETS_STUDIO_TOKEN for reserve/submit/import.
For catalog migration, run import once per original ZIP and matching metadata; do not repackage the ZIPs.`;

function validate(path) {
  const child = spawnSync(process.execPath, [validator, path], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 30_000 });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(child.stderr.trim() || "Package validation failed.");
  return JSON.parse(child.stdout);
}

async function prepare(source, destination) {
  const temp = await mkdtemp(join(tmpdir(), "openpets-package-"));
  try {
    const archive = join(temp, "plugin.zip");
    const zip = spawnSync("zip", ["-qry", archive, ".", "-x", ".git/*", "*/.git/*", "node_modules/*", "*/node_modules/*"], {
      cwd: resolve(source), encoding: "utf8", timeout: 60_000,
    });
    if (zip.error) throw zip.error;
    if (zip.status !== 0) throw new Error(zip.stderr || zip.stdout || "zip failed.");
    const result = validate(archive);
    // Copy via a temporary sibling so promotion is atomic even across filesystems.
    const target = resolve(destination);
    const siblingDir = await mkdtemp(join(dirname(target), ".openpets-package-"));
    const sibling = join(siblingDir, "package.zip");
    try {
      await copyFile(archive, sibling);
      await rename(sibling, target);
    } finally {
      await rm(siblingDir, { recursive: true, force: true });
    }
    return result;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function options(args) {
  const result = { screenshots: [] };
  while (args.length) {
    const key = args.shift();
    const value = args.shift();
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}.`);
    if (key === "--screenshot") result.screenshots.push(value);
    else if (key === "--metadata" && !result.metadata) result.metadata = value;
    else if (key === "--icon" && !result.icon) result.icon = value;
    else throw new Error(`Unknown or repeated option: ${key}`);
  }
  if (!result.metadata) throw new Error("--metadata is required.");
  return result;
}

async function api(path, body, isJson = false) {
  const base = process.env.OPENPETS_STUDIO_API_URL;
  const token = process.env.OPENPETS_STUDIO_TOKEN;
  if (!base || !token) throw new Error("OPENPETS_STUDIO_API_URL and OPENPETS_STUDIO_TOKEN are required.");
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
  const headers = { Authorization: `Bearer ${token}` };
  if (isJson) headers["Content-Type"] = "application/json";
  const response = await fetch(url, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(30_000) });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Studio API response body is unavailable.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new Error("Studio API response is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const text = Buffer.concat(chunks, size).toString("utf8");
  if (!response.ok) throw new Error(`Studio API HTTP ${response.status}: ${text.slice(0, 4096)}`);
  return JSON.parse(text);
}

async function readBounded(path, maxBytes) {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error(`File is invalid or too large: ${path}`);
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new Error(`File is too large: ${path}`);
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

async function attach(form, field, path, type) {
  const bytes = await readBounded(path, 16 * 1024 * 1024);
  form.append(field, new Blob([bytes], { type }), basename(path));
}

function imageType(path) {
  const types = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
  const type = types[extname(path).toLowerCase()];
  if (!type) throw new Error(`Unsupported image extension: ${path}`);
  return type;
}

async function main(args) {
  const [command, first, ...rest] = args;
  if (command === "validate" && first && rest.length === 0) return validate(resolve(first));
  if (command === "prepare" && first && rest.length === 1) return prepare(first, rest[0]);
  if (command === "reserve" && first && rest.length === 0) {
    return api("/api/marketplace/publisher/plugins", JSON.stringify({ id: first }), true);
  }
  if ((command === "submit" || command === "import") && first) {
    const opts = options(rest);
    const report = validate(resolve(first));
    const metadata = JSON.parse((await readBounded(opts.metadata, 1024 * 1024)).toString("utf8"));
    const form = new FormData();
    await attach(form, "package", first, "application/zip");
    form.append("metadata", JSON.stringify(metadata));
    if (opts.icon) await attach(form, "icon", opts.icon, imageType(opts.icon));
    for (const screenshot of opts.screenshots) await attach(form, "screenshots", screenshot, imageType(screenshot));
    const id = encodeURIComponent(report.manifest.id);
    const path = command === "import"
      ? `/api/marketplace/admin/import/${id}`
      : `/api/marketplace/publisher/plugins/${id}/releases`;
    return api(path, form);
  }
  throw new Error(usage);
}

main(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result))).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
