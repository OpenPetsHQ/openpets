import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const markerName = "journal.json";
const transactionRootName = ".openpets-pet-transactions";
const markerVersion = 1;
const maxMarkerBytes = 16 * 1024;
const maxWarningsPerOperation = 4;
const petIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const tokenPattern = /^[A-Za-z0-9_-]{6,64}$/;
const transactionPattern = /^tx-([a-z0-9][a-z0-9_-]{0,63})-([a-f0-9]{32})$/;
const markerTempPattern = /^journal\.json\.tmp-[a-f0-9]{32}$/;
const zipImportCandidatePrefix = ".openpets-pet-candidate-__zip-import__-";
const stagingOwnerSuffix = ".openpets-pet-staging-owner.json";
const stagingOwnerVersion = 1;
const phases = ["prepared", "backup-created", "promoted", "state-mutating", "committed"] as const;

type TransactionPhase = typeof phases[number];

interface Journal {
  readonly version: 1;
  readonly phase: TransactionPhase;
  readonly petId: string;
  readonly finalBasename: string;
  readonly candidateBasename: string;
  readonly backupBasename: string;
  readonly hadFinal: boolean;
  readonly mutationOutcome?: "rejected" | "succeeded" | "uncertain";
}

export interface PetInstallWarning {
  readonly message: string;
  readonly petId?: string;
}

export interface PetInstallTransactionOptions<T> {
  readonly petsRoot: string;
  readonly petId: string;
  readonly candidateDir: string;
  readonly validateCandidate?: (candidateDir: string) => void | Promise<void>;
  readonly mutateState: () => T;
  readonly onWarning?: (warning: PetInstallWarning) => void;
  /** Test-only deterministic failure seam for journal-write recovery paths. */
  readonly journalWriteFailure?: (phase: TransactionPhase, mutationOutcome: Journal["mutationOutcome"]) => Error | undefined;
  /** Only callers which already hold the per-pet lock may set this. */
  readonly lockAlreadyHeld?: boolean;
}

export interface RecoverPetInstallTransactionsOptions {
  readonly petsRoot: string;
  readonly onWarning?: (warning: PetInstallWarning) => void;
}

export class PetInstallStateMutationUncertainError extends Error {
  readonly transactionStateUncertain = true;

  constructor(message = "Pet installation state mutation outcome is uncertain.") {
    super(message);
    this.name = "PetInstallStateMutationUncertainError";
  }
}

const locks = new Map<string, Promise<void>>();

export async function createPetInstallCandidate(petsRoot: string, petId: string): Promise<string> {
  assertPetId(petId);
  const root = await ensurePrivateDirectory(petsRoot, "pets root");
  await assertNoUnresolvedPetInstallTransaction(root, petId);
  return createOwnedCandidate(root, `.openpets-pet-candidate-${petId}-`, "pet candidate");
}

/** Creates pre-metadata staging for a ZIP import without fencing the pet ID `local`. */
export async function createPetInstallStagingCandidate(petsRoot: string): Promise<string> {
  const root = await ensurePrivateDirectory(petsRoot, "pets root");
  return createOwnedCandidate(root, zipImportCandidatePrefix, "pet install staging candidate");
}

export async function withPetInstallLock<T>(petId: string, callback: () => Promise<T>): Promise<T> {
  assertPetLockId(petId);
  const previous = locks.get(petId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => { release = resolvePromise; });
  const queued = previous.then(() => current);
  locks.set(petId, queued);
  await previous;
  try {
    return await callback();
  } finally {
    release();
    if (locks.get(petId) === queued) locks.delete(petId);
  }
}

/**
 * Runs the common install commit protocol. The candidate is validated before
 * any final directory is moved. The state callback is intentionally sync: a
 * thrown ordinary rejection is distinguishable from an uncertain outcome.
 */
