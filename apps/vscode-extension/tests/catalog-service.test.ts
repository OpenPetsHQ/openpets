import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { CatalogV3Client } from "@open-pets/pet-format/catalog-v3";
import type {
  CatalogPetV3,
  CatalogV3Index,
  CatalogV3SearchPet,
} from "@open-pets/pet-format/catalog-validation";
import {
  CatalogService,
  compatibilityProblem,
} from "../src/host/catalog-service.js";

test("curated search hydrates the original physical page and failures remain retryable", async () => {
  const index: CatalogV3Index = {
    version: 3,
    generatedAt: "2026-01-01",
    total: 2,
    pageSize: 1,
    search: "",
    filters: { categories: [] },
    pages: ["0", "1"],
  };
  const hits: CatalogV3SearchPet[] = [
    {
      id: "hidden",
      displayName: "Hidden",
      searchText: "needle",
      category: "western",
      catalogPage: 0,
    },
    {
      id: "found",
      displayName: "Found",
      searchText: "needle",
      category: "asian",
      catalogPage: 1,
      original: true,
    },
  ];
  const pet: CatalogPetV3 = {
    id: "found",
    displayName: "Found",
    description: "Found pet",
    thumbnail: "https://openpets.dev/pets/a.webp",
    spritesheet: "https://openpets.dev/pets/b.webp",
    zip: "https://zip.openpets.dev/pets/a.zip",
    category: "asian",
    original: true,
    minOpenPetsVersion: "4.1.0",
  };
  let failed = false;
  const pages: number[] = [];
  const client: CatalogV3Client = {
    getIndex: async () => index,
    getSearch: async () => {
      if (!failed) {
        failed = true;
        throw new Error("offline");
      }
      return hits;
    },
    getPage: async (page) => {
      pages.push(page);
      return page === 1 ? [pet] : [];
    },
  };
  const catalog = new CatalogService(new AbortController().signal, client);
  await assert.rejects(catalog.list("needle", 0, new Set()), /offline/);
  const result = await catalog.list("needle", 0, new Set());
  assert.equal(result.total, 1);
  assert.equal(result.pets[0].id, "found");
  assert.deepEqual(pages, [1]);
  assert.equal(result.pets[0].canInstall, true);
  assert.ok(compatibilityProblem({ ...pet, minOpenPetsVersion: "4.2.0" }));
  assert.equal((await catalog.list("no match", 2, new Set())).pageCount, 0);
});
