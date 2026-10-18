import assert from "node:assert/strict";

import {
  isWhatsNewPreviewEnabled,
  normalizeLastSeenWhatsNewVersion,
  resolveMarkedSeenWhatsNewVersion,
  resolveStartupLastSeenWhatsNewVersion,
  selectPendingWhatsNew,
  whatsNewEntries,
  type WhatsNewEntry,
} from "../src/whats-new.js";

function entry(version: string): WhatsNewEntry {
  return {
    version,
    headlineKey: "whatsNew.v4_1_0.headline",
    summaryKey: "whatsNew.v4_1_0.summary",
    items: [],
    links: [],
  };
}

function pendingVersions(input: Parameters<typeof selectPendingWhatsNew>[0]): readonly string[] | null {
  const pending = selectPendingWhatsNew(input);
  return pending ? pending.entries.map((candidate) => candidate.version) : null;
}

// Fresh install: the running version is recorded as seen, so nothing is pending.
{
  const lastSeenVersion = resolveStartupLastSeenWhatsNewVersion({ storedVersion: undefined, isFreshInstall: true, currentVersion: "4.1.0" });
  assert.equal(lastSeenVersion, "4.1.0");
  assert.equal(pendingVersions({ entries: whatsNewEntries, currentVersion: "4.1.0", lastSeenVersion, preview: false }), null);
}

// Upgrade from a version without the field: the 4.1.0 entry is pending once 4.1.0 runs.
{
  const lastSeenVersion = resolveStartupLastSeenWhatsNewVersion({ storedVersion: undefined, isFreshInstall: false, currentVersion: "4.1.0" });
  assert.equal(lastSeenVersion, undefined);
  assert.deepEqual(pendingVersions({ entries: whatsNewEntries, currentVersion: "4.1.0", lastSeenVersion, preview: false }), ["4.1.0"]);
}

// An existing stored value always wins over the fresh-install default.
assert.equal(resolveStartupLastSeenWhatsNewVersion({ storedVersion: "4.0.1", isFreshInstall: true, currentVersion: "4.1.0" }), "4.0.1");

// A build older than an entry (e.g. a 4.0.1 dev build) never shows the next release's notes.
assert.equal(pendingVersions({ entries: whatsNewEntries, currentVersion: "4.0.1", lastSeenVersion: undefined, preview: false }), null);

// Multiple unseen entries come back newest first; future entries stay hidden.
assert.deepEqual(
  pendingVersions({
    entries: [entry("4.1.0"), entry("4.4.0"), entry("4.2.0"), entry("4.0.0")],
    currentVersion: "4.3.0",
    lastSeenVersion: "4.0.0",
    preview: false,
  }),
  ["4.2.0", "4.1.0"],
);

// Already seen: nothing pending, including after skipping straight past releases.
assert.equal(pendingVersions({ entries: whatsNewEntries, currentVersion: "4.1.0", lastSeenVersion: "4.1.0", preview: false }), null);
assert.equal(pendingVersions({ entries: whatsNewEntries, currentVersion: "4.2.0", lastSeenVersion: "4.1.5", preview: false }), null);

// Preview shows every entry regardless of the running or seen version.
assert.deepEqual(pendingVersions({ entries: whatsNewEntries, currentVersion: "4.0.1", lastSeenVersion: "9.0.0", preview: true }), ["4.1.0"]);
assert.equal(isWhatsNewPreviewEnabled({ OPENPETS_WHATS_NEW_PREVIEW: "1" }), true);
assert.equal(isWhatsNewPreviewEnabled({ OPENPETS_WHATS_NEW_PREVIEW: "true" }), false);
assert.equal(isWhatsNewPreviewEnabled({}), false);

// Persisted state normalization: valid versions are canonicalized, anything else is dropped.
assert.equal(normalizeLastSeenWhatsNewVersion("4.1.0"), "4.1.0");
assert.equal(normalizeLastSeenWhatsNewVersion("v4.1.0"), "4.1.0");
assert.equal(normalizeLastSeenWhatsNewVersion("4.1.0-beta.2"), "4.1.0");
assert.equal(normalizeLastSeenWhatsNewVersion("latest"), undefined);
assert.equal(normalizeLastSeenWhatsNewVersion(410), undefined);
assert.equal(normalizeLastSeenWhatsNewVersion(undefined), undefined);

// Marking seen records the running version but never moves backwards after a downgrade.
assert.equal(resolveMarkedSeenWhatsNewVersion(undefined, "4.1.0"), "4.1.0");
assert.equal(resolveMarkedSeenWhatsNewVersion("4.0.1", "4.1.0"), "4.1.0");
assert.equal(resolveMarkedSeenWhatsNewVersion("4.2.0", "4.1.0"), "4.2.0");

console.error("What's new selection validation passed.");