export async function runPetInstallTransaction<T>(options: PetInstallTransactionOptions<T>): Promise<T> {
  assertPetId(options.petId);
  const execute = async (): Promise<T> => {
    const warning = createWarningSink(options.onWarning, options.petId);
    const journalWrite = async (path: string, journal: Journal): Promise<void> => {
      const failure = options.journalWriteFailure?.(journal.phase, journal.mutationOutcome);
      if (failure) throw failure;
      await writeJournal(path, journal);
    };
    const root = await ensurePrivateDirectory(options.petsRoot, "pets root");
    await assertNoUnresolvedPetInstallTransaction(root, options.petId);
    const candidate = await assertCandidate(root, options.candidateDir, options.petId);
    const finalDir = join(root, options.petId);

    try {
      await assertStagingOwnership(candidate, root);
      await assertPrivatePetDirectoryIfPresent(finalDir, "existing pet");
      await validateCandidateTree(candidate, root);
      await options.validateCandidate?.(candidate);

      const transactionRoot = await ensurePrivateDirectory(join(root, transactionRootName), "pet transaction root");
      const transactionName = `tx-${options.petId}-${randomUUID().replaceAll("-", "")}`;
      const transactionDir = join(transactionRoot, transactionName);
      await mkdir(transactionDir, { mode: 0o700 });
      await chmod(transactionDir, 0o700);
      await assertPrivateCanonicalDirectory(transactionDir, "pet transaction directory");

      const backupBasename = `.openpets-pet-backup-${options.petId}-${randomUUID().replaceAll("-", "")}`;
      const journalPath = join(transactionDir, markerName);
      let journal: Journal = {
        version: markerVersion,
        phase: "prepared",
        petId: options.petId,
        finalBasename: options.petId,
        candidateBasename: candidate.substring(root.length + 1),
        backupBasename,
        hadFinal: await pathExists(finalDir),
      };
      validateJournal(journal, root, transactionDir);
      try {
        await journalWrite(journalPath, journal);
      } catch (error) {
        await removeUnjournaledTransaction(transactionDir, warning);
        throw error;
      }
      await removeStagingOwnershipMarker(candidate, root, warning);

      let rollbackAttempted = false;
      try {
        const backupDir = join(root, journal.backupBasename);
        if (journal.hadFinal) {
          await rename(finalDir, backupDir);
          const nextJournal = { ...journal, phase: "backup-created" as const };
          await journalWrite(journalPath, nextJournal);
          journal = nextJournal;
        }

        await rename(candidate, finalDir);
        const promotedJournal = { ...journal, phase: "promoted" as const };
        await journalWrite(journalPath, promotedJournal);
        journal = promotedJournal;

        const mutatingJournal = { ...journal, phase: "state-mutating" as const };
        await journalWrite(journalPath, mutatingJournal);
        journal = mutatingJournal;

        let result: T;
        try {
          result = options.mutateState();
          if (isThenable(result)) {
            const uncertainJournal = { ...journal, mutationOutcome: "uncertain" as const };
            try {
              await journalWrite(journalPath, uncertainJournal);
              journal = uncertainJournal;
            } catch (journalError) {
              warning(`Pet installation uncertain state journal could not be recorded: ${errorMessage(journalError)}.`);
            }
            void Promise.resolve(result).catch(() => undefined);
            throw new PetInstallStateMutationUncertainError("mutateState must return synchronously; its thenable result makes the state mutation outcome uncertain.");
          }
        } catch (error) {
          if (isUncertainStateMutation(error)) {
            const uncertainJournal = { ...journal, mutationOutcome: "uncertain" as const };
            try {
              await journalWrite(journalPath, uncertainJournal);
              journal = uncertainJournal;
            } catch (journalError) {
              warning(`Pet installation uncertain state journal could not be recorded: ${errorMessage(journalError)}.`);
            }
            warning("Pet installation state mutation is uncertain; preserving transaction assets.");
            throw error;
          }
          const rejectedJournal = { ...journal, phase: "promoted" as const, mutationOutcome: "rejected" as const };
          try {
            await journalWrite(journalPath, rejectedJournal);
            journal = rejectedJournal;
          } catch (journalError) {
            warning(`Pet installation rollback journal could not be recorded: ${errorMessage(journalError)}.`);
          }
          rollbackAttempted = true;
          await rollback(rejectedJournal, root, transactionDir, warning);
          throw error;
        }

        try {
          const succeededJournal = { ...journal, mutationOutcome: "succeeded" as const };
          await journalWrite(journalPath, succeededJournal);
          journal = succeededJournal;
          const committedJournal = { ...journal, phase: "committed" as const };
          await journalWrite(journalPath, committedJournal);
          journal = committedJournal;
        } catch (error) {
          warning(`Pet installation committed but its journal could not be finalized: ${errorMessage(error)}.`);
          await cleanupCommitted(journal, root, transactionDir, warning);
          return result;
        }

        await cleanupCommitted(journal, root, transactionDir, warning);
        return result;
      } catch (error) {
        if (isUncertainStateMutation(error)) throw error;
        if (!rollbackAttempted && journal.phase !== "committed" && journal.phase !== "state-mutating") {
          await rollback(journal, root, transactionDir, warning);
        }
        throw error;
      }
    } catch (error) {
      // A candidate which never acquired a journal is removable only when its
      // ownership marker proves that this installer created it.
      if (dirname(candidate) === root && await pathExists(candidate)) {
        try {
          await assertStagingOwnership(candidate, root);
          await rm(candidate, { recursive: true, force: true });
          await rm(stagingOwnershipPath(root, candidate.substring(root.length + 1)), { force: true });
        } catch (cleanupError) {
          warning(`Pet installation candidate cleanup could not finish: ${errorMessage(cleanupError)}.`);
        }
      }
      throw error;
    }
  };
  return options.lockAlreadyHeld ? execute() : withPetInstallLock(options.petId, execute);
}

