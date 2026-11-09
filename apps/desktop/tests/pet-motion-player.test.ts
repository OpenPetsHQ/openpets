import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

interface Player {
  refresh(): void;
  setDragDirection(direction: string | null): void;
  dispose(): void;
  hitTest(x: number, y: number): boolean | null;
}
interface Frame {
  name: string;
  index: number;
  displayWidth: number;
  displayHeight: number;
  duration: number;
  closed: boolean;
  close(): void;
}
const require = createRequire(import.meta.url);
const { createPetMotionPlayer } = require(
  join(
    process.env.OPENPETS_DESKTOP_ROOT ?? process.cwd(),
    "src/pet-motion-player.cjs",
  ),
) as {
  createPetMotionPlayer(options: Record<string, unknown>): Player;
};

function fixture(playbackRate = 1) {
  let clock = 0;
  let sequence = 0;
  const timers = new Map<number, { at: number; callback(): void }>();
  const shown: Array<{ name: string; index: number; at: number }> = [];
  const frames: Frame[] = [];
  const errors: unknown[] = [];
  const root: Record<string, string> = { reactionState: "idle" };
  const clip = (file: string) => ({ file, frames: 3 });
  const pack = {
    width: 10,
    height: 10,
    pixelsPerUnit: 1,
    anchor: { x: 5, y: 9 },
    animations: {
      idle: { play: "loop", clip: clip("idle") },
      waving: { play: "once", clip: clip("wave") },
      "running-left": { play: "loop", clip: clip("run-left") },
      "running-right": {
        play: "loop",
        enter: clip("turn"),
        clip: clip("run"),
        exit: clip("return"),
      },
    },
  };
  const urls = Object.fromEntries(
    ["idle", "wave", "turn", "run", "run-left", "return"].map((name) => [
      name,
      name,
    ]),
  );
  const makeBase = () => ({
    dataset: { motionPreview: JSON.stringify({ pack, urls }) },
    style: {} as Record<string, string>,
    appendChild(element: { parentNode: unknown }) {
      element.parentNode = this;
    },
  });
  let base = makeBase();
  const canvas = {
    parentNode: null as unknown,
    isConnected: true,
    style: {},
    width: 10,
    height: 10,
    remove() {
      this.isConnected = false;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    getContext: () => ({
      clearRect() {},
      drawImage(frame: Frame) {
        shown.push({ name: frame.name, index: frame.index, at: clock });
      },
      getImageData(x: number) {
        return { data: new Uint8Array([0, 0, 0, x < 4 ? 255 : 0]) };
      },
    }),
  };
  const player = createPetMotionPlayer({
    playbackRate,
    document: {
      documentElement: { dataset: root },
      querySelector: (selector: string) =>
        selector.startsWith(".sprite") ? base : null,
      createElement: () => canvas,
    },
    loadBytes: async (name: string) => new TextEncoder().encode(name),
    createDecoder({ data }: { data: Uint8Array }) {
      const name = new TextDecoder().decode(data);
      return {
        tracks: { ready: Promise.resolve(), selectedTrack: { frameCount: 3 } },
        async decode({ frameIndex }: { frameIndex: number }) {
          const frame: Frame = {
            name,
            index: frameIndex,
            displayWidth: 10,
            displayHeight: 10,
            duration: [40_000, 50_000, 60_000][frameIndex]!,
            closed: false,
            close() {
              this.closed = true;
            },
          };
          frames.push(frame);
          return { image: frame };
        },
        close() {},
      };
    },
    now: () => clock,
    setTimeout(callback: () => void, delay: number) {
      const id = ++sequence;
      timers.set(id, { at: clock + delay, callback });
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
    onError: (error: unknown) => errors.push(error),
  });
  const flush = async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  };
  return {
    player,
    root,
    shown,
    frames,
    errors,
    timers,
    canvas,
    replaceStage() {
      base = makeBase();
      player.refresh();
      return base;
    },
    async advance(duration: number) {
      const until = clock + duration;
      await flush();
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        timers.delete(next[0]);
        clock = next[1].at;
        next[1].callback();
        await flush();
      }
      clock = until;
    },
  };
}

