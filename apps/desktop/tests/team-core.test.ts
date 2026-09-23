import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  findTeamEnrollmentLink,
  parseTeamEnrollmentLink,
  validateTeamPack,
  type TeamPack,
} from "../src/team-protocol.js";
import {
  reconcileTeamPack,
  resolveTeamPluginPolicy,
  TeamOperationQueue,
} from "../src/team-reconciler.js";
import { PluginStateStore } from "../src/plugin-state.js";
import { TeamStateStore } from "../src/team-state.js";
import { TeamApiClient, TeamApiError } from "../src/team-api-client.js";
import {
  activateTeamArtifact,
  removeTeamArtifact,
} from "../src/team-package.js";
import {
  isEnrollmentActionable,
  isTeamsSnapshot,
  validateDisplayName,
} from "../src/renderer/src/teams/teams-state.js";
import { TeamService, type TeamServiceOptions } from "../src/team-service.js";
import type { OpenPetsStateV1 } from "../src/app-state.js";
import type { SecureCredentialStore } from "../src/team-state.js";

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "team-pet",
  type: "pet",
  name: "Team Pet",
  versionId: "version-1",
  version: "1.0.0",
  sha256: "a".repeat(64),
  size: 12,
  itemId: "team-pet",
  releaseId: "release-1",
  ...overrides,
});

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
  assert.throws(() => validateTeamPack({
    version: 1,
    revision: 1,
    items: [{
      ...item(),
      config: { huge: "x".repeat(129 * 1024) },
    }],
  }));
  assert.deepEqual(validateTeamPack({ version: 1, revision: 4, items: [item()] }).revision, 4);
});

test("reconciliation stages before applying and does not remove personal collisions", async () => {
  const pack = validateTeamPack({ version: 1, revision: 2, items: [item()] });
  const calls: string[] = [];
  const result = await reconcileTeamPack(
    pack,
    [{
      type: "pet",
      id: "team-pet",
      source: "personal",
      organizationId: "personal",
      itemId: "team-pet",
      artifactVersionId: "old",
      releaseId: "old",
      version: "1.0.0",
    }],
    {
      stage: async () => {
        calls.push("stage");
        return true;
      },
      apply: async () => {
        calls.push("apply");
      },
      remove: async () => {
        calls.push("remove");
      },
    },
  );
  assert.equal(result.applied, false);
  assert.deepEqual(calls, []);
});

test("reconciliation updates optional state, removes Team items, and preserves staged rollback on failure", async () => {
  const pack = validateTeamPack({ version: 1, revision: 2, items: [item({ versionId: "version-2" })] });
  const calls: string[] = [];
  const success = await reconcileTeamPack(
    pack,
    [{
      type: "pet",
      id: "old-pet",
      source: "team",
      organizationId: "org",
      itemId: "old-pet",
      artifactVersionId: "old",
      releaseId: "old",
      version: "1.0.0",
    }],
    {
      stage: async (next) => {
        calls.push(`stage:${next.id}`);
        return next.id;
      },
      apply: async (_next, staged) => {
        calls.push(`apply:${staged}`);
      },
      remove: async (old) => {
        calls.push(`remove:${old.id}`);
      },
    },
  );
  assert.equal(success.applied, true);
  assert.deepEqual(calls, ["stage:team-pet", "apply:team-pet", "remove:old-pet"]);

  const failed = await reconcileTeamPack(pack, [], {
    stage: async () => {
      throw new Error("download failed");
    },
    apply: async () => {
      calls.push("bad-apply");
    },
    remove: async () => undefined,
  });
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Teams API client pins requests to the configured origin and validates pack responses", async () => {
  let seenAuthorization = "";
  let seenUrl = "";
  const client = new TeamApiClient({
    baseUrl: "https://teams.example.test/",
    fetchImpl: async (url, init) => {
      seenUrl = String(url);
      seenAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
      return new Response(
        JSON.stringify({ version: 1, revision: 3, items: [] }),
        { status: 200, headers: { ETag: '"pack-3"' } },
      );
    },
  });
  const result = await client.getTeamPack("secret-is-not-logged");
  assert.equal(result.pack.revision, 3);
  assert.equal(seenUrl, "https://teams.example.test/v1/device/team-pack");
  assert.equal(seenAuthorization, "Bearer secret-is-not-logged");
  assert.throws(() => new TeamApiClient({ baseUrl: "http://insecure.example.test" }));
});

test("Teams artifact downloads mint the capability with POST, as the API route requires", async () => {
  const bytes = new TextEncoder().encode("team artifact bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const requests: string[] = [];
  const client = new TeamApiClient({
    baseUrl: "https://teams.example.test/",
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname;
      requests.push(`${init?.method ?? "GET"} ${path}`);
      if (path.endsWith("/capability")) {
        if (init?.method !== "POST") return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
        return new Response(JSON.stringify({ capability: "signed-capability" }), { status: 200 });
      }
      return new Response(bytes, { status: 200 });
    },
  });
  const downloaded = await client.downloadArtifact("device-credential", "version-1", bytes.length, sha256);
  assert.equal(Buffer.from(downloaded).toString(), "team artifact bytes");
  assert.deepEqual(requests, [
    "POST /v1/device/artifacts/version-1/capability",
    "GET /v1/device/artifacts/version-1",
  ]);
});

