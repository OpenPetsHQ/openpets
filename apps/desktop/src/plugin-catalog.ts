import { validatePluginCatalog, type PluginCatalog, type PluginCatalogEntry, type PluginCatalogEntryV2 } from "./plugin-catalog-validation.js";
import { marketplaceOrigin } from "./plugin-marketplace.js";

export const pluginCatalogUrl = "https://studio-api.openpets.dev/api/marketplace/catalog.v2.json";
export const pluginCatalogV2Url = pluginCatalogUrl;
const maxCatalogBytes = 2 * 1024 * 1024;
const catalogTimeoutMs = 15_000;
const cached = new Map<string, PluginCatalog>();

export type PluginCatalogOptions = { readonly refresh?: boolean; readonly fetchImpl?: typeof fetch; readonly url?: string };

export async function getPluginCatalog(options: PluginCatalogOptions = {}): Promise<PluginCatalog> {
  const url = options.url ?? `${marketplaceOrigin()}/api/marketplace/catalog.v2.json`;
  const cacheKey = url;
  const cachedCatalog = cached.get(cacheKey);
  if (cachedCatalog && !options.refresh) return cachedCatalog;
  const fetcher = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), catalogTimeoutMs);
  try {
    const response = await fetcher(url, { signal: controller.signal, credentials: "omit", redirect: "error" });
    if (!response.ok) throw new Error(`Plugin catalog fetch failed with HTTP ${response.status}.`);
    const text = (await readLimitedResponse(response, maxCatalogBytes)).toString("utf8");
    const catalog = validatePluginCatalog(JSON.parse(text) as unknown);
    if (catalog.version !== 2) throw new Error("Marketplace catalog must use version 2.");
    cached.set(cacheKey, catalog);
    return catalog;
  } finally { clearTimeout(timeout); }
}

export async function getCatalogPlugin(id: string, options: PluginCatalogOptions = {}): Promise<PluginCatalogEntry | PluginCatalogEntryV2> {
  const catalog = await getPluginCatalog(options);
  const plugin = catalog.plugins.find((entry) => entry.id === id);
  if (!plugin) throw new Error("Plugin is not in the catalog.");
  return plugin;
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Plugin catalog response body is unavailable.");
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maxBytes) throw new Error("Plugin catalog response is too large."); chunks.push(value); }
  return Buffer.concat(chunks, total);
}
