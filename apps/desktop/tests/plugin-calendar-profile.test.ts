import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CalendarProfileCredentialStore } from "../src/plugin-calendar-profile.js";

function fakeEncryption(available = true, backend: "gnome_libsecret" | "basic_text" | "unknown" = "gnome_libsecret") {
  return {
    isAsyncEncryptionAvailable: async () => available,
    getSelectedStorageBackend: () => backend,
    encryptStringAsync: async (value: string) => Buffer.from(`sealed:${Buffer.from(value, "utf8").toString("base64")}`, "utf8"),
    decryptStringAsync: async (value: Buffer) => {
      const text = value.toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("invalid sealed profile");
      return { result: Buffer.from(text.slice("sealed:".length), "base64").toString("utf8"), shouldReEncrypt: false };
    },
  };
}

const root = await mkdtemp(join(tmpdir(), "openpets-calendar-profile-"));
try {
  const encryption = fakeEncryption();
  const firstStore = new CalendarProfileCredentialStore(root, encryption);
  const secondStore = new CalendarProfileCredentialStore(root, encryption);
  const [first, concurrent] = await Promise.all([firstStore.getOrCreate(), secondStore.getOrCreate()]);
  assert.equal(first, concurrent, "parallel host callers converge on one local-profile identity");
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);

  const stored = await readFile(join(root, "calendar-profile.enc"));
  assert.equal(stored.includes(Buffer.from(first)), false, "plaintext identity is never written to disk");
  assert.equal((await stat(join(root, "calendar-profile.enc"))).mode & 0o777, 0o600);
  assert.equal(await new CalendarProfileCredentialStore(root, encryption).getOrCreate(), first, "restart reads the OS-encrypted identity");

  const rotatingRoot = await mkdtemp(join(tmpdir(), "openpets-calendar-profile-rotation-"));
  try {
    let decryptCalls = 0;
    const rotatingEncryption = {
      ...fakeEncryption(),
      decryptStringAsync: async (value: Buffer) => {
        decryptCalls += 1;
        const text = value.toString("utf8");
        if (!text.startsWith("sealed:")) throw new Error("invalid sealed profile");
        return { result: Buffer.from(text.slice("sealed:".length), "base64").toString("utf8"), shouldReEncrypt: decryptCalls === 1 };
      },
      encryptStringAsync: async (value: string) => Buffer.from(`rotated:${value}`, "utf8"),
    };
    await writeFile(join(rotatingRoot, "calendar-profile.enc"), `sealed:${Buffer.from(first, "utf8").toString("base64")}`, { mode: 0o600 });
    assert.equal(await new CalendarProfileCredentialStore(rotatingRoot, rotatingEncryption).getOrCreate(), first);
    assert.equal(decryptCalls, 2, "key rotation requests the replacement plaintext from async safeStorage");
    assert.equal((await readFile(join(rotatingRoot, "calendar-profile.enc"), "utf8")).startsWith("rotated:"), true, "rotated identity is atomically re-encrypted");
  } finally {
    await rm(rotatingRoot, { recursive: true, force: true });
  }

  const unavailableRoot = await mkdtemp(join(tmpdir(), "openpets-calendar-profile-locked-"));
  try {
    await assert.rejects(() => new CalendarProfileCredentialStore(unavailableRoot, fakeEncryption(false)).getOrCreate(), /OS encryption is disabled/);
    await assert.rejects(() => new CalendarProfileCredentialStore(unavailableRoot, fakeEncryption(true, "basic_text"), "linux").getOrCreate(), /Linux keyring is not secure/);
  } finally {
    await rm(unavailableRoot, { recursive: true, force: true });
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("plugin-calendar-profile: all checks passed.");