test("Teams enrollment previews identity and completes in one desktop request", async () => {
  const requestBodies: Record<string, Record<string, unknown>> = {};
  const expiresAt = new Date(Date.now() + 3_000).toISOString();
  const requestedProof = "desktop-proof";
  const client = new TeamApiClient({
    baseUrl: "https://teams.example.test/",
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requestBodies[path] = body;
       if (path.endsWith("/preview")) {
         return new Response(
          JSON.stringify({
            intentId: "intent-1",
            status: "started",
            organization: { id: "org-1", name: "Acme" },
            expiresAt,
          }),
          { status: 200 },
        );
      }
      if (path.endsWith("/complete")) {
        if (body.desktopProof !== requestedProof) {
          return new Response(
            JSON.stringify({ error: "invalid proof" }),
            { status: 401 },
          );
        }
        return new Response(
          JSON.stringify({
            deviceId: "device-1",
            organization: { id: "org-1", name: "Acme" },
            deviceCredential: "credential_" + "a".repeat(32),
            packRevision: 4,
          }),
          { status: 201 },
        );
      }
      throw new Error(`Unexpected enrollment URL: ${path}`);
    },
  });

    const preview = await client.getEnrollmentPreview("intent-1");
    assert.equal(preview.organization.name, "Acme");
    assert.equal(preview.displayName, undefined);
   assert.deepEqual(
     requestBodies["/v1/enrollment/intents/intent-1/preview"],
     {},
   );
   assert.equal("browserToken" in requestBodies["/v1/enrollment/intents/intent-1/preview"], false);
  await assert.rejects(() => client.completeEnrollment("intent-1", "wrong-proof", "desktop-installation", "Alice desktop", expiresAt), /HTTP 401/);

  const enrollment = await client.completeEnrollment("intent-1", "desktop-proof", "desktop-installation", "Alice desktop", expiresAt);
  assert.equal(enrollment.deviceId, "device-1");
  assert.equal(
    requestBodies["/v1/enrollment/intents/intent-1/complete"].desktopProof,
    "desktop-proof",
  );
  const replay = await client.completeEnrollment("intent-1", "desktop-proof", "desktop-installation", "Alice desktop", expiresAt);
  assert.equal(replay.deviceId, enrollment.deviceId);
  assert.equal(replay.deviceCredential, enrollment.deviceCredential);
   assert.equal("browserToken" in requestBodies["/v1/enrollment/intents/intent-1/complete"], false);
   assert.deepEqual(requestBodies["/v1/enrollment/intents/intent-1/complete"], {
     desktopProof: "desktop-proof",
     deviceInstallationId: "desktop-installation",
     displayName: "Alice desktop",
   });
});

test("Teams enrollment preview accepts only exact started, accepted, and completed shapes", async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const statuses = ["started", "accepted", "completed"] as const;
  let index = 0;
  const client = new TeamApiClient({
    baseUrl: "https://teams.example.test/",
    fetchImpl: async () => {
      const status = statuses[index++]!;
      return new Response(JSON.stringify({
        intentId: "intent-1",
        status,
        organization: { id: "org-1", name: "Acme" },
        ...(status === "started" ? {} : { displayName: "Alice desktop" }),
        expiresAt,
      }), { status: 200 });
    },
  });

  assert.equal((await client.getEnrollmentPreview("intent-1")).status, "started");
  assert.equal((await client.getEnrollmentPreview("intent-1")).status, "accepted");
  assert.equal((await client.getEnrollmentPreview("intent-1")).status, "completed");

  const invalidClient = new TeamApiClient({
    baseUrl: "https://teams.example.test/",
    fetchImpl: async () => new Response(JSON.stringify({
      intentId: "intent-1",
      status: "requested",
      organization: { id: "org-1", name: "Acme" },
      expiresAt,
    }), { status: 200 }),
  });
  await assert.rejects(() => invalidClient.getEnrollmentPreview("intent-1"), /invalid/);
});

test("Teams enrollment enforces the server's 80-character display-name limit", async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const client = new TeamApiClient({
    baseUrl: "https://teams.example.test/",
    fetchImpl: async () => new Response(JSON.stringify({
      deviceId: "device-1",
      organization: { id: "org-1", name: "Acme" },
      deviceCredential: "credential_" + "a".repeat(32),
      packRevision: 1,
    }), { status: 201 }),
  });

  await assert.doesNotReject(() => client.completeEnrollment(
    "intent-1",
    "desktop-proof",
    "desktop-installation",
    "a".repeat(80),
    expiresAt,
  ));
  await assert.rejects(() => client.completeEnrollment(
    "intent-1",
    "desktop-proof",
    "desktop-installation",
    "a".repeat(81),
    expiresAt,
  ), /input is invalid/);
});

test("Teams renderer validates the 80-character display-name contract and preview snapshot fields", () => {
  assert.equal(validateDisplayName("a".repeat(80)).ok, true);
  assert.deepEqual(validateDisplayName("a".repeat(81)), {
    ok: false,
    error: "Display name must be 80 characters or fewer.",
  });
  assert.equal(isTeamsSnapshot({
    enrolled: false,
    organizationId: null,
    organizationName: null,
    pendingEnrollment: true,
    pendingOrganizationId: "org-authoritative",
    pendingOrganizationName: "Authoritative Org",
    pendingEnrollmentStatus: "accepted",
    pendingEnrollmentExpiresAt: "2026-09-19T12:00:00.000Z",
    installationId: null,
    pendingRevision: 0,
    appliedRevision: 0,
    teamPets: [],
    teamPlugins: [],
  }), true);
});

test("Teams enrollment completion retries a lost response with the same proof", async () => {
  let calls = 0;
  const proof = "desktop-proof";
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const client = new TeamApiClient({
    baseUrl: "https://teams.example.test/",
    fetchImpl: async (_url, init) => {
      calls += 1;
      assert.equal(
        (JSON.parse(String(init?.body)) as Record<string, unknown>).desktopProof,
        proof,
      );
      if (calls === 1) throw new TypeError("response connection lost");
       return new Response(
         JSON.stringify({
           deviceId: "device-1",
           organization: { id: "org-1", name: "Acme" },
           deviceCredential: "credential_" + "a".repeat(32),
           packRevision: 4,
         }),
         { status: 201 },
       );
     },
   });
   const result = await client.completeEnrollment(
     "intent-1", proof, "desktop-installation", "Alice desktop", expiresAt,
   );
   assert.equal(result.deviceId, "device-1");
  assert.equal(calls, 2);
});

