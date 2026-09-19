import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

import { toCatalogPetV2Compat, validateCatalogV2, validateCatalogV3Index, validateCatalogV3Page, validateCatalogV3SearchIndex, validateCatalogV3SearchPage, type CatalogPetV2, type CatalogV2, type CatalogV3Index, type CatalogV3SearchPet } from "./catalog-validation.js";

export const catalogUrl = "https://openpets.dev/pets/catalog.v2.json";
export const catalogV3Url = "https://openpets.dev/pets/catalog.v3.json";
const fixtureRelativePath = "catalog.v2.fixture.json";
const maxCatalogBytes = 1_000_000;
const maxCatalogV3PageBytes = 256_000;
const fetchTimeoutMs = 5_000;

export interface CatalogUiState {
  readonly source: "remote" | "fixture" | "error";
  readonly pets: readonly CatalogPetV2[];
  readonly generatedAt?: string;
  readonly error?: string;
  readonly fallbackReason?: string;
  readonly version?: 2 | 3;
  readonly total?: number;
  readonly categories?: readonly { readonly id: "western" | "asian"; readonly label: string; readonly count: number }[];
  readonly page?: number;
  readonly pageCount?: number;
  readonly supportsCategories?: boolean;
  readonly originalsCount?: number;
  readonly featuredCount?: number;
}

export interface CatalogSearchUiState {
  readonly source: "remote" | "error";
  readonly pets: readonly CatalogV3SearchPet[];
  readonly total?: number;
  readonly error?: string;
}

const v3PageCache = new Map<number, readonly CatalogPetV2[]>();
let v3IndexPromise: Promise<CatalogV3Index> | null = null;
let v3SearchPromise: Promise<readonly CatalogV3SearchPet[]> | null = null;
let v2CatalogPromise: Promise<CatalogV2> | null = null;

export async function getCatalogUiState(): Promise<CatalogUiState> {
  const remoteV3 = await tryLoadRemoteCatalogV3Index();

  if (remoteV3.ok) {
    const firstPage = await tryLoadSurfaceableCatalogV3Page(0, remoteV3.index);
    if (!firstPage.ok) return await getV2OrFixtureCatalogUiState(`v3 page unavailable: ${firstPage.error}`);
    return {
      source: "remote",
      pets: filterSurfaceablePets(firstPage.pets),
      generatedAt: remoteV3.index.generatedAt,
      version: 3,
      total: surfaceableTotal(remoteV3.index),
      categories: remoteV3.index.filters.categories,
      page: 0,
      pageCount: surfaceablePageCount(remoteV3.index),
      supportsCategories: true,
      originalsCount: remoteV3.index.filters.originalsCount,
      featuredCount: remoteV3.index.filters.featuredCount,
    };
  }

  return await getV2OrFixtureCatalogUiState(remoteV3.error);
}

export async function getCatalogPageUiState(page: number): Promise<CatalogUiState> {
  if (!Number.isInteger(page) || page < 0) throw new Error("Catalog page must be a non-negative integer.");
  const remoteV3 = await tryLoadRemoteCatalogV3Index();
  if (!remoteV3.ok) return { source: "error", pets: [], error: remoteV3.error };
  if (page >= surfaceablePageCount(remoteV3.index)) throw new Error("Catalog page is out of range.");
  const pageResult = await tryLoadSurfaceableCatalogV3Page(page, remoteV3.index);
  if (!pageResult.ok) return { source: "error", pets: [], error: pageResult.error };

  return {
    source: "remote",
    pets: filterSurfaceablePets(pageResult.pets),
    generatedAt: remoteV3.index.generatedAt,
    version: 3,
    total: surfaceableTotal(remoteV3.index),
    categories: remoteV3.index.filters.categories,
    page,
    pageCount: surfaceablePageCount(remoteV3.index),
    supportsCategories: true,
    originalsCount: remoteV3.index.filters.originalsCount,
    featuredCount: remoteV3.index.filters.featuredCount,
  };
}

