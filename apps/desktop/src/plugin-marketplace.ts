import { validatePluginCatalog } from "./plugin-catalog-validation.js";

import type { MarketplaceRelease, MarketplacePlugin, MarketplaceDetail, MarketplacePage, MarketplaceQuery } from "./plugin-marketplace-types.js";
export type { MarketplaceRelease, MarketplacePlugin, MarketplaceDetail, MarketplacePage, MarketplaceQuery } from "./plugin-marketplace-types.js";

export function marketplaceOrigin(): string {
  const override = process.env.OPENPETS_MARKETPLACE_API_URL;
  const url = new URL(override ?? "https://studio-api.openpets.dev");
  const allowedProtocol = url.protocol === "https:" || (override !== undefined && url.protocol === "http:");
  if (!allowedProtocol || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Invalid marketplace API origin.");
  }
  return url.origin;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid marketplace response.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max = 2048): string {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid marketplace text.");
  return value;
}

function optionalText(value: unknown, max = 2048): string | null {
  return value == null ? null : text(value, max);
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Invalid marketplace number.");
  }
  return value;
}

function url(value: unknown, origin: string): string {
  const result = new URL(text(value));
  if (result.origin !== origin || result.username || result.password || result.hash) {
    throw new Error("Invalid marketplace URL origin.");
  }
  return result.href;
}

function release(
  value: unknown,
  origin: string,
  pluginId: string,
  name: string,
  description: string,
  isDetailRelease = false,
): MarketplaceRelease {
  const item = object(value);
  if (item.pluginId !== undefined && item.pluginId !== pluginId) {
    throw new Error("Marketplace release plugin mismatch.");
  }
  if (item.status !== undefined && item.status !== "approved") {
    throw new Error("Marketplace release is not approved.");
  }
  if (isDetailRelease && (item.pluginId !== pluginId || item.status !== "approved")) {
    throw new Error("Invalid approved marketplace release.");
  }

  const downloadUrl = url(item.downloadUrl, origin);
  const version = text(item.version, 80);
  const expectedPath = `/api/marketplace/plugins/${encodeURIComponent(pluginId)}/releases/${version}/download`;
  if (!/^\d+\.\d+\.\d+$/.test(version) || new URL(downloadUrl).pathname !== expectedPath) {
    throw new Error("Invalid marketplace release download URL.");
  }

  // The catalog validator owns the package metadata and SVG data URL contract.
  const iconDataUrl = typeof item.iconUrl === "string" && item.iconUrl.startsWith("data:")
    ? item.iconUrl
    : undefined;
  const entry = {
    id: pluginId,
    name,
    description,
    version,
    runtime: item.runtime,
    sdkVersion: item.sdkVersion ?? undefined,
    minOpenPetsVersion: item.minOpenPetsVersion ?? undefined,
    maxOpenPetsVersion: item.maxOpenPetsVersion ?? undefined,
    permissions: item.permissions,
    network: item.network ?? undefined,
    downloadUrl,
    sha256: item.sha256,
    iconDataUrl,
  };
  const catalog = validatePluginCatalog({ version: 2, generatedAt: "marketplace", plugins: [entry] });
  if (catalog.version !== 2) throw new Error("Invalid marketplace release.");

  return {
    ...catalog.plugins[0],
    releaseId: text(item.releaseId ?? item.id, 128),
    pluginId,
    status: "approved",
    changelog: text(item.changelog ?? "", 64_000),
    createdAt: item.createdAt == null ? null : number(item.createdAt),
    reviewedAt: item.reviewedAt == null ? null : number(item.reviewedAt),
  };
}

function plugin(value: unknown, origin: string): MarketplacePlugin {
  const item = object(value);
  const id = text(item.id, 64);
  const name = text(item.name, 120);
  const description = text(item.description, 1000);
  const publisher = object(item.publisher);
  if (publisher.publisherType !== "official" && publisher.publisherType !== "community") {
    throw new Error("Invalid marketplace publisher.");
  }
  if (!Array.isArray(item.tags) || item.tags.length > 32 || typeof item.hearted !== "boolean") {
    throw new Error("Invalid marketplace summary.");
  }

  const parsedRelease = release(item, origin, id, name, description);
  let iconUrl: string | null = null;
  if (item.iconUrl != null) {
    iconUrl = parsedRelease.iconDataUrl ?? url(item.iconUrl, origin);
  }
  return {
    ...parsedRelease,
    category: text(item.category, 120),
    tags: item.tags.map((tag) => text(tag, 120)),
    publisher: {
      id: text(publisher.id, 128),
      username: text(publisher.username, 128),
      displayName: text(publisher.displayName, 128),
      publisherType: publisher.publisherType,
    },
    iconUrl,
    heartCount: number(item.heartCount),
    ratingAverage: item.ratingAverage == null ? null : number(item.ratingAverage),
    ratingCount: number(item.ratingCount),
    downloadCount: number(item.downloadCount),
    hearted: item.hearted,
    myRating: item.myRating == null ? null : number(item.myRating),
  };
}

async function request(path: string, fetchImpl: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(new URL(path, marketplaceOrigin()), {
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Marketplace request failed with HTTP ${response.status}.`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Marketplace response body unavailable.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 2 * 1024 * 1024) throw new Error("Marketplace response too large.");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMarketplacePlugins(query: MarketplaceQuery = {}, fetchImpl: typeof fetch = fetch): Promise<MarketplacePage> {
  const params = new URLSearchParams();
  if (query.q !== undefined) params.set("q", text(query.q, 200));
  if (query.category !== undefined) params.set("category", text(query.category, 120));
  if (query.sort !== undefined) {
    if (!["popular", "newest", "rating", "name"].includes(query.sort)) throw new Error("Invalid marketplace sort.");
    params.set("sort", query.sort);
  }
  for (const key of ["offset", "limit"] as const) {
    const value = query[key];
    if (value === undefined) continue;
    const minimum = key === "limit" ? 1 : 0;
    const maximum = key === "limit" ? 100 : 1_000_000;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error("Invalid marketplace pagination.");
    }
    params.set(key, String(value));
  }
  const data = object(await request(`/api/marketplace/plugins?${params}`, fetchImpl));
  if (!Array.isArray(data.plugins) || data.plugins.length > 100) throw new Error("Invalid marketplace page.");
  return {
    plugins: data.plugins.map((item) => plugin(item, marketplaceOrigin())),
    total: number(data.total),
    offset: number(data.offset),
    limit: number(data.limit),
  };
}

export async function getMarketplacePlugin(id: string, fetchImpl: typeof fetch = fetch): Promise<MarketplaceDetail> {
  if (!/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id)) throw new Error("Invalid marketplace plugin id.");
  const data = object(await request(`/api/marketplace/plugins/${encodeURIComponent(id)}`, fetchImpl));
  const summary = plugin(data, marketplaceOrigin());
  if (summary.id !== id || !Array.isArray(data.releases) || data.releases.length > 1000 || !Array.isArray(data.screenshots) || data.screenshots.length > 32) {
    throw new Error("Invalid marketplace detail.");
  }
  return {
    ...summary,
    readme: text(data.readme, 256_000),
    screenshots: data.screenshots.map((item) => url(item, marketplaceOrigin())),
    sourceUrl: optionalText(data.sourceUrl),
    homepageUrl: optionalText(data.homepageUrl),
    license: optionalText(data.license, 256),
    changelog: text(data.changelog ?? "", 64_000),
    releases: data.releases.map((item) => release(item, marketplaceOrigin(), id, summary.name, summary.description, true)),
  };
}