test("Teams enrollment completion respects the server-provided bounded window", async () => {
  let calls = 0;
  const client = new TeamApiClient({
    baseUrl: "https://teams.example.test/",
    fetchImpl: async () => {
      calls += 1;
      return new Response(
         JSON.stringify({ error: { code: "enrollment_completion_in_progress" } }),
        { status: 409 },
      );
    },
  });
  const expiresAt = new Date(Date.now() + 20).toISOString();
  await assert.rejects(
    () => client.completeEnrollment("intent-1", "desktop-proof", "desktop-installation", "Alice desktop", expiresAt),
    /completion timed out/,
  );
  assert.ok(calls <= 2);
});

test("required and optional Team plugin policy never bypasses permission approval", () => {
  assert.deepEqual(
    resolveTeamPluginPolicy("required", false, [], []),
    { enabled: true, permissionBlocked: false },
  );
  assert.deepEqual(
    resolveTeamPluginPolicy("required", false, ["network"], []),
    { enabled: false, permissionBlocked: true },
  );
  assert.deepEqual(
    resolveTeamPluginPolicy(
      "required",
      false,
      ["network"],
      ["network"],
      ["api.example.test"],
      [],
    ),
    { enabled: false, permissionBlocked: true },
  );
  assert.deepEqual(
    resolveTeamPluginPolicy("optional", undefined, [], []),
    { enabled: false, permissionBlocked: false },
  );
  assert.deepEqual(
    resolveTeamPluginPolicy("optional", true, [], []),
    { enabled: true, permissionBlocked: false },
  );
});

test("Team sync and leave operations are serialized through cleanup, and post-leave sync is harmless", async () => {
  const queue = new TeamOperationQueue();
  let releaseFetch!: () => void;
  const fetchFinished = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  let enrolled = true;
  const events: string[] = [];

  const sync = queue.run(async () => {
    events.push("fetch-start");
    await fetchFinished;
    events.push("fetch-finished");
    if (!enrolled) return "not-enrolled";
    events.push("activate-old-org");
    return "activated";
  });
  const leave = queue.run(async () => {
    enrolled = false;
    events.push("leave-cleanup");
  });

  releaseFetch();
  assert.equal(await sync, "activated");
  await leave;
  const postLeaveSync = await queue.run(async () => {
    if (!enrolled) return "not-enrolled";
    events.push("activate-old-org");
    return "activated";
  });

  assert.equal(postLeaveSync, "not-enrolled");
  assert.deepEqual(events, ["fetch-start", "fetch-finished", "activate-old-org", "leave-cleanup"]);
});