export async function recoverPetInstallTransactions(options: RecoverPetInstallTransactionsOptions): Promise<void> {
  const warning = createWarningSink(options.onWarning);
  let root: string;
  try {
    root = await assertPrivateCanonicalDirectory(options.petsRoot, "pets root");
  } catch (error) {
    if (isMissing(error)) return;
    warning(`Pet installation recovery skipped: ${errorMessage(error)}.`);
    return;
  }

  const transactionRoot = join(root, transactionRootName);
  try {
    await assertPrivateCanonicalDirectory(transactionRoot, "pet transaction root");
  } catch (error) {
    if (isMissing(error)) {
      await recoverOwnedStagingCandidates(root, new Set(), new Set(), warning);
      return;
    }
    warning(`Pet installation recovery skipped: ${errorMessage(error)}.`);
    return;
  }

  let entries: string[];
  try {
    entries = (await readdir(transactionRoot, { withFileTypes: true })).map((entry) => entry.name);
  } catch (error) {
    warning(`Pet installation recovery could not inspect its transaction root: ${errorMessage(error)}.`);
    return;
  }

  const transactionsByPet = new Map<string, string[]>();
  for (const name of entries) {
    const petId = trustedPetIdFromTransactionName(name);
    if (petId) transactionsByPet.set(petId, [...(transactionsByPet.get(petId) ?? []), name]);
  }

  const protectedCandidates = new Set<string>();
  const blockedPetIds = new Set<string>();
  for (const [trustedPetId, names] of transactionsByPet) {
    const journals: Array<{ name: string; transactionDir: string; journal: Journal }> = [];
    const emptyTransactionDirs: Array<{ name: string; transactionDir: string }> = [];
    let groupBlocked = false;
    for (const name of names) {
      const transactionDir = join(transactionRoot, name);
      try {
        await assertPrivateCanonicalDirectory(transactionDir, "pet transaction directory");
        const transactionEntries = await readdir(transactionDir);
        if (transactionEntries.length === 0) {
          emptyTransactionDirs.push({ name, transactionDir });
          continue;
        }
        if (!transactionEntries.includes(markerName)) throw new Error("pet transaction marker is missing");
        await validateMarkerDirectoryEntries(transactionDir);
        const journal = await readJournal(join(transactionDir, markerName), root, transactionDir);
        protectedCandidates.add(journal.candidateBasename);
        journals.push({ name, transactionDir, journal });
      } catch (error) {
        groupBlocked = true;
        warning(`Pet installation recovery preserved transaction ${name} for ${trustedPetId}: ${errorMessage(error)}.`);
      }
    }

    if (journals.length > 1) {
      groupBlocked = true;
      warning(`Pet installation recovery preserved all transactions for ${trustedPetId}: more than one journal exists for this pet.`);
    }

    const plans: Array<{ name: string; transactionDir: string; journal: Journal; action: "rollback" | "cleanup" | "remove" }> = [];
    if (!groupBlocked) {
      for (const { name, transactionDir, journal } of journals) {
        try {
          const topology = await inspectTopology(journal, root, transactionDir);
          const action = recoveryAction(journal, topology);
          plans.push({ name, transactionDir, journal, action });
        } catch (error) {
          groupBlocked = true;
          warning(`Pet installation recovery preserved transaction ${name} for ${trustedPetId}: ${errorMessage(error)}.`);
        }
      }
    }
    if (groupBlocked) {
      blockedPetIds.add(trustedPetId);
      continue;
    }

    for (const { name, transactionDir } of emptyTransactionDirs) {
      try {
        await removeEmptyTransaction(transactionDir);
      } catch (error) {
        warning(`Pet installation recovery preserved completed transaction directory ${name}: ${errorMessage(error)}.`);
      }
    }
    for (const { name, transactionDir, journal, action } of plans) {
      try {
        if (action === "cleanup") await cleanupCommitted(journal, root, transactionDir, warning);
        else if (action === "remove") await removeTransaction(journal, transactionDir, warning);
        else {
          await rollback(journal, root, transactionDir, warning);
        }
      } catch (error) {
        warning(`Pet installation recovery preserved transaction ${name}: ${errorMessage(error)}.`);
      }
    }
  }

  await recoverOwnedStagingCandidates(root, protectedCandidates, blockedPetIds, warning);
}

