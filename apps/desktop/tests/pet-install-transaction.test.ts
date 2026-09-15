import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPetInstallCandidate,
  createPetInstallStagingCandidate,
  assertNoUnresolvedPetInstallTransaction,
  getCanonicalInstalledPetDir,
  isPrivateMode,
  PetInstallStateMutationUncertainError,
  recoverPetInstallTransactions,
  runPetInstallTransaction,
  withPetInstallLock,
} from "../src/pet-install-transaction.js";

const root = await realpath(await mkdtemp(join(tmpdir(), "openpets-install-transaction-")));

function isWindowsDirectoryLinkUnavailable(error: unknown): boolean {
  if (process.platform !== "win32" || !error || typeof error !== "object" || !("code" in error)) return false;
  return ["EACCES", "EINVAL", "ENOTSUP", "EPERM", "UNKNOWN"].includes(String(error.code));
}

async function createDirectoryLink(target: string, link: string): Promise<boolean> {
  try {
    await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch (error) {
    if (isWindowsDirectoryLinkUnavailable(error)) return false;
    throw error;
  }
}

async function missing(path: string): Promise<void> {
  await assert.rejects(() => lstat(path), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT"));
}

async function candidate(petId: string, content = petId): Promise<string> {
  const dir = await createPetInstallCandidate(root, petId);
  await writeFile(join(dir, "pet.json"), content, { mode: 0o600 });
  return dir;
}

async function marker(
  txName: string,
  petId: string,
  phase: "prepared" | "backup-created" | "promoted" | "state-mutating" | "committed",
  candidateBasename: string,
  backupBasename: string,
  hadFinal: boolean,
  mutationOutcome?: "rejected" | "succeeded",
): Promise<string> {
  const txRoot = join(root, ".openpets-pet-transactions");
  const txDir = join(txRoot, txName);
  await mkdir(txDir, { recursive: true, mode: 0o700 });
  await writeFile(join(txDir, "journal.json"), `${JSON.stringify({ version: 1, phase, petId, finalBasename: petId, candidateBasename, backupBasename, hadFinal, ...(mutationOutcome ? { mutationOutcome } : {}) })}\n`, { mode: 0o600 });
  return txDir;
}

try {
  {
    const id = "first-error";
    const dir = await candidate(id);
    await assert.rejects(() => runPetInstallTransaction({ petsRoot: root, petId: id, candidateDir: dir, mutateState: () => { throw new Error("state rejected"); } }), /state rejected/);
    await missing(join(root, id));
    await missing(dir);
  }

  {
    const id = "overwrite-error";
    await mkdir(join(root, id), { mode: 0o700 });
    await writeFile(join(root, id, "pet.json"), "old", { mode: 0o600 });
    const dir = await candidate(id, "new");
    await assert.rejects(() => runPetInstallTransaction({ petsRoot: root, petId: id, candidateDir: dir, mutateState: () => { throw new Error("state rejected"); } }), /state rejected/);
    assert.equal(await readFile(join(root, id, "pet.json"), "utf8"), "old");
    await missing(dir);
  }

  {
    const id = "success";
    await mkdir(join(root, id), { mode: 0o700 });
    await writeFile(join(root, id, "pet.json"), "old", { mode: 0o600 });
    const dir = await candidate(id, "new");
    await runPetInstallTransaction({ petsRoot: root, petId: id, candidateDir: dir, mutateState: () => "ok" });
    assert.equal(await readFile(join(root, id, "pet.json"), "utf8"), "new");
    await missing(dir);
    const names = await readdir(root);
    assert.equal(names.some((name) => name.startsWith(".openpets-pet-backup-")), false);
    assert.equal(names.some((name) => name.endsWith(".openpets-pet-staging-owner.json")), false);
    assert.equal(names.some((name) => name.includes(".tmp-")), false);
    await missing(join(root, ".openpets-pet-transactions"));
  }

  {
    const id = "pending";
    const candidateName = ".openpets-pet-candidate-pending-abcdef";
    const backupName = ".openpets-pet-backup-pending-0123456789abcdef0123456789abcdef";
    await mkdir(join(root, candidateName), { mode: 0o700 });
    await writeFile(join(root, candidateName, "pet.json"), "new", { mode: 0o600 });
    await mkdir(join(root, id), { mode: 0o700 });
    await writeFile(join(root, id, "pet.json"), "new", { mode: 0o600 });
    await marker("tx-pending-11111111111111111111111111111111", id, "promoted", candidateName, backupName, false);
    await recoverPetInstallTransactions({ petsRoot: root });
    await missing(join(root, id));
    await missing(join(root, candidateName));
  }

  {
    const id = "committed";
    const candidateName = ".openpets-pet-candidate-committed-abcdef";
    const backupName = ".openpets-pet-backup-committed-0123456789abcdef0123456789abcdef";
    await mkdir(join(root, id), { mode: 0o700 });
    await writeFile(join(root, id, "pet.json"), "new", { mode: 0o600 });
    await mkdir(join(root, backupName), { mode: 0o700 });
    await writeFile(join(root, backupName, "pet.json"), "old", { mode: 0o600 });
    await marker("tx-committed-22222222222222222222222222222222", id, "committed", candidateName, backupName, true);
    await writeFile(join(root, ".openpets-pet-transactions", "tx-committed-22222222222222222222222222222222", "journal.json.tmp-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "stale", { mode: 0o600 });
    await recoverPetInstallTransactions({ petsRoot: root });
    assert.equal(await readFile(join(root, id, "pet.json"), "utf8"), "new");
    await missing(join(root, backupName));
    await missing(join(root, ".openpets-pet-transactions", "tx-committed-22222222222222222222222222222222"));
  }

  {
    // A successful promotion followed by a stale pre-promotion journal phase
    // is recovered from the verified topology, not the phase label.
    const id = "topology-lag";
    const candidateName = ".openpets-pet-candidate-topology-lag-abcdef";
    const backupName = ".openpets-pet-backup-topology-lag-0123456789abcdef0123456789abcdef";
    await mkdir(join(root, candidateName), { mode: 0o700 });
    await mkdir(join(root, id), { mode: 0o700 });
    await writeFile(join(root, id, "pet.json"), "new", { mode: 0o600 });
    await marker("tx-topology-lag-55555555555555555555555555555555", id, "prepared", candidateName, backupName, false);
    await recoverPetInstallTransactions({ petsRoot: root });
    await missing(join(root, id));
    await missing(join(root, candidateName));
    await missing(join(root, ".openpets-pet-transactions", "tx-topology-lag-55555555555555555555555555555555"));
  }

  {
    // A recovery retry completes a rollback after the first inspection fails.
    const outside = await mkdtemp(join(tmpdir(), "openpets-install-partial-rollback-"));
    const id = "retry-rollback";
    const backupName = ".openpets-pet-backup-retry-rollback-0123456789abcdef0123456789abcdef";
    await mkdir(join(root, id), { mode: 0o700 });
    await writeFile(join(root, id, "pet.json"), "new", { mode: 0o600 });
    const backupPath = join(root, backupName);
    try {
      const backupLinkCreated = await createDirectoryLink(outside, backupPath);
      await marker("tx-retry-rollback-66666666666666666666666666666666", id, "state-mutating", ".openpets-pet-candidate-retry-rollback-abcdef", backupName, true, "rejected");
      const warnings: string[] = [];
      await recoverPetInstallTransactions({ petsRoot: root, onWarning: ({ message }) => warnings.push(message) });
      if (backupLinkCreated) assert.ok(warnings.length > 0);
      assert.equal(await readFile(join(root, id, "pet.json"), "utf8"), "new");
      await rm(backupPath, { force: true });
      await mkdir(backupPath, { mode: 0o700 });
      await writeFile(join(backupPath, "pet.json"), "old", { mode: 0o600 });
      await recoverPetInstallTransactions({ petsRoot: root });
      assert.equal(await readFile(join(root, id, "pet.json"), "utf8"), "old");
      await missing(backupPath);
      await missing(join(root, ".openpets-pet-transactions", "tx-retry-rollback-66666666666666666666666666666666"));
    } finally {
      await rm(backupPath, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  }

  {
    // A duplicate trusted-ID journal blocks the whole ID, while another ID
    // remains independently recoverable.
    const id = "duplicate-group";
    const candidateOne = ".openpets-pet-candidate-duplicate-group-abcdef";
    const candidateTwo = ".openpets-pet-candidate-duplicate-group-fedcba";
    await mkdir(join(root, id), { mode: 0o700 });
    await writeFile(join(root, id, "pet.json"), "keep", { mode: 0o600 });
    await mkdir(join(root, candidateOne), { mode: 0o700 });
    await writeFile(join(root, candidateOne, "pet.json"), "candidate-one", { mode: 0o600 });
    await mkdir(join(root, candidateTwo), { mode: 0o700 });
    await writeFile(join(root, candidateTwo, "pet.json"), "candidate-two", { mode: 0o600 });
    await marker("tx-duplicate-group-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", id, "promoted", candidateOne, ".openpets-pet-backup-duplicate-group-0123456789abcdef0123456789abcdef", false);
    await marker("tx-duplicate-group-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", id, "prepared", candidateTwo, ".openpets-pet-backup-duplicate-group-fedcba9876543210fedcba9876543210", false);

    const otherId = "independent-recovery";
    const otherCandidate = ".openpets-pet-candidate-independent-recovery-abcdef";
    await mkdir(join(root, otherId), { mode: 0o700 });
    await mkdir(join(root, otherCandidate), { mode: 0o700 });
    await marker("tx-independent-recovery-cccccccccccccccccccccccccccccccc", otherId, "promoted", otherCandidate, ".openpets-pet-backup-independent-recovery-0123456789abcdef0123456789abcdef", false);

    const warnings: string[] = [];
    await recoverPetInstallTransactions({ petsRoot: root, onWarning: ({ message }) => warnings.push(message) });
    assert.ok(warnings.some((message) => message.includes("more than one journal")));
    assert.equal(await readFile(join(root, id, "pet.json"), "utf8"), "keep");
    await lstat(join(root, candidateOne));
    await lstat(join(root, candidateTwo));
    await lstat(join(root, ".openpets-pet-transactions", "tx-duplicate-group-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    await lstat(join(root, ".openpets-pet-transactions", "tx-duplicate-group-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));
    await missing(join(root, otherId));
    await missing(join(root, otherCandidate));
    await rm(join(root, id), { recursive: true, force: true });
    await rm(join(root, candidateOne), { recursive: true, force: true });
    await rm(join(root, candidateTwo), { recursive: true, force: true });
    await rm(join(root, ".openpets-pet-transactions"), { recursive: true, force: true });
  }

  {
    const id = "uncertain";
    const dir = await candidate(id);
    const warnings: string[] = [];
    await assert.rejects(() => runPetInstallTransaction({
      petsRoot: root,
      petId: id,
      candidateDir: dir,
      mutateState: () => { throw new PetInstallStateMutationUncertainError(); },
      onWarning: ({ message }) => warnings.push(message),
    }), PetInstallStateMutationUncertainError);
    assert.equal(warnings.length, 1);
    await lstat(join(root, id));
    await lstat(join(root, ".openpets-pet-transactions"));
    const transactionName = readdirSync(join(root, ".openpets-pet-transactions")).find((name) => name.startsWith(`tx-${id}-`));
    assert.ok(transactionName);
    await rm(join(root, id), { recursive: true, force: true });
    await rm(join(root, ".openpets-pet-transactions", transactionName), { recursive: true, force: true });
  }

  {
    const id = "promise-result";
    const dir = await candidate(id);
    await assert.rejects(() => runPetInstallTransaction({
      petsRoot: root,
      petId: id,
      candidateDir: dir,
      mutateState: () => Promise.resolve("must-not-commit"),
    }), (error: unknown) => error instanceof PetInstallStateMutationUncertainError && /must return synchronously/.test(error.message));
    const transactionName = readdirSync(join(root, ".openpets-pet-transactions")).find((name) => name.startsWith(`tx-${id}-`));
    assert.ok(transactionName);
    const journal = JSON.parse(await readFile(join(root, ".openpets-pet-transactions", transactionName, "journal.json"), "utf8")) as { phase: string; mutationOutcome?: string };
    assert.equal(journal.phase, "state-mutating");
    assert.equal(journal.mutationOutcome, "uncertain");
    await lstat(join(root, id));
    await rm(join(root, id), { recursive: true, force: true });
    await rm(join(root, ".openpets-pet-transactions", transactionName), { recursive: true, force: true });
  }

  {
    const id = "rejected-journal-failure";
    const dir = await candidate(id);
    await assert.rejects(() => runPetInstallTransaction({
      petsRoot: root,
      petId: id,
      candidateDir: dir,
      mutateState: () => { throw new Error("state rejected after deterministic journal failure"); },
      journalWriteFailure: (_phase, mutationOutcome) => mutationOutcome === "rejected"
        ? new Error("deterministic journal write failure")
        : undefined,
    }), /state rejected after deterministic journal failure/);
    await missing(join(root, ".openpets-pet-transactions"));
    await missing(join(root, id));
  }

  {
    const id = "fenced";
    const candidateName = ".openpets-pet-candidate-fenced-abcdef";
    const backupName = ".openpets-pet-backup-fenced-0123456789abcdef0123456789abcdef";
    await mkdir(join(root, id), { mode: 0o700 });
    await writeFile(join(root, id, "pet.json"), "new", { mode: 0o600 });
    await marker("tx-fenced-77777777777777777777777777777777", id, "state-mutating", candidateName, backupName, false);
    await assert.rejects(() => assertNoUnresolvedPetInstallTransaction(root, id), /unresolved state-mutating/);
    await assert.doesNotReject(() => assertNoUnresolvedPetInstallTransaction(root, "different-id"));
    await withPetInstallLock("builtin", async () => undefined);
    await recoverPetInstallTransactions({ petsRoot: root });
    await lstat(join(root, id));
    await lstat(join(root, ".openpets-pet-transactions", "tx-fenced-77777777777777777777777777777777"));
    await rm(join(root, id), { recursive: true, force: true });
    await rm(join(root, ".openpets-pet-transactions", "tx-fenced-77777777777777777777777777777777"), { recursive: true, force: true });
  }

  {
    const outside = await mkdtemp(join(tmpdir(), "openpets-install-outside-"));
    const id = "invalid-marker";
    const candidateName = ".openpets-pet-candidate-invalid-marker-abcdef";
    const backupName = ".openpets-pet-backup-invalid-marker-0123456789abcdef0123456789abcdef";
    await writeFile(join(outside, "sentinel"), "keep", { mode: 0o600 });
    await mkdir(join(root, candidateName), { mode: 0o700 });
    await marker("tx-invalid-marker-33333333333333333333333333333333", id, "promoted", "../outside", backupName, false);
    await writeFile(join(root, ".openpets-pet-transactions", "unknown.json"), "keep", { mode: 0o600 });
    await recoverPetInstallTransactions({ petsRoot: root });
    await lstat(join(root, ".openpets-pet-transactions", "tx-invalid-marker-33333333333333333333333333333333", "journal.json"));
    await lstat(join(root, ".openpets-pet-transactions", "unknown.json"));
    await lstat(join(outside, "sentinel"));
    await rm(outside, { recursive: true, force: true });
  }

  {
    const id = "malformed-same-id";
    const transactionRoot = join(root, ".openpets-pet-transactions");
    const transactionName = "tx-malformed-same-id-88888888888888888888888888888888";
    const transactionDir = join(transactionRoot, transactionName);
    await mkdir(transactionDir, { recursive: true, mode: 0o700 });
    await writeFile(join(transactionDir, "journal.json"), "{not valid json\n", { mode: 0o600 });
    await writeFile(join(transactionDir, "keep-me"), "keep", { mode: 0o600 });
    await writeFile(join(transactionDir, "journal.json.tmp-not-recognized"), "keep", { mode: 0o600 });
    await assert.rejects(() => assertNoUnresolvedPetInstallTransaction(root, id), /Pet malformed-same-id has/);
    await assert.doesNotReject(() => assertNoUnresolvedPetInstallTransaction(root, "unrelated-id"));
    await recoverPetInstallTransactions({ petsRoot: root });
    await lstat(join(transactionDir, "journal.json"));
    await lstat(join(transactionDir, "keep-me"));
    await lstat(join(transactionDir, "journal.json.tmp-not-recognized"));
    await rm(transactionDir, { recursive: true, force: true });
  }

  {
    const id = "incomplete-same-id";
    const transactionRoot = join(root, ".openpets-pet-transactions");
    const transactionName = "tx-incomplete-same-id-99999999999999999999999999999999";
    const transactionDir = join(transactionRoot, transactionName);
    await mkdir(transactionDir, { recursive: true, mode: 0o700 });
    await assert.doesNotReject(() => assertNoUnresolvedPetInstallTransaction(root, id));
    await assert.doesNotReject(() => assertNoUnresolvedPetInstallTransaction(root, "another-id"));
    await recoverPetInstallTransactions({ petsRoot: root });
    await missing(transactionDir);
  }

  {
    const id = "local";
    const candidateName = ".openpets-pet-candidate-local-abcdef";
    const backupName = ".openpets-pet-backup-local-0123456789abcdef0123456789abcdef";
    await mkdir(join(root, id), { mode: 0o700 });
    await writeFile(join(root, id, "pet.json"), "actual local", { mode: 0o600 });
    await marker("tx-local-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", id, "state-mutating", candidateName, backupName, false);
    await assert.rejects(() => createPetInstallCandidate(root, id), /Pet local has/);
    const staging = await createPetInstallStagingCandidate(root);
    assert.match(staging, /\.openpets-pet-candidate-__zip-import__-/);
    await rm(staging, { recursive: true, force: true });
    await rm(join(root, id), { recursive: true, force: true });
    await rm(join(root, ".openpets-pet-transactions"), { recursive: true, force: true });
  }

  {
    const owned = await createPetInstallStagingCandidate(root);
    await writeFile(join(owned, "partial.txt"), "owned", { mode: 0o600 });
    const legacy = join(root, ".openpets-pet-candidate-legacy-unmarked-abcdef");
    await mkdir(legacy, { mode: 0o700 });
    await writeFile(join(legacy, "keep.txt"), "legacy", { mode: 0o600 });
    await recoverPetInstallTransactions({ petsRoot: root });
    await missing(owned);
    await lstat(legacy);
    assert.equal(await readFile(join(legacy, "keep.txt"), "utf8"), "legacy");
    await rm(legacy, { recursive: true, force: true });

    const handedOff = await createPetInstallStagingCandidate(root);
    await runPetInstallTransaction({ petsRoot: root, petId: "staging-handoff", candidateDir: handedOff, mutateState: () => undefined });
    await lstat(join(root, "staging-handoff"));
    await missing(handedOff);
    await rm(join(root, "staging-handoff"), { recursive: true, force: true });
  }

  {
    const transactionRoot = join(root, ".openpets-pet-transactions");
    const emptyName = "tx-empty-cleanup-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await mkdir(join(transactionRoot, emptyName), { recursive: true, mode: 0o700 });
    await recoverPetInstallTransactions({ petsRoot: root });
    await missing(join(transactionRoot, emptyName));

    const unknownName = "tx-unknown-cleanup-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const unknownDir = join(transactionRoot, unknownName);
    await mkdir(unknownDir, { recursive: true, mode: 0o700 });
    await writeFile(join(unknownDir, "unknown-entry"), "keep", { mode: 0o600 });
    await recoverPetInstallTransactions({ petsRoot: root });
    await lstat(join(unknownDir, "unknown-entry"));
    await rm(unknownDir, { recursive: true, force: true });
  }

  {
    const id = "direct-child";
    const nested = join(root, "nested", ".openpets-pet-candidate-direct-child-abcdef");
    await mkdir(nested, { recursive: true, mode: 0o700 });
    await assert.rejects(() => runPetInstallTransaction({ petsRoot: root, petId: id, candidateDir: nested, mutateState: () => undefined }), /direct child/);
    await lstat(nested);

    const external = await mkdtemp(join(tmpdir(), "openpets-install-transaction-root-"));
    const txRoot = join(root, ".openpets-pet-transactions");
    const safeCandidate = await candidate(id);
    try {
      await rm(txRoot, { recursive: true, force: true });
      if (await createDirectoryLink(external, txRoot)) {
        const warnings: string[] = [];
        await assert.rejects(() => runPetInstallTransaction({ petsRoot: root, petId: id, candidateDir: safeCandidate, mutateState: () => undefined, onWarning: ({ message }) => warnings.push(message) }), /symlink/);
        await lstat(join(external));
        assert.equal(warnings.length, 0);
      }
    } finally {
      await rm(txRoot, { recursive: true, force: true });
      await rm(safeCandidate, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  }

  {
    const outside = await mkdtemp(join(tmpdir(), "openpets-install-canonical-root-"));
    const symlinkedRoot = join(root, "symlinked-pets-root");
    try {
      if (await createDirectoryLink(outside, symlinkedRoot)) {
        await assert.rejects(() => getCanonicalInstalledPetDir(symlinkedRoot, "symlink-guard"), /symlink/);
      }
    } finally {
      await rm(symlinkedRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  }

  {
    const id = "partial";
    const candidateName = ".openpets-pet-candidate-partial-abcdef";
    const backupName = ".openpets-pet-backup-partial-0123456789abcdef0123456789abcdef";
    await mkdir(join(root, backupName), { mode: 0o700 });
    await writeFile(join(root, backupName, "pet.json"), "old", { mode: 0o600 });
    await mkdir(join(root, candidateName), { mode: 0o700 });
    await marker("tx-partial-44444444444444444444444444444444", id, "backup-created", candidateName, backupName, true);
    await recoverPetInstallTransactions({ petsRoot: root });
    await recoverPetInstallTransactions({ petsRoot: root });
    assert.equal(await readFile(join(root, id, "pet.json"), "utf8"), "old");
    await missing(join(root, candidateName));
    await missing(join(root, backupName));
  }

  assert.equal(isPrivateMode(0o777, "win32"), true);
  assert.equal(isPrivateMode(0o777, "linux"), false);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Pet install transaction behavior passed.");
