import assert from "node:assert/strict";

import { reconcileAppLauncherDraftNames } from "../src/app-launcher-draft-names.js";
import type { AppLauncherSnapshotEntry } from "../src/app-launcher-types.js";

const entries: readonly AppLauncherSnapshotEntry[] = [
  { id: "editor", name: "Editor", available: true },
  { id: "calendar", name: "Calendar", available: true },
];

const editedDrafts = { editor: "My Editor", calendar: "My Calendar" };
const reordered = reconcileAppLauncherDraftNames(editedDrafts, [...entries].reverse());
assert.deepEqual(reordered, editedDrafts, "reordering launchers preserves unsaved names");

const targetPickerCancelled = reconcileAppLauncherDraftNames(editedDrafts, entries);
assert.deepEqual(targetPickerCancelled, editedDrafts, "cancelling target selection preserves unsaved names");

const savedOne = reconcileAppLauncherDraftNames(
  editedDrafts,
  [
    { id: "editor", name: "Editor Pro", available: true },
    entries[1]!,
  ],
  "editor",
);
assert.deepEqual(savedOne, { editor: "Editor Pro", calendar: "My Calendar" }, "saving one name resets only that draft");

const removedOne = reconcileAppLauncherDraftNames(editedDrafts, [entries[1]!]);
assert.deepEqual(removedOne, { calendar: "My Calendar" }, "removing an entry drops only its draft");

const addedOne = reconcileAppLauncherDraftNames({}, [...entries, { id: "mail", name: "Mail", available: true }]);
assert.deepEqual(addedOne, { editor: "Editor", calendar: "Calendar", mail: "Mail" }, "new entries start with their saved names");

console.log("App launcher draft preservation passed.");