interface PetInstallTopology {
  readonly finalExists: boolean;
  readonly backupExists: boolean;
  readonly candidateExists: boolean;
}

function recoveryAction(journal: Journal, topology: PetInstallTopology): "rollback" | "cleanup" | "remove" {
  if (journal.phase === "committed" || journal.mutationOutcome === "succeeded") {
    if (!topology.finalExists) throw new Error("committed new pet final is missing");
    return "cleanup";
  }
  if (journal.mutationOutcome === "uncertain") throw new Error("state mutation outcome is uncertain");
  if (isRestoredTopology(journal, topology)) return "remove";
  if (journal.mutationOutcome === "rejected" || isPreMutationTopology(journal, topology)) return "rollback";
  if (journal.phase === "state-mutating" && isPromotedTopology(journal, topology)) throw new Error("state mutation outcome is uncertain");
  if (isPromotedTopology(journal, topology)) return "rollback";
  throw new Error("ambiguous asset topology");
}

/**
 * A trusted transaction directory fences its pet even when its marker is
 * incomplete or malformed. This prevents stale recovery state from acting on
 * a newer same-ID install; other trusted pet IDs remain independent.
 */
export async function assertNoUnresolvedPetInstallTransaction(petsRoot: string, petId: string): Promise<void> {
  assertPetLockId(petId);
  if (petId === "builtin") return;

  const root = resolve(petsRoot);
  const transactionRoot = join(root, transactionRootName);
  try {
    await assertPrivateCanonicalDirectory(transactionRoot, "pet transaction root");
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }

  for (const name of await readdir(transactionRoot)) {
    if (trustedPetIdFromTransactionName(name) !== petId) continue;
    const transactionDir = join(transactionRoot, name);
    try {
      await assertPrivateCanonicalDirectory(transactionDir, "pet transaction directory");
      const entries = await readdir(transactionDir);
      if (entries.length === 0) continue;
      await validateMarkerDirectoryEntries(transactionDir);
      const journal = await readJournal(join(transactionDir, markerName), root, transactionDir);
      if (journal.phase === "state-mutating" && journal.mutationOutcome === undefined) {
        let topology: PetInstallTopology;
        try {
          topology = await inspectTopology(journal, root, transactionDir);
        } catch (error) {
          throw new Error(`Pet ${petId} has an unsafe installation journal (${name}) that could not be inspected: ${errorMessage(error)}.`);
        }
        if (isPromotedTopology(journal, topology)) {
          throw new Error(`Pet ${petId} has an unresolved state-mutating installation journal (${name}); recover it before changing this pet.`);
        }
      }
      throw new Error(`Pet ${petId} has an unresolved installation transaction (${name}); recover it before changing this pet.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes(`Pet ${petId} has`)) throw error;
      throw new Error(`Pet ${petId} has an unsafe installation journal (${name}): ${errorMessage(error)}.`);
    }
  }
}

/** Resolves the personal installed-pet path only from a verified private root. */
export async function getCanonicalInstalledPetDir(petsRoot: string, petId: string): Promise<string> {
  assertPetId(petId);
  const root = await assertPrivateCanonicalDirectory(petsRoot, "pets root");
  const finalDir = join(root, petId);
  if (dirname(finalDir) !== root) throw new Error("Installed pet path must be a direct child of the pets root.");
  try {
    await assertPrivateCanonicalDirectory(finalDir, "installed pet");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return finalDir;
}

async function inspectTopology(journal: Journal, root: string, transactionDir: string): Promise<PetInstallTopology> {
  await assertManagedNamePaths(journal, root, transactionDir);
  const paths = [
    [join(root, journal.finalBasename), "existing pet"],
    [join(root, journal.backupBasename), "pet backup"],
    [join(root, journal.candidateBasename), "pet candidate"],
  ] as const;
  const exists: boolean[] = [];
  for (const [path, label] of paths) {
    try {
      await assertPrivateCanonicalDirectory(path, label);
      exists.push(true);
    } catch (error) {
      if (!isMissing(error)) throw error;
      exists.push(false);
    }
  }
  return { finalExists: exists[0], backupExists: exists[1], candidateExists: exists[2] };
}

function isPreMutationTopology(journal: Journal, topology: PetInstallTopology): boolean {
  if (journal.hadFinal) {
    return (topology.finalExists && !topology.backupExists && topology.candidateExists)
      || (!topology.finalExists && topology.backupExists);
  }
  return topology.candidateExists && !topology.finalExists && !topology.backupExists;
}

function isPromotedTopology(journal: Journal, topology: PetInstallTopology): boolean {
  return journal.hadFinal
    ? topology.finalExists && topology.backupExists
    : topology.finalExists && !topology.backupExists;
}

function isRestoredTopology(journal: Journal, topology: PetInstallTopology): boolean {
  return journal.hadFinal
    ? topology.finalExists && !topology.backupExists && !topology.candidateExists
    : !topology.finalExists && !topology.backupExists && !topology.candidateExists;
}

async function rollback(journal: Journal, root: string, transactionDir: string, warning: (message: string) => void): Promise<void> {
  const finalDir = join(root, journal.finalBasename);
  const candidateDir = join(root, journal.candidateBasename);
  const backupDir = join(root, journal.backupBasename);
  try {
    await assertManagedNamePaths(journal, root, transactionDir);
    const topology = await inspectTopology(journal, root, transactionDir);
    const { finalExists, backupExists, candidateExists } = topology;
    if (journal.hadFinal) {
      if (backupExists && finalExists) {
        await removeManagedDirectory(finalDir, root, "rollback candidate final");
      }
      if (await pathExists(backupDir)) await rename(backupDir, finalDir);
      else if (!await pathExists(finalDir)) throw new Error("old pet backup is missing");
    } else if (finalExists) {
      await removeManagedDirectory(finalDir, root, "rollback first-install final");
    }
    if (candidateExists || await pathExists(candidateDir)) await removeManagedDirectory(candidateDir, root, "rollback candidate");
    await removeTransaction(journal, transactionDir, warning);
  } catch (error) {
    warning(`Pet installation rollback preserved assets: ${errorMessage(error)}.`);
  }
}

async function cleanupCommitted(journal: Journal, root: string, transactionDir: string, warning: (message: string) => void): Promise<void> {
  try {
    await assertManagedNamePaths(journal, root, transactionDir);
    const topology = await inspectTopology(journal, root, transactionDir);
    if (!topology.finalExists) throw new Error("committed new pet final is missing");
    const finalDir = join(root, journal.finalBasename);
    if (topology.backupExists) {
      await removeManagedDirectory(join(root, journal.backupBasename), root, "committed backup cleanup");
    }
    if (topology.candidateExists) {
      await removeManagedDirectory(join(root, journal.candidateBasename), root, "committed candidate cleanup");
    }
    await removeTransaction(journal, transactionDir, warning);
  } catch (error) {
    warning(`Pet installation cleanup could not finish; the new pet was retained: ${errorMessage(error)}.`);
  }
}

async function removeTransaction(journal: Journal, transactionDir: string, warning: (message: string) => void): Promise<void> {
  const markerPath = join(transactionDir, markerName);
  try {
    await assertPrivateCanonicalFile(markerPath, "pet transaction marker");
    const helperTemps = await validateMarkerDirectoryEntries(transactionDir);
    for (const helperTemp of helperTemps) await rm(join(transactionDir, helperTemp), { force: true });
    await rm(markerPath, { force: true });
    await removeEmptyTransaction(transactionDir);
    await rmdir(dirname(transactionDir)).catch((error: unknown) => {
      if (!isDirectoryNotEmpty(error) && !isMissing(error)) throw error;
    });
  } catch (error) {
    warning(`Pet installation marker cleanup could not finish for ${journal.petId}: ${errorMessage(error)}.`);
  }
}

async function removeUnjournaledTransaction(transactionDir: string, warning: (message: string) => void): Promise<void> {
  try {
    await assertPrivateCanonicalDirectory(transactionDir, "pet transaction directory");
    const helperTemps = await validateMarkerDirectoryEntries(transactionDir, false);
    for (const helperTemp of helperTemps) await rm(join(transactionDir, helperTemp), { force: true });
    await removeEmptyTransaction(transactionDir);
    await rmdir(dirname(transactionDir)).catch((error: unknown) => {
      if (!isDirectoryNotEmpty(error) && !isMissing(error)) throw error;
    });
  } catch (error) {
    warning(`Pet installation unjournaled transaction cleanup could not finish: ${errorMessage(error)}.`);
  }
}

async function removeEmptyTransaction(transactionDir: string): Promise<void> {
  await assertPrivateCanonicalDirectory(transactionDir, "pet transaction directory");
  const entries = await readdir(transactionDir);
  if (entries.length > 0) throw new Error("transaction directory contains unknown entries");
  await rmdir(transactionDir);
  await rmdir(dirname(transactionDir)).catch((error: unknown) => {
    if (!isDirectoryNotEmpty(error) && !isMissing(error)) throw error;
  });
}

async function recoverOwnedStagingCandidates(
  root: string,
  protectedCandidates: ReadonlySet<string>,
  blockedPetIds: ReadonlySet<string>,
  warning: (message: string) => void,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    warning(`Pet installation recovery could not inspect staging candidates: ${errorMessage(error)}.`);
    return;
  }

  for (const name of entries) {
    const candidateName = name.endsWith(stagingOwnerSuffix) ? name.slice(0, -stagingOwnerSuffix.length) : name;
    if (!isStagingCandidateBasename(candidateName)) continue;
    if (protectedCandidates.has(candidateName)) continue;
    const candidatePetId = candidatePetIdFromBasename(candidateName);
    if (candidatePetId && blockedPetIds.has(candidatePetId)) continue;

    const candidate = join(root, candidateName);
    const ownerPath = stagingOwnershipPath(root, candidateName);
    try {
      if (!await pathExists(ownerPath)) continue;
      await assertStagingOwnership(candidate, root);
      if (await pathExists(candidate)) {
        await assertPrivateCanonicalDirectory(candidate, "owned pet staging candidate");
        await rm(candidate, { recursive: true, force: true });
      }
      await rm(ownerPath, { force: true });
    } catch (error) {
      warning(`Pet installation recovery preserved staging candidate ${candidateName}: ${errorMessage(error)}.`);
    }
  }
}

interface StagingOwnershipMarker {
  readonly version: 1;
  readonly candidateBasename: string;
}

async function createOwnedCandidate(root: string, prefix: string, label: string): Promise<string> {
  const candidateBasename = `${prefix}${randomUUID().replaceAll("-", "")}`;
  const candidate = join(root, candidateBasename);
  const ownerPath = stagingOwnershipPath(root, candidateBasename);
  const marker: StagingOwnershipMarker = { version: stagingOwnerVersion, candidateBasename };
  try {
    await writeFile(ownerPath, `${JSON.stringify(marker)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(ownerPath, 0o600);
    await assertPrivateCanonicalFile(ownerPath, "pet staging ownership marker");
    await mkdir(candidate, { mode: 0o700 });
    await chmod(candidate, 0o700);
    await assertPrivateCanonicalDirectory(candidate, label);
    return candidate;
  } catch (error) {
    await rm(candidate, { recursive: true, force: true }).catch(() => undefined);
    await rm(ownerPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function assertStagingOwnership(candidate: string, root: string): Promise<void> {
  const candidateBasename = candidate.substring(root.length + 1);
  const markerPath = stagingOwnershipPath(root, candidateBasename);
  const stats = await assertPrivateCanonicalFile(markerPath, "pet staging ownership marker");
  if (stats.size > maxMarkerBytes) throw new Error("Pet staging ownership marker is too large.");
  const parsed: unknown = JSON.parse(await readFile(markerPath, "utf8"));
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => !["version", "candidateBasename"].includes(key))) {
    throw new Error("Pet staging ownership marker is invalid.");
  }
  const marker = parsed as unknown as StagingOwnershipMarker;
  if (marker.version !== stagingOwnerVersion || marker.candidateBasename !== candidateBasename || !isStagingCandidateBasename(candidateBasename)) {
    throw new Error("Pet staging ownership marker is invalid.");
  }
}

async function removeStagingOwnershipMarker(candidate: string, root: string, warning: (message: string) => void): Promise<void> {
  const candidateBasename = candidate.substring(root.length + 1);
  const markerPath = stagingOwnershipPath(root, candidateBasename);
  try {
    if (!await pathExists(markerPath)) return;
    await assertStagingOwnership(candidate, root);
    await rm(markerPath, { force: true });
  } catch (error) {
    warning(`Pet installation staging ownership handoff could not finish: ${errorMessage(error)}.`);
  }
}

function stagingOwnershipPath(root: string, candidateBasename: string): string {
  return join(root, `${candidateBasename}${stagingOwnerSuffix}`);
}

function isStagingCandidateBasename(name: string): boolean {
  if (name.startsWith(zipImportCandidatePrefix)) return tokenPattern.test(name.slice(zipImportCandidatePrefix.length));
  const match = /^\.openpets-pet-candidate-([a-z0-9][a-z0-9_-]{0,63})-([A-Za-z0-9_-]{6,64})$/.exec(name);
  return Boolean(match && match[1] !== "builtin" && match[2] && petIdPattern.test(match[1]));
}

function candidatePetIdFromBasename(name: string): string | null {
  const match = /^\.openpets-pet-candidate-([a-z0-9][a-z0-9_-]{0,63})-([A-Za-z0-9_-]{6,64})$/.exec(name);
  return match?.[1] && match[1] !== "builtin" ? match[1] : null;
}

async function validateMarkerDirectoryEntries(transactionDir: string, markerExpected = true): Promise<string[]> {
  const entries = await readdir(transactionDir);
  if (markerExpected && !entries.includes(markerName)) throw new Error("pet transaction marker is missing");
  const helperTemps = entries.filter((entry) => markerTempPattern.test(entry));
  const unknown = entries.filter((entry) => entry !== markerName && !markerTempPattern.test(entry));
  if (unknown.length > 0) throw new Error("transaction directory contains unknown entries");
  for (const helperTemp of helperTemps) {
    await assertPrivateCanonicalFile(join(transactionDir, helperTemp), "pet transaction marker temp");
  }
  return helperTemps;
}

async function assertCandidate(root: string, candidatePath: string, petId: string): Promise<string> {
  const candidate = resolve(candidatePath);
  if (dirname(candidate) !== root || candidate === root || !candidate.startsWith(`${root}${sep}`)) {
    throw new Error("Pet install candidate must be a direct child of the pets root.");
  }
  const name = candidate.substring(root.length + 1);
  const petPrefix = `.openpets-pet-candidate-${petId}-`;
  const prefixes = [petPrefix, zipImportCandidatePrefix];
  const prefix = prefixes.find((candidatePrefix) => name.startsWith(candidatePrefix));
  if (!prefix || !tokenPattern.test(name.slice(prefix.length))) {
    throw new Error("Pet install candidate name is not a known private transaction path.");
  }
  await assertPrivateCanonicalDirectory(candidate, "pet candidate");
  return candidate;
}

async function validateCandidateTree(candidate: string, root: string): Promise<void> {
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) throw new Error("Pet install candidate cannot contain symlinks.");
      const real = await realpath(path);
      if (real !== path || !real.startsWith(`${root}${sep}`)) throw new Error("Pet install candidate escapes the pets root.");
      if (stats.isDirectory()) await walk(path);
      else if (!stats.isFile()) throw new Error("Pet install candidate contains a non-regular file.");
    }
  };
  await walk(candidate);
}

async function assertManagedNamePaths(journal: Journal, root: string, transactionDir: string): Promise<void> {
  validateJournal(journal, root, transactionDir);
  await assertPrivateCanonicalDirectory(root, "pets root");
}

function validateJournal(journal: Journal, root: string, transactionDir: string): void {
  if (journal.version !== markerVersion || !phases.includes(journal.phase) || !petIdPattern.test(journal.petId)) throw new Error("Pet installation marker is invalid.");
  if (journal.finalBasename !== journal.petId || !isBasename(journal.finalBasename)) throw new Error("Pet installation marker final path is invalid.");
  const candidatePrefixes = [`.openpets-pet-candidate-${journal.petId}-`, zipImportCandidatePrefix];
  const candidatePrefix = candidatePrefixes.find((prefix) => journal.candidateBasename.startsWith(prefix));
  if (!candidatePrefix || !tokenPattern.test(journal.candidateBasename.slice(candidatePrefix.length))) throw new Error("Pet installation marker candidate path is invalid.");
  const backupPrefix = `.openpets-pet-backup-${journal.petId}-`;
  if (!journal.backupBasename.startsWith(backupPrefix) || !tokenPattern.test(journal.backupBasename.slice(backupPrefix.length))) throw new Error("Pet installation marker backup path is invalid.");
  if (typeof journal.hadFinal !== "boolean") throw new Error("Pet installation marker hadFinal value is invalid.");
  if (journal.mutationOutcome !== undefined && journal.mutationOutcome !== "rejected" && journal.mutationOutcome !== "succeeded" && journal.mutationOutcome !== "uncertain") throw new Error("Pet installation marker mutation outcome is invalid.");
  const transactionName = transactionDir.substring(dirname(transactionDir).length + 1);
  const trustedPetId = trustedPetIdFromTransactionName(transactionName);
  if (dirname(transactionDir) !== join(root, transactionRootName) || !trustedPetId || trustedPetId !== journal.petId) throw new Error("Pet installation marker transaction path is invalid.");
}

async function writeJournal(path: string, journal: Journal): Promise<void> {
  const data = `${JSON.stringify(journal)}\n`;
  if (Buffer.byteLength(data) > maxMarkerBytes) throw new Error("Pet installation marker is too large.");
  const tempPath = `${path}.tmp-${randomUUID().replaceAll("-", "")}`;
  let renamed = false;
  try {
    await writeFile(tempPath, data, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(tempPath, 0o600);
    await assertPrivateCanonicalFile(tempPath, "pet transaction marker temp");
    await rename(tempPath, path);
    renamed = true;
    await assertPrivateCanonicalFile(path, "pet transaction marker");
  } finally {
    if (!renamed && await pathExists(tempPath)) {
      await assertPrivateCanonicalFile(tempPath, "pet transaction marker temp cleanup");
      await rm(tempPath, { force: true });
    }
  }
}

async function readJournal(path: string, root: string, transactionDir: string): Promise<Journal> {
  const stats = await assertPrivateCanonicalFile(path, "pet transaction marker");
  if (stats.size > maxMarkerBytes) throw new Error("Pet installation marker is too large.");
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => !["version", "phase", "petId", "finalBasename", "candidateBasename", "backupBasename", "hadFinal", "mutationOutcome"].includes(key))) throw new Error("Pet installation marker has unknown fields.");
  const journal = parsed as unknown as Journal;
  validateJournal(journal, root, transactionDir);
  return journal;
}