test("motion playback preserves every frame and its native duration across loops", async () => {
  const f = fixture();
  f.player.refresh();
  await f.advance(150);
  assert.deepEqual(f.shown, [
    { name: "idle", index: 0, at: 0 },
    { name: "idle", index: 1, at: 40 },
    { name: "idle", index: 2, at: 90 },
    { name: "idle", index: 0, at: 150 },
  ]);
  f.player.dispose();
  assert.ok(f.frames.every((frame) => frame.closed));
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.errors, []);
});

test("one-shot reactions finish and return to idle while the reaction remains selected", async () => {
  const f = fixture();
  f.root.reactionState = "waving";
  f.player.refresh();
  await f.advance(450);
  assert.deepEqual(
    f.shown.slice(0, 4).map((frame) => frame.name),
    ["wave", "wave", "wave", "idle"],
  );
  assert.equal(f.shown.filter((frame) => frame.name === "wave").length, 3);
  f.player.dispose();
});

test("drag interrupts the current animation immediately and release skips the return clip", async () => {
  const f = fixture();
  f.player.refresh();
  await f.advance(20);
  f.player.setDragDirection("run-right");
  await f.advance(0);
  assert.deepEqual(f.shown.at(-1), { name: "run", index: 0, at: 20 });
  await f.advance(20);
  f.player.setDragDirection("run-left");
  await f.advance(0);
  assert.deepEqual(f.shown.at(-1), { name: "run-left", index: 0, at: 40 });
  f.player.setDragDirection(null);
  await f.advance(0);
  assert.deepEqual(f.shown.at(-1), { name: "idle", index: 0, at: 40 });
  assert.ok(
    f.shown.every((frame) => frame.name !== "turn" && frame.name !== "return"),
  );
  f.player.dispose();
});

test("faster playback retains all frames while reducing their display time", async () => {
  const f = fixture(1.5);
  f.player.refresh();
  await f.advance(100);
  assert.deepEqual(
    f.shown.map((frame) => frame.index),
    [0, 1, 2, 0],
  );
  assert.equal(f.shown.at(-1)?.at, 100);
  f.player.dispose();
});

test("pause and HUD replacement preserve the current artwork and release resources on teardown", async () => {
  const f = fixture();
  f.player.refresh();
  await f.advance(40);
  f.root.paused = "true";
  f.player.refresh();
  await f.advance(500);
  assert.equal(f.shown.length, 2);
  const replacement = f.replaceStage();
  assert.equal(f.canvas.parentNode, replacement);
  assert.equal(f.shown.length, 2);
  f.root.paused = "false";
  f.player.refresh();
  await f.advance(0);
  assert.equal(f.shown.at(-1)?.index, 2);
  assert.equal(f.player.hitTest(2, 5), true);
  assert.equal(f.player.hitTest(8, 5), false);
  f.root.flipX = "true";
  assert.equal(f.player.hitTest(8, 5), true);
  f.player.dispose();
  await f.advance(500);
  assert.equal(f.shown.length, 3);
  assert.ok(f.frames.every((frame) => frame.closed));
});

test("disposing during an asynchronous load never attaches artwork", async () => {
  const f = fixture();
  f.player.refresh();
  f.player.dispose();
  await f.advance(500);
  assert.deepEqual(f.shown, []);
  assert.equal(f.timers.size, 0);
});

test("a short reaction is still played when it expires before the idle boundary", async () => {
  const f = fixture();
  f.player.refresh();
  await f.advance(40);
  f.root.reactionState = "waving";
  f.player.refresh();
  await f.advance(40);
  f.root.reactionState = "idle";
  f.player.refresh();
  await f.advance(220);
  assert.deepEqual(
    f.shown
      .filter((frame) => frame.name === "wave")
      .map((frame) => frame.index),
    [0, 1, 2],
  );
  assert.equal(f.shown.at(-1)?.name, "idle");
  f.player.dispose();
});
