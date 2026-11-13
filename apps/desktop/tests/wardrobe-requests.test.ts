import assert from "node:assert/strict";
import { test } from "node:test";
import { WardrobeRequests } from "../src/renderer/src/pets/wardrobe-requests.js";

test("refreshes during a mutation cannot strand saving or overwrite its result", () => {
  const requests = new WardrobeRequests();
  const oldRead = requests.beginRead();
  assert.notEqual(oldRead, null);
  const mutation = requests.beginMutation();
  assert.ok(mutation);
  assert.equal(requests.ownsRead(oldRead!), false);
  assert.equal(requests.beginRead(), null);
  assert.equal(requests.beginRead(), null);
  assert.equal(requests.ownsMutation(mutation), true);
  assert.equal(requests.finishMutation(mutation), true);
  const refresh = requests.beginRead();
  assert.notEqual(refresh, null);
  assert.equal(requests.ownsRead(refresh!), true);
  assert.ok(requests.beginMutation());
});

test("replaced or unmounted panels cannot apply old reads or mutations", () => {
  const requests = new WardrobeRequests();
  const oldRead = requests.beginRead();
  assert.notEqual(oldRead, null);
  const newerRead = requests.beginRead();
  assert.notEqual(newerRead, null);
  assert.equal(requests.ownsRead(oldRead!), false);
  const mutation = requests.beginMutation();
  assert.ok(mutation);
  requests.invalidate();
  assert.equal(requests.ownsRead(newerRead!), false);
  assert.equal(requests.ownsMutation(mutation), false);
  assert.equal(requests.finishMutation(mutation), false);
  assert.equal(requests.beginRead(), null);
  assert.equal(requests.beginMutation(), null);
});
