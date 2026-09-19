import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  TeamApiClient,
  TeamApiError,
  type ManagerCheckInSettings,
  type ManagerCheckInSubmission,
  type ManagerCheckInSyncResponse,
} from "../src/team-api-client.js";
import { ManagerCheckInService } from "../src/manager-check-in-service.js";
import { ManagerCheckInStateStore } from "../src/manager-check-in-state.js";
import type { SecureCredentialStore } from "../src/team-state.js";

const settings: ManagerCheckInSettings = {
  revision: 3,
  weeklyEnabled: true,
  weeklyDay: 1,
  title: "How are you feeling this week?",
  introduction: "This is voluntary.",
  acknowledgement: "Thanks.",
  notePlaceholder: "Add a note",
  labels: {
    good: "Good",
    steady: "Steady",
    stretched: "Stretched",
    struggling: "Struggling",
    need_support: "Need support",
  },
};

function createSubmission(
  clientGeneratedId: string,
  revision = settings.revision,
  id = "submission-1",
): ManagerCheckInSubmission {
  return {
    id,
    clientGeneratedId,
    feelingCode: "steady",
    note: "A short reflection",
    submittedAt: "2026-09-14T10:00:00.000Z",
    settingsRevision: revision,
    promptSnapshot: {
      title: settings.title,
      introduction: settings.introduction,
      acknowledgement: settings.acknowledgement,
      notePlaceholder: settings.notePlaceholder,
      labels: settings.labels,
      visibilityNotice: {
        version: 1,
        text: "Submitted check-ins are visible to your organization's Teams dashboard.",
      },
    },
  };
}

function createCredentialStore(): SecureCredentialStore {
  return {
    load: () => "credential",
    save: () => undefined,
    clear: () => undefined,
  };
}

function createSyncResponse(
  overrides: Partial<ManagerCheckInSyncResponse> = {},
): ManagerCheckInSyncResponse {
  return {
    organization: { id: "org-1", name: "Acme" },
    visibilityNotice: {
      version: 1,
      text: "Submitted check-ins are visible to your organization's Teams dashboard.",
    },
    employee: { id: "employee-1", displayName: "Alice" },
    settings,
    scheduledOffersPaused: false,
    submissions: [],
    nextCursor: null,
    ...overrides,
  };
}

function createTeamState() {
  return {
    version: 1 as const,
    installationId: "desktop-00000000-0000-0000-0000-000000000000",
    organizationId: "org-1",
    organizationName: "Acme",
    deviceId: "device-1",
    pendingRevision: 0,
    appliedRevision: 0,
  };
}

