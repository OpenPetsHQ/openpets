import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const nodeRequire = createRequire(import.meta.url);

export function getPetsRoot(): string {
  // Lazy-load `app` so this module is importable under plain Node (tests)
  // without triggering the ESM electron named-export error.
  const { app } = nodeRequire("electron") as typeof import("electron");
  return join(app.getPath("userData"), "pets");
}

export function getInstalledPetDir(petId: string): string {
  assertSafePetId(petId);
  const root = getPetsRoot();
  const target = resolve(root, petId);
  assertInsideRoot(root, target);
  const teamTarget = resolve(root, "..", "team-pets", petId);
  return !existsSync(target) && existsSync(teamTarget) ? teamTarget : target;
}

export function getTeamPetDir(petId: string): string {
  assertSafePetId(petId);
  return resolve(getPetsRoot(), "..", "team-pets", petId);
}

export function assertSafePetId(petId: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(petId) || petId === "builtin") {
    throw new Error(`Invalid installed pet id: ${petId}`);
  }
}

export function assertInsideRoot(root: string, target: string): void {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);

  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error("Resolved path escapes OpenPets pets directory.");
  }
}
