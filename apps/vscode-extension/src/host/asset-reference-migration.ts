import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readBoundedRegularFile } from "@open-pets/pet-format/node/files";
import { convertLegacyCatalogReceipt, type AssetReferenceListing } from "./asset-reference.js";

/** Read the pre-scene installation references without changing the source files. */
export async function readLegacyInstalledReferences(
  storagePath: string,
  log: (message: string) => void = () => {},
): Promise<AssetReferenceListing> {
  const directory = join(storagePath, "preferences", "installed");
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { references: [], problems: [] };
    throw error;
  }

  const listing: AssetReferenceListing = { references: [], problems: [] };
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) {
      log(`[storage] unrecognized legacy installation reference: ${name}`);
      continue;
    }
    const id = name.slice(0, -5);
    const message = `Invalid legacy installation reference: ${name}`;
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
      log(`[storage] ${message}`);
      continue;
    }
    const invalid = (): void => {
      log(`[storage] ${message}`);
      listing.problems.push({ id, message });
    };
    const path = join(directory, name);
    let stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        invalid();
        continue;
      }
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size === 0 || stats.size > 8192) {
      invalid();
      continue;
    }
    const bytes = await readBoundedRegularFile(path, 8192, "legacy installation reference");
    try {
      const receipt = convertLegacyCatalogReceipt(JSON.parse(bytes.toString("utf8")) as unknown);
      if (receipt.id !== id) throw new Error("Legacy receipt does not match its filename.");
      listing.references.push(receipt);
    } catch {
      invalid();
    }
  }
  return listing;
}
