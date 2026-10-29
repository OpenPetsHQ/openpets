import { createCatalogV3Client, fetchCatalogJson, getCuratedCatalogPage } from "@open-pets/pet-format/catalog-v3";
import {
  normalizeRemoteCatalogSpriteVersionOne,
  toCatalogPetV2Compat,
  validateCatalogV2,
  type CatalogPetV2,
  type CatalogV2,
  type CatalogV3Index,
  type CatalogV3SearchPet,
} from "@open-pets/pet-format/catalog-validation";

export interface CatalogRemoteClient {
  getV3Index(): Promise<CatalogV3Index>;
  getV3Page(page: number, index: CatalogV3Index): Promise<readonly CatalogPetV2[]>;
  getV3Search(index: CatalogV3Index): Promise<readonly CatalogV3SearchPet[]>;
  getCuratedPage(page: number, index: CatalogV3Index): Promise<readonly CatalogPetV2[]>;
  getV2Catalog(): Promise<CatalogV2>;
}

export function createCatalogRemoteClient(options: {
  readonly v2Url: string;
  readonly v3Url: string;
  readonly fetchImpl?: typeof globalThis.fetch;
}): CatalogRemoteClient {
  const { v2Url, v3Url, fetchImpl = globalThis.fetch } = options;
  const v3 = createCatalogV3Client({ url: v3Url, fetchImpl });
  let v2CatalogPromise: Promise<CatalogV2> | null = null;

  return {
    getV3Index: v3.getIndex,
    getV3Search: v3.getSearch,
    async getV3Page(page, index) {
      return (await v3.getPage(page, index)).map(toCatalogPetV2Compat);
    },
    async getCuratedPage(page, index) {
      return (await getCuratedCatalogPage(v3, page, index)).map(toCatalogPetV2Compat);
    },
    async getV2Catalog() {
      v2CatalogPromise ||= fetchCatalogJson(v2Url, 1_000_000, fetchImpl)
        .then((value) => validateCatalogV2(normalizeRemoteCatalogSpriteVersionOne(value)));
      return await v2CatalogPromise;
    },
  };
}
