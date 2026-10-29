import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SurfaceCoordinator } from "../src/host/surface-coordinator.js";

test("visible editor takes playback; hiding or closing it returns playback to the view", () => {
  const surfaces = new SurfaceCoordinator();
  surfaces.attach("view", "view", true);
  assert.equal(surfaces.get("view").playbackEnabled, true);
  surfaces.attach("editor", "editor", true);
  assert.equal(surfaces.get("view").playbackEnabled, false);
  assert.equal(surfaces.get("editor").playbackEnabled, true);
  surfaces.setVisible("editor", false);
  assert.equal(surfaces.get("view").playbackEnabled, true);
  surfaces.setVisible("view", false);
  assert.equal(surfaces.get("view").playbackEnabled, false);
  surfaces.detach("editor");
});

test("detaching the editor hands playback back and unsubscribed listeners receive no events", () => {
  const surfaces = new SurfaceCoordinator();
  const seen: number[] = [];
  const unsubscribe = surfaces.subscribe((state) => seen.push(state.sequence));

  surfaces.attach("view", "view", true);
  surfaces.attach("editor", "editor", true);
  surfaces.detach("editor");

  assert.equal(surfaces.get("view").playbackEnabled, true);
  assert.ok(
    seen.every((sequence, index) => index === 0 || sequence > seen[index - 1]),
  );
  const count = seen.length;
  unsubscribe();
  surfaces.setVisible("view", false);
  assert.equal(surfaces.get("view").playbackEnabled, false);
  assert.equal(seen.length, count);
});
