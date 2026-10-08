import assert from "node:assert/strict";

import {
  createCatalogSearchController,
  initialCatalogSearchState,
  type SearchPetEntry,
} from "../src/renderer/src/catalog-search-state.js";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function testFailureCanBeRetriedSuccessfully() {
  const controller = createCatalogSearchController();

  await controller.startFetch("pets", async () => ({ pets: [], error: "Catalog search unavailable" }));
  assert.deepEqual(controller.getState(), {
    status: "error",
    pets: null,
    error: "Catalog search unavailable",
  });

  const deferred = createDeferred<{ pets: SearchPetEntry[] }>();
  controller.retry();
  const retryPromise = controller.startFetch("pets", () => deferred.promise);
  assert.equal(controller.getState().status, "loading");

  deferred.resolve({
    pets: [{ id: "pixel-cat", displayName: "Pixel Cat", catalogPage: 0 }],
  });

  assert.deepEqual(await retryPromise, {
    status: "success",
    pets: [{ id: "pixel-cat", displayName: "Pixel Cat", catalogPage: 0 }],
    error: null,
  });
}

async function testSuccessfulEmptyResultIsCached() {
  const controller = createCatalogSearchController();
  const result = await controller.startFetch("pets", async () => ({ pets: [] }));

  assert.deepEqual(result, {
    status: "success",
    pets: [],
    error: null,
  });
  assert.equal(controller.shouldFetch("pets"), false);
}

async function testCleanupAndRemountDiscardOldRequest() {
  const controller = createCatalogSearchController(initialCatalogSearchState);
  const firstMountDeferred = createDeferred<{ pets: SearchPetEntry[] }>();
  const firstMountPromise = controller.startFetch("pets", () => firstMountDeferred.promise);

  // Model an effect cleanup followed by a new mount using the same controller.
  controller.cancelPending();
  const secondMountDeferred = createDeferred<{ pets: SearchPetEntry[] }>();
  const secondMountPromise = controller.startFetch("pets", () => secondMountDeferred.promise);

  firstMountDeferred.resolve({ pets: [{ id: "stale-pet", displayName: "Stale" }] });
  assert.equal(await firstMountPromise, null);

  secondMountDeferred.resolve({ pets: [{ id: "fresh-pet", displayName: "Fresh" }] });
  assert.equal((await secondMountPromise)?.pets?.[0].id, "fresh-pet");
}

async function testLeavingRouteResetsPendingSearch() {
  const controller = createCatalogSearchController();
  const deferred = createDeferred<{ pets: SearchPetEntry[] }>();
  const fetchPromise = controller.startFetch("pets", () => deferred.promise);

  controller.onRouteTransition("dashboard");
  assert.equal(controller.getState().status, "idle");
  deferred.resolve({ pets: [{ id: "late-pet", displayName: "Late" }] });
  assert.equal(await fetchPromise, null);
  assert.equal(controller.shouldFetch("pets"), true);
}

await testFailureCanBeRetriedSuccessfully();
await testSuccessfulEmptyResultIsCached();
await testCleanupAndRemountDiscardOldRequest();
await testLeavingRouteResetsPendingSearch();
