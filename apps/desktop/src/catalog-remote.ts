import {
  normalizeRemoteCatalogSpriteVersionOne,
  toCatalogPetV2Compat,
  validateCatalogV2,
  validateCatalogV3Index,
  validateCatalogV3Page,
  validateCatalogV3SearchIndex,
  validateCatalogV3SearchPage,
  type CatalogPetV2,
  type CatalogV2,
  type CatalogV3Index,
  type CatalogV3SearchPet,
} from "./catalog-validation.js";

const maxCatalogBytes = 1_000_000;
const maxCatalogV3PageBytes = 256_000;
const fetchTimeoutMs = 5_000;

export interface CatalogRemoteClient {
  getV3Index(): Promise<CatalogV3Index>;
  getV3Page(page: number, index: CatalogV3Index): Promise<readonly CatalogPetV2[]>;
  getV3Search(index: CatalogV3Index): Promise<readonly CatalogV3SearchPet[]>;
  getV2Catalog(): Promise<CatalogV2>;
}

export function createCatalogRemoteClient(options: {
  readonly v2Url: string;
  readonly v3Url: string;
  readonly fetchImpl?: typeof globalThis.fetch;
}): CatalogRemoteClient {
  const { v2Url, v3Url, fetchImpl = globalThis.fetch } = options;
  const v3PageCache = new Map<number, readonly CatalogPetV2[]>();
  let v3IndexPromise: Promise<CatalogV3Index> | null = null;
  let v3SearchPromise: Promise<readonly CatalogV3SearchPet[]> | null = null;
  let v2CatalogPromise: Promise<CatalogV2> | null = null;

  async function getV3Index(): Promise<CatalogV3Index> {
    if (!v3IndexPromise) {
      const request = Promise.resolve().then(async () => validateCatalogV3Index(
        JSON.parse(await fetchLimitedText(v3Url, maxCatalogV3PageBytes)) as unknown,
      ));
      v3IndexPromise = request;
    }

    const request = v3IndexPromise;
    try {
      return await request;
    } catch (error) {
      if (v3IndexPromise === request) v3IndexPromise = null;
      throw error;
    }
  }

  async function getV3Page(page: number, index: CatalogV3Index): Promise<readonly CatalogPetV2[]> {
    const cached = v3PageCache.get(page);
    if (cached) return cached;

    const pageUrl = index.pages[page];
    if (!pageUrl) throw new Error("Catalog page is out of range.");

    const payload = validateCatalogV3Page(
      normalizeRemoteCatalogSpriteVersionOne(JSON.parse(await fetchLimitedText(pageUrl, maxCatalogV3PageBytes)) as unknown),
      page,
    );
    const pets = payload.pets.map(toCatalogPetV2Compat);
    assertUniquePetIds(pets);
    v3PageCache.set(page, pets);
    return pets;
  }

  async function getV3Search(index: CatalogV3Index): Promise<readonly CatalogV3SearchPet[]> {
    if (!v3SearchPromise) {
      const request = Promise.resolve().then(async () => {
        const searchIndex = validateCatalogV3SearchIndex(
          JSON.parse(await fetchLimitedText(index.search, maxCatalogV3PageBytes)) as unknown,
        );
        const pages = await Promise.all(searchIndex.pages.map(async (pageUrl, page) => validateCatalogV3SearchPage(
          normalizeRemoteCatalogSpriteVersionOne(JSON.parse(await fetchLimitedText(pageUrl, maxCatalogV3PageBytes)) as unknown),
          page,
          index.pages.length,
        )));
        const pets = pages.flatMap((page) => page.pets);
        if (pets.length !== index.total) throw new Error("Catalog v3 search total does not match index total.");
        return pets;
      });
      v3SearchPromise = request;
    }

    const request = v3SearchPromise;
    try {
      return await request;
    } catch (error) {
      if (v3SearchPromise === request) v3SearchPromise = null;
      throw error;
    }
  }

  async function getV2Catalog(): Promise<CatalogV2> {
    v2CatalogPromise ||= Promise.resolve().then(async () => validateCatalogV2(
      normalizeRemoteCatalogSpriteVersionOne(JSON.parse(await fetchLimitedText(v2Url, maxCatalogBytes)) as unknown),
    ));
    return await v2CatalogPromise;
  }

  async function fetchLimitedText(url: string, maxBytes: number): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
      });

      validateCatalogEndpoint(response.url, url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      return await readLimitedResponse(response, maxBytes);
    } finally {
      clearTimeout(timeout);
    }
  }

  return { getV3Index, getV3Page, getV3Search, getV2Catalog };
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Catalog response body is unavailable for bounded reading.");

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new Error("Catalog response is too large.");
    chunks.push(value);
  }

  return new TextDecoder().decode(concatChunks(chunks, total));
}

function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function validateCatalogEndpoint(value: string, expected: string): void {
  const url = new URL(value);
  if (url.href !== expected) throw new Error("Catalog final URL is not allowed.");
}

function assertUniquePetIds(pets: readonly CatalogPetV2[]): void {
  const ids = new Set<string>();
  for (const pet of pets) {
    if (ids.has(pet.id)) throw new Error(`Duplicate catalog v3 pet id: ${pet.id}`);
    ids.add(pet.id);
  }
}
