import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  applySceneCommand,
  createDefaultScene,
  parseStoredScene,
} from "../src/host/scene-state.js";

test("default, immutable additions and capacity", () => {
  const original = createDefaultScene("seed");
  assert.equal(original.instances[0].petId, "builtin");
  assert.deepEqual(original.settings, {
    size: "medium",
    motion: "calm",
    paused: false,
    backdrop: "dots",
  });
  let scene = original;
  for (let index = 0; index < 5; index++)
    scene = applySceneCommand(scene, {
      type: "addInstance",
      id: `id${index}`,
      petId: "cat",
      name: " Cat ",
    });
  assert.equal(original.instances.length, 1);
  assert.equal(scene.instances.length, 6);
  assert.equal(scene.instances[5].name, "Cat");
  assert.equal(scene.selectedInstanceId, "id4");
  assert.throws(() =>
    applySceneCommand(scene, {
      type: "addInstance",
      id: "extra",
      petId: "cat",
      name: "Cat",
    }),
  );
  assert.throws(() =>
    applySceneCommand(original, {
      type: "addInstance",
      id: "seed",
      petId: "cat",
      name: "Cat",
    }),
  );
});

test("removal selects next stable instance and stale commands cannot recreate it", () => {
  let scene = createDefaultScene("a");
  scene = applySceneCommand(scene, {
    type: "addInstance",
    id: "b",
    petId: "cat",
    name: "Cat",
  });
  scene = applySceneCommand(scene, {
    type: "addInstance",
    id: "c",
    petId: "cat",
    name: "Cat",
  });
  scene = applySceneCommand(scene, { type: "selectInstance", instanceId: "b" });
  scene = applySceneCommand(scene, { type: "removeInstance", instanceId: "b" });
  assert.equal(scene.selectedInstanceId, "c");
  assert.throws(() =>
    applySceneCommand(scene, {
      type: "renameInstance",
      instanceId: "b",
      name: "Again",
    }),
  );
  assert.throws(() =>
    applySceneCommand(scene, {
      type: "setInstanceOutfit",
      instanceId: "b",
      outfitId: "hat",
    }),
  );
  scene = applySceneCommand(scene, { type: "removeInstance", instanceId: "c" });
  assert.equal(scene.selectedInstanceId, "a");
  scene = applySceneCommand(scene, { type: "removeInstance", instanceId: "a" });
  assert.deepEqual(parseStoredScene(scene).instances, []);
  assert.equal(scene.selectedInstanceId, null);
});

test("settings merge and names obey bounded normalized contract", () => {
  const scene = createDefaultScene("a");
  const changed = applySceneCommand(scene, {
    type: "setSceneSettings",
    changes: { paused: true, motion: "playful" },
  });
  assert.deepEqual(changed.settings, {
    size: "medium",
    motion: "playful",
    paused: true,
    backdrop: "dots",
  });
  assert.equal(scene.settings.paused, false);
  assert.equal(
    applySceneCommand(scene, {
      type: "renameInstance",
      instanceId: "a",
      name: ` ${"🐈".repeat(40)} `,
    }).instances[0].name,
    "🐈".repeat(40),
  );
  assert.throws(() =>
    applySceneCommand(scene, {
      type: "renameInstance",
      instanceId: "a",
      name: "🐈".repeat(41),
    }),
  );
  assert.throws(() =>
    applySceneCommand(scene, {
      type: "renameInstance",
      instanceId: "a",
      name: " ",
    }),
  );
  assert.throws(() =>
    applySceneCommand(scene, { type: "setSceneSettings", changes: {} }),
  );
  assert.throws(() =>
    applySceneCommand(scene, {
      type: "setSceneSettings",
      changes: { speed: 1 },
    }),
  );
  assert.throws(() =>
    parseStoredScene({ ...scene, selectedInstanceId: "missing" }),
  );
  assert.throws(() =>
    parseStoredScene({
      ...scene,
      instances: [scene.instances[0], scene.instances[0]],
    }),
  );
});
