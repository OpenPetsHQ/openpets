import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

import { createCatalogRemoteClient } from "./catalog-remote.js";
import { validateCatalogV2, type CatalogPetV2, type CatalogV2, type CatalogV3Index, type CatalogV3SearchPet } from "./catalog-validation.js";

export const catalogUrl = "https://openpets.dev/pets/catalog.v2.json";
export const catalogV3Url = "https://openpets.dev/pets/catalog.v3.json";
const fixtureRelativePath = "catalog.v2.fixture.json";

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

const catalogRemote = createCatalogRemoteClient({ v2Url: catalogUrl, v3Url: catalogV3Url });

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
    const surfacedPets = getSurfaceableSearchPets(await catalogRemote.getV3Search(remoteV3.index), remoteV3.index);
    return { source: "remote", pets: surfacedPets, total: surfacedPets.length };
  } catch (error) {
    return { source: "error", pets: [], error: error instanceof Error ? error.message : "unknown error" };
  }
}

export async function getCatalogPet(petId: string): Promise<CatalogPetV2> {
  const remoteV3 = await tryLoadRemoteCatalogV3Index();
  if (remoteV3.ok) {
    try {
      const searchPets = await catalogRemote.getV3Search(remoteV3.index);
      const searchPet = searchPets.find((pet) => pet.id === petId);
      if (searchPet) {
        const page = await catalogRemote.getV3Page(searchPet.catalogPage, remoteV3.index);
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
    const index = await catalogRemote.getV3Index();
    return { ok: true, index };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

async function tryLoadSurfaceableCatalogV3Page(page: number, index: CatalogV3Index): Promise<{ readonly ok: true; readonly pets: readonly CatalogPetV2[] } | { readonly ok: false; readonly error: string }> {
  try {
    const searchPets = filterSurfaceablePets(await catalogRemote.getV3Search(index));
    const pageSearchPets = searchPets.slice(page * index.pageSize, (page + 1) * index.pageSize);
    const ids = new Set(pageSearchPets.map((pet) => pet.id));
    const catalogPageNumbers = [...new Set(pageSearchPets.map((pet) => pet.catalogPage))];
    const catalogPages = await Promise.all(catalogPageNumbers.map((catalogPage) => catalogRemote.getV3Page(catalogPage, index)));
    const petsById = new Map(catalogPages.flat().filter((pet) => ids.has(pet.id) && isSurfaceablePet(pet)).map((pet) => [pet.id, pet]));
    return { ok: true, pets: pageSearchPets.map((pet) => petsById.get(pet.id)).filter((pet): pet is CatalogPetV2 => Boolean(pet)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

async function tryLoadRemoteCatalog(): Promise<{ readonly ok: true; readonly catalog: CatalogV2 } | { readonly ok: false; readonly error: string }> {
  try {
    return { ok: true, catalog: await catalogRemote.getV2Catalog() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

async function getV2CatalogOrFixture(): Promise<CatalogV2> {
  const remote = await tryLoadRemoteCatalog();
  if (remote.ok) return remote.catalog;
  const fixture = await tryLoadFixtureCatalog();
  if (fixture.ok) return fixture.catalog;
  throw new Error(`Catalog unavailable: ${remote.error}. Fixture unavailable: ${fixture.error}`);
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
