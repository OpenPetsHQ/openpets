import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readPluginManifestFromZip } from "../apps/desktop/src/plugin-package.ts";
import { collectDeclaredPluginFiles, validatePluginSpriteBytes } from "../apps/desktop/src/plugin-assets.ts";
import { validatePluginCatalog } from "../apps/desktop/src/plugin-catalog-validation.ts";

const MAX_ZIP_BYTES = 16 * 1024 * 1024;
const MAX_LOCALE_BYTES = 256 * 1024;

async function readZip(path) {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_ZIP_BYTES) throw new Error("Plugin ZIP is not a bounded regular file.");
    const bytes = Buffer.alloc(MAX_ZIP_BYTES + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > MAX_ZIP_BYTES) throw new Error("Plugin ZIP is too large.");
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

function parseLocale(bytes, path) {
  if (bytes.length > MAX_LOCALE_BYTES) throw new Error(`Plugin locale is too large: ${path}`);
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((item) => typeof item !== "string")) {
    throw new Error(`Plugin locale must be a flat string catalog: ${path}`);
  }
  return value;
}

function resolveText(value, english, label) {
  const result = value.startsWith("$t:") ? english[value.slice(3)] : value;
  if (typeof result !== "string" || !result.trim() || result.includes("$t:")) {
    throw new Error(`Plugin ${label} does not resolve to text.`);
  }
  return result;
}

export async function validateMarketplacePackage(path) {
  const zip = await readZip(path);
  const { manifest, declaredFiles } = await readPluginManifestFromZip({ zip });
  if (manifest.manifestVersion !== 3 || manifest.runtime !== "javascript") {
    throw new Error("Marketplace packages must use the JavaScript SDK v3 manifest.");
  }
  const files = declaredFiles ?? new Map();
  const localeBytes = files.get("locales/en.json");
  if (!localeBytes) throw new Error("Plugin locales/en.json is required.");
  let english;
  for (const [name, bytes] of files) {
    if (name.startsWith("locales/")) {
      const catalog = parseLocale(bytes, name);
      if (name === "locales/en.json") english = catalog;
    }
  }
  const resolvedName = resolveText(manifest.name, english, "name");
  const resolvedDescription = resolveText(manifest.description, english, "description");
  for (const file of collectDeclaredPluginFiles(manifest)) {
    await validatePluginSpriteBytes(file, files.get(file.relPath), manifest);
  }
  const icons = manifest.assets?.icons ?? {};
  const names = Object.keys(icons).sort();
  const tail = manifest.id.split(".").at(-1).toLowerCase();
  const preferred = typeof manifest.icon === "string" ? manifest.icon.toLowerCase() : "";
  const iconName = names.find((name) => name.toLowerCase() === tail)
    ?? names.find((name) => name.toLowerCase() === preferred)
    ?? names.find((name) => name.toLowerCase().includes(tail))
    ?? names.find((name) => preferred && name.toLowerCase().includes(preferred))
    ?? names[0];
  const iconPath = iconName && icons[iconName];
  const iconDataUrl = iconPath?.toLowerCase().endsWith(".svg")
    ? `data:image/svg+xml;base64,${files.get(iconPath).toString("base64")}`
    : undefined;
  validatePluginCatalog({
    version: 2,
    generatedAt: new Date(0).toISOString(),
    plugins: [{
      id: manifest.id,
      name: resolvedName,
      description: resolvedDescription,
      version: manifest.version,
      runtime: manifest.runtime,
      icon: manifest.icon,
      iconDataUrl,
      sdkVersion: manifest.sdkVersion,
      minOpenPetsVersion: manifest.minOpenPetsVersion,
      maxOpenPetsVersion: manifest.maxOpenPetsVersion,
      permissions: manifest.permissions,
      network: manifest.network,
      downloadUrl: `https://studio-api.openpets.dev/api/marketplace/plugins/${encodeURIComponent(manifest.id)}/releases/${encodeURIComponent(manifest.version)}/download`,
      sha256: createHash("sha256").update(zip).digest("hex"),
    }],
  });
  return {
    manifest,
    resolvedName,
    resolvedDescription,
    ...(iconDataUrl ? { iconDataUrl } : {}),
    files: [...files.keys()].sort(),
    validation: { valid: true },
  };
}

async function main() {
  if (process.argv.length !== 3) throw new Error("Usage: node plugin-validator.cjs <package.zip>");
  console.log(JSON.stringify(await validateMarketplacePackage(process.argv[2])));
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