export async function getCatalogSearchUiState(): Promise<CatalogSearchUiState> {
  const remoteV3 = await tryLoadRemoteCatalogV3Index();
  if (!remoteV3.ok) return { source: "error", pets: [], error: remoteV3.error };

  try {
    const surfacedPets = getSurfaceableSearchPets(await getRemoteCatalogV3Search(remoteV3.index), remoteV3.index);
    return { source: "remote", pets: surfacedPets, total: surfacedPets.length };
  } catch (error) {
    return { source: "error", pets: [], error: error instanceof Error ? error.message : "unknown error" };
  }
}

export async function getCatalogPet(petId: string): Promise<CatalogPetV2> {
  const remoteV3 = await tryLoadRemoteCatalogV3Index();
  if (remoteV3.ok) {
    try {
      const searchPets = await getRemoteCatalogV3Search(remoteV3.index);
      const searchPet = searchPets.find((pet) => pet.id === petId);
      if (searchPet) {
        const page = await getRemoteCatalogV3Page(searchPet.catalogPage, remoteV3.index);
        const pet = page.find((candidate) => candidate.id === petId);
        if (pet) return pet;
      }
    } catch (error) {
      // Fall through to v2/fixture so visible v2-compatible pets remain installable during partial v3 outages.
    }
  }

  const catalog = await getV2CatalogOrFixture();
  const pet = filterSurfaceablePets(catalog.pets).find((candidate) => candidate.id === petId);
  if (!pet) throw new Error(`Pet is not available in the validated catalog: ${petId}`);
  return pet;
}

async function getV2OrFixtureCatalogUiState(remoteV3Error: string): Promise<CatalogUiState> {

  const remote = await tryLoadRemoteCatalog();

  if (remote.ok) {
    return {
      source: "remote",
      pets: filterSurfaceablePets(remote.catalog.pets),
      generatedAt: remote.catalog.generatedAt,
      error: `v3 unavailable: ${remoteV3Error}`,
      fallbackReason: "v3_to_v2_remote",
      version: 2,
      total: filterSurfaceablePets(remote.catalog.pets).length,
      supportsCategories: false,
    };
  }

  const fixture = await tryLoadFixtureCatalog();

  if (fixture.ok) {
    return {
      source: "fixture",
      pets: filterSurfaceablePets(fixture.catalog.pets),
      generatedAt: fixture.catalog.generatedAt,
      error: `Catalog unavailable: ${remoteV3Error}; v2 unavailable: ${remote.error}`,
      version: 2,
      total: filterSurfaceablePets(fixture.catalog.pets).length,
      supportsCategories: false,
    };
  }

  return {
    source: "error",
    pets: [],
    error: `Catalog unavailable: ${remoteV3Error}; v2 unavailable: ${remote.error}. Fixture unavailable: ${fixture.error}`,
  };
}

function filterSurfaceablePets<T extends { readonly original?: boolean; readonly featured?: boolean }>(pets: readonly T[]): readonly T[] {
  return pets.filter(isSurfaceablePet);
}

function isSurfaceablePet(pet: { readonly original?: boolean; readonly featured?: boolean }): boolean {
  return pet.original === true || pet.featured === true;
}

function getSurfaceableSearchPets(pets: readonly CatalogV3SearchPet[], index: CatalogV3Index): readonly CatalogV3SearchPet[] {
  return filterSurfaceablePets(pets).map((pet, surfaceIndex) => ({
    ...pet,
    catalogPage: Math.floor(surfaceIndex / index.pageSize),
  }));
}

function surfaceableTotal(index: CatalogV3Index): number {
  return (index.filters.originalsCount ?? 0) + (index.filters.featuredCount ?? 0);
}

function surfaceablePageCount(index: CatalogV3Index): number {
  return Math.ceil(surfaceableTotal(index) / index.pageSize);
}

