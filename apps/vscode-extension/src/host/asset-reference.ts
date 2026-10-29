export interface Receipt {
  version: 2;
  id: string;
  packageId: string;
  sha256: string;
  generation: string;
  source: { kind: "catalog"; url: string } | { kind: "local" };
}

export interface AssetReferenceProblem {
  id: string;
  message: string;
}

export interface AssetReferenceListing {
  references: Receipt[];
  problems: AssetReferenceProblem[];
}

export function parseReceipt(value: unknown): Receipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid asset receipt.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 6 || record.version !== 2 || typeof record.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(record.id)
    || typeof record.packageId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(record.packageId) || record.packageId === "builtin"
    || typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256)
    || typeof record.generation !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.generation)
    || !record.source || typeof record.source !== "object" || Array.isArray(record.source)) throw new Error("Invalid asset receipt.");
  const source = record.source as Record<string, unknown>;
  let parsedSource: Receipt["source"];
  if (source.kind === "local" && Object.keys(source).length === 1) parsedSource = { kind: "local" };
  else if (source.kind === "catalog" && Object.keys(source).length === 2 && typeof source.url === "string") {
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.hostname !== "zip.openpets.dev" || url.port || url.username || url.password || !url.pathname.startsWith("/pets/")) throw new Error("Invalid asset receipt URL.");
    parsedSource = { kind: "catalog", url: source.url };
  } else throw new Error("Invalid asset source.");
  if (record.id === "builtin" ? record.packageId !== "hoodie-cat" || parsedSource.kind !== "local" : record.id !== record.packageId) throw new Error("Invalid asset identity.");
  return { version: 2, id: record.id, packageId: record.packageId, sha256: record.sha256, generation: record.generation, source: parsedSource };
}

export function convertLegacyCatalogReceipt(value: unknown): Receipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid legacy receipt.");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || Object.keys(record).length !== 5) throw new Error("Invalid legacy receipt.");
  return parseReceipt({ version: 2, id: record.id, packageId: record.id, sha256: record.sha256, generation: record.generation, source: { kind: "catalog", url: record.url } });
}
