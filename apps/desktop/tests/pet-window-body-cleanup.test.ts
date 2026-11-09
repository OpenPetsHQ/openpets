import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { it } from "node:test";

import { petBodyChannels } from "../src/pet-body-contract.js";
import { petContentCommittedChannel, registerPetBodyWindowCleanup } from "../src/pet-window-body-cleanup.js";

it("releases body ownership after the native window and its contents are destroyed", () => {
  let destroyed = false;
  class Contents extends EventEmitter {
    isDestroyed(): boolean { return destroyed; }
  }
  const contents = new Contents();
  const ipc = new EventEmitter();
  class Window extends EventEmitter {
    get webContents(): EventEmitter {
      if (destroyed) throw new Error("Object has been destroyed");
      return contents;
    }
  }
  const window = new Window();
  const capturedContents = window.webContents;
  const ready = () => {};
  const result = () => {};
  const contentCommitted = () => {};
  const navigation = () => {};
  const show = () => {};
  const hide = () => {};
  ipc.on(petBodyChannels.ready, ready);
  ipc.on(petBodyChannels.result, result);
  ipc.on(petContentCommittedChannel, contentCommitted);
  capturedContents.on("did-start-loading", navigation);
  capturedContents.on("render-process-gone", navigation);
  window.on("show", show);
  window.on("hide", hide);
  let stateRetained = true;
  let snapshotRetained = true;
  registerPetBodyWindowCleanup({
    window, contents: capturedContents, ipc, ready, result, contentCommitted, navigation, show, hide,
    forgetState: () => { stateRetained = false; },
    releaseSnapshots: () => { snapshotRetained = false; },
  });
  let laterClosedListenerRan = false;
  window.once("closed", () => { laterClosedListenerRan = true; });
  destroyed = true;
  assert.equal(contents.isDestroyed(), true);
  window.emit("closed");
  assert.equal(stateRetained, false);
  assert.equal(snapshotRetained, false);
  assert.equal(laterClosedListenerRan, true);
  assert.equal(ipc.listenerCount(petBodyChannels.ready), 0);
  assert.equal(ipc.listenerCount(petBodyChannels.result), 0);
  assert.equal(ipc.listenerCount(petContentCommittedChannel), 0);
  assert.equal(contents.listenerCount("did-start-loading"), 0);
  assert.equal(contents.listenerCount("render-process-gone"), 0);
  assert.equal(window.listenerCount("show"), 0);
  assert.equal(window.listenerCount("hide"), 0);
});
