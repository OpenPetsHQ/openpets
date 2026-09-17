#!/usr/bin/env node
/**
 * Reusable npm exact-version availability probe for release tooling.
 *
 * Packaged Desktop emits exact npm specs (OpenCode/OpenClaw plugin entries),
 * so a desktop release must never ship while those exact versions are
 * unpublished. This module distinguishes three outcomes and never treats a
 * registry/network/timeout failure as "package missing":
 *
 * - "published"      exact package@version exists on npm;
 * - "missing"        npm confirms E404 for that exact version;
 * - "registry-error" the registry could not be checked (network, timeout,
 *                    spawn failure, or an unrecognized npm response).
 *
 * The registry URL is explicit and every probe is timeout-bounded.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const NPM_REGISTRY_URL = "https://registry.npmjs.org";
export const NPM_PROBE_TIMEOUT_MS = 30_000;

/**
 * npm-backed integrations whose exact specs packaged Desktop can emit.
 * Versions are read from these workspace manifests at gate time.
 */
export const PACKAGED_NPM_INTEGRATIONS = [
  { packageDir: "packages/opencode", name: "@open-pets/opencode" },
  { packageDir: "packages/openclaw", name: "@open-pets/openclaw" },
];

/**
 * Classify one `npm view <name>@<version> version --json` result.
 * Pure function over the completed subprocess result; safe to unit test
 * with fixtures and no network access.
 */
export function classifyNpmViewResult({ name, version, status, stdout, stderr }) {
  if (status === 0) return { outcome: "published", detail: `${name}@${version} exists on npm.` };
  if (status === 1 && isConfirmedMissingVersion({ name, version, stdout })) {
    return { outcome: "missing", detail: `npm reports no match for version ${version}.` };
  }
  const output = `${stderr || ""}\n${stdout || ""}`.trim();
  return {
    outcome: "registry-error",
    detail: `npm view exited with code ${status ?? "unknown"}.${output ? ` Output:\n${output}` : ""}`,
  };
}

function isConfirmedMissingVersion({ name, version, stdout }) {
  let error;
  try {
    ({ error } = JSON.parse(stdout));
  } catch {
    return false;
  }
  const packageVersion = `${name}@${version}`;
  return error?.code === "E404"
    && error.summary === `No match found for version ${version}`
    && typeof error.detail === "string"
    && error.detail.startsWith(`The requested resource '${packageVersion}' could not be found`);
}

/**
 * Synchronously probe one exact version. Used by release stages, which run
 * in a synchronous checkpointed runner. Timeout-bounded via spawnSync.
 */
export function probeNpmExactVersionSync(name, version, options = {}) {
  const registry = options.registry ?? NPM_REGISTRY_URL;
  const timeoutMs = options.timeoutMs ?? NPM_PROBE_TIMEOUT_MS;
  const args = ["view", `${name}@${version}`, "version", "--json", "--registry", registry];
  let result;
  try {
    result = spawnSync("npm", args, { cwd: options.cwd, encoding: "utf8", timeout: timeoutMs });
  } catch (error) {
    return { outcome: "registry-error", detail: `could not start npm probe: ${error.message}` };
  }
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      return { outcome: "registry-error", detail: `timed out after ${timeoutMs / 1_000} seconds` };
    }
    return { outcome: "registry-error", detail: `could not run npm probe: ${result.error.message}` };
  }
  return classifyNpmViewResult({ name, version, status: result.status, stdout: result.stdout, stderr: result.stderr });
}

/**
 * Read the exact npm specs packaged Desktop can emit from workspace
 * package metadata. Versions are never hardcoded here.
 */
export function getPackagedNpmIntegrationSpecs(repoRoot) {
  return PACKAGED_NPM_INTEGRATIONS.map(({ packageDir, name }) => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, packageDir, "package.json"), "utf8"));
    if (!packageJson.name || !packageJson.version) throw new Error(`${packageDir}/package.json must include name and version.`);
    if (packageJson.name !== name) throw new Error(`Expected ${name} in ${packageDir}/package.json. Found: ${packageJson.name}`);
    return { name, version: packageJson.version };
  });
}

/**
 * Verify every exact npm-backed integration spec exists on npm.
 * The probe is injectable: pass a fake `(spec) => ({ outcome, detail })`
 * in tests to avoid live npm access. Throws an actionable error naming
 * each missing or unverifiable spec; returns the checked specs otherwise.
 */
export function verifyPackagedNpmIntegrations({ repoRoot, probe = (spec) => probeNpmExactVersionSync(spec.name, spec.version, { cwd: repoRoot }) } = {}) {
  const specs = getPackagedNpmIntegrationSpecs(repoRoot);
  const missing = [];
  const unverifiable = [];
  for (const spec of specs) {
    const result = probe(spec);
    if (result.outcome === "published") {
      console.log(`npm integration available: ${spec.name}@${spec.version}`);
      continue;
    }
    if (result.outcome === "missing") missing.push(`${spec.name}@${spec.version}`);
    else unverifiable.push(`${spec.name}@${spec.version} (${result.detail})`);
  }
  if (missing.length > 0 || unverifiable.length > 0) {
    const lines = [];
    if (missing.length > 0) {
      lines.push(`Packaged Desktop would emit unavailable npm specs: ${missing.join(", ")}.`);
      lines.push("Run/publish the npm release (pnpm release:npm -- --yes) before continuing with the desktop release.");
    }
    if (unverifiable.length > 0) {
      lines.push(`npm registry check failed (not treated as unpublished): ${unverifiable.join("; ")}.`);
      lines.push("Check npm registry connectivity and retry; the desktop release is blocked until every spec is confirmed.");
    }
    throw new Error(lines.join("\n"));
  }
  return specs;
}