async function tryLoadRemoteCatalogV3Index(): Promise<{ readonly ok: true; readonly index: CatalogV3Index } | { readonly ok: false; readonly error: string }> {
  try {
    const index = await getRemoteCatalogV3Index();
    return { ok: true, index };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

async function tryLoadRemoteCatalogV3Page(page: number, index: CatalogV3Index): Promise<{ readonly ok: true; readonly pets: readonly CatalogPetV2[] } | { readonly ok: false; readonly error: string }> {
  try {
    return { ok: true, pets: await getRemoteCatalogV3Page(page, index) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

async function tryLoadSurfaceableCatalogV3Page(page: number, index: CatalogV3Index): Promise<{ readonly ok: true; readonly pets: readonly CatalogPetV2[] } | { readonly ok: false; readonly error: string }> {
  try {
    const searchPets = filterSurfaceablePets(await getRemoteCatalogV3Search(index));
    const pageSearchPets = searchPets.slice(page * index.pageSize, (page + 1) * index.pageSize);
    const ids = new Set(pageSearchPets.map((pet) => pet.id));
    const catalogPageNumbers = [...new Set(pageSearchPets.map((pet) => pet.catalogPage))];
    const catalogPages = await Promise.all(catalogPageNumbers.map((catalogPage) => getRemoteCatalogV3Page(catalogPage, index)));
    const petsById = new Map(catalogPages.flat().filter((pet) => ids.has(pet.id) && isSurfaceablePet(pet)).map((pet) => [pet.id, pet]));
    return { ok: true, pets: pageSearchPets.map((pet) => petsById.get(pet.id)).filter((pet): pet is CatalogPetV2 => Boolean(pet)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

async function getRemoteCatalogV3Index(): Promise<CatalogV3Index> {
  v3IndexPromise ||= Promise.resolve().then(async () => validateCatalogV3Index(JSON.parse(await fetchLimitedText(catalogV3Url, maxCatalogV3PageBytes)) as unknown));
  return await v3IndexPromise;
}

async function getRemoteCatalogV3Page(page: number, index: CatalogV3Index): Promise<readonly CatalogPetV2[]> {
  const cached = v3PageCache.get(page);
  if (cached) return cached;
  const pageUrl = index.pages[page];
  if (!pageUrl) throw new Error("Catalog page is out of range.");
  const payload = validateCatalogV3Page(JSON.parse(await fetchLimitedText(pageUrl, maxCatalogV3PageBytes)) as unknown, page);
  const pets = payload.pets.map(toCatalogPetV2Compat);
  assertUniquePetIds(pets);
  v3PageCache.set(page, pets);
  return pets;
}

async function getRemoteCatalogV3Search(index: CatalogV3Index): Promise<readonly CatalogV3SearchPet[]> {
  v3SearchPromise ||= Promise.resolve().then(async () => {
    const searchIndex = validateCatalogV3SearchIndex(JSON.parse(await fetchLimitedText(index.search, maxCatalogV3PageBytes)) as unknown);
    const pages = await Promise.all(searchIndex.pages.map(async (pageUrl, page) => validateCatalogV3SearchPage(JSON.parse(await fetchLimitedText(pageUrl, maxCatalogV3PageBytes)) as unknown, page, index.pages.length)));
    const pets = pages.flatMap((page) => page.pets);
    if (pets.length !== index.total) throw new Error("Catalog v3 search total does not match index total.");
    return pets;
  });
  return await v3SearchPromise;
}

async function tryLoadRemoteCatalog(): Promise<{ readonly ok: true; readonly catalog: CatalogV2 } | { readonly ok: false; readonly error: string }> {
  try {
    return { ok: true, catalog: await getRemoteCatalogV2() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

async function getRemoteCatalogV2(): Promise<CatalogV2> {
  v2CatalogPromise ||= Promise.resolve().then(async () => validateCatalogV2(JSON.parse(await fetchLimitedText(catalogUrl, maxCatalogBytes)) as unknown));
  return await v2CatalogPromise;
}

async function getV2CatalogOrFixture(): Promise<CatalogV2> {
  const remote = await tryLoadRemoteCatalog();
  if (remote.ok) return remote.catalog;
  const fixture = await tryLoadFixtureCatalog();
  if (fixture.ok) return fixture.catalog;
  throw new Error(`Catalog unavailable: ${remote.error}. Fixture unavailable: ${fixture.error}`);
}

async function fetchLimitedText(url: string, maxBytes: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

  try {
    const response = await fetch(url, {
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

async function tryLoadFixtureCatalog(): Promise<{ readonly ok: true; readonly catalog: CatalogV2 } | { readonly ok: false; readonly error: string }> {
  try {
    return { ok: true, catalog: validateCatalogV2(await loadFixtureCatalog()) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

async function loadFixtureCatalog(): Promise<unknown> {
  const fixturePath = join(app.getAppPath(), fixtureRelativePath);
  return JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
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
