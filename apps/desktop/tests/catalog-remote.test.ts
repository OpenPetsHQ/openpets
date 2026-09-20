import assert from "node:assert/strict";

import { createCatalogRemoteClient } from "../src/catalog-remote.js";
import type { CatalogV3Index } from "../src/catalog-validation.js";

const v2Url = "https://openpets.dev/pets/catalog.v2.json";
const v3Url = "https://openpets.dev/pets/catalog.v3.json";
const pageUrl = "https://openpets.dev/pets/catalog.v3/page-000.json";
const searchUrl = "https://openpets.dev/pets/catalog.v3/search.json";
const searchPageOneUrl = "https://openpets.dev/pets/catalog.v3/search-page-000.json";
const searchPageTwoUrl = "https://openpets.dev/pets/catalog.v3/search-page-001.json";

const generatedAt = "2026-01-01T00:00:00.000Z";
const index: CatalogV3Index = {
  version: 3,
  generatedAt,
  total: 2,
  pageSize: 2,
  search: searchUrl,
  filters: { categories: [] },
  pages: [pageUrl],
};

function response(url: string, body: string, status = 200): Response {
  const bytes = new TextEncoder().encode(body);
  return {
    url,
    ok: status >= 200 && status < 300,
    status,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  } as unknown as Response;
}

