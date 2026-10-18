import assert from "node:assert/strict";

import {
  installControlCenterWhatsNewIpcHandlers,
  type ControlCenterWhatsNewIpcEvent,
  type ControlCenterWhatsNewIpcHandler,
} from "../src/control-center-whats-new-ipc.js";
import type { PendingWhatsNew, WhatsNewEntry } from "../src/whats-new.js";

const event: ControlCenterWhatsNewIpcEvent = { sender: { id: 3 } };
const entries: readonly WhatsNewEntry[] = [{
  version: "4.1.0",
  headlineKey: "whatsNew.v4_1_0.headline",
  summaryKey: "whatsNew.v4_1_0.summary",
  items: [],
  links: [{
    id: "release-notes",
    labelKey: "whatsNew.releaseNotes",
    url: "https://github.com/OpenPetsHQ/openpets/releases/tag/v4.1.0",
    emphasis: "secondary",
  }],
}];

function createHarness(options: {
  readonly currentVersion?: string;
  readonly lastSeenVersion?: string;
  readonly preview?: boolean;
  readonly authorize?: () => void;
} = {}) {
  const handlers = new Map<string, ControlCenterWhatsNewIpcHandler>();
  const opened: string[] = [];
  const state = { lastSeenVersion: options.lastSeenVersion };

  installControlCenterWhatsNewIpcHandlers({
    registerHandle: (channel, handler) => {
      handlers.set(channel, handler);
    },
    authorizeSender: () => options.authorize?.(),
    entries,
    getCurrentVersion: () => options.currentVersion ?? "4.1.0",
    getLastSeenVersion: () => state.lastSeenVersion,
    markSeen: (currentVersion) => {
      state.lastSeenVersion = currentVersion;
    },
    isPreviewEnabled: () => options.preview ?? false,
    openExternal: async (url) => {
      opened.push(url);
    },
    logger: { debug: () => undefined },
  });

  async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = handlers.get(channel);
    assert.ok(handler, `missing handler ${channel}`);
    return handler(event, ...args);
  }

  return { invoke, opened, state };
}

// An upgraded user sees the pending entry once; after marking seen it is gone.
{
  const harness = createHarness();
  const pending = await harness.invoke("openpets:whats-new-get") as PendingWhatsNew | null;
  assert.deepEqual(pending?.entries.map((candidate) => candidate.version), ["4.1.0"]);

  await harness.invoke("openpets:whats-new-mark-seen");
  assert.equal(harness.state.lastSeenVersion, "4.1.0");
  assert.equal(await harness.invoke("openpets:whats-new-get"), null);
}

// Preview overrides an older running version and an already-seen marker.
{
  const harness = createHarness({ currentVersion: "4.0.1", lastSeenVersion: "4.1.0", preview: true });
  const pending = await harness.invoke("openpets:whats-new-get") as PendingWhatsNew | null;
  assert.deepEqual(pending?.entries.map((candidate) => candidate.version), ["4.1.0"]);
}

// Links open only the URL declared in the changelog; unknown or malformed requests are refused.
{
  const harness = createHarness();
  await harness.invoke("openpets:whats-new-open-link", "4.1.0", "release-notes");
  assert.deepEqual(harness.opened, ["https://github.com/OpenPetsHQ/openpets/releases/tag/v4.1.0"]);

  await assert.rejects(() => harness.invoke("openpets:whats-new-open-link", "4.1.0", "https://evil.example"));
  await assert.rejects(() => harness.invoke("openpets:whats-new-open-link", "9.9.9", "release-notes"));
  await assert.rejects(() => harness.invoke("openpets:whats-new-open-link", { version: "4.1.0" }, "release-notes"));
  assert.equal(harness.opened.length, 1);
}

// Unauthorized senders cannot read, mark, or open anything.
{
  const harness = createHarness({
    authorize: () => {
      throw new Error("Unauthorized sender.");
    },
  });
  await assert.rejects(() => harness.invoke("openpets:whats-new-get"), /Unauthorized/);
  await assert.rejects(() => harness.invoke("openpets:whats-new-mark-seen"), /Unauthorized/);
  await assert.rejects(() => harness.invoke("openpets:whats-new-open-link", "4.1.0", "release-notes"), /Unauthorized/);
  assert.equal(harness.state.lastSeenVersion, undefined);
  assert.equal(harness.opened.length, 0);
}

console.error("Control Center what's new IPC validation passed.");
