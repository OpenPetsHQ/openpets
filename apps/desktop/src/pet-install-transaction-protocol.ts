import { dirname, join } from "node:path";

export const markerName = "journal.json";
export const transactionRootName = ".openpets-pet-transactions";
export const markerVersion = 1;
export const maxMarkerBytes = 16 * 1024;
export const petIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const tokenPattern = /^[A-Za-z0-9_-]{6,64}$/;
export const transactionPattern = /^tx-([a-z0-9][a-z0-9_-]{0,63})-([a-f0-9]{32})$/;
export const markerTempPattern = /^journal\.json\.tmp-[a-f0-9]{32}$/;
export const zipImportCandidatePrefix = ".openpets-pet-candidate-__zip-import__-";
export const stagingOwnerSuffix = ".openpets-pet-staging-owner.json";
export const stagingOwnerVersion = 1;

export const phases = ["prepared", "backup-created", "promoted", "state-mutating", "committed"] as const;

export type TransactionPhase = typeof phases[number];
export type MutationOutcome = "rejected" | "succeeded" | "uncertain";

export interface Journal {
  readonly version: 1;
  readonly phase: TransactionPhase;
  readonly petId: string;
  readonly finalBasename: string;
  readonly candidateBasename: string;
  readonly backupBasename: string;
  readonly hadFinal: boolean;
  readonly mutationOutcome?: MutationOutcome;
}

export interface PetInstallTopology {
  readonly finalExists: boolean;
  readonly backupExists: boolean;
  readonly candidateExists: boolean;
}

export interface StagingOwnershipMarker {
  readonly version: 1;
  readonly candidateBasename: string;
}

export function assertPetId(value: string): void {
  if (!petIdPattern.test(value) || value === "builtin") throw new Error(`Invalid installed pet id: ${value}`);
}

export function assertPetLockId(value: string): void {
  if (value !== "builtin") assertPetId(value);
}

export function isBasename(value: string): boolean {
  return value.length > 0 && !value.includes("/") && !value.includes("\\") && value !== "." && value !== "..";
}

export function isKnownCandidateBasename(name: string, petId: string): boolean {
  const petPrefix = `.openpets-pet-candidate-${petId}-`;
  const prefixes = [petPrefix, zipImportCandidatePrefix];
  const prefix = prefixes.find((candidatePrefix) => name.startsWith(candidatePrefix));
  return Boolean(prefix && tokenPattern.test(name.slice(prefix.length)));
}

export function isStagingCandidateBasename(name: string): boolean {
  if (name.startsWith(zipImportCandidatePrefix)) return tokenPattern.test(name.slice(zipImportCandidatePrefix.length));
  const match = /^\.openpets-pet-candidate-([a-z0-9][a-z0-9_-]{0,63})-([A-Za-z0-9_-]{6,64})$/.exec(name);
  return Boolean(match && match[1] !== "builtin" && match[2] && petIdPattern.test(match[1]));
}

export function candidatePetIdFromBasename(name: string): string | null {
  const match = /^\.openpets-pet-candidate-([a-z0-9][a-z0-9_-]{0,63})-([A-Za-z0-9_-]{6,64})$/.exec(name);
  return match?.[1] && match[1] !== "builtin" ? match[1] : null;
}

export function trustedPetIdFromTransactionName(name: string): string | null {
  const match = transactionPattern.exec(name);
  if (!match || !match[1] || match[1] === "builtin") return null;
  return match[1];
}

export function stagingOwnershipPath(root: string, candidateBasename: string): string {
  return join(root, `${candidateBasename}${stagingOwnerSuffix}`);
}

export function serializeStagingOwnershipMarker(candidateBasename: string): string {
  const marker: StagingOwnershipMarker = { version: stagingOwnerVersion, candidateBasename };
  return `${JSON.stringify(marker)}\n`;
}

export function parseStagingOwnershipMarker(serialized: string, candidateBasename: string): void {
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => !["version", "candidateBasename"].includes(key))) {
    throw new Error("Pet staging ownership marker is invalid.");
  }
  const marker = parsed as unknown as StagingOwnershipMarker;
  if (marker.version !== stagingOwnerVersion || marker.candidateBasename !== candidateBasename || !isStagingCandidateBasename(candidateBasename)) {
    throw new Error("Pet staging ownership marker is invalid.");
  }
}

export function serializeJournal(journal: Journal): string {
  const data = `${JSON.stringify(journal)}\n`;
  if (Buffer.byteLength(data) > maxMarkerBytes) throw new Error("Pet installation marker is too large.");
  return data;
}

export function parseJournal(serialized: string, root: string, transactionDir: string): Journal {
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => !["version", "phase", "petId", "finalBasename", "candidateBasename", "backupBasename", "hadFinal", "mutationOutcome"].includes(key))) throw new Error("Pet installation marker has unknown fields.");
  const journal = parsed as unknown as Journal;
  validateJournal(journal, root, transactionDir);
  return journal;
}

export function validateJournal(journal: Journal, root: string, transactionDir: string): void {
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

export function isPreMutationTopology(journal: Journal, topology: PetInstallTopology): boolean {
  if (journal.hadFinal) {
    return (topology.finalExists && !topology.backupExists && topology.candidateExists)
      || (!topology.finalExists && topology.backupExists);
  }
  return topology.candidateExists && !topology.finalExists && !topology.backupExists;
}

export function isPromotedTopology(journal: Journal, topology: PetInstallTopology): boolean {
  return journal.hadFinal
    ? topology.finalExists && topology.backupExists
    : topology.finalExists && !topology.backupExists;
}

export function isRestoredTopology(journal: Journal, topology: PetInstallTopology): boolean {
  return journal.hadFinal
    ? topology.finalExists && !topology.backupExists && !topology.candidateExists
    : !topology.finalExists && !topology.backupExists && !topology.candidateExists;
}

export function recoveryAction(journal: Journal, topology: PetInstallTopology): "rollback" | "cleanup" | "remove" {
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

export function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
