import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { createCatalogV3Client, getCuratedCatalogPage } from "../dist/catalog-v3.js";

test("curated virtual pages hydrate source pages in search order and coalesce requests", async () => {
  const base = "https://openpets.dev/pets/catalog.v3/";
  const indexUrl = "https://openpets.dev/pets/catalog.v3.json";
  const date = "2026-01-01T00:00:00Z";
  const index = { version: 3, generatedAt: date, total: 4, pageSize: 2, search: `${base}search.json`, filters: { categories: [] }, pages: [`${base}page-000.json`, `${base}page-001.json`] };
  const searchPet = (id, catalogPage, original) => ({ id, displayName: id, searchText: id, category: "western", catalogPage, original });
  const pet = (id, original) => ({ id, displayName: id, description: id, thumbnail: `https://openpets.dev/pets/${id}/thumb.webp`, spritesheet: `https://openpets.dev/pets/${id}/spritesheet.webp`, zip: `https://zip.openpets.dev/pets/${id}/${id}.zip`, category: "western", original });
  const payloads = new Map([
    [indexUrl, index],
    [index.search, { version: 3, generatedAt: date, total: 4, pageSize: 4, pages: [`${base}search-page-000.json`] }],
    [`${base}search-page-000.json`, { version: 3, page: 0, pageSize: 4, pets: [searchPet("b", 1, true), searchPet("hidden", 0, false), searchPet("a", 0, true), searchPet("c", 1, true)] }],
    [index.pages[0], { version: 3, page: 0, pageSize: 2, pets: [pet("a", true), pet("hidden", false)] }],
    [index.pages[1], { version: 3, page: 1, pageSize: 2, pets: [pet("c", true), pet("b", true)] }],
  ]);
  const calls = new Map();
  const fetchImpl = async (input) => {
    const url = String(input);
    calls.set(url, (calls.get(url) ?? 0) + 1);
    const response = new Response(JSON.stringify(payloads.get(url)));
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  const client = createCatalogV3Client({ fetchImpl });
  const loaded = await client.getIndex();
  const [first, concurrent] = await Promise.all([getCuratedCatalogPage(client, 0, loaded), getCuratedCatalogPage(client, 0, loaded)]);
  assert.deepEqual(first.map((item) => item.id), ["b", "a"]);
  assert.deepEqual(concurrent.map((item) => item.id), ["b", "a"]);
  assert.deepEqual((await getCuratedCatalogPage(client, 1, loaded)).map((item) => item.id), ["c"]);
  assert.equal(calls.get(index.pages[0]), 1);
  assert.equal(calls.get(index.pages[1]), 1);
});

test("failed streaming responses are stopped and a later index request can succeed", async () => {
  const url = "https://openpets.dev/pets/catalog.v3.json";
  const caller = new AbortController();
  let failedSignal;
  let successfulSignal;
  let cancelled = false;
  let calls = 0;
  const fetchImpl = async (_input, options) => {
    calls++;
    if (calls === 1) {
      failedSignal = options.signal;
      const body = new ReadableStream({ cancel() { cancelled = true; } });
      const response = new Response(body, { status: 503 });
      Object.defineProperty(response, "url", { value: url });
      return response;
    }
    successfulSignal = options.signal;
    const response = new Response(JSON.stringify({
      version: 3, generatedAt: "2026-01-01T00:00:00Z", total: 0, pageSize: 1,
      search: "https://openpets.dev/pets/catalog.v3/search.json", filters: { categories: [] }, pages: [],
    }));
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  const client = createCatalogV3Client({ fetchImpl, signal: caller.signal });
  await assert.rejects(client.getIndex(), /HTTP 503/);
  assert.equal(failedSignal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(getEventListeners(caller.signal, "abort").length, 0);
  assert.equal((await client.getIndex()).total, 0);
  assert.equal(successfulSignal.aborted, false);
  assert.equal(getEventListeners(caller.signal, "abort").length, 0);
  assert.equal(calls, 2);
});

test("a rejected final URL stops the unread response", async () => {
  let requestSignal;
  let cancelled = false;
  const fetchImpl = async (_input, options) => {
    requestSignal = options.signal;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    Object.defineProperty(response, "url", { value: "https://openpets.dev/pets/other.json" });
    return response;
  };
  await assert.rejects(createCatalogV3Client({ fetchImpl }).getIndex(), /final URL/);
  assert.equal(requestSignal.aborted, true);
  assert.equal(cancelled, true);
});
