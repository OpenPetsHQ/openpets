import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPersistedLanStatePath, readPersistedLanState, writePersistedLanState } from "../src/lan-persistence.js";
import type { LanState } from "../src/lan-contract.js";

const root = mkdtempSync(join(tmpdir(), "openpets-lan-persist-"));
try {
  assert.equal(readPersistedLanState(root), null, "missing LAN state file should read as null");

  const state: LanState = {
    enabled: true,
    currentHost: "office-pc",
    clients: [],
    updatedAt: 12_345,
  };
  writePersistedLanState(root, state);

  assert.deepEqual(readPersistedLanState(root), {
    version: 1,
    currentHost: "office-pc",
    updatedAt: 12_345,
  });

  writeFileSync(getPersistedLanStatePath(root), "{not-json", "utf8");
  assert.equal(readPersistedLanState(root), null, "invalid persisted LAN state should be ignored");

  writeFileSync(getPersistedLanStatePath(root), JSON.stringify({ currentHost: "  trimmed-host  ", updatedAt: "42" }), "utf8");
  assert.deepEqual(readPersistedLanState(root), {
    version: 1,
    currentHost: "trimmed-host",
    updatedAt: 42,
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("LAN persistence validation passed.");
