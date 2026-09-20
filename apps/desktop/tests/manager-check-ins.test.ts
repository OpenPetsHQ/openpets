import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { isRecurrenceDueOnDate } from "../src/manager-check-in-schedule.js";
import { ManagerCheckInService } from "../src/manager-check-in-service.js";
import { ManagerCheckInStateStore } from "../src/manager-check-in-state.js";
import type { ManagerCheckInSchedule, ManagerCheckInSubmission, ManagerCheckInSyncResponse } from "../src/team-api-client.js";
import type { SecureCredentialStore } from "../src/team-state.js";

const notice = { version: 1 as const, text: "Submitted check-ins are visible to your organization's Teams dashboard." };
const labels = { good: "Good", steady: "Steady", stretched: "Stretched", struggling: "Struggling", need_support: "Need support" } as const;

function schedule(id: string, recurrence: ManagerCheckInSchedule["recurrence"], revision = 1): ManagerCheckInSchedule {
  return { id, revision, name: id, enabled: true, recurrence, title: `Prompt ${id}`, introduction: "Voluntary.", acknowledgement: "Thanks.", notePlaceholder: "Add a note", labels: { ...labels } };
}

function teamState() {
  return { version: 1 as const, installationId: "desktop-1", organizationId: "org-1", organizationName: "Acme", deviceId: "device-1", pendingRevision: 0, appliedRevision: 0 };
}

function credentials(): SecureCredentialStore {
  return { load: () => "credential", save: () => undefined, clear: () => undefined };
}

function syncResponse(schedules: readonly ManagerCheckInSchedule[], history: readonly ManagerCheckInSubmission[] = []): ManagerCheckInSyncResponse {
  return { schedules, employee: { id: "employee-1", displayName: "Alice" }, visibilityNotice: notice, history, nextCursor: null };
}

function submission(input: { clientGeneratedId: string; scheduleId: string; scheduleRevision: number; cycleLocalDate: string }): ManagerCheckInSubmission {
  const current = schedule(input.scheduleId, { kind: "daily", intervalDays: 1, startsOn: input.cycleLocalDate }, input.scheduleRevision);
  return {
    id: `submission-${input.clientGeneratedId}`,
    clientGeneratedId: input.clientGeneratedId,
    scheduleId: input.scheduleId,
    scheduleRevision: input.scheduleRevision,
    cycleId: `${input.scheduleId}:${input.cycleLocalDate}`,
    cycleLocalDate: input.cycleLocalDate,
    feelingCode: "steady",
    note: null,
    submittedAt: "2026-09-14T10:00:00.000Z",
    scheduleSnapshot: { scheduleId: current.id, scheduleName: current.name, scheduleRevision: current.revision, recurrence: current.recurrence, title: current.title, introduction: current.introduction, acknowledgement: current.acknowledgement, notePlaceholder: current.notePlaceholder, labels: current.labels, visibilityNotice: notice },
  };
}

test("recurrence uses desktop dates, Monday intervals, and skips unavailable month dates", () => {
  assert.equal(isRecurrenceDueOnDate({ kind: "weekly", intervalWeeks: 2, startsOn: "2026-09-02", weekdays: [1, 3] }, "2026-09-14"), true);
  assert.equal(isRecurrenceDueOnDate({ kind: "weekly", intervalWeeks: 2, startsOn: "2026-09-02", weekdays: [1, 3] }, "2026-09-21"), false);
  assert.equal(isRecurrenceDueOnDate({ kind: "monthly", intervalMonths: 1, startsOn: "2024-01-31", dates: [31] }, "2024-02-29"), false);
  assert.equal(isRecurrenceDueOnDate({ kind: "monthly", intervalMonths: 1, startsOn: "2024-01-01", lastDay: true }, "2024-02-29"), true);
});

