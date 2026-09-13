import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findTeamEnrollmentLink, parseTeamEnrollmentLink, validateTeamPack, type TeamPack } from "../src/team-protocol.js";
import { reconcileTeamPack, resolveTeamPluginPolicy } from "../src/team-reconciler.js";
import { TeamStateStore } from "../src/team-state.js";
import { TeamApiClient } from "../src/team-api-client.js";

const item = (overrides: Record<string, unknown> = {}) => ({ id: "team-pet", type: "pet", name: "Team Pet", versionId: "version-1", version: "1.0.0", sha256: "a".repeat(64), size: 12, itemId: "team-pet", releaseId: "release-1", ...overrides });

test("Teams enrollment links accept only the exact deep-link contract", () => {
  assert.deepEqual(parseTeamEnrollmentLink("openpets://teams/enroll?intent=abc_123"), { intentId: "abc_123" });
  assert.equal(parseTeamEnrollmentLink("https://teams/enroll?intent=abc"), null);
  assert.equal(parseTeamEnrollmentLink("openpets://teams/enroll?intent=abc&token=secret"), null);
  assert.equal(parseTeamEnrollmentLink("openpets://teams/enroll?intent=../bad"), null);
  assert.deepEqual(findTeamEnrollmentLink(["--x", "openpets://teams/enroll?intent=good"]), { intentId: "good" });
});

test("Team Pack validation rejects malformed server payloads and bounds configuration", () => {
  assert.throws(() => validateTeamPack({ version: 1, revision: 1, items: [{ ...item(), sha256: "bad" }] }));
  assert.throws(() => validateTeamPack({ version: 1, revision: 1, items: [{ ...item(), extra: true }] }));
  assert.throws(() => validateTeamPack({ version: 1, revision: 1, items: [{ ...item(), config: { huge: "x".repeat(129 * 1024) } }] }));
  assert.deepEqual(validateTeamPack({ version: 1, revision: 4, items: [item()] }).revision, 4);
});

test("reconciliation stages before applying and does not remove personal collisions", async () => {
  const pack = validateTeamPack({ version: 1, revision: 2, items: [item()] });
  const calls: string[] = [];
  const result = await reconcileTeamPack(pack, [{ type: "pet", id: "team-pet", source: "personal", organizationId: "personal", itemId: "team-pet", artifactVersionId: "old", releaseId: "old", version: "1.0.0" }], { stage: async () => { calls.push("stage"); return true; }, apply: async () => { calls.push("apply"); }, remove: async () => { calls.push("remove"); } });
  assert.equal(result.applied, false);
  assert.deepEqual(calls, []);
});

test("reconciliation updates optional state, removes Team items, and preserves staged rollback on failure", async () => {
  const pack = validateTeamPack({ version: 1, revision: 2, items: [item({ versionId: "version-2" })] });
  const calls: string[] = [];
  const success = await reconcileTeamPack(pack, [{ type: "pet", id: "old-pet", source: "team", organizationId: "org", itemId: "old-pet", artifactVersionId: "old", releaseId: "old", version: "1.0.0" }], { stage: async (next) => { calls.push(`stage:${next.id}`); return next.id; }, apply: async (_next, staged) => { calls.push(`apply:${staged}`); }, remove: async (old) => { calls.push(`remove:${old.id}`); } });
  assert.equal(success.applied, true);
  assert.deepEqual(calls, ["stage:team-pet", "apply:team-pet", "remove:old-pet"]);

  const failed = await reconcileTeamPack(pack, [], { stage: async () => { throw new Error("download failed"); }, apply: async () => { calls.push("bad-apply"); }, remove: async () => undefined });
  assert.equal(failed.applied, false);
  assert.equal(calls.includes("bad-apply"), false);
});

test("Team state stores only nonsecret metadata atomically and enforces one organization", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-team-test-"));
  try {
    const store = new TeamStateStore({ userDataPath: root });
    const first = store.enroll({ organizationId: "org-one", organizationName: "One" });
    assert.match(first.installationId, /^desktop-/);
    assert.throws(() => store.enroll({ organizationId: "org-two" }));
    const raw = await readFile(store.statePath, "utf8");
    assert.equal(raw.includes("credential"), false);
    store.leave();
    const installationId = store.installationId;
    assert.equal(store.enroll({ organizationId: "org-two" }).installationId, installationId);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Teams API client pins requests to the configured origin and validates pack responses", async () => {
  let seenAuthorization = "";
  let seenUrl = "";
  const client = new TeamApiClient({ baseUrl: "https://teams.example.test/", fetchImpl: async (url, init) => {
    seenUrl = String(url);
    seenAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
    return new Response(JSON.stringify({ version: 1, revision: 3, items: [] }), { status: 200, headers: { ETag: '"pack-3"' } });
  } });
  const result = await client.getTeamPack("secret-is-not-logged");
  assert.equal(result.pack.revision, 3);
  assert.equal(seenUrl, "https://teams.example.test/v1/device/team-pack");
  assert.equal(seenAuthorization, "Bearer secret-is-not-logged");
  assert.throws(() => new TeamApiClient({ baseUrl: "http://insecure.example.test" }));
});

test("required and optional Team plugin policy never bypasses permission approval", () => {
  assert.deepEqual(resolveTeamPluginPolicy("required", false, [], []), { enabled: true, permissionBlocked: false });
  assert.deepEqual(resolveTeamPluginPolicy("required", false, ["network"], []), { enabled: false, permissionBlocked: true });
  assert.deepEqual(resolveTeamPluginPolicy("optional", undefined, [], []), { enabled: false, permissionBlocked: false });
  assert.deepEqual(resolveTeamPluginPolicy("optional", true, [], []), { enabled: true, permissionBlocked: false });
});