test("Manager Check-in service retries a pending submission with the same idempotency key", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-test-"));
  try {
    let submitCalls = 0;
    const api = {
      getManagerCheckInSync: async () => createSyncResponse(),
      submitManagerCheckIn: async (_credential: string, input: { clientGeneratedId: string; feelingCode: "steady"; note: string | null; settingsRevision: number }) => {
        submitCalls += 1;
        if (submitCalls === 1) throw new Error("response connection lost");
        return createSubmission(input.clientGeneratedId);
      },
      setScheduledOffersPaused: async () => false,
    };
    const service = new ManagerCheckInService({
      teamStateStore: { snapshot: () => createTeamState() },
      credentialStore: createCredentialStore(),
      apiClient: api,
      stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }),
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    });
    await service.start();
    await assert.rejects(() => service.submit({ feelingCode: "steady", note: "A short reflection", settingsRevision: 3 }));
    const pending = service.stateStore.snapshot()?.pendingSubmission;
    assert.ok(pending?.clientGeneratedId);
    await service.syncNow();
    assert.equal(submitCalls, 2);
    assert.equal(service.stateStore.snapshot()?.pendingSubmission, undefined);
    assert.equal(service.getSnapshot().submissions[0]?.clientGeneratedId, pending.clientGeneratedId);
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an abort after dispatch retains the client ID for the next startup retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-abort-test-"));
  try {
    let submitCalls = 0;
    let firstClientId = "";
    const api = {
      getManagerCheckInSync: async () => createSyncResponse(),
      submitManagerCheckIn: async (_credential: string, input: { clientGeneratedId: string }, signal: AbortSignal) => {
        submitCalls += 1;
        if (submitCalls === 1) {
          firstClientId = input.clientGeneratedId;
          await new Promise<void>((resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("Teams enrollment was cancelled.")), { once: true });
          });
        }
        return createSubmission(input.clientGeneratedId);
      },
      setScheduledOffersPaused: async () => false,
    };
    const service = new ManagerCheckInService({ teamStateStore: { snapshot: () => createTeamState() }, credentialStore: createCredentialStore(), apiClient: api, stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }), now: () => new Date("2026-09-14T12:00:00.000Z") });
    await service.start();
    const submission = service.submit({ feelingCode: "steady", note: null, settingsRevision: 3 });
    await new Promise((resolve) => setImmediate(resolve));
    await service.stop();
    await assert.rejects(() => submission);
    assert.equal(service.stateStore.snapshot()?.pendingSubmission?.clientGeneratedId, firstClientId);
    await service.start();
    assert.equal(submitCalls, 2);
    assert.equal(service.stateStore.snapshot()?.pendingSubmission, undefined);
    assert.equal(service.stateStore.snapshot()?.submissions[0]?.clientGeneratedId, firstClientId);
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed and oversized successful responses retain the original client ID for retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-response-test-"));
  try {
    let submissionCalls = 0;
    const sentClientIds: string[] = [];
    const syncBody = JSON.stringify(createSyncResponse());
    const client = new TeamApiClient({ baseUrl: "https://teams.example.test", fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/sync")) return new Response(syncBody, { status: 200 });
      submissionCalls += 1;
      sentClientIds.push((JSON.parse(String(init?.body)) as { clientGeneratedId: string }).clientGeneratedId);
      if (submissionCalls === 1) return new Response("{}", { status: 200 });
      if (submissionCalls === 2) return new Response("x".repeat(513 * 1024), { status: 200 });
      return new Response(JSON.stringify({ submission: createSubmission(sentClientIds[0]!) }), { status: 201 });
    } });
    const service = new ManagerCheckInService({ teamStateStore: { snapshot: () => createTeamState() }, credentialStore: createCredentialStore(), apiClient: client, stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }), now: () => new Date("2026-09-14T12:00:00.000Z") });
    await service.start();
    await assert.rejects(() => service.submit({ feelingCode: "steady", note: null, settingsRevision: 3 }));
    await service.syncNow();
    await service.syncNow();
    assert.equal(sentClientIds.length, 3);
    assert.deepEqual(new Set(sentClientIds).size, 1);
    assert.equal(service.stateStore.snapshot()?.pendingSubmission, undefined);
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Manager Check-in scheduling is local-week based and pause suppresses only scheduled offers", async () => {
  let now = new Date("2026-09-14T12:00:00.000Z");
  let paused = false;
  const api = {
    getManagerCheckInSync: async () => createSyncResponse({
      scheduledOffersPaused: paused,
    }),
    submitManagerCheckIn: async (
      _credential: string,
      input: { clientGeneratedId: string; feelingCode: "steady"; note: string | null; settingsRevision: number },
    ) => createSubmission(input.clientGeneratedId),
    setScheduledOffersPaused: async (_credential: string, next: boolean) => {
      paused = next;
      return next;
    },
  };
  const service = new ManagerCheckInService({
    teamStateStore: { snapshot: () => createTeamState() },
    credentialStore: createCredentialStore(),
    apiClient: api,
    stateStore: new ManagerCheckInStateStore({ statePath: join(tmpdir(), `openpets-manager-check-in-${Date.now()}.json`) }),
    now: () => now,
  });
  await service.start();
  assert.equal(service.getSnapshot().dueScheduledOffer, true);
  await service.submit({ feelingCode: "steady", note: null, settingsRevision: 3 });
  assert.equal(service.getSnapshot().dueScheduledOffer, false);
  now = new Date("2026-09-21T12:00:00.000Z");
  assert.equal(service.getSnapshot().dueScheduledOffer, true);
  await service.setScheduledOffersPaused(true);
  assert.equal(service.getSnapshot().scheduledOffersPaused, true);
  assert.equal(service.getSnapshot().dueScheduledOffer, false);
  await service.setScheduledOffersPaused(false);
  assert.equal(service.getSnapshot().dueScheduledOffer, true);
  await service.stop();
});