test("quarterly recurrence uses calendar quarter offsets and honors its start date", () => {
  const recurrence = { kind: "quarterly" as const, startsOn: "2026-02-15", quarterMonths: [1, 3], dates: [15] };
  assert.equal(isRecurrenceDueOnDate(recurrence, "2026-01-15"), false);
  assert.equal(isRecurrenceDueOnDate(recurrence, "2026-03-15"), true);
  assert.equal(isRecurrenceDueOnDate(recurrence, "2026-04-15"), true);
  assert.equal(isRecurrenceDueOnDate(recurrence, "2026-05-15"), false);
});

test("v1 state migration preserves only the device pause and drops ambiguous pending data", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-check-in-v1-"));
  try {
    const statePath = join(root, "state.json");
    await writeFile(statePath, JSON.stringify({ version: 1, organizationId: "org-1", scheduledOffersPaused: true, pendingSubmission: { clientGeneratedId: "old" } }));
    const state = new ManagerCheckInStateStore({ statePath }).snapshot()!;
    assert.equal(state.version, 2);
    assert.equal(state.devicePaused, true);
    assert.equal(state.pendingSubmission, undefined);
    assert.deepEqual(state.schedules, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("poisoned v2 records are rejected and expired receipt work is discarded", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-check-in-poison-"));
  try {
    const invalidPath = join(root, "invalid.json");
    await writeFile(invalidPath, JSON.stringify({ version: 2, organizationId: "org-1", schedules: [{ id: "bad", revision: 0, enabled: true }], submissions: [], nudgeCycleIds: [], committedCycleIds: [], devicePaused: false }));
    assert.equal(new ManagerCheckInStateStore({ statePath: invalidPath }).snapshot(), null);

    const expiredPath = join(root, "expired.json");
    await writeFile(expiredPath, JSON.stringify({
      version: 2,
      organizationId: "org-1",
      schedules: [],
      submissions: [],
      nudgeCycleIds: [],
      committedCycleIds: [],
      devicePaused: false,
      pendingSubmission: {
        clientGeneratedId: "client-1",
        scheduleId: "schedule-1",
        scheduleRevision: 1,
        cycleLocalDate: "2026-09-14",
        timeZone: "UTC",
        feelingCode: "good",
        note: null,
        receipt: "receipt-12345678901234567890",
        receiptExpiresAt: "2020-01-01T00:00:00.000Z",
      },
    }));
    assert.equal(new ManagerCheckInStateStore({ statePath: expiredPath }).snapshot()?.pendingSubmission, undefined);

    const pending = {
      clientGeneratedId: "client-1",
      scheduleId: "schedule-1",
      scheduleRevision: 1,
      cycleLocalDate: "2026-09-14",
      timeZone: "UTC",
      feelingCode: "good",
      note: null,
    };
    for (const [name, extra] of [
      ["orphan-receipt", { receipt: "receipt-12345678901234567890" }],
      ["orphan-expiry", { receiptExpiresAt: "2026-12-15T00:15:00.000Z" }],
    ] as const) {
      const orphanPath = join(root, `${name}.json`);
      await writeFile(orphanPath, JSON.stringify({
        version: 2,
        organizationId: "org-1",
        schedules: [],
        submissions: [],
        nudgeCycleIds: [],
        committedCycleIds: [],
        devicePaused: false,
        pendingSubmission: { ...pending, ...extra },
      }));
      assert.equal(new ManagerCheckInStateStore({ statePath: orphanPath }).snapshot()?.pendingSubmission, undefined);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("service queues schedules in server order and progresses one cycle at a time", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-check-in-queue-"));
  try {
    const first = schedule("first", { kind: "daily", intervalDays: 1, startsOn: "2026-09-14" });
    const second = schedule("second", { kind: "daily", intervalDays: 1, startsOn: "2026-09-14" });
    let history: ManagerCheckInSubmission[] = [];
    let submittedInput: Record<string, unknown> | undefined;
    const offers: string[] = [];
    const api = {
      getManagerCheckInSync: async () => syncResponse([first, second], history),
      createManagerCheckInSubmissionReceipt: async () => ({ receipt: "receipt-12345678901234567890", expiresAt: "2026-12-15T00:15:00.000Z" }),
      submitManagerCheckIn: async (_credential: string, input: { clientGeneratedId: string; scheduleId: string; scheduleRevision: number; cycleLocalDate: string }) => {
        submittedInput = input;
        const result = submission(input);
        history = [result];
        return result;
      },
    };
    const service = new ManagerCheckInService({ teamStateStore: { snapshot: () => teamState() }, credentialStore: credentials(), apiClient: api, stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }), now: () => new Date("2026-09-14T12:00:00") , offerWeeklyCheckIn: (item, onPresented) => { offers.push(item.scheduleId); onPresented(); return { shown: true }; } });
    await service.start();
    assert.equal(service.getPetSnapshot().pendingCount, 2);
    assert.equal(service.getPetSnapshot().activeItem?.scheduleId, "first");
    assert.deepEqual(offers, ["first"]);
    await assert.rejects(() => service.submit({ scheduleId: "second", scheduleRevision: 1, cycleId: "second:2026-09-14", feelingCode: "steady", note: null }));
    await assert.rejects(() => service.submit({ scheduleId: "first", scheduleRevision: 99, cycleId: "first:2026-09-14", feelingCode: "steady", note: null }));
    await service.syncNow();
    assert.deepEqual(offers, ["first"]);
    await service.submit({ scheduleId: "first", scheduleRevision: 1, cycleId: "first:2026-09-14", feelingCode: "steady", note: null });
    assert.equal("receiptExpiresAt" in (submittedInput ?? {}), false);
    assert.equal(service.getPetSnapshot().pendingCount, 1);
    assert.equal(service.getPetSnapshot().activeItem?.scheduleId, "second");
    assert.deepEqual(offers, ["first", "second"]);
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("closing a nudge does not submit or mark a cycle, while local pause hides and resume restores it", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-check-in-pause-"));
  try {
    const item = schedule("one", { kind: "daily", intervalDays: 1, startsOn: "2026-09-14" });
    let shown = 0;
    let receiptCalls = 0;
    const service = new ManagerCheckInService({ teamStateStore: { snapshot: () => teamState() }, credentialStore: credentials(), apiClient: { getManagerCheckInSync: async () => syncResponse([item]), createManagerCheckInSubmissionReceipt: async () => { receiptCalls += 1; return { receipt: "receipt-12345678901234567890", expiresAt: "2026-12-15T00:15:00.000Z" }; }, submitManagerCheckIn: async () => { throw new Error("not expected"); } }, stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }), now: () => new Date("2026-09-14T12:00:00"), offerWeeklyCheckIn: () => { shown += 1; return { shown: false, reason: "closed" }; } });
    await service.start();
    assert.equal(shown, 1);
    assert.equal(receiptCalls, 0);
    await service.setDevicePaused(true);
    assert.equal(service.getPetSnapshot().pendingCount, 0);
    await service.setDevicePaused(false);
    assert.equal(service.getPetSnapshot().pendingCount, 1);
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a queued nudge clears its presentation latch and can be offered after a later sync", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-check-in-queued-"));
  try {
    const item = schedule("one", { kind: "daily", intervalDays: 1, startsOn: "2026-09-14" });
    let attempts = 0;
    const service = new ManagerCheckInService({
      teamStateStore: { snapshot: () => teamState() },
      credentialStore: credentials(),
      apiClient: {
        getManagerCheckInSync: async () => syncResponse([item]),
        createManagerCheckInSubmissionReceipt: async () => ({ receipt: "receipt-12345678901234567890", expiresAt: "2026-12-15T00:15:00.000Z" }),
        submitManagerCheckIn: async () => { throw new Error("not expected"); },
      },
      stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }),
      now: () => new Date("2026-09-14T12:00:00"),
      offerWeeklyCheckIn: () => {
        attempts += 1;
        return attempts === 1 ? { shown: false, reason: "queued" } : { shown: false, reason: "ejected" };
      },
    });
    await service.start();
    await service.syncNow();
    assert.equal(attempts, 2);
    assert.deepEqual(service.stateStore.snapshot()?.nudgeCycleIds, []);
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ambiguous retry stays bound to schedule and cycle, but a revision change drops it", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-check-in-binding-"));
  try {
    let current = schedule("one", { kind: "daily", intervalDays: 1, startsOn: "2026-09-14" }, 1);
    const service = new ManagerCheckInService({ teamStateStore: { snapshot: () => teamState() }, credentialStore: credentials(), apiClient: { getManagerCheckInSync: async () => syncResponse([current]), createManagerCheckInSubmissionReceipt: async () => ({ receipt: "receipt-12345678901234567890", expiresAt: "2026-12-15T00:15:00.000Z" }), submitManagerCheckIn: async () => { throw new TypeError("fetch failed"); } }, stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }), now: () => new Date("2026-09-14T12:00:00") });
    await service.start();
    await assert.rejects(() => service.submit({ scheduleId: "one", scheduleRevision: 1, cycleId: "one:2026-09-14", feelingCode: "good", note: null }));
    assert.ok(service.stateStore.snapshot()?.pendingSubmission);
    current = schedule("one", { kind: "daily", intervalDays: 1, startsOn: "2026-09-14" }, 2);
    await service.syncNow();
    assert.equal(service.stateStore.snapshot()?.pendingSubmission, undefined);
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("receipt-bound pending submission survives after-midnight sync and history failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-check-in-read-failure-"));
  try {
    const item = schedule("one", { kind: "daily", intervalDays: 1, startsOn: "2026-09-14" });
    let now = new Date("2026-09-14T23:59:00");
    let syncCalls = 0;
    const service = new ManagerCheckInService({
      teamStateStore: { snapshot: () => teamState() },
      credentialStore: credentials(),
      apiClient: {
        getManagerCheckInSync: async () => {
          syncCalls += 1;
          if (syncCalls > 1) throw new Error("malformed sync history");
          return syncResponse([item]);
        },
        createManagerCheckInSubmissionReceipt: async () => ({ receipt: "receipt-12345678901234567890", expiresAt: "2026-12-15T00:15:00.000Z" }),
        submitManagerCheckIn: async () => { throw new TypeError("fetch failed"); },
      },
      stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }),
      now: () => now,
    });
    await service.start();
    await assert.rejects(() => service.submit({ scheduleId: "one", scheduleRevision: 1, cycleId: "one:2026-09-14", feelingCode: "good", note: "after midnight" }));
    const pendingBeforeFailure = service.stateStore.snapshot()?.pendingSubmission;
    assert.equal(pendingBeforeFailure?.receipt, "receipt-12345678901234567890");

    now = new Date("2026-09-15T00:01:00");
    await assert.rejects(() => service.syncNow());
    assert.deepEqual(service.stateStore.snapshot()?.pendingSubmission, pendingBeforeFailure);
    await assert.rejects(() => service.getHistory());
    assert.deepEqual(service.stateStore.snapshot()?.pendingSubmission, pendingBeforeFailure);
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deterministic submission errors clear pending work without poisoning the queue", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-check-in-deterministic-error-"));
  try {
    const item = schedule("one", { kind: "daily", intervalDays: 1, startsOn: "2026-09-14" });
    const service = new ManagerCheckInService({
      teamStateStore: { snapshot: () => teamState() },
      credentialStore: credentials(),
      apiClient: {
        getManagerCheckInSync: async () => syncResponse([item]),
        createManagerCheckInSubmissionReceipt: async () => ({ receipt: "receipt-12345678901234567890", expiresAt: "2026-12-15T00:15:00.000Z" }),
        submitManagerCheckIn: async () => { throw new Error("malformed response"); },
      },
      stateStore: new ManagerCheckInStateStore({ statePath: join(root, "state.json") }),
      now: () => new Date("2026-09-14T12:00:00"),
    });
    await service.start();
    await assert.rejects(() => service.submit({ scheduleId: "one", scheduleRevision: 1, cycleId: "one:2026-09-14", feelingCode: "good", note: null }));
    assert.equal(service.stateStore.snapshot()?.pendingSubmission, undefined);
    assert.equal(service.getPetSnapshot().activeItem?.cycleId, "one:2026-09-14");
    await service.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