test("Team plugin pending approval state is disabled and exposes only requested capabilities", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-team-plugin-state-test-"));
  try {
    const store = new PluginStateStore({ userDataPath: root });
    store.initialize();
    store.upsertRecord({
      id: "team-plugin",
      version: "1.0.0",
      source: "team",
      teamOwnership: {
        organizationId: "org",
        itemId: "team-plugin",
        artifactVersionId: "artifact",
        releaseId: "release",
      },
      teamPolicy: "required",
      installPath: join(root, "team-plugins", "team-plugin"),
      manifestPath: join(root, "team-plugins", "team-plugin", "openpets.plugin.json"),
      enabled: false,
      approvedPermissions: [],
      config: {},
      teamPendingApproval: {
        permissions: ["network"],
        networkHosts: ["api.example.test"],
      },
    });
    const record = store.getRecord("team-plugin");
    assert.equal(record?.enabled, false);
    assert.deepEqual(
      record?.teamPendingApproval,
      { permissions: ["network"], networkHosts: ["api.example.test"] },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Team artifact rollback and cleanup never touch a colliding personal pet", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-team-artifact-test-"));
  try {
    const teamRoot = join(root, "team-pets");
    const personalRoot = join(root, "pets");
    const target = join(teamRoot, "team-pet");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "marker"), "old");
    await mkdir(join(personalRoot, "team-pet"), { recursive: true });
    await writeFile(join(personalRoot, "team-pet", "marker"), "personal");

    const stagingPath = join(teamRoot, ".staging-team-pet");
    await mkdir(stagingPath, { recursive: true });
    await writeFile(join(stagingPath, "marker"), "new");
    const staged = {
      item: validateTeamPack({
        version: 1,
        revision: 1,
        items: [item()],
      }).items[0]!,
      stagingPath,
    };
    const activated = await activateTeamArtifact(root, staged);
    assert.equal(await readFile(join(activated.target, "marker"), "utf8"), "new");

    // Model a state-install rejection after activation: only the Team lane rolls back.
    await activated.rollback();
    assert.equal(await readFile(join(target, "marker"), "utf8"), "old");
    assert.equal(await readFile(join(personalRoot, "team-pet", "marker"), "utf8"), "personal");

    await removeTeamArtifact(root, "pet", "team-pet");
    assert.equal(
      await readFile(join(personalRoot, "team-pet", "marker"), "utf8"),
      "personal",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TeamService cancels an in-flight sync before leave and never resurrects old-org content", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-team-service-leave-test-"));
  try {
    const teamState = new TeamStateStore({ userDataPath: root });
    teamState.initialize();
    teamState.enroll({ organizationId: "org-one", organizationName: "One" });
    const credentialStore = new MemoryCredentialStore("credential_" + "a".repeat(32));
    const pluginState = new PluginStateStore({ userDataPath: root });
    pluginState.initialize();
    pluginState.upsertRecord(teamPluginRecord(root, "old-plugin", "org-one"));
    await mkdir(join(root, "team-pets", "old-pet"), { recursive: true });
    await writeFile(join(root, "team-pets", "old-pet", "marker"), "old-pet");
    await mkdir(join(root, "team-plugins", "old-plugin"), { recursive: true });
    await writeFile(join(root, "team-plugins", "old-plugin", "marker"), "old-plugin");
    let pets: unknown[] = [teamPetState("old-pet", "org-one")];
    const petState = createPetStateAdapter(() => pets, (next) => {
      pets = next;
    });
    const reloads: string[] = [];
    const activePlugins = new Set<string>();
    let releaseFetch!: () => void;
    let fetchStarted!: () => void;
    const fetchReady = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });
    const blockedFetch = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let getPackCalls = 0;
    const api = {
      getTeamPack: async () => {
        getPackCalls += 1;
        fetchStarted();
        await blockedFetch;
        return {
          pack: validateTeamPack({ version: 1, revision: 1, items: [] }),
          notModified: false,
          etag: "pack-1",
        };
      },
      downloadArtifact: async () => {
        throw new Error("artifact download should not start");
      },
      reportDeployment: async () => undefined,
      leaveOrganization: async () => undefined,
      getEnrollmentPreview: async () => {
        throw new Error("not used");
      },
      completeEnrollment: async () => {
        throw new Error("not used");
      },
    } satisfies NonNullable<TeamServiceOptions["apiClient"]>;
    const service = new TeamService({
      userDataPath: root,
      apiClient: api,
      stateStore: teamState,
      credentialStore,
      pluginService: {
        stateStore: pluginState,
        runtime: {
          reloadPlugin: async (id: string) => {
            reloads.push(id);
            if (pluginState.getRecord(id)?.enabled) activePlugins.add(id);
            else activePlugins.delete(id);
          },
        },
      },
      petState,
    });

    const sync = service.syncNow();
    await fetchReady;
    const leave = service.leave();
    releaseFetch();
    await Promise.all([sync, leave]);

    assert.equal(teamState.snapshot()?.organizationId, "");
    assert.deepEqual(pets, []);
    assert.equal(pluginState.getRecord("old-plugin"), undefined);
    assert.equal(reloads.includes("old-plugin"), true);
    assert.deepEqual(activePlugins, new Set());
    await assert.rejects(() => stat(join(root, "team-pets")));
    await assert.rejects(() => stat(join(root, "team-plugins")));
    assert.equal((await service.syncNow()).enrolled, false);
    assert.equal(getPackCalls, 1);
    assert.deepEqual(service.getSnapshot().teamPets, []);
    assert.deepEqual(service.getSnapshot().teamPlugins, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TeamService requires the current approval token, scopes snapshots, and advances only after approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-team-service-approval-test-"));
  try {
    const teamState = new TeamStateStore({ userDataPath: root });
    teamState.initialize();
    teamState.enroll({ organizationId: "org-one", organizationName: "One" });
    const credentialStore = new MemoryCredentialStore("credential_" + "b".repeat(32));
    const pluginState = new PluginStateStore({ userDataPath: root });
    pluginState.initialize();
    pluginState.upsertRecord({
      ...teamPluginRecord(root, "other-plugin", "org-two"),
      teamPendingApproval: {
        permissions: ["pet:speak"],
        networkHosts: [],
      },
      teamApprovalToken: "A".repeat(43),
    });
    const reloads: string[] = [];
    let currentPack = createPluginPack("1.0.0", "artifact-one", 1, "optional");
    let currentZip = createPluginZip("team-plugin", "1.0.0");
    const api = {
      getTeamPack: async () => ({
        pack: currentPack,
        notModified: false,
        etag: `pack-${currentPack.revision}`,
      }),
      downloadArtifact: async () => currentZip,
      reportDeployment: async () => undefined,
      leaveOrganization: async () => undefined,
      getEnrollmentPreview: async () => {
        throw new Error("not used");
      },
      completeEnrollment: async () => {
        throw new Error("not used");
      },
    } satisfies NonNullable<TeamServiceOptions["apiClient"]>;
    const service = new TeamService({
      userDataPath: root,
      apiClient: api,
      stateStore: teamState,
      credentialStore,
      pluginService: {
        stateStore: pluginState,
        runtime: {
          reloadPlugin: async (id: string) => {
            reloads.push(id);
          },
        },
      },
      petState: createPetStateAdapter(() => [], () => undefined),
    });

    const first = await service.syncNow();
    const firstPlugin = pluginState.getRecord("team-plugin");
    const firstToken = firstPlugin?.teamApprovalToken;
    assert.equal(firstPlugin?.enabled, false);
    assert.equal(firstPlugin?.teamPendingApproval?.permissions[0], "pet:speak");
    assert.equal(first.appliedRevision, 0);
    assert.equal(first.teamPlugins.some((plugin) => plugin.id === "other-plugin"), false);
    assert.equal(firstToken?.length, 43);
    await assert.rejects(
      () => service.approveTeamPluginPermissions("other-plugin", "A".repeat(43)),
      /unavailable/,
    );
    await assert.rejects(() => service.setTeamPluginEnabled("other-plugin", true), /unavailable/);
    await assert.rejects(() => service.setTeamPluginEnabled("team-plugin", true), /Only fully approved/);

    currentPack = createPluginPack("1.1.0", "artifact-two", 2, "optional");
    currentZip = createPluginZip("team-plugin", "1.1.0");
    await service.syncNow();
    const secondToken = pluginState.getRecord("team-plugin")?.teamApprovalToken;
    assert.notEqual(secondToken, firstToken);
    await assert.rejects(
      () => service.approveTeamPluginPermissions("team-plugin", firstToken!),
      /unavailable/,
    );
    assert.equal(teamState.snapshot()?.appliedRevision, 0);

    const approved = await service.approveTeamPluginPermissions("team-plugin", secondToken!);
    assert.equal(pluginState.getRecord("team-plugin")?.enabled, false);
    assert.equal(pluginState.getRecord("team-plugin")?.teamPendingApproval, undefined);
    assert.equal(approved.appliedRevision, 2);
    assert.equal(
      approved.teamPlugins.find((plugin) => plugin.id === "team-plugin")?.permissionBlocked,
      false,
    );
    assert.equal(reloads.includes("team-plugin"), true);

    const enabled = await service.setTeamPluginEnabled("team-plugin", true);
    assert.equal(
      enabled.teamPlugins.find((plugin) => plugin.id === "team-plugin")?.enabled,
      true,
    );
    const disabled = await service.setTeamPluginEnabled("team-plugin", false);
    assert.equal(
      disabled.teamPlugins.find((plugin) => plugin.id === "team-plugin")?.enabled,
      false,
    );

    currentPack = createPluginPack("1.1.0", "artifact-two", 3, "required");
    await service.syncNow();
    await assert.rejects(
      () => service.setTeamPluginEnabled("team-plugin", false),
      /Only fully approved/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TeamService approves Team plugins whose manifest lists permissions out of canonical order", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-team-service-permission-order-test-"));
  try {
    const teamState = new TeamStateStore({ userDataPath: root });
    teamState.initialize();
    teamState.enroll({ organizationId: "org-one", organizationName: "One" });
    const pluginState = new PluginStateStore({ userDataPath: root });
    pluginState.initialize();
    const nonCanonicalPermissions = ["storage", "commands", "pet:speak"];
    const api = {
      getTeamPack: async () => ({ pack: createPluginPack("1.0.0", "artifact-one", 1, "optional", nonCanonicalPermissions), notModified: false, etag: "pack-1" }),
      downloadArtifact: async () => createPluginZip("team-plugin", "1.0.0", nonCanonicalPermissions),
      reportDeployment: async () => undefined,
      leaveOrganization: async () => undefined,
      getEnrollmentPreview: async () => {
        throw new Error("not used");
      },
      completeEnrollment: async () => {
        throw new Error("not used");
      },
    } satisfies NonNullable<TeamServiceOptions["apiClient"]>;
    const service = new TeamService({
      userDataPath: root,
      apiClient: api,
      stateStore: teamState,
      credentialStore: new MemoryCredentialStore("credential_" + "b".repeat(32)),
      pluginService: { stateStore: pluginState, runtime: { reloadPlugin: async () => undefined } },
      petState: createPetStateAdapter(() => [], () => undefined),
    });

    await service.syncNow();
    const token = pluginState.getRecord("team-plugin")?.teamApprovalToken;
    const approved = await service.approveTeamPluginPermissions("team-plugin", token!);
    assert.equal(approved.appliedRevision, 1);
    assert.equal(approved.teamPlugins.find((plugin) => plugin.id === "team-plugin")?.permissionBlocked, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TeamService clears stale pending approval when the same revision replaces the artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-team-service-replacement-test-"));
  try {
    const teamState = new TeamStateStore({ userDataPath: root });
    teamState.initialize();
    teamState.enroll({ organizationId: "org-one" });
    const pluginState = new PluginStateStore({ userDataPath: root });
    pluginState.initialize();
    const credentialStore = new MemoryCredentialStore("credential_" + "f".repeat(32));
    let currentPack = createPluginPack("1.0.0", "artifact-one");
    let currentZip = createPluginZip("team-plugin", "1.0.0");
    const api = {
      getTeamPack: async () => ({
        pack: currentPack,
        notModified: false,
        etag: "pack-1",
      }),
      downloadArtifact: async () => currentZip,
      reportDeployment: async () => undefined,
      leaveOrganization: async () => undefined,
      getEnrollmentPreview: async () => {
        throw new Error("not used");
      },
      completeEnrollment: async () => {
        throw new Error("not used");
      },
    } satisfies NonNullable<TeamServiceOptions["apiClient"]>;
    const service = new TeamService({
      userDataPath: root,
      apiClient: api,
      stateStore: teamState,
      credentialStore,
      pluginService: {
        stateStore: pluginState,
        runtime: { reloadPlugin: async () => undefined },
      },
      petState: createPetStateAdapter(() => [], () => undefined),
    });

    const blocked = await service.syncNow();
    assert.equal(blocked.appliedRevision, 0);
    assert.equal(blocked.teamPlugins[0]?.permissionBlocked, true);
    assert.equal(teamState.snapshot()?.reconciledRevision, 1);

    currentPack = createPluginPack("1.1.0", "artifact-two", 1, "required", []);
    currentZip = createPluginZip("team-plugin", "1.1.0", []);
    const replaced = await service.syncNow();
    assert.equal(replaced.appliedRevision, 1);
    assert.equal(replaced.pendingRevision, 1);
    assert.equal(replaced.teamPlugins[0]?.permissionBlocked, false);
    assert.equal(teamState.snapshot()?.reconciledRevision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TeamService enrollment returns the snapshot produced by its initial sync", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-team-service-enrollment-test-"));
  try {
    const teamState = new TeamStateStore({ userDataPath: root });
    teamState.initialize();
    const pluginState = new PluginStateStore({ userDataPath: root });
    pluginState.initialize();
    const zip = createPluginZip("team-plugin", "1.0.0");
    const pack = createPluginPack("1.0.0", "artifact-one");
    const api = {
       getEnrollmentPreview: async () => ({
         intentId: "intent-1",
         status: "started" as const,
         organization: { id: "org-one", name: "One" },
         expiresAt: new Date(Date.now() + 60_000).toISOString(),
       }),
      completeEnrollment: async () => ({
        deviceId: "device-1",
        organization: { id: "org-one", name: "One" },
        deviceCredential: "credential_" + "e".repeat(32),
        packRevision: 1,
      }),
      getTeamPack: async () => ({ pack, notModified: false, etag: "pack-1" }),
      downloadArtifact: async () => zip,
      reportDeployment: async () => undefined,
      leaveOrganization: async () => undefined,
    } satisfies NonNullable<TeamServiceOptions["apiClient"]>;
    const service = new TeamService({
      userDataPath: root,
      apiClient: api,
      stateStore: teamState,
      credentialStore: new MemoryCredentialStore(null),
      pluginService: {
        stateStore: pluginState,
        runtime: { reloadPlugin: async () => undefined },
      },
      petState: createPetStateAdapter(() => [], () => undefined),
    });

    assert.equal(service.handleDeepLink("openpets://teams/enroll?intent=intent-1"), true);
    await assert.rejects(() => service.submitEnrollment("a".repeat(81)), /valid display name/);
    const snapshot = await service.submitEnrollment("Alice");
    assert.equal(snapshot.enrolled, true);
    assert.equal(snapshot.organizationId, "org-one");
    assert.equal(snapshot.teamPlugins.find((plugin) => plugin.id === "team-plugin")?.permissionBlocked, true);
    assert.equal(snapshot.appliedRevision, 0);
    assert.equal(snapshot.pendingRevision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TeamService refreshes pending enrollment previews and exposes authoritative identity and expiry", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-team-service-preview-refresh-test-"));
  try {
    const teamState = new TeamStateStore({ userDataPath: root });
    teamState.initialize();
    teamState.setPendingIntent({ intentId: "intent-refresh" });
    const pluginState = new PluginStateStore({ userDataPath: root });
    pluginState.initialize();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    let previewCalls = 0;
    const api = {
      getEnrollmentPreview: async () => {
        previewCalls += 1;
        return {
          intentId: "intent-refresh",
          status: "accepted" as const,
          organization: { id: "org-authoritative", name: "Authoritative Org" },
          displayName: "Existing desktop",
          expiresAt,
        };
      },
      completeEnrollment: async () => {
        throw new Error("not used");
      },
      getTeamPack: async () => {
        throw new Error("not used");
      },
      downloadArtifact: async () => {
        throw new Error("not used");
      },
      reportDeployment: async () => undefined,
      leaveOrganization: async () => undefined,
    } satisfies NonNullable<TeamServiceOptions["apiClient"]>;
    const service = new TeamService({
      userDataPath: root,
      apiClient: api,
      stateStore: teamState,
      credentialStore: new MemoryCredentialStore(null),
      pluginService: {
        stateStore: pluginState,
        runtime: { reloadPlugin: async () => undefined },
      },
      petState: createPetStateAdapter(() => [], () => undefined),
    });

    const first = await service.syncNow();
    assert.equal(previewCalls, 1);
    assert.equal(first.pendingOrganizationId, "org-authoritative");
    assert.equal(first.pendingOrganizationName, "Authoritative Org");
    assert.equal(first.pendingEnrollmentStatus, "accepted");
    assert.equal(first.pendingEnrollmentExpiresAt, expiresAt);

    await service.syncNow();
    assert.equal(previewCalls, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("delayed enrollment preview keeps Accept unavailable until authoritative state arrives", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-team-service-delayed-preview-test-"));
  try {
    const teamState = new TeamStateStore({ userDataPath: root });
    teamState.initialize();
    teamState.setPendingIntent({ intentId: "intent-delayed" });
    const pluginState = new PluginStateStore({ userDataPath: root });
    pluginState.initialize();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    let releasePreview!: () => void;
    let previewStarted!: () => void;
    const previewBlocked = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    const previewReady = new Promise<void>((resolve) => {
      previewStarted = resolve;
    });
    const api = {
      getEnrollmentPreview: async () => {
        previewStarted();
        await previewBlocked;
        return {
          intentId: "intent-delayed",
          status: "accepted" as const,
          organization: { id: "org-authoritative", name: "Authoritative Org" },
          expiresAt,
        };
      },
      completeEnrollment: async () => {
        throw new Error("not used");
      },
      getTeamPack: async () => {
        throw new Error("not used");
      },
      downloadArtifact: async () => {
        throw new Error("not used");
      },
      reportDeployment: async () => undefined,
      leaveOrganization: async () => undefined,
    } satisfies NonNullable<TeamServiceOptions["apiClient"]>;
    const service = new TeamService({
      userDataPath: root,
      apiClient: api,
      stateStore: teamState,
      credentialStore: new MemoryCredentialStore(null),
      pluginService: {
        stateStore: pluginState,
        runtime: { reloadPlugin: async () => undefined },
      },
      petState: createPetStateAdapter(() => [], () => undefined),
    });
    const initial = service.getSnapshot();
    assert.equal(isEnrollmentActionable(initial, "Alice", Date.now()), false);

    const previewUpdates: Array<ReturnType<TeamService["getSnapshot"]>> = [];
    const refreshed = new Promise<ReturnType<TeamService["getSnapshot"]>>((resolve) => {
      service.subscribeToEnrollmentPreview((snapshot) => {
        previewUpdates.push(snapshot);
        if (snapshot.pendingOrganizationId) resolve(snapshot);
      });
    });
    assert.equal(service.handleDeepLink("openpets://teams/enroll?intent=intent-delayed"), true);
    await previewReady;
    assert.equal(
      isEnrollmentActionable(service.getSnapshot(), "Alice", Date.now()),
      false,
    );

    releasePreview();
    const authoritative = await refreshed;
    assert.equal(previewUpdates[0]?.pendingOrganizationId, null);
    assert.equal(authoritative.pendingOrganizationId, "org-authoritative");
    assert.equal(authoritative.pendingOrganizationName, "Authoritative Org");
    assert.equal(authoritative.pendingEnrollmentExpiresAt, expiresAt);
    assert.equal(isEnrollmentActionable(authoritative, "Alice", Date.now()), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TeamService clears an expired persisted enrollment intent during refresh", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-team-service-expired-preview-test-"));
  try {
    const teamState = new TeamStateStore({ userDataPath: root });
    teamState.initialize();
    teamState.setPendingIntent({ intentId: "intent-expired" });
    const pluginState = new PluginStateStore({ userDataPath: root });
    pluginState.initialize();
    const api = {
      getEnrollmentPreview: async () => {
        throw new TeamApiError(401, "unauthorized", "expired");
      },
      completeEnrollment: async () => {
        throw new Error("not used");
      },
      getTeamPack: async () => {
        throw new Error("not used");
      },
      downloadArtifact: async () => {
        throw new Error("not used");
      },
      reportDeployment: async () => undefined,
      leaveOrganization: async () => undefined,
    } satisfies NonNullable<TeamServiceOptions["apiClient"]>;
    const service = new TeamService({
      userDataPath: root,
      apiClient: api,
      stateStore: teamState,
      credentialStore: new MemoryCredentialStore(null),
      pluginService: {
        stateStore: pluginState,
        runtime: { reloadPlugin: async () => undefined },
      },
      petState: createPetStateAdapter(() => [], () => undefined),
    });

    const snapshot = await service.syncNow();
    assert.equal(snapshot.pendingEnrollment, false);
    assert.equal(teamState.snapshot()?.pendingIntent, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TeamService uses persisted pet ownership to reject a personal collision", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-team-service-pet-collision-test-"));
  try {
    const teamState = new TeamStateStore({ userDataPath: root });
    teamState.initialize();
    teamState.enroll({ organizationId: "org-one" });
    const personalPet = {
      ...teamPetState("same-id", "personal"),
      source: {
        kind: "catalog" as const,
        catalogVersion: 2 as const,
        zip: "pet.zip",
        preview: "pet.webp",
      },
    };
    let pets: unknown[] = [personalPet];
    const pluginState = new PluginStateStore({ statePath: join(root, "plugins.json") });
    pluginState.initialize();
    const api = {
      getTeamPack: async () => ({
        pack: createPetPack("same-id"),
        notModified: false,
        etag: "pack-1",
      }),
      downloadArtifact: async () => createPetZip("same-id"),
      reportDeployment: async () => undefined,
      leaveOrganization: async () => undefined,
      getEnrollmentPreview: async () => {
        throw new Error("not used");
      },
      completeEnrollment: async () => {
        throw new Error("not used");
      },
    } satisfies NonNullable<TeamServiceOptions["apiClient"]>;
    const service = new TeamService({
      userDataPath: root,
      apiClient: api,
      stateStore: teamState,
      credentialStore: new MemoryCredentialStore("credential_" + "c".repeat(32)),
      pluginService: {
        stateStore: pluginState,
        runtime: { reloadPlugin: async () => undefined },
      },
      petState: createPetStateAdapter(() => pets, (next) => {
        pets = next;
      }),
    });
    const snapshot = await service.syncNow();
    assert.equal(snapshot.lastError, "apply_failed");
    assert.equal(
      ((pets[0] as Record<string, unknown> | undefined)?.source as Record<string, unknown> | undefined)?.kind,
      "catalog",
    );
    assert.equal(
      pets.some(
        (pet) => (
          (pet as Record<string, unknown>).source as Record<string, unknown> | undefined
        )?.kind === "team",
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TeamService does not make a failed revision current when an earlier plugin is approved", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-team-service-revision-test-"));
  try {
    const teamState = new TeamStateStore({ userDataPath: root });
    teamState.initialize();
    teamState.enroll({ organizationId: "org-one" });
    const credentialStore = new MemoryCredentialStore("credential_" + "d".repeat(32));
    const pluginState = new PluginStateStore({ userDataPath: root });
    pluginState.initialize();
    const collisionPet = {
      ...teamPetState("collision", "personal"),
      source: {
        kind: "catalog" as const,
        catalogVersion: 2 as const,
        zip: "collision.zip",
        preview: "collision.webp",
      },
    };
    let pets: unknown[] = [collisionPet];
    const pluginZip = createPluginZip("team-plugin", "1.0.0");
    const petZip = createPetZip("collision");
    const pluginPack = createPluginPack("1.0.0", "artifact-one");
    const failedPack = validateTeamPack({
      version: 1,
      revision: 1,
      items: [...pluginPack.items, ...createPetPack("collision").items],
    });
    let currentPack = pluginPack;
    const zips = new Map([
      ["artifact-one", pluginZip],
      ["version-1", petZip],
    ]);
    const api = {
      getTeamPack: async () => ({
        pack: currentPack,
        notModified: false,
        etag: `pack-${currentPack.revision}`,
      }),
      downloadArtifact: async (_credential: string, versionId: string) => zips.get(versionId)!,
      reportDeployment: async () => undefined,
      leaveOrganization: async () => undefined,
      getEnrollmentPreview: async () => {
        throw new Error("not used");
      },
      completeEnrollment: async () => {
        throw new Error("not used");
      },
    } satisfies NonNullable<TeamServiceOptions["apiClient"]>;
    const service = new TeamService({
      userDataPath: root,
      apiClient: api,
      stateStore: teamState,
      credentialStore,
      pluginService: {
        stateStore: pluginState,
        runtime: { reloadPlugin: async () => undefined },
      },
      petState: createPetStateAdapter(() => pets, (next) => {
        pets = next;
      }),
    });

    const first = await service.syncNow();
    const record = pluginState.getRecord("team-plugin");
    assert.equal(first.appliedRevision, 0);
    assert.equal(teamState.snapshot()?.reconciledRevision, 1);
    assert.equal(record?.enabled, false);
    assert.equal(record?.teamPendingApproval !== undefined, true);

    currentPack = failedPack;
    const failed = await service.syncNow();
    assert.equal(failed.appliedRevision, 0);
    assert.equal(teamState.snapshot()?.reconciledRevision, undefined);

    await service.approveTeamPluginPermissions("team-plugin", record?.teamApprovalToken!);
    assert.equal(teamState.snapshot()?.appliedRevision, 0);
    assert.equal(teamState.snapshot()?.reconciledRevision, undefined);
    assert.equal(pluginState.getRecord("team-plugin")?.teamPendingApproval, undefined);

    currentPack = createPluginPack("1.0.0", "artifact-one", 2);
    const successful = await service.syncNow();
    assert.equal(successful.appliedRevision, 2);
    assert.equal(teamState.snapshot()?.reconciledRevision, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class MemoryCredentialStore implements SecureCredentialStore {
  constructor(private value: string | null) {
  }
  load(): string | null {
    return this.value;
  }

  save(value: string): void {
    this.value = value;
  }

  clear(): void {
    this.value = null;
  }
}

function createPetStateAdapter(
  getPets: () => readonly unknown[],
  setPets: (pets: unknown[]) => void,
): NonNullable<TeamServiceOptions["petState"]> {
  type PetAdapter = NonNullable<TeamServiceOptions["petState"]>;
  return {
    snapshot: () => ({ pets: { installed: getPets() } } as unknown as OpenPetsStateV1),
    install: (pet: Parameters<PetAdapter["install"]>[0]) => setPets([...getPets(), pet]),
    remove: (ownership: Parameters<PetAdapter["remove"]>[0]) => setPets(
      getPets().filter((pet) => (
        (pet as Record<string, unknown>).source as Record<string, unknown> | undefined
      )?.itemId !== ownership.itemId),
    ),
    upsert: (pet: Parameters<PetAdapter["upsert"]>[0]) => setPets(
      getPets().map((existing) => (
        (existing as Record<string, unknown>).id === pet.id ? pet : existing
      )),
    ),
  } as unknown as NonNullable<TeamServiceOptions["petState"]>;
}

function teamPetState(id: string, organizationId: string): Record<string, unknown> {
  return {
    id,
    displayName: id,
    description: id,
    source: {
      kind: "team",
      organizationId,
      itemId: id,
      artifactVersionId: "artifact",
      releaseId: "release",
    },
  };
}

function teamPluginRecord(root: string, id: string, organizationId: string): {
  id: string;
  version: string;
  source: "team";
  teamOwnership: {
    organizationId: string;
    itemId: string;
    artifactVersionId: string;
    releaseId: string;
  };
  teamPolicy: "required";
  installPath: string;
  manifestPath: string;
  enabled: boolean;
  approvedPermissions: never[];
  config: Record<string, never>;
} {
  return {
    id,
    version: "1.0.0",
    source: "team",
    teamOwnership: {
      organizationId,
      itemId: id,
      artifactVersionId: "artifact",
      releaseId: "release",
    },
    teamPolicy: "required",
    installPath: join(root, "team-plugins", id),
    manifestPath: join(root, "team-plugins", id, "openpets.plugin.json"),
    enabled: true,
    approvedPermissions: [],
    config: {},
  };
}

function createPluginPack(
  version: string,
  versionId: string,
  revision = 1,
  policy: "required" | "optional" = "required",
  permissions: string[] = ["pet:speak"],
): TeamPack {
  const zip = createPluginZip("team-plugin", version, permissions);
  return validateTeamPack({
    version: 1,
    revision,
    items: [item({
      id: "team-plugin",
      itemId: "team-plugin",
      type: "plugin",
      version,
      versionId,
      sha256: createHash("sha256").update(zip).digest("hex"),
      size: zip.byteLength,
      policy,
    })],
  });
}

function createPetPack(id: string): TeamPack {
  const zip = createPetZip(id);
  return validateTeamPack({
    version: 1,
    revision: 1,
    items: [item({
      id,
      itemId: id,
      type: "pet",
      sha256: createHash("sha256").update(zip).digest("hex"),
      size: zip.byteLength,
    })],
  });
}

function createPluginZip(
  id: string,
  version: string,
  permissions: string[] = ["pet:speak"],
): Buffer {
  const manifest = JSON.stringify({
    manifestVersion: 3,
    id,
    name: "Team Plugin",
    version,
    runtime: "javascript",
    sdkVersion: "3.0.0",
    entry: "index.js",
    permissions,
  });
  return makeZipFiles([
    {
      name: "openpets.plugin.json",
      data: Buffer.from(manifest),
    },
    {
      name: "index.js",
      data: Buffer.from("export function register() {}\n"),
    },
    {
      name: "locales/en.json",
      data: Buffer.from(JSON.stringify({ "plugin.name": "Team Plugin" })),
    },
  ]);
}

function createPetZip(id: string): Buffer {
  const sprite = Buffer.alloc(16);
  sprite.write("RIFF", 0, "ascii");
  sprite.write("WEBP", 8, "ascii");
  return makeZipFiles([
    {
      name: "pet.json",
      data: Buffer.from(JSON.stringify({
        id,
        displayName: "Team Pet",
        description: "Team pet",
        spritesheetPath: "spritesheet.webp",
      })),
    },
    {
      name: "spritesheet.webp",
      data: sprite,
    },
  ]);
}

function makeZipFiles(
  files: Array<{ name: string; data: Buffer }>,
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    const localPart = Buffer.concat([local, name, file.data]);
    locals.push(localPart);
    centrals.push(Buffer.concat([central, name]));
    offset += localPart.length;
  }
  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, end]);
}

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}