test("weekly mascot offer is presented once per local week and not repeated by resync", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-offer-test-"));
  try {
    let now = new Date("2026-09-14T12:00:00.000Z");
    let syncCalls = 0;
    const offers: Array<{ title: string; introduction: string }> = [];
    const api = {
      getManagerCheckInSync: async () => {
        syncCalls += 1;
        return createSyncResponse();
      },
      submitManagerCheckIn: async (_credential: string, input: { clientGeneratedId: string }) => createSubmission(input.clientGeneratedId),
      setScheduledOffersPaused: async () => false,
    };
    const service = new ManagerCheckInService({
      teamStateStore: { snapshot: () => createTeamState() },
      credentialStore: createCredentialStore(),
      apiClient: api,
      stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }),
      now: () => now,
      offerWeeklyCheckIn: (offer, onPresented) => {
        offers.push(offer);
        onPresented();
        return { shown: true };
      },
    });

    await service.start();
    assert.equal(syncCalls, 1);
    assert.equal(offers.length, 1);
    assert.deepEqual(offers[0], {
      title: settings.title,
      introduction: settings.introduction,
    });
    assert.equal(service.stateStore.snapshot()?.lastWeeklyOfferWeek, "2026-09-14");
    await service.syncNow();
    assert.equal(offers.length, 1);
    now = new Date("2026-09-21T12:00:00.000Z");
    await service.syncNow();
    assert.equal(offers.length, 2);
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("weekly offer state is marked only after the pet presentation is shown", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-offer-presentation-test-"));
  try {
    let presentationCount = 0;
    const api = {
      getManagerCheckInSync: async () => createSyncResponse(),
      submitManagerCheckIn: async (_credential: string, input: { clientGeneratedId: string }) => createSubmission(input.clientGeneratedId),
      setScheduledOffersPaused: async () => false,
    };
    const service = new ManagerCheckInService({
      teamStateStore: { snapshot: () => createTeamState() },
      credentialStore: createCredentialStore(),
      apiClient: api,
      stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }),
      now: () => new Date("2026-09-14T12:00:00.000Z"),
      offerWeeklyCheckIn: (_offer, onPresented) => {
        presentationCount += 1;
        if (presentationCount === 2) onPresented();
        return { shown: presentationCount === 2 };
      },
    });

    await service.start();
    assert.equal(service.stateStore.snapshot()?.lastWeeklyOfferWeek, undefined);
    await service.syncNow();
    assert.equal(service.stateStore.snapshot()?.lastWeeklyOfferWeek, "2026-09-14");
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("paused and manually completed weeks suppress the mascot offer", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-offer-suppression-test-"));
  try {
    let now = new Date("2026-09-14T12:00:00.000Z");
    let paused = true;
    const offers: Array<{ title: string; introduction: string }> = [];
    const api = {
      getManagerCheckInSync: async () => createSyncResponse({
        scheduledOffersPaused: paused,
      }),
      submitManagerCheckIn: async (_credential: string, input: { clientGeneratedId: string }) => (
        createSubmission(input.clientGeneratedId)
      ),
      setScheduledOffersPaused: async () => paused,
    };
    const service = new ManagerCheckInService({
      teamStateStore: { snapshot: () => createTeamState() },
      credentialStore: createCredentialStore(),
      apiClient: api,
      stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }),
      now: () => now,
      offerWeeklyCheckIn: (offer, onPresented) => {
        offers.push(offer);
        onPresented();
        return { shown: true };
      },
    });

    await service.start();
    assert.equal(offers.length, 0);
    paused = false;
    await service.syncNow();
    assert.equal(offers.length, 1);
    now = new Date("2026-09-21T12:00:00.000Z");
    await service.submit({ feelingCode: "steady", note: null, settingsRevision: 3 });
    assert.equal(offers.length, 1);
    assert.equal(service.stateStore.snapshot()?.lastManualSubmissionWeek, "2026-09-21");
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mascot offers use only local state and do not create server telemetry", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-offer-local-test-"));
  try {
    let syncCalls = 0;
    let submitCalls = 0;
    let pauseCalls = 0;
    const api = {
      getManagerCheckInSync: async () => {
        syncCalls += 1;
        return createSyncResponse();
      },
      submitManagerCheckIn: async (_credential: string, input: { clientGeneratedId: string }) => {
        submitCalls += 1;
        return createSubmission(input.clientGeneratedId);
      },
      setScheduledOffersPaused: async () => {
        pauseCalls += 1;
        return false;
      },
    };
    const service = new ManagerCheckInService({
      teamStateStore: { snapshot: () => createTeamState() },
      credentialStore: createCredentialStore(),
      apiClient: api,
      stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }),
      now: () => new Date("2026-09-14T12:00:00.000Z"),
      offerWeeklyCheckIn: (_offer, onPresented) => {
        onPresented();
        return { shown: true };
      },
    });

    await service.start();
    const raw = await readFile(service.stateStore.statePath, "utf8");
    assert.equal(syncCalls, 1);
    assert.equal(submitCalls, 0);
    assert.equal(pauseCalls, 0);
    assert.equal(/app.?open|skipped|missed.?response/i.test(raw), false);
    assert.equal(JSON.parse(raw).lastWeeklyOfferWeek, "2026-09-14");
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Manager Check-in local state contains no app-open or non-response telemetry", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-state-test-"));
  try {
    const store = new ManagerCheckInStateStore({ userDataPath: root });
    store.ensureOrganization("org-1");
    const raw = await readFile(store.statePath, "utf8");
    assert.equal(/app.?open|offered|skipped|missed.?response/i.test(raw), false);
    assert.deepEqual(Object.keys(JSON.parse(raw)), ["version", "organizationId", "submissions", "scheduledOffersPaused"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted empty submission notes survive reload without losing pending retry state", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-empty-note-test-"));
  try {
    const statePath = join(root, "state.json");
    const store = new ManagerCheckInStateStore({ statePath });
    const emptyNoteSubmission = {
      ...createSubmission("empty-note"),
      note: "",
    };

    store.replaceFromSync({
      organizationId: "org-1",
      deviceId: "device-1",
      employeeIdentityId: "employee-1",
      settings,
      submissions: [emptyNoteSubmission],
      scheduledOffersPaused: false,
      syncedAt: "2026-09-14T00:00:00.000Z",
    });
    store.setPendingSubmission({
      clientGeneratedId: "pending-retry",
      feelingCode: "steady",
      note: null,
      settingsRevision: settings.revision,
    });

    const reloaded = new ManagerCheckInStateStore({ statePath });
    const snapshot = reloaded.snapshot();
    assert.equal(snapshot?.submissions[0]?.note, "");
    assert.equal(snapshot?.pendingSubmission?.clientGeneratedId, "pending-retry");

    let retriedClientId = "";
    const service = new ManagerCheckInService({
      teamStateStore: { snapshot: () => createTeamState() },
      credentialStore: createCredentialStore(),
      apiClient: {
        getManagerCheckInSync: async () => createSyncResponse({
          submissions: [emptyNoteSubmission],
        }),
        submitManagerCheckIn: async (_credential: string, input: { clientGeneratedId: string }) => {
          retriedClientId = input.clientGeneratedId;
          return createSubmission(input.clientGeneratedId);
        },
        setScheduledOffersPaused: async () => false,
      },
      stateStore: reloaded,
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    });
    await service.start();
    assert.equal(retriedClientId, "pending-retry");
    assert.equal(reloaded.snapshot()?.pendingSubmission, undefined);
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("credential-unavailable snapshots hide cached data but preserve pending work for matching sync", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-credential-test-"));
  try {
    const stateStore = new ManagerCheckInStateStore({ statePath: join(root, "state.json") });
    stateStore.ensureOrganization("org-1");
    stateStore.replaceFromSync({
      organizationId: "org-1",
      deviceId: "device-1",
      employeeIdentityId: "employee-1",
      settings,
      submissions: [createSubmission("cached")],
      scheduledOffersPaused: false,
      syncedAt: "2026-09-14T00:00:00.000Z",
    });
    stateStore.setPendingSubmission({
      clientGeneratedId: "pending",
      feelingCode: "steady",
      note: null,
      settingsRevision: 3,
    });
    let credential: string | null = null;
    let retriedClientId = "";
    const service = new ManagerCheckInService({
      teamStateStore: { snapshot: () => createTeamState() },
      credentialStore: {
        load: () => credential,
        save: () => undefined,
        clear: () => undefined,
      },
      apiClient: {
        getManagerCheckInSync: async () => createSyncResponse(),
        submitManagerCheckIn: async (_credential: string, input: { clientGeneratedId: string }) => {
          retriedClientId = input.clientGeneratedId;
          return createSubmission(input.clientGeneratedId);
        },
        setScheduledOffersPaused: async () => false,
      },
      stateStore,
    });
    const snapshot = service.getSnapshot();
    assert.equal(snapshot.availability, "unavailable");
    assert.equal(snapshot.settings, null);
    assert.deepEqual(snapshot.submissions, []);
    assert.equal(snapshot.scheduledOffersPaused, false);
    assert.equal(stateStore.snapshot()?.pendingSubmission?.clientGeneratedId, "pending");
    credential = "credential";
    await service.start();
    assert.equal(retriedClientId, "pending");
    assert.equal(stateStore.snapshot()?.pendingSubmission, undefined);
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("changed device before authoritative sync cannot reuse an old pending client ID", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-device-test-"));
  try {
    const stateStore = new ManagerCheckInStateStore({ statePath: join(root, "state.json") });
    stateStore.ensureOrganization("org-1");
    stateStore.replaceFromSync({
      organizationId: "org-1",
      deviceId: "device-old",
      employeeIdentityId: "employee-1",
      settings,
      submissions: [],
      scheduledOffersPaused: false,
      syncedAt: "2026-09-14T00:00:00.000Z",
    });
    stateStore.setPendingSubmission({
      clientGeneratedId: "old-pending",
      feelingCode: "steady",
      note: null,
      settingsRevision: 3,
    });
    let sentClientId = "";
    const api = {
      getManagerCheckInSync: async () => {
        throw new TypeError("sync unavailable");
      },
      submitManagerCheckIn: async (_credential: string, input: { clientGeneratedId: string }) => {
        sentClientId = input.clientGeneratedId;
        return createSubmission(input.clientGeneratedId);
      },
      setScheduledOffersPaused: async () => false,
    };
    const service = new ManagerCheckInService({
      teamStateStore: {
        snapshot: () => ({ ...createTeamState(), deviceId: "device-new" }),
      },
      credentialStore: createCredentialStore(),
      apiClient: api,
      stateStore,
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    });
    await service.start();
    await assert.rejects(
      () => service.submit({ feelingCode: "steady", note: null, settingsRevision: 3 }),
      /binding is unavailable/,
    );
    assert.equal(sentClientId, "");
    assert.equal(stateStore.snapshot()?.pendingSubmission, undefined);
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale revision conflicts clear pending input, refresh settings, and surface the conflict", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-conflict-test-"));
  try {
    let revision = 3;
    let submissions = 0;
    const api = {
      getManagerCheckInSync: async () => createSyncResponse({
        settings: { ...settings, revision },
      }),
      submitManagerCheckIn: async (_credential: string, input: { clientGeneratedId: string; feelingCode: "steady"; note: string | null; settingsRevision: number }) => {
        submissions += 1;
        if (submissions === 1) {
          revision = 4;
          throw new TeamApiError(409, "settings_revision_conflict", "Teams API request failed with HTTP 409.");
        }
        return createSubmission(input.clientGeneratedId, 4);
      },
      setScheduledOffersPaused: async () => false,
    };
    const service = new ManagerCheckInService({
      teamStateStore: { snapshot: () => createTeamState() },
      credentialStore: createCredentialStore(),
      apiClient: api,
      stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }),
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    });
    await service.start();
    await assert.rejects(
      () => service.submit({ feelingCode: "steady", note: null, settingsRevision: 3 }),
      /HTTP 409/,
    );
    assert.equal(service.stateStore.snapshot()?.pendingSubmission, undefined);
    assert.equal(service.stateStore.snapshot()?.settings?.revision, 4);
    await service.submit({ feelingCode: "steady", note: null, settingsRevision: 4 });
    assert.equal(submissions, 2);
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cached projections stay hidden across organization and employee binding changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-binding-test-"));
  try {
    const stateStore = new ManagerCheckInStateStore({ statePath: join(root, "state.json") });
    stateStore.ensureOrganization("org-1");
    stateStore.replaceFromSync({
      organizationId: "org-1",
      deviceId: "device-1",
      employeeIdentityId: "employee-old",
      settings,
      submissions: [createSubmission("old")],
      scheduledOffersPaused: false,
      syncedAt: "2026-09-14T00:00:00.000Z",
    });
    const api = {
      getManagerCheckInSync: async () => createSyncResponse({
        organization: { id: "org-other", name: "Other" },
        employee: { id: "employee-new", displayName: "New" },
      }),
      submitManagerCheckIn: async () => createSubmission("new"),
      setScheduledOffersPaused: async () => false,
    };
    const service = new ManagerCheckInService({
      teamStateStore: {
        snapshot: () => ({ ...createTeamState(), deviceId: "device-1" }),
      },
      credentialStore: createCredentialStore(),
      apiClient: api,
      stateStore,
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    });
    await service.start();
    assert.deepEqual(service.getSnapshot().submissions, []);
    assert.equal(stateStore.snapshot()?.submissions.length, 0);
    await service.stop();

    stateStore.replaceFromSync({
      organizationId: "org-1",
      deviceId: "device-1",
      employeeIdentityId: "employee-old",
      settings,
      submissions: [createSubmission("old-again")],
      scheduledOffersPaused: false,
      syncedAt: "2026-09-14T00:00:00.000Z",
    });
    const changedIdentityApi = {
      ...api,
      getManagerCheckInSync: async () => createSyncResponse({
        employee: { id: "employee-new", displayName: "New" },
      }),
    };
    const changed = new ManagerCheckInService({
      teamStateStore: {
        snapshot: () => ({ ...createTeamState(), deviceId: "device-1" }),
      },
      credentialStore: createCredentialStore(),
      apiClient: changedIdentityApi,
      stateStore,
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    });
    await changed.start();
    assert.deepEqual(changed.getSnapshot().submissions, []);
    assert.equal(stateStore.snapshot()?.employeeIdentityId, "employee-new");
    await changed.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cursor history pages beyond the bounded 200-entry cache without exposing other employees", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-history-test-"));
  try {
    const makePage = (
      start: number,
      count: number,
      nextCursor: string | null,
    ): ManagerCheckInSyncResponse => createSyncResponse({
      submissions: Array.from(
        { length: count },
        (_, offset) => createSubmission(
          `client-${start + offset}`,
          3,
          `submission-${start + offset}`,
        ),
      ),
      nextCursor,
    });
    const api = {
      getManagerCheckInSync: async (_credential: string, cursor?: string) => {
        if (cursor === "cursor-2") {
          return makePage(200, 1, null);
        }
        if (cursor === "cursor-1") {
          return makePage(100, 100, "cursor-2");
        }
        return makePage(0, 100, "cursor-1");
      },
      submitManagerCheckIn: async () => createSubmission("unused"),
      setScheduledOffersPaused: async () => false,
    };
    const service = new ManagerCheckInService({
      teamStateStore: { snapshot: () => createTeamState() },
      credentialStore: createCredentialStore(),
      apiClient: api,
      stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }),
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    });
    await service.start();
    assert.equal(service.stateStore.snapshot()?.submissions.length, 200);
    const page = await service.getHistory("cursor-2");
    assert.equal(page.submissions.length, 1);
    assert.equal(page.submissions[0]?.clientGeneratedId, "client-200");
    assert.equal(service.stateStore.snapshot()?.submissions.length, 200);
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("full persisted manager state uses UTF-8 bytes and remains recoverable after trimming", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-manager-check-in-size-test-"));
  try {
    const statePath = join(root, "state.json");
    const store = new ManagerCheckInStateStore({ statePath });
    store.ensureOrganization("org-1");
    store.replaceFromSync({
      organizationId: "org-1",
      deviceId: "device-1",
      employeeIdentityId: "employee-1",
      settings,
      submissions: [],
      scheduledOffersPaused: false,
      syncedAt: "2026-09-14T00:00:00.000Z",
    });
    store.setPendingSubmission({
      clientGeneratedId: "pending",
      feelingCode: "steady",
      note: null,
      settingsRevision: settings.revision,
    });
    const multibyte = createSubmission("multibyte", 3, "multibyte");
    const oversized = Array.from({ length: 200 }, (_, index) => ({
      ...multibyte,
      id: `multibyte-${index}`,
      clientGeneratedId: `multibyte-${index}`,
      note: "😀".repeat(500),
      promptSnapshot: {
        ...multibyte.promptSnapshot,
        title: "漢".repeat(200),
      },
    }));
    store.replaceFromSync({
      organizationId: "org-1",
      deviceId: "device-1",
      employeeIdentityId: "employee-1",
      settings,
      submissions: oversized,
      scheduledOffersPaused: false,
      syncedAt: "2026-09-14T00:00:00.000Z",
    });
    const raw = await readFile(statePath);
    assert.ok(raw.byteLength <= 512 * 1024);
    assert.equal(store.snapshot()?.pendingSubmission?.clientGeneratedId, "pending");
    const restarted = new ManagerCheckInStateStore({ statePath });
    assert.ok(restarted.snapshot());
    assert.ok((restarted.snapshot()?.submissions.length ?? 0) < 200);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Team API errors retain bounded manager check-in error codes", async () => {
  const client = new TeamApiClient({
    baseUrl: "https://teams.example.test",
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: "settings_revision_conflict", details: { currentRevision: 4 } } }), { status: 409 }),
  });
  await assert.rejects(
    () => client.setScheduledOffersPaused("credential", true),
    (error: unknown) => error instanceof TeamApiError && error.code === "settings_revision_conflict" && error.status === 409,
  );
});

test("Manager Check-in pagination forwards valid opaque cursor punctuation unchanged", async () => {
  const serverCursor = "cursor.v1:/page+2?opaque=value=";
  const receivedCursors: Array<string | null> = [];
  let requestCount = 0;
  const client = new TeamApiClient({
    baseUrl: "https://teams.example.test",
    fetchImpl: async (url) => {
      const requestUrl = new URL(String(url));
      receivedCursors.push(requestUrl.searchParams.get("cursor"));
      requestCount += 1;
      const responseBody = requestCount === 1
        ? createSyncResponse({ nextCursor: serverCursor })
        : createSyncResponse({ nextCursor: null });
      return new Response(JSON.stringify(responseBody), { status: 200 });
    },
  });

  const firstPage = await client.getManagerCheckInSync("credential");
  const secondPage = await client.getManagerCheckInSync("credential", firstPage.nextCursor ?? undefined);

  assert.equal(firstPage.nextCursor, serverCursor);
  assert.equal(secondPage.nextCursor, null);
  assert.deepEqual(receivedCursors, [null, serverCursor]);
});