function fetchFromQueue(queue: Map<string, Array<Response | Error>>): { fetchImpl: typeof fetch; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.set(url, (calls.get(url) ?? 0) + 1);
    const next = queue.get(url)?.shift();
    if (!next) throw new Error(`Unexpected fetch: ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

const v2Payload = JSON.stringify({
  version: 2,
  generatedAt,
  pets: [{ id: "legacy", displayName: "Legacy", description: "Legacy", preview: "https://openpets.dev/pets/legacy/thumb.webp", zip: "https://zip.openpets.dev/pets/legacy/legacy.zip" }],
});

const v3PagePayload = JSON.stringify({
  version: 3,
  page: 0,
  pageSize: 2,
  pets: [{
    id: "malou",
    displayName: "Malou",
    description: "A pet",
    thumbnail: "https://openpets.dev/pets/malou/thumb.webp",
    spritesheet: "https://openpets.dev/pets/malou/spritesheet.webp",
    zip: "https://zip.openpets.dev/pets/malou/malou.zip",
    category: "western",
    original: true,
  }],
});

async function testStickySuccessfulCaches(): Promise<void> {
  const queue = new Map<string, Array<Response | Error>>([
    [v3Url, [response(v3Url, JSON.stringify({ ...index, total: 0, pages: [], search: searchUrl }))]],
    [searchUrl, [response(searchUrl, JSON.stringify({ version: 3, generatedAt, total: 0, pageSize: 1, pages: [] }))]],
    [v2Url, [response(v2Url, v2Payload)]],
  ]);
  const { fetchImpl, calls } = fetchFromQueue(queue);
  const client = createCatalogRemoteClient({ v2Url, v3Url, fetchImpl });

  await client.getV3Index();
  await client.getV3Index();
  await client.getV3Search({ ...index, total: 0, pages: [] });
  await client.getV3Search({ ...index, total: 0, pages: [] });
  await client.getV2Catalog();
  await client.getV2Catalog();

  assert.equal(calls.get(v3Url), 1);
  assert.equal(calls.get(searchUrl), 1);
  assert.equal(calls.get(v2Url), 1);
}

async function testStickyRejectedCaches(): Promise<void> {
  const queue = new Map<string, Array<Response | Error>>([
    [v3Url, [new Error("index failed")]],
    [searchUrl, [new Error("search failed")]],
    [v2Url, [new Error("v2 failed")]],
  ]);
  const { fetchImpl, calls } = fetchFromQueue(queue);
  const client = createCatalogRemoteClient({ v2Url, v3Url, fetchImpl });

  await assert.rejects(() => client.getV3Index(), /index failed/);
  await assert.rejects(() => client.getV3Index(), /index failed/);
  await assert.rejects(() => client.getV3Search(index), /search failed/);
  await assert.rejects(() => client.getV3Search(index), /search failed/);
  await assert.rejects(() => client.getV2Catalog(), /v2 failed/);
  await assert.rejects(() => client.getV2Catalog(), /v2 failed/);

  assert.equal(calls.get(v3Url), 1);
  assert.equal(calls.get(searchUrl), 1);
  assert.equal(calls.get(v2Url), 1);
}

async function testPageCachingAndRetry(): Promise<void> {
  const queue = new Map<string, Array<Response | Error>>([
    [pageUrl, [new Error("page failed"), response(pageUrl, v3PagePayload)]],
  ]);
  const { fetchImpl, calls } = fetchFromQueue(queue);
  const client = createCatalogRemoteClient({ v2Url, v3Url, fetchImpl });

  await assert.rejects(() => client.getV3Page(0, index), /page failed/);
  const page = await client.getV3Page(0, index);
  const cachedPage = await client.getV3Page(0, index);

  assert.equal(page[0]?.id, "malou");
  assert.deepEqual(cachedPage, page);
  assert.equal(calls.get(pageUrl), 2);
}

async function testConcurrentUncachedPagesDoNotCoalesce(): Promise<void> {
  let calls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    calls += 1;
    return response(String(input), v3PagePayload);
  };
  const client = createCatalogRemoteClient({ v2Url, v3Url, fetchImpl });

  const pages = await Promise.all([client.getV3Page(0, index), client.getV3Page(0, index)]);

  assert.equal(calls, 2);
  assert.equal(pages[0]?.[0]?.id, "malou");
  assert.equal(pages[1]?.[0]?.id, "malou");
}

async function testSearchFlattenPreservesPageOrder(): Promise<void> {
  const searchIndex = JSON.stringify({ version: 3, generatedAt, total: 2, pageSize: 1, pages: [searchPageOneUrl, searchPageTwoUrl] });
  const firstSearchPage = JSON.stringify({ version: 3, page: 0, pageSize: 1, pets: [{ id: "first", displayName: "First", searchText: "first", category: "western", catalogPage: 0 }] });
  const secondSearchPage = JSON.stringify({ version: 3, page: 1, pageSize: 1, pets: [{ id: "second", displayName: "Second", searchText: "second", category: "asian", catalogPage: 0 }] });
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url === searchUrl) return response(searchUrl, searchIndex);
    if (url === searchPageOneUrl) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return response(searchPageOneUrl, firstSearchPage);
    }
    if (url === searchPageTwoUrl) return response(searchPageTwoUrl, secondSearchPage);
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const client = createCatalogRemoteClient({ v2Url, v3Url, fetchImpl });

  const pets = await client.getV3Search(index);

  assert.deepEqual(pets.map((pet) => pet.id), ["first", "second"]);
}

async function testEndpointAndByteLimits(): Promise<void> {
  const invalidFinalUrl = fetchFromQueue(new Map([[v3Url, [response("https://openpets.dev/pets/redirected.json", "{}")]]]));
  const endpointClient = createCatalogRemoteClient({ v2Url, v3Url, fetchImpl: invalidFinalUrl.fetchImpl });
  await assert.rejects(() => endpointClient.getV3Index(), /Catalog final URL is not allowed\./);

  const oversizedV3 = "x".repeat(256_001);
  const v3Limit = fetchFromQueue(new Map([[v3Url, [response(v3Url, oversizedV3)]]]));
  const v3Client = createCatalogRemoteClient({ v2Url, v3Url, fetchImpl: v3Limit.fetchImpl });
  await assert.rejects(() => v3Client.getV3Index(), /Catalog response is too large\./);

  const oversizedV2 = "x".repeat(1_000_001);
  const v2Limit = fetchFromQueue(new Map([[v2Url, [response(v2Url, oversizedV2)]]]));
  const v2Client = createCatalogRemoteClient({ v2Url, v3Url, fetchImpl: v2Limit.fetchImpl });
  await assert.rejects(() => v2Client.getV2Catalog(), /Catalog response is too large\./);
}

await testStickySuccessfulCaches();
await testStickyRejectedCaches();
await testPageCachingAndRetry();
await testConcurrentUncachedPagesDoNotCoalesce();
await testSearchFlattenPreservesPageOrder();
await testEndpointAndByteLimits();

console.log("Catalog remote transport/cache behavior passed.");
