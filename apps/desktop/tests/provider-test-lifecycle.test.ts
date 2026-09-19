import assert from "node:assert/strict";

import {
  cancelProviderTranscriptionTestsForSender,
  ProviderTestReplacementLanes,
  registerProviderTestInitialization,
} from "../src/provider-test-lifecycle.js";

type Session = { readonly senderId: number; readonly session: { cancel(reason?: string): Promise<void> } };

async function rapidBegin(
  label: string,
  senderId: number,
  controller: AbortController,
  lanes: ProviderTestReplacementLanes,
  initializations: Map<number, Set<AbortController>>,
  sessions: Map<string, Session>,
  started: string[],
  cancelled: string[],
): Promise<void> {
  const unregister = registerProviderTestInitialization(initializations, senderId, controller);
  const preemption = cancelProviderTranscriptionTestsForSender(senderId, "Provider transcription test was preempted.", initializations, sessions, controller);
  try {
    await lanes.enqueue(senderId, async () => {
      await preemption;
      if (controller.signal.aborted) {
        cancelled.push(label);
        throw new Error("Provider transcription test was cancelled.");
      }
      started.push(label);
    });
  } finally {
    unregister();
  }
}

const lanes = new ProviderTestReplacementLanes();
const initializations = new Map<number, Set<AbortController>>();
const sessions = new Map<string, Session>();
const started: string[] = [];
const cancelled: string[] = [];
let releaseOldTeardown!: () => void;
const oldTeardown = new Promise<void>((resolve) => { releaseOldTeardown = resolve; });
sessions.set("old", { senderId: 7, session: { cancel: async () => oldTeardown } });

const first = rapidBegin("first", 7, new AbortController(), lanes, initializations, sessions, started, cancelled);
const second = rapidBegin("second", 7, new AbortController(), lanes, initializations, sessions, started, cancelled);
const latestController = new AbortController();
const latest = rapidBegin("latest", 7, latestController, lanes, initializations, sessions, started, cancelled);
await new Promise<void>((resolve) => setImmediate(resolve));
assert.deepEqual(started, [], "rapid replacements wait for the old session teardown");

releaseOldTeardown();
const results = await Promise.allSettled([first, second, latest]);
assert.equal(results[0]?.status, "rejected", "the first replacement is cancelled");
assert.equal(results[1]?.status, "rejected", "the second replacement is cancelled");
assert.equal(results[2]?.status, "fulfilled", "the latest replacement starts cleanly");
assert.deepEqual(cancelled, ["first", "second"]);
assert.deepEqual(started, ["latest"], "only the latest replacement reaches capture startup");

const lossLanes = new ProviderTestReplacementLanes();
const lossInitializations = new Map<number, Set<AbortController>>();
const lossSessions = new Map<string, Session>();
const lossController = new AbortController();
const lossStarted: string[] = [];
const lossUnregister = registerProviderTestInitialization(lossInitializations, 9, lossController);
let releaseQueuedTeardown!: () => void;
const queuedTeardown = new Promise<void>((resolve) => { releaseQueuedTeardown = resolve; });
lossSessions.set("queued-prior", { senderId: 9, session: { cancel: async () => queuedTeardown } });
const queuedPreemption = cancelProviderTranscriptionTestsForSender(9, "Provider transcription test was preempted.", lossInitializations, lossSessions, lossController);
const queuedStart = lossLanes.enqueue(9, async () => {
  await queuedPreemption;
  if (lossController.signal.aborted) throw new Error("Provider transcription test was cancelled.");
  lossStarted.push("queued");
});
const rendererLoss = cancelProviderTranscriptionTestsForSender(9, "renderer lost", lossInitializations, lossSessions);
await new Promise<void>((resolve) => setImmediate(resolve));
assert.equal(lossController.signal.aborted, true, "renderer loss cancels queued initialization");
releaseQueuedTeardown();
await Promise.allSettled([queuedStart, rendererLoss]);
lossUnregister();
assert.deepEqual(lossStarted, [], "renderer loss prevents later capture startup");

console.log("Provider transcription replacement serialization and renderer-loss behavior verified.");