async function ensurePrivateDirectory(path: string, label: string): Promise<string> {
  const resolved = resolve(path);
  try {
    await assertPrivateCanonicalDirectory(resolved, label);
  } catch (error) {
    if (!isMissing(error)) throw error;
    const parent = dirname(resolved);
    if (await pathExists(parent)) await assertPrivateCanonicalDirectory(parent, `${label} parent`);
    await mkdir(resolved, { recursive: false, mode: 0o700 });
    await chmod(resolved, 0o700);
  }
  return await assertPrivateCanonicalDirectory(resolved, label);
}

async function assertPrivateCanonicalDirectory(path: string, label: string): Promise<string> {
  const resolved = resolve(path);
  const stats = await lstat(resolved);
  if (stats.isSymbolicLink()) throw new Error(`${label} cannot be a symlink.`);
  if (!stats.isDirectory()) throw new Error(`${label} must be a directory.`);
  if (!isPrivateMode(stats.mode, process.platform)) throw new Error(`${label} must be private.`);
  if (await realpath(resolved) !== resolved) throw new Error(`${label} path is not canonical.`);
  return resolved;
}

async function assertPrivateCanonicalFile(path: string, label: string): Promise<import("node:fs").Stats> {
  const resolved = resolve(path);
  const stats = await lstat(resolved);
  if (stats.isSymbolicLink()) throw new Error(`${label} cannot be a symlink.`);
  if (!stats.isFile()) throw new Error(`${label} must be a regular file.`);
  if (!isPrivateMode(stats.mode, process.platform)) throw new Error(`${label} must be private.`);
  if (await realpath(resolved) !== resolved) throw new Error(`${label} path is not canonical.`);
  return stats;
}

