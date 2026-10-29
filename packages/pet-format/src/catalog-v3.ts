import {
  normalizeRemoteCatalogSpriteVersionOne,
  validateCatalogV3Index,
  validateCatalogV3Page,
  validateCatalogV3SearchIndex,
  validateCatalogV3SearchPage,
  type CatalogPetV3,
  type CatalogV3Index,
  type CatalogV3SearchPet,
} from "./catalog-validation.js";

export const catalogV3Url = "https://openpets.dev/pets/catalog.v3.json";
const maxCatalogV3Bytes = 256_000;

export interface CatalogV3Client {
  getIndex(): Promise<CatalogV3Index>;
  getPage(page: number, index: CatalogV3Index): Promise<readonly CatalogPetV3[]>;
  getSearch(index: CatalogV3Index): Promise<readonly CatalogV3SearchPet[]>;
}

export function createCatalogV3Client(options: {
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
  readonly url?: string;
} = {}): CatalogV3Client {
  const { fetchImpl = globalThis.fetch, signal, url = catalogV3Url } = options;
  let indexPromise: Promise<CatalogV3Index> | undefined;
  let searchPromise: Promise<readonly CatalogV3SearchPet[]> | undefined;
  const pages = new Map<number, Promise<readonly CatalogPetV3[]>>();

  function getIndex(): Promise<CatalogV3Index> {
    if (!indexPromise) {
      const request = fetchCatalogJson(url, maxCatalogV3Bytes, fetchImpl, signal)
        .then(validateCatalogV3Index);
      indexPromise = request;
      void request.catch(() => { if (indexPromise === request) indexPromise = undefined; });
    }
    return indexPromise;
  }

  function getPage(page: number, index: CatalogV3Index): Promise<readonly CatalogPetV3[]> {
    const pageUrl = index.pages[page];
    if (!pageUrl) return Promise.reject(new Error("Catalog page is out of range."));
    let request = pages.get(page);
    if (!request) {
      request = fetchCatalogJson(pageUrl, maxCatalogV3Bytes, fetchImpl, signal)
        .then((value) => validateCatalogV3Page(normalizeRemoteCatalogSpriteVersionOne(value), page).pets);
      pages.set(page, request);
      const pending = request;
      void pending.catch(() => { if (pages.get(page) === pending) pages.delete(page); });
    }
    return request;
  }

  function getSearch(index: CatalogV3Index): Promise<readonly CatalogV3SearchPet[]> {
    if (!searchPromise) {
      const request = (async () => {
        const searchIndex = validateCatalogV3SearchIndex(await fetchCatalogJson(index.search, maxCatalogV3Bytes, fetchImpl, signal));
        const searchPages = await Promise.all(searchIndex.pages.map(async (pageUrl, page) => validateCatalogV3SearchPage(
          normalizeRemoteCatalogSpriteVersionOne(await fetchCatalogJson(pageUrl, maxCatalogV3Bytes, fetchImpl, signal)),
          page,
          index.pages.length,
        )));
        const pets = searchPages.flatMap((page) => page.pets);
        if (pets.length !== index.total) throw new Error("Catalog v3 search total does not match index total.");
        return pets;
      })();
      searchPromise = request;
      void request.catch(() => { if (searchPromise === request) searchPromise = undefined; });
    }
    return searchPromise;
  }

  return { getIndex, getPage, getSearch };
}

export function isCuratedCatalogPet(pet: { readonly original?: boolean; readonly featured?: boolean }): boolean {
  return pet.original === true || pet.featured === true;
}

/** Hydrate a virtual curated page in search order, even across source pages. */
export async function getCuratedCatalogPage(client: CatalogV3Client, page: number, index: CatalogV3Index): Promise<readonly CatalogPetV3[]> {
  const search = (await client.getSearch(index)).filter(isCuratedCatalogPet);
  const selected = search.slice(page * index.pageSize, (page + 1) * index.pageSize);
  const pageNumbers = [...new Set(selected.map((pet) => pet.catalogPage))];
  const pages = await Promise.all(pageNumbers.map((number) => client.getPage(number, index)));
  const ids = new Set(selected.map((pet) => pet.id));
  const byId = new Map(pages.flat().filter((pet) => ids.has(pet.id) && isCuratedCatalogPet(pet)).map((pet) => [pet.id, pet]));
  return selected.map((pet) => byId.get(pet.id)).filter((pet): pet is CatalogPetV3 => Boolean(pet));
}

/** Bounded transport shared by the v3 client and desktop's legacy v2 fallback. */
export async function fetchCatalogJson(url: string, maxBytes: number, fetchImpl: typeof globalThis.fetch = globalThis.fetch, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 5_000);
  let response: Response | undefined;
  try {
    response = await fetchImpl(url, { signal: controller.signal, redirect: "error", credentials: "omit" });
    if (new URL(response.url).href !== url) throw new Error("Catalog final URL is not allowed.");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Catalog response body is unavailable for bounded reading.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new Error("Catalog response is too large.");
        chunks.push(value);
      }
    } catch (error) {
      controller.abort();
      void reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    controller.abort();
    if (response?.body && !response.body.locked) {
      // Cancellation is best effort: an already-aborted stream may reject.
      void response.body.cancel().catch(() => {});
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