async function assertPrivatePetDirectory(path: string, label: string): Promise<void> {
  await assertPrivateCanonicalDirectory(path, label);
}

async function assertPrivatePetDirectoryIfPresent(path: string, label: string): Promise<void> {
  try {
    await assertPrivatePetDirectory(path, label);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function removeManagedDirectory(path: string, root: string, label: string): Promise<void> {
  const resolved = resolve(path);
  if (dirname(resolved) !== root) throw new Error(`${label} path is not a direct child of the pets root.`);
  await assertPrivateCanonicalDirectory(resolved, label);
  await rm(resolved, { recursive: true, force: true });
}

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if (isMissing(error)) return false; throw error; }
}

function createWarningSink(callback?: (warning: PetInstallWarning) => void, petId?: string): (message: string) => void {
  let count = 0;
  return (message) => {
    if (count >= maxWarningsPerOperation) return;
    count += 1;
    const warning = { message: message.slice(0, 400), ...(petId ? { petId } : {}) };
    try { callback?.(warning); } catch { /* diagnostics must not affect installation */ }
    if (!callback) console.warn(`[pet-install] ${warning.message}`);
  };
}

function assertPetId(value: string): void {
  if (!petIdPattern.test(value) || value === "builtin") throw new Error(`Invalid installed pet id: ${value}`);
}

function assertPetLockId(value: string): void {
  if (value !== "builtin") assertPetId(value);
}

/** Windows' lstat mode contains synthetic POSIX permission bits. */
export function isPrivateMode(mode: number, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" || (mode & 0o077) === 0;
}

function isBasename(value: string): boolean {
  return value.length > 0 && !value.includes("/") && !value.includes("\\") && value !== "." && value !== "..";
}

function isUncertainStateMutation(error: unknown): boolean {
  return error instanceof PetInstallStateMutationUncertainError || (isRecord(error) && error.transactionStateUncertain === true);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === "object" && value !== null || typeof value === "function")
    && typeof (value as { readonly then?: unknown }).then === "function";
}

function trustedPetIdFromTransactionName(name: string): string | null {
  const match = transactionPattern.exec(name);
  if (!match || !match[1] || match[1] === "builtin") return null;
  return match[1];
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isDirectoryNotEmpty(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOTEMPTY";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
